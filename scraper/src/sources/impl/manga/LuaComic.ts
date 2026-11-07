/**
 * Lua Comic adapter (luacomic.org)
 *
 * Theme     : HeanCMS (+ HTML homepage for "Latest Updates")
 * API base  : https://api.luacomic.org
 *
 * Latest    : scrape homepage section ".latest-poster" / "Latest Updates"
 *             fallback API:
 *             GET /query?query_string=&status=All&order=asc&orderBy=latest
 *                 &series_type=Comic&page=&perPage=24&tags_ids=[]&adult=true
 * Search    : GET /query?...&orderBy=total_views&query_string=
 * Detail    : GET /series/{slug}
 * Chapters  : GET /chapter/query?series_id=&page=&perPage=100
 * Pages     : GET /chapter/{seriesSlug}/{chapterSlug} → chapter.chapter_data.images[]
 *
 * ID format:
 *   manga   : /series/{slug}#{seriesId}
 *   chapter : /series/{slug}/{chapterSlug}#{chapterId}
 */

import { BaseSource } from '../../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import * as cheerio from 'cheerio';

export class LuaComicSource extends BaseSource {
	id = 'luacomic';
	name = 'Lua Comic';
	baseUrl = 'https://luacomic.org';
	private readonly apiBase = 'https://api.luacomic.org';
	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'en';

	// ── HTTP ─────────────────────────────────────────────────────────────────

	private async apiGet<T = any>(path: string): Promise<T> {
		const url = path.startsWith('http') ? path : `${this.apiBase}${path}`;
		const html = await fetchWithCf(url, {
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
				Accept: 'application/json, text/plain, */*',
				'Accept-Language': 'en-US,en;q=0.9',
				Referer: `${this.baseUrl}/`,
				Origin: this.baseUrl
			}
		});

		const trimmed = (html || '').trim();
		if (!trimmed) throw new Error(`LuaComic empty response → ${url}`);
		if (trimmed.startsWith('<') || /just a moment|cloudflare|attention required/i.test(trimmed.slice(0, 500))) {
			throw new Error(`LuaComic CF challenge still blocking → ${url}`);
		}

