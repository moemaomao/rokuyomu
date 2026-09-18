import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';

/**
 * MangaDex adapter (official API v5)
 *
 * List/Search : GET /chapter (latest) | GET /manga (search)
 * Detail      : GET /manga/{uuid}?includes[]=cover_art,author,artist
 * Chapters    : GET /manga/{uuid}/feed
 * Pages       : GET /at-home/server/{chapterUuid}
 * Cover       : https://uploads.mangadex.org/covers/{mangaId}/{fileName}[.256.jpg | .512.jpg]
 *
 * ID format:
 *   manga   : "/{mangaUuid}"
 *   chapter : "/{mangaUuid}/c/{chapterUuid}"
 */
export class MangaDexSource extends BaseSource {
	id = 'mangadex';
	name = 'MangaDex';
	baseUrl = 'https://mangadex.org';
	private readonly apiBase = 'https://api.mangadex.org';
	private readonly uploadsBase = 'https://uploads.mangadex.org';
	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'en';

	// ── HTTP ─────────────────────────────────────────────────────────────────

	private async apiGet<T = any>(
		path: string,
		params?: Record<string, string | string[] | number | boolean | undefined | null>
	): Promise<T> {
		const url = new URL(
			path.startsWith('http') ? path : `${this.apiBase}${path}`
		);

		if (params) {
			for (const [key, val] of Object.entries(params)) {
				if (val === undefined || val === null || val === '') continue;
				if (Array.isArray(val)) {
					for (const v of val) {
						if (v === undefined || v === null || v === '') continue;
						url.searchParams.append(key, String(v));
					}
				} else {
					url.searchParams.set(key, String(val));
				}
			}
		}

		const headers: Record<string, string> = {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
			Accept: 'application/json, text/plain, */*',
			'Accept-Language': 'en-US,en;q=0.9',
			Origin: 'https://mangadex.org',
			Referer: 'https://mangadex.org/',
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
						`[mangadex] HTML response attempt=${attempt}`,
						url.pathname,
						trimmed.slice(0, 120)
					);
					lastErr = new Error('MangaDex blocked: response is HTML, not JSON');
					await new Promise((r) => setTimeout(r, 400 * attempt));
					continue;
				}

				if (!res.ok) {
					console.error(
						`[mangadex] HTTP ${res.status} ${url.pathname}`,
						trimmed.slice(0, 400)
					);
					if (res.status === 429 || res.status === 503) {
						lastErr = new Error(`MangaDex HTTP ${res.status}`);
						await new Promise((r) => setTimeout(r, 600 * attempt));
						continue;
					}
					throw new Error(`MangaDex HTTP ${res.status}`);
				}

