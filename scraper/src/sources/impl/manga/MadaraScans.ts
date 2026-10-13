/**
 * MadaraScans adapter (https://madarascans.org)
 * → extends ThemesiaSource
 *
 * Theme: Themesia / WordPress mangareader (bukan Madara)
 * Series list  : /series/?order=update  |  /series/?order=update&page={n}
 * Search       : /?s={q}
 * Detail       : /series/{slug}/
 * Chapter      : /{slug}-chapter-{n}/
 * Pages        : ts_reader.run / #readerarea
 *
 * Bahasa default: English
 */

import { ThemesiaSource } from '../../family/ThemesiaSource';

export class MadaraScansSource extends ThemesiaSource {
	id = 'madarascans';
	name = 'MadaraScans';
	baseUrl = 'https://madarascans.org';

	protected seriesPath = '/series';
	protected defaultLang = 'en';
	protected perPage = 24;

	protected listPath(page: number): string {
		const p = Math.max(1, page || 1);
		if (p <= 1) return `${this.seriesPath}/?order=update`;
		return `${this.seriesPath}/?order=update&page=${p}`;
	}

	protected searchPath(query: string, page: number): string {
		const q = encodeURIComponent(query);
		return page <= 1 ? `/?s=${q}` : `/?s=${q}&page=${page}`;
	}

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, 'MadaraScans')
			.replace(/\s*[-|]\s*Madara\s*Scans.*$/i, '')
			.trim();
	}
}
