import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';

/**
 * Rena Scans adapter (https://renascans.net)
 *
 * Platform: Iken / vcomics (API)
 * API base : https://api.renascans.net
 *
 * Latest/Search : GET /api/query?page=&perPage=&orderBy=lastChapterAddedAt&searchTerm=
 * Detail        : GET /api/post?postSlug={slug}
 * Chapters      : GET /api/chapters?postId={id}&skip=0&take=900&order=desc
 * Pages         : GET /api/chapter?chapterId={id}  → chapter.images[].url
 *
 * ID format:
 *   manga   : /series/{slug}
 *   chapter : /series/{slug}/{chapterSlug}/{chapterId}
 * Locked chapters (coins) di-skip.
 */
export class RenaScansSource extends BaseSource {
	id = 'renascans';
	name = 'Rena Scans';
	baseUrl = 'https://renascans.net';

	private readonly apiBase = 'https://api.renascans.net';
	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'en';

	// ── HTTP ─────────────────────────────────────────────────────────────────

	private async apiGet<T = any>(
		path: string,
		params?: Record<string, string | number | boolean | undefined | null>
	): Promise<T> {
		const url = new URL(
			path.startsWith('http') ? path : `${this.apiBase}${path}`
		);
		if (params) {
			for (const [key, val] of Object.entries(params)) {
				if (val === undefined || val === null || val === '') continue;
				url.searchParams.set(key, String(val));
			}
		}

		const headers: Record<string, string> = {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
			Accept: 'application/json, text/plain, */*',
			'Accept-Language': 'en-US,en;q=0.9',
			Origin: this.baseUrl,
			Referer: `${this.baseUrl}/`
		};

		const res = await fetch(url.toString(), { headers });
		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new Error(
				`RenaScans HTTP ${res.status} ${url.pathname}: ${text.slice(0, 120)}`
			);
		}
		return (await res.json()) as T;
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private toMangaId(slug: string): string {
		return `/series/${slug}`;
	}

	private extractSlug(mangaId: string): string {
		const s = String(mangaId)
			.replace(/^\/+/, '')
			.split('?')[0]
			.split('#')[0];
		const parts = s.split('/').filter(Boolean);
		if (parts[0]?.toLowerCase() === 'series' && parts[1]) return parts[1];
		return parts[0] || '';
	}

	private toChapterId(
		seriesSlug: string,
		chapterSlug: string,
		chapterId: number | string
	): string {
		return `/series/${seriesSlug}/${chapterSlug}/${chapterId}`;
	}

	private extractChapterId(chapterId: string): string {
		const raw = String(chapterId).split('?')[0];

		const parts = raw.replace(/^\/+/, '').split('/').filter(Boolean);
		const last = parts[parts.length - 1] || '';
		if (/^\d+$/.test(last)) return last;

		const hash = raw.split('#')[1];
		if (hash && /^\d+$/.test(hash)) return hash;

		return '';
	}

	private mapStatus(status?: string | null): string {
		const s = String(status || '').toUpperCase();
		if (s === 'COMPLETED' || s === 'COMPLETE') return 'Completed';
		if (s === 'HIATUS') return 'Hiatus';
		if (s === 'CANCELLED' || s === 'DROPPED') return 'Dropped';
		if (s === 'COMING_SOON') return 'Upcoming';
		return 'Ongoing';
	}

	private mapType(type?: string | null): string {
		const t = String(type || '').toUpperCase();
		if (t === 'MANHWA') return 'manhwa';
		if (t === 'MANHUA') return 'manhua';
		if (t === 'MANGA') return 'manga';
		return 'manhwa';
	}

	private formatDate(iso?: string | null): string {
		if (!iso) return '';
		try {
			return new Date(iso).toISOString().slice(0, 10);
		} catch {
			return String(iso).slice(0, 10);
		}
	}

