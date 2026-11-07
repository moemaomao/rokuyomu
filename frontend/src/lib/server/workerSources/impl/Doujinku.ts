/**
 * Doujinku (doujinku.org) – MangaThemesia / MangaReader (18+)
 * → extends ThemesiaSource
 *
 * List   : /manga/?order=update  |  /manga/?order=update&page={n}
 * Search : /?s=QUERY
 * Detail : /manga/{slug}/
 * Chapter: /{slug}-chapter-{n}/
 * Pages  : ts_reader.run / #readerarea
 *
 * Opsional: set cookie CF lewat env di BaseSource/fetch jika perlu.
 */

import { ThemesiaSource } from '../family/ThemesiaSource';

export class DoujinkuSource extends ThemesiaSource {
	id = 'doujinku';
	name = 'Doujinku';
	baseUrl = 'https://doujinku.org';

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
		return page <= 1 ? `/?s=${q}` : `/?s=${q}&page=${page}`;
	}

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, 'Doujinku')
			.replace(/\s*[-|]\s*Doujinku.*$/i, '')
			.trim();
	}
}
