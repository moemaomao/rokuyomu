/**
 * NoiceTranslations.com — Madara theme (novel / fan TL)
 * → extends MadaraNovelSource
 *
 * Domain   : https://noicetranslations.com
 * Series   : /manga/{slug}/   (bukan /novel/)
 * Latest   : homepage + /manga/?m_orderby=latest
 * Search   : /?s={q}&post_type=wp-manga
 * Chapters : POST /manga/{slug}/ajax/chapters/?t=1
 * Lock     : free-chap / premium coin-N (handled by MadaraSource)
 */

import { MadaraNovelSource } from '../../family/MadaraNovelSource';

export class NoiceTranslationsSource extends MadaraNovelSource {
	id = 'noicetranslations';
	name = 'Noice Translations';
	baseUrl = 'https://noicetranslations.com';

	protected seriesPath = '/manga';
	protected defaultLang = 'en';
	protected perPage = 24;
	protected useAjaxChapters = true;
	protected mergeHomeOnPage1 = true;

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, this.name)
			.replace(/\s*[-|]\s*Noice\s*Translations?.*$/i, '')
			.trim();
	}
}

export default NoiceTranslationsSource;