				try {
					return JSON.parse(trimmed) as T;
				} catch {
					console.error('[mangadex] invalid JSON', trimmed.slice(0, 200));
					throw new Error('MangaDex invalid JSON');
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
			: new Error('MangaDex request failed');
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private normalizeLang(lang?: string): string | null {
		const raw = String(lang || '')
			.trim()
			.toLowerCase();
		if (!raw || raw === 'all' || raw === 'any' || raw === '*') return null;

		const aliases: Record<string, string> = {
			english: 'en',
			indonesian: 'id',
			indonesia: 'id',
			bahasa: 'id',
			japanese: 'ja',
			japan: 'ja',
			korean: 'ko',
			korea: 'ko',
			chinese: 'zh',
			'simplified chinese': 'zh',
			'traditional chinese': 'zh-hk',
			french: 'fr',
			spanish: 'es',
			'latin american spanish': 'es-la',
			portuguese: 'pt-br',
			'brazilian portuguese': 'pt-br',
			russian: 'ru',
			vietnamese: 'vi',
			thai: 'th',
			arabic: 'ar',
			german: 'de',
			italian: 'it',
			polish: 'pl',
			turkish: 'tr',
			ukrainian: 'uk',
			hindi: 'hi',
			malay: 'ms',
			dutch: 'nl'
		};
		if (aliases[raw]) return aliases[raw];
		if (/^[a-z]{2}(-[a-z]{2})?$/.test(raw)) return raw;
		return null;
	}

	private resolveFeedLangs(lang?: string): string[] | null {
		const n = this.normalizeLang(lang);
		if (n) return [n];
		return null;
	}

	private toMangaId(uuid: string): string {
		return `/${String(uuid).replace(/^\/+|\/+$/g, '')}`;
	}

	private extractMangaUuid(id: string): string {
		const parts = String(id)
			.replace(/^\/+/, '')
			.split('/')
			.filter(Boolean);
		return parts[0] || '';
	}

	private toChapterId(mangaUuid: string, chapterUuid: string): string {
		return `/${mangaUuid}/c/${chapterUuid}`;
	}

	private extractChapterUuid(chapterId: string): string {
		const s = String(chapterId).replace(/^\/+/, '');
		const m =
			s.match(/(?:^|\/)c\/([0-9a-f-]{36})/i) ||
			s.match(/^([0-9a-f-]{36})$/i);
		return m?.[1] || '';
	}

	private pickTitle(
		titleObj?: Record<string, string> | null,
		altTitles?: Array<Record<string, string>> | null
	): string {
		if (titleObj && typeof titleObj === 'object') {
			if (titleObj.en) return titleObj.en;
			if (titleObj['ja-ro']) return titleObj['ja-ro'];
			if (titleObj.ja) return titleObj.ja;
			const first = Object.values(titleObj)[0];
			if (first) return first;
		}
		if (Array.isArray(altTitles)) {
			for (const alt of altTitles) {
				if (alt?.en) return alt.en;
			}
			for (const alt of altTitles) {
				const v = alt && Object.values(alt)[0];
				if (v) return v;
			}
		}
		return '';
	}

	private pickDescription(descObj?: Record<string, string> | null): string {
		if (!descObj || typeof descObj !== 'object') return '';
		const raw =
			descObj.en ||
			descObj[this.DEFAULT_LANG] ||
			Object.values(descObj)[0] ||
			'';
		return String(raw)
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<[^>]+>/g, '')
			.replace(/\s+/g, ' ')
			.trim();
	}

	private mapStatus(status?: string): string {
		const s = String(status || '').toLowerCase();
		if (s === 'completed') return 'Completed';
		if (s === 'hiatus') return 'Hiatus';
		if (s === 'cancelled') return 'Cancelled';
		return 'Ongoing';
	}

	/**
	 * @param size '256' | '512' | 'full'
	 */
	private coverUrl(
		mangaUuid: string,
		relationships: any[],
		size: '256' | '512' | 'full' = '256'
	): string {
		const cover = (relationships || []).find((r: any) => r?.type === 'cover_art');
		const fileName = cover?.attributes?.fileName;
		if (!fileName) return '';
		const base = `${this.uploadsBase}/covers/${mangaUuid}/${fileName}`;
		if (size === 'full') return base;
		return `${base}.${size}.jpg`;
	}

	private async fetchCoverUrl(
		mangaUuid: string,
		size: '256' | '512' | 'full' = '256'
	): Promise<string> {
		try {
			const data = await this.apiGet<{ data?: any[] }>('/cover', {
				'manga[]': [mangaUuid],
				limit: 1,
				'order[volume]': 'asc'
			});
			const fileName = data?.data?.[0]?.attributes?.fileName;
			if (!fileName) return '';
			const base = `${this.uploadsBase}/covers/${mangaUuid}/${fileName}`;
			if (size === 'full') return base;
			return `${base}.${size}.jpg`;
		} catch {
			return '';
		}
	}

	private formatDate(iso?: string | null): string {
		if (!iso) return '';
		try {
			return new Date(iso).toISOString().slice(0, 10);
		} catch {
			return String(iso).slice(0, 10);
		}
	}

	private mapListItem(item: any): Manga | null {
		const uuid = item?.id;
		if (!uuid) return null;
		const attrs = item.attributes || {};
		const title =
			this.pickTitle(attrs.title, attrs.altTitles) || String(uuid);

		const lastCh =
			attrs.lastChapter != null && String(attrs.lastChapter).trim() !== ''
				? String(attrs.lastChapter).trim()
				: undefined;

		return {
			id: this.toMangaId(uuid),
			sourceId: this.id,
			title: title.trim(),
			cover: this.coverUrl(uuid, item.relationships || [], '256'),
			type: 'manga',
			status: this.mapStatus(attrs.status),
			latestChapter: lastCh
		};
	}

