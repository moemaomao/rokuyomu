import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

type MuRecord = {
	series_id?: number;
	title?: string;
	url?: string;
	type?: string;
	year?: string;
	description?: string;
};

type MuResult = {
	record?: MuRecord;
	hit_title?: string;
};

type MuSearchResponse = {
	total_hits?: number;
	results?: MuResult[];
};

function normalizeTitle(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function scorePair(query: string, candidate: string): number {
	const q = normalizeTitle(query);
	const t = normalizeTitle(candidate);
	if (!q || !t) return 0;
	if (q === t) return 100;
	if (t.startsWith(q) || q.startsWith(t)) return 88;
	if (t.includes(q) || q.includes(t)) return 72;

	const qt = new Set(q.split(' ').filter((w) => w.length > 1));
	const tt = new Set(t.split(' ').filter((w) => w.length > 1));
	if (qt.size === 0) return 0;
	let hit = 0;
	for (const w of qt) if (tt.has(w)) hit++;
	const ratio = hit / qt.size;
	if (ratio >= 0.85) return 70;
	if (ratio >= 0.65) return 55;
	if (ratio >= 0.45) return 40;
	if (ratio >= 0.3) return 25;
	return Math.round(ratio * 20);
}

function seriesUrl(rec: MuRecord): string {
	const u = String(rec.url || '').trim();
	if (u) return u;
	const id = rec.series_id;
	if (id != null) return `https://www.mangaupdates.com/series.html?id=${id}`;
	return '';
}

function searchQueries(title: string): string[] {
	const t = title.trim();
	if (!t) return [];
	const out: string[] = [t];

	const cut = t.split(/\s+[|\-–—]\s+/)[0]?.trim();
	if (cut && cut.length >= 8 && cut !== t) out.push(cut);

	const beforeComma = t.split(',')[0]?.trim();
	if (beforeComma && beforeComma.length >= 12 && beforeComma !== t) out.push(beforeComma);

	const noParen = t.replace(/\s*\([^)]*\)\s*$/g, '').trim();
	if (noParen && noParen !== t) out.push(noParen);

	const words = t.split(/\s+/);
	if (words.length > 12) out.push(words.slice(0, 10).join(' '));

	return [...new Set(out.filter(Boolean))];
}

async function muSearch(fetchFn: typeof fetch, query: string): Promise<MuResult[]> {
	const res = await fetchFn('https://api.mangaupdates.com/v1/series/search', {
		method: 'POST',
		headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Origin: 'https://www.mangaupdates.com',
        Referer: 'https://www.mangaupdates.com/',
       'Accept-Language': 'en-US,en;q=0.9'
        },
		body: JSON.stringify({
			search: query,
			stype: 'title',
			perpage: 10
		})
	});
	if (!res.ok) {
		console.error('[MU tracker] HTTP', res.status, await res.text().catch(() => ''));
		return [];
	}
	const data = (await res.json()) as MuSearchResponse;
	return Array.isArray(data.results) ? data.results : [];
}

export const GET: RequestHandler = async ({ url, fetch }) => {
	const q = (url.searchParams.get('q') || '').trim();
	if (!q) throw error(400, 'q is required');
	if (q.length > 300) throw error(400, 'q too long');

	const fallback = `https://www.mangaupdates.com/series?search=${encodeURIComponent(q)}`;
	const queries = searchQueries(q);
	const wantsDoujin = /\b(dj|doujin)\b/i.test(q.toLowerCase());

	type Ranked = {
		title: string;
		hitTitle: string;
		type: string;
		score: number;
		url: string;
		series_id: number | null;
	};

	let bestOverall: Ranked | null = null;
	let lastError: string | null = null;

	for (const query of queries) {
		let results: MuResult[];
		try {
			results = await muSearch(fetch, query);
		} catch (e) {
			lastError = e instanceof Error ? e.message : String(e);
			console.error('[MU tracker] fetch failed:', lastError);
			continue;
		}
		if (!results.length) continue;

		const ranked: Ranked[] = results
			.map((r) => {
				const rec = r?.record || {};
				const title = String(rec.title || '');
				const hitTitle = String(r?.hit_title || '');
				const type = String(rec.type || '');
				let score = Math.max(scorePair(q, title), scorePair(q, hitTitle));

				if (hitTitle && scorePair(q, hitTitle) >= 72) {
					score = Math.max(score, 95);
				}
				if (!wantsDoujin && /doujin/i.test(type)) score -= 30;

				return {
					title,
					hitTitle,
					type,
					score,
					url: seriesUrl(rec),
					series_id: rec.series_id ?? null
				};
			})
			.filter((x) => !!x.url)
			.sort((a, b) => b.score - a.score);

		if (!ranked.length) continue;

		const strong = ranked.find((x) => x.score >= 55);
		if (strong) {
			return json({
				ok: true,
				matched: true,
				url: strong.url,
				title: strong.hitTitle || strong.title,
				type: strong.type,
				series_id: strong.series_id,
				score: strong.score,
				query_used: query
			});
		}

		const first = ranked.find((x) => wantsDoujin || !/doujin/i.test(x.type)) || ranked[0];
		if (first && (!bestOverall || first.score > bestOverall.score)) {
			bestOverall = first;
		}

		if (first?.hitTitle && scorePair(q, first.hitTitle) >= 55) {
			return json({
				ok: true,
				matched: true,
				url: first.url,
				title: first.hitTitle || first.title,
				type: first.type,
				series_id: first.series_id,
				score: Math.max(first.score, 80),
				query_used: query
			});
		}
	}

	if (bestOverall && bestOverall.score >= 30) {
		return json({
			ok: true,
			matched: true,
			url: bestOverall.url,
			title: bestOverall.hitTitle || bestOverall.title,
			type: bestOverall.type,
			series_id: bestOverall.series_id,
			score: bestOverall.score,
			query_used: queries[0] ?? q
		});
	}

	return json({
		ok: true,
		matched: false,
		url: fallback,
		title: null,
		type: null,
		series_id: null,
		score: 0,
		error: lastError || undefined
	});
};