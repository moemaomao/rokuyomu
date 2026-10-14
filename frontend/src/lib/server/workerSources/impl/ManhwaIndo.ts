/**
 * ManhwaIndo adapter (www.manhwaindo.my)
 *
 * Site redesigned away from classic Themesia cards.
 * - List   : /series/?order=update  (cards = a.series)
 * - Search : /?s=  |  /page/N/?s=
 * - Detail : /series/{slug}/
 * - Chapters API : /wp-json/agc/v1/chapters?series={postId}
 * - Chapter pages: /{slug}-chapter-{n}/  (img @ imgx-id.gmbr.pro)
 *
 * This file is for: scraper/src/sources/impl/manga/ManhwaIndo.ts
 */

import * as cheerio from 'cheerio';
import { ThemesiaSource } from '../family/ThemesiaSource';
import type { Chapter, Manga, MangaDetails } from '../types-manga';

type AgcChapter = {
	id?: number | string;
	url?: string;
	chapter?: string | number;
	time?: string;
};

export class ManhwaIndoSource extends ThemesiaSource {
	id = 'manhwaindo';
	name = 'ManhwaIndo';
	baseUrl = 'https://www.manhwaindo.my';

	protected seriesPath = '/series';
	protected defaultLang = 'id';
	protected perPage = 24;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept:
			'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
		'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
		'Cache-Control': 'no-cache',
		Pragma: 'no-cache',
		'Upgrade-Insecure-Requests': '1',
		'Sec-Fetch-Dest': 'document',
		'Sec-Fetch-Mode': 'navigate',
		'Sec-Fetch-Site': 'none',
		'Sec-Fetch-User': '?1'
	};

	protected listPath(page: number): string {
		const p = Math.max(1, page || 1);
		if (p <= 1) return `${this.seriesPath}/?order=update`;
		return `${this.seriesPath}/?order=update&page=${p}`;
	}

	protected searchPath(query: string, page: number): string {
		const q = encodeURIComponent(query);
		return page <= 1 ? `/?s=${q}` : `/page/${page}/?s=${q}`;
	}

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, 'ManhwaIndo')
			.replace(/\s*[-|]\s*Manhwa\s*Indo.*$/i, '')
			.replace(/&#8217;/g, "'")
			.replace(/&amp;/g, '&')
			.replace(/&quot;/g, '"')
			.trim();
	}

	protected parseChapterNumber(text: string, path = ''): number {
		const fromPath =
			path.match(/(?:ch|chapter)[_-]?(\d+)(?:[.-](\d+))?/i) ||
			path.match(/-(\d+)(?:[.-](\d+))?(?:-end)?\/?$/i);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null && fromPath[2].length <= 2) {
				return parseFloat(`${major}.${fromPath[2]}`);
			}
			return major;
		}
		const glued = String(text || '').match(
			/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)(?=[A-Za-z]|$)/i
		);
		if (glued) return parseFloat(glued[1]);
		return super.parseChapterNumber(text, path);
	}

	protected parseCards($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		$('a.series[href*="/series/"]').each((_, a) => {
			const $a = $(a);
			const href = ($a.attr('href') || '').split('?')[0].trim();
			if (!href) return;

			const id = this.cleanId(href);
			if (!/^\/series\/[^/]+$/i.test(id) || seen.has(id)) return;
			if (/\/series\/(page|list-mode|feed)/i.test(id)) return;
			seen.add(id);

			const title = this.normalizeTitle(
				$a.attr('title') ||
					$a.find('img').attr('alt') ||
					$a.find('img').attr('title') ||
					$a.text() ||
					''
			);
			if (!title) return;

			const $img = $a.find('img').first();
			let cover =
				$img.attr('data-src') ||
				$img.attr('data-lazy-src') ||
				$img.attr('src') ||
				'';
			if (cover.startsWith('data:')) cover = '';
			cover = this.preferFullCover(this.absUrl(cover));

			let latestChapter: string | undefined;
			const $card = $a.closest('div.flex') || $a.parent().parent();
			const badge =
				$card
					.find('[class*="bg-indigo"]')
					.first()
					.text()
					.replace(/\s+/g, ' ')
					.trim() ||
				$a
					.find('.absolute')
					.text()
					.replace(/\s+/g, ' ')
					.trim();
			if (badge) {
				const n = this.parseChapterNumber(badge);
				if (n > 0) latestChapter = String(n);
			}

			res.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type: this.mapType(($card.text() || title) as string),
				status: 'Ongoing',
				latestChapter,
				lang: this.defaultLang
			});
		});

		return res;
	}

	async getLatestManga(page: number): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const siteStart = (p - 1) * 2 + 1;
			const seen = new Set<string>();
			const merged: Manga[] = [];

			for (const sp of [siteStart, siteStart + 1]) {
				if (merged.length >= this.perPage) break;
				try {
					const batch = this.parseCards(
						cheerio.load(await this.fetchHtml(this.listPath(sp)))
					);
					for (const m of batch) {
						if (seen.has(m.id)) continue;
						seen.add(m.id);
						merged.push(m);
					}
					if (batch.length === 0) break;
				} catch (e) {
					console.error('[manhwaindo] catalog page', sp, e);
					break;
				}
			}

			console.log(`[manhwaindo] latest page=${p} → ${merged.length}`);
			return merged.slice(0, this.perPage);
		} catch (e) {
			console.error('[manhwaindo] getLatestManga', e);
			return [];
		}
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page || 1);
		if (!q) return this.getLatestManga(page);
		try {
			const html = await this.fetchHtml(this.searchPath(q, page));
			const list = this.parseCards(cheerio.load(html));
			console.log(`[manhwaindo] search "${q}" page=${page} → ${list.length}`);
			return list.slice(0, this.perPage);
		} catch (e) {
			console.error('[manhwaindo] searchManga', e);
			return [];
		}
	}

	protected extractSeriesId($: cheerio.CheerioAPI, html: string): string | null {
		const fromAlpine =
			html.match(/seriesId\s*:\s*(\d+)/i) ||
			html.match(/series_id["']?\s*[:=]\s*["']?(\d+)/i) ||
			html.match(/["']series["']\s*:\s*(\d+)/i);
		if (fromAlpine?.[1]) return fromAlpine[1];

		const fromBody =
			$('body').attr('class')?.match(/postid-(\d+)/i) ||
			$('article').attr('id')?.match(/post-(\d+)/i) ||
			$('[data-series-id], [data-id]').first().attr('data-series-id') ||
			$('[data-series-id], [data-id]').first().attr('data-id');
		if (typeof fromBody === 'string' && /^\d+$/.test(fromBody)) return fromBody;
		if (Array.isArray(fromBody) && fromBody[1]) return fromBody[1];

		const shortlink = $('link[rel="shortlink"]').attr('href') || '';
		const p = shortlink.match(/[?&]p=(\d+)/);
		if (p?.[1]) return p[1];

		return null;
	}

	protected async fetchAgcChapters(seriesId: string): Promise<Chapter[]> {
		const url = `${this.baseUrl}/wp-json/agc/v1/chapters?series=${encodeURIComponent(seriesId)}`;
		try {
			const raw = await this.fetchHtml(url);
			const data = JSON.parse(raw) as AgcChapter[] | { code?: string };
			if (!Array.isArray(data)) return [];

			const chapters: Chapter[] = [];
			const seen = new Set<string>();

			for (const row of data) {
				const href = String(row.url || '').trim();
				if (!href) continue;
				const id = this.cleanId(href);
				if (!id || seen.has(id)) continue;
				seen.add(id);

				const number = this.parseChapterNumber(
					String(row.chapter ?? ''),
					id
				);
				if (!number) continue;

				chapters.push({
					id,
					title: `Chapter ${number}`,
					number,
					date: row.time ? String(row.time) : undefined
				});
			}

			return chapters;
		} catch (e) {
			console.error('[manhwaindo] fetchAgcChapters', seriesId, e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);

		if (/-chapter-[\d.]+/i.test(path) && !path.startsWith('/series/')) {
			const slug = path
				.replace(/^\//, '')
				.replace(/-chapter-[\d.]+.*$/i, '')
				.replace(/\/$/, '');
			path = `/series/${slug}`;
		}
		if (!path.startsWith('/series/')) {
			path = `/series/${path.replace(/^\//, '')}`;
		}

		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const title = this.normalizeTitle(
			$('h1').first().text() ||
				$('meta[property="og:title"]').attr('content') ||
				''
		);

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('img[src*="manga-images"]').first().attr('src') ||
			$('img').first().attr('src') ||
			'';
		if (cover.startsWith('data:')) cover = '';
		cover = this.preferFullCover(this.absUrl(cover));

		const description = (
			$('meta[property="og:description"]').attr('content') ||
			$('[class*="synopsis"], [class*="sinopsis"], .entry-content')
				.first()
				.text() ||
			''
		)
			.replace(/\s+/g, ' ')
			.trim();

		const genres: string[] = [];
		$('a[href*="/genres/"], a[href*="/genre/"], a[rel="tag"]').each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		const seriesId = this.extractSeriesId($, html);
		let chapters: Chapter[] = [];
		if (seriesId) {
			chapters = await this.fetchAgcChapters(seriesId);
		}

		if (!chapters.length) {
			const seen = new Set<string>();
			$('a[href*="-chapter-"]').each((_, a) => {
				const href = ($(a).attr('href') || '').trim();
				if (!href || /javascript:|#/.test(href)) return;
				const id = this.cleanId(href);
				if (!/-chapter-[\d.]+/i.test(id) || seen.has(id)) return;
				seen.add(id);
				const number = this.parseChapterNumber($(a).text() || id, id);
				if (!number) return;
				chapters.push({
					id,
					title: `Chapter ${number}`,
					number
				});
			});
		}

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		return {
			id: path.replace(/\/+$/, '') || path,
			title: title || path.split('/').filter(Boolean).pop() || 'Unknown',
			cover,
			description,
			genres,
			authors: [],
			status: 'Ongoing',
			type: 'manhwa',
			chapters,
			sourceId: this.id,
			lang: this.defaultLang
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);
		const out: string[] = [];
		const seen = new Set<string>();

		const push = (raw: string) => {
			let src = (raw || '').trim().split(/\s+/)[0];
			if (!src || src.startsWith('data:')) return;
			if (src.startsWith('//')) src = `https:${src}`;
			if (src.startsWith('http://')) src = src.replace(/^http:\/\//i, 'https://');
			src = this.absUrl(src);
			if (!src || seen.has(src)) return;
			if (/logo|icon|avatar|emoji|spinner|histats|yandex|banner|iklan|ads?|gif$/i.test(src))
				return;
			if (
				!/imgx|gmbr\.pro|manga-images|uploads\/manga|chapter-\d+/i.test(src) &&
				out.length > 0
			) {
				return;
			}
			seen.add(src);
			out.push(src);
		};

		$('img').each((_, img) => {
			const $img = $(img);
			const alt = ($img.attr('alt') || '').toLowerCase();
			const src =
				$img.attr('data-src') ||
				$img.attr('data-lazy-src') ||
				$img.attr('src') ||
				'';
			if (/chapter\s*\d+/i.test(alt) || /manga-images|chapter-\d+/i.test(src)) {
				push(src);
			}
		});

		if (out.length) return out;

		$('img').each((_, img) => {
			const $img = $(img);
			const src =
				$img.attr('data-src') ||
				$img.attr('data-lazy-src') ||
				$img.attr('src') ||
				'';
			if (/imgx|gmbr\.pro\/uploads\/manga/i.test(src)) push(src);
		});

		if (out.length) return out;

		try {
			const parentPages = await super.getChapterPages(path);
			if (parentPages.length) return parentPages;
		} catch {
			/* ignore */
		}

		return out;
	}
}