	private baseMangaParams(offset: number, lang: string | null) {
		const params: Record<string, string | string[] | number | boolean> = {
			limit: this.PER_PAGE,
			offset,
			hasAvailableChapters: 'true',
			'includes[]': ['cover_art'],
			'contentRating[]': ['safe', 'suggestive', 'erotica', 'pornographic']
		};
		if (lang) {
			params['availableTranslatedLanguage[]'] = [lang];
		}
		return params;
	}

	private async batchCovers(ids: string[]): Promise<Map<string, string>> {
		const covers = new Map<string, string>();
		if (!ids.length) return covers;

		try {
			const mangaData = await this.apiGet<{ data?: any[] }>('/manga', {
				limit: Math.min(100, ids.length),
				'ids[]': ids,
				'includes[]': ['cover_art']
			});
			for (const it of mangaData?.data || []) {
				const id = String(it?.id || '');
				if (!id) continue;
				const u = this.coverUrl(id, it.relationships || [], '256');
				if (u) covers.set(id, u);
			}
		} catch (e) {
			console.error('[mangadex] batch cover /manga failed', e);
		}

		const missing = ids.filter((id) => !covers.get(id));
		if (missing.length) {
			try {
				const coverData = await this.apiGet<{ data?: any[] }>('/cover', {
					limit: Math.min(100, missing.length * 2),
					'manga[]': missing,
					'order[volume]': 'asc'
				});
				for (const it of coverData?.data || []) {
					const fileName = it?.attributes?.fileName;
					const mangaId = String(
						(it?.relationships || []).find((r: any) => r?.type === 'manga')
							?.id || ''
					);
					if (!mangaId || !fileName || covers.has(mangaId)) continue;
					covers.set(
						mangaId,
						`${this.uploadsBase}/covers/${mangaId}/${fileName}.256.jpg`
					);
				}
			} catch (e) {
				console.error('[mangadex] batch cover /cover failed', e);
			}
		}

		return covers;
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		const p = Math.max(1, Number(page) || 1);
		const offset = (p - 1) * this.PER_PAGE;
		const lang = this.normalizeLang(opts?.lang);

		try {
			const feedParams: Record<
				string,
				string | string[] | number | boolean
			> = {
				limit: this.PER_PAGE * 3,
				offset: offset * 2,
				'order[readableAt]': 'desc',
				'includes[]': ['manga'],
				includeEmptyPages: '0',
				includeFuturePublishAt: '0',
				includeExternalUrl: '0',
				'contentRating[]': ['safe', 'suggestive', 'erotica', 'pornographic']
			};
			if (lang) {
				feedParams['translatedLanguage[]'] = [lang];
			}

			const feed = await this.apiGet<{ data?: any[] }>('/chapter', feedParams);
			const batch = feed?.data || [];

			const seen = new Set<string>();
			const pending: {
				uuid: string;
				title: string;
				status: string;
				latestChapter: string;
				lang: string;
			}[] = [];

			for (const ch of batch) {
				const a = ch?.attributes || {};
				const mangaRel = (ch?.relationships || []).find(
					(r: any) => r?.type === 'manga'
				);
				const uuid = String(mangaRel?.id || '');
				if (!uuid || seen.has(uuid)) continue;
				seen.add(uuid);

				const mattrs = mangaRel?.attributes || {};
				const title =
					this.pickTitle(mattrs.title, mattrs.altTitles) || uuid;
				const chNum =
					a.chapter != null && String(a.chapter).trim() !== ''
						? String(a.chapter).trim()
						: '';
				const chLang = String(a.translatedLanguage || '').toLowerCase();

				pending.push({
					uuid,
					title: title.trim(),
					status: this.mapStatus(mattrs.status),
					latestChapter: chNum,
					lang: chLang
				});

				if (pending.length >= this.PER_PAGE) break;
			}

			const covers = await this.batchCovers(pending.map((x) => x.uuid));

			const list: Manga[] = pending.map((x) => ({
				id: this.toMangaId(x.uuid),
				sourceId: this.id,
				title: x.title,
				cover: covers.get(x.uuid) || '',
				type: 'manga',
				status: x.status,
				latestChapter: x.latestChapter || undefined,
				lang: x.lang || undefined
			}));

			console.log(
				`[mangadex] latest page=${p} lang=${lang ?? 'all'} → ${list.length} (covers=${covers.size})`
			);
			return list;
		} catch (e) {
			console.error('[mangadex] getLatestManga chapter-feed failed', e);
			try {
				const data = await this.apiGet<{ data?: any[] }>('/manga', {
					...this.baseMangaParams(offset, lang),
					'order[latestUploadedChapter]': 'desc'
				});
				return (data?.data || [])
					.map((it) => this.mapListItem(it))
					.filter(Boolean) as Manga[];
			} catch (e2) {
				console.error('[mangadex] getLatestManga fallback failed', e2);
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

		const offset = (page - 1) * this.PER_PAGE;
		const lang = this.normalizeLang(opts?.lang);

		try {
			const data = await this.apiGet<{ data?: any[] }>('/manga', {
				...this.baseMangaParams(offset, lang),
				title: q,
				'order[relevance]': 'desc'
			});

			const list = (data?.data || [])
				.map((it) => this.mapListItem(it))
				.filter(Boolean) as Manga[];

			console.log(`[mangadex] search "${q}" → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[mangadex] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		opts?: { lang?: string }
	): Promise<MangaDetails> {
		const uuid = this.extractMangaUuid(mangaId);
		if (!uuid) throw new Error(`Invalid mangadex id: ${mangaId}`);

		const data = await this.apiGet<{ data?: any }>(`/manga/${uuid}`, {
			'includes[]': ['cover_art', 'author', 'artist']
		});
		const item = data?.data;
		if (!item?.id) throw new Error(`Manga not found: ${uuid}`);

		const attrs = item.attributes || {};
		const title = this.pickTitle(attrs.title, attrs.altTitles) || uuid;
		const synopsis = this.pickDescription(attrs.description);

		const altTitles: string[] = [];
		for (const alt of attrs.altTitles || []) {
			const t = this.pickTitle(alt);
			if (t && t !== title && !altTitles.includes(t)) altTitles.push(t);
		}

		const genres = (attrs.tags || [])
			.map(
				(t: any) =>
					t?.attributes?.name?.en || this.pickTitle(t?.attributes?.name)
			)
			.filter(Boolean) as string[];

		const authors: string[] = [];
		for (const rel of item.relationships || []) {
			if (rel?.type === 'author' || rel?.type === 'artist') {
				const name = rel?.attributes?.name;
				if (name && !authors.includes(name)) authors.push(name);
			}
		}

		let rating10: string | null = null;
		try {
			const stats = await this.apiGet<{
				statistics?: Record<string, any>;
			}>(`/statistics/manga/${uuid}`);
			const bayesian = stats?.statistics?.[uuid]?.rating?.bayesian;
			if (bayesian != null && !Number.isNaN(Number(bayesian))) {
				rating10 = Number(bayesian).toFixed(1);
			}
		} catch {
			/* ignore */
		}

		// Detail pakai 512 (cukup tajam, tidak terlalu besar)
		let cover = this.coverUrl(uuid, item.relationships || [], '512');
		if (!cover) {
			cover = await this.fetchCoverUrl(uuid, '512');
		}

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		let offset = 0;
		const limit = 100;
		let total = Infinity;
		const feedLangs = this.resolveFeedLangs(opts?.lang);

		const chapterLangSet = new Set<string>();
		if (Array.isArray(attrs.availableTranslatedLanguages)) {
			for (const l of attrs.availableTranslatedLanguages) {
				const s = String(l || '').trim().toLowerCase();
				if (s) chapterLangSet.add(s);
			}
		}

		while (offset < total && offset < 5000) {
			const feedParams: Record<
				string,
				string | string[] | number | boolean
			> = {
				limit,
				offset,
				'order[chapter]': 'asc',
				includeEmptyPages: '0',
				includeFuturePublishAt: '0',
				includeExternalUrl: '0',
				'contentRating[]': [
					'safe',
					'suggestive',
					'erotica',
					'pornographic'
				]
			};

			if (feedLangs?.length) {
				feedParams['translatedLanguage[]'] = feedLangs;
			}

			const feed = await this.apiGet<{ data?: any[]; total?: number }>(
				`/manga/${uuid}/feed`,
				feedParams
			);
			total = Number(feed?.total) || 0;
			const batch = feed?.data || [];
			if (!batch.length) break;

			for (const ch of batch) {
				const cid = String(ch.id || '');
				if (!cid || seen.has(cid)) continue;
				seen.add(cid);

				const a = ch.attributes || {};
				const num = parseFloat(String(a.chapter ?? ''));
				const number = Number.isFinite(num) ? num : chapters.length + 1;
				const lang = String(a.translatedLanguage || '').toLowerCase();
				if (lang) chapterLangSet.add(lang);

				const chTitle = a.title
					? `Chapter ${number} — ${a.title}`
					: `Chapter ${number}`;

				chapters.push({
					id: this.toChapterId(uuid, cid),
					title: chTitle,
					number,
					date: this.formatDate(
						a.publishAt || a.readableAt || a.createdAt
					),
					lang: lang || undefined
				});
			}

			offset += limit;
			if (batch.length < limit) break;
		}

		chapters.sort((a, b) => {
			const dn = (a.number || 0) - (b.number || 0);
			if (dn !== 0) return dn;
			return String(a.title).localeCompare(String(b.title));
		});

		const displayLangs =
			feedLangs?.length === 1
				? feedLangs
				: [...chapterLangSet].sort();

		const metaLines = [
			altTitles.length && `Alternative: ${altTitles.slice(0, 5).join(' · ')}`,
			rating10 && `Rating: ${rating10}`,
			authors[0] && `Author: ${authors[0]}`,
			displayLangs.length ? `Language: ${displayLangs.join(', ')}` : null,
			attrs.year && `Publication: ${attrs.year}`,
			`Type: Manga`
		].filter(Boolean);

		const description = [...metaLines, synopsis].filter(Boolean).join('\n');

		const latestChapter =
			attrs.lastChapter != null && String(attrs.lastChapter).trim() !== ''
				? String(attrs.lastChapter).trim()
				: chapters.length
					? String(chapters[chapters.length - 1].number)
					: undefined;

		return {
			id: this.toMangaId(uuid),
			sourceId: this.id,
			title: String(title).trim(),
			cover,
			type: 'manga',
			status: this.mapStatus(attrs.status),
			description,
			authors,
			genres,
			chapters,
			latestChapter
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const chapterUuid = this.extractChapterUuid(chapterId);
		if (!chapterUuid) {
			console.error('[mangadex] getChapterPages bad id:', chapterId);
			return [];
		}

		try {
			const data = await this.apiGet<{
				baseUrl?: string;
				chapter?: {
					hash?: string;
					data?: string[];
					dataSaver?: string[];
				};
			}>(`/at-home/server/${chapterUuid}`);

			const baseUrl = data?.baseUrl;
			const hash = data?.chapter?.hash;
			const files = data?.chapter?.data?.length
				? data.chapter.data
				: data?.chapter?.dataSaver || [];
			const quality = data?.chapter?.data?.length ? 'data' : 'data-saver';

			if (!baseUrl || !hash || !files.length) {
				console.error('[mangadex] empty at-home', chapterUuid);
				return [];
			}

			const urls = files.map(
				(file: string) => `${baseUrl}/${quality}/${hash}/${file}`
			);
			console.log(`[mangadex] ${urls.length} pages → ${chapterUuid}`);
			return urls;
		} catch (e) {
			console.error('[mangadex] getChapterPages failed', chapterUuid, e);
			return [];
		}
	}
}