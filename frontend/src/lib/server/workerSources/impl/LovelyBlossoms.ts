/**
 * LovelyBlossoms.com — Madara theme (novel)
 * → extends MadaraNovelSource
 *
 * Domain   : https://lovelyblossoms.com
 * Series   : /novel/{slug}/
 * Latest   : homepage + /novel/
 * Search   : /?s={q}&post_type=wp-manga
 * Chapters : POST /novel/{slug}/ajax/chapters/?t=1
 */

import { MadaraNovelSource } from '../family/MadaraNovelSource';

export class LovelyBlossomsSource extends MadaraNovelSource {
	id = 'lovelyblossoms';
	name = 'Lovely Blossoms';
	baseUrl = 'https://lovelyblossoms.com';

	protected seriesPath = '/novel';
	protected defaultLang = 'en';
	protected perPage = 24;
	protected useAjaxChapters = true;
	protected mergeHomeOnPage1 = true;

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, this.name)
			.replace(/\s*[-|]\s*Lovely\s*Blossoms.*$/i, '')
			.trim();
	}
}

export default LovelyBlossomsSource;
