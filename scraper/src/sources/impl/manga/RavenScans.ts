/**
 * Raven Scans adapter (https://ravenscans.org)
 * Theme: WordPress Themesia / mangareader → extends ThemesiaSource
 *
 * Latest  : /manga/?page=N&order=update
 * Search  : /?s={query}&page=N
 * Detail  : /manga/{slug}/
 * Chapter : /{slug}-chapter-{n}/
 * Pages   : #readerarea / ts_reader
 *
 * ID format:
 *   manga   : /manga/{slug}
 *   chapter : /{slug}-chapter-{n}
 */

import { ThemesiaSource } from '../../family/ThemesiaSource';

export class RavenScansSource extends ThemesiaSource {
	id = 'ravenscans';
	name = 'Raven Scans';
	baseUrl = 'https://ravenscans.org';

	protected seriesPath = '/manga';
	protected defaultLang = 'en';
	protected perPage = 35;

	protected listPath(page: number): string {
		const p = Math.max(1, page || 1);
		return `${this.seriesPath}/?page=${p}&order=update`;
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
			.normalizeTitle(raw, 'Raven Scans')
			.replace(/\s*[-|]\s*Raven\s*Scans.*$/i, '')
			.trim();
	}
}
