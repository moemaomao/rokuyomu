/**
 * Rokari Comics adapter (rokaricomics.com)
 * → extends ThemesiaSource
 *
 * Theme     : WordPress MangaNova / Themesia
 * Latest    : /manga/?order=update  |  /manga/?page=N&order=update
 * Search    : /?s={q}
 * Detail    : /manga/{slug}/
 * Chapter   : /{slug}-chapter-{n}/
 * Pages     : #readerarea img
 *
 * Bahasa default: English
 */

import { ThemesiaSource } from '../../family/ThemesiaSource';

export class RokariComicsSource extends ThemesiaSource {
	id = 'rokaricomics';
	name = 'Rokari Comics';
	baseUrl = 'https://rokaricomics.com';

	protected seriesPath = '/manga';
	protected defaultLang = 'en';
	protected perPage = 24;

	protected listPath(page: number): string {
		const p = Math.max(1, page || 1);
		if (p <= 1) return `${this.seriesPath}/?order=update`;
		return `${this.seriesPath}/?page=${p}&order=update`;
	}

	protected searchPath(query: string, page: number): string {
		const q = encodeURIComponent(query);
		return page <= 1 ? `/?s=${q}` : `/page/${page}/?s=${q}`;
	}

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, 'Rokari Comics')
			.replace(/\s*[-|]\s*Rokari\s*Comics.*$/i, '')
			.trim();
	}
}
