/**
 * ManhwaDesu (manhwadesu.wiki) — Themesia family
 *
 * FIXES (2026-10-14):
 * - listPath: path-style /komik/page/N/?order=update (site uses this)
 * - chapter list: filter PDF / safe.komik.one download links
 * - chapter number: handle glued "Chapter 116Oktober..." text
 * - getMangaDetails: chapter-root ID → /komik/{slug} for history/bookmarks
 * - stronger headers against soft blocks
 * - getChapterPages: ts_reader + DOM fallback (cdn.gilakomik.id)
 *
 * Paths:
 *   Latest  : /komik/?order=update  |  /komik/page/{n}/?order=update
 *   Search  : /?s=
 *   Detail  : /komik/{slug}/
 *   Chapter : /{slug}-chapter-{n}/   (root, NOT under /komik/)
 */

import * as cheerio from 'cheerio';
import { ThemesiaSource } from '../../family/ThemesiaSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';

export class ManhwaDesuSource extends ThemesiaSource {
	id = 'manhwadesu';
	name = 'ManhwaDesu';
	baseUrl = 'https://manhwadesu.wiki';

	protected seriesPath = '/komik';
	protected defaultLang = 'id';
	protected perPage = 24;
	private readonly SITE_PER_PAGE = 20;

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
		return `${this.seriesPath}/page/${p}/?order=update`;
	}

	protected searchPath(query: string, page: number): string {
		const params = new URLSearchParams({ s: query });
		if (page > 1) params.set('page', String(page));
		return `/?${params.toString()}`;
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

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, 'ManhwaDesu')
			.replace(/\s*[-|]\s*Manhwa\s*Desu.*$/i, '')
			.replace(/\s*[-|]\s*Manhwadesu.*$/i, '')
			.trim();
	}

	protected parseChapterList($: cheerio.CheerioAPI): Chapter[] {
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$(this.chapterListSelector).each((_, a) => {
			const $a = $(a);
			const href = ($a.attr('href') || '').trim();
			if (!href || href === '#' || href.includes('{{')) return;

			if (
				/safe\.komik\.one|pdf\.gilakomik|\/dl\/\?|download|drive\.google/i.test(
					href
				)
			) {
				return;
			}

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			if (!/-chapter-[\d.]+/i.test(id) && !/-ch-[\d.]+/i.test(id)) return;
			seen.add(id);

			const $li = $a.closest('li').length ? $a.closest('li') : $a.parent();
			const numText =
				$a.find('.epl-num, .chapternum').first().text().replace(/\s+/g, ' ').trim() ||
				$a.text().replace(/\s+/g, ' ').trim();
			const number = this.parseChapterNumber(numText || id, id);
			if (!number) return;

			const date =
				$a.find('.epl-date, .chapterdate, .chapter-date').first().text().replace(/\s+/g, ' ').trim() ||
				$li
					.find('.epl-date, .chapterdate, .chapter-date, .dt, .chapter-release-date, time')
					.first()
					.text()
					.replace(/\s+/g, ' ')
					.trim() ||
				undefined;

			const isLocked = this.isChapterLocked($a, $li);

			chapters.push({
				id,
				title: `Chapter ${number}`,
				number,
				date: date || undefined,
				...(isLocked ? { isLocked: true } : {})
			});
		});

		return chapters;
	}

	private async fetchCatalogPages(
		buildPath: (sitePage: number) => string,
		appPage: number
	): Promise<Manga[]> {
		const p = Math.max(1, Number(appPage) || 1);
		const start = (p - 1) * this.perPage;
		const siteStart = Math.floor(start / this.SITE_PER_PAGE) + 1;
		const offsetInFirst = start % this.SITE_PER_PAGE;
		const merged: Manga[] = [];
		const seen = new Set<string>();

		for (
			let sp = siteStart;
			sp <= siteStart + 3 && merged.length < offsetInFirst + this.perPage;
			sp++
		) {
			try {
				const html = await this.fetchHtml(buildPath(sp));
				if (!html || html.length < 800) break;
				const list = this.parseCards(cheerio.load(html));
				for (const m of list) {
					if (seen.has(m.id)) continue;
					seen.add(m.id);
					merged.push({ ...m, lang: this.defaultLang });
				}
				if (list.length === 0) break;
			} catch (e) {
				console.error('[manhwadesu] catalog page', sp, e);
				break;
			}
		}
		return merged.slice(offsetInFirst, offsetInFirst + this.perPage);
	}

	async getLatestManga(page: number): Promise<Manga[]> {
		try {
			return await this.fetchCatalogPages(
				(sitePage) => this.listPath(sitePage),
				page
			);
		} catch (e) {
			console.error('[manhwadesu] getLatestManga', e);
			return [];
		}
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page || 1);
		if (!q) return this.getLatestManga(page);
		try {
			return await this.fetchCatalogPages(
				(sitePage) => this.searchPath(q, sitePage),
				page
			);
		} catch (e) {
			console.error('[manhwadesu] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);

		if (/-chapter-[\d.]+/i.test(path) && !path.startsWith('/komik/')) {
			const slug = path
				.replace(/^\//, '')
				.replace(/-chapter-[\d.]+.*$/i, '')
				.replace(/\/$/, '');
			path = `/komik/${slug}`;
		}
		if (!path.startsWith('/komik/')) {
			path = `/komik/${path.replace(/^\//, '')}`;
		}

		const details = await super.getMangaDetails(path);

		const chapters = (details.chapters || []).filter(
			(c) =>
				c?.id &&
				!/safe\.komik\.one|pdf\.gilakomik|\/dl\//i.test(c.id) &&
				/-chapter-[\d.]+/i.test(c.id)
		);

		return {
			...details,
			lang: this.defaultLang,
			chapters: chapters.length ? chapters : details.chapters
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		const pages = await super.getChapterPages(path);
		if (pages.length) return pages;

		try {
			const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
			const $ = cheerio.load(html);
			const out: string[] = [];
			const seen = new Set<string>();
			$('#readerarea img, .readerarea img, .rdminimal img, .entry-content img').each(
				(_, img) => {
					const $img = $(img);
					let src =
						$img.attr('data-src') ||
						$img.attr('data-lazy-src') ||
						$img.attr('src') ||
						'';
					if (!src || src.startsWith('data:')) return;
					src = this.absUrl(src.split(/\s+/)[0]);
					if (!src || seen.has(src)) return;
					if (/logo|icon|avatar|emoji|spinner|histats|yandex/i.test(src)) return;
					seen.add(src);
					out.push(src);
				}
			);
			return out;
		} catch (e) {
			console.error('[manhwadesu] getChapterPages fallback', path, e);
			return [];
		}
	}
}
