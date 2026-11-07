/**
 * ManhuaRMTL adapter (manhuarmtl.com)
 * Theme: Madara (custom child – mrm-r-item grid) → extends MadaraSource
 *
 * Latest   : /manga/?m_orderby=modified  |  /manga/page/{n}/?m_orderby=modified
 * Search   : /?s={q}&post_type=wp-manga
 * Detail   : /manga/{slug}/
 * Chapter  : /manga/{slug}/chapter-{num}/
 * Pages    : .reading-content img / .page-break img
 */

import { MadaraSource } from '../family/MadaraSource';

export class ManhuarmtlSource extends MadaraSource {
	id = 'manhuarmtl';
	name = 'ManhuaRMTL';
	baseUrl = 'https://manhuarmtl.com';

	protected seriesPath = '/manga';
	protected defaultLang = 'en';
	protected perPage = 24;
	protected listOrderby = 'modified';
	protected useAjaxChapters = true;

	protected cardSelector =
		'li.mrm-r-item, .mrm-r-item, .page-item-detail, .c-tabs-item__content, .manga';

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, this.name)
			.replace(/\s*[-|]\s*ManhuaRMTL.*$/i, '')
			.trim();
	}
}

export default ManhuarmtlSource;
