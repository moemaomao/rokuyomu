/**
 * DasuiTL (dasuitl.com) — WordPress GeneratePress novel TL
 * Path: scraper/src/sources/impl/novel/DasuiTL.ts
 *
 * Architecture:
 *   - Series  = child categories of parent 12 (WN), ~162 series
 *   - Chapters = WP posts in that category
 *   - URL     = /wn/{series-slug}/{episode-slug}/
 *   - Content = post content.rendered  OR  .entry-content
 *   - REST:
 *       /wp-json/wp/v2/categories?parent=12
 *       /wp-json/wp/v2/posts?categories={id}&per_page=100&page=N
 *       /wp-json/wp/v2/posts?per_page=24&page=N  (latest / search)
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://dasuitl.com';
const WN_PARENT = 12;
const PAGE_SIZE = 24;

function absUrl(href: string | undefined | null): string {
	if (!href) return '';
	const h = String(href).trim();
	if (!h) return '';
	if (h.startsWith('//')) return `https:${h}`;
	if (/^https?:\/\//i.test(h)) return h;
	try {
		return new URL(h.startsWith('/') ? h : `/${h}`, BASE).href;
	} catch {
		return h;
	}
}

function pathOnly(href: string): string {
	try {
		const u = new URL(href.startsWith('http') ? href : absUrl(href));
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		const p = href.startsWith('/') ? href : `/${href}`;
		return p.replace(/\/$/, '') || '/';
	}
}

function cleanText(s: string): string {
	return (s || '')
		.replace(/<[^>]+>/g, '')
		.replace(/\u00a0/g, ' ')
		.replace(/&#8217;/g, "'")
		.replace(/&#8216;/g, "'")
		.replace(/&#8220;/g, '"')
		.replace(/&#8221;/g, '"')
		.replace(/&#8211;/g, '–')
		.replace(/&#8212;/g, '—')
		.replace(/&#8230;/g, '…')
		.replace(/&#038;/g, '&')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/\s+/g, ' ')
		.trim();
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function decodeEntities(s: string): string {
	return (s || '')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#8217;/g, "'")
		.replace(/&#8216;/g, "'")
		.replace(/&#8220;/g, '"')
		.replace(/&#8221;/g, '"')
		.replace(/&#8230;/g, '…')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
		.replace(/&nbsp;/g, ' ');
}

function parseChapterNumber(text: string, fallback = 0): number {
	const t = cleanText(text);
	if (/prologue/i.test(t) && !/\d/.test(t)) return 0;
	if (/epilogue/i.test(t) && !/\d/.test(t)) return 9999;
	const m =
		t.match(/(?:episode|chapter|ch\.?|ep\.?)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function shortChapterTitle(n: number, raw?: string): string {
	const r = raw || '';
	if (/prologue/i.test(r) && !(n > 0)) return 'Prologue';
	if (/epilogue/i.test(r)) return n > 0 && n < 9000 ? `Epilogue` : 'Epilogue';
	if (/side/i.test(r)) {
		const m = r.match(/side\s*(\d+)/i);
		return m ? `Side ${m[1]}` : 'Side';
	}
	if (n > 0 && n < 9000) {
		return Number.isInteger(n) ? `Chapter ${n}` : `Chapter ${n}`;
	}
	return 'Chapter';
}

function seriesPathFromHref(href: string): string | null {
	const p = pathOnly(href);
	const m = p.match(/^(\/wn\/[^/]+)/);
	if (m) return m[1];
	const m2 = p.match(/^\/category\/wn\/([^/]+)/);
	if (m2) return `/wn/${m2[1]}`;
	return null;
}

type WpCategory = {
	id: number;
	count: number;
	description?: string;
	link?: string;
	name?: string;
	slug?: string;
	parent?: number;
};

type WpPost = {
	id: number;
	date?: string;
	slug?: string;
	link?: string;
	title?: { rendered?: string };
	content?: { rendered?: string; protected?: boolean };
	excerpt?: { rendered?: string };
	categories?: number[];
	_embedded?: {
		['wp:featuredmedia']?: Array<{ source_url?: string }>;
		['wp:term']?: Array<Array<{ id?: number; name?: string; slug?: string; taxonomy?: string }>>;
	};
};

export class DasuiTLSource extends BaseSource {
	id = 'dasuitl';
	name = 'DasuiTL';
	baseUrl = BASE;

	kind = 'novel' as const;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'application/json, text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	private async wpJson<T>(
		url: string
	): Promise<{ data: T; total: number; totalPages: number }> {
		const res = await fetch(url, {
			headers: { ...this.headers, Accept: 'application/json' }
		});
		if (!res.ok) {
			throw new Error(`DasuiTL API ${res.status}: ${url}`);
		}
		const total = parseInt(res.headers.get('X-WP-Total') || '0', 10);
		const totalPages = parseInt(res.headers.get('X-WP-TotalPages') || '0', 10);
		const data = (await res.json()) as T;
		return { data, total, totalPages };
	}

	// ─── Latest (24 unique series) ───────────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		return this.getLatestNovels(page);
	}

	async getLatestNovels(page = 1): Promise<Manga[]> {
		const pageNum = Math.max(1, page);
		const need = pageNum * PAGE_SIZE;
		const seen = new Set<string>();
		const ordered: Manga[] = [];

		let apiPage = 1;
		const maxApiPages = pageNum * 4 + 2;

		while (ordered.length < need && apiPage <= maxApiPages) {
			const { data, totalPages } = await this.wpJson<WpPost[]>(
				`${BASE}/wp-json/wp/v2/posts?per_page=50&page=${apiPage}&orderby=date&order=desc&_embed=1&_fields=id,date,link,title,categories,_embedded`
			);
			if (!Array.isArray(data) || !data.length) break;

			for (const post of data) {
				const seriesId = seriesPathFromHref(post.link || '');
				if (!seriesId || seen.has(seriesId)) continue;
				seen.add(seriesId);

				const seriesTitle = this.seriesTitleFromPost(post, seriesId);
				const rawCh = cleanText(decodeEntities(post.title?.rendered || ''));
				const latestChapter = parseChapterNumber(rawCh, 0) || undefined;
				const cover =
					absUrl(
						post._embedded?.['wp:featuredmedia']?.[0]?.source_url || ''
					).split('?')[0] || '';

				ordered.push({
					id: seriesId,
					title: seriesTitle,
					cover,
					sourceId: this.id,
					type: 'novel',
					status: 'Ongoing',
					lang: 'en',
					...(latestChapter ? { latestChapter } : {})
				});
				if (ordered.length >= need) break;
			}

			if (apiPage >= totalPages) break;
			apiPage += 1;
		}

		const start = (pageNum - 1) * PAGE_SIZE;
		const slice = ordered.slice(start, start + PAGE_SIZE);

		if (slice.length < PAGE_SIZE && pageNum === 1) {
			const fromCats = await this.listSeriesFromCategories(1);
			for (const m of fromCats) {
				if (seen.has(m.id)) continue;
				seen.add(m.id);
				slice.push(m);
				if (slice.length >= PAGE_SIZE) break;
			}
		}

		return slice.slice(0, PAGE_SIZE);
	}

	private seriesTitleFromPost(post: WpPost, seriesId: string): string {
		const terms = post._embedded?.['wp:term']?.flat() || [];
		for (const t of terms) {
			if (t?.taxonomy === 'category' && t.name && t.slug) {
				const path = `/wn/${t.slug}`;
				if (seriesId.includes(t.slug) || path === seriesId) {
					return cleanText(t.name);
				}
			}
		}
		const slug = seriesId.replace(/^\/wn\//, '');
		return slug
			.split('-')
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join(' ')
			.slice(0, 200);
	}

	private async listSeriesFromCategories(page: number): Promise<Manga[]> {
		const { data } = await this.wpJson<WpCategory[]>(
			`${BASE}/wp-json/wp/v2/categories?parent=${WN_PARENT}&per_page=${PAGE_SIZE}&page=${page}&orderby=count&order=desc`
		);
		return (Array.isArray(data) ? data : [])
			.filter((c) => (c.count || 0) > 0 && c.slug)
			.map((c) => ({
				id: `/wn/${c.slug}`,
				title: cleanText(c.name || c.slug || ''),
				cover: '',
				sourceId: this.id,
				type: 'novel' as const,
				status: 'Ongoing',
				lang: 'en',
				latestChapter: c.count || undefined
			}));
	}

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = query.trim();
		if (!q) return [];
		const page = opts?.page ?? 1;

		try {
			const { data: cats } = await this.wpJson<WpCategory[]>(
				`${BASE}/wp-json/wp/v2/categories?parent=${WN_PARENT}&per_page=100&search=${encodeURIComponent(q)}`
			);
			const matched = (Array.isArray(cats) ? cats : []).filter(
				(c) => (c.count || 0) > 0 && c.slug
			);
			if (matched.length) {
				const start = (Math.max(1, page) - 1) * PAGE_SIZE;
				return matched.slice(start, start + PAGE_SIZE).map((c) => ({
					id: `/wn/${c.slug}`,
					title: cleanText(c.name || c.slug || ''),
					cover: '',
					sourceId: this.id,
					type: 'novel' as const,
					status: 'Ongoing',
					lang: 'en',
					latestChapter: c.count || undefined
				}));
			}
		} catch {
		}

		const seen = new Set<string>();
		const list: Manga[] = [];
		const { data: posts } = await this.wpJson<WpPost[]>(
			`${BASE}/wp-json/wp/v2/posts?search=${encodeURIComponent(q)}&per_page=50&page=${page}&_embed=1&_fields=id,link,title,categories,_embedded`
		);
		for (const post of Array.isArray(posts) ? posts : []) {
			const seriesId = seriesPathFromHref(post.link || '');
			if (!seriesId || seen.has(seriesId)) continue;
			seen.add(seriesId);
			list.push({
				id: seriesId,
				title: this.seriesTitleFromPost(post, seriesId),
				cover: absUrl(
					post._embedded?.['wp:featuredmedia']?.[0]?.source_url || ''
				).split('?')[0],
				sourceId: this.id,
				type: 'novel',
				status: 'Ongoing',
				lang: 'en'
			});
			if (list.length >= PAGE_SIZE) break;
		}
		return list;
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let seriesPath = pathOnly(mangaId);
		if (!seriesPath.startsWith('/wn/')) {
			const m = seriesPath.match(/([^/]+)$/);
			seriesPath = m ? `/wn/${m[1]}` : seriesPath;
		}
		const slug = seriesPath.replace(/^\/wn\//, '').replace(/\/$/, '');
		if (!slug) throw new Error('Invalid series id');

		let cat: WpCategory | null = null;
		try {
			const { data } = await this.wpJson<WpCategory[]>(
				`${BASE}/wp-json/wp/v2/categories?slug=${encodeURIComponent(slug)}`
			);
			if (Array.isArray(data) && data[0]) cat = data[0];
		} catch {
		}

		if (!cat) {
			const short = slug.slice(0, 40);
			try {
				const { data } = await this.wpJson<WpCategory[]>(
					`${BASE}/wp-json/wp/v2/categories?parent=${WN_PARENT}&per_page=100&search=${encodeURIComponent(short)}`
				);
				const hit = (Array.isArray(data) ? data : []).find(
					(c) =>
						c.slug === slug ||
						slug.startsWith(c.slug || '') ||
						(c.slug || '').startsWith(slug.slice(0, 30))
				);
				if (hit) cat = hit;
			} catch {
			}
		}

		const title = cleanText(cat?.name || slug.replace(/-/g, ' '));
		const description = cleanText(
			decodeEntities((cat?.description || '').replace(/<[^>]+>/g, ' '))
		);

		let cover = '';
		let chapters: Chapter[] = [];

		if (cat?.id) {
			chapters = await this.fetchAllChapters(cat.id);
			try {
				const { data } = await this.wpJson<WpPost[]>(
					`${BASE}/wp-json/wp/v2/posts?categories=${cat.id}&per_page=1&orderby=date&order=desc&_embed=1&_fields=id,_embedded,link`
				);
				cover =
					absUrl(
						data?.[0]?._embedded?.['wp:featuredmedia']?.[0]?.source_url || ''
					).split('?')[0] || '';
				const fromPost = seriesPathFromHref(data?.[0]?.link || '');
				if (fromPost) seriesPath = fromPost;
			} catch {
			}
		} else {
			chapters = await this.fetchChaptersBySeriesPath(seriesPath);
		}

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		return {
			id: seriesPath,
			title,
			cover,
			sourceId: this.id,
			description,
			authors: [],
			status: 'Ongoing',
			genres: ['Web Novel'],
			chapters,
			type: 'novel',
			lang: 'en',
			latestChapter:
				chapters[0] && chapters[0].number < 9000
					? chapters[0].number
					: chapters.length || cat?.count || undefined
		};
	}

	private async fetchAllChapters(catId: number): Promise<Chapter[]> {
		const out: Chapter[] = [];
		const seen = new Set<string>();
		let page = 1;
		let totalPages = 1;

		while (page <= totalPages && page <= 40) {
			const { data, totalPages: tp } = await this.wpJson<WpPost[]>(
				`${BASE}/wp-json/wp/v2/posts?categories=${catId}&per_page=100&page=${page}&orderby=date&order=asc&_fields=id,date,link,title,slug,content`
			);
			totalPages = tp || 1;
			if (!Array.isArray(data) || !data.length) break;

			for (const post of data) {
				const id = pathOnly(post.link || '');
				if (!id || seen.has(id)) continue;
				seen.add(id);

				const raw = cleanText(decodeEntities(post.title?.rendered || ''));
				const num = parseChapterNumber(raw || post.slug || '', out.length + 1);
				const date = post.date ? post.date.slice(0, 10) : undefined;
				const locked = !!post.content?.protected;

				out.push({
					id,
					title: shortChapterTitle(num, raw),
					number: num > 0 ? num : out.length + 1,
					...(date ? { date } : {}),
					...(locked ? { isLocked: true } : {})
				});
			}
			page += 1;
		}

		return out;
	}

	private async fetchChaptersBySeriesPath(seriesPath: string): Promise<Chapter[]> {
		const out: Chapter[] = [];
		const seen = new Set<string>();
		const slug = seriesPath.replace(/^\/wn\//, '');
		for (let page = 1; page <= 10; page++) {
			const { data, totalPages } = await this.wpJson<WpPost[]>(
				`${BASE}/wp-json/wp/v2/posts?search=${encodeURIComponent(slug.slice(0, 40))}&per_page=100&page=${page}&orderby=date&order=asc&_fields=id,date,link,title,slug,content`
			);
			if (!Array.isArray(data) || !data.length) break;
			for (const post of data) {
				const id = pathOnly(post.link || '');
				if (!id.includes(seriesPath) && !id.includes(`/wn/${slug}`)) continue;
				if (seen.has(id)) continue;
				seen.add(id);
				const raw = cleanText(decodeEntities(post.title?.rendered || ''));
				const num = parseChapterNumber(raw, out.length + 1);
				out.push({
					id,
					title: shortChapterTitle(num, raw),
					number: num > 0 ? num : out.length + 1,
					...(post.date ? { date: post.date.slice(0, 10) } : {}),
					...(post.content?.protected ? { isLocked: true } : {})
				});
			}
			if (page >= totalPages) break;
		}
		return out;
	}

	// ─── Chapter content ─────────────────────────────────────────────────

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		let path = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
		path = path.replace(/\/$/, '');
		const slug = path.split('/').filter(Boolean).pop() || '';

		let post: WpPost | null = null;
		if (slug) {
			try {
				const { data } = await this.wpJson<WpPost[]>(
					`${BASE}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&_fields=id,slug,link,title,content,date`
				);
				if (Array.isArray(data) && data[0]) post = data[0];
			} catch {
			}
		}

		const rawTitle = cleanText(
			decodeEntities(post?.title?.rendered || '') || slug
		);
		const num = parseChapterNumber(rawTitle, 0);
		const title = shortChapterTitle(num, rawTitle);

		if (post?.content?.protected) {
			return {
				title,
				content: '<p>This chapter is password-protected on DasuiTL.</p>',
				prevChapterId: null,
				nextChapterId: null
			};
		}

		let content = '';
		const rendered = post?.content?.rendered || '';
		if (rendered.length > 80) {
			content = this.htmlToParagraphs(rendered);
		}

		if (!content || content.length < 60) {
			const html = await this.fetchHtml(`${BASE}${path}/`);
			const $ = cheerio.load(html);
			if ($('form.post-password-form, .post-password-form').length) {
				return {
					title,
					content: '<p>This chapter is password-protected on DasuiTL.</p>',
					prevChapterId: null,
					nextChapterId: null
				};
			}
			const el = $('.entry-content, .post-content, article .content').first();
			el.find(
				'script, style, noscript, .sharedaddy, .jp-relatedposts, .comments-area, #comments, .nav-links, .post-navigation, .code-block, .adsbygoogle'
			).remove();
			content = this.htmlToParagraphs(el.html() || el.text() || '');
		}

		if (!content || content.length < 40) {
			content = '<p>Content not available.</p>';
		}

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		const seriesId = seriesPathFromHref(path);

		if (post?.id && seriesId) {
			try {
				const seriesSlug = seriesId.replace(/^\/wn\//, '');
				const { data: cats } = await this.wpJson<WpCategory[]>(
					`${BASE}/wp-json/wp/v2/categories?slug=${encodeURIComponent(seriesSlug)}`
				);
				const catId = cats?.[0]?.id;
				if (catId) {
					const { data: siblings } = await this.wpJson<WpPost[]>(
						`${BASE}/wp-json/wp/v2/posts?categories=${catId}&per_page=100&orderby=date&order=asc&_fields=id,link,slug`
					);
					if (Array.isArray(siblings)) {
						const idx = siblings.findIndex(
							(s) => pathOnly(s.link || '') === path || s.slug === slug
						);
						if (idx > 0) prevChapterId = pathOnly(siblings[idx - 1].link || '');
						if (idx >= 0 && idx < siblings.length - 1) {
							nextChapterId = pathOnly(siblings[idx + 1].link || '');
						}
					}
				}
			} catch {
			}
		}

		return {
			title,
			content,
			prevChapterId,
			nextChapterId
		};
	}

	private htmlToParagraphs(html: string): string {
		const $ = cheerio.load(`<div id="root">${html}</div>`);
		$('#root')
			.find(
				'script, style, noscript, iframe, .wp-block-pullquote, figure.wp-block-pullquote'
			)
			.remove();

		const parts: string[] = [];
		$('#root')
			.find('p, h2, h3, blockquote, li')
			.each((_, el) => {
				const tag = ((el as any).tagName || (el as any).name || '').toLowerCase();
				const t = cleanText(decodeEntities($(el).text()));
				if (!t || t.length < 1) return;
				if (/^source$/i.test(t)) return;
				if (/^https?:\/\//i.test(t) && t.length < 120) return;
				if (/kakuyomu\.jp|syosetu\.com/i.test(t) && t.length < 150) return;
				if (/^categories\s*:/i.test(t)) return;
				if (/^share this|^leave a reply|^related posts/i.test(t)) return;
				if (/ko-fi\.com|saweria\.co|donate/i.test(t) && t.length < 100) return;
				if (tag === 'h2' || tag === 'h3') {
					parts.push(`<h3>${escapeHtml(t)}</h3>`);
				} else {
					parts.push(`<p>${escapeHtml(t)}</p>`);
				}
			});

		if (parts.length) return parts.join('\n');

		const plain = cleanText(decodeEntities($.root().text()));
		if (!plain) return '';
		return plain
			.split(/\n{2,}/)
			.map((s) => s.trim())
			.filter((s) => s.length > 1)
			.map((s) => `<p>${escapeHtml(s)}</p>`)
			.join('\n');
	}
}

export default DasuiTLSource;
