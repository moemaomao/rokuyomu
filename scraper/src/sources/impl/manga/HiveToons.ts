/**
 * HiveToons adapter (hivetoons.org) — Iken theme
 *
 * API base  : https://api.hivetoons.org
 * Latest    : GET /api/query?page=&perPage=24&orderBy=lastChapterAddedAt&orderDirection=desc
 * Search    : GET /api/query?page=&perPage=24&searchTerm=
 * Detail    : GET /api/post?postSlug={slug}
 * Chapters  : GET /api/chapters?postId={id}  (fallback: post.chapters)
 * Pages     : GET /api/chapter?chapterId={id} → chapter.images[].url
 *
 * ID format:
 *   manga   : /{slug}
 *   chapter : /{slug}/{chapterSlug}#{chapterId}
 */

import { BaseSource } from '../../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';

export class HiveToonsSource extends BaseSource {
	id = 'hivetoons';
	name = 'HiveToons';
	baseUrl = 'https://hivetoons.org';
	private readonly apiBase = 'https://api.hivetoons.org';
	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'en';

	// ── HTTP ─────────────────────────────────────────────────────────────────

	private async apiGet<T = any>(path: string): Promise<T> {
		const url = path.startsWith('http') ? path : `${this.apiBase}${path}`;
		const res = await fetch(url, {
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
				Accept: 'application/json',
				Referer: `${this.baseUrl}/`,
				Origin: this.baseUrl
			}
		});
		if (!res.ok) {
			throw new Error(`HiveToons HTTP ${res.status} → ${url}`);
		}
		return (await res.json()) as T;
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private toMangaId(slug: string): string {
		return `/${String(slug).replace(/^\/+|\/+$/g, '')}`;
	}

