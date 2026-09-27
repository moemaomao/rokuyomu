/**
 * Ainz Scans ID adapter (v3 API)
 *
 * List/Latest : GET /api/comic/latest-updates?limit=
 * Search      : GET /api/search?q=&page=&limit=
 * Detail      : GET /api/series/comic/{slug}
 * Chapters    : GET /api/series/comic/{slug}/chapters?page=&limit=
 * Pages       : GET /api/series/comic/{slug}/chapter/{chapterSlug}
 *               → chapter.pages[].image_url
 *
 * ID format:
 *   manga   : "/comic/{slug}"
 *   chapter : "/comic/{slug}/chapter/{chapterSlug}"
 *
 * Bahasa default: Indonesian (badge homepage = ID)
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';

export class AinzScansSource extends BaseSource {
	id = 'ainzscans';
	name = 'Ainz Scans';
	baseUrl = 'https://v3.ainzscans01.com';

	private readonly apiBase = 'https://v3.ainzscans01.com';
	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'id';

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
			'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
			Origin: this.baseUrl,
			Referer: `${this.baseUrl}/`,
			'Cache-Control': 'no-cache'
		};

		const maxAttempts = 3;
		let lastErr: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const res = await fetch(url.toString(), { headers });
				const text = await res.text();
				const trimmed = text.trim();

				if (
					trimmed.startsWith('<') ||
					trimmed.toLowerCase().includes('<!doctype')
				) {
					console.error(
						`[ainzscans] HTML response attempt=${attempt}`,
						url.pathname,
						trimmed.slice(0, 120)
					);
					lastErr = new Error('AinzScans blocked: response is HTML, not JSON');
					await new Promise((r) => setTimeout(r, 400 * attempt));
					continue;
				}

				if (!res.ok) {
					console.error(
						`[ainzscans] HTTP ${res.status} ${url.pathname}`,
						trimmed.slice(0, 300)
					);
					if (res.status === 429 || res.status === 503) {
						lastErr = new Error(`AinzScans HTTP ${res.status}`);
						await new Promise((r) => setTimeout(r, 600 * attempt));
						continue;
					}
					throw new Error(`AinzScans HTTP ${res.status}`);
				}

				try {
					return JSON.parse(trimmed) as T;
				} catch {
					console.error('[ainzscans] invalid JSON', trimmed.slice(0, 200));
					throw new Error('AinzScans invalid JSON');
				}
			} catch (e) {
				lastErr = e;
				if (attempt < maxAttempts) {
					await new Promise((r) => setTimeout(r, 400 * attempt));
					continue;
				}
			}
		}

		throw lastErr instanceof Error
			? lastErr
			: new Error('AinzScans request failed');
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private toMangaId(slug: string): string {
		const s = String(slug || '')
			.replace(/^\/+|\/+$/g, '')
			.replace(/^comic\//i, '');
		return `/comic/${s}`;
	}

	private extractSlug(mangaId: string): string {
		const parts = String(mangaId)
			.replace(/^\/+/, '')
			.split('/')
			.filter(Boolean);
		if (parts[0]?.toLowerCase() === 'comic' && parts[1]) return parts[1];
		return parts[0] || '';
	}

	private toChapterId(seriesSlug: string, chapterSlug: string): string {
		return `/comic/${seriesSlug}/chapter/${chapterSlug}`;
	}

	private extractChapterParts(chapterId: string): {
		seriesSlug: string;
		chapterSlug: string;
	} {
		const s = String(chapterId).replace(/^\/+/, '');
		const m = s.match(/^comic\/([^/]+)\/chapter\/(.+)$/i);
		if (m) return { seriesSlug: m[1], chapterSlug: m[2] };
		const parts = s.split('/').filter(Boolean);
		return {
			seriesSlug: parts[0] === 'comic' ? parts[1] || '' : parts[0] || '',
			chapterSlug: parts[parts.length - 1] || ''
		};
	}

	private mapStatus(status?: string | null): string {
		const s = String(status || '').toUpperCase();
		if (s === 'COMPLETED' || s === 'COMPLETE' || s === 'SELESAI')
			return 'Completed';
		if (s === 'HIATUS') return 'Hiatus';
		if (s === 'CANCELLED' || s === 'DROPPED') return 'Cancelled';
		return 'Ongoing';
	}

	private mapType(subtype?: string | null): string {
		const t = String(subtype || '').toUpperCase();
		if (t === 'MANHWA') return 'manhwa';
		if (t === 'MANHUA') return 'manhua';
		if (t === 'MANGA') return 'manga';
		return 'manhua';
	}

	private formatDate(iso?: string | null): string {
		if (!iso) return '';
		try {
			return new Date(iso).toISOString().slice(0, 10);
		} catch {
			return String(iso).slice(0, 10);
		}
	}

	private parseChapterNumber(raw: unknown): number {
		const n = parseFloat(String(raw ?? ''));
		return Number.isFinite(n) ? n : NaN;
	}

	private mapListFromLatest(item: any): Manga | null {
		const slug = item?.series_slug;
		const title = String(item?.series_title || '').trim();
		if (!slug || !title) return null;

		const chs = Array.isArray(item?.chapters) ? item.chapters : [];
		const latestRaw = chs[0]?.number;
		const latestNum = this.parseChapterNumber(latestRaw);
		const latestChapter = Number.isFinite(latestNum)
			? String(latestNum)
			: latestRaw != null
				? String(latestRaw).replace(/\.00$/, '')
				: undefined;

		return {
			id: this.toMangaId(slug),
			sourceId: this.id,
			title,
			cover: item?.poster_image_url || '',
			type: this.mapType(item?.series_comic_type),
			status: 'Ongoing',
			latestChapter,
			lang: this.DEFAULT_LANG
		} as Manga & { lang?: string };
	}

	private mapListFromSearch(item: any): Manga | null {
		const slug = item?.slug;
		const title = String(item?.title || '').trim();
		if (!slug || !title) return null;

		return {
			id: this.toMangaId(slug),
			sourceId: this.id,
			title,
			cover: item?.poster_image_url || '',
			type: this.mapType(item?.comic_subtype),
			status: this.mapStatus(item?.comic_status || item?.series_status),
			lang: this.DEFAULT_LANG
		} as Manga & { lang?: string };
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		const p = Math.max(1, Number(page) || 1);
		const fetchLimit = Math.min(200, p * this.PER_PAGE + this.PER_PAGE);

		try {
			const batch = await this.apiGet<any[]>('/api/comic/latest-updates', {
				limit: fetchLimit,
				chapterLimit: 1
			});
			const rows = Array.isArray(batch) ? batch : [];
			const seen = new Set<string>();
			const list: Manga[] = [];

			for (const it of rows) {
				const m = this.mapListFromLatest(it);
				if (!m || seen.has(m.id)) continue;
				seen.add(m.id);
				list.push(m);
			}

			const start = (p - 1) * this.PER_PAGE;
			const pageList = list.slice(start, start + this.PER_PAGE);

			console.log(
				`[ainzscans] latest page=${p} → ${pageList.length} (pool=${list.length})`
			);
			return pageList;
		} catch (e) {
			console.error('[ainzscans] getLatestManga', e);
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
			const data = await this.apiGet<{ data?: any[] }>('/api/search', {
				q,
				page,
				limit: this.PER_PAGE
			});
			const rows = Array.isArray(data?.data) ? data.data : [];
			const list = rows
				.map((it) => this.mapListFromSearch(it))
				.filter(Boolean) as Manga[];

			console.log(`[ainzscans] search "${q}" page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[ainzscans] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) throw new Error(`Invalid ainzscans id: ${mangaId}`);

		const data = await this.apiGet<any>(
			`/api/series/comic/${encodeURIComponent(slug)}`
		);
		if (!data?.id && !data?.slug) {
			throw new Error(`Manga not found: ${slug}`);
		}

		const title = String(data.title || slug).trim();
		const cover = data.poster_image_url || '';
		const status = this.mapStatus(data.comic_status || data.series_status);
		const type = this.mapType(data.comic_subtype);
		const synopsis = String(data.synopsis || '')
			.replace(/\s+/g, ' ')
			.trim();

		const authors: string[] = [];
		for (const name of [data.author_name, data.artist_name]) {
			const n = String(name || '').trim();
			if (n && n !== '-' && !authors.includes(n)) authors.push(n);
		}

		const genres: string[] = [];
		for (const g of data.genres || []) {
			const name = String(g?.name || '').trim();
			if (name && name.length < 40 && !genres.includes(name)) genres.push(name);
		}

		const alt =
			typeof data.alternative_titles === 'string'
				? data.alternative_titles.trim()
				: Array.isArray(data.alternative_titles)
					? data.alternative_titles.filter(Boolean).join(' · ')
					: '';

		// Chapters (paginate)
		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		let page = 1;
		const limit = 100;

		while (page <= 50) {
			const chJson = await this.apiGet<{ units?: any[] }>(
				`/api/series/comic/${encodeURIComponent(slug)}/chapters`,
				{ page, limit }
			);
			const units = Array.isArray(chJson?.units) ? chJson.units : [];
			if (!units.length) break;

			for (const u of units) {
				const chSlug = String(u?.slug || '').trim();
				const cid = String(u?.id || '');
				if (!chSlug || seen.has(chSlug)) continue;
				seen.add(chSlug);

				const number = this.parseChapterNumber(u?.number ?? u?.sort_number);
				const num = Number.isFinite(number) ? number : chapters.length + 1;
				const chTitle =
					String(u?.title || '').trim() || `Chapter ${num}`;

				chapters.push({
					id: this.toChapterId(slug, chSlug),
					title: chTitle,
					number: num,
					date: this.formatDate(u?.created_at)
				});
			}

			if (units.length < limit) break;
			page += 1;
		}

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));
		const latestChapter =
			chapters[0]?.number != null ? String(chapters[0].number) : undefined;

		const rating =
			data.rating_average != null && !Number.isNaN(Number(data.rating_average))
				? Number(data.rating_average).toFixed(1)
				: null;

		const metaLines = [
			alt && `Alternative: ${alt}`,
			rating && `Rating: ${rating}`,
			authors[0] && `Author: ${authors.join(' · ')}`,
			`Language: Indonesian`,
			data.release_year && `Year: ${data.release_year}`,
			`Type: ${type}`
		].filter(Boolean);

		const description = [...metaLines, synopsis].filter(Boolean).join('\n');

		console.log(`[ainzscans] details ${slug} → ch=${chapters.length}`);

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
			latestChapter
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const { seriesSlug, chapterSlug } = this.extractChapterParts(chapterId);
		if (!seriesSlug || !chapterSlug) {
			console.error('[ainzscans] getChapterPages bad id:', chapterId);
			return [];
		}

		try {
			const data = await this.apiGet<{
				chapter?: { pages?: Array<{ image_url?: string; page_number?: number }> };
			}>(
				`/api/series/comic/${encodeURIComponent(seriesSlug)}/chapter/${encodeURIComponent(chapterSlug)}`
			);

			const pages = Array.isArray(data?.chapter?.pages)
				? data.chapter.pages
				: [];

			const urls = pages
				.slice()
				.sort(
					(a, b) =>
						(Number(a.page_number) || 0) - (Number(b.page_number) || 0)
				)
				.map((p) => String(p.image_url || '').trim())
				.filter((u) => /^https?:\/\//i.test(u));

			console.log(
				`[ainzscans] ${urls.length} pages → ${seriesSlug}/${chapterSlug}`
			);
			return urls;
		} catch (e) {
			console.error(
				'[ainzscans] getChapterPages failed',
				seriesSlug,
				chapterSlug,
				e
			);
			return [];
		}
	}
}