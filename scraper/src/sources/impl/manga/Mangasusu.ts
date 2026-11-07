/**
 * Mangasusu adapter (mangasusuku.com)
 * → extends ThemesiaSource
 *
 * Theme: Themesia / WordPress manga
 * Latest   : /komik/?order=update&page={n}   (bukan /komik/page/n/)
 * Search   : /?s=&page={n}
 * Detail   : /komik/{slug}/
 * Chapter  : /{slug}-chapter-{num}/
 * Pages    : #readerarea img
 *
 * Bahasa default: Indonesian
 */

import { ThemesiaSource } from '../../family/ThemesiaSource';

export class MangasusuSource extends ThemesiaSource {
	id = 'mangasusu';
	name = 'Mangasusu';
	baseUrl = 'https://mangasusuku.com';

	protected seriesPath = '/komik';
	protected defaultLang = 'id';
	protected perPage = 24;

	protected listPath(page: number): string {
		const p = Math.max(1, page || 1);
		return `${this.seriesPath}/?order=update&page=${p}`;
	}

	protected searchPath(query: string, page: number): string {
		const q = encodeURIComponent(query);
		return page <= 1 ? `/?s=${q}` : `/?s=${q}&page=${page}`;
	}

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, 'Mangasusu')
			.replace(/\s*[-|]\s*Mangasusu.*$/i, '')
			.trim();
	}
}