	private stripHtml(html: string): string {
		return String(html || '')
			.replace(/<[^>]+>/g, ' ')
			.replace(/&nbsp;/g, ' ')
			.replace(/&amp;/g, '&')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/\s+/g, ' ')
			.trim();
	}

	private mapPost(item: any): Manga | null {
		const slug = item?.slug;
		const title = String(item?.postTitle || item?.title || '').trim();
		if (!slug || !title) return null;
		if (item?.isNovel) return null;

		const chs = Array.isArray(item?.chapters) ? item.chapters : [];
		let latestChapter: string | undefined;
		if (chs.length > 0) {
			const n = chs[0]?.number;
			if (n != null && Number.isFinite(Number(n))) latestChapter = String(n);
		}

		return {
			id: this.toMangaId(slug),
			sourceId: this.id,
			title,
			cover: item?.featuredImage || '',
			type: this.mapType(item?.seriesType),
			status: this.mapStatus(item?.seriesStatus),
			latestChapter,
			lang: this.DEFAULT_LANG
		};
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		const p = Math.max(1, Number(page) || 1);
		try {
			const data = await this.apiGet<{ posts?: any[]; totalCount?: number }>(
				'/api/query',
				{
					page: p,
					perPage: this.PER_PAGE,
					orderBy: 'lastChapterAddedAt',
					orderDirection: 'desc'
				}
			);

			const rows = Array.isArray(data?.posts) ? data.posts : [];
			const list = rows
				.map((it) => this.mapPost(it))
				.filter(Boolean) as Manga[];

			console.log(`[renascans] latest page=${p} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[renascans] getLatestManga', e);
			return [];
		}
	}

	async searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page || 1);
		if (!q) return this.getLatestManga(page, opts);

		try {
			const data = await this.apiGet<{ posts?: any[] }>('/api/query', {
				page,
				perPage: this.PER_PAGE,
				searchTerm: q,
				orderBy: 'lastChapterAddedAt',
				orderDirection: 'desc'
			});

			const rows = Array.isArray(data?.posts) ? data.posts : [];
			const list = rows
				.map((it) => this.mapPost(it))
				.filter(Boolean) as Manga[];

			console.log(`[renascans] search "${q}" page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[renascans] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) throw new Error(`Invalid renascans id: ${mangaId}`);

		const data = await this.apiGet<{
			post?: any;
			totalChapterCount?: number;
		}>('/api/post', { postSlug: slug });

		const post = data?.post;
		if (!post?.id) throw new Error(`Manga not found: ${slug}`);

		const title = String(post.postTitle || slug).trim();
		const cover = post.featuredImage || '';
		const status = this.mapStatus(post.seriesStatus);
		const type = this.mapType(post.seriesType);
		const synopsis = this.stripHtml(post.postContent || '');

		const authors: string[] = [];
		for (const name of [post.author, post.artist]) {
			const n = String(name || '').trim();
			if (n && n !== '-' && !authors.includes(n)) authors.push(n);
		}

		const genres: string[] = [];
		for (const g of post.genres || []) {
			const name = String(g?.name || g || '').trim();
			if (name && name.length < 40 && !genres.includes(name)) genres.push(name);
		}

		const alt = String(post.alternativeTitles || '')
			.trim()
			.replace(/\s+/g, ' ');
		const rating =
			post.averageRating != null && !Number.isNaN(Number(post.averageRating))
				? Number(post.averageRating).toFixed(2)
				: null;
		const year = post.releaseDate ? String(post.releaseDate) : '';
		const views =
			post.totalViews != null && Number(post.totalViews) > 0
				? Number(post.totalViews).toLocaleString('en-US')
				: null;

		const metaLines = [
			alt && `Alternative: ${alt}`,
			rating && Number(rating) > 0 && `Rating: ${rating}`,
			authors[0] && `Author: ${authors.join(' · ')}`,
			year && `Year: ${year}`,
			views && `Views: ${views}`,
			`Type: ${type}`,
			`Language: English`
		].filter(Boolean);

		const description = [...metaLines, synopsis].filter(Boolean).join('\n');

		const postId = String(post.id);
		let chapters: Chapter[] = [];

		try {
			const chData = await this.apiGet<{ post?: { chapters?: any[] } }>(
				'/api/chapters',
				{
					postId,
					skip: 0,
					take: 900,
					order: 'desc'
				}
			);
			const rows = chData?.post?.chapters || [];
			const seen = new Set<string>();

			for (const u of rows) {
				if (u?.isLocked || u?.isAccessible === false) continue;
				const chSlug = String(u?.slug || '').trim();
				const chId = u?.id;
				if (!chSlug || chId == null) continue;
				const key = String(chId);
				if (seen.has(key)) continue;
				seen.add(key);

				const number = Number(u?.number);
				const num = Number.isFinite(number) ? number : chapters.length + 1;
				const chTitle =
					String(u?.title || '').trim() || `Chapter ${num}`;

				chapters.push({
					id: this.toChapterId(slug, chSlug, chId),
					title: chTitle,
					number: num,
					date: this.formatDate(u?.createdAt)
				});
			}
		} catch (e) {
			console.error('[renascans] chapters api', e);
		}

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));
		const latestChapter =
			chapters[0]?.number != null ? String(chapters[0].number) : undefined;

		console.log(`[renascans] details ${slug} → ch=${chapters.length}`);

		return {
			id: this.toMangaId(slug),
			sourceId: this.id,
			title,
			cover,
			type,
			status,
			description,
			authors,
			genres,
			chapters,
			latestChapter,
			lang: this.DEFAULT_LANG
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const id = this.extractChapterId(chapterId);
		if (!id) {
			console.error('[renascans] getChapterPages bad id:', chapterId);
			return [];
		}

		try {
			const data = await this.apiGet<{
				chapter?: {
					images?: Array<{ url?: string; order?: number }>;
					isLocked?: boolean;
					isLockedByCoins?: boolean;
					isShortLinkLocked?: boolean;
				};
			}>('/api/chapter', { chapterId: id });

			const ch = data?.chapter;
			if (!ch) return [];

			if (ch.isLocked || ch.isLockedByCoins || ch.isShortLinkLocked) {
				console.warn('[renascans] chapter locked', id);
				return [];
			}

			const images = Array.isArray(ch.images) ? [...ch.images] : [];
			images.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

			const pages: string[] = [];
			const seen = new Set<string>();
			for (const img of images) {
				const url = String(img?.url || '').trim();
				if (!url || seen.has(url)) continue;
				seen.add(url);
				pages.push(url);
			}

			console.log(
				`[renascans] getChapterPages ${id} → ${pages.length} pages`
			);
			return pages;
		} catch (e) {
			console.error('[renascans] getChapterPages', e);
			return [];
		}
	}
}
