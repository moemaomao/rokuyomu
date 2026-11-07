/**
 * West Manga adapter (updated auth + same-origin API)
 *
 * List/Latest : GET /api/contents?page=&per_page=24&type=Comic
 * Search      : GET /api/contents?q=&page=&per_page=&type=Comic
 * Detail      : GET /api/comic/{slug}
 * Pages       : GET /api/v/{chapterSlug} → data.images[]
 *
 * Auth (current):
 *   1) GET /api/visit-token → X-WM-Visit header
 *   2) Fallback: HMAC (legacy data.mantweh.online)
 *
 * ID format:
 *   manga   : "/comic/{slug}"
 *   chapter : "/comic/{slug}/chapter/{chapterSlug}"
 *
 * Bahasa default: Indonesian
 */

import { BaseSource } from '../../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';

export class WestMangaSource extends BaseSource {
	id = 'westmanga';
	name = 'West Manga';
	baseUrl = 'https://v1.westmanga.my';

	private readonly apiHosts = [
		'https://v1.westmanga.my',
		'https://westmanga.co',
		'https://data.mantweh.online'
	];

	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'id';
	private readonly ACCESS_KEY = 'WM_WEB_FRONT_END';
	private readonly SECRET_KEY = 'xxxoidj';

	private visitToken: string | null = null;
	private visitTokenExpiresAt = 0;
	private activeApiBase = 'https://v1.westmanga.my';

	// ── HMAC (legacy fallback) ───────────────────────────────────────────────

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

	// ── Visit token (current auth) ───────────────────────────────────────────

	private async ensureVisitToken(force = false): Promise<string | null> {
		const now = Date.now();
		if (!force && this.visitToken && now < this.visitTokenExpiresAt - 5 * 60 * 1000) {
			return this.visitToken;
		}

		for (const host of this.apiHosts) {
			if (host.includes('mantweh')) continue;
			try {
				const res = await fetch(`${host}/api/visit-token`, {
					headers: {
						'User-Agent':
							'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
						Accept: 'application/json, text/plain, */*',
						Origin: host,
						Referer: `${host}/`
					}
				});
				const text = await res.text();
				if (!res.ok || text.trim().startsWith('<')) continue;
				const json = JSON.parse(text) as {
					status?: boolean;
					token?: string;
					expiresAt?: number;
					expires_at?: number;
				};
				const token = json.token;
				if (json.status && token) {
					this.visitToken = token;
					const exp = Number(json.expiresAt ?? json.expires_at ?? 0);
					this.visitTokenExpiresAt = exp > 1e12 ? exp : exp > 0 ? exp * 1000 : now + 60 * 60 * 1000;
					this.activeApiBase = host;
					this.baseUrl = host;
					console.log(`[westmanga] visit-token OK via ${host}`);
					return token;
				}
			} catch (e) {
				console.warn(`[westmanga] visit-token fail ${host}`, e);
			}
		}
		return this.visitToken;
	}

	// ── HTTP ─────────────────────────────────────────────────────────────────

	private isHtml(text: string): boolean {
		const t = text.trim().toLowerCase();
		return t.startsWith('<') || t.includes('<!doctype');
	}

