import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';

/**
 * West Manga adapter (v1 / data.mantweh.online API)
 *
 * List/Latest : GET /api/contents?page=&per_page=24&type=Comic&project=true
 *               → section "UPDATE PROJECT WESTMANGA"
 * Search      : GET /api/contents?q=&page=&per_page=&type=Comic
 * Detail      : GET /api/comic/{slug}
 * Pages       : GET /api/v/{chapterSlug} → data.images[]
 *
 * Auth headers (HMAC-SHA256):
 *   key = timestamp + "GET" + path + ACCESS_KEY + SECRET_KEY
 *   msg = "wm-api-request"
 *
 * ID format:
 *   manga   : "/comic/{slug}"
 *   chapter : "/comic/{slug}/chapter/{chapterSlug}"
 *             (hierarchical — required for reader next/prev)
 *
 * Bahasa default: Indonesian
 */
export class WestMangaSource extends BaseSource {
	id = 'westmanga';
	name = 'West Manga';
	baseUrl = 'https://v1.westmanga.my';

	private readonly apiBase = 'https://data.mantweh.online';
	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'id';
	private readonly ACCESS_KEY = 'WM_WEB_FRONT_END';
	private readonly SECRET_KEY = 'xxxoidj';

	// ── HMAC ─────────────────────────────────────────────────────────────────

	private async hmacSha256Hex(key: string, message: string): Promise<string> {
		const enc = new TextEncoder();
		const cryptoKey = await crypto.subtle.importKey(
			'raw',
			enc.encode(key),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);
		const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
		return [...new Uint8Array(sig)]
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
	}

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

		const encodedPath = url.pathname;
		const timestamp = String(Math.floor(Date.now() / 1000));
		const hmacKey = `${timestamp}GET${encodedPath}${this.ACCESS_KEY}${this.SECRET_KEY}`;
		const signature = await this.hmacSha256Hex(hmacKey, 'wm-api-request');

