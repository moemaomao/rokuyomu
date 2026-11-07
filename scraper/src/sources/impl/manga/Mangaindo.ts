/**
 * mangaindo.best adapter (MangaThemesia)
 * → extends ThemesiaSource
 *
 * List   : /manga/?order=update&page=N  (bukan /home/page/N — isinya sama terus)
 * Search : /?s=QUERY
 * Detail : /manga/{slug}/
 * Chapter: /{slug}-chapter-{n}/
 * Pages  : ts_reader / #readerarea
 *
 * Site ~12–20/page → merge 2 site-pages per app page.
 */

import * as cheerio from 'cheerio';
import { ThemesiaSource } from '../../family/ThemesiaSource';
import type { Manga } from '../../types-manga';

export class MangaindoSource extends ThemesiaSource {
	id = 'mangaindo';
	name = 'Mangaindo';
	baseUrl = 'https://mangaindo.best';

	protected seriesPath = '/manga';
	protected defaultLang = 'id';
	protected perPage = 24;

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
			.normalizeTitle(raw, 'Mangaindo')
			.replace(/\s*[-|]\s*Manga\s*Indo.*$/i, '')
			.trim();
	}

	async getLatestManga(page: number): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const siteStart = (p - 1) * 2 + 1;
			const pagesToFetch = [siteStart, siteStart + 1];

			const seen = new Set<string>();
			const mangas: Manga[] = [];

			for (const pg of pagesToFetch) {
				const path = this.listPath(pg);
				try {
					const batch = this.parseCards(cheerio.load(await this.fetchHtml(path)));
					for (const item of batch) {
						if (seen.has(item.id)) continue;
						seen.add(item.id);
						mangas.push(item);
					}
				} catch (e) {
					console.error(`[mangaindo] fetch page ${pg}`, e);
				}
			}

			console.log(`[mangaindo] latest page=${p} → ${mangas.length}`);
			return mangas.slice(0, this.perPage);
		} catch (e) {
			console.error('[mangaindo] getLatestManga', e);
			return [];
		}
	}
}
