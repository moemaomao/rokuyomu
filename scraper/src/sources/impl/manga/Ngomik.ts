/**
 * Ngomik ID adapter (02.ngomik.cc)
 * Theme: Themesia MangaReader → extends ThemesiaSource
 *
 * Latest  : /manga/?order=update&page={n}
 * Search  : /?s={query}&page={n}
 * Detail  : /manga/{slug}/
 * Chapter : /{slug}-chapter-{n}/
 * Pages   : ts_reader.run / #readerarea img
 *
 * ID format:
 *   manga   : /manga/{slug}
 *   chapter : /{slug}-chapter-{n}
 */

import { ThemesiaSource } from '../../family/ThemesiaSource';

export class NgomikSource extends ThemesiaSource {
	id = 'ngomik';
	name = 'Ngomik';
	baseUrl = 'https://02.ngomik.cc';

	protected seriesPath = '/manga';
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

	protected parseChapterNumber(text: string, path = ''): number {
		const fromPath =
			path.match(/(?:ch|chapter)[_-]?(\d+)(?:[.-](\d+))?/i) ||
			path.match(/-(\d+)(?:[.-](\d+))?\/?$/i);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null && fromPath[2].length <= 2) {
				return parseFloat(`${major}.${fromPath[2]}`);
			}
			return major;
		}
		return super.parseChapterNumber(text, path);
	}

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, 'Ngomik')
			.replace(/\s*[-|]\s*Ngomik.*$/i, '')
			.trim();
	}
}
