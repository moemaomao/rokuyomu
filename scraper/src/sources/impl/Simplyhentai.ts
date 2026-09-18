import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails } from '../types';

/**
 * simply-hentai.com adapter (API v3)
 *
 * List     : GET /v3/mangas?page=N&sort=newest
 * Search   : GET /v3/mangas?page=N&query=...
 * Detail   : GET /v3/manga/{slug}
 * Pages    : data.images[]  atau  GET /v3/manga/{slug}/pages
 *
 * Web UI   : https://www.simply-hentai.com/web2
 * Gallery  : https://www.simply-hentai.com/{seriesSlug}/{slug}
 *
 * ID format : "/{slug}"
 * Update    : created_at (ISO) → chapter.date + description
 */
export class SimplyHentaiSource extends BaseSource {
	id = 'simplyhentai';
	name = 'Simply Hentai';
	baseUrl = 'https://www.simply-hentai.com';
	private readonly api = 'https://api-v3.simply-hentai.com/v3';

	// ── HTTP ─────────────────────────────────────────────────────────────────

	/** Jangan namai `headers` — bentrok BaseSource */
	private h(extra?: Record<string, string>): Record<string, string> {
		return {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
			Accept: 'application/json, text/plain, */*',
			'Accept-Language': 'en-US,en;q=0.9',
			Referer: `${this.baseUrl}/`,
			Origin: this.baseUrl,
			...extra
		};
	}

