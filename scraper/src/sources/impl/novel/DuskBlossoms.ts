/**
 * DuskBlossoms.com — Madara theme (novel)
 * → extends MadaraNovelSource
 *
 * Domain   : https://duskblossoms.com
 * Series   : /novel/{slug}/
 * Latest   : / + /novel/?m_orderby=latest
 * Search   : /?s={q}&post_type=wp-manga
 * Chapters : POST /novel/{slug}/ajax/chapters/?t=1
 */

import { MadaraNovelSource } from '../../family/MadaraNovelSource';

export class DuskBlossomsSource extends MadaraNovelSource {
	id = 'duskblossoms';
	name = 'Dusk Blossoms';
	baseUrl = 'https://duskblossoms.com';

	protected seriesPath = '/novel';
	protected defaultLang = 'en';
	protected perPage = 24;
	protected useAjaxChapters = true;
	protected mergeHomeOnPage1 = true;

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, this.name)
			.replace(/\s*[-|]\s*Dusk\s*Blossoms.*$/i, '')
			.trim();
	}
}

export default DuskBlossomsSource;
