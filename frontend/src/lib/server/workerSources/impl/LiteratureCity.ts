/**
 * Literature City (literaturecity.com) — WordPress novel site
 * Path: scraper/src/sources/impl/novel/LiteratureCity.ts
 *
 * Same brand family as Kari Studio / Leaf Studio.
 *
 * Model:
 *   - Each novel = 1 WP category (slug = novel URL path)
 *   - Index novel = WP post with same slug (description + featured image + tags)
 *   - Chapters = WP posts in that category
 *
 * API:
 *   GET /wp-json/wp/v2/categories?...
 *   GET /wp-json/wp/v2/posts?categories={id}&per_page=100&page=
 *   GET /wp-json/wp/v2/posts?slug={slug}&_embed=1
 *   GET /wp-json/novels/v1/* (optional cards; may be empty)
 *
 * Latest: derived from recent chapter posts → unique series (true "Most Recently Updated")
 * Homepage page size: 24
 * Chapter titles: cleaned to "Chapter N" only (no descriptive subtitle)
 * Paywall: isLocked when class is not free_chap / content looks locked
 */
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types-manga';
import { fetchWithCf } from '../../fetchWithCf';

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
			const u = new URL(link, 'https://literaturecity.com');
			let p = u.pathname.replace(/\/+$/, '') || '/';
			if (!p.startsWith('/')) p = `/${p}`;
			return p;
		} catch {
			/* fall through */
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
	if (/epilogue/i.test(title) || /epilogue/i.test(slug)) return 9999;
	const n = title.match(/\b(\d+(?:\.\d+)?)\b/);
	return n ? parseFloat(n[1]) : 0;
}

function cleanChapterTitle(raw: string, number: number): string {
	const t = decodeEntities(raw || '').replace(/\s+/g, ' ').trim();
	if (/prologue/i.test(t)) return 'Prologue';
	if (/epilogue/i.test(t)) return 'Epilogue';
	if (/side\s*stor/i.test(t)) {
		const n = t.match(/(\d+(?:\.\d+)?)/);
		return n ? `Side Story ${n[1]}` : 'Side Story';
	}
	if (/extra|interlude/i.test(t)) {
		const n = t.match(/(\d+(?:\.\d+)?)/);
		return n ? `Extra ${n[1]}` : 'Extra';
	}
	if (Number.isFinite(number) && number > 0) {
		const str =
			Math.abs(number - Math.floor(number)) > 1e-9
				? String(number)
				: String(Math.floor(number));
		return `Chapter ${str}`;
	}
	return t.replace(/\s*[–—:|:]\s*.+$/, '').trim() || t;
}

function looksLocked(contentHtml: string): boolean {
	const raw = (contentHtml || '').trim();
	if (!raw) return true;
	const text = stripHtml(raw);
	if (text.length < 80) {
		if (
			/premium|bluecoin|login|purchase|unlock|buy\s+chapter|paywall|locked/i.test(
				raw + text
			)
		) {
			return true;
		}
	}
	if (
		/class="[^"]*(?:premium|paywall|locked|bluecoin)[^"]*"|data-premium|karium-paywall/i.test(
			raw
		)
	) {
		return true;
	}
	return false;
}

function cleanTitle(raw: string): string {
	return decodeEntities(raw || '')
		.replace(/\s+/g, ' ')
		.replace(/\s*(?:[–—|]|-)\s*Literature\s*City\s*$/i, '')
		.trim();
}

function isLockedChapterClass(className: string): boolean {
	const c = (className || '').toLowerCase();
	if (!c) return false;
	if (/\bfree[_-]?chap\b/.test(c)) return false;
	return /premium|paid|lock|paywall|bluecoin|coin_chap|locked/.test(c);
}