	private extractSlug(id: string): string {
		const parts = String(id)
			.replace(/^\/+/, '')
			.split(/[/#]/)
			.filter(Boolean);
		return parts[0] || '';
	}

	private toChapterId(seriesSlug: string, chapterSlug: string, chapterId: number | string): string {
		const s = String(seriesSlug).replace(/^\/+|\/+$/g, '');
		const c = String(chapterSlug).replace(/^\/+|\/+$/g, '');
		return `/${s}/${c}#${chapterId}`;
	}

	private parseChapterId(chapterId: string): { seriesSlug: string; chapterSlug: string; numericId: string } {
		const raw = String(chapterId).replace(/^\/+/, '');
		const hashIdx = raw.indexOf('#');
		const numericId = hashIdx >= 0 ? raw.slice(hashIdx + 1) : '';
		const path = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
		const parts = path.split('/').filter(Boolean);
		return {
			seriesSlug: parts[0] || '',
			chapterSlug: parts.slice(1).join('/') || '',
			numericId
		};
	}

	private formatDate(iso?: string | null): string {
		if (!iso) return '';
		try {
			return new Date(iso).toISOString().slice(0, 10);
		} catch {
			return String(iso).slice(0, 10);
		}
	}

	private mapType(seriesType?: string | null): string {
		const t = String(seriesType || '').toUpperCase();
		if (t === 'MANHUA') return 'manhua';
		if (t === 'MANGA') return 'manga';
		if (t === 'NOVEL') return 'novel';
		return 'manhwa';
	}

	private mapStatus(seriesStatus?: string | null): string {
		const t = String(seriesStatus || '').toUpperCase();
		if (t === 'COMPLETED') return 'Completed';
		if (t === 'HIATUS') return 'Hiatus';
		if (t === 'CANCELLED' || t === 'DROPPED') return 'Dropped';
		if (t === 'COMING_SOON') return 'Upcoming';
		return 'Ongoing';
	}

	private isChapterLocked(ch: any): boolean {
		if (ch?.isLocked === true) return true;
		if (ch?.isAccessible === false) return true;
		if (ch?.isPermanentlyLocked === true) return true;
		if (ch?.isLockedByCoins === true) return true;
		if (ch?.isShortLinkLocked === true) return true;
		if (ch?.isTimeLocked === true) return true;
		const price = Number(ch?.price) || 0;
		const purchased = ch?.chapterPurchased === true || ch?.isPurchased === true || ch?.hasPurchased === true;
		if (price > 0 && !purchased) return true;
		return false;
	}

	private mapListItem(item: any): Manga | null {
		const slug = item?.slug;
		if (!slug) return null;

		const chapters = item?.chapters || [];
		let latestChapter: string | undefined;
		if (chapters.length > 0) {
			const nums = chapters
				.map((c: any) => Number(c?.number))
				.filter((n: number) => !Number.isNaN(n));
			if (nums.length) latestChapter = String(Math.max(...nums));
		}

		return {
			id: this.toMangaId(slug),
			sourceId: this.id,
			title: String(item.postTitle || item.title || slug).trim(),
			cover: item.featuredImage || '',
			type: this.mapType(item.seriesType),
			status: this.mapStatus(item.seriesStatus),
			latestChapter,
			lang: this.DEFAULT_LANG
		};
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const data = await this.apiGet<{ posts?: any[]; totalCount?: number }>(
				`/api/query?page=${p}&perPage=${this.PER_PAGE}&orderBy=lastChapterAddedAt&orderDirection=desc`
			);
			const list = (data?.posts || [])
				.filter((it) => !it?.isNovel)
				.map((it) => this.mapListItem(it))
				.filter(Boolean) as Manga[];

			console.log(`[hivetoons] latest page=${p} → ${list.length} items`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[hivetoons] getLatestManga', e);
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
			const data = await this.apiGet<{ posts?: any[] }>(
				`/api/query?page=${page}&perPage=${this.PER_PAGE}&searchTerm=${encodeURIComponent(q)}`
			);
			const list = (data?.posts || [])
				.filter((it) => !it?.isNovel)
				.map((it) => this.mapListItem(it))
				.filter(Boolean) as Manga[];

			console.log(`[hivetoons] search "${q}" page=${page} → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[hivetoons] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) throw new Error(`Invalid hivetoons id: ${mangaId}`);

		const data = await this.apiGet<any>(
			`/api/post?postSlug=${encodeURIComponent(slug)}`
		);
		const post = data?.post;
		if (!post?.slug && !post?.postTitle) {
			throw new Error(`Manga not found: ${slug}`);
		}

		const finalSlug = String(post.slug || slug);
		const postId = post.id;
		const title = String(post.postTitle || finalSlug).trim();

		const altRaw = String(post.alternativeTitles || '').trim();
		const altTitles = altRaw
			? altRaw
					.split(/[,;|]/)
					.map((s: string) => s.trim())
					.filter(Boolean)
			: [];

		const genres = (post.genres || [])
			.map((g: any) => String(g?.name || '').trim())
			.filter(Boolean);

		const authors: string[] = [];
		if (post.author) {
			authors.push(
				...String(post.author)
					.split(/[,&]/)
					.map((s: string) => s.trim())
					.filter(Boolean)
			);
		}
		if (post.artist) {
			const artists = String(post.artist)
				.split(/[,&]/)
				.map((s: string) => s.trim())
				.filter(Boolean);
			for (const a of artists) {
				if (!authors.includes(a)) authors.push(a);
			}
		}
		if (post.studio) {
			const studio = String(post.studio).trim();
			if (studio && !authors.includes(studio)) authors.push(studio);
		}

		const rating =
			post.averageRating != null && !Number.isNaN(Number(post.averageRating))
				? Number(post.averageRating).toFixed(2)
				: null;

		const type = this.mapType(post.seriesType);
		const status = this.mapStatus(post.seriesStatus);

		let rawChapters: any[] = [];
		if (postId) {
			try {
				const chRes = await this.apiGet<{ post?: { chapters?: any[] } }>(
					`/api/chapters?postId=${postId}`
				);
				rawChapters = chRes?.post?.chapters || [];
			} catch (e) {
				console.warn('[hivetoons] chapters API failed, using post.chapters', e);
			}
		}
		if (rawChapters.length === 0) {
			rawChapters = post.chapters || [];
		}

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		for (const ch of rawChapters) {
			const cslug = String(ch.slug || '');
			const cid = ch.id;
			if (!cslug || cid == null) continue;
			const key = `${cslug}#${cid}`;
			if (seen.has(key)) continue;
			seen.add(key);

			const num = Number(ch.number);
			const number = !Number.isNaN(num) ? num : chapters.length + 1;
			const locked = this.isChapterLocked(ch);

			const cleanTitle = locked ? `Chapter ${number} ` : `Chapter ${number}`;

			chapters.push({
				id: this.toChapterId(finalSlug, cslug, cid),
				title: cleanTitle,
				number,
				date: this.formatDate(ch.createdAt),
				cover: ch.featuredImage || undefined,
				isLocked: locked || undefined
			});
		}

		chapters.sort((a, b) => (a.number || 0) - (b.number || 0));

		const synopsis = post.postContent
			? String(post.postContent)
					.replace(/<[^>]+>/g, ' ')
					.replace(/\s+/g, ' ')
					.trim()
			: '';

		const metaLines = [
			altTitles.length && `Alternative: ${altTitles.join(' · ')}`,
			rating && `Rating: ${rating}`,
			authors[0] && `Author: ${authors[0]}`,
			post.artist && String(post.artist).trim() && `Artist: ${String(post.artist).trim()}`,
			post.seriesType && `Type: ${post.seriesType}`,
			post.releaseDate && String(post.releaseDate).trim() && `Release: ${String(post.releaseDate).trim()}`,
			post.createdAt && `Published: ${this.formatDate(post.createdAt)}`
		].filter(Boolean);

		const description = [...metaLines, synopsis].filter(Boolean).join('\n');

		const latestCh =
			chapters.length > 0
				? String(chapters[chapters.length - 1].number)
				: data?.lastChapter?.number != null
					? String(data.lastChapter.number)
					: data?.totalChapterCount != null
						? String(data.totalChapterCount)
						: undefined;

		return {
			id: this.toMangaId(finalSlug),
			sourceId: this.id,
			title,
			cover: post.featuredImage || '',
			type,
			status,
			description,
			authors,
			genres,
			chapters,
			latestChapter: latestCh
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const { seriesSlug, chapterSlug, numericId } = this.parseChapterId(chapterId);
		if (!numericId && (!seriesSlug || !chapterSlug)) {
			console.error('[hivetoons] getChapterPages → bad id:', chapterId);
			return [];
		}

		if (numericId) {
			try {
				const data = await this.apiGet<{
					chapter?: {
						images?: Array<{ url: string; order?: number }>;
						isLockedByCoins?: boolean;
						isShortLinkLocked?: boolean;
						isPermanentlyLocked?: boolean;
					};
				}>(`/api/chapter?chapterId=${encodeURIComponent(numericId)}`);

				const ch = data?.chapter;
				if (ch?.isLockedByCoins || ch?.isShortLinkLocked || ch?.isPermanentlyLocked) {
					console.warn('[hivetoons] chapter locked:', chapterId);
					return [];
				}

				const images = (ch?.images || [])
					.slice()
					.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
					.map((img) => img.url)
					.filter(Boolean);

				if (images.length > 0) {
					console.log(
						`[hivetoons] ${images.length} pages → chapterId=${numericId}`
					);
					return images;
				}
			} catch (e) {
				console.error('[hivetoons] API chapter pages failed', chapterId, e);
			}
		}

		if (seriesSlug && chapterSlug) {
			try {
				const path = `/series/${encodeURIComponent(seriesSlug)}/${encodeURIComponent(chapterSlug)}`;
				const html = await this.fetchHtml(path);
				const re =
					/https:\/\/storage\.hivetoon\.com\/[^"'\s>]+\.(?:jpg|jpeg|png|webp|gif)/gi;
				const found = html.match(re) || [];
				const urls: string[] = [];
				const seen = new Set<string>();
				for (const u of found) {
					if (!u.includes('/upload/series/')) continue;
					if (seen.has(u)) continue;
					seen.add(u);
					urls.push(u);
				}
				urls.sort((a, b) => {
					const na = a.match(/page-0*(\d+)/i)?.[1] || a.match(/\/(\d{3,})[-_]/)?.[1] || '0';
					const nb = b.match(/page-0*(\d+)/i)?.[1] || b.match(/\/(\d{3,})[-_]/)?.[1] || '0';
					return parseInt(na, 10) - parseInt(nb, 10);
				});
				console.log(
					`[hivetoons] HTML fallback ${urls.length} pages → ${seriesSlug}/${chapterSlug}`
				);
				return urls;
			} catch (e) {
				console.error('[hivetoons] HTML fallback failed', chapterId, e);
			}
		}

		return [];
	}
}