	private async getJson<T = any>(url: string): Promise<T> {
		const res = await fetch(url, {
			headers: this.h(),
			redirect: 'follow'
		});
		if (!res.ok) {
			throw new Error(`HTTP ${res.status} → ${url}`);
		}
		const text = await res.text();
		if (
			text.includes('Just a moment') ||
			text.includes('cf-browser-verification') ||
			text.includes('challenge-platform')
		) {
			throw new Error('Cloudflare challenge — simply-hentai blocked');
		}
		return JSON.parse(text) as T;
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private toId(slug: string): string {
		return `/${String(slug).replace(/^\/+|\/+$/g, '')}`;
	}

	private extractSlug(mangaId: string): string {
		return (
			String(mangaId)
				.replace(/^\/+|\/+$/g, '')
				.split('/')
				.filter(Boolean)
				.pop() || ''
		);
	}

	/** ISO / datetime → YYYY-MM-DD */
	private formatDate(raw: any): string {
		if (!raw) return '';
		try {
			const d = new Date(raw);
			if (Number.isNaN(d.getTime())) return String(raw).slice(0, 10);
			return d.toISOString().slice(0, 10);
		} catch {
			return String(raw).slice(0, 10);
		}
	}

	private titlesFromTags(list: any[] | undefined): string[] {
		if (!Array.isArray(list)) return [];
		return list
			.map((t) => String(t?.title || t?.name || t?.slug || '').trim())
			.filter(Boolean);
	}

	private coverFromAlbum(g: any): string {
		return (
			g?.preview?.sizes?.full ||
			g?.preview?.sizes?.large ||
			g?.preview?.sizes?.medium ||
			g?.preview?.url ||
			g?.cover ||
			g?.thumbnail ||
			''
		);
	}

	private toMangaFromAlbum(g: any): Manga | null {
		const slug = String(g?.slug || '').trim();
		if (!slug) return null;

		const title =
			g?.title || g?.name || g?.english_title || slug.replace(/-/g, ' ');

		return {
			id: this.toId(slug),
			sourceId: this.id,
			title: String(title),
			cover: this.coverFromAlbum(g),
			type: 'manga',
			status: 'Completed'
		};
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	/**
	 * Latest / newest — sync update lewat sort=newest + created_at
	 * Endpoint mirror UI /web2 & /2-mangas
	 */
	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const url = `${this.api}/mangas?page=${p}&sort=newest`;
			const data = await this.getJson<{
				data?: any[] | { albums?: any[] };
				pagination?: { pages?: number };
			}>(url);

			const raw = data?.data;
			const list = Array.isArray(raw)
				? raw
				: Array.isArray((raw as any)?.albums)
					? (raw as any).albums
					: [];

			const out = list
				.map((g: any) => this.toMangaFromAlbum(g))
				.filter(Boolean) as Manga[];

			console.log(`[simplyhentai] latest page=${p} → ${out.length} items`);
			return out;
		} catch (e) {
			console.error('[simplyhentai] getLatestManga', e);
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
			const url = `${this.api}/mangas?page=${page}&query=${encodeURIComponent(q)}&sort=newest`;
			const data = await this.getJson<{
				data?: any[] | { albums?: any[] };
			}>(url);

			const raw = data?.data;
			const list = Array.isArray(raw)
				? raw
				: Array.isArray((raw as any)?.albums)
					? (raw as any).albums
					: [];

			const out = list
				.map((g: any) => this.toMangaFromAlbum(g))
				.filter(Boolean) as Manga[];

			console.log(`[simplyhentai] search "${q}" → ${out.length} items`);
			return out;
		} catch (e) {
			console.error('[simplyhentai] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) throw new Error(`Invalid simplyhentai id: ${mangaId}`);

		const data = await this.getJson<{ data: any }>(
			`${this.api}/manga/${encodeURIComponent(slug)}`
		);
		const g = data?.data;
		if (!g) throw new Error(`simplyhentai not found: ${slug}`);

		const title = String(g.title || g.name || slug);
		const cover = this.coverFromAlbum(g);
		const updated = this.formatDate(g.created_at || g.updated_at || g.date);

		const artists = this.titlesFromTags(g.artists);
		const tags = this.titlesFromTags(g.tags);
		const characters = this.titlesFromTags(g.characters);
		const parodies = this.titlesFromTags(g.parodies);
		const translators = this.titlesFromTags(g.translators);
		const language =
			g.language?.name || g.language?.title || g.lang || '';
		const seriesTitle = g.series?.title || g.series?.slug || '';
		const pageCount = Number(g.image_count || g.pages || 0) || 0;

		const genres = [
			...tags,
			...parodies.map((p) => `parody:${p}`),
			...characters.map((c) => `character:${c}`)
		];

		return {
			id: this.toId(slug),
			sourceId: this.id,
			title,
			cover,
			type: seriesTitle ? 'doujinshi' : 'manga',
			status: 'Completed',
			description: [
				seriesTitle && `Series: ${seriesTitle}`,
				language && `Language: ${language}`,
				artists.length && `Artists: ${artists.join(', ')}`,
				translators.length && `Translators: ${translators.join(', ')}`,
				pageCount && `Pages: ${pageCount}`,
				updated && `Updated: ${updated}`
			]
				.filter(Boolean)
				.join('\n'),
			authors: artists,
			genres,
			chapters: [
				{
					id: this.toId(slug),
					title: 'Read',
					number: 1,
					date: updated
				}
			]
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const slug = this.extractSlug(chapterId);
		if (!slug) {
			console.error('[simplyhentai] getChapterPages → empty slug:', chapterId);
			return [];
		}

		try {
			const detail = await this.getJson<{ data: any }>(
				`${this.api}/manga/${encodeURIComponent(slug)}`
			);
			const g = detail?.data;
			if (!g) return [];

			let images: any[] = Array.isArray(g.images) ? g.images : [];

			// Gallery besar: pages di endpoint terpisah
			const count = Number(g.image_count || images.length || 0);
			if (count > 12 || !images.length) {
				try {
					const pagesData = await this.getJson<{
						data?: { pages?: any[] } | any[];
					}>(`${this.api}/manga/${encodeURIComponent(slug)}/pages`);

					const raw = pagesData?.data;
					if (Array.isArray(raw)) {
						images = raw;
					} else if (Array.isArray((raw as any)?.pages)) {
						images = (raw as any).pages;
					}
				} catch (e) {
					console.warn('[simplyhentai] /pages fallback failed', e);
				}
			}

			const urls = images
				.map((img: any) => {
					if (typeof img === 'string') return img;
					return (
						img?.sizes?.full ||
						img?.sizes?.large ||
						img?.full ||
						img?.url ||
						''
					);
				})
				.filter(Boolean);

			console.log(`[simplyhentai] ${urls.length} pages → ${slug}`);
			return urls;
		} catch (e) {
			console.error('[simplyhentai] getChapterPages failed', slug, e);
			return [];
		}
	}
}
