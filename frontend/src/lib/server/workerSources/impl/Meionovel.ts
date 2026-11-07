/**
 * Meionovels.com (MeioNovel) — Madara theme (novel)
 * → extends MadaraNovelSource
 *
 * Domain   : https://meionovels.com
 * Series   : /novel/{slug}/
 * Latest   : /novel/ + homepage merge
 * Search   : /?s={q}&post_type=wp-manga
 * Chapters : POST /novel/{slug}/ajax/chapters/?t=1
 * Lang     : id
 */

import { MadaraNovelSource } from '../family/MadaraNovelSource';

export class MeionovelSource extends MadaraNovelSource {
	id = 'meionovel';
	name = 'MeioNovel';
	baseUrl = 'https://meionovels.com';

	protected seriesPath = '/novel';
	protected defaultLang = 'id';
	protected perPage = 24;
	protected useAjaxChapters = true;
	protected mergeHomeOnPage1 = true;

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, this.name)
			.replace(/\s*[-|]\s*Meio\s*Novel.*$/i, '')
			.replace(/\s*[-|]\s*Meionovel.*$/i, '')
			.trim();
	}
}

export default MeionovelSource;
