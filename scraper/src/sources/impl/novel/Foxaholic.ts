/**
 * Foxaholic.com — Madara (WP Manga) novel
 * → extends MadaraNovelSource
 *
 * Domain   : https://www.foxaholic.com
 * Series   : /novel/{slug}/
 * Latest   : /novel/?m_orderby=latest + homepage
 * Search   : /?s={q}&post_type=wp-manga
 * Chapters : POST /novel/{slug}/ajax/chapters/
 */

import { MadaraNovelSource } from '../../family/MadaraNovelSource';

export class FoxaholicSource extends MadaraNovelSource {
	id = 'foxaholic';
	name = 'Foxaholic';
	baseUrl = 'https://www.foxaholic.com';

	protected seriesPath = '/novel';
	protected defaultLang = 'en';
	protected perPage = 24;
	protected useAjaxChapters = true;
	protected mergeHomeOnPage1 = true;

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, this.name)
			.replace(/\s*[-|]\s*Foxaholic.*$/i, '')
			.trim();
	}
}

export default FoxaholicSource;