export class LiteratureCitySource extends BaseSource {
	id = 'literaturecity';
	name = 'Literature City';
	baseUrl = 'https://literaturecity.com';

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'application/json, text/plain, */*',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: 'https://literaturecity.com/',
		Origin: 'https://literaturecity.com'
	};

	private catCache: { at: number; data: WpCategory[] } | null = null;
	private catById = new Map<number, WpCategory>();
	private static CAT_TTL = 10 * 60 * 1000;

	private async fetchCf(path: string, accept = 'application/json, text/plain, */*'): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		return fetchWithCf(url, {
			headers: {
				...this.headers,
				Accept: accept,
				Referer: this.baseUrl
			}
		});
	}

	private async fetchWp<T>(path: string): Promise<T> {
		const body = await this.fetchCf(path.startsWith('http') ? path : path);
		const trimmed = (body || '').trim();
		if (!trimmed) {
			throw new Error(`Empty response for ${path}`);
		}
	
		if (
			trimmed.startsWith('<!') ||
			/just a moment|checking your browser|cf-browser-verification/i.test(
				trimmed.slice(0, 2000)
			)
		) {
			throw new Error(
				`Cloudflare challenge on ${path} (enable Byparr / BYPARR_URL)`
			);
		}
		try {
			return JSON.parse(trimmed) as T;
		} catch {
			throw new Error(`Invalid JSON from ${path}: ${trimmed.slice(0, 120)}`);
		}
	}

	private async fetchHtmlCf(path: string): Promise<string> {
		return this.fetchCf(
			path,
			'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
		);
	}

	private async getNovelCategories(): Promise<WpCategory[]> {
		const now = Date.now();
		if (this.catCache && now - this.catCache.at < LiteratureCitySource.CAT_TTL) {
			return this.catCache.data;
		}
		const out: WpCategory[] = [];
		let page = 1;
		const perPage = 100;
		while (page <= 15) {
			const batch = await this.fetchWp<WpCategory[]>(
				`${WP}/categories?per_page=${perPage}&page=${page}&orderby=count&order=desc`
			);
			if (!Array.isArray(batch) || batch.length === 0) break;
			for (const c of batch) {
				if (!c?.slug || SKIP_CAT_SLUGS.has(c.slug.toLowerCase())) continue;
				if ((c.count || 0) < 1) continue;
				out.push(c);
				this.catById.set(c.id, c);
			}
			if (batch.length < perPage) break;
			page++;
		}
		this.catCache = { at: now, data: out };
		return out;
	}

	private async resolveCategory(id: number): Promise<WpCategory | null> {
		if (this.catById.has(id)) return this.catById.get(id)!;
		try {
			const c = await this.fetchWp<WpCategory>(`${WP}/categories/${id}`);
			if (c?.slug) {
				this.catById.set(c.id, c);
				return c;
			}
		} catch {
			/* ignore */
		}
		return null;
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

	private async getSeriesIndex(slug: string): Promise<{
		cover: string;
		description: string;
		title: string;
		genres: string[];
		authors: string[];
		status: string;
		altTitles: string[];
		postId?: number;
	}> {
		try {
			const posts = await this.fetchWp<WpPost[]>(
				`${WP}/posts?slug=${encodeURIComponent(slug)}&_embed=1&per_page=1`
			);
			if (!Array.isArray(posts) || !posts.length) {
				return {
					cover: '',
					description: '',
					title: '',
					genres: [],
					authors: [],
					status: 'Ongoing',
					altTitles: []
				};
			}
			const p = posts[0];
			const media = p._embedded?.['wp:featuredmedia']?.[0];
			const cover = media?.source_url || '';
			const description = stripHtml(p.content?.rendered || p.excerpt?.rendered || '');
			const title = cleanTitle(p.title?.rendered || '');
			const genres: string[] = [];
			const authors: string[] = [];
			const altTitles: string[] = [];
			let status = 'Ongoing';
			const seen = new Set<string>();
			const termGroups = p._embedded?.['wp:term'] || [];

			for (const group of termGroups) {
				if (!Array.isArray(group)) continue;
				for (const t of group) {
					if (!t) continue;
					const name = cleanTitle(t.name || '');
					if (!name) continue;
					const key = name.toLowerCase();
					if (t.taxonomy === 'post_tag') {
						if (seen.has(key)) continue;
						seen.add(key);
						if (/^author\s*:/i.test(name)) {
							authors.push(name.replace(/^author\s*:\s*/i, ''));
						} else if (/completed|ongoing|hiatus|dropped/i.test(name)) {
							status = /completed/i.test(name)
								? 'Completed'
								: /hiatus/i.test(name)
									? 'Hiatus'
									: /dropped/i.test(name)
										? 'Dropped'
										: 'Ongoing';
						} else {
							genres.push(name);
						}
					}
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

			if (/status\s*:\s*completed/i.test(description) || /\bcompleted\b/i.test(title)) {
				status = 'Completed';
			}

			return {
				cover,
				description,
				title,
				genres,
				authors,
				status,
				altTitles,
				postId: p.id
			};
		} catch {
			return {
				cover: '',
				description: '',
				title: '',
				genres: [],
				authors: [],
				status: 'Ongoing',
				altTitles: []
			};
		}
	}

	private parseNovelCardsFromHtml(html: string): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		const linkRe =
			/<a[^>]+href="(https?:\/\/(?:www\.)?literaturecity\.com\/([a-z0-9][a-z0-9-]*)\/?)"[^>]*>[\s\S]*?(?:<img[^>]+(?:src|data-src)="([^"]+)"[^>]*>)?[\s\S]*?<\/a>/gi;
		let m: RegExpExecArray | null;
		while ((m = linkRe.exec(html)) !== null) {
			const slug = (m[2] || '').toLowerCase();
			if (!slug || SKIP_CAT_SLUGS.has(slug)) continue;
			if (
				/^(wp-|category|tag|page|author|shop|ranking|discord|login|feed|comments|novels|chapter-)/.test(
					slug
				)
			) {
				continue;
			}
			if (/^chapter-/.test(slug)) continue;
			const id = `/${slug}`;
			if (seen.has(id)) continue;
			seen.add(id);

			let cover = m[3] || '';
			if (cover && cover.startsWith('//')) cover = 'https:' + cover;
			if (cover && cover.startsWith('/')) cover = this.baseUrl + cover;

			const title = slug
				.split('-')
				.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
				.join(' ');

			out.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: 'Ongoing'
			});
			if (out.length >= PAGE_SIZE * 2) break;
		}

		const cardRe =
			/<a[^>]+href="https?:\/\/(?:www\.)?literaturecity\.com\/([a-z0-9][a-z0-9-]*)\/?"[^>]*>[\s\S]{0,800}?<img[^>]+(?:alt="([^"]*)")?[^>]*(?:src|data-src)="([^"]+)"/gi;
		while ((m = cardRe.exec(html)) !== null) {
			const slug = (m[1] || '').toLowerCase();
			if (!slug || SKIP_CAT_SLUGS.has(slug) || /^chapter-/.test(slug)) continue;
			if (
				/^(wp-|category|tag|page|author|shop|ranking|discord|login|feed|comments|novels)/.test(
					slug
				)
			) {
				continue;
			}
			const id = `/${slug}`;
			const existing = out.find((x) => x.id === id);
			const alt = cleanTitle(m[2] || '');
			let cover = m[3] || '';
			if (cover.startsWith('//')) cover = 'https:' + cover;
			if (cover.startsWith('/')) cover = this.baseUrl + cover;
			if (existing) {
				if (alt && alt.length > 3) existing.title = alt;
				if (cover) existing.cover = cover;
			} else if (!seen.has(id)) {
				seen.add(id);
				out.push({
					id,
					title: alt || slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
					cover,
					sourceId: this.id,
					type: 'novel',
					lang: 'en',
					status: 'Ongoing'
				});
			}
		}

		return out.slice(0, PAGE_SIZE);
	}

	async getLatestManga(page = 1): Promise<Manga[]> {
		const pageNum = Math.max(1, page);
		const out: Manga[] = [];
		const seen = new Set<string>();

		try {
			const path =
				pageNum <= 1
					? '/'
					: `/novels/?page=${pageNum}`;
			const html = await this.fetchHtmlCf(path);
			const cards = this.parseNovelCardsFromHtml(html);
			for (const c of cards) {
				if (seen.has(c.id)) continue;
				seen.add(c.id);
				out.push(c);
			}
			if (out.length >= 8) {
				await Promise.all(
					out.slice(0, PAGE_SIZE).map(async (item) => {
						const slug = item.id.replace(/^\/+/, '');
						try {
							const idx = await this.getSeriesIndex(slug);
							if (idx.title) item.title = idx.title;
							if (idx.cover) item.cover = idx.cover;
						} catch {
						}
					})
				);
				return out.slice(0, PAGE_SIZE);
			}
		} catch (e) {
			console.error('[LiteratureCity] HTML latest failed', e);
		}

		try {
			const need = pageNum * PAGE_SIZE;
			const postsPerReq = 100;
			let offsetPage = 1;
			const seriesOrder: Array<{
				catId: number;
				slug: string;
				title: string;
				date?: string;
				latestNum?: number;
			}> = [];

			while (seriesOrder.length < need && offsetPage <= 10) {
				const posts = await this.fetchWp<WpPost[]>(
					`${WP}/posts?per_page=${postsPerReq}&page=${offsetPage}&orderby=date&order=desc&_fields=id,slug,title,date,link,categories`
				);
				if (!Array.isArray(posts) || !posts.length) break;

				for (const p of posts) {
					const catIds = (p.categories || []).filter((id) => id > 0);
					if (!catIds.length) continue;
					const catId = catIds[0];
					if (seen.has(`cat:${catId}`)) continue;

					let cat = this.catById.get(catId);
					if (!cat) {
						cat = (await this.resolveCategory(catId)) || undefined;
					}
					if (!cat?.slug || SKIP_CAT_SLUGS.has(cat.slug.toLowerCase())) continue;

					seen.add(`cat:${catId}`);
					const chTitle = cleanTitle(p.title?.rendered || '');
					const latestNum = parseChapterNumber(chTitle, p.slug);
					seriesOrder.push({
						catId,
						slug: cat.slug,
						title: cleanTitle(cat.name),
						date: p.date,
						latestNum: latestNum || undefined
					});
					if (seriesOrder.length >= need) break;
				}
				if (posts.length < postsPerReq) break;
				offsetPage++;
			}

			const start = (pageNum - 1) * PAGE_SIZE;
			const slice = seriesOrder.slice(start, start + PAGE_SIZE);

			await Promise.all(
				slice.map(async (item) => {
					let cover = '';
					let title = item.title;
					try {
						const idx = await this.getSeriesIndex(item.slug);
						if (idx.cover) cover = idx.cover;
						if (idx.title) title = idx.title;
					} catch {
						/* ignore */
					}
					out.push({
						id: `/${item.slug}`,
						title,
						cover,
						sourceId: this.id,
						type: 'novel',
						lang: 'en',
						status: 'Ongoing',
						...(item.latestNum != null ? { latestChapter: item.latestNum } : {}),
						...(item.date ? { updatedAt: Date.parse(item.date) || undefined } : {})
					});
				})
			);

			if (out.length > 0) return out;
		} catch (e) {
			console.error('[LiteratureCity] latest-from-posts failed', e);
		}

		try {
			const cats = await this.fetchWp<WpCategory[]>(
				`${WP}/categories?per_page=${PAGE_SIZE}&page=${pageNum}&orderby=count&order=desc`
			);
			if (Array.isArray(cats)) {
				for (const c of cats) {
					if (!c?.slug || SKIP_CAT_SLUGS.has(c.slug.toLowerCase())) continue;
					if ((c.count || 0) < 1) continue;
					const m = this.mapCategory(c);
					try {
						const idx = await this.getSeriesIndex(c.slug);
						if (idx.cover) m.cover = idx.cover;
						if (idx.title) m.title = idx.title;
					} catch {
						/* ignore */
					}
					out.push(m);
				}
			}
		} catch (e) {
			console.error('[LiteratureCity] categories fallback failed', e);
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
			console.error('[LiteratureCity] category search failed', e);
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
		const pageHits = hits.slice(start, start + PAGE_SIZE);
		await Promise.all(
			pageHits.map(async (m) => {
				if (m.cover) return;
				try {
					const slug = m.id.replace(/^\/+/, '');
					const idx = await this.getSeriesIndex(slug);
					if (idx.cover) m.cover = idx.cover;
					if (idx.title) m.title = idx.title;
				} catch {
					/* ignore */
				}
			})
		);

		return pageHits;
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = mangaId
			.replace(/^\/+/, '')
			.replace(/\/+$/, '')
			.split('/')
			.filter(Boolean)[0];
		if (!slug) throw new Error('Invalid manga id');

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
		const authors = index.authors?.length ? index.authors : [];

		let chapters = await this.fetchChaptersFromHtml(slug);
		if (!chapters.length) {
			chapters = await this.fetchChapters(cat.id, slug);
		}

		let status = index.status || 'Ongoing';
		try {
			const html = await this.fetchHtmlCf(`/${slug}/`);
			if (/completed/i.test(html.slice(0, 50000))) {
				if (
					/class="[^"]*status[^"]*"[^>]*>\s*Completed/i.test(html) ||
					/>\s*Completed\s*</i.test(html.slice(0, 80000))
				) {
					status = 'Completed';
				}
			}
		} catch {
		}

		return {
			id: `/${cat.slug}`,
			title,
			cover,
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters,
			type: 'novel',
			lang: 'en',
			...(chapters.length ? { latestChapter: chapters[0]?.number } : {})
		};
	}

	private async fetchChaptersFromHtml(seriesSlug: string): Promise<Chapter[]> {
		try {
			const html = await this.fetchHtmlCf(`/${seriesSlug}/`);
			const out: Chapter[] = [];
			const seen = new Set<string>();

			const re =
				/<a\s+[^>]*class="([^"]*)"[^>]*href="(https?:\/\/[^"]*literaturecity\.com\/[^"]+|\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
			let m: RegExpExecArray | null;
			while ((m = re.exec(html)) !== null) {
				const className = m[1] || '';
				const href = m[2] || '';
				const inner = stripHtml(m[3] || '');
				if (!/chap/i.test(className) && !/chapter/i.test(inner + href)) continue;
				if (!/chapter|prologue|epilogue|side|extra|interlude/i.test(inner + href)) {
					if (!/\d/.test(inner) && !/\d/.test(href)) continue;
				}

				const id = pathFromLink(href);
				if (!id || id === '/' || id === `/${seriesSlug}`) continue;
				if (seen.has(id)) continue;
				seen.add(id);

				const num = parseChapterNumber(inner, id.split('/').pop() || '');
				const locked =
					isLockedChapterClass(className) ||
					(!/\bfree[_-]?chap\b/i.test(className) &&
						/premium|lock|coin|paywall/i.test(className + inner));

				out.push({
					id,
					title: cleanChapterTitle(inner, num),
					number: num,
					isLocked: locked
				});
			}

			out.sort((a, b) => {
				if (b.number !== a.number) return b.number - a.number;
				return a.id.localeCompare(b.id);
			});

			return out;
		} catch (e) {
			console.error('[LiteratureCity] HTML chapter list failed', e);
			return [];
		}
	}

	private async fetchChapters(categoryId: number, seriesSlug: string): Promise<Chapter[]> {
		const out: Chapter[] = [];
		const seen = new Set<string>();
		let page = 1;
		const perPage = 100;

		while (page <= 25) {
			const posts = await this.fetchWp<WpPost[]>(
				`${WP}/posts?categories=${categoryId}&per_page=${perPage}&page=${page}&orderby=date&order=asc&_fields=id,slug,title,date,link,excerpt,content`
			);
			if (!Array.isArray(posts) || posts.length === 0) break;

			for (const p of posts) {
				if (p.slug === seriesSlug) continue;
				const rawTitle = cleanTitle(p.title?.rendered || p.slug);
				if (
					!/chapter|prologue|epilogue|side\s*stor|extra|interlude/i.test(
						rawTitle + ' ' + p.slug
					)
				) {
					if (!/\d/.test(rawTitle) && !/\d/.test(p.slug)) continue;
				}
				const id = pathFromLink(p.link, p.slug);
				if (seen.has(id)) continue;
				seen.add(id);

				const num = parseChapterNumber(rawTitle, p.slug);
				const body = p.content?.rendered || p.excerpt?.rendered || '';
				const locked = looksLocked(body);

				out.push({
					id,
					title: cleanChapterTitle(rawTitle, num),
					number: num,
					date: p.date || undefined,
					isLocked: locked
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
		const rawTitle = cleanTitle(p.title?.rendered || slug);
		const num = parseChapterNumber(rawTitle, p.slug);
		const title = cleanChapterTitle(rawTitle, num);
		const raw = p.content?.rendered || '';
		const currentId = pathFromLink(p.link, p.slug);

		if (looksLocked(raw)) {
			throw new Error('Chapter is locked / premium on Literature City (Bluecoin)');
		}

		if (!raw.trim()) {
			throw new Error('Chapter body is empty');
		}

		const content = `<div class="lc-chapter">${raw}</div>`;

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		try {
			const catIds = (p.categories || []).filter((id) => id > 0);
			const catId = catIds[0];
			if (catId) {
				const cat = await this.resolveCategory(catId);
				const seriesSlug = cat?.slug || '';
				let chs = seriesSlug ? await this.fetchChaptersFromHtml(seriesSlug) : [];
				if (!chs.length) {
					chs = await this.fetchChapters(catId, seriesSlug);
				}
				const idx = chs.findIndex(
					(c) =>
						pathFromLink(c.id) === currentId ||
						c.id.endsWith(`/${slug}`) ||
						pathFromLink(c.id).endsWith(`/${slug}`)
				);
				if (idx >= 0) {
					prevChapterId = chs[idx + 1] ? pathFromLink(chs[idx + 1].id) : null;
					nextChapterId = chs[idx - 1] ? pathFromLink(chs[idx - 1].id) : null;
				}
			}
		} catch {
		}

		return {
			title,
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default LiteratureCitySource;