		const headers: Record<string, string> = {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
			Accept: 'application/json, text/plain, */*',
			'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
			Origin: this.baseUrl,
			Referer: `${this.baseUrl}/`,
			'Cache-Control': 'no-cache',
			'x-wm-accses-key': this.ACCESS_KEY,
			'x-wm-request-time': timestamp,
			'x-wm-request-signature': signature
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
						`[westmanga] HTML response attempt=${attempt}`,
						url.pathname,
						trimmed.slice(0, 120)
					);
					lastErr = new Error('WestManga blocked: response is HTML, not JSON');
					await new Promise((r) => setTimeout(r, 400 * attempt));
					continue;
				}

				if (!res.ok) {
					console.error(
						`[westmanga] HTTP ${res.status} ${url.pathname}`,
						trimmed.slice(0, 300)
					);
					if (res.status === 429 || res.status === 503) {
						lastErr = new Error(`WestManga HTTP ${res.status}`);
						await new Promise((r) => setTimeout(r, 600 * attempt));
						continue;
					}
					throw new Error(`WestManga HTTP ${res.status}`);
				}

				try {
					return JSON.parse(trimmed) as T;
				} catch {
					console.error('[westmanga] invalid JSON', trimmed.slice(0, 200));
					throw new Error('WestManga invalid JSON');
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
			: new Error('WestManga request failed');
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
		const series = String(seriesSlug || '').replace(/^\/+|\/+$/g, '');
		const ch = String(chapterSlug || '').replace(/^\/+|\/+$/g, '');
		return `/comic/${series}/chapter/${ch}`;
	}

	private extractChapterSlug(chapterId: string): string {
		const s = String(chapterId).replace(/^\/+/, '');
		const m = s.match(/^comic\/[^/]+\/chapter\/(.+)$/i);
		if (m?.[1]) return m[1];
		const parts = s.split('/').filter(Boolean);
		if (parts[0]?.toLowerCase() === 'view' && parts[1]) return parts.slice(1).join('/');
		if (parts[0]?.toLowerCase() === 'chapter' && parts[1]) return parts.slice(1).join('/');
		return parts[parts.length - 1] || s;
	}

	private mapStatus(status?: string | null): string {
		const s = String(status || '').toLowerCase();
		if (s === 'completed' || s === 'complete' || s === 'selesai') return 'Completed';
		if (s === 'hiatus') return 'Hiatus';
		if (s === 'cancelled' || s === 'dropped') return 'Cancelled';
		return 'Ongoing';
	}

	private mapType(countryId?: string | null, contentType?: string | null): string {
		const c = String(countryId || '').toUpperCase();
		if (c === 'KR') return 'manhwa';
		if (c === 'CN') return 'manhua';
		if (c === 'JP') return 'manga';
		const t = String(contentType || '').toLowerCase();
		if (t === 'manhwa') return 'manhwa';
		if (t === 'manhua') return 'manhua';
		return 'manga';
	}

	private formatDate(raw?: any): string {
		if (!raw) return '';
		if (typeof raw === 'object' && raw.formatted) {
			try {
				const t = Number(raw.time);
				if (Number.isFinite(t) && t > 0) {
					return new Date(t * 1000).toISOString().slice(0, 10);
				}
			} catch {}
			return String(raw.formatted).slice(0, 10);
		}
		if (typeof raw === 'number') {
			const ms = raw > 1e12 ? raw : raw * 1000;
			return new Date(ms).toISOString().slice(0, 10);
		}
		try {
			return new Date(raw).toISOString().slice(0, 10);
		} catch {
			return String(raw).slice(0, 10);
		}
	}

	private parseChapterNumber(raw: unknown): number {
		const n = parseFloat(String(raw ?? '').replace(/,/g, ''));
		return Number.isFinite(n) ? n : NaN;
	}

	private mapListItem(item: any): Manga | null {
		const slug = item?.slug;
		const title = String(item?.title || '').trim();
		if (!slug || !title) return null;

		const lastChs = Array.isArray(item?.lastChapters) ? item.lastChapters : [];
		const latestRaw = lastChs[0]?.number;
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
			cover: item?.cover || '',
			type: this.mapType(item?.country_id, item?.content_type),
			status: this.mapStatus(item?.status),
			latestChapter,
			lang: this.DEFAULT_LANG
		} as Manga & { lang?: string };
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		const p = Math.max(1, Number(page) || 1);

		try {
			const data = await this.apiGet<{
				data?: any[];
				paginator?: { hasNextPage?: boolean; currentPage?: number };
			}>('/api/contents', {
				page: p,
				per_page: this.PER_PAGE,
				type: 'Comic',
				project: true
			});

			const rows = Array.isArray(data?.data) ? data.data : [];
			const list = rows
				.map((it) => this.mapListItem(it))
				.filter(Boolean) as Manga[];

			console.log(`[westmanga] latest (project) page=${p} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[westmanga] getLatestManga', e);
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
			const data = await this.apiGet<{ data?: any[] }>('/api/contents', {
				q,
				page,
				per_page: this.PER_PAGE,
				type: 'Comic'
			});

			const rows = Array.isArray(data?.data) ? data.data : [];
			const list = rows
				.map((it) => this.mapListItem(it))
				.filter(Boolean) as Manga[];

			console.log(`[westmanga] search "${q}" page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[westmanga] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) throw new Error(`Invalid westmanga id: ${mangaId}`);

		const json = await this.apiGet<{ data?: any }>(
			`/api/comic/${encodeURIComponent(slug)}`
		);
		const data = json?.data ?? json;
		if (!data?.id && !data?.slug) {
			throw new Error(`Manga not found: ${slug}`);
		}

		const title = String(data.title || slug).trim();
		const cover = data.cover || '';
		const status = this.mapStatus(data.status);
		const type = this.mapType(data.country_id, data.content_type);
		const synopsis = String(data.sinopsis || data.synopsis || data.description || '')
			.replace(/\s+/g, ' ')
			.trim();

		const authors: string[] = [];
		const authorRaw = data.author;
		if (typeof authorRaw === 'string' && authorRaw.trim() && authorRaw !== '-') {
			authors.push(authorRaw.trim());
		} else if (Array.isArray(authorRaw)) {
			for (const a of authorRaw) {
				const n = String(a?.name || a || '').trim();
				if (n && n !== '-' && !authors.includes(n)) authors.push(n);
			}
		}

		const genres: string[] = [];
		for (const g of data.genres || []) {
			const name = String(g?.name || g || '').trim();
			if (name && name.length < 40 && !genres.includes(name)) genres.push(name);
		}

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		const units = Array.isArray(data.chapters) ? data.chapters : [];

		for (const u of units) {
			const chSlug = String(u?.slug || '').trim();
			if (!chSlug || seen.has(chSlug)) continue;
			seen.add(chSlug);

			const number = this.parseChapterNumber(u?.number);
			const num = Number.isFinite(number) ? number : chapters.length + 1;
			const chTitle =
				String(u?.title || '').trim() || `Chapter ${u?.number ?? num}`;

			chapters.push({
				id: this.toChapterId(slug, chSlug),
				title: chTitle,
				number: num,
				date: this.formatDate(u?.created_at || u?.updated_at)
			});
		}

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));
		const latestChapter =
			chapters[0]?.number != null ? String(chapters[0].number) : undefined;

		const alt = String(
			data.alternative_name || data.alternative_titles || ''
		).trim();
		const rating =
			data.rating != null && !Number.isNaN(Number(data.rating))
				? Number(data.rating).toFixed(1)
				: null;
		const publication =
			data.release != null && String(data.release).trim()
				? String(data.release).trim()
				: '';

		const metaLines = [
			alt && `Alternative: ${alt}`,
			rating && Number(rating) > 0 && `Rating: ${rating}`,
			publication && `Publication: ${publication}`,
			authors[0] && `Author: ${authors.join(', ')}`,
			authors[0] && `Artist: ${authors.join(', ')}`,
			`Language: Indonesian`,
			`Type: ${type}`
		].filter(Boolean);

		const description = [...metaLines, synopsis].filter(Boolean).join('\n');

		console.log(`[westmanga] details ${slug} → ch=${chapters.length}`);

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
		const chapterSlug = this.extractChapterSlug(chapterId);
		if (!chapterSlug) {
			console.error('[westmanga] getChapterPages bad id:', chapterId);
			return [];
		}

		try {
			const json = await this.apiGet<{
				data?: { images?: string[] };
			}>(`/api/v/${encodeURIComponent(chapterSlug)}`);

			const data = json?.data ?? json;
			const images = Array.isArray((data as any)?.images)
				? (data as any).images
				: [];

			const urls = images
				.map((u: any) => String(u || '').trim())
				.filter((u: string) => /^https?:\/\//i.test(u));

			console.log(`[westmanga] ${urls.length} pages → ${chapterSlug}`);
			return urls;
		} catch (e) {
			console.error('[westmanga] getChapterPages failed', chapterSlug, e);
			return [];
		}
	}
}
