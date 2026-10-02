/**
 * KappaBeast adapter (https://kappabeast.com)
 *
 * SPA + Strapi API:
 *   Base API : https://api.kappabeast.com/api/content
 *   Media    : https://strapi.kappabeast.com
 *
 * Latest Updates : GET /chapters?sort[0]=updatedAt:desc&populate[manga]...
 * Search         : GET /mangas?filters[title][$containsi]=...
 * Detail         : GET /mangas?filters[slug][$eq]=...
 * Chapters       : GET /chapters?filters[manga][documentId][$eq]=...
 * Pages          : chapter.htmlContent → <img> / blogger full-size links
 *
 * ID format:
 *   manga   : /series/{slug}
 *   chapter : /series/{slug}/chapter/{number}
 *
 * Bahasa default: English
 */

import { BaseSource } from '../../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';

export class KappaBeastSource extends BaseSource {
	id = 'kappabeast';
	name = 'KappaBeast';
	baseUrl = 'https://kappabeast.com';

	private readonly apiBase = 'https://api.kappabeast.com/api/content';
	private readonly mediaBase = 'https://strapi.kappabeast.com';
	/** Public key dari frontend bundle kappabeast.com */
	private readonly apiKey =
		'd3cb8e38cd5dab862cf7EME9M9cSy9FvfHvcx2gMPkp1H5Dj4YaKufPRsAyon8Tf';

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
			for (const [k, v] of Object.entries(params)) {
				if (v === undefined || v === null || v === '') continue;
				url.searchParams.set(k, String(v));
			}
		}

		const res = await fetch(url.toString(), {
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				'X-API-Key': this.apiKey,
				Origin: this.baseUrl,
				Referer: `${this.baseUrl}/`,
				'User-Agent':
					this.headers['User-Agent'] ||
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
			}
		});

		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new Error(
				`KappaBeast HTTP ${res.status} ${url.pathname}: ${text.slice(0, 200)}`
			);
		}

		return (await res.json()) as T;
	}

	// ── Helpers ────────────────────────────────

	private toMangaId(slug: string): string {
		const s = String(slug || '')
			.replace(/^\/+|\/+$/g, '')
			.replace(/^series\//i, '');
		return `/series/${s}`;
	}

	private extractSlug(mangaId: string): string {
		const s = String(mangaId).replace(/^\/+/, '');
		const m = s.match(/^series\/([^/]+)/i);
		if (m) return m[1]!;
		return s.split('/').filter(Boolean).pop() || '';
	}

	private toChapterId(slug: string, number: number | string): string {
		return `/series/${slug}/chapter/${number}`;
	}

	private extractChapterParts(chapterId: string): {
		slug: string;
		number: string;
	} {
		const s = String(chapterId).replace(/^\/+/, '');
		const m = s.match(/^series\/([^/]+)\/chapter\/(.+)$/i);
		if (m) return { slug: m[1]!, number: m[2]! };
		const parts = s.split('/').filter(Boolean);
		return {
			slug: parts[0] === 'series' ? parts[1] || '' : parts[0] || '',
			number: parts[parts.length - 1] || ''
		};
	}

	private absMedia(url?: string | null): string {
		if (!url) return '';
		if (url.startsWith('http')) return url;
		if (url.startsWith('//')) return `https:${url}`;
		return `${this.mediaBase}${url.startsWith('/') ? '' : '/'}${url}`;
	}

	private pickCover(manga: any): string {
		const media = Array.isArray(manga?.media) ? manga.media : [];
		for (const block of media) {
			const img = block?.coverImage;
			if (!img) continue;
			// prefer full → medium → small → thumbnail
			const url =
				img.url ||
				img.formats?.medium?.url ||
				img.formats?.small?.url ||
				img.formats?.thumbnail?.url;
			if (url) return this.absMedia(url);
		}
		return '';
	}

	private mapStatus(raw?: string | null): string {
		const s = String(raw || '').toLowerCase();
		if (/complete|finished|end/.test(s)) return 'Completed';
		if (/hiatus/.test(s)) return 'Hiatus';
		if (/cancel|drop/.test(s)) return 'Cancelled';
		return 'Ongoing';
	}

	private mapType(raw?: string | null): string {
		const t = String(raw || '').toLowerCase();
		if (t.includes('manhwa')) return 'manhwa';
		if (t.includes('manhua')) return 'manhua';
		if (t.includes('novel')) return 'novel';
		return 'manga';
	}

	private formatDate(iso?: string | null): string {
		if (!iso) return '';
		try {
			return new Date(iso).toISOString().slice(0, 10);
		} catch {
			return String(iso).slice(0, 10);
		}
	}

	private mapMangaFromApi(m: any, latestChapter?: string | number): Manga | null {
		const slug = m?.slug;
		const title = String(m?.title || '').trim();
		if (!slug || !title) return null;

		return {
			id: this.toMangaId(slug),
			sourceId: this.id,
			title,
			cover: this.pickCover(m),
			type: this.mapType(m?.type),
			status: this.mapStatus(m?.manga_status),
			latestChapter:
				latestChapter != null && latestChapter !== ''
					? String(latestChapter)
					: undefined,
			lang: this.DEFAULT_LANG
		} as Manga & { lang?: string };
	}

	/** Extract full-size page URLs from chapter htmlContent */
	private parsePagesFromHtml(html: string): string[] {
		const images: string[] = [];
		const seen = new Set<string>();

		const push = (src: string) => {
			src = (src || '').trim();
			if (!src || seen.has(src)) return;
			// upgrade blogger thumbnail /s320/ → /s0/ or /s1600/
			src = src
				.replace(/\/s\d+\//g, '/s0/')
				.replace(/\/w\d+-h\d+\//g, '/s0/');
			if (!/^https?:\/\//i.test(src)) return;
			if (/logo|icon|avatar|emoji|spinner|ads/i.test(src)) return;
			seen.add(src);
			images.push(src);
		};

		// Prefer full-size link href around each img
		const hrefRe =
			/<a[^>]+href=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["'][^>]*>\s*<img/gi;
		let m: RegExpExecArray | null;
		while ((m = hrefRe.exec(html)) !== null) {
			push(m[1]!);
		}

		// Fallback: img src / data-src
		const imgRe =
			/<img[^>]+(?:data-src|src)=["'](https?:\/\/[^"']+)["']/gi;
		while ((m = imgRe.exec(html)) !== null) {
			push(m[1]!);
		}

		return images;
	}

	// ── Catalog (Latest Updates) ─────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		const p = Math.max(1, Number(page) || 1);

		try {
			// Ambil chapter terbaru (sama seperti section Latest Updates),
			// lalu dedupe per manga.
			const pageSize = 50;
			const data = await this.apiGet<{ data?: any[] }>('/chapters', {
				'populate[manga][populate][media][populate]': '*',
				'populate[manga][populate][category][fields][0]': 'name',
				'sort[0]': 'updatedAt:desc',
				'pagination[page]': p,
				'pagination[pageSize]': pageSize
			});

			const rows = Array.isArray(data?.data) ? data.data : [];
			const seen = new Set<string>();
			const list: Manga[] = [];

			for (const ch of rows) {
				const manga = ch?.manga;
				if (!manga?.slug) continue;
				const id = this.toMangaId(manga.slug);
				if (seen.has(id)) continue;
				seen.add(id);

				const mapped = this.mapMangaFromApi(manga, ch?.number);
				if (mapped) list.push(mapped);
				if (list.length >= this.PER_PAGE) break;
			}

			console.log(
				`[kappabeast] latest page=${p} → ${list.length} (from ${rows.length} chapters)`
			);
			return list;
		} catch (e) {
			console.error('[kappabeast] getLatestManga', e);
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
			const data = await this.apiGet<{ data?: any[] }>('/mangas', {
				'filters[title][$containsi]': q,
				'populate[media][populate]': '*',
				'populate[category][fields][0]': 'name',
				'pagination[page]': page,
				'pagination[pageSize]': this.PER_PAGE
			});

			const rows = Array.isArray(data?.data) ? data.data : [];
			const list = rows
				.map((m) => this.mapMangaFromApi(m))
				.filter(Boolean) as Manga[];

			console.log(`[kappabeast] search "${q}" page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[kappabeast] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) throw new Error(`Invalid kappabeast id: ${mangaId}`);

		const mangaRes = await this.apiGet<{ data?: any[] }>('/mangas', {
			'filters[slug][$eq]': slug,
			'populate[media][populate]': '*',
			'populate[category][fields][0]': 'name'
		});

		const manga = (mangaRes?.data || [])[0];
		if (!manga) throw new Error(`Manga not found: ${slug}`);

		const documentId = manga.documentId || manga.id;
		const title = String(manga.title || slug).trim();
		const cover = this.pickCover(manga);
		const status = this.mapStatus(manga.manga_status);
		const type = this.mapType(manga.type);
		const description = String(manga.description || '')
			.replace(/\s+/g, ' ')
			.trim();

		const authors: string[] = [];
		for (const name of [manga.author, manga.artist]) {
			const n = String(name || '').trim();
			if (n && n !== '-' && !authors.includes(n)) authors.push(n);
		}

		const genres: string[] = [];
		for (const g of manga.category || []) {
			const name = String(g?.name || g || '').trim();
			if (name && name.length < 40 && !genres.includes(name)) genres.push(name);
		}

		// Semua chapter
		const chRes = await this.apiGet<{ data?: any[] }>('/chapters', {
			'filters[manga][documentId][$eq]': documentId,
			'sort[0]': 'number:asc',
			'pagination[pageSize]': 500
		});

		// fallback filter by numeric id
		let chRows = Array.isArray(chRes?.data) ? chRes.data : [];
		if (!chRows.length && manga.id) {
			const chRes2 = await this.apiGet<{ data?: any[] }>('/chapters', {
				'filters[manga][id][$eq]': manga.id,
				'sort[0]': 'number:asc',
				'pagination[pageSize]': 500
			});
			chRows = Array.isArray(chRes2?.data) ? chRes2.data : [];
		}

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		for (const ch of chRows) {
			const num = Number(ch?.number);
			if (!Number.isFinite(num)) continue;
			const id = this.toChapterId(slug, num);
			if (seen.has(id)) continue;
			seen.add(id);

			const chTitle =
				String(ch?.title || '').trim() || `Chapter ${num}`;

			chapters.push({
				id,
				title: chTitle,
				number: num,
				date: this.formatDate(ch?.publishedAt || ch?.createdAt)
			});
		}

		chapters.sort((a, b) => (a.number || 0) - (b.number || 0));

		const latestChapter = chapters.length
			? String(chapters[chapters.length - 1].number)
			: undefined;

		const alt = String(manga.altTitle || '')
			.split('\n')
			.map((s: string) => s.trim())
			.filter(Boolean)
			.join(' · ');

		const metaLines = [
			alt && `Alternative: ${alt}`,
			authors.length && `Author: ${authors.join(' · ')}`,
			manga.releaseYear && `Year: ${manga.releaseYear}`,
			`Language: English`,
			`Type: ${type}`
		].filter(Boolean);

		console.log(`[kappabeast] details ${slug} → ch=${chapters.length}`);

		return {
			id: this.toMangaId(slug),
			sourceId: this.id,
			title,
			cover,
			type,
			status,
			description: [...metaLines, description].filter(Boolean).join('\n'),
			authors,
			genres,
			chapters,
			latestChapter
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const { slug, number } = this.extractChapterParts(chapterId);
		if (!slug || !number) {
			console.error('[kappabeast] getChapterPages bad id:', chapterId);
			return [];
		}

		try {
			// Resolve manga documentId
			const mangaRes = await this.apiGet<{ data?: any[] }>('/mangas', {
				'filters[slug][$eq]': slug,
				'pagination[pageSize]': 1
			});
			const manga = (mangaRes?.data || [])[0];
			if (!manga) {
				console.error('[kappabeast] manga not found for pages', slug);
				return [];
			}

			const docId = manga.documentId || manga.id;
			const chRes = await this.apiGet<{ data?: any[] }>('/chapters', {
				'filters[manga][documentId][$eq]': docId,
				'filters[number][$eq]': number,
				'pagination[pageSize]': 1
			});

			let ch = (chRes?.data || [])[0];
			if (!ch && manga.id) {
				const chRes2 = await this.apiGet<{ data?: any[] }>('/chapters', {
					'filters[manga][id][$eq]': manga.id,
					'filters[number][$eq]': number,
					'pagination[pageSize]': 1
				});
				ch = (chRes2?.data || [])[0];
			}

			if (!ch) {
				console.error('[kappabeast] chapter not found', slug, number);
				return [];
			}

			const html = String(ch.htmlContent || '');
			const images = this.parsePagesFromHtml(html);

			console.log(
				`[kappabeast] ${images.length} pages → ${slug}/chapter/${number}`
			);
			return images;
		} catch (e) {
			console.error('[kappabeast] getChapterPages failed', slug, number, e);
			return [];
		}
	}
}