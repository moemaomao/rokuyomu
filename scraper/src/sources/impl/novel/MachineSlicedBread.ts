/**
 * Machine Sliced Bread (machineslicedbread.xyz)
 * Path: scraper/src/sources/impl/novel/MachineSlicedBread.ts
 *
 * WordPress blog — JP adult web novel fan translations.
 *
 * Architecture:
 *   - Series = child categories of "web-novel-translation" (parent id 3)
 *   - Chapters = WP posts in that category
 *   - Content = .entry-content on post HTML
 *   - REST: /wp-json/wp/v2/categories?parent=3
 *           /wp-json/wp/v2/posts?categories={id}&per_page=100&page=N
 *
 * Homepage: 24 series (categories with posts, newest activity first)
 * Chapter titles: "Chapter N" only
 *
 * Frontend id: machineslicedbread
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://machineslicedbread.xyz';
const WN_PARENT = 3;

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
		.replace(/&#8211;/g, '–')
		.replace(/&#038;/g, '&')
		.replace(/&amp;/g, '&')
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
	return s
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

function parseChapterNumber(text: string, fallback = 0): number {
	const t = cleanText(text);
	const m =
		t.match(/(?:chapter|ch\.?|c)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function shortChapterTitle(n: number, raw?: string): string {
	if (n > 0) {
		return Number.isInteger(n) ? `Chapter ${n}` : `Chapter ${n}`;
	}
	if (/prologue/i.test(raw || '')) return 'Prologue';
	if (/epilogue/i.test(raw || '')) return 'Epilogue';
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

type WpPost = {
	id: number;
	date?: string;
	slug?: string;
	link?: string;
	title?: { rendered?: string };
	content?: { rendered?: string };
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

	private async wpJson<T>(url: string): Promise<{ data: T; total: number; totalPages: number }> {
		const res = await fetch(url, { headers: { ...this.headers, Accept: 'application/json' } });
		if (!res.ok) {
			throw new Error(`MSB API ${res.status}: ${url}`);
		}
		const total = parseInt(res.headers.get('X-WP-Total') || '0', 10);
		const totalPages = parseInt(res.headers.get('X-WP-TotalPages') || '0', 10);
		const data = (await res.json()) as T;
		return { data, total, totalPages };
	}

	// ─── Latest ──────────────────────────────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		return this.getLatestNovels(page);
	}

	async getLatestNovels(page = 1): Promise<Manga[]> {
		// Active series = child categories with posts
		const { data: cats } = await this.wpJson<WpCategory[]>(
			`${BASE}/wp-json/wp/v2/categories?parent=${WN_PARENT}&per_page=100&orderby=id&order=desc`
		);

		const active = (Array.isArray(cats) ? cats : [])
			.filter((c) => (c.count || 0) > 0 && c.slug)
			// sort by count (activity proxy) then name
			.sort((a, b) => (b.count || 0) - (a.count || 0));

		const pageSize = 24;
		const start = (Math.max(1, page) - 1) * pageSize;
		const slice = active.slice(start, start + pageSize);

		const list: Manga[] = [];
		for (const c of slice) {
			const id = this.categoryToId(c);
			list.push({
				id,
				title: cleanText(c.name || c.slug || 'Unknown'),
				cover: '',
				sourceId: this.id,
				type: 'novel',
				status: 'Ongoing',
				lang: 'en',
				latestChapter: c.count || undefined
			});
		}

		// Enrich covers in parallel (first post featured image) — best effort
		await Promise.all(
			list.slice(0, 12).map(async (m, i) => {
				const cat = slice[i];
				if (!cat) return;
				try {
					const cover = await this.fetchCategoryCover(cat.id);
					if (cover) m.cover = cover;
				} catch {
					/* ignore */
				}
			})
		);

		return list;
	}

	private categoryToId(c: WpCategory): string {
		return `/category/web-novel-translation/${c.slug}`;
	}

	private parseCategoryId(mangaId: string): { slug: string } | null {
		const path = pathOnly(mangaId);
		const m = path.match(/\/category\/web-novel-translation\/([^/]+)/);
		if (m) return { slug: m[1] };
		// allow bare slug
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

	private async fetchCategoryCover(catId: number): Promise<string> {
		const { data } = await this.wpJson<WpPost[]>(
			`${BASE}/wp-json/wp/v2/posts?categories=${catId}&per_page=1&_embed=1&orderby=date&order=desc&_fields=id,_links,_embedded`
		);
		if (!Array.isArray(data) || !data[0]) return '';
		const media = data[0]._embedded?.['wp:featuredmedia']?.[0]?.source_url;
		return absUrl(media || '');
	}

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = query.trim().toLowerCase();
		if (!q) return [];
		const page = opts?.page ?? 1;

		const { data: cats } = await this.wpJson<WpCategory[]>(
			`${BASE}/wp-json/wp/v2/categories?parent=${WN_PARENT}&per_page=100`
		);
		const matched = (Array.isArray(cats) ? cats : []).filter((c) => {
			const name = (c.name || '').toLowerCase();
			const slug = (c.slug || '').toLowerCase();
			return (c.count || 0) > 0 && (name.includes(q) || slug.includes(q));
		});

		const start = (page - 1) * 24;
		return matched.slice(start, start + 24).map((c) => ({
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
			cover = await this.fetchCategoryCover(cat.id);
		} catch {
			/* ignore */
		}

		const chapters = await this.fetchAllChapters(cat.id);
		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		return {
			id: this.categoryToId(cat),
			title,
			cover,
			sourceId: this.id,
			description,
			authors: [],
			status: 'Ongoing',
			genres: ['Adult', 'Web Novel'],
			chapters,
			type: 'novel',
			lang: 'en',
			latestChapter: chapters.length || cat.count || undefined
		};
	}

	private async fetchAllChapters(catId: number): Promise<Chapter[]> {
		const out: Chapter[] = [];
		const seen = new Set<string>();
		let page = 1;
		let totalPages = 1;

		while (page <= totalPages && page <= 30) {
			const { data, totalPages: tp } = await this.wpJson<WpPost[]>(
				`${BASE}/wp-json/wp/v2/posts?categories=${catId}&per_page=100&page=${page}&orderby=date&order=asc&_fields=id,date,link,title,slug`
			);
			totalPages = tp || 1;
			if (!Array.isArray(data) || !data.length) break;

			for (const post of data) {
				const href = post.link || '';
				const id = pathOnly(href);
				if (!id || seen.has(id)) continue;
				seen.add(id);

				const raw = cleanText(decodeEntities(post.title?.rendered || ''));
				const num = parseChapterNumber(raw, out.length + 1);
				const date = post.date ? post.date.slice(0, 10) : undefined;

				out.push({
					id,
					title: shortChapterTitle(num, raw),
					number: num,
					...(date ? { date } : {})
				});
			}

			page += 1;
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
		path = path.replace(/\/$/, '') + '/';
		const url = path.startsWith('http') ? path : `${BASE}${path}`;

		const html = await this.fetchHtml(url);
		const $ = cheerio.load(html);

		const rawTitle = cleanText(
			$('h1.entry-title, .entry-title, h1').first().text() ||
				$('meta[property="og:title"]').attr('content')?.split(/[–|-]/)[0] ||
				$('title').text().split(/[–|-]/)[0] ||
				'Chapter'
		);
		const num = parseChapterNumber(rawTitle, 0);
		const title = shortChapterTitle(num, rawTitle);

		const contentEl = $('.entry-content, .post-content, article .content').first();
		contentEl
			.find(
				'script, style, noscript, .sharedaddy, .jp-relatedposts, .comments-area, #comments, .nav-links, .post-navigation, .code-block, .adsbygoogle'
			)
			.remove();

		const parts: string[] = [];
		contentEl.find('p, h2, h3, blockquote').each((_, el) => {
			const tag = ((el as any).tagName || (el as any).name || '').toLowerCase();
			const t = cleanText(decodeEntities($(el).text()));
			if (!t || t.length < 1) return;
			if (/^categories\s*:/i.test(t)) return;
			if (/^read chapter\s*\d+/i.test(t)) return;
			if (/^share this|^leave a reply|^related posts/i.test(t)) return;
			if (tag === 'h2' || tag === 'h3') {
				parts.push(`<h3>${escapeHtml(t)}</h3>`);
			} else {
				parts.push(`<p>${escapeHtml(t)}</p>`);
			}
		});

		let content = parts.join('\n');
		if (!content || content.length < 40) {
			const raw = contentEl.html() || '';
			content = raw.length > 40 ? raw : '<p>Content not available.</p>';
		}

		// WP post nav is chronological site-wide — only use if same series slug prefix
		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		const seriesHint = path.split('/').filter(Boolean)[0] || '';
		$('a[rel="prev"], a[rel="next"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const rel = ($(a).attr('rel') || '').toLowerCase();
			const id = pathOnly(href);
			if (!id || id === pathOnly(path)) return;
			// avoid jumping to unrelated series when possible
			if (seriesHint && !id.includes(seriesHint) && !href.includes(seriesHint)) {
				// still allow — many posts use flat chapter slugs
			}
			if (rel === 'prev') prevChapterId = id;
			if (rel === 'next') nextChapterId = id;
		});

		return {
			title,
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default MachineSlicedBreadSource;
