/**
 * Fenrir Realm (fenrirealm.com)
 * Path: scraper/src/sources/impl/FenrirRealm.ts
 *
 * Novel source — SvelteKit frontend + JSON API `/api/new/v2/...`
 *
 * New Releases (homepage section):
 *   GET /api/new/v2/home  →  { new_releases: SeriesCard[] }
 *
 * Series list (pagination):
 *   GET /api/new/v2/series?sort=latest&page=N  →  { data, meta }
 *
 * Series detail:
 *   GET /api/new/v2/series/{slug}
 *
 * Chapters:
 *   GET /api/new/v2/series/{slug}/chapters
 *   GET /api/new/v2/series/{slug}/chapters/{chapterSlug}
 *   (or GET /api/new/v2/chapters/{id})
 *
 * Cover: https://fenrirealm.com/{cover}  (cover is "storage/…")
 *
 * Chapter body: HTML with decoy aria-hidden divs — strip those + <style>.
 *
 * Frontend id: fenrirealm
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types';

const BASE = 'https://fenrirealm.com';
const API = `${BASE}/api/new/v2`;

function absUrl(href: string | undefined | null): string {
	if (!href) return '';
	const h = String(href).trim();
	if (!h) return '';
	if (h.startsWith('data:')) return h;
	if (h.startsWith('//')) return `https:${h}`;
	if (/^https?:\/\//i.test(h)) return h;
	if (h.startsWith('storage/')) return `${BASE}/${h}`;
	try {
		return new URL(h.startsWith('/') ? h : `/${h}`, BASE).href;
	} catch {
		return h;
	}
}

function cleanText(s: string): string {
	return (s || '')
		.replace(/\u00a0/g, ' ')
		.replace(/&quot;/g, '"')
		.replace(/&#039;/g, "'")
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/\s+/g, ' ')
		.trim();
}

function stripHtmlToText(html: string): string {
	return cleanText(
		(html || '')
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/p>/gi, '\n')
			.replace(/<[^>]+>/g, ' ')
	);
}

function normalizeStatus(s?: string): string {
	const v = (s || '').toLowerCase();
	if (v.includes('complete') || v.includes('finished') || v.includes('end')) return 'Completed';
	if (v.includes('hiatus') || v.includes('hold')) return 'Hiatus';
	if (v.includes('drop')) return 'Dropped';
	return 'Ongoing';
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** Remove anti-scrape decoy blocks; keep real <p> text as HTML paragraphs */
function sanitizeChapterHtml(html: string): string {
	const $ = cheerio.load(`<div id="root">${html || ''}</div>`);
	$('#root style, #root script').remove();
	$('#root [aria-hidden="true"]').remove();
	// also drop zero-size / clip decoys by class noise if any remain empty
	const parts: string[] = [];
	$('#root p').each((_: number, el: any) => {
		const t = cleanText($(el).text());
		if (t) parts.push(`<p>${escapeHtml(t)}</p>`);
	});
	if (parts.length) return parts.join('\n');
	// fallback: whole text
	const raw = cleanText($('#root').text());
	if (!raw) return '';
	return raw
		.split(/\n+/)
		.map((l) => l.trim())
		.filter(Boolean)
		.map((l) => `<p>${escapeHtml(l)}</p>`)
		.join('\n');
}

type ApiSeriesCard = {
	id?: number;
	title?: string;
	slug?: string;
	type?: string;
	cover?: string;
	cover_data_url?: string;
	status?: string;
	user?: { username?: string; name?: string };
	subscribers?: number;
	stats?: { total_views?: number; [k: string]: unknown };
};

type ApiChapter = {
	id?: number;
	slug?: string;
	name?: string;
	title?: string | null;
	number?: number;
	index?: number;
	locked?: { price?: number; unlocked_at?: string | null; is_read_only?: boolean };
	created_at?: string;
	updated_at?: string;
	content?: string;
};

