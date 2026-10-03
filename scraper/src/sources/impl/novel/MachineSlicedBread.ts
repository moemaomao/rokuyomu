/**
 * Machine Sliced Bread (machineslicedbread.xyz)
 * Path: scraper/src/sources/impl/novel/MachineSlicedBread.ts
 *
 * WordPress — JP adult web novel fan translations (+ some originals).
 *
 * Architecture:
 *   - Series  = child categories of parent 3 (web-novel-translation)
 *               + parent 6 (original)  → enough titles for 24/page
 *   - Chapters = WP **pages** under series parent page (/{slug}/{slug}-cN/)
 *               Category **posts** are teasers that only link to those pages
 *   - Content  = page content.rendered  OR  .entry-content on page HTML
 *   - REST:
 *       /wp-json/wp/v2/categories?parent={3|6}
 *       /wp-json/wp/v2/pages?slug={series}
 *       /wp-json/wp/v2/pages?parent={pageId}&per_page=100&page=N
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://machineslicedbread.xyz';
const PARENT_IDS = [3, 6];
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
	if (/prologue/i.test(t)) return 0;
	if (/epilogue/i.test(t)) return 9999;
	const m =
		t.match(/(?:chapter|ch\.?|c)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/(?:^|[-_/])c(\d+(?:\.\d+)?)(?:[-_/]|$)/i) ||
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
	if (/epilogue/i.test(r)) return 'Epilogue';
	if (/side/i.test(r)) {
		const m = r.match(/side\s*(\d+)/i);
		return m ? `Side ${m[1]}` : 'Side';
	}
	if (n > 0 && n < 9000) {
		return Number.isInteger(n) ? `Chapter ${n}` : `Chapter ${n}`;
	}
	return 'Chapter';
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

type WpPage = {
	id: number;
	date?: string;
	slug?: string;
	link?: string;
	title?: { rendered?: string };
	content?: { rendered?: string; protected?: boolean };
	parent?: number;
};

type WpPost = {
	id: number;
	date?: string;
	slug?: string;
	link?: string;
	title?: { rendered?: string };
	content?: { rendered?: string; protected?: boolean };
	categories?: number[];
	_embedded?: {
		['wp:featuredmedia']?: Array<{ source_url?: string }>;
	};
};

export class MachineSlicedBreadSource extends BaseSource {
	id = 'machineslicedbread';
	name = 'Machine Sliced Bread';
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
			throw new Error(`MSB API ${res.status}: ${url}`);
		}
		const total = parseInt(res.headers.get('X-WP-Total') || '0', 10);
		const totalPages = parseInt(res.headers.get('X-WP-TotalPages') || '0', 10);
		const data = (await res.json()) as T;
		return { data, total, totalPages };
	}

	// ─── Series list (latest / homepage) ─────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		return this.getLatestNovels(page);
	}

	async getLatestNovels(page = 1): Promise<Manga[]> {
		const active = await this.fetchAllActiveSeries();
		const pageNum = Math.max(1, page);
		const start = (pageNum - 1) * PAGE_SIZE;
		const slice = active.slice(start, start + PAGE_SIZE);

		const list: Manga[] = slice.map((c) => ({
			id: this.categoryToId(c),
			title: cleanText(c.name || c.slug || 'Unknown'),
			cover: '',
			sourceId: this.id,
			type: 'novel',
			status: 'Ongoing',
			lang: 'en',
			latestChapter: c.count || undefined
		}));

		await Promise.all(
			list.map(async (m, i) => {
				const cat = slice[i];
				if (!cat) return;
				try {
					const cover = await this.fetchCategoryCover(cat.id, cat.slug || '');
					if (cover) m.cover = cover;
				} catch {
				}
			})
		);

		return list;
	}

	private async fetchAllActiveSeries(): Promise<WpCategory[]> {
		const all: WpCategory[] = [];
		const seen = new Set<number>();

		for (const parent of PARENT_IDS) {
			try {
				const { data } = await this.wpJson<WpCategory[]>(
					`${BASE}/wp-json/wp/v2/categories?parent=${parent}&per_page=100&orderby=count&order=desc`
				);
				for (const c of Array.isArray(data) ? data : []) {
					if (!c.slug || seen.has(c.id)) continue;
					if ((c.count || 0) <= 0) continue;
					seen.add(c.id);
					all.push(c);
				}
			} catch {
			}
		}

		all.sort((a, b) => (b.count || 0) - (a.count || 0));
		return all;
	}

	private categoryToId(c: WpCategory): string {
		const parentSlug = c.parent === 6 ? 'original' : 'web-novel-translation';
		return `/category/${parentSlug}/${c.slug}`;
	}

	private parseCategoryId(mangaId: string): { slug: string } | null {
		const path = pathOnly(mangaId);
		const m = path.match(/\/category\/(?:web-novel-translation|original)\/([^/]+)/);
		if (m) return { slug: m[1] };
		const bare = path.replace(/^\//, '');
		if (bare && !bare.includes('/')) return { slug: bare };
		return null;
	}

	private async fetchCategoryBySlug(slug: string): Promise<WpCategory | null> {
		const { data } = await this.wpJson<WpCategory[]>(
			`${BASE}/wp-json/wp/v2/categories?slug=${encodeURIComponent(slug)}`
		);
		if (Array.isArray(data) && data[0]) return data[0];
		return null;
	}

	private async fetchCategoryCover(catId: number, slug: string): Promise<string> {
		try {
			const { data } = await this.wpJson<WpPost[]>(
				`${BASE}/wp-json/wp/v2/posts?categories=${catId}&per_page=1&_embed=1&orderby=date&order=desc&_fields=id,_embedded`
			);
			const media = data?.[0]?._embedded?.['wp:featuredmedia']?.[0]?.source_url;
			if (media) return absUrl(media);
		} catch {
		}
		try {
			const html = await this.fetchHtml(`/${slug}/`);
			const $ = cheerio.load(html);
			const og = $('meta[property="og:image"]').attr('content');
			if (og) return absUrl(og.split('?')[0]);
		} catch {
		}
		return '';
	}

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = query.trim().toLowerCase();
		if (!q) return [];
		const page = opts?.page ?? 1;

		const active = await this.fetchAllActiveSeries();
		const matched = active.filter((c) => {
			const name = (c.name || '').toLowerCase();
			const slug = (c.slug || '').toLowerCase();
			return name.includes(q) || slug.includes(q);
		});

		const start = (Math.max(1, page) - 1) * PAGE_SIZE;
		return matched.slice(start, start + PAGE_SIZE).map((c) => ({
			id: this.categoryToId(c),
			title: cleanText(c.name || c.slug || ''),
			cover: '',
			sourceId: this.id,
			type: 'novel' as const,
			status: 'Ongoing',
			lang: 'en',
			latestChapter: c.count || undefined
		}));
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const parsed = this.parseCategoryId(mangaId);
		if (!parsed) throw new Error('Invalid series id');

		const cat = await this.fetchCategoryBySlug(parsed.slug);
		if (!cat) throw new Error(`Series not found: ${parsed.slug}`);

		const title = cleanText(cat.name || parsed.slug);
		const description = cleanText(
			decodeEntities((cat.description || '').replace(/<[^>]+>/g, ' '))
		);

		let cover = '';
		try {
			cover = await this.fetchCategoryCover(cat.id, cat.slug || parsed.slug);
		} catch {
		}

		const chapters = await this.fetchAllChapters(cat.slug || parsed.slug, cat.id);
		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const genres =
			cat.parent === 6
				? ['Adult', 'Original']
				: ['Adult', 'Web Novel'];

		return {
			id: this.categoryToId(cat),
			title,
			cover,
			sourceId: this.id,
			description,
			authors: [],
			status: 'Ongoing',
			genres,
			chapters,
			type: 'novel',
			lang: 'en',
			latestChapter:
				chapters[0] && chapters[0].number < 9000
					? chapters[0].number
					: chapters.length || cat.count || undefined
		};
	}

	private async fetchAllChapters(slug: string, catId: number): Promise<Chapter[]> {
		let parentPageId: number | null = null;
		try {
			const { data } = await this.wpJson<WpPage[]>(
				`${BASE}/wp-json/wp/v2/pages?slug=${encodeURIComponent(slug)}&_fields=id,slug`
			);
			if (Array.isArray(data) && data[0]?.id) parentPageId = data[0].id;
		} catch {
		}

		if (parentPageId) {
			const fromPages = await this.fetchChaptersFromPages(parentPageId, slug);
			if (fromPages.length) return fromPages;
		}

		return this.fetchChaptersFromPosts(catId, slug);
	}

	private async fetchChaptersFromPages(
		parentId: number,
		seriesSlug: string
	): Promise<Chapter[]> {
		const out: Chapter[] = [];
		const seen = new Set<string>();
		let page = 1;
		let totalPages = 1;

		while (page <= totalPages && page <= 40) {
			const { data, totalPages: tp } = await this.wpJson<WpPage[]>(
				`${BASE}/wp-json/wp/v2/pages?parent=${parentId}&per_page=100&page=${page}&orderby=menu_order&order=asc&_fields=id,date,link,title,slug,content`
			);
			totalPages = tp || 1;
			if (!Array.isArray(data) || !data.length) break;

			for (const pg of data) {
				const href = pg.link || '';
				const id = pathOnly(href);
				if (!id || seen.has(id)) continue;
				seen.add(id);

				const raw = cleanText(decodeEntities(pg.title?.rendered || pg.slug || ''));
				const num = parseChapterNumber(raw || pg.slug || '', out.length + 1);
				const date = pg.date ? pg.date.slice(0, 10) : undefined;
				const locked = !!pg.content?.protected;

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

		if (out.length) {
			for (const ch of out) {
				const fromSlug = pathOnly(ch.id).match(
					new RegExp(`${seriesSlug}-c(\\d+(?:\\.\\d+)?)`, 'i')
				);
				if (fromSlug) {
					const n = parseFloat(fromSlug[1]);
					if (!Number.isNaN(n)) {
						ch.number = n;
						ch.title = shortChapterTitle(n);
					}
				}
			}
		}

		return out;
	}

	private async fetchChaptersFromPosts(
		catId: number,
		seriesSlug: string
	): Promise<Chapter[]> {
		const out: Chapter[] = [];
		const seen = new Set<string>();
		let page = 1;
		let totalPages = 1;

		while (page <= totalPages && page <= 30) {
			const { data, totalPages: tp } = await this.wpJson<WpPost[]>(
				`${BASE}/wp-json/wp/v2/posts?categories=${catId}&per_page=100&page=${page}&orderby=date&order=asc&_fields=id,date,link,title,slug,content`
			);
			totalPages = tp || 1;
			if (!Array.isArray(data) || !data.length) break;

			for (const post of data) {
				const rawTitle = cleanText(decodeEntities(post.title?.rendered || ''));
				const teaserHtml = post.content?.rendered || '';
				const realLink = this.extractRealChapterLink(teaserHtml, seriesSlug);

				const href = realLink || post.link || '';
				const id = pathOnly(href);
				if (!id || seen.has(id)) continue;
				seen.add(id);

				const num = parseChapterNumber(rawTitle || post.slug || '', out.length + 1);
				const date = post.date ? post.date.slice(0, 10) : undefined;
				const locked =
					!!post.content?.protected ||
					(/unlocked/i.test(rawTitle) && !realLink) ||
					(/password/i.test(teaserHtml) && !realLink);

				out.push({
					id,
					title: shortChapterTitle(num, rawTitle),
					number: num > 0 ? num : out.length + 1,
					...(date ? { date } : {}),
					...(locked ? { isLocked: true } : {})
				});
			}
			page += 1;
		}

		return out;
	}

	private extractRealChapterLink(html: string, seriesSlug: string): string | null {
		if (!html) return null;
		const $ = cheerio.load(html);
		let found: string | null = null;
		$('a[href]').each((_, a) => {
			if (found) return;
			const href = $(a).attr('href') || '';
			const text = cleanText($(a).text());
			const path = pathOnly(href);
			if (
				path.includes(`/${seriesSlug}/`) ||
				new RegExp(`${seriesSlug}-c\\d+`, 'i').test(path) ||
				/read\s*chapter/i.test(text)
			) {
				if (!/patreon|discord|twitter/i.test(href)) {
					found = path;
				}
			}
		});
		return found;
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
		let pageData: WpPage | null = null;
		if (slug) {
			try {
				const { data } = await this.wpJson<WpPage[]>(
					`${BASE}/wp-json/wp/v2/pages?slug=${encodeURIComponent(slug)}&_fields=id,slug,link,title,content,parent`
				);
				if (Array.isArray(data) && data[0]) pageData = data[0];
			} catch {
			}
		}

		if (!pageData || (pageData.content?.rendered || '').length < 200) {
			try {
				const { data: posts } = await this.wpJson<WpPost[]>(
					`${BASE}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&_fields=id,slug,link,title,content`
				);
				if (Array.isArray(posts) && posts[0]) {
					const teaser = posts[0].content?.rendered || '';
					const seriesGuess = path.split('/').filter(Boolean)[0] || slug.replace(/-chapter-.*$/i, '');
					const real = this.extractRealChapterLink(teaser, seriesGuess);
					if (real && real !== path) {
						return this.getChapterContent(real);
					}
				}
			} catch {
				/* ignore */
			}
		}

		const rawTitle = cleanText(
			decodeEntities(pageData?.title?.rendered || '') || slug
		);
		const num = parseChapterNumber(rawTitle || slug, 0);
		const title = shortChapterTitle(num, rawTitle);

		if (pageData?.content?.protected) {
			return {
				title,
				content:
					'<p>This chapter is password-protected / paywalled on Machine Sliced Bread.</p>',
				prevChapterId: null,
				nextChapterId: null
			};
		}

		let content = '';
		const rendered = pageData?.content?.rendered || '';
		if (rendered.length > 200) {
			content = this.htmlToParagraphs(rendered);
		}

		if (!content || content.length < 80) {
			const url = path.startsWith('http') ? path : `${BASE}${path}/`;
			const html = await this.fetchHtml(url);
			const $ = cheerio.load(html);

			if (
				$('form.post-password-form, .post-password-form').length ||
				/this\s+content\s+is\s+password\s+protected/i.test(html)
			) {
				return {
					title,
					content:
						'<p>This chapter is password-protected / paywalled on Machine Sliced Bread.</p>',
					prevChapterId: null,
					nextChapterId: null
				};
			}

			const contentEl = $('.entry-content, .post-content, article .content').first();
			contentEl
				.find(
					'script, style, noscript, .sharedaddy, .jp-relatedposts, .comments-area, #comments, .nav-links, .post-navigation, .code-block, .adsbygoogle, #textbox'
				)
				.remove();
			content = this.htmlToParagraphs(contentEl.html() || contentEl.text() || '');
		}

		if (!content || content.length < 40) {
			content = '<p>Content not available.</p>';
		}

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		if (pageData?.parent) {
			try {
				const { data: siblings } = await this.wpJson<WpPage[]>(
					`${BASE}/wp-json/wp/v2/pages?parent=${pageData.parent}&per_page=100&orderby=menu_order&order=asc&_fields=id,link,slug`
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
			} catch {
			}
		}

		if (!prevChapterId || !nextChapterId) {
			try {
				const html = await this.fetchHtml(`${BASE}${path}/`);
				const $ = cheerio.load(html);
				$('#textbox a, .entry-content a[href*="' + path.split('/')[1] + '"]').each(
					(_, a) => {
						const href = pathOnly($(a).attr('href') || '');
						const text = cleanText($(a).text()).toLowerCase();
						const cls = ($(a).parent().attr('class') || '').toLowerCase();
						if (!href || href === path) return;
						if (cls.includes('alignleft') || /prev|previous/i.test(text)) {
							if (!prevChapterId) prevChapterId = href;
						}
						if (cls.includes('alignright') || /next/i.test(text)) {
							if (!nextChapterId) nextChapterId = href;
						}
					}
				);
			} catch {
				/* ignore */
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
		$('#root').find('script, style, noscript, iframe, #textbox, .wp-block-separator').remove();

		const parts: string[] = [];
		$('#root')
			.find('p, h2, h3, blockquote, li')
			.each((_, el) => {
				const tag = ((el as any).tagName || (el as any).name || '').toLowerCase();
				const t = cleanText(decodeEntities($(el).text()));
				if (!t || t.length < 1) return;
				if (/^categories\s*:/i.test(t)) return;
				if (/^read chapter\s*\d+/i.test(t)) return;
				if (/^share this|^leave a reply|^related posts/i.test(t)) return;
				if (/^patreon|^support me on/i.test(t)) return;
				if (/password for chapters/i.test(t)) return;
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
			.filter(Boolean)
			.map((s) => `<p>${escapeHtml(s)}</p>`)
			.join('\n');
	}
}

export default MachineSlicedBreadSource;
