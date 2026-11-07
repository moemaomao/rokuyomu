/**
 * Foxaholic.com — Madara (WP Manga) novel
 * → extends MadaraNovelSource
 *
 * Domain   : https://www.foxaholic.com
 * Series   : /novel/{slug}/
 * Latest   : homepage first (CF often blocks /novel/?m_orderby=…)
 * Search   : /?s={q}&post_type=wp-manga
 * Chapters : POST /novel/{slug}/ajax/chapters/
 *
 * Catatan: domain sering Cloudflare challenge → taruh di WORKER_SOURCE_IDS
 * atau aktifkan Byparr di scraper.
 */

import { MadaraNovelSource } from '../../family/MadaraNovelSource';

export class FoxaholicSource extends MadaraNovelSource {
	id = 'foxaholic';
	name = 'Foxaholic';
	baseUrl = 'https://www.foxaholic.com';

	protected seriesPath = '/novel';
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
			.replace(/\s*[-|]\s*Foxaholic.*$/i, '')
			.trim();
	}
}

export default FoxaholicSource;
