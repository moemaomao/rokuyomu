/**
 * LHTranslation adapter (lhtranslation.net)
 * Theme: Madara (WordPress) → extends MadaraSource
 *
 * Latest    : /home/  |  /home/page/{n}/  (fallback /manga/?m_orderby=latest)
 * Search    : /?s={q}&post_type=wp-manga
 * Detail    : /manga/{slug}/
 * Chapters  : POST /manga/{slug}/ajax/chapters/
 * Pages     : .reading-content img.wp-manga-chapter-img
 */

import * as cheerio from 'cheerio';
import { MadaraSource } from '../family/MadaraSource';
import type { Manga } from '../types-manga';

export class LHTranslationSource extends MadaraSource {
	id = 'lhtranslation';
	name = 'LHTranslation';
	baseUrl = 'https://lhtranslation.net';

	protected seriesPath = '/manga';
	protected defaultLang = 'en';
	protected perPage = 20;
	protected useAjaxChapters = true;

	protected listPath(page: number): string {
		const p = Math.max(1, page || 1);
		if (p <= 1) return `/home/`;
		return `/home/page/${p}/`;
	}

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, this.name)
			.replace(/\s*[-|]\s*LH\s*Translation.*$/i, '')
			.trim();
	}

	async getLatestManga(page: number): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			let list = this.parseCards(cheerio.load(await this.fetchHtml(this.listPath(p))));
			if (list.length === 0) {
				const alt =
					p <= 1
						? `${this.seriesPath}/?m_orderby=latest`
						: `${this.seriesPath}/page/${p}/?m_orderby=latest`;
				list = this.parseCards(cheerio.load(await this.fetchHtml(alt)));
			}
			const out = list.slice(0, this.perPage);
			console.log(`[${this.id}] latest page=${p} → ${out.length}`);
			return out;
		} catch (e) {
			console.error(`[${this.id}] getLatestManga`, e);
			return [];
		}
	}
}

export default LHTranslationSource;
