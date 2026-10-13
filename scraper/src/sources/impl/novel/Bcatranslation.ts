/**
 * Bcatranslation / Bcat00 Novel — Madara / wp-manga (novel)
 * → extends MadaraNovelSource
 *
 * Domain   : https://bcatranslation.com
 * Series   : /novel/{slug}/
 * Latest   : /novel/?m_orderby=latest + homepage merge
 * Search   : /?s={q}&post_type=wp-manga
 * Chapters : POST /novel/{slug}/ajax/chapters/
 * Content  : .reading-content .text-left
 */

import { MadaraNovelSource } from '../../family/MadaraNovelSource';

export class BcatranslationSource extends MadaraNovelSource {
	id = 'bcatranslation';
	name = 'Bcatranslation';
	baseUrl = 'https://bcatranslation.com';

	protected seriesPath = '/novel';
	protected defaultLang = 'en';
	protected perPage = 24;
	protected useAjaxChapters = true;
	protected mergeHomeOnPage1 = true;

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, this.name)
			.replace(/\s*[-|]\s*Bcat(?:ranslation|00).*$/i, '')
			.trim();
	}
}

export default BcatranslationSource;
