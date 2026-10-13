/**
 * Dojing (dojing.net) adapter – MangaReader theme (18+)
 * → extends ThemesiaSource
 *
 * List   : /manga/?order=update  |  /manga/page/{n}/?order=update
 * Search : /?s=QUERY
 * Detail : /manga/{slug}/
 * Chapter: /{slug}-chapter-{n}/
 * Pages  : ts_reader.run / #readerarea
 *
 * Bahasa: Indonesian | NSFW
 */

import { ThemesiaSource } from '../../family/ThemesiaSource';

export class DojingSource extends ThemesiaSource {
	id = 'dojing';
	name = 'Dojing';
	baseUrl = 'https://dojing.net';

	protected seriesPath = '/manga';
	protected defaultLang = 'id';
	protected perPage = 24;

	protected listPath(page: number): string {
		const p = Math.max(1, page || 1);
		if (p <= 1) return `${this.seriesPath}/?order=update`;
		return `${this.seriesPath}/page/${p}/?order=update`;
	}

	protected searchPath(query: string, page: number): string {
		const q = encodeURIComponent(query);
		return page <= 1 ? `/?s=${q}` : `/page/${page}/?s=${q}`;
	}

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, 'Dojing')
			.replace(/\s*[-–|].*Dojing.*$/i, '')
			.replace(/\s*All Chapter.*$/i, '')
			.trim();
	}
}
