/**
 * Mangakuri adapter (API)
 *
 * List/Latest : GET /api/search?type=COMIC&sort=updated_at&order=desc&page=&limit=
 * Search      : GET /api/search?type=COMIC&q=&page=&limit=
 * Detail      : GET /api/series/comic/{slug}
 * Chapters    : detail.units[]
 * Pages       : GET /api/series/comic/{slug}/chapter/{chapterSlug}
 *               → chapter.pages[].image_url  (butuh Authorization: Bearer)
 *
 * ID format:
 *   manga   : /comic/{slug}
 *   chapter : /comic/{slug}/chapter/{chapterSlug}
 *
 * Site UI : https://lc2.mangakuri.online (Cloudflare)
 * API     : https://api.mangakuri.online
 *
 * Bahasa: Indonesian | NSFW
 *
 * Token: set MANGAKURI_TOKEN di .env ATAU isi authToken di bawah
 *        (ambil dari DevTools → Network → Authorization: Bearer ...)
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';

export class MangakuriSource extends BaseSource {
	id = 'mangakuri';
	name = 'Mangakuri';
	baseUrl = 'https://lc2.mangakuri.online';

	private readonly apiBase = 'https://api.mangakuri.online';
	private readonly PER_PAGE = 20;
	private readonly DEFAULT_LANG = 'id';

	private authToken =
		(typeof process !== 'undefined' && process.env?.MANGAKURI_TOKEN) ||
		'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImViZGI5MDQ2LWIwN2MtMTFmMS1iY2RkLWJjMjQxMWU2NGVjMSIsInJvbGUiOiJSRUFERVIiLCJpYXQiOjE3ODk0MTg2MDAsImV4cCI6MTc5MDAyMzQwMH0.wMEPThjntM_DNu_Z1NDI0Yj72DUvUQAgFsPYiRGbstw'; // ← paste token di sini kalau tidak pakai .env

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
			'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
			Origin: this.baseUrl,
			Referer: `${this.baseUrl}/`
		};

		if (this.authToken) {
			headers['Authorization'] = `Bearer ${this.authToken}`;
		}

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
					lastErr = new Error('Mangakuri blocked: HTML not JSON');
					await new Promise((r) => setTimeout(r, 400 * attempt));
					continue;
				}

				if (!res.ok) {
					if (res.status === 401 || res.status === 403) {
						throw new Error(
							`Mangakuri auth failed (${res.status}) — token kosong/expired`
						);
					}
					if (res.status === 429 || res.status === 503) {
						lastErr = new Error(`Mangakuri HTTP ${res.status}`);
						await new Promise((r) => setTimeout(r, 600 * attempt));
						continue;
					}
					throw new Error(`Mangakuri HTTP ${res.status}`);
				}

				try {
					return JSON.parse(trimmed) as T;
				} catch {
					throw new Error('Mangakuri invalid JSON');
				}
			} catch (e) {
				lastErr = e;
				const msg = e instanceof Error ? e.message : String(e);
				if (msg.includes('auth failed')) throw e;
				if (attempt < maxAttempts) {
					await new Promise((r) => setTimeout(r, 400 * attempt));
					continue;
				}
			}
		}

		throw lastErr instanceof Error
			? lastErr
			: new Error('Mangakuri request failed');
	}

	// ── ID helpers ───────────────────────────────────────────────────────────

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

	// ── Mapping ──────────────────────────────────────────────────────────────

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

	private parseChapterNumber(raw: unknown): number {
		const n = parseFloat(String(raw ?? '').replace(/\.00$/, ''));
		return Number.isFinite(n) ? n : NaN;
	}

	private mapLang(raw?: string | null): string {
	const s = String(raw || '').toLowerCase();
	if (s.startsWith('indones') || s === 'id' || s === 'idn') return 'id';
	if (s.startsWith('eng') || s === 'en') return 'en';
	if (s.startsWith('jap') || s === 'ja' || s === 'jp') return 'ja';
	if (s.startsWith('kor') || s === 'ko' || s === 'kr') return 'ko';
	if (s.startsWith('chi') || s === 'zh' || s === 'cn') return 'zh';
	return this.DEFAULT_LANG;
}

private mapListItem(
	item: any,
	latestChapter?: string | number
): Manga | null {
	const slug = item?.slug || item?.series_slug;
	const title = String(item?.title || item?.series_title || '').trim();
	if (!slug || !title) return null;

	let ch = latestChapter;
	if (ch == null) {
		const raw =
			item?.latest_chapter_number ??
			item?.latest_unit_number ??
			item?.last_chapter_number ??
			item?.number;
		const n = this.parseChapterNumber(raw);
		if (Number.isFinite(n)) ch = n;
	}

	return {
		id: this.toMangaId(slug),
		sourceId: this.id,
		title,
		cover: item?.poster_image_url || '',
		type: this.mapType(item?.comic_subtype),
		status: this.mapStatus(item?.comic_status || item?.series_status),
		latestChapter: ch != null ? ch : undefined,
		lang: this.mapLang(item?.language) || this.DEFAULT_LANG
	};
}

	// ── Latest ───────────────────────────────────────────────────────────────

/** Ambil nomor chapter terbaru dari detail.units */
private async fetchLatestChapter(slug: string): Promise<number | undefined> {
	try {
		const data = await this.apiGet<{ units?: any[] }>(
			`/api/series/comic/${encodeURIComponent(slug)}`
		);
		const units = Array.isArray(data?.units) ? data.units : [];
		if (!units.length) return undefined;

		let best = NaN;
		for (const u of units) {
			const n = this.parseChapterNumber(u?.number ?? u?.sort_number);
			if (Number.isFinite(n) && (Number.isNaN(best) || n > best)) best = n;
		}
		return Number.isFinite(best) ? best : undefined;
	} catch {
		return undefined;
	}
}

