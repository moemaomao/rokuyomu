/**
 * SekaiTranslations (sekaitranslations.com) — Convex backend novel source
 * Path: scraper/src/sources/impl/novel/SekaiTranslations.ts
 *
 * Convex deployment: https://elated-cardinal-622.convex.cloud
 *
 *   Latest  : novels:getRecentlyUpdated { limit: 24 }  ← Recently Updated section
 *   List    : novels:list { paginationOpts: { numItems, cursor } }
 *   Search  : novels:search { query }
 *   Detail  : novels:getBySlug { slug }
 *   Chapters: chapters:listByNovel { novelId }
 *   Content : chapters:getByNumber { novelId, chapterNumber }
 *   Nav     : chapters:getReaderNav { novelId, chapterNumber }
 *
 * Frontend URLs:
 *   Novel   : /novels/{slug}
 *   Chapter : /novels/{slug}/chapter/{chapterNumber}
 *
 * Chapter title → "Chapter N" only
 * isLocked from chapter.isLocked
 * fetchWithCf used for all Convex HTTP calls
 */
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const SITE = 'https://sekaitranslations.com';
const CONVEX = 'https://elated-cardinal-622.convex.cloud';
const PAGE_SIZE = 24;

function absCover(url: string | undefined | null): string {
	if (!url) return '';
	const u = String(url).trim();
	if (!u) return '';
	if (u.startsWith('//')) return `https:${u}`;
	if (/^https?:\/\//i.test(u)) return u.split('?')[0];
	return `${CONVEX}${u.startsWith('/') ? u : `/${u}`}`.split('?')[0];
}

function stripHtml(html: string): string {
	return (html || '')
		.replace(/&nbsp;/gi, ' ')
		.replace(/\u200b/g, '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>/gi, '\n\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\n{3,}/g, '\n\n')
		.replace(/[ \t]+/g, ' ')
		.trim();
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function statusLabel(raw: string | undefined): string {
	const s = (raw || '').toLowerCase();
	if (s.includes('complete')) return 'Completed';
	if (s.includes('hiatus')) return 'Hiatus';
	if (s.includes('drop')) return 'Dropped';
	if (s.includes('ongoing') || s.includes('on-going')) return 'Ongoing';
	return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Ongoing';
}

function mapNovel(n: any, sourceId: string, latestChapter?: number): Manga | null {
	if (!n?.slug && !n?._id) return null;
	const slug = n.slug || String(n._id);
	const title = String(n.title || '').replace(/\s+/g, ' ').trim();
	if (!title) return null;

	let latest = latestChapter;
	if (latest == null && n.chapterCount != null) {
		const c = Number(n.chapterCount);
		if (!Number.isNaN(c)) latest = c;
	}

	return {
		id: `/novels/${slug}`,
		title,
		cover: absCover(n.coverUrl || n.coverThumbUrl),
		sourceId,
		type: 'novel',
		status: statusLabel(n.status),
		lang: 'en',
		...(latest != null ? { latestChapter: latest } : {})
	};
}

export class SekaiTranslationsSource extends BaseSource {
	id = 'sekaitranslations';
	name = 'SekaiTranslations';
	baseUrl = SITE;

	kind = 'novel' as const;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
		Accept: 'application/json',
		'Content-Type': 'application/json',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: SITE + '/',
		Origin: SITE
	};

	/** Convex HTTP query via fetchWithCf */
	private async convexQuery<T = any>(path: string, args: Record<string, unknown> = {}): Promise<T> {
		const body = JSON.stringify({ path, args, format: 'json' });
		const text = await fetchWithCf(`${CONVEX}/api/query`, {
			method: 'POST',
			headers: {
				...this.headers,
				'Content-Type': 'application/json',
				Accept: 'application/json'
			},
			body
		} as any);

		if (!text || text.length < 2) {
			throw new Error(`Empty Convex response for ${path}`);
		}
		const low = text.slice(0, 400).toLowerCase();
		if (low.includes('just a moment') || low.includes('cf-browser-verification')) {
			throw new Error('Cloudflare blocked Convex request (set BYPARR_URL)');
		}

		let data: any;
		try {
			data = JSON.parse(text);
		} catch {
			throw new Error(`Invalid JSON from Convex ${path}`);
		}

		if (data?.status === 'error') {
			throw new Error(data.errorMessage || `Convex error on ${path}`);
		}
		return data?.value as T;
	}

	// ─── Recently Updated (homepage section) ──────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		if (page <= 1) {
			try {
				const rows = await this.convexQuery<any[]>('novels:getRecentlyUpdated', {
					limit: PAGE_SIZE
				});
				const list: Manga[] = [];
				const seen = new Set<string>();
				for (const row of Array.isArray(rows) ? rows : []) {
					const novel = row?.novel || row;
					const latestNum =
						Array.isArray(row?.latestChapters) && row.latestChapters[0]
							? Number(row.latestChapters[0].chapterNumber)
							: undefined;
					const item = mapNovel(
						novel,
						this.id,
						Number.isNaN(latestNum as number) ? undefined : latestNum
					);
					if (item && !seen.has(item.id)) {
						seen.add(item.id);
						list.push(item);
					}
				}
				if (list.length) return list.slice(0, PAGE_SIZE);
			} catch {
				// fall through
			}
		}
		return this.fetchListPage(page);
	}

	private async fetchListPage(page: number): Promise<Manga[]> {
		// Walk pagination cursors until we reach the requested page
		let cursor: string | null = null;
		let current = 1;
		let pageItems: any[] = [];

		try {
			while (current <= page) {
				const result = await this.convexQuery<{
					page?: any[];
					continueCursor?: string | null;
					isDone?: boolean;
				}>('novels:list', {
					paginationOpts: {
						numItems: PAGE_SIZE,
						cursor
					}
				});

				pageItems = Array.isArray(result?.page) ? result.page : [];
				if (current === page) break;
				if (result?.isDone || !result?.continueCursor) {
					pageItems = [];
					break;
				}
				cursor = result.continueCursor;
				current += 1;
			}

			const list: Manga[] = [];
			const seen = new Set<string>();
			for (const n of pageItems) {
				const item = mapNovel(n, this.id);
				if (item && !seen.has(item.id)) {
					seen.add(item.id);
					list.push(item);
				}
			}
			return list;
		} catch {
			return [];
		}
	}

	// ─── Search ───────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = query.trim();
		if (!q) return [];
		// API returns full match list; page is client-side slice
		const page = opts?.page ?? 1;
		try {
			const rows = await this.convexQuery<any[]>('novels:search', { query: q });
			const all = Array.isArray(rows) ? rows : [];
			const start = (page - 1) * PAGE_SIZE;
			const slice = all.slice(start, start + PAGE_SIZE);
			const list: Manga[] = [];
			const seen = new Set<string>();
			for (const n of slice) {
				const item = mapNovel(n, this.id);
				if (item && !seen.has(item.id)) {
					seen.add(item.id);
					list.push(item);
				}
			}
			return list;
		} catch {
			return [];
		}
	}

	// ─── Detail ───────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) throw new Error('Invalid novel id');

		const n = await this.convexQuery<any>('novels:getBySlug', { slug });
		if (!n?.title && !n?.slug) {
			throw new Error('Novel not found');
		}

		const title = String(n.title || '').replace(/\s+/g, ' ').trim();
		const cover = absCover(n.coverUrl || n.coverThumbUrl);
		const description = stripHtml(String(n.synopsis || ''));

		const authors: string[] = [];
		if (n.authorName && String(n.authorName).trim()) {
			authors.push(String(n.authorName).trim());
		}

		const genres: string[] = [];
		if (Array.isArray(n.genres)) {
			for (const g of n.genres) {
				const name = typeof g === 'string' ? g : g?.name;
				if (name && !genres.includes(String(name))) genres.push(String(name));
			}
		} else if (n.genre) {
			genres.push(String(n.genre));
		}

		const altTitle = n.alternativeName ? String(n.alternativeName).trim() : '';
		const status = statusLabel(n.status);
		const novelId = n._id as string;

		let chapters: Chapter[] = [];
		try {
			const chRows = await this.convexQuery<any[]>('chapters:listByNovel', {
				novelId
			});
			chapters = this.mapChapters(Array.isArray(chRows) ? chRows : [], slug);
		} catch {
			chapters = [];
		}

		// newest first
		chapters.sort((a, b) => b.number - a.number);

		const details: MangaDetails = {
			id: `/novels/${n.slug || slug}`,
			title,
			cover,
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters,
			type: 'novel',
			lang: 'en'
		};

		const extra = details as MangaDetails & {
			artists?: string[];
			altTitles?: string[];
			published?: string;
		};
		if (altTitle) extra.altTitles = [altTitle];
		if (n.originalLanguage) {
			// optional metadata
		}

		// stash novelId in id path is already slug-based; chapter fetch resolves via slug→getBySlug
		return details;
	}

	private extractSlug(mangaId: string): string {
		const clean = mangaId.replace(/^\/+/, '').replace(/\/+$/, '');
		const m = clean.match(/(?:novels\/)?([^/]+)$/i);
		return m ? m[1] : clean;
	}

	private mapChapters(raw: any[], slug: string): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		for (const c of raw) {
			const num = Number(c.chapterNumber ?? c.number);
			if (Number.isNaN(num)) continue;

			const id = `/novels/${slug}/chapter/${num}`;
			if (seen.has(id)) continue;
			seen.add(id);

			const ch: Chapter = {
				id,
				title: `Chapter ${num}`,
				number: num,
				date: c.publishedAt || undefined
			};
			if (c.isLocked === true) ch.isLocked = true;
			out.push(ch);
		}

		return out;
	}

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	// ─── Chapter content ──────────────────────────────────────────────────

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		const { slug, chapterNumber } = this.parseChapterId(chapterId);
		if (!slug || chapterNumber == null) {
			throw new Error('Invalid chapter id');
		}

		const novel = await this.convexQuery<any>('novels:getBySlug', { slug });
		if (!novel?._id) throw new Error('Novel not found');

		const novelId = novel._id as string;

		let chapter: any;
		try {
			chapter = await this.convexQuery<any>('chapters:getByNumber', {
				novelId,
				chapterNumber
			});
		} catch (e: any) {
			const msg = String(e?.message || e || '');
			if (/lock|forbidden|unauthorized|403/i.test(msg)) {
				return this.lockedPayload(slug, chapterNumber, novelId);
			}
			throw e;
		}

		if (!chapter) {
			throw new Error('Chapter not found');
		}

		if (chapter.isLocked === true && !chapter.content) {
			return this.lockedPayload(slug, chapterNumber, novelId);
		}

		const num = Number(chapter.chapterNumber ?? chapterNumber);
		const title = num > 0 ? `Chapter ${num}` : String(chapter.title || 'Chapter');

		let contentHtml = String(chapter.content || '');
		// Clean zero-width / nbsp noise while keeping HTML
		contentHtml = contentHtml
			.replace(/\u200b/g, '')
			.replace(/&nbsp;/gi, ' ');

		if (contentHtml && !/<[a-z][\s\S]*>/i.test(contentHtml)) {
			contentHtml = contentHtml
				.split(/\n{2,}/)
				.map((p) => p.trim())
				.filter(Boolean)
				.map((p) => `<p>${escapeHtml(p)}</p>`)
				.join('\n');
		}

		// Reader nav
		let prevId: string | null = null;
		let nextId: string | null = null;
		try {
			const nav = await this.convexQuery<{
				prevNumber?: number | null;
				nextNumber?: number | null;
				lastNumber?: number | null;
			}>('chapters:getReaderNav', { novelId, chapterNumber: num });

			if (nav?.prevNumber != null) {
				prevId = `/novels/${slug}/chapter/${nav.prevNumber}`;
			}
			if (nav?.nextNumber != null) {
				nextId = `/novels/${slug}/chapter/${nav.nextNumber}`;
			}
		} catch {
			// ignore nav errors
		}

		return {
			title,
			content:
				contentHtml ||
				'<p><em>Konten kosong — chapter mungkin locked atau data berubah.</em></p>',
			prevChapterId: prevId,
			nextChapterId: nextId
		};
	}

	private async lockedPayload(
		slug: string,
		chapterNumber: number,
		novelId: string
	): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		let prevId: string | null = null;
		let nextId: string | null = null;
		try {
			const nav = await this.convexQuery<{
				prevNumber?: number | null;
				nextNumber?: number | null;
			}>('chapters:getReaderNav', { novelId, chapterNumber });
			if (nav?.prevNumber != null) prevId = `/novels/${slug}/chapter/${nav.prevNumber}`;
			if (nav?.nextNumber != null) nextId = `/novels/${slug}/chapter/${nav.nextNumber}`;
		} catch {
			/* ignore */
		}

		return {
			title: `Chapter ${chapterNumber}`,
			content:
				'<p><em>This chapter is locked (paywall / stars). Unlock it on SekaiTranslations.</em></p>',
			prevChapterId: prevId,
			nextChapterId: nextId
		};
	}

	private parseChapterId(chapterId: string): {
		slug?: string;
		chapterNumber?: number;
	} {
		const clean = chapterId.replace(/^\/+/, '').replace(/\/+$/, '');
		// /novels/{slug}/chapter/{n}
		let m = clean.match(/^novels\/([^/]+)\/chapter\/(\d+(?:\.\d+)?)$/i);
		if (m) return { slug: m[1], chapterNumber: parseFloat(m[2]) };
		// /novels/{slug}/{n}
		m = clean.match(/^novels\/([^/]+)\/(\d+(?:\.\d+)?)$/i);
		if (m) return { slug: m[1], chapterNumber: parseFloat(m[2]) };
		return {};
	}
}

export default SekaiTranslationsSource;