	private async apiGet<T = any>(
		path: string,
		params?: Record<string, string | number | boolean | undefined | null>
	): Promise<T> {
		const relativePath = path.startsWith('http')
			? new URL(path).pathname
			: path.startsWith('/')
				? path
				: `/${path}`;

		const hosts = [
			this.activeApiBase,
			...this.apiHosts.filter((h) => h !== this.activeApiBase)
		];

		let lastErr: unknown;

		for (const host of hosts) {
			const url = new URL(relativePath, host);
			if (params) {
				for (const [key, val] of Object.entries(params)) {
					if (val === undefined || val === null || val === '') continue;
					url.searchParams.set(key, String(val));
				}
			}

			const useHmac = host.includes('mantweh');
			const headers: Record<string, string> = {
				'User-Agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				Accept: 'application/json, text/plain, */*',
				'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
				Origin: host.includes('mantweh') ? this.baseUrl : host,
				Referer: `${host.includes('mantweh') ? this.baseUrl : host}/`,
				'Cache-Control': 'no-cache'
			};

			if (useHmac) {
				const timestamp = String(Math.floor(Date.now() / 1000));
				const hmacKey = `${timestamp}GET${url.pathname}${this.ACCESS_KEY}${this.SECRET_KEY}`;
				const signature = await this.hmacSha256Hex(hmacKey, 'wm-api-request');
				headers['x-wm-accses-key'] = this.ACCESS_KEY;
				headers['x-wm-request-time'] = timestamp;
				headers['x-wm-request-signature'] = signature;
			} else {
				const token = await this.ensureVisitToken();
				if (token) headers['X-WM-Visit'] = token;
			}

			for (let attempt = 1; attempt <= 2; attempt++) {
				try {
					const res = await fetch(url.toString(), { headers });
					const text = await res.text();

					if (this.isHtml(text)) {
						console.error(
							`[westmanga] HTML/CF block host=${host} attempt=${attempt}`,
							text.slice(0, 80)
						);
						lastErr = new Error('WestManga blocked (HTML/Cloudflare)');
						if (!useHmac && attempt === 1) {
							await this.ensureVisitToken(true);
							if (this.visitToken) headers['X-WM-Visit'] = this.visitToken;
							continue;
						}
						break;
					}

					if (!res.ok) {
						console.error(
							`[westmanga] HTTP ${res.status} ${host}${url.pathname}`,
							text.slice(0, 200)
						);
						if ((res.status === 403 || res.status === 404) && !useHmac && attempt === 1) {
							await this.ensureVisitToken(true);
							if (this.visitToken) headers['X-WM-Visit'] = this.visitToken;
							continue;
						}
						lastErr = new Error(`WestManga HTTP ${res.status}`);
						break;
					}

					try {
						const json = JSON.parse(text) as T;
						this.activeApiBase = host;
						if (!host.includes('mantweh')) this.baseUrl = host;
						return json;
					} catch {
						lastErr = new Error('WestManga invalid JSON');
						break;
					}
				} catch (e) {
					lastErr = e;
					if (attempt < 2) {
						await new Promise((r) => setTimeout(r, 300 * attempt));
						continue;
					}
				}
			}
		}

		throw lastErr instanceof Error ? lastErr : new Error('WestManga request failed');
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private toMangaId(slug: string): string {
		const s = String(slug || '')
			.replace(/^\/+|\/+$/g, '')
			.replace(/^(comic|manga)\//i, '');
		return `/comic/${s}`;
	}

	private extractSlug(mangaId: string): string {
		const parts = String(mangaId)
			.replace(/^\/+/, '')
			.split('/')
			.filter(Boolean);
		if (
			(parts[0]?.toLowerCase() === 'comic' || parts[0]?.toLowerCase() === 'manga') &&
			parts[1]
		) {
			return parts[1];
		}
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
			} catch {
				/* ignore */
			}
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

		const lastChs = Array.isArray(item?.lastChapters)
			? item.lastChapters
			: Array.isArray(item?.last_chapters)
				? item.last_chapters
				: [];
		const latestRaw = lastChs[0]?.number ?? item?.latest_chapter ?? item?.last_chapter;
		const latestNum = this.parseChapterNumber(latestRaw);
		const latestChapter = Number.isFinite(latestNum)
			? String(latestNum)
			: latestRaw != null
				? String(latestRaw).replace(/\.00$/, '')
				: undefined;

		const cover = String(item?.cover || item?.thumbnail || '').trim();
		const coverUrl =
			cover && !/^https?:\/\//i.test(cover) ? `${this.baseUrl}${cover.startsWith('/') ? '' : '/'}${cover}` : cover;

		return {
			id: this.toMangaId(slug),
			sourceId: this.id,
			title,
			cover: coverUrl,
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
				type: 'Comic'
			});

			const rows = Array.isArray(data?.data) ? data.data : [];
			const list = rows.map((it) => this.mapListItem(it)).filter(Boolean) as Manga[];

			console.log(`[westmanga] latest page=${p} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[westmanga] getLatestManga', e);
			try {
				const data = await this.apiGet<{ data?: any[] }>('/api/contents', {
					page: p,
					per_page: this.PER_PAGE,
					type: 'Comic',
					project: true
				});
				const rows = Array.isArray(data?.data) ? data.data : [];
				return rows.map((it) => this.mapListItem(it)).filter(Boolean) as Manga[];
			} catch (e2) {
				console.error('[westmanga] getLatestManga project fallback', e2);
				return [];
			}
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
			const list = rows.map((it) => this.mapListItem(it)).filter(Boolean) as Manga[];

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
		let cover = String(data.cover || '').trim();
		if (cover && !/^https?:\/\//i.test(cover)) {
			cover = `${this.baseUrl}${cover.startsWith('/') ? '' : '/'}${cover}`;
		}
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
			const chTitle = String(u?.title || '').trim() || `Chapter ${u?.number ?? num}`;

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

		const alt = String(data.alternative_name || data.alternative_titles || '').trim();
		const rating =
			data.rating != null && !Number.isNaN(Number(data.rating))
				? Number(data.rating).toFixed(1)
				: null;
		const publication =
			data.release != null && String(data.release).trim() ? String(data.release).trim() : '';

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
			const images = Array.isArray((data as any)?.images) ? (data as any).images : [];

			const urls = images
				.map((u: any) => String(u || '').trim())
				.map((u: string) =>
					u && !/^https?:\/\//i.test(u)
						? `${this.baseUrl}${u.startsWith('/') ? '' : '/'}${u}`
						: u
				)
				.filter((u: string) => /^https?:\/\//i.test(u));

			console.log(`[westmanga] ${urls.length} pages → ${chapterSlug}`);
			return urls;
		} catch (e) {
			console.error('[westmanga] getChapterPages failed', chapterSlug, e);
			return [];
		}
	}
}
