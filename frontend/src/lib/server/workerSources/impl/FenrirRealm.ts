/**
 * Fenrir Realm (fenrirealm.com)
 * Path: scraper/src/sources/impl/FenrirRealm.ts
 *       frontend/.../workerSources/impl/FenrirRealm.ts
 *
 * Novel source — SvelteKit frontend + JSON API `/api/new/v2/...`
 *
 * FIX 2026-10:
 *   - API sering return content:"" + content_format:"locked" (bahkan free chapter)
 *     → fallback scrape HTML #reader-area / chapter-view
 *   - coba URL alt /series/{slug}/{chSlug} (tanpa /chapters/)
 *   - pesan locked yang jelas, bukan "Offline / unavailable"
 *   - return novelId untuk mark-as-read
 *   - chapter list lebih toleran (legacy /api/novels/chapter-list)
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types-manga';

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
		.replace(/[\u200b\u200c\u200d\ufeff]/g, '')
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

const UI_JUNK_RE =
	/highlights?\s+word\s+anchors|double-tap\s+the\s+text|floating\s+reading-quest|reading-quest\s+ring|sign\s+in\s+to\s+save|easier\s+tracking|hide\s+or\s+show\s+it|reader\s+settings|font\s+size|line\s+height|theme\s+mode|table\s+of\s+contents|please\s+support|join\s+(our\s+)?discord|buy\s+me\s+a\s+coffee|ko-?fi\.com|patreon\.com|read\s+on\s+fenri/i;

function isUiJunk(text: string): boolean {
	const t = cleanText(text);
	if (!t) return true;
	if (t.length < 25) return true;
	if (UI_JUNK_RE.test(t)) return true;
	if (t.length < 80 && /floating|anchor|quest ring|double-tap/i.test(t)) return true;
	return false;
}

function sanitizeChapterHtml(html: string): string {
	if (!html || !html.trim()) return '';
	const $ = cheerio.load(`<div id="root">${html || ''}</div>`);
	$('#root style, #root script, #root nav, #root header, #root footer').remove();
	$('#root [aria-hidden="true"]').remove();
	$('#root [class*="text-[11px]"], #root [class*="text-xs"], #root [data-slot]').remove();
	$('#root button, #root svg, #root input, #root label').remove();

	const parts: string[] = [];
	$('#root p').each((_: number, el: any) => {
		const t = cleanText($(el).text());
		if (!t || isUiJunk(t)) return;
		parts.push(`<p>${escapeHtml(t)}</p>`);
	});
	if (parts.length >= 2) return parts.join('\n');
	if (parts.length === 1 && parts[0].replace(/<[^>]+>/g, '').length >= 120) {
		return parts[0];
	}

	const raw = cleanText($('#root').text());
	if (!raw || raw.length < 80 || isUiJunk(raw)) return '';
	const lines = raw
		.split(/\n+/)
		.map((l) => l.trim())
		.filter((l) => l.length > 40 && !isUiJunk(l));
	if (lines.length < 2 && (lines[0]?.length || 0) < 200) return '';
	return lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('\n');
}

function extractContentFromChapterHtml(html: string): string {
	if (!html) return '';
	const $ = cheerio.load(html);

	const selectors = [
		'#reader-area .chapter-view .prose',
		'#reader-area .chapter-view [class*="content"]',
		'#reader-area .chapter-view article',
		'[data-chapter-id] .prose',
		'.chapter-content',
		'.chapter-body'
	];

	for (const sel of selectors) {
		const $el = $(sel).first();
		if (!$el.length) continue;
		const $clone = $el.clone();
		$clone
			.find(
				'script, style, nav, header, footer, button, svg, [aria-hidden="true"], [data-slot], [class*="text-[11px]"]'
			)
			.remove();
		const cleaned = sanitizeChapterHtml($clone.html() || '');
		const plainLen = cleaned.replace(/<[^>]+>/g, '').trim().length;
		if (plainLen >= 120) return cleaned;
	}

	const $view = $('#reader-area .chapter-view, [data-chapter-id]').first();
	if ($view.length) {
		const $clone = $view.clone();
		$clone
			.find(
				'script, style, nav, header, footer, button, svg, h1, h2, h3, [aria-hidden="true"], [data-slot], label, input, [class*="text-muted"], [class*="text-[11px]"], [class*="text-xs"]'
			)
			.remove();
		const cleaned = sanitizeChapterHtml($clone.html() || '');
		const plainLen = cleaned.replace(/<[^>]+>/g, '').trim().length;
		if (plainLen >= 120) return cleaned;
	}

	return '';
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
	uuid?: string;
	slug?: string;
	name?: string;
	title?: string | null;
	number?: number;
	index?: number;
	locked?: { price?: number; unlocked_at?: string | null; is_read_only?: boolean };
	created_at?: string;
	updated_at?: string;
	content?: string;
	content_format?: string;
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
		if (
			!res.ok ||
			text.trimStart().startsWith('<!DOCTYPE') ||
			text.trimStart().startsWith('<html')
		) {
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

	private async fetchHtmlPage(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
		const res = await fetch(url, { headers: this.htmlHeaders() });
		const html = await res.text();
		if (!res.ok) throw new Error(`FenrirRealm HTML ${res.status} ${path}`);
		return html;
	}

	private async fetchHomeHtml(): Promise<string> {
		const html = await this.fetchHtmlPage('/');
		if (
			/just a moment|cf-challenge|challenge-platform/i.test(html) &&
			html.length < 50000 &&
			!/\/series\/[a-z0-9-]+/i.test(html)
		) {
			throw new Error(`FenrirRealm home HTML blocked`);
		}
		return html;
	}

	private parseHomeHtmlList(html: string): Manga[] {
		const $ = cheerio.load(html);
		const out: Manga[] = [];
		const seen = new Set<string>();

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
			if (title.length > 120) title = title.slice(0, 120);

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
		const ch =
			latestChapter != null && latestChapter > 0
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
			const list = await this.fetchChapterList(slug);
			if (!list.length) return m;
			const max = Math.max(...list.map((c) => Number(c.number) || 0));
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
				if (ordered.length) return this.attachLatestChapters(ordered);
			} catch (e) {
				console.warn('[FenrirRealm] home API failed, trying HTML', e);
			}

			try {
				const html = await this.fetchHomeHtml();
				const fromHtml = this.parseHomeHtmlList(html);
				if (fromHtml.length) return this.attachLatestChapters(fromHtml);
			} catch (e) {
				console.warn('[FenrirRealm] home HTML failed', e);
			}
		}

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

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = this.extractSeriesSlug(mangaId);
		if (!slug) throw new Error(`FenrirRealm: invalid manga id ${mangaId}`);

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
		const html = await this.fetchHtmlPage(`/series/${encodeURIComponent(slug)}`);

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
				cleanText($('meta[property="og:title"]').attr('content') || '')
					.split(/[|\-–]/)[0]
					.trim() ||
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
		// Primary: new API
		try {
			const list = await this.apiGet<ApiChapter[]>(
				`/series/${encodeURIComponent(seriesSlug)}/chapters`
			);
			if (Array.isArray(list) && list.length) {
				return this.mapChapterList(seriesSlug, list);
			}
		} catch (e) {
			console.warn('[FenrirRealm] chapters API failed', e);
		}

		try {
			const res = await fetch(
				`${BASE}/api/novels/chapter-list/${encodeURIComponent(seriesSlug)}`,
				{ headers: { ...this.headers, Accept: 'application/json', Referer: `${BASE}/` } }
			);
			const text = await res.text();
			if (res.ok && !text.trimStart().startsWith('<')) {
				const list = JSON.parse(text) as ApiChapter[];
				if (Array.isArray(list) && list.length) {
					return this.mapChapterList(seriesSlug, list);
				}
			}
		} catch (e) {
			console.warn('[FenrirRealm] legacy chapter-list failed', e);
		}

		return [];
	}

	private mapChapterList(seriesSlug: string, list: ApiChapter[]): Chapter[] {
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
		let m = path.match(/\/series\/([a-z0-9-]+)\/chapters\/([^/]+)/i);
		if (m) return { seriesSlug: m[1], chapterSlug: m[2] };
		m = path.match(/\/series\/([a-z0-9-]+)\/([^/]+)$/i);
		if (m && m[2] !== 'chapters') return { seriesSlug: m[1], chapterSlug: m[2] };
		m = path.match(/\/chapters\/([^/]+)/i);
		if (m) return { seriesSlug: '', chapterSlug: m[1] };
		return { seriesSlug: '', chapterSlug: path.replace(/^\//, '') };
	}

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
		novelId?: string | null;
	}> {
		const { seriesSlug, chapterSlug } = this.parseChapterId(chapterId);
		if (!chapterSlug) throw new Error(`FenrirRealm: invalid chapter id ${chapterId}`);

		let data: ApiChapter | null = null;
		let apiErr: unknown = null;

		// 1) JSON API
		try {
			if (seriesSlug) {
				data = await this.apiGet<ApiChapter>(
					`/series/${encodeURIComponent(seriesSlug)}/chapters/${encodeURIComponent(chapterSlug)}`
				);
			} else {
				data = await this.apiGet<ApiChapter>(`/chapters/${encodeURIComponent(chapterSlug)}`);
			}
		} catch (e) {
			apiErr = e;
			console.warn('[FenrirRealm] chapter API failed', e);
		}

		const price = Number(data?.locked?.price ?? 0) || 0;
		const format = String(data?.content_format || '');
		let body = String(data?.content || '');

		if ((!body || body.length < 40) && seriesSlug) {
			const htmlPaths = [
				`/series/${encodeURIComponent(seriesSlug)}/chapters/${encodeURIComponent(chapterSlug)}`,
				`/series/${encodeURIComponent(seriesSlug)}/${encodeURIComponent(chapterSlug)}`
			];
			for (const hp of htmlPaths) {
				try {
					const html = await this.fetchHtmlPage(hp);
					const extracted = extractContentFromChapterHtml(html);
					if (extracted && extracted.replace(/<[^>]+>/g, '').trim().length >= 80) {
						body = extracted;
						break;
					}
				} catch (e) {
					console.warn('[FenrirRealm] HTML fallback failed', hp, e);
				}
			}
		}

		const num = Number(data?.number ?? 0) || 0;
		const title =
			cleanText(data?.name || '') ||
			cleanText(data?.title || '') ||
			(num ? `Chapter ${num}` : `Chapter ${chapterSlug}`);

		let html = body.startsWith('<') ? sanitizeChapterHtml(body) : sanitizeChapterHtml(`<p>${body}</p>`);
		if (!html || html.replace(/<[^>]+>/g, '').trim().length < 40) {
			// Paid lock
			if (price > 0) {
				html = `<p><em>Chapter terkunci (Rune ${price}). Buka di fenrirealm.com.</em></p>`;
			} else if (format === 'locked' || !body) {
				html = `<p><em>Konten chapter tidak tersedia via API (content_format=locked). Fenrir Realm memblokir body chapter untuk request non-browser. Coba buka di situs asli, atau jalankan source lewat scraper + Byparr.</em></p>${
					apiErr ? `<p><small>${escapeHtml(String(apiErr).slice(0, 200))}</small></p>` : ''
				}`;
			} else {
				html = `<p><em>Konten chapter kosong (${chapterId}).</em></p>`;
			}
		}

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		const novelId = seriesSlug ? `/series/${seriesSlug}` : null;

		if (seriesSlug) {
			try {
				const list = await this.fetchChapterList(seriesSlug);
				const idx = list.findIndex(
					(c) =>
						c.id.endsWith(`/chapters/${chapterSlug}`) ||
						c.id.endsWith(`/${chapterSlug}`)
				);
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
			nextChapterId,
			novelId
		};
	}
}

export default FenrirRealmSource;