/** Enrich list dengan latestChapter + lang */
private async enrichList(rows: any[]): Promise<Manga[]> {
	const mapped = rows
		.map((it) => this.mapListItem(it))
		.filter(Boolean) as Manga[];

	await Promise.all(
		mapped.map(async (m) => {
			const slug = this.extractSlug(m.id);
			if (!slug) return;
			const ch = await this.fetchLatestChapter(slug);
			if (ch != null) m.latestChapter = ch;
			if (!m.lang) m.lang = this.DEFAULT_LANG;
		})
	);

	return mapped;
}

async getLatestManga(
	page: number,
	_opts?: { lang?: string; type?: string }
): Promise<Manga[]> {
	const p = Math.max(1, Number(page) || 1);
	try {
		const data = await this.apiGet<{ data?: any[] }>('/api/search', {
			type: 'COMIC',
			page: p,
			limit: this.PER_PAGE, // 24
			sort: 'updated_at',
			order: 'desc'
		});
		const rows = Array.isArray(data?.data) ? data.data : [];
		const list = await this.enrichList(rows);
		console.log(`[mangakuri] latest page=${p} → ${list.length}`);
		return list;
	} catch (e) {
		console.error('[mangakuri] getLatestManga', e);
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
			type: 'COMIC',
			q,
			page,
			limit: this.PER_PAGE,
			sort: 'updated_at',
			order: 'desc'
		});
		const rows = Array.isArray(data?.data) ? data.data : [];
		const list = await this.enrichList(rows);
		console.log(`[mangakuri] search "${q}" page=${page} → ${list.length}`);
		return list;
	} catch (e) {
		console.error('[mangakuri] searchManga', e);
		return [];
	}
}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) throw new Error(`Invalid mangakuri id: ${mangaId}`);

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
			.replace(/<[^>]+>/g, ' ')
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

		const alt = Array.isArray(data.alternative_titles)
			? data.alternative_titles.filter(Boolean).join(' · ')
			: typeof data.alternative_titles === 'string'
				? data.alternative_titles.trim()
				: '';

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		const units = Array.isArray(data.units) ? data.units : [];

		for (const u of units) {
			const chSlug = String(u?.slug || '').trim();
			if (!chSlug || seen.has(chSlug)) continue;
			seen.add(chSlug);

			const number = this.parseChapterNumber(u?.number ?? u?.sort_number);
			const num = Number.isFinite(number) ? number : chapters.length + 1;
			const chTitle = String(u?.title || '').trim() || `Chapter ${num}`;

			chapters.push({
				id: this.toChapterId(slug, chSlug),
				title: /chapter/i.test(chTitle) ? chTitle : `Chapter ${num}`,
				number: num,
				date: this.formatDate(u?.created_at)
			});
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
			data.release_year && `Year: ${data.release_year}`,
			`Language: Indonesian`,
			`Type: ${type}`
		].filter(Boolean);

		console.log(`[mangakuri] details ${slug} → ch=${chapters.length}`);

		return {
			id: this.toMangaId(slug),
			sourceId: this.id,
			title,
			cover,
			type,
			status,
			description: [...metaLines, synopsis].filter(Boolean).join('\n'),
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
			console.error('[mangakuri] getChapterPages bad id:', chapterId);
			return [];
		}

		if (!this.authToken) {
			console.warn(
				'[mangakuri] authToken kosong — pages hampir pasti login_required. Set MANGAKURI_TOKEN atau isi authToken.'
			);
		}

		try {
			const data = await this.apiGet<{
				chapter?: {
					pages?: Array<{ image_url?: string; page_number?: number }>;
					login_required?: boolean;
					password_required?: boolean;
				};
			}>(
				`/api/series/comic/${encodeURIComponent(seriesSlug)}/chapter/${encodeURIComponent(chapterSlug)}`
			);

			const ch = data?.chapter;
			if (ch?.login_required) {
				console.warn(
					'[mangakuri] login_required=true',
					seriesSlug,
					chapterSlug,
					'— token invalid/expired?'
				);
			}
			if (ch?.password_required) {
				console.warn(
					'[mangakuri] password_required',
					seriesSlug,
					chapterSlug
				);
			}

			const pages = Array.isArray(ch?.pages) ? ch.pages : [];
			const urls = pages
				.slice()
				.sort(
					(a, b) =>
						(Number(a.page_number) || 0) - (Number(b.page_number) || 0)
				)
				.map((p) => String(p.image_url || '').trim())
				.filter((u) => /^https?:\/\//i.test(u));

			console.log(
				`[mangakuri] ${urls.length} pages → ${seriesSlug}/${chapterSlug}`
			);
			return urls;
		} catch (e) {
			console.error(
				'[mangakuri] getChapterPages failed',
				seriesSlug,
				chapterSlug,
				e
			);
			return [];
		}
	}
}