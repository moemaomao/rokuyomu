/**
 * Violet Manga / Violet Scans adapter (violetmanga.com)
 * → extends ThemesiaSource
 *
 * Latest  : /  |  /page/N/  (section Latest Comics)
 * Search  : /?s=query
 * Detail  : /comics/{slug}/
 * Chapter : /{slug}-chapter-{n}/
 * Pages   : ts_reader.run / #readerarea
 *
 * Bahasa default: English
 * Catatan: chapter premium (locked) bisa return pages kosong.
 */

import * as cheerio from 'cheerio';
import { ThemesiaSource } from '../../family/ThemesiaSource';
import type { Manga } from '../../types-manga';

export class VioletMangaSource extends ThemesiaSource {
	id = 'violetmanga';
	name = 'Violet Manga';
	baseUrl = 'https://violetmanga.com';

	protected seriesPath = '/comics';
	protected defaultLang = 'en';
	protected perPage = 24;

	protected listPath(page: number): string {
		const p = Math.max(1, page || 1);
		if (p <= 1) return '/';
		return `/page/${p}/`;
	}

	protected searchPath(query: string, page: number): string {
		const q = encodeURIComponent(query);
		return page <= 1 ? `/?s=${q}` : `/page/${page}/?s=${q}`;
	}

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, 'Violet Manga')
			.replace(/\s*[-|]\s*Violet\s*(Manga|Scans).*$/i, '')
			.trim();
	}

	async getLatestManga(page: number): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const list = this.parseCards(
				cheerio.load(await this.fetchHtml(this.listPath(p)))
			);
			return list.slice(0, this.perPage);
		} catch (e) {
			console.error('[violetmanga] getLatestManga', e);
			return [];
		}
	}
}
