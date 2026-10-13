/**
 * MangaSushi.org adapter (WordPress Madara / WP-Manga)
 * → extends MadaraSource
 *
 * Domain   : https://mangasushi.org
 * Latest   : /manga/?m_orderby=latest  |  /manga/page/{n}/?m_orderby=latest
 * Search   : /?s={q}&post_type=wp-manga
 * Detail   : /manga/{slug}/
 * Pages    : img.wp-manga-chapter-img
 */

import { MadaraSource } from '../../family/MadaraSource';

export class MangaSushiSource extends MadaraSource {
	id = 'mangasushi';
	name = 'MangaSushi';
	baseUrl = 'https://mangasushi.org';

	protected seriesPath = '/manga';
	protected defaultLang = 'en';
	protected perPage = 24;
	protected useAjaxChapters = true;

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, this.name)
			.replace(/\s*[-|]\s*MangaSushi.*$/i, '')
			.trim();
	}
}

export default MangaSushiSource;
