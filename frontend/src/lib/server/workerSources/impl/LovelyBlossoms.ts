/**
 * LovelyBlossoms.com — Madara theme (novel)
 * → extends MadaraNovelSource
 *
 * Domain   : https://lovelyblossoms.com
 * Series   : /manga/{slug}/   (bukan /novel/ — path /novel/ = 404)
 * Latest   : homepage + /manga/?m_orderby=latest
 * Search   : /?s={q}&post_type=wp-manga
 * Chapters : POST /manga/{slug}/ajax/chapters/
 */

import { MadaraNovelSource } from '../family/MadaraNovelSource';

export class LovelyBlossomsSource extends MadaraNovelSource {
	id = 'lovelyblossoms';
	name = 'Lovely Blossoms';
	baseUrl = 'https://lovelyblossoms.com';

	protected seriesPath = '/manga';
	protected defaultLang = 'en';
	protected perPage = 24;
	protected useAjaxChapters = true;
	protected mergeHomeOnPage1 = true;

	protected listPath(page: number): string {
		const p = Math.max(1, page || 1);
		if (p <= 1) return `/`;
		return `${this.seriesPath}/page/${p}/?m_orderby=${this.listOrderby}`;
	}

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, this.name)
			.replace(/\s*[-|]\s*Lovely\s*Blossoms.*$/i, '')
			.trim();
	}
}

export default LovelyBlossomsSource;
