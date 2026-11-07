/**
 * Tangerine Archive — Madara / wp-manga (novel)
 * → extends MadaraNovelSource
 *
 * Domain   : https://tangerinearchive.com
 * Series   : /series/{slug}/
 * Latest   : homepage first + /series/?m_orderby=latest
 * Search   : /?s={q}&post_type=wp-manga
 * Chapters : POST /series/{slug}/ajax/chapters/
 *
 * Catatan: sering Cloudflare → Byparr atau WORKER_SOURCE_IDS.
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

	protected listPath(page: number): string {
		const p = Math.max(1, page || 1);
		if (p <= 1) return `/`;
		return `${this.seriesPath}/page/${p}/?m_orderby=${this.listOrderby}`;
	}

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, this.name)
			.replace(/\s*[-|]\s*Tangerine\s*Archive.*$/i, '')
			.trim();
	}
}

export default TangerineArchiveSource;