export class FenrirRealmSource extends BaseSource {
	id = 'fenrirealm';
	name = 'Fenrir Realm';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'application/json, text/plain, */*',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`,
		Origin: BASE,
		'Sec-Fetch-Dest': 'empty',
		'Sec-Fetch-Mode': 'cors',
		'Sec-Fetch-Site': 'same-origin',
		'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
		'sec-ch-ua-mobile': '?0',
		'sec-ch-ua-platform': '"Windows"'
	};

	private htmlHeaders(): Record<string, string> {
		return {
			'User-Agent': this.headers['User-Agent'],
			Accept:
				'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
			'Accept-Language': 'en-US,en;q=0.9',
			Referer: `${BASE}/`,
			'Sec-Fetch-Dest': 'document',
			'Sec-Fetch-Mode': 'navigate',
			'Sec-Fetch-Site': 'none',
			'Sec-Fetch-User': '?1',
			'Upgrade-Insecure-Requests': '1',
			'sec-ch-ua': this.headers['sec-ch-ua'],
			'sec-ch-ua-mobile': '?0',
			'sec-ch-ua-platform': '"Windows"'
		};
	}

	private async apiGet<T = unknown>(path: string): Promise<T> {
		const url = path.startsWith('http')
			? path
			: `${API}${path.startsWith('/') ? path : `/${path}`}`;
		const res = await fetch(url, {
			headers: {
				...this.headers,
				Accept: 'application/json, text/plain, */*',
				Referer: `${BASE}/`
			}
		});
		const text = await res.text();
		if (!res.ok || text.trimStart().startsWith('<!DOCTYPE') || text.trimStart().startsWith('<html')) {
			throw new Error(
				`FenrirRealm API ${res.status} ${path} ${text.slice(0, 100).replace(/\s+/g, ' ')}`
			);
		}
		try {
			return JSON.parse(text) as T;
		} catch {
			throw new Error(`FenrirRealm API invalid JSON ${path}`);
		}
	}

	/** Homepage SSR — works more often than JSON API behind Cloudflare. */
	private async fetchHomeHtml(): Promise<string> {
		const res = await fetch(`${BASE}/`, { headers: this.htmlHeaders() });
		const html = await res.text();
		if (!res.ok || /just a moment|cf-challenge|challenge-platform/i.test(html) && html.length < 50000) {
			// soft: still try parse if series links present
			if (!/\/series\/[a-z0-9-]+/i.test(html)) {
				throw new Error(`FenrirRealm home HTML blocked (${res.status})`);
			}
		}
		return html;
	}

	/**
	 * Parse homepage cards. New Releases section appears after the heading;
	 * we collect unique /series/{slug} with nearby title + "N ch" badge.
	 */
	private parseHomeHtmlList(html: string): Manga[] {
		const $ = cheerio.load(html);
		const out: Manga[] = [];
		const seen = new Set<string>();

		// Build chapter count map from "123 ch" near each series link
		const latestBySlug = new Map<string, number>();
		const re = /\/series\/([a-z0-9-]+)[\s\S]{0,1200}?(\d+)\s*ch\b/gi;
		let m: RegExpExecArray | null;
		while ((m = re.exec(html)) !== null) {
			const slug = m[1];
			if (slug === 'ranking') continue;
			const n = parseInt(m[2], 10);
			if (!Number.isFinite(n)) continue;
			const prev = latestBySlug.get(slug);
			if (prev == null || n > prev) latestBySlug.set(slug, n);
		}

		$('a[href*="/series/"]').each((_: number, el: any) => {
			const href = $(el).attr('href') || '';
			const mm = href.match(/\/series\/([a-z0-9-]+)\/?$/i);
			if (!mm) return;
			const slug = mm[1];
			if (slug === 'ranking') return;
			const id = `/series/${slug}`;
			if (seen.has(id)) return;

			let title =
				cleanText($(el).attr('title') || '') ||
				cleanText($(el).find('h1,h2,h3,h4').first().text()) ||
				cleanText($(el).text());
			if (!title || title.length < 3) return;
			if (/^(read now|explore|add to|series|home)$/i.test(title)) return;
			// skip long blurbs mistaken as title
			if (title.length > 120) {
				title = title.slice(0, 120);
			}

			seen.add(id);
			let cover =
				$(el).find('img').attr('src') ||
				$(el).find('img').attr('data-src') ||
				$(el).closest('div').find('img').first().attr('src') ||
				'';
			cover = absUrl(cover);
			const latestChapter = latestBySlug.get(slug);

			out.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: 'Ongoing',
				...(latestChapter != null && latestChapter > 0 ? { latestChapter } : {})
			});
		});

		return out;
	}

	private mapCard(s: ApiSeriesCard, latestChapter?: number): Manga | null {
		if (!s?.slug || !s?.title) return null;
		const cover = absUrl(s.cover) || s.cover_data_url || '';
		const fromCard = Number((s as any).chapter_count ?? (s as any).chapters_count ?? 0);
		const ch = latestChapter != null && latestChapter > 0
			? latestChapter
			: fromCard > 0
				? fromCard
				: undefined;
		return {
			id: `/series/${s.slug}`,
			title: cleanText(s.title),
			cover,
			sourceId: this.id,
			type: 'novel',
			lang: 'en',
			status: normalizeStatus(s.status),
			...(ch != null && ch > 0 ? { latestChapter: ch } : {})
		};
	}

	/** Resolve Ch. badge from chapters list (API cards omit count). */
	private async attachLatestChapter(m: Manga): Promise<Manga> {
		const existing = Number(m.latestChapter ?? 0);
		if (existing > 0) return m;
		const slug = this.extractSeriesSlug(m.id);
		if (!slug) return m;
		try {
			const list = await this.apiGet<ApiChapter[]>(
				`/series/${encodeURIComponent(slug)}/chapters`
			);
			if (!Array.isArray(list) || !list.length) return m;
			let max = 0;
			for (const c of list) {
				const n = Number(c.number ?? c.index ?? 0) || 0;
				if (n > max) max = n;
			}
			if (max > 0) return { ...m, latestChapter: max };
		} catch {
			/* ignore */
		}
		return m;
	}

	private async attachLatestChapters(items: Manga[], concurrency = 6): Promise<Manga[]> {
		const out: Manga[] = new Array(items.length);
		let i = 0;
		const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
			while (i < items.length) {
				const idx = i++;
				out[idx] = await this.attachLatestChapter(items[idx]);
			}
		});
		await Promise.all(workers);
		return out;
	}

	// ── New Releases (homepage section) + paginated catalog ─────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		const pageNum = Math.max(1, page);

		if (pageNum === 1) {
			// 1) JSON home API (new_releases)
			try {
				const home = await this.apiGet<{
					new_releases?: ApiSeriesCard[];
					recently_updated?: ApiSeriesCard[];
				}>('/home');
				const ordered: Manga[] = [];
				const seen = new Set<string>();
				for (const list of [home.new_releases || [], home.recently_updated || []]) {
					for (const s of list) {
						const m = this.mapCard(s);
						if (!m || seen.has(m.id)) continue;
						seen.add(m.id);
						ordered.push(m);
					}
				}
				if (ordered.length) {
					return this.attachLatestChapters(ordered);
				}
			} catch (e) {
				console.warn('[FenrirRealm] home API failed, trying HTML', e);
			}

			// 2) Cloudflare-friendly: SSR homepage HTML
			try {
				const html = await this.fetchHomeHtml();
				const fromHtml = this.parseHomeHtmlList(html);
				if (fromHtml.length) {
					// badges may already be present from "N ch"; fill gaps
					return this.attachLatestChapters(fromHtml);
				}
			} catch (e) {
				console.warn('[FenrirRealm] home HTML failed', e);
			}
		}

		// Page 2+ / final fallback: series catalog API
		try {
			const data = await this.apiGet<{ data?: ApiSeriesCard[] }>(
				`/series?sort=latest&page=${pageNum}`
			);
			const out: Manga[] = [];
			for (const s of data.data || []) {
				const m = this.mapCard(s);
				if (m) out.push(m);
			}
			if (out.length) return this.attachLatestChapters(out);
		} catch (e) {
			console.warn('[FenrirRealm] series API failed', e);
		}

		// Last resort page 1 HTML again
		if (pageNum === 1) {
			const html = await this.fetchHomeHtml();
			return this.attachLatestChapters(this.parseHomeHtmlList(html));
		}
		return [];
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = query.trim();
		if (!q) return [];
		const page = Math.max(1, opts?.page ?? 1);
		// Public search path used by site: /search/{query}
		// API: try series list with search param variants
		const attempts = [
			`/series?sort=latest&page=${page}&search=${encodeURIComponent(q)}`,
			`/series?sort=latest&page=${page}&q=${encodeURIComponent(q)}`,
			`/series?page=${page}&search=${encodeURIComponent(q)}`
		];
		for (const path of attempts) {
			try {
				const data = await this.apiGet<{ data?: ApiSeriesCard[] }>(path);
				const list = (data.data || []).map((s) => this.mapCard(s)).filter(Boolean) as Manga[];
				if (list.length) {
					const ql = q.toLowerCase();
					const filtered = list.filter((m) => m.title.toLowerCase().includes(ql));
					return (filtered.length ? filtered : list).slice(0, 24);
				}
			} catch {
				/* next */
			}
		}
		// Fallback: filter page-1 new releases / latest
		const pool = await this.getLatestManga(1).catch(() => [] as Manga[]);
		const ql = q.toLowerCase();
		return pool.filter((m) => m.title.toLowerCase().includes(ql)).slice(0, 24);
	}

	// ── Details ─────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = this.extractSeriesSlug(mangaId);
		if (!slug) throw new Error(`FenrirRealm: invalid manga id ${mangaId}`);

		// Prefer JSON API; fall back to SSR page (seriesData embed) when CF blocks API
		try {
			const series = await this.apiGet<{
				title?: string;
				status?: string;
				description?: string;
				cover?: string;
				cover_data_url?: string;
				genres?: { name?: string }[];
				tags?: { name?: string }[];
				user?: { username?: string; name?: string };
			}>(`/series/${encodeURIComponent(slug)}`);

			const title = cleanText(series.title || slug);
			const cover = absUrl(series.cover) || series.cover_data_url || '';
			const description = stripHtmlToText(series.description || '');
			const authors: string[] = [];
			const authorName = series.user?.name || series.user?.username;
			if (authorName) authors.push(cleanText(authorName));
			const genres: string[] = [];
			for (const g of series.genres || []) {
				const n = cleanText(g.name || '');
				if (n && !genres.includes(n)) genres.push(n);
			}
			for (const tg of series.tags || []) {
				const n = cleanText(tg.name || '');
				if (n && !genres.includes(n)) genres.push(n);
			}
			const chapters = await this.fetchChapterList(slug);
			return {
				id: `/series/${slug}`,
				title,
				cover,
				sourceId: this.id,
				description,
				authors,
				status: normalizeStatus(series.status),
				genres: genres.slice(0, 30),
				chapters,
				type: 'novel',
				lang: 'en',
				...(chapters.length ? { latestChapter: chapters[0]?.number } : {})
			};
		} catch (apiErr) {
			console.warn('[FenrirRealm] detail API failed, trying HTML', apiErr);
		}

		return this.getMangaDetailsFromHtml(slug);
	}

	private async getMangaDetailsFromHtml(slug: string): Promise<MangaDetails> {
		const res = await fetch(`${BASE}/series/${encodeURIComponent(slug)}`, {
			headers: this.htmlHeaders()
		});
		const html = await res.text();
		if (!res.ok) throw new Error(`FenrirRealm: series page ${res.status}`);

		// seriesData:{title:"...",slug:"...",...} from SvelteKit payload
		const idx = html.indexOf('seriesData:');
		let title = slug;
		let status = 'Ongoing';
		let description = '';
		let cover = '';
		const authors: string[] = [];
		const genres: string[] = [];

		if (idx >= 0) {
			const chunk = html.slice(idx, idx + 25000);
			const t = chunk.match(/title:"((?:[^"\\]|\\.)*)"/);
			if (t) title = cleanText(JSON.parse(`"${t[1]}"`));
			const st = chunk.match(/status:"([^"]+)"/);
			if (st) status = normalizeStatus(st[1]);
			const cov = chunk.match(/cover:"([^"]+)"/);
			if (cov) cover = absUrl(cov[1]);
			const desc = chunk.match(/description:"((?:[^"\\]|\\.)*)"/);
			if (desc) {
				try {
					description = stripHtmlToText(JSON.parse(`"${desc[1]}"`));
				} catch {
					description = stripHtmlToText(desc[1]);
				}
			}
			const author = chunk.match(/user:\{username:"([^"]+)"(?:,name:"([^"]*)")?/);
			if (author) authors.push(cleanText(author[2] || author[1]));
			for (const gm of chunk.matchAll(/name:"([^"]+)",slug:"[^"]+"/g)) {
				const n = cleanText(gm[1]);
				if (n && n.length < 40 && !genres.includes(n)) genres.push(n);
			}
		} else {
			const $ = cheerio.load(html);
			title =
				cleanText($('h1').first().text()) ||
				cleanText($('meta[property="og:title"]').attr('content') || '').split(/[|\-–]/)[0].trim() ||
				slug;
			cover = absUrl($('meta[property="og:image"]').attr('content') || '');
			description = cleanText($('meta[property="og:description"]').attr('content') || '');
		}

		let chapters: Chapter[] = [];
		try {
			chapters = await this.fetchChapterList(slug);
		} catch {
			chapters = [];
		}

		if (!title) throw new Error(`FenrirRealm: empty detail for ${slug}`);

		return {
			id: `/series/${slug}`,
			title,
			cover,
			sourceId: this.id,
			description,
			authors,
			status,
			genres: genres.slice(0, 30),
			chapters,
			type: 'novel',
			lang: 'en',
			...(chapters.length ? { latestChapter: chapters[0]?.number } : {})
		};
	}

	private async fetchChapterList(seriesSlug: string): Promise<Chapter[]> {
		const list = await this.apiGet<ApiChapter[]>(
			`/series/${encodeURIComponent(seriesSlug)}/chapters`
		);
		if (!Array.isArray(list)) return [];

		const out: Chapter[] = [];
		const seen = new Set<string>();
		for (const ch of list) {
			const chSlug = String(ch.slug ?? ch.number ?? ch.id ?? '');
			if (!chSlug) continue;
			const id = `/series/${seriesSlug}/chapters/${chSlug}`;
			if (seen.has(id)) continue;
			seen.add(id);

			const num = Number(ch.number ?? ch.index ?? 0) || 0;
			const price = Number(ch.locked?.price ?? 0) || 0;
			const isLocked = price > 0;

			out.push({
				id,
				title: `Chapter ${num || chSlug}`,
				number: num,
				date: ch.created_at || ch.updated_at || undefined,
				...(isLocked ? { isLocked: true } : {})
			});
		}

		out.sort((a, b) => {
			if (b.number !== a.number) return b.number - a.number;
			return (b.id || '').localeCompare(a.id || '');
		});
		return out;
	}

	private extractSeriesSlug(mangaId: string): string {
		const s = mangaId.replace(/\/$/, '');
		const m = s.match(/\/series\/([a-z0-9-]+)/i) || s.match(/^([a-z0-9-]+)$/i);
		return m?.[1] || '';
	}

	private parseChapterId(chapterId: string): { seriesSlug: string; chapterSlug: string } {
		const path = chapterId.replace(/\/$/, '');
		const m = path.match(/\/series\/([a-z0-9-]+)\/chapters\/([^/]+)/i);
		if (m) return { seriesSlug: m[1], chapterSlug: m[2] };
		// fallback: only chapter slug (legacy)
		const m2 = path.match(/\/chapters\/([^/]+)/i);
		if (m2) return { seriesSlug: '', chapterSlug: m2[1] };
		return { seriesSlug: '', chapterSlug: path.replace(/^\//, '') };
	}

	// ── Chapter content ─────────────────────────────────────────────────────

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		const { seriesSlug, chapterSlug } = this.parseChapterId(chapterId);
		if (!chapterSlug) throw new Error(`FenrirRealm: invalid chapter id ${chapterId}`);

		let data: ApiChapter;
		if (seriesSlug) {
			data = await this.apiGet<ApiChapter>(
				`/series/${encodeURIComponent(seriesSlug)}/chapters/${encodeURIComponent(chapterSlug)}`
			);
		} else {
			// numeric id path
			data = await this.apiGet<ApiChapter>(`/chapters/${encodeURIComponent(chapterSlug)}`);
		}

		const price = Number(data.locked?.price ?? 0) || 0;
		if (price > 0 && !data.content) {
			throw new Error(
				`FenrirRealm: chapter locked (price ${price}) — ${chapterId}`
			);
		}

		const num = Number(data.number ?? 0) || 0;
		const title =
			cleanText(data.name || '') ||
			cleanText(data.title || '') ||
			(num ? `Chapter ${num}` : `Chapter ${chapterSlug}`);

		const html = sanitizeChapterHtml(data.content || '');
		if (html.length < 40) {
			throw new Error(`FenrirRealm: empty chapter body (${chapterId})`);
		}

		// Prev / next from chapter list when we know the series
		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		if (seriesSlug) {
			try {
				const list = await this.fetchChapterList(seriesSlug);
				// list is desc by number
				const idx = list.findIndex((c) => c.id.endsWith(`/chapters/${chapterSlug}`));
				if (idx >= 0) {
					// higher index = older = previous in reading order (asc)
					nextChapterId = idx > 0 ? list[idx - 1]?.id ?? null : null;
					prevChapterId = idx < list.length - 1 ? list[idx + 1]?.id ?? null : null;
				}
			} catch {
				/* ignore */
			}
		}

		return {
			title,
			content: html,
			prevChapterId,
			nextChapterId
		};
	}
}

export default FenrirRealmSource;