		try {
			return JSON.parse(trimmed) as T;
		} catch {
			throw new Error(`LuaComic invalid JSON → ${url}: ${trimmed.slice(0, 120)}`);
		}
	}

	protected override async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		return fetchWithCf(url, {
			headers: {
				...this.headers,
				Referer: this.baseUrl + '/'
			}
		});
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private toMangaId(slug: string, seriesId?: number | string): string {
		const s = String(slug).replace(/^\/+|\/+$/g, '');
		const base = `/series/${s}`;
		return seriesId != null && String(seriesId) !== '' ? `${base}#${seriesId}` : base;
	}

	private extractSlug(mangaId: string): string {
		const raw = String(mangaId).replace(/^\/+/, '').split('#')[0];
		const parts = raw.split('/').filter(Boolean);
		if (parts[0]?.toLowerCase() === 'series' && parts[1]) return parts[1];
		return parts[0] || '';
	}

	private extractSeriesId(mangaId: string): string {
		const hash = String(mangaId).split('#')[1];
		return hash ? hash.trim() : '';
	}

	private toChapterId(
		seriesSlug: string,
		chapterSlug: string,
		chapterId: number | string
	): string {
		const s = String(seriesSlug).replace(/^\/+|\/+$/g, '');
		const c = String(chapterSlug).replace(/^\/+|\/+$/g, '');
		return `/series/${s}/${c}#${chapterId}`;
	}

	private parseChapterParts(chapterId: string): {
		seriesSlug: string;
		chapterSlug: string;
		numericId: string;
		apiPath: string;
	} {
		const raw = String(chapterId).replace(/^\/+/, '');
		const hashIdx = raw.indexOf('#');
		const numericId = hashIdx >= 0 ? raw.slice(hashIdx + 1) : '';
		const path = (hashIdx >= 0 ? raw.slice(0, hashIdx) : raw).replace(/\/+$/, '');
		const parts = path.split('/').filter(Boolean);
		const seriesSlug = parts[0] === 'series' ? parts[1] || '' : parts[0] || '';
		const chapterSlug =
			parts[0] === 'series' ? parts.slice(2).join('/') : parts.slice(1).join('/');
		const apiPath = `/chapter/${seriesSlug}/${chapterSlug}`;
		return { seriesSlug, chapterSlug, numericId, apiPath };
	}

	private absUrl(href: string): string {
		if (!href) return '';
		if (href.startsWith('http')) return href;
		if (href.startsWith('//')) return `https:${href}`;
		return `${this.apiBase}${href.startsWith('/') ? '' : '/'}${href}`;
	}

	private stripHtml(html: string): string {
		return String(html || '')
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/p>/gi, '\n')
			.replace(/<[^>]+>/g, '')
			.replace(/&nbsp;/g, ' ')
			.replace(/&amp;/g, '&')
			.replace(/&quot;/g, '"')
			.replace(/&#039;/g, "'")
			.replace(/\n{3,}/g, '\n\n')
			.replace(/\s+/g, ' ')
			.trim();
	}

	private mapStatus(raw?: string | null): string {
		const s = String(raw || '').toLowerCase();
		if (s.includes('complet') || s.includes('finished')) return 'Completed';
		if (s.includes('hiatus')) return 'Hiatus';
		if (s.includes('drop') || s.includes('cancel')) return 'Dropped';
		if (s.includes('ongoing')) return 'Ongoing';
		return 'Ongoing';
	}

	private extractLatestChapter(item: any): string | undefined {
		if (!item || typeof item !== 'object') return undefined;

		const tryParse = (v: unknown): string | undefined => {
			if (v == null || v === '') return undefined;
			if (typeof v === 'number' && Number.isFinite(v) && v > 0) return String(v);
			if (typeof v === 'string') {
				const n = this.parseChapterNumber(v, v);
				if (n > 0) return String(n);
			}
			if (typeof v === 'object') {
				const o = v as Record<string, unknown>;
				const name = String(o.chapter_name || o.name || o.title || '');
				const slug = String(o.chapter_slug || o.slug || '');
				const n = this.parseChapterNumber(name, slug);
				if (n > 0) return String(n);
				if (o.number != null && Number(o.number) > 0) return String(o.number);
			}
			return undefined;
		};

		for (const key of [
			'badge_chapter',
			'latest_chapter',
			'last_chapter',
			'lastChapter',
			'chapter_name',
			'free_chapter',
			'latestChapter'
		]) {
			const n = tryParse(item[key]);
			if (n) return n;
		}

		for (const key of ['chapters', 'free_chapters', 'freeChapters']) {
			const arr = item[key];
			if (!Array.isArray(arr) || arr.length === 0) continue;
			const first = tryParse(arr[0]);
			const last = tryParse(arr[arr.length - 1]);
	
			if (first && last) {
				return parseFloat(last) >= parseFloat(first) ? last : first;
			}
			if (last) return last;
			if (first) return first;
		}

		if (item.free_chapters != null && typeof item.free_chapters === 'number' && item.free_chapters > 0) {
			return String(item.free_chapters);
		}

		return undefined;
	}

	private mapListItem(item: any): Manga | null {
		const slug = item?.series_slug || item?.slug;
		if (!slug) return null;
		const title = String(item.title || slug).trim();
		if (!title) return null;

		const cover = this.absUrl(item.thumbnail || item.cover || '');
		const id = this.toMangaId(slug, item.id);
		const latestChapter = this.extractLatestChapter(item);

		return {
			id,
			sourceId: this.id,
			title,
			cover,
			type: 'manhwa',
			status: this.mapStatus(item.status),
			lang: this.DEFAULT_LANG,
			latestChapter
		};
	}

	private async attachLatestChapter(manga: Manga): Promise<Manga> {
		if (manga.latestChapter) return manga;
		try {
			let seriesId = this.extractSeriesId(manga.id);
			if (!seriesId) {
				const slug = this.extractSlug(manga.id);
				if (!slug) return manga;
				const series = await this.apiGet<any>(`/series/${encodeURIComponent(slug)}`);
				seriesId = series?.id != null ? String(series.id) : '';
				if (seriesId) {
					manga.id = this.toMangaId(slug, seriesId);
					const fromSeries = this.extractLatestChapter(series);
					if (fromSeries) {
						manga.latestChapter = fromSeries;
						return manga;
					}
				}
			}
			if (!seriesId) return manga;

			const meta = await this.apiGet<{
				data?: any[];
				meta?: { last_page?: number; current_page?: number };
			}>(`/chapter/query?page=1&perPage=1&series_id=${encodeURIComponent(seriesId)}`);
			const lastPage = Number(meta?.meta?.last_page) || 1;
			let ch = meta?.data?.[0];
			if (lastPage > 1) {
				const last = await this.apiGet<{ data?: any[] }>(
					`/chapter/query?page=${lastPage}&perPage=1&series_id=${encodeURIComponent(seriesId)}`
				);
				ch = last?.data?.[0] || ch;
			}
			if (!ch) return manga;
			const n = this.parseChapterNumber(
				String(ch.chapter_name || ''),
				String(ch.chapter_slug || '')
			);
			if (n > 0) manga.latestChapter = String(n);
		} catch {
		}
		return manga;
	}

	private formatDate(iso?: string | null): string {
		if (!iso) return '';
		try {
			return new Date(iso).toISOString().slice(0, 10);
		} catch {
			return String(iso).slice(0, 10);
		}
	}

	private parseChapterNumber(name: string, slug?: string): number {
		const fromName = String(name || '').match(
			/(?:chapter|chap|ch\.?)\s*(\d+(?:\.\d+)?)/i
		);
		if (fromName) return parseFloat(fromName[1]);
		const fromSlug = String(slug || '').match(/(\d+(?:\.\d+)?)/);
		if (fromSlug) return parseFloat(fromSlug[1]);
		const any = String(name).match(/\b(\d+(?:\.\d+)?)\b/);
		return any ? parseFloat(any[1]) : 0;
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	private buildQueryUrl(opts: {
		page: number;
		query?: string;
		orderBy?: string;
		order?: string;
	}): string {
		const page = Math.max(1, opts.page || 1);
		const params = new URLSearchParams({
			query_string: opts.query || '',
			status: 'All',
			order: opts.order || 'asc',
			orderBy: opts.orderBy || 'latest',
			series_type: 'Comic',
			page: String(page),
			perPage: String(this.PER_PAGE),
			tags_ids: '[]',
			adult: 'true'
		});
		return `/query?${params.toString()}`;
	}

	private parseLatestFromHtml(html: string): Manga[] {
		const $ = cheerio.load(html);
		const res: Manga[] = [];
		const seen = new Set<string>();

		let $cards = $();
		$('h1, h2, h3, h4, h5').each((_, el) => {
			if (/latest\s*updates?/i.test($(el).text())) {
				const $section = $(el).closest('section, div').parent();
				const found = $section.find('.latest-poster');
				if (found.length) $cards = found;
				else {
					const sib = $(el).parent().nextAll().find('.latest-poster');
					if (sib.length) $cards = sib;
				}
			}
		});
		if (!$cards.length) $cards = $('.latest-poster');

		$cards.each((_, el) => {
			if (res.length >= this.PER_PAGE) return false;
			const $card = $(el);
			const $a =
				$card.find('a[href*="/series/"]').first().length
					? $card.find('a[href*="/series/"]').first()
					: $card.is('a')
						? $card
						: $card.find('a').first();
			const href = ($a.attr('href') || '').trim();
			const m = href.match(/\/series\/([^/#?]+)/i);
			if (!m?.[1]) return;
			const slug = decodeURIComponent(m[1].replace(/\/+$/, ''));
			if (!slug || seen.has(slug)) return;
			seen.add(slug);

			const title =
				($a.attr('title') || '').trim() ||
				($a.attr('alt') || '').trim() ||
				$card.find('h2, h3, h4').first().text().replace(/\s+/g, ' ').trim() ||
				$a.text().replace(/\s+/g, ' ').trim();
			if (!title || title.length < 2) return;

			let cover = '';
			const style = $a.attr('style') || $card.find('[style*="background"]').attr('style') || '';
			const bg = style.match(/url\(\s*['"]?([^)'"]+)['"]?\s*\)/i);
			if (bg?.[1]) cover = bg[1].replace(/&amp;/g, '&').trim();
			if (!cover) {
				const img = $card.find('img').first();
				cover =
					img.attr('src') ||
					img.attr('data-src') ||
					(img.attr('srcset') || '').split(/[,\s]/)[0] ||
					'';
			}

			const wsrv = cover.match(/[?&]url=([^&]+)/i);
			if (wsrv) {
				try {
					cover = decodeURIComponent(wsrv[1]);
				} catch {
				}
			}
			if (cover && !/^https?:\/\//i.test(cover)) {
				cover = cover.startsWith('//')
					? `https:${cover}`
					: `${this.baseUrl}${cover.startsWith('/') ? '' : '/'}${cover}`;
			}

			let latestChapter: string | undefined;
			const cardText = $card.text().replace(/\s+/g, ' ');
			const chMatch =
				cardText.match(/Chapter\s*(\d+(?:\.\d+)?)/i) ||
				cardText.match(/\bCh\.?\s*(\d+(?:\.\d+)?)/i);
			if (chMatch) latestChapter = chMatch[1];

			res.push({
				id: this.toMangaId(slug),
				sourceId: this.id,
				title: title.replace(/\s*Chapter\s*\d+.*$/i, '').trim(),
				cover,
				type: 'manhwa',
				status: 'Ongoing',
				lang: this.DEFAULT_LANG,
				latestChapter
			});
		});

		return res;
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		const p = Math.max(1, Number(page) || 1);

		if (p === 1) {
			try {
				const html = await this.fetchHtml('/');
				const fromHtml = this.parseLatestFromHtml(html);
				if (fromHtml.length > 0) {
					const needBadge = fromHtml.filter((m) => !m.latestChapter);
					if (needBadge.length > 0) {
						await Promise.all(needBadge.map((m) => this.attachLatestChapter(m)));
					}
					console.log(`[luacomic] latest HTML section → ${fromHtml.length}`);
					return fromHtml.slice(0, this.PER_PAGE);
				}
			} catch (e) {
				console.warn('[luacomic] HTML latest failed, fallback API', e);
			}
		}

		try {
			const data = await this.apiGet<{ data?: any[] }>(
				this.buildQueryUrl({ page: p, orderBy: 'latest', order: 'asc' })
			);
			let list = (data?.data || [])
				.map((it) => this.mapListItem(it))
				.filter(Boolean) as Manga[];

			const needBadge = list.filter((m) => !m.latestChapter);
			if (needBadge.length > 0) {
				await Promise.all(needBadge.map((m) => this.attachLatestChapter(m)));
			}

			list = list.slice(0, this.PER_PAGE);
			console.log(`[luacomic] latest API page=${p} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[luacomic] getLatestManga', e);
			return [];
		}
	}

	async searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, Number(opts?.page) || 1);
		if (!q) return this.getLatestManga(page);

		try {
			const data = await this.apiGet<{ data?: any[] }>(
				this.buildQueryUrl({
					page,
					query: q,
					orderBy: 'total_views',
					order: 'desc'
				})
			);
			let list = (data?.data || [])
				.map((it) => this.mapListItem(it))
				.filter(Boolean) as Manga[];

			const needBadge = list.filter((m) => !m.latestChapter);
			if (needBadge.length > 0) {
				await Promise.all(needBadge.map((m) => this.attachLatestChapter(m)));
			}

			list = list.slice(0, this.PER_PAGE);
			console.log(`[luacomic] search "${q}" page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[luacomic] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) throw new Error(`Invalid luacomic id: ${mangaId}`);

		const series = await this.apiGet<any>(`/series/${encodeURIComponent(slug)}`);
		if (!series?.id && !series?.series_slug && !series?.title) {
			throw new Error(`Manga not found: ${slug}`);
		}

		const finalSlug = String(series.series_slug || series.slug || slug);
		const seriesId = series.id;
		const title = String(series.title || finalSlug).trim();
		const cover = this.absUrl(series.thumbnail || series.cover || '');
		const synopsis = this.stripHtml(series.description || '');
		const authors: string[] = [];
		for (const key of ['author', 'studio']) {
			const v = String(series[key] || '').trim();
			if (v && !authors.includes(v)) authors.push(v);
		}
		const genres = (series.tags || [])
			.map((t: any) => String(t?.name || t || '').trim())
			.filter(Boolean);

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		let page = 1;
		let lastPage = 1;
		const sid = String(seriesId || this.extractSeriesId(mangaId));

		if (sid) {
			do {
				const chRes = await this.apiGet<{
					data?: any[];
					meta?: { current_page?: number; last_page?: number };
				}>(
					`/chapter/query?page=${page}&perPage=100&series_id=${encodeURIComponent(sid)}`
				);
				lastPage = Number(chRes?.meta?.last_page) || 1;
				for (const ch of chRes?.data || []) {
					const cslug = String(ch.chapter_slug || ch.slug || '').trim();
					const cid = ch.id;
					if (!cslug || cid == null) continue;
					const id = this.toChapterId(finalSlug, cslug, cid);
					if (seen.has(id)) continue;
					seen.add(id);

					const name = String(ch.chapter_name || cslug).trim();
					const number = this.parseChapterNumber(name, cslug);
					const price = Number(ch.price) || 0;
					const locked = price > 0;

					chapters.push({
						id,
						title: `Chapter ${number || cslug}`,
						number: number || chapters.length + 1,
						date: this.formatDate(ch.created_at),
						isLocked: locked || undefined
					});
				}
				page++;
			} while (page <= lastPage && page <= 30);
		}

		chapters.sort((a, b) => (a.number || 0) - (b.number || 0));

		const metaLines = [
			authors[0] && `Author: ${authors[0]}`,
			series.studio &&
				series.studio !== authors[0] &&
				`Artist: ${series.studio}`,
			`Type: Manhwa`,
			`Language: English`
		].filter(Boolean);

		const description = [...metaLines, synopsis].filter(Boolean).join('\n');

		return {
			id: this.toMangaId(finalSlug, seriesId),
			sourceId: this.id,
			title,
			cover,
			type: 'manhwa',
			status: this.mapStatus(series.status),
			description,
			authors,
			genres,
			chapters,
			latestChapter:
				chapters.length > 0
					? String(chapters[chapters.length - 1].number)
					: undefined
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const { apiPath, seriesSlug, chapterSlug } = this.parseChapterParts(chapterId);
		if (!seriesSlug || !chapterSlug) {
			console.error('[luacomic] getChapterPages → bad id:', chapterId);
			return [];
		}

		try {
			const data = await this.apiGet<{
				chapter?: {
					chapter_data?: { images?: string[] } | null;
				};
				paywall?: boolean;
			}>(apiPath);

			if (data?.paywall === true && !data?.chapter?.chapter_data) {
				console.warn('[luacomic] chapter locked:', chapterId);
				return [];
			}

			const images = data?.chapter?.chapter_data?.images || [];
			const urls = images
				.map((img) => this.absUrl(String(img || '').trim()))
				.filter((u) => /^https?:\/\//i.test(u));

			console.log(`[luacomic] ${urls.length} pages → ${seriesSlug}/${chapterSlug}`);
			return urls;
		} catch (e) {
			console.error('[luacomic] getChapterPages failed', chapterId, e);
			return [];
		}
	}

	async resolveMangaIdFromChapter(chapterId: string): Promise<string | null> {
		const { seriesSlug } = this.parseChapterParts(chapterId);
		if (!seriesSlug) return null;
		return this.toMangaId(seriesSlug);
	}
}
