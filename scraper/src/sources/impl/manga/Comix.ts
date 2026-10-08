/**
 * Comix adapter (comix.to)
 *
 * Theme     : Custom SPA (SSR #initial-data JSON)
 * Latest    : /  (homepage queries)  |  /browse?order[chapter_updated_at]=desc&page=N
 * Search    : /browse?keyword={q}&page=N
 * Detail    : /title/{hid-or-slug}
 * Chapters  : limited without signed API — uses first/latest from detail + synthesizes
 *             range when latestChapter known (URLs need real chapter ids from API)
 * Pages     : chapter SSR rarely embeds images; signed API required for full pages
 *
 * API /api/v1 requires HMAC-like "_" signature (ComixCipher from WebView material).
 * This adapter uses public HTML SSR so catalog/detail work without WebView.
 *
 * ID format:
 *   manga   : /title/{hid-or-slug}
 *   chapter : /title/{slug}/{chapterId}-chapter-{n}   (when known)
 */

import { BaseSource } from '../../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';
import * as cheerio from 'cheerio';

export class ComixSource extends BaseSource {
	id = 'comix';
	name = 'Comix';
	baseUrl = 'https://comix.to';

	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'en';

	// ── Helpers ──────────────────────────────────────────────────────────────

	private absUrl(href: string): string {
		if (!href) return '';
		if (href.startsWith('http')) return href;
		if (href.startsWith('//')) return `https:${href}`;
		return `${this.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
	}

	private cleanId(link: string): string {
		let id = (link || '').trim();
		if (id.startsWith('http')) {
			try {
				id = new URL(id).pathname;
			} catch {
				/* ignore */
			}
		}
		if (!id.startsWith('/')) id = `/${id}`;
		return id.replace(/\/+$/, '').split('?')[0] || '/';
	}

	private mapStatus(s?: string): string {
		const t = String(s || '').toLowerCase();
		if (t === 'finished' || t === 'completed') return 'Completed';
		if (t === 'on_hiatus' || t === 'hiatus') return 'Hiatus';
		if (t === 'discontinued' || t === 'cancelled') return 'Dropped';
		return 'Ongoing';
	}

	private mapType(t?: string): string {
		const s = String(t || '').toLowerCase();
		if (s === 'manhua') return 'manhua';
		if (s === 'manga') return 'manga';
		if (s === 'novel') return 'novel';
		return 'manhwa';
	}

	/**
	 * Direct fetch with browser headers + retry.
	 * Avoids ECONNRESET issues some Node/TLS stacks hit via fetchWithCf.
	 * Falls back to comix.ws if comix.to fails.
	 */
	private async pageFetch(path: string): Promise<string> {
		const bases = [this.baseUrl, 'https://comix.ws'];
		const headers: Record<string, string> = {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
			Accept:
				'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
			'Accept-Language': 'en-US,en;q=0.9',
			'Cache-Control': 'no-cache',
			Pragma: 'no-cache',
			'Upgrade-Insecure-Requests': '1'
		};

		let lastErr: unknown;
		for (const base of bases) {
			const url = path.startsWith('http')
				? path
				: `${base}${path.startsWith('/') ? '' : '/'}${path}`;
			for (let attempt = 1; attempt <= 3; attempt++) {
				try {
					const res = await fetch(url, {
						headers,
						redirect: 'follow'
					});
					if (!res.ok) {
						throw new Error(`HTTP ${res.status} ${url}`);
					}
					const html = await res.text();
					if (html.length < 200) {
						throw new Error(`Short body (${html.length}) ${url}`);
					}
					return html;
				} catch (e) {
					lastErr = e;
					console.warn(
						`[comix] pageFetch attempt ${attempt} failed → ${url}`,
						e
					);
					await new Promise((r) => setTimeout(r, 400 * attempt));
				}
			}
		}
		throw lastErr instanceof Error
			? lastErr
			: new Error(String(lastErr || 'pageFetch failed'));
	}

	/** Extract JSON from <script id="initial-data"> */
	private parseInitialData(html: string): any | null {
		const m = html.match(
			/<script[^>]*id=["']initial-data["'][^>]*>([\s\S]*?)<\/script>/i
		);
		if (!m?.[1]) return null;
		try {
			return JSON.parse(m[1]);
		} catch {
			return null;
		}
	}

	private mapItem(item: any): Manga | null {
		if (!item) return null;
		const hid = item.hid || '';
		const urlPath =
			item.url ||
			(hid ? `/title/${hid}` : '');
		if (!urlPath) return null;

		const type = this.mapType(item.type);
		if (type === 'novel') return null;

		const poster =
			item.poster?.large ||
			item.poster?.medium ||
			item.poster?.small ||
			(typeof item.poster === 'string' ? item.poster : '') ||
			'';

		const latest =
			item.latestChapter != null && item.latestChapter !== 0
				? String(item.latestChapter)
				: undefined;

		return {
			id: this.cleanId(urlPath),
			sourceId: this.id,
			title: String(item.title || hid).trim(),
			cover: this.absUrl(poster),
			type,
			status: this.mapStatus(item.status),
			latestChapter: latest,
			lang: this.DEFAULT_LANG
		};
	}

	/** Collect manga items from initial-data queries */
	private collectFromQueries(data: any, limit = this.PER_PAGE): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();
		const queries = data?.queries || {};

		const pushItem = (item: any) => {
			if (res.length >= limit) return;
			const m = this.mapItem(item);
			if (!m || seen.has(m.id)) return;
			seen.add(m.id);
			res.push(m);
		};

		// Prefer list with chapter_updated_at order
		const preferredKeys = Object.keys(queries).sort((a, b) => {
			const score = (k: string) => {
				let s = 0;
				if (k.includes('chapter_updated')) s += 10;
				if (k.includes('"list"')) s += 5;
				if (k.includes('hot')) s += 3;
				if (k.includes('trending')) s += 2;
				return -s;
			};
			return score(a) - score(b);
		});

		for (const key of preferredKeys) {
			const val = queries[key];
			if (Array.isArray(val)) {
				for (const item of val) pushItem(item);
			} else if (val && typeof val === 'object' && Array.isArray(val.items)) {
				for (const item of val.items) pushItem(item);
			}
			if (res.length >= limit) break;
		}

		return res;
	}

	private findDetail(data: any): any | null {
		const queries = data?.queries || {};
		for (const [key, val] of Object.entries(queries)) {
			if (
				typeof key === 'string' &&
				key.includes('"detail"') &&
				val &&
				typeof val === 'object' &&
				(val as any).hid
			) {
				return val;
			}
		}
		// fallback any object with hid+title+synopsis
		for (const val of Object.values(queries)) {
			if (
				val &&
				typeof val === 'object' &&
				!Array.isArray(val) &&
				(val as any).hid &&
				(val as any).title
			) {
				return val;
			}
		}
		return null;
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const path =
				p <= 1
					? '/'
					: `/browse?order[chapter_updated_at]=desc&page=${p}`;

			const html = await this.pageFetch(path);
			const data = this.parseInitialData(html);
			let list = data ? this.collectFromQueries(data, this.PER_PAGE) : [];

			// Homepage may have >24; slice for page 1
			if (p === 1 && list.length > this.PER_PAGE) {
				list = list.slice(0, this.PER_PAGE);
			}

			console.log(`[comix] latest page=${p} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[comix] getLatestManga', e);
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
			const path = `/browse?keyword=${encodeURIComponent(q)}&page=${page}`;
			const html = await this.pageFetch(path);
			const data = this.parseInitialData(html);
			const list = data
				? this.collectFromQueries(data, this.PER_PAGE)
				: [];
			console.log(`[comix] search "${q}" page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[comix] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const id = this.cleanId(mangaId);
		// id is /title/{slug}
		const path = id.startsWith('/title/')
			? id
			: `/title/${id.replace(/^\//, '')}`;
		const html = await this.pageFetch(path.endsWith('/') ? path : `${path}/`);
		const data = this.parseInitialData(html);
		const detail = data ? this.findDetail(data) : null;

		if (!detail) {
			throw new Error(`Comix detail not found: ${path}`);
		}

		const title = String(detail.title || '').trim();
		const cover =
			detail.poster?.large ||
			detail.poster?.medium ||
			detail.poster ||
			'';

		const authors: string[] = [];
		for (const list of [detail.authors, detail.artists]) {
			if (!Array.isArray(list)) continue;
			for (const a of list) {
				const name = String(a?.title || a?.name || '').trim();
				if (name && !authors.includes(name)) authors.push(name);
			}
		}

		const genres: string[] = [];
		for (const list of [detail.genres, detail.tags, detail.themes]) {
			if (!Array.isArray(list)) continue;
			for (const g of list) {
				const name = String(g?.title || g?.name || '').trim();
				if (name && name.length <= 40 && !genres.includes(name)) {
					genres.push(name);
				}
			}
		}

		const altTitles = Array.isArray(detail.altTitles)
			? detail.altTitles.map((t: any) => String(t).trim()).filter(Boolean)
			: [];

		const synopsis = String(detail.synopsis || '')
			.replace(/\s+/g, ' ')
			.trim();

		const rating =
			detail.ratedAvg != null
				? Number(detail.ratedAvg).toFixed(1)
				: detail.ratedScore != null
					? Number(detail.ratedScore).toFixed(1)
					: null;

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		const pushChapterUrl = (urlPath: string | undefined, fallbackNum?: number) => {
			if (!urlPath) return;
			const chId = this.cleanId(urlPath);
			if (seen.has(chId)) return;
			seen.add(chId);
			const m = chId.match(/chapter-(\d+(?:\.\d+)?)/i);
			const number = m
				? parseFloat(m[1])
				: fallbackNum != null
					? Number(fallbackNum)
					: chapters.length + 1;
			chapters.push({
				id: chId,
				title: `Chapter ${number}`,
				number
			});
		};

		pushChapterUrl(detail.firstChapterUrl, 1);
		if (detail.latestChapter != null) {
			pushChapterUrl(detail.latestChapterUrl, Number(detail.latestChapter));
		}

		// Note: full chapter list requires signed /api/v1 — only first+latest from SSR
		chapters.sort((a, b) => (a.number || 0) - (b.number || 0));

		const finalId = this.cleanId(detail.url || path);

		const metaLines = [
			altTitles.length && `Alternative: ${altTitles.join(' · ')}`,
			rating && `Rating: ${rating}`,
			authors[0] && `Author: ${authors[0]}`,
			detail.type && `Type: ${detail.type}`,
			detail.year && `Year: ${detail.year}`
		].filter(Boolean);

		const description = [...metaLines, synopsis].filter(Boolean).join('\n');

		return {
			id: finalId,
			sourceId: this.id,
			title: title || finalId,
			cover: this.absUrl(String(cover)),
			type: this.mapType(detail.type),
			status: this.mapStatus(detail.status),
			description,
			authors,
			genres,
			chapters,
			latestChapter:
				detail.latestChapter != null
					? String(detail.latestChapter)
					: chapters.length
						? String(chapters[chapters.length - 1].number)
						: undefined
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		if (!path.includes('/title/')) {
			console.warn('[comix] invalid chapter id:', chapterId);
			return [];
		}

		try {
			const html = await this.pageFetch(
				path.endsWith('/') ? path : `${path}/`
			);
			const data = this.parseInitialData(html);
			const urls: string[] = [];
			const seen = new Set<string>();

			// Try find pages in initial-data
			const queries = data?.queries || {};
			for (const val of Object.values(queries) as any[]) {
				if (!val || typeof val !== 'object') continue;
				const pages = val.pages || val.result?.pages;
				if (!pages) continue;

				const base = String(pages.baseUrl || pages.base || '').replace(
					/\/$/,
					''
				);
				const items = pages.items || pages.images || [];
				if (Array.isArray(items)) {
					for (const img of items) {
						let u =
							typeof img === 'string'
								? img
								: img?.url || img?.src || img?.b || '';
						u = String(u).trim();
						if (!u) continue;
						if (u.startsWith('/') && base) u = `${base}${u}`;
						else if (!/^https?:/i.test(u) && base) u = `${base}/${u}`;
						const abs = this.absUrl(u);
						if (seen.has(abs)) continue;
						seen.add(abs);
						urls.push(abs);
					}
				}
			}

			if (urls.length === 0) {
				// Fallback: any large image URLs in HTML (usually cover only)
				const $ = cheerio.load(html);
				$('img').each((_, el) => {
					const src =
						$(el).attr('data-src') ||
						$(el).attr('src') ||
						'';
					if (
						!src ||
						src.includes('@280') ||
						!/static\.comix|cdn|uploads/i.test(src)
					)
						return;
					const abs = this.absUrl(src);
					if (seen.has(abs)) return;
					seen.add(abs);
					urls.push(abs);
				});
			}

			if (urls.length === 0) {
				console.warn(
					'[comix] no pages in SSR — signed API required for full chapter images:',
					path
				);
			} else {
				console.log(`[comix] ${urls.length} pages → ${path}`);
			}
			return urls;
		} catch (e) {
			console.error('[comix] getChapterPages failed', chapterId, e);
			return [];
		}
	}
}
