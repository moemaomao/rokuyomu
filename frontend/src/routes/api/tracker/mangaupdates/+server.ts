import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

type MuRecord = {
	series_id?: number;
	title?: string;
	url?: string;
	type?: string;
	year?: string;
};

type MuSearchResponse = {
	total_hits?: number;
	results?: { record?: MuRecord }[];
};

function normalizeTitle(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function scoreMatch(query: string, title: string): number {
	const q = normalizeTitle(query);
	const t = normalizeTitle(title);
	if (!q || !t) return 0;
	if (q === t) return 100;
	if (t.startsWith(q) || q.startsWith(t)) return 80;
	if (t.includes(q) || q.includes(t)) return 60;
	const qt = new Set(q.split(' ').filter(Boolean));
	const tt = new Set(t.split(' ').filter(Boolean));
	let hit = 0;
	for (const w of qt) if (tt.has(w)) hit++;
	if (qt.size === 0) return 0;
	return Math.round((hit / qt.size) * 40);
}

/** Prefer shorter query for very long English titles (better API hit rate). */
function searchQueries(title: string): string[] {
	const t = title.trim();
	if (!t) return [];
	const out: string[] = [t];
	// First clause before comma / "so I" style
	const beforeComma = t.split(',')[0]?.trim();
	if (beforeComma && beforeComma.length >= 12 && beforeComma !== t) {
		out.push(beforeComma);
	}
	// First ~8 words
	const words = t.split(/\s+/);
	if (words.length > 10) {
		out.push(words.slice(0, 8).join(' '));
	}
	return [...new Set(out)];
}

export const GET: RequestHandler = async ({ url, fetch }) => {
	const q = (url.searchParams.get('q') || '').trim();
	if (!q) throw error(400, 'q is required');
	if (q.length > 300) throw error(400, 'q too long');

	const fallback = `https://www.mangaupdates.com/series?search=${encodeURIComponent(q)}`;
	const queries = searchQueries(q);

	for (const query of queries) {
		let data: MuSearchResponse;
		try {
			const res = await fetch('https://api.mangaupdates.com/v1/series/search', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json'
				},
				body: JSON.stringify({
					search: query,
					stype: 'title',
					perpage: 8
				})
			});
			if (!res.ok) continue;
			data = (await res.json()) as MuSearchResponse;
		} catch {
			continue;
		}

		const results = Array.isArray(data.results) ? data.results : [];
		if (!results.length) continue;

		const qLow = q.toLowerCase();
		const wantsDoujin = /\b(dj|doujin)\b/i.test(qLow);

		// Rank by title similarity, but DO NOT require high score —
		// MU API ranks by relevance; English query often maps to Japanese title.
		const ranked = results
			.map((r) => {
				const rec = r?.record || {};
				const title = String(rec.title || '');
				const type = String(rec.type || '');
				const seriesUrl = String(rec.url || '');
				let score = scoreMatch(q, title);
				if (!wantsDoujin && /doujin/i.test(type)) score -= 25;
				return { rec, title, type, score, url: seriesUrl };
			})
			.filter((x) => !!x.url)
			.sort((a, b) => b.score - a.score);

		// Prefer high title similarity when available
		const strong = ranked.find((x) => x.score >= 40);
		// Otherwise trust MU's first result (API order), skipping doujin unless wanted
		const firstOk =
			ranked.find((x) => wantsDoujin || !/doujin/i.test(x.type)) || ranked[0];

		const best = strong || firstOk;
		if (best?.url) {
			return json({
				ok: true,
				matched: true,
				url: best.url,
				title: best.title,
				type: best.type,
				series_id: best.rec.series_id ?? null,
				score: best.score,
				query_used: query
			});
		}
	}

	return json({
		ok: true,
		matched: false,
		url: fallback,
		title: null,
		type: null,
		series_id: null,
		score: 0
	});
};
