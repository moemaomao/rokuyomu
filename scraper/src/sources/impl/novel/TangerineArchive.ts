/**
 * Tangerine Archive — Madara / wp-manga (novel)
 * → extends MadaraNovelSource
 *
 * Domain   : https://tangerinearchive.com
 * Series   : /series/{slug}/
 * Latest   : /series/?m_orderby=latest + homepage
 * Search   : /?s={q}&post_type=wp-manga
 * Chapters : POST /series/{slug}/ajax/chapters/
 */

import { MadaraNovelSource } from '../../family/MadaraNovelSource';

export class TangerineArchiveSource extends MadaraNovelSource {
	id = 'tangerinearchive';
	name = 'Tangerine Archive';
	baseUrl = 'https://tangerinearchive.com';

	protected seriesPath = '/series';
	protected defaultLang = 'en';
	protected perPage = 24;
	protected useAjaxChapters = true;
	protected mergeHomeOnPage1 = true;

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, this.name)
			.replace(/\s*[-|]\s*Tangerine\s*Archive.*$/i, '')
			.trim();
	}
}

export default TangerineArchiveSource;
