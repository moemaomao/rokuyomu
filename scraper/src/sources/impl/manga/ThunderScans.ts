/**
 * ThunderScans adapter (en-thunderscans.com)
 * → extends ThemesiaSource
 *
 * Theme: Themesia / mangareader
 * Latest  : /manga/?order=update  |  /manga/?page={n}&order=update
 * Search  : /?s=
 * Detail  : /manga/{slug}/
 * Chapter : /{slug}-chapter-{n}/
 * Pages   : ts_reader / #readerarea
 *
 * Bahasa default: English
 */

import { ThemesiaSource } from '../../family/ThemesiaSource';

export class ThunderScansSource extends ThemesiaSource {
	id = 'thunderscans';
	name = 'ThunderScans';
	baseUrl = 'https://en-thunderscans.com';

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
		return page <= 1 ? `/?s=${q}` : `/?s=${q}&page=${page}`;
	}

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, 'ThunderScans')
			.replace(/\s*[-|]\s*Thunder\s*Scans.*$/i, '')
			.trim();
	}
}
