import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';

/**
 * Comicaso (v3.comicaso.pro) adapter – API based + challenge cookie
 *
 * List/Search : GET https://api.comicaso.pro/home.php
 * Detail      : GET https://api.comicaso.pro/manga.php  (perlu cookie challenge)
 * Chapter     : GET https://api.comicaso.pro/chapter.php (perlu cookie + token)
 *
 * Env:
 *   COMICASO_COOKIE = "comicaso_public_sid=...; comicaso_human=..."
 *
 * Source katalog:
 *   comicazen = Umum (default)
 *   medusa    = Dewasa
 *
 * ID format:
 *   manga   : "/{source}/{slug}"
 *   chapter : "/{source}/{mangaSlug}/{chapterSlug}"
 *
 * Bahasa default: Indonesian
 */
export class ComicasoSource extends BaseSource {
	id = 'comicaso';
	name = 'Comicaso';
	baseUrl = 'https://v3.comicaso.pro';

	private readonly apiBase = 'https://api.comicaso.pro';
	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'id';
	private readonly DEFAULT_SOURCE = 'comicazen';

	// ── Cookie ───────────────────────────────────────────────────────────────

private getCookie(): string {
	const raw =
		(typeof process !== 'undefined' ? process.env?.COMICASO_COOKIE : undefined) ||
		'';
	return String(raw).trim();
}

	// ── HTTP ─────────────────────────────────────────────────────────────────

	private async apiGet<T = any>(
	path: string,
	params?: Record<string, string | number | undefined | null>
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

	const cookie =
		(typeof process !== 'undefined' ? process.env?.COMICASO_COOKIE : '') ||
		'comicaso_public_sid=021f8f1924fa7253a275a291108b0ef6; comicaso_human=eyJraW5kIjoiaHVtYW4iLCJleHAiOjE3ODk0MTE5NDEsImN0eCI6ImE0ZWYxZjBmMGJiZGViM2E2ZmIzNTMyNmExZTE3M2RkZDhiYzM4M2FjMzAxNzAwMzZiOGQxMjE0M2E5YmY4M2QiLCJjdHh2IjoicHMxIn0.18710d083d395a42f8b6ca35fbefe6437a240231970052d08c591f09ada0bc39';

	const headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
		Accept: 'application/json, text/plain, */*',
		'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
		Origin: this.baseUrl,
		Referer: `${this.baseUrl}/`,
		'Cache-Control': 'no-cache',
		Cookie: cookie
	};

	const res = await fetch(url.toString(), { headers });
	const text = await res.text();
	let json: any;
	try {
		json = JSON.parse(text);
	} catch {
		console.error('[comicaso] invalid JSON', text.slice(0, 200));
		throw new Error('Comicaso invalid JSON');
	}

	if (json?.need_challenge) {
		throw new Error(
			'Comicaso cookie expired / invalid. Ambil cookie baru dari DevTools (comicaso_public_sid + comicaso_human).'
		);
	}

	if (!res.ok || json?.ok === false) {
		throw new Error(json?.message || `Comicaso HTTP ${res.status}`);
	}

