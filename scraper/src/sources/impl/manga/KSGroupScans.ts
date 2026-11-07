/**
 * KS Group Scans adapter (https://ksgroupscans.com)
 * Theme: WordPress Madara (MangaBooth) → extends MadaraSource
 *
 * Latest   : /manga/?m_orderby=latest  |  /manga/page/{n}/?m_orderby=latest
 * Search   : /?s={q}&post_type=wp-manga
 * Detail   : /manga/{slug}/
 * Chapters : POST /manga/{slug}/ajax/chapters/
 * Pages    : .reading-content img / .wp-manga-chapter-img
 */

import { MadaraSource } from '../../family/MadaraSource';

export class KSGroupScansSource extends MadaraSource {
	id = 'ksgroupscans';
	name = 'KS Group Scans';
	baseUrl = 'https://ksgroupscans.com';

	protected seriesPath = '/manga';
	protected defaultLang = 'en';
	protected perPage = 24;
	protected sitePerPage = 12;
	protected useAjaxChapters = true;

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, this.name)
			.replace(/\s*[-|–]\s*KS\s*(Group\s*)?Scans.*$/i, '')
			.trim();
	}
}

export default KSGroupScansSource;
