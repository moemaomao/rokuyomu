/**
 * Kari Studio (karistudio.com) — WordPress novel site
 * Path: scraper/src/sources/impl/KariStudio.ts
 *
 * Stack: WordPress + custom REST namespace novels/v1
 *
 * Model:
 *   - Setiap novel = 1 WP category (slug = URL path novel)
 *   - Index novel = WP post di slug yang sama (deskripsi + featured image)
 *   - Chapter = WP posts dalam category novel tersebut
 *
 * API:
 *   GET /wp-json/novels/v1/romanceNew|romancePopular|blNew|blPopular|...
 *   GET /wp-json/wp/v2/categories?slug={slug}
 *   GET /wp-json/wp/v2/categories?search={q}&per_page=
 *   GET /wp-json/wp/v2/posts?categories={id}&per_page=100&page=
 *   GET /wp-json/wp/v2/posts?slug={chapter-slug}
 *   GET /wp-json/wp/v2/posts?slug={novel-slug}&_embed=1  → cover via featured media
 */
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types';

const PAGE_SIZE = 24;
const WP = '/wp-json/wp/v2';
const NOVELS_API = '/wp-json/novels/v1';

const SKIP_CAT_SLUGS = new Set([
	'library',
	'uncategorized',
	'blog',
	'news',
	'announcement',
	'announcements'
]);

type WpRendered = { rendered?: string; protected?: boolean };

type WpCategory = {
	id: number;
	count: number;
	description?: string;
	link?: string;
	name: string;
	slug: string;
	parent?: number;
};

type WpPost = {
	id: number;
	date?: string;
	modified?: string;
	slug: string;
	link?: string;
	title?: WpRendered;
	content?: WpRendered;
	excerpt?: WpRendered;
	categories?: number[];
	tags?: number[];
	featured_media?: number;
	status?: string;
	_embedded?: {
		'wp:featuredmedia'?: Array<{ source_url?: string; media_details?: any }>;
		'wp:term'?: Array<Array<{ id: number; name: string; slug: string; taxonomy: string }>>;
	};
};

type NovelCard = {
	id: number;
	title?: string;
	link?: string;
	sales?: string;
	thumbnail?: string;
	excerpt?: string;
};