	return json as T;
}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private toMangaId(source: string, slug: string): string {
		const s =
			String(source || this.DEFAULT_SOURCE).trim() || this.DEFAULT_SOURCE;
		const sl = String(slug || '').replace(/^\/+|\/+$/g, '');
		return `/${s}/${sl}`;
	}

	private parseMangaId(mangaId: string): { source: string; slug: string } {
		const parts = String(mangaId)
			.replace(/^\/+/, '')
			.split('/')
			.filter(Boolean);
		if (parts.length >= 2) {
			return { source: parts[0], slug: parts[1] };
		}
		return { source: this.DEFAULT_SOURCE, slug: parts[0] || '' };
	}

	private toChapterId(
		source: string,
		mangaSlug: string,
		chapterSlug: string
	): string {
		return `/${source}/${mangaSlug}/${chapterSlug}`;
	}

	private parseChapterId(chapterId: string): {
		source: string;
		mangaSlug: string;
		chapterSlug: string;
	} {
		const parts = String(chapterId)
			.replace(/^\/+/, '')
			.split('/')
			.filter(Boolean);
		return {
			source: parts[0] || this.DEFAULT_SOURCE,
			mangaSlug: parts[1] || '',
			chapterSlug: parts.slice(2).join('/') || ''
		};
	}

	private mapStatus(status?: string | null): string {
		const s = String(status || '').toLowerCase();
		if (/end|complete|tamat|finished/.test(s)) return 'Completed';
		if (/hiatus/.test(s)) return 'Hiatus';
		return 'Ongoing';
	}

	private mapType(type?: string | null): string {
		const t = String(type || '').toLowerCase();
		if (t.includes('manhwa')) return 'manhwa';
		if (t.includes('manhua')) return 'manhua';
		return 'manga';
	}

	private parseChapterNumber(raw: unknown): number {
		const s = String(raw ?? '');
		const m =
			s.match(/(?:chapter|ch\.?)\s*(\d+(?:[.,]\d+)?)/i) ||
			s.match(/(\d+(?:[.,]\d+)?)/);
		if (!m) return 0;
		return parseFloat(m[1].replace(',', '.')) || 0;
	}

	private formatDate(raw: unknown): string {
		if (raw == null || raw === '') return '';
		// unix seconds
		if (typeof raw === 'number' || /^\d{10,13}$/.test(String(raw))) {
			const n = Number(raw);
			const ms = n < 1e12 ? n * 1000 : n;
			try {
				return new Date(ms).toISOString().slice(0, 10);
			} catch {
				return String(raw);
			}
		}
		const s = String(raw);
		if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
		return s;
	}

	private resolveCatalogSource(opts?: {
		lang?: string;
		type?: string;
	}): string {
		const t = String(opts?.type || '').toLowerCase();
		if (t === 'medusa' || t === 'adult' || t === 'dewasa') return 'medusa';
		return this.DEFAULT_SOURCE;
	}

	private mapListItem(item: any): Manga | null {
		const slug = String(item?.slug || '').trim();
		const title = String(item?.title || '').trim();
		if (!slug || !title) return null;

		const source = String(item?.source || this.DEFAULT_SOURCE).trim();
		const latestRaw =
			item?.latest_chapter_title ||
			item?.latest_chapter ||
			item?.last_chapter ||
			'';
		const latestNum = this.parseChapterNumber(latestRaw);

		return {
			id: this.toMangaId(source, slug),
			sourceId: this.id,
			title,
			cover: String(item?.thumbnail || ''),
			type: this.mapType(item?.type),
			status: this.mapStatus(item?.status),
			latestChapter: latestNum > 0 ? latestNum : undefined,
			lang: this.DEFAULT_LANG
		} as Manga & { lang?: string };
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		const p = Math.max(1, Number(page) || 1);
		const offset = (p - 1) * this.PER_PAGE;
		const source = this.resolveCatalogSource(opts);

		try {
			const json = await this.apiGet<{ data?: any[] }>('/home.php', {
				source,
				q: '',
				mode: 'update',
				type: 'all',
				limit: this.PER_PAGE,
				offset,
				platform: 'web'
			});

			const rows = Array.isArray(json?.data) ? json.data : [];
			const list = rows
				.map((it) => this.mapListItem(it))
				.filter(Boolean) as Manga[];

			console.log(
				`[comicaso] latest page=${p} source=${source} → ${list.length}`
			);
			return list;
		} catch (e) {
			console.error('[comicaso] getLatestManga', e);
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

		const offset = (page - 1) * this.PER_PAGE;
		const source = this.resolveCatalogSource(opts);

		try {
			const json = await this.apiGet<{ data?: any[] }>('/home.php', {
				source,
				q,
				mode: 'update',
				type: 'all',
				limit: this.PER_PAGE,
				offset,
				platform: 'web'
			});

			const rows = Array.isArray(json?.data) ? json.data : [];
			const list = rows
				.map((it) => this.mapListItem(it))
				.filter(Boolean) as Manga[];

			console.log(
				`[comicaso] search "${q}" page=${page} → ${list.length}`
			);
			return list;
		} catch (e) {
			console.error('[comicaso] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const { source, slug } = this.parseMangaId(mangaId);
		if (!slug) throw new Error(`Invalid comicaso id: ${mangaId}`);

		const json = await this.apiGet<any>('/manga.php', {
			source,
			slug,
			platform: 'web'
		});

		const data = json?.data || json?.manga || {};
		const title = String(data.title || slug).trim();
		const cover = String(data.thumbnail || data.cover || '');
		const status = this.mapStatus(data.status);
		const type = this.mapType(data.type);
		const description = String(data.synopsis || '')
			.replace(/<[^>]+>/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();

		const authors: string[] = [];
		for (const name of [data.author, data.artist]) {
			const n = String(name || '').trim();
			if (n && n !== '-' && !authors.includes(n)) authors.push(n);
		}

		const genres: string[] = [];
		for (const g of data.genres || []) {
			const name = String(typeof g === 'string' ? g : g?.name || '').trim();
			if (name && name.length < 40 && !genres.includes(name)) {
				genres.push(name);
			}
		}

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		const rawChapters = Array.isArray(data.chapters) ? data.chapters : [];

		for (const ch of rawChapters) {
			const chSlug = String(ch?.slug || ch?.chapter_slug || '').trim();
			if (!chSlug || seen.has(chSlug)) continue;
			seen.add(chSlug);

			const chTitle =
				String(ch?.title || ch?.chapter_title || '').trim() || chSlug;
			const number =
				this.parseChapterNumber(ch?.number ?? chTitle) ||
				chapters.length + 1;

			chapters.push({
				id: this.toChapterId(source, slug, chSlug),
				title: chTitle,
				number,
				date: this.formatDate(ch?.date || ch?.updated_at || ch?.created_at)
			});
		}

		chapters.sort((a, b) => a.number - b.number);

		console.log(
			`[comicaso] details ${source}/${slug} → ch=${chapters.length}`
		);

		return {
			id: this.toMangaId(source, slug),
			sourceId: this.id,
			title,
			cover,
			type,
			status,
			description,
			authors,
			genres,
			chapters,
			latestChapter: chapters.length
				? chapters[chapters.length - 1].number
				: undefined
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const { source, mangaSlug, chapterSlug } =
			this.parseChapterId(chapterId);

		if (!source || !mangaSlug || !chapterSlug) {
			console.error('[comicaso] getChapterPages bad id:', chapterId);
			return [];
		}

		let token = '';
		try {
			const detail = await this.apiGet<any>('/manga.php', {
				source,
				slug: mangaSlug,
				platform: 'web'
			});
			const data = detail?.data || detail?.manga || {};
			const chapters = Array.isArray(data.chapters) ? data.chapters : [];
			const found = chapters.find(
				(c: any) =>
					String(c?.slug || c?.chapter_slug || '') === chapterSlug
			);
			token = String(found?.chapter_token || found?.token || '').trim();
		} catch (e) {
			console.warn('[comicaso] gagal ambil chapter token', e);
		}

		const params: Record<string, string> = {
			source,
			manga: mangaSlug,
			chapter: chapterSlug,
			platform: 'web'
		};
		if (token) params.token = token;

		const json = await this.apiGet<any>('/chapter.php', params);
		const chapter = json?.data || json?.chapter || {};
		const images = Array.isArray(chapter.images) ? chapter.images : [];

		const pages = images
			.map((img: any) =>
				typeof img === 'string'
					? img
					: String(img?.url || img?.src || img?.image || '')
			)
			.filter((u: string) => !!u && /^https?:\/\//i.test(u));

		console.log(
			`[comicaso] ${pages.length} pages → ${source}/${mangaSlug}/${chapterSlug}`
		);
		return pages;
	}
}