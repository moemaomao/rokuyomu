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

function sanitizeChapterHtml(html: string): string {
	const $ = cheerio.load(`<div id="root">${html || ''}</div>`);
	$('#root style, #root script').remove();
	$('#root [aria-hidden="true"]').remove();
	
	const parts: string[] = [];
	$('#root p').each((_: number, el: any) => {
		const t = cleanText($(el).text());
		if (t) parts.push(`<p>${escapeHtml(t)}</p>`);
	});
	if (parts.length) return parts.join('\n');

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
		Origin: BASE
	};

	private async apiGet<T = unknown>(path: string): Promise<T> {
		const url = path.startsWith('http') ? path : `${API}${path.startsWith('/') ? path : `/${path}`}`;
		const res = await fetch(url, { headers: this.headers });
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			throw new Error(`FenrirRealm API ${res.status} ${path} ${body.slice(0, 120)}`);
		}
		return (await res.json()) as T;
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
				console.warn('[FenrirRealm] home failed', e);
			}
		}

		const data = await this.apiGet<{ data?: ApiSeriesCard[]; meta?: { current_page?: number } }>(
			`/series?sort=latest&page=${pageNum}`
		);
		const out: Manga[] = [];
		for (const s of data.data || []) {
			const m = this.mapCard(s);
			if (m) out.push(m);
		}
		return this.attachLatestChapters(out);
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = query.trim();
		if (!q) return [];
		const page = Math.max(1, opts?.page ?? 1);
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
	
		const pool = await this.getLatestManga(1).catch(() => [] as Manga[]);
		const ql = q.toLowerCase();
		return pool.filter((m) => m.title.toLowerCase().includes(ql)).slice(0, 24);
	}

	// ── Details ─────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = this.extractSeriesSlug(mangaId);
		if (!slug) throw new Error(`FenrirRealm: invalid manga id ${mangaId}`);

		const series = await this.apiGet<{
			id?: number;
			title?: string;
			slug?: string;
			status?: string;
			description?: string;
			cover?: string;
			cover_data_url?: string;
			genres?: { name?: string; slug?: string }[];
			tags?: { name?: string; slug?: string }[];
			user?: { username?: string; name?: string };
			content_rating?: string;
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
		for (const t of series.tags || []) {
			const n = cleanText(t.name || '');
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

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		if (seriesSlug) {
			try {
				const list = await this.fetchChapterList(seriesSlug);
				const idx = list.findIndex((c) => c.id.endsWith(`/chapters/${chapterSlug}`));
				if (idx >= 0) {
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