function decodeEntities(s: string): string {
	return (s || '')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#8217;/g, "'")
		.replace(/&#8216;/g, "'")
		.replace(/&#8220;/g, '"')
		.replace(/&#8221;/g, '"')
		.replace(/&#8230;/g, '…')
		.replace(/&nbsp;/g, ' ');
}

function stripHtml(html: string): string {
	return decodeEntities(
		html
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/p>/gi, '\n\n')
			.replace(/<[^>]+>/g, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
}

function pathFromLink(link?: string, fallbackSlug?: string): string {
	if (link) {
		try {
			const u = new URL(link);
			const p = u.pathname.replace(/\/$/, '') || '/';
			return p.startsWith('/') ? p : `/${p}`;
		} catch {
		}
	}
	if (fallbackSlug) return `/${fallbackSlug.replace(/^\/+|\/+$/g, '')}`;
	return '/';
}

function parseChapterNumber(title: string, slug = ''): number {
	const fromSlug = slug.match(/(?:^|-)(?:chapter|ch)[-_]?(\d+)(?:[-_.](\d+))?/i);
	if (fromSlug) {
		const major = parseInt(fromSlug[1], 10);
		if (fromSlug[2]) return parseFloat(`${major}.${fromSlug[2]}`);
		return major;
	}
	const m = title.match(
		/(?:chapter|chap|ch\.?|episode|ep\.?)\s*(\d+)(?:[.,](\d+))?/i
	);
	if (m) {
		if (m[2]) return parseFloat(`${m[1]}.${m[2]}`);
		return parseInt(m[1], 10);
	}
	
	if (/prologue/i.test(title) || /prologue/i.test(slug)) return 0;
	const n = title.match(/\b(\d+(?:\.\d+)?)\b/);
	return n ? parseFloat(n[1]) : 0;
}

function looksLocked(contentHtml: string): boolean {
	const raw = (contentHtml || '').trim();
	if (!raw) return true;
	const text = stripHtml(raw);
	if (text.length < 80) {
		if (/premium|karium|login|purchase|unlock|buy\s+chapter/i.test(raw + text)) {
			return true;
		}
	}
	if (/class="[^"]*premium[^"]*"|data-premium|karium-paywall/i.test(raw)) {
		return true;
	}
	return false;
}

function cleanTitle(raw: string): string {
	return decodeEntities(raw || '')
		.replace(/\s+/g, ' ')
		.replace(/\s*(?:[–—|]|-)\s*Kari Studio\s*$/i, '')
		.trim();
}

export class KariStudioSource extends BaseSource {
	id = 'karistudio';
	name = 'Kari Studio';
	baseUrl = 'https://karistudio.com';

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'application/json, text/plain, */*',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: 'https://karistudio.com/',
		Origin: 'https://karistudio.com'
	};

	private catCache: { at: number; data: WpCategory[] } | null = null;
	private static CAT_TTL = 10 * 60 * 1000;

	private async fetchWp<T>(path: string): Promise<T> {
		return this.fetchJson<T>(path.startsWith('http') ? path : path);
	}

	private async getNovelCategories(): Promise<WpCategory[]> {
		const now = Date.now();
		if (this.catCache && now - this.catCache.at < KariStudioSource.CAT_TTL) {
			return this.catCache.data;
		}
		const out: WpCategory[] = [];
		let page = 1;
		const perPage = 100;
		while (page <= 10) {
			const batch = await this.fetchWp<WpCategory[]>(
				`${WP}/categories?per_page=${perPage}&page=${page}&orderby=count&order=desc`
			);
			if (!Array.isArray(batch) || batch.length === 0) break;
			for (const c of batch) {
				if (!c?.slug || SKIP_CAT_SLUGS.has(c.slug.toLowerCase())) continue;
				if ((c.count || 0) < 1) continue;
				out.push(c);
			}
			if (batch.length < perPage) break;
			page++;
		}
		this.catCache = { at: now, data: out };
		return out;
	}

	private mapCategory(c: WpCategory, cover = ''): Manga {
		const latest =
			typeof c.count === 'number' && c.count > 0 ? Math.max(1, c.count - 1) : undefined;
		return {
			id: `/${c.slug}`,
			title: cleanTitle(c.name),
			cover,
			sourceId: this.id,
			type: 'novel',
			lang: 'en',
			status: 'Ongoing',
			...(latest != null ? { latestChapter: latest } : {})
		};
	}

	private mapNovelCard(n: NovelCard): Manga | null {
		if (!n?.link && !n?.title) return null;
		const id = pathFromLink(n.link);
		if (!id || id === '/') return null;
		return {
			id,
			title: cleanTitle(n.title || id.slice(1)),
			cover: n.thumbnail || '',
			sourceId: this.id,
			type: 'novel',
			lang: 'en'
		};
	}

	private async getSeriesIndex(slug: string): Promise<{
		cover: string;
		description: string;
		title: string;
		genres: string[];
		postId?: number;
	}> {
		try {
			const posts = await this.fetchWp<WpPost[]>(
				`${WP}/posts?slug=${encodeURIComponent(slug)}&_embed=1&per_page=1`
			);
			if (!Array.isArray(posts) || !posts.length) {
				return { cover: '', description: '', title: '', genres: [] };
			}
			const p = posts[0];
			const media = p._embedded?.['wp:featuredmedia']?.[0];
			const cover = media?.source_url || '';
			const description = stripHtml(p.content?.rendered || p.excerpt?.rendered || '');
			const title = cleanTitle(p.title?.rendered || '');
			const genres: string[] = [];
			const seen = new Set<string>();
			const termGroups = p._embedded?.['wp:term'] || [];
			for (const group of termGroups) {
				if (!Array.isArray(group)) continue;
				for (const t of group) {
					if (!t || t.taxonomy !== 'post_tag') continue;
					const name = cleanTitle(t.name || '');
					if (!name) continue;
					const key = name.toLowerCase();
					if (seen.has(key)) continue;
					seen.add(key);
					genres.push(name);
				}
			}

			if (!genres.length && Array.isArray((p as any).tags) && (p as any).tags.length) {
				try {
					const ids = ((p as any).tags as number[]).slice(0, 30);
					const tags = await this.fetchWp<Array<{ name?: string }>>(
						`${WP}/tags?include=${ids.join(',')}&per_page=${ids.length}`
					);
					if (Array.isArray(tags)) {
						for (const t of tags) {
							const name = cleanTitle(t.name || '');
							if (!name) continue;
							const key = name.toLowerCase();
							if (seen.has(key)) continue;
							seen.add(key);
							genres.push(name);
						}
					}
				} catch {
					/* ignore */
				}
			}

			return { cover, description, title, genres, postId: p.id };
		} catch {
			return { cover: '', description: '', title: '', genres: [] };
		}
	}

	async getLatestManga(page = 1): Promise<Manga[]> {
		const pageNum = Math.max(1, page);
		const coverBySlug = new Map<string, string>();
		const titleBySlug = new Map<string, string>();
		try {
			const endpoints = [
				`${NOVELS_API}/romanceNew?page=${pageNum}`,
				`${NOVELS_API}/romancePopular?page=${pageNum}`,
				`${NOVELS_API}/blNew?page=${pageNum}`,
				`${NOVELS_API}/blPopular?page=${pageNum}`
			];
			for (const ep of endpoints) {
				try {
					const data = await this.fetchWp<NovelCard[] | { message?: string }>(ep);
					if (!Array.isArray(data)) continue;
					for (const n of data) {
						const id = pathFromLink(n.link);
						const slug = id.replace(/^\//, '');
						if (!slug) continue;
						if (n.thumbnail) coverBySlug.set(slug, n.thumbnail);
						if (n.title) titleBySlug.set(slug, cleanTitle(n.title));
					}
				} catch {
				}
			}
		} catch {
		}

		const perPage = PAGE_SIZE;
		let cats: WpCategory[] = [];
		try {
			cats = await this.fetchWp<WpCategory[]>(
				`${WP}/categories?per_page=${perPage}&page=${pageNum}&orderby=count&order=desc`
			);
		} catch (e) {
			console.error('[KariStudio] categories page failed', e);
			cats = [];
		}
		if (!Array.isArray(cats)) cats = [];

		const out: Manga[] = [];
		const seen = new Set<string>();

		const pending: Array<{
			slug: string;
			title: string;
			cover: string;
			latest?: number;
		}> = [];

		for (const c of cats) {
			if (!c?.slug || SKIP_CAT_SLUGS.has(c.slug.toLowerCase())) continue;
			if ((c.count || 0) < 1) continue;
			const id = `/${c.slug}`;
			if (seen.has(id)) continue;
			seen.add(id);

			const cover = coverBySlug.get(c.slug) || '';
			const title = titleBySlug.get(c.slug) || cleanTitle(c.name);
			const latest =
				typeof c.count === 'number' && c.count > 0 ? Math.max(1, c.count - 1) : undefined;

			pending.push({ slug: c.slug, title, cover, latest });
		}

		const needCover = pending.filter((x) => !x.cover);
		if (needCover.length) {
			await Promise.all(
				needCover.map(async (item) => {
					try {
						const idx = await this.getSeriesIndex(item.slug);
						if (idx.cover) item.cover = idx.cover;
						if (idx.title && item.title === cleanTitle(item.slug)) {
							item.title = idx.title;
						}
					} catch {
						/* ignore */
					}
				})
			);
		}

		for (const item of pending) {
			out.push({
				id: `/${item.slug}`,
				title: item.title,
				cover: item.cover,
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: 'Ongoing',
				...(item.latest != null ? { latestChapter: item.latest } : {})
			});
		}

		if (out.length === 0 && coverBySlug.size > 0) {
			for (const [slug, cover] of coverBySlug) {
				if (seen.has(`/${slug}`)) continue;
				seen.add(`/${slug}`);
				out.push({
					id: `/${slug}`,
					title: titleBySlug.get(slug) || slug,
					cover,
					sourceId: this.id,
					type: 'novel',
					lang: 'en',
					status: 'Ongoing'
				});
			}
		}

		return out;
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = query.trim().toLowerCase();
		if (!q) return [];

		const hits: Manga[] = [];
		const seen = new Set<string>();

		try {
			const cats = await this.fetchWp<WpCategory[]>(
				`${WP}/categories?search=${encodeURIComponent(query)}&per_page=50`
			);
			if (Array.isArray(cats)) {
				for (const c of cats) {
					if (!c?.slug || SKIP_CAT_SLUGS.has(c.slug.toLowerCase())) continue;
					if ((c.count || 0) < 1) continue;
					const id = `/${c.slug}`;
					if (seen.has(id)) continue;
					seen.add(id);
					hits.push(this.mapCategory(c));
				}
			}
		} catch (e) {
			console.error('[KariStudio] category search failed', e);
		}

		if (hits.length < PAGE_SIZE) {
			try {
				const all = await this.getNovelCategories();
				for (const c of all) {
					const name = (c.name || '').toLowerCase();
					const slug = (c.slug || '').toLowerCase();
					if (!name.includes(q) && !slug.includes(q)) continue;
					const id = `/${c.slug}`;
					if (seen.has(id)) continue;
					seen.add(id);
					hits.push(this.mapCategory(c));
				}
			} catch {
				/* ignore */
			}
		}

		const start = (Math.max(1, page) - 1) * PAGE_SIZE;
		return hits.slice(start, start + PAGE_SIZE);
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = mangaId
			.replace(/^\/+/, '')
			.replace(/\/+$/, '')
			.split('/')
			.filter(Boolean)[0];
		if (!slug) throw new Error('Invalid manga id');

		// Resolve category
		const cats = await this.fetchWp<WpCategory[]>(
			`${WP}/categories?slug=${encodeURIComponent(slug)}`
		);
		const cat = Array.isArray(cats) ? cats[0] : null;
		if (!cat?.id) {
			throw new Error(`Series not found: ${slug}`);
		}

		const index = await this.getSeriesIndex(slug);
		const title = index.title || cleanTitle(cat.name);
		const cover = index.cover || '';
		const description = index.description || stripHtml(cat.description || '');
		const genres = index.genres || [];

		const chapters = await this.fetchChapters(cat.id, slug);

		return {
			id: `/${cat.slug}`,
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
			...(chapters.length ? { latestChapter: chapters[0]?.number } : {})
		};
	}

	private async fetchChapters(categoryId: number, seriesSlug: string): Promise<Chapter[]> {
		const out: Chapter[] = [];
		const seen = new Set<string>();
		let page = 1;
		const perPage = 100;

		while (page <= 20) {
			const posts = await this.fetchWp<WpPost[]>(
				`${WP}/posts?categories=${categoryId}&per_page=${perPage}&page=${page}&orderby=date&order=asc&_fields=id,slug,title,date,link,excerpt`
			);
			if (!Array.isArray(posts) || posts.length === 0) break;

			for (const p of posts) {
				if (p.slug === seriesSlug) continue;
				const title = cleanTitle(p.title?.rendered || p.slug);
				if (!/chapter|prologue|epilogue|side\s*stor|extra|interlude/i.test(title + ' ' + p.slug)) {
					if (!/\d/.test(title) && !/\d/.test(p.slug)) continue;
				}
				const id = pathFromLink(p.link, p.slug);
				if (seen.has(id)) continue;
				seen.add(id);

				const num = parseChapterNumber(title, p.slug);
				out.push({
					id,
					title,
					number: num,
					date: p.date || undefined,
					isLocked: false
				});
			}

			if (posts.length < perPage) break;
			page++;
		}

		out.sort((a, b) => {
			if (b.number !== a.number) return b.number - a.number;
			return (b.date || '').localeCompare(a.date || '');
		});

		return out;
	}

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		const slug = chapterId
			.replace(/^\/+/, '')
			.replace(/\/+$/, '')
			.split('/')
			.filter(Boolean)
			.pop();
		if (!slug) throw new Error(`Invalid chapter id: ${chapterId}`);

		const posts = await this.fetchWp<WpPost[]>(
			`${WP}/posts?slug=${encodeURIComponent(slug)}&per_page=1`
		);
		if (!Array.isArray(posts) || !posts.length) {
			throw new Error(`Chapter not found: ${slug}`);
		}

		const p = posts[0];
		const title = cleanTitle(p.title?.rendered || slug);
		const raw = p.content?.rendered || '';

		if (looksLocked(raw)) {
			throw new Error('Chapter is locked / premium on Kari Studio (Karium)');
		}

		if (!raw.trim()) {
			throw new Error('Chapter body is empty');
		}

		const content = `<div class="ks-chapter">${raw}</div>`;

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		try {
			const catIds = (p.categories || []).filter((id) => id !== 129);
			const catId = catIds[0];
			if (catId) {
				const cats = await this.fetchWp<WpCategory[]>(`${WP}/categories/${catId}`);
				const cat = Array.isArray(cats) ? cats[0] : (cats as unknown as WpCategory);
				const seriesSlug = cat?.slug || '';
				const chs = await this.fetchChapters(catId, seriesSlug);
				const idx = chs.findIndex(
					(c) => c.id === pathFromLink(p.link, p.slug) || c.id.endsWith(`/${slug}`)
				);
				if (idx >= 0) {
					prevChapterId = chs[idx + 1]?.id ?? null;
					nextChapterId = chs[idx - 1]?.id ?? null;
				}
			}
		} catch {
			/* optional */
		}

		return {
			title,
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default KariStudioSource;
