/**
 * Athrea Scans adapter (WordPress Themesia / mangareader)
 * → extends ThemesiaSource
 *
 * Domain  : https://athreascans.com
 * Latest  : /manga/?page=N&order=update
 * Search  : /?s={query}&page=N
 * Detail  : /manga/{slug}/
 * Chapter : /{slug}-chapter-{n}/
 * Pages   : #readerarea / ts_reader
 *
 * ID format:
 *   manga   : /manga/{slug}
 *   chapter : /{slug}-chapter-{n}
 *
 * Paid chapters (coins) may return empty pages.
 */

import { ThemesiaSource } from '../family/ThemesiaSource';

export class AthreaScansSource extends ThemesiaSource {
	id = 'athreascans';
	name = 'Athrea Scans';
	baseUrl = 'https://athreascans.com';

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
			.normalizeTitle(raw, 'Athrea Scans')
			.replace(/\s*[-|]\s*Athrea\s*Scans.*$/i, '')
			.trim();
	}
}
