/**
 * Cucumber Manga adapter (WordPress Madara / wp-manga)
 * → extends MadaraSource
 *
 * Domain  : https://cucumbermanga.com
 * Latest  : /?s=&post_type=wp-manga&m_orderby=latest&paged=N  (bukan /manga/?m_orderby)
 * Search  : /?s={q}&post_type=wp-manga
 * Detail  : /manga/{slug}/
 * Chapters: POST /manga/{slug}/ajax/chapters/
 * Pages   : .page-break img / .reading-content img
 */

import { MadaraSource } from '../../family/MadaraSource';

export class CucumberMangaSource extends MadaraSource {
	id = 'cucumbermanga';
	name = 'Cucumber Manga';
	baseUrl = 'https://cucumbermanga.com';

	protected seriesPath = '/manga';
	protected defaultLang = 'en';
	protected perPage = 24;
	protected useAjaxChapters = true;
	protected listPath(page: number): string {
		const p = Math.max(1, page || 1);
		if (p <= 1) return `/?s=&post_type=wp-manga&m_orderby=latest`;
		return `/?s=&post_type=wp-manga&m_orderby=latest&paged=${p}`;
	}

	protected searchPath(query: string, page: number): string {
		const q = encodeURIComponent(query);
		if (page <= 1) return `/?s=${q}&post_type=wp-manga`;
		return `/?s=${q}&post_type=wp-manga&paged=${page}`;
	}

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, this.name)
			.replace(/\s*[-|]\s*Cucumber\s*Manga.*$/i, '')
			.trim();
	}
}

export default CucumberMangaSource;
