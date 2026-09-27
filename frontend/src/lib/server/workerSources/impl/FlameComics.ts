/**
 * Flame Comics adapter (Next.js _next/data API)
 *
 * Latest  : GET /_next/data/{buildId}/index.json
 *           → pageProps.latestEntries.blocks[0].series
 * Browse  : GET /_next/data/{buildId}/browse.json
 *           → pageProps.series (client-side search + page slice)
 * Detail  : GET /_next/data/{buildId}/series/{id}.json?id=
 * Pages   : GET /_next/data/{buildId}/series/{id}/{token}.json?id=&token=
 * Images  : https://cdn.flamecomics.xyz/uploads/images/series/{id}/{token}/{name}?{release_date}
 *
 * ID format:
 *   manga   : "/series/{id}"
 *   chapter : "/series/{id}/chapter/{token}"
 *
 * Bahasa default: English
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';

export class FlameComicsSource extends BaseSource {
	id = 'flamecomics';
	name = 'Flame Comics';
	baseUrl = 'https://flamecomics.xyz';

	private readonly cdn = 'https://cdn.flamecomics.xyz';
	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'en';

	private buildId = '';

	// ── HTTP ─────────────────────────────────────────────────────────────────

	private reqHeaders(): Record<string, string> {
		return {
			...this.headers,
			Accept: 'application/json, text/plain, */*',
			'Accept-Language': 'en-US,en;q=0.9',
			Origin: this.baseUrl,
			Referer: `${this.baseUrl}/`,
			'Cache-Control': 'no-cache'
		};
	}

	private async ensureBuildId(): Promise<string> {
		if (this.buildId) return this.buildId;

		const res = await fetch(this.baseUrl + '/', { headers: this.reqHeaders() });
		const html = await res.text();
		const m =
			html.match(/"buildId"\s*:\s*"([^"]+)"/) ||
			html.match(/\/_next\/static\/([A-Za-z0-9_-]+)\/_buildManifest\.js/);
		if (!m?.[1]) throw new Error('FlameComics: failed to resolve buildId');
		this.buildId = m[1];
		return this.buildId;
	}

	private async dataGet<T = any>(
		dataPath: string,
		params?: Record<string, string | number | undefined | null>
	): Promise<T> {
		const buildId = await this.ensureBuildId();
		const url = new URL(
			`${this.baseUrl}/_next/data/${buildId}/${dataPath.replace(/^\//, '')}`
		);
		if (params) {
			for (const [k, v] of Object.entries(params)) {
				if (v === undefined || v === null || v === '') continue;
				url.searchParams.set(k, String(v));
			}
		}

		const maxAttempts = 3;
		let lastErr: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const res = await fetch(url.toString(), { headers: this.reqHeaders() });
				const text = await res.text();
				const trimmed = text.trim();

				// buildId outdated → refresh and retry
				if (
					res.status === 404 &&
					(trimmed.startsWith('<') ||
						trimmed.toLowerCase().includes('<!doctype'))
				) {
					this.buildId = '';
					await this.ensureBuildId();
					lastErr = new Error('FlameComics buildId outdated');
					await new Promise((r) => setTimeout(r, 200 * attempt));
					continue;
				}

				if (!res.ok) {
					console.error(
						`[flamecomics] HTTP ${res.status} ${url.pathname}`,
						trimmed.slice(0, 200)
					);
					if (res.status === 429 || res.status === 503) {
						lastErr = new Error(`FlameComics HTTP ${res.status}`);
						await new Promise((r) => setTimeout(r, 500 * attempt));
						continue;
					}
					throw new Error(`FlameComics HTTP ${res.status}`);
				}

				try {
					return JSON.parse(trimmed) as T;
				} catch {
					throw new Error('FlameComics invalid JSON');
				}
			} catch (e) {
				lastErr = e;
				if (attempt < maxAttempts) {
					await new Promise((r) => setTimeout(r, 300 * attempt));
					continue;
				}
			}
		}

		throw lastErr instanceof Error
			? lastErr
			: new Error('FlameComics request failed');
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private toMangaId(seriesId: string | number): string {
		return `/series/${seriesId}`;
	}

	private extractSeriesId(mangaId: string): string {
		const parts = String(mangaId)
			.replace(/^\/+/, '')
			.split('/')
			.filter(Boolean);
		if (parts[0]?.toLowerCase() === 'series' && parts[1]) return parts[1];
		return parts[0] || '';
	}

	private toChapterId(seriesId: string | number, token: string): string {
		return `/series/${seriesId}/chapter/${token}`;
	}

	private extractChapterParts(chapterId: string): {
		seriesId: string;
		token: string;
	} {
		const s = String(chapterId).replace(/^\/+/, '');
		const m = s.match(/^series\/([^/]+)\/chapter\/(.+)$/i);
		if (m) return { seriesId: m[1], token: m[2] };
		const parts = s.split('/').filter(Boolean);
		return {
			seriesId: parts[0] === 'series' ? parts[1] || '' : parts[0] || '',
			token: parts[parts.length - 1] || ''
		};
	}

	private mapStatus(status?: string | null): string {
		const s = String(status || '').toLowerCase();
		if (s === 'completed' || s === 'complete') return 'Completed';
		if (s === 'hiatus') return 'Hiatus';
		if (s === 'dropped' || s === 'cancelled') return 'Cancelled';
		return 'Ongoing';
	}

	private mapType(type?: string | null, country?: string | null): string {
		const t = String(type || '').toLowerCase();
		if (t === 'manhwa') return 'manhwa';
		if (t === 'manhua') return 'manhua';
		if (t === 'manga') return 'manga';
		const c = String(country || '').toUpperCase();
		if (c === 'KR') return 'manhwa';
		if (c === 'CN') return 'manhua';
		if (c === 'JP') return 'manga';
		return 'manhwa';
	}

	private coverUrl(series: any): string {
		const id = series?.series_id;
		const cover = series?.cover;
		if (!id || !cover) return '';
		const lastEdit = series?.last_edit != null ? String(series.last_edit) : '';
		const base = `${this.cdn}/uploads/images/series/${id}/${cover}`;
		return lastEdit ? `${base}?${lastEdit}` : base;
	}

	private formatDate(unix?: number | null): string {
		if (unix == null || !Number.isFinite(Number(unix))) return '';
		try {
			const ms = Number(unix) > 1e12 ? Number(unix) : Number(unix) * 1000;
			return new Date(ms).toISOString().slice(0, 10);
		} catch {
			return '';
		}
	}

	private parseChapterNumber(raw: unknown): number {
		const n = parseFloat(String(raw ?? '').replace(/,/g, ''));
		return Number.isFinite(n) ? n : NaN;
	}

	private stripHtml(html?: string | null): string {
		if (!html) return '';
		return String(html)
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/p>/gi, '\n')
			.replace(/<[^>]+>/g, '')
			.replace(/&nbsp;/g, ' ')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/\s+/g, ' ')
			.trim();
	}

	private mapListItem(item: any): Manga | null {
		const id = item?.series_id;
		const title = String(item?.title || '').trim();
		if (id == null || !title) return null;

		const chs = Array.isArray(item?.chapters) ? item.chapters : [];
		const latestRaw = chs[0]?.chapter;
		const latestNum = this.parseChapterNumber(latestRaw);
		const latestChapter = Number.isFinite(latestNum)
			? String(latestNum)
			: latestRaw != null
				? String(latestRaw).replace(/\.00$/, '')
				: undefined;

		const langRaw = String(item?.language || this.DEFAULT_LANG).toLowerCase();
		const lang =
			langRaw.startsWith('en') ? 'en' :
			langRaw.startsWith('id') || langRaw.includes('indonesia') ? 'id' :
			langRaw.slice(0, 2) || this.DEFAULT_LANG;

		return {
			id: this.toMangaId(id),
			sourceId: this.id,
			title,
			cover: this.coverUrl(item),
			type: this.mapType(item?.type, item?.country),
			status: this.mapStatus(item?.status),
			latestChapter,
			lang
		} as Manga & { lang?: string };
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		const p = Math.max(1, Number(page) || 1);

		try {
			// index.json latestEntries → punya chapters (badge chapter di homepage)
			// browse.json → semua series supaya page 2+ tidak kosong
			const [indexData, browseData] = await Promise.all([
				this.dataGet<{
					pageProps?: {
						latestEntries?: { blocks?: Array<{ series?: any[] }> };
					};
				}>('index.json'),
				this.dataGet<{ pageProps?: { series?: any[] } }>('browse.json')
			]);

			const latestRows: any[] = [];
			for (const b of indexData?.pageProps?.latestEntries?.blocks || []) {
				if (Array.isArray(b?.series)) latestRows.push(...b.series);
			}

			const chapterById = new Map<number | string, any>();
			for (const it of latestRows) {
				if (it?.series_id != null) chapterById.set(it.series_id, it);
			}

			const browseRows = Array.isArray(browseData?.pageProps?.series)
				? [...browseData.pageProps.series]
				: [];

			const seenIds = new Set<number | string>();
			const ordered: any[] = [];

			// utamakan latestEntries (punya chapter number + urutan update)
			for (const it of latestRows) {
				if (it?.series_id == null || seenIds.has(it.series_id)) continue;
				seenIds.add(it.series_id);
				ordered.push(it);
			}

			browseRows.sort((a, b) => {
				const ta = Number(a?.last_edit ?? a?.time ?? 0);
				const tb = Number(b?.last_edit ?? b?.time ?? 0);
				return tb - ta;
			});

			for (const it of browseRows) {
				if (it?.series_id == null || seenIds.has(it.series_id)) continue;
				seenIds.add(it.series_id);
				const withCh = chapterById.get(it.series_id);
				ordered.push(withCh ? { ...it, chapters: withCh.chapters } : it);
			}

			const seen = new Set<string>();
			const list: Manga[] = [];
			for (const it of ordered) {
				const m = this.mapListItem(it);
				if (!m || seen.has(m.id)) continue;
				seen.add(m.id);
				list.push(m);
			}

			const start = (p - 1) * this.PER_PAGE;
			const pageList = list.slice(start, start + this.PER_PAGE);

			console.log(
				`[flamecomics] latest page=${p} → ${pageList.length} (pool=${list.length})`
			);
			return pageList;
		} catch (e) {
			console.error('[flamecomics] getLatestManga', e);
			return [];
		}
	}

	async searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		const q = (query || '').trim().toLowerCase();
		const page = Math.max(1, opts?.page || 1);
		if (!q) return this.getLatestManga(page, opts);

		try {
			const data = await this.dataGet<{
				pageProps?: { series?: any[] };
			}>('browse.json');

			const rows = Array.isArray(data?.pageProps?.series)
				? data.pageProps.series
				: [];

			const norm = (s: string) =>
				s.toLowerCase().replace(/[^a-z0-9 ]/g, '');
			const nq = norm(q);

			const filtered = rows.filter((it) => {
				const titles = [String(it?.title || '')];
				if (Array.isArray(it?.altTitles)) titles.push(...it.altTitles);
				return titles.some((t) => norm(t).includes(nq));
			});

			const list = filtered
				.map((it) => this.mapListItem(it))
				.filter(Boolean) as Manga[];

			const start = (page - 1) * this.PER_PAGE;
			const pageList = list.slice(start, start + this.PER_PAGE);

			console.log(
				`[flamecomics] search "${q}" page=${page} → ${pageList.length}`
			);
			return pageList;
		} catch (e) {
			console.error('[flamecomics] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const seriesId = this.extractSeriesId(mangaId);
		if (!seriesId) throw new Error(`Invalid flamecomics id: ${mangaId}`);

		const data = await this.dataGet<{
			pageProps?: { series?: any; chapters?: any[] };
		}>(`series/${encodeURIComponent(seriesId)}.json`, { id: seriesId });

		const series = data?.pageProps?.series;
		if (!series?.series_id && !series?.title) {
			throw new Error(`Manga not found: ${seriesId}`);
		}

		const title = String(series.title || seriesId).trim();
		const cover = this.coverUrl(series);
		const status = this.mapStatus(series.status);
		const type = this.mapType(series.type, series.country);
		const synopsis = this.stripHtml(series.description);

		const authors: string[] = [];
		for (const list of [series.author, series.artist]) {
			if (Array.isArray(list)) {
				for (const a of list) {
					const n = String(a || '').trim();
					if (n && n !== '-' && !authors.includes(n)) authors.push(n);
				}
			} else if (typeof list === 'string' && list.trim()) {
				const n = list.trim();
				if (n !== '-' && !authors.includes(n)) authors.push(n);
			}
		}

		const genres: string[] = [];
		const tagSrc = series.tags || series.categories || [];
		for (const g of tagSrc) {
			const name = String(typeof g === 'string' ? g : g?.name || '').trim();
			if (name && name.length < 40 && !genres.includes(name)) genres.push(name);
		}
		if (type && !genres.includes(type)) genres.unshift(type);

		const altList: string[] = [];
		if (Array.isArray(series.altTitles)) {
			for (const a of series.altTitles) {
				const n = String(a || '').trim();
				if (n) altList.push(n);
			}
		}
		const alt = altList.join(' · ');

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		const units = Array.isArray(data?.pageProps?.chapters)
			? data.pageProps.chapters
			: [];

		for (const u of units) {
			const token = String(u?.token || '').trim();
			if (!token || seen.has(token)) continue;
			seen.add(token);

			const number = this.parseChapterNumber(u?.chapter);
			const num = Number.isFinite(number) ? number : chapters.length + 1;
			const extra = String(u?.title || '').trim();
			const chTitle = extra
				? `Chapter ${String(u?.chapter ?? num).replace(/\.00$/, '')} - ${extra}`
				: `Chapter ${String(u?.chapter ?? num).replace(/\.00$/, '')}`;

			chapters.push({
				id: this.toChapterId(seriesId, token),
				title: chTitle,
				number: num,
				date: this.formatDate(u?.release_date)
			});
		}

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));
		const latestChapter =
			chapters[0]?.number != null ? String(chapters[0].number) : undefined;

		const rating =
			series.likes != null && Number(series.likes) > 0
				? String(series.likes)
				: null;
		const publication =
			series.year != null && String(series.year).trim()
				? String(series.year).trim()
				: '';

		const metaLines = [
			alt && `Alternative: ${alt}`,
			rating && `Rating: ${rating}`,
			publication && `Publication: ${publication}`,
			authors[0] && `Author: ${authors.join(', ')}`,
			authors[0] && `Artist: ${authors.join(', ')}`,
			`Language: English`,
			`Type: ${type}`
		].filter(Boolean);

		const description = [...metaLines, synopsis].filter(Boolean).join('\n');

		console.log(`[flamecomics] details ${seriesId} → ch=${chapters.length}`);

		return {
			id: this.toMangaId(seriesId),
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
		const { seriesId, token } = this.extractChapterParts(chapterId);
		if (!seriesId || !token) {
			console.error('[flamecomics] getChapterPages bad id:', chapterId);
			return [];
		}

		try {
			const data = await this.dataGet<{
				pageProps?: {
					chapter?: {
						images?: Record<string, { name?: string }> | Array<{ name?: string }>;
						series_id?: number;
						token?: string;
						release_date?: number;
					};
				};
			}>(
				`series/${encodeURIComponent(seriesId)}/${encodeURIComponent(token)}.json`,
				{ id: seriesId, token }
			);

			const chapter = data?.pageProps?.chapter;
			if (!chapter) return [];

			const raw = chapter.images;
			let pages: Array<{ name?: string }> = [];
			if (Array.isArray(raw)) {
				pages = raw;
			} else if (raw && typeof raw === 'object') {
				pages = Object.keys(raw)
					.sort((a, b) => Number(a) - Number(b))
					.map((k) => (raw as Record<string, any>)[k]);
			}

			const release = chapter.release_date != null ? String(chapter.release_date) : '';
			const sid = chapter.series_id ?? seriesId;
			const tok = chapter.token || token;

			const urls = pages
				.map((p) => String(p?.name || '').trim())
				.filter(Boolean)
				.map((name) => {
					const base = `${this.cdn}/uploads/images/series/${sid}/${tok}/${name}`;
					return release ? `${base}?${release}` : base;
				});

			console.log(`[flamecomics] ${urls.length} pages → ${seriesId}/${token}`);
			return urls;
		} catch (e) {
			console.error('[flamecomics] getChapterPages failed', seriesId, token, e);
			return [];
		}
	}
}
