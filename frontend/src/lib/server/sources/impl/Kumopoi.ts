import { createHmac, randomBytes } from 'crypto';
import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';

/**
 * Kumopoi (beta.kumopoi.com) — API v1
 *
 * List/Search : GET https://api.kumopoi.com/api/v1/comics
 * Detail      : GET /api/v1/comics/{slug}
 * Chapters    : embedded in detail + GET /api/v1/comics/{slug}/chapters
 * Pages       : GET /api/v1/chapters/{chapterId}/pages  (butuh HMAC signature)
 * Cover CDN   : https://kumo.gorae.my.id/{path}  (butuh Referer: beta.kumopoi.com)
 *
 * ID format:
 *   manga   : "/{slug}"
 *   chapter : "/{slug}/c/{chapterId}"
 *
 * Auth:
 *   Header wajib: x-app-timestamp, x-app-nonce, x-app-signature
 *   message = `${METHOD}:${pathname}:${timestamp}:${nonce}`
 *   signature = HMAC-SHA256(secret, message).hex()
 */
export class KumopoiSource extends BaseSource {
	id = 'kumopoi';
	name = 'Kumopoi';
	baseUrl = 'https://beta.kumopoi.com';
	private readonly apiBase = 'https://api.kumopoi.com/api/v1';
	private readonly cdnBase = 'https://kumo.gorae.my.id';
	private readonly PER_PAGE = 24;

	private readonly appSecret = 'vtm6RLiSyKmWd1YpZtkt5ue4oPdYdmzW0ZgxDgyBNEM=';

	private apiHeaders(): Record<string, string> {
		return {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
			Accept: 'application/json, text/plain, */*',
			'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
			Origin: this.baseUrl,
			Referer: `${this.baseUrl}/`
		};
	}

	/**
	 * HMAC-SHA256 signature — mirror frontend:
	 * message = METHOD:pathname:timestamp:nonce
	 */
	private signRequest(method: string, pathname: string): Record<string, string> {
		const timestamp = Math.floor(Date.now() / 1000).toString();
		const nonce = randomBytes(8).toString('hex');
		const pathOnly = pathname.split('?')[0];
		const message = `${method.toUpperCase()}:${pathOnly}:${timestamp}:${nonce}`;
		const signature = createHmac('sha256', this.appSecret).update(message).digest('hex');

		return {
			'x-app-timestamp': timestamp,
			'x-app-nonce': nonce,
			'x-app-signature': signature
		};
	}

	private async apiGet<T = any>(
		path: string,
		params?: Record<string, string | number | boolean | undefined | null>
	): Promise<T> {
		const url = new URL(path.startsWith('http') ? path : `${this.apiBase}${path}`);

		if (params) {
			for (const [k, v] of Object.entries(params)) {
				if (v === undefined || v === null || v === '') continue;
				url.searchParams.set(k, String(v));
			}
		}

		const sigHeaders = this.signRequest('GET', url.pathname);

		const res = await fetch(url.toString(), {
			headers: {
				...this.apiHeaders(),
				...sigHeaders
			}
		});

		if (!res.ok) {
			throw new Error(`Kumopoi HTTP ${res.status} ${url.pathname}`);
		}
		return (await res.json()) as T;
	}

	private toMangaId(slug: string): string {
		return `/${String(slug).replace(/^\/+|\/+$/g, '')}`;
	}

	private extractSlug(mangaId: string): string {
		return String(mangaId).replace(/^\/+/, '').split('/')[0] || '';
	}

	private toChapterId(slug: string, chapterId: string): string {
		return `/${slug}/c/${chapterId}`;
	}

	private extractChapterUuid(chapterId: string): string {
		const s = String(chapterId).replace(/^\/+/, '');
		const m = s.match(/(?:^|\/)c\/([a-z0-9]+)$/i) || s.match(/^([a-z0-9]+)$/i);
		return m?.[1] || '';
	}

	private coverUrl(path?: string | null): string {
		if (!path) return '';
		let p = String(path).trim();
		if (!p) return '';

		if (p.startsWith('http')) return p;
		if (p.startsWith('//')) return `https:${p}`;

		const encoded = p
			.replace(/^\/+/, '')
			.split('/')
			.map((seg) => encodeURIComponent(seg))
			.join('/');

		return `${this.cdnBase}/${encoded}`;
	}

	private mapStatus(status?: string): string {
		const s = String(status || '').toUpperCase();
		if (s === 'END' || s === 'COMPLETED') return 'Completed';
		if (s === 'HIATUS') return 'Hiatus';
		if (s === 'DROP' || s === 'DROPPED' || s === 'CANCELLED') return 'Dropped';
		if (s === 'END_SEASON') return 'Completed';
		return 'Ongoing';
	}

	private mapType(type?: string): string {
		const t = String(type || '').toUpperCase();
		if (t === 'MANHWA') return 'manhwa';
		if (t === 'MANHUA') return 'manhua';
		if (t === 'DOUJIN' || t === 'DOUJINSHI') return 'doujinshi';
		return 'manga';
	}

	private mapListItem(item: any): Manga | null {
		const slug = item?.slug;
		if (!slug) return null;

		const latest = Array.isArray(item.latestChapters) ? item.latestChapters[0] : null;
		const chNum =
			latest?.number != null && String(latest.number).trim() !== ''
				? String(latest.number).trim()
				: undefined;

		const cover = this.coverUrl(
			item.coverSmall || item.coverMedium || item.cover || null
		);

		return {
			id: this.toMangaId(slug),
			sourceId: this.id,
			title: String(item.title || slug).trim(),
			cover,
			type: this.mapType(item.type),
			status: this.mapStatus(item.status),
			latestChapter: chNum,
			lang: 'id'
		};
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		const p = Math.max(1, Number(page) || 1);

		try {
			const data = await this.apiGet<{
				success?: boolean;
				data?: { data?: any[] };
			}>('/comics', {
				page: p,
				limit: this.PER_PAGE,
				sort: 'latest'
			});

			const list = (data?.data?.data || [])
				.map((it) => this.mapListItem(it))
				.filter(Boolean) as Manga[];

			console.log(`[kumopoi] latest page=${p} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[kumopoi] getLatestManga', e);
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
			const data = await this.apiGet<{
				success?: boolean;
				data?: { data?: any[] };
			}>('/comics', {
				page,
				limit: this.PER_PAGE,
				search: q,
				sort: 'latest'
			});

			const list = (data?.data?.data || [])
				.map((it) => this.mapListItem(it))
				.filter(Boolean) as Manga[];

			console.log(`[kumopoi] search "${q}" → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[kumopoi] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) throw new Error(`Invalid kumopoi id: ${mangaId}`);

		const res = await this.apiGet<{ success?: boolean; data?: any }>(
			`/comics/${encodeURIComponent(slug)}`
		);
		const item = res?.data;
		if (!item?.slug) throw new Error(`Manga not found: ${slug}`);

		const cover = this.coverUrl(
			item.coverMedium || item.coverSmall || item.cover || null
		);

		const genres = (item.genres || [])
			.map((g: any) => g?.name)
			.filter(Boolean) as string[];

		const authors: string[] = [];
		if (item.author) authors.push(String(item.author));
		if (item.artist && item.artist !== item.author) {
			authors.push(String(item.artist));
		}

		let rawChapters: any[] = Array.isArray(item.chapters) ? item.chapters : [];

		if (!rawChapters.length) {
			try {
				const chRes = await this.apiGet<{
					success?: boolean;
					data?: { chapters?: any[] };
				}>(`/comics/${encodeURIComponent(slug)}/chapters`, {
					page: 1,
					limit: 200
				});
				rawChapters = chRes?.data?.chapters || [];
			} catch {
				/* ignore */
			}
		}

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		for (const ch of rawChapters) {
			const cid = String(ch?.id || '');
			if (!cid || seen.has(cid)) continue;
			seen.add(cid);

			const num = parseFloat(String(ch.number ?? ''));
			const number = Number.isFinite(num) ? num : chapters.length + 1;
			const title = ch.title
				? `Chapter ${number} — ${ch.title}`
				: `Chapter ${number}`;

			chapters.push({
				id: this.toChapterId(slug, cid),
				title,
				number,
				date: ch.publishedAt ? String(ch.publishedAt).slice(0, 10) : undefined
			});
		}

		chapters.sort((a, b) => (a.number || 0) - (b.number || 0));

		const latestChapter = chapters.length
			? String(chapters[chapters.length - 1].number)
			: undefined;

		const description = [
			item.description || '',
			item.year ? `Year: ${item.year}` : '',
			`Type: ${this.mapType(item.type)}`
		]
			.filter(Boolean)
			.join('\n');

		return {
			id: this.toMangaId(slug),
			sourceId: this.id,
			title: String(item.title || slug).trim(),
			cover,
			type: this.mapType(item.type),
			status: this.mapStatus(item.status),
			description,
			authors,
			genres,
			chapters,
			latestChapter,
			lang: 'id'
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const chapterUuid = this.extractChapterUuid(chapterId);
		if (!chapterUuid) {
			console.error('[kumopoi] getChapterPages bad id:', chapterId);
			return [];
		}

		try {
			const res = await this.apiGet<{
				success?: boolean;
				data?: {
					locked?: boolean;
					pages?: Array<{
						id?: string;
						order?: number;
						mode?: string;
						token?: string;
						url?: string;
					}>;
				};
			}>(`/chapters/${chapterUuid}/pages`);

			if (res?.data?.locked) {
				console.warn('[kumopoi] chapter locked:', chapterUuid);
				return [];
			}

			const pages = [...(res?.data?.pages || [])].sort(
				(a, b) => (a.order ?? 0) - (b.order ?? 0)
			);

			const urls: string[] = [];

			for (const p of pages) {
				if (p.url && /^https?:\/\//i.test(p.url)) {
					urls.push(p.url);
					continue;
				}

				const token = String(p.token || '').trim();
				if (!token) continue;

				if (
					token.includes('honeypot') ||
					token.startsWith('eyJzIjoiZHVtbXk') // {"s":"dummy...
				) {
					continue;
				}

				urls.push(
					`${this.apiBase}/media/chapter/deliver?token=${encodeURIComponent(token)}`
				);
			}

			console.log(`[kumopoi] ${urls.length}/${pages.length} pages → ${chapterUuid}`);
			return urls;
		} catch (e) {
			console.error('[kumopoi] getChapterPages failed', chapterUuid, e);
			return [];
		}
	}
}
