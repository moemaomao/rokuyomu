/**
 * Sektedoujin adapter (sektedoujin.cc)
 * → extends ThemesiaSource
 *
 * Theme: Themesia / mangareader
 * Latest  : /manga/?order=update  |  /manga/?page={n}&order=update
 * Search  : /?s={query}
 * Detail  : /manga/{slug}/
 * Chapter : /{slug}-chapter-{n}/
 * Pages   : ts_reader.run / #readerarea
 *
 * Bahasa default: Indonesian | NSFW
 */

import * as cheerio from 'cheerio';
import { ThemesiaSource } from '../../family/ThemesiaSource';
import type { Manga } from '../../types-manga';

export class SektedoujinSource extends ThemesiaSource {
	id = 'sektedoujin';
	name = 'Sektedoujin';
	baseUrl = 'https://sektedoujin.cc';

	protected seriesPath = '/manga';
	protected defaultLang = 'id';
	protected perPage = 24;

	protected listPath(page: number): string {
		const p = Math.max(1, page || 1);
		if (p <= 1) return `${this.seriesPath}/?order=update`;
		return `${this.seriesPath}/?page=${p}&order=update`;
	}

	protected searchPath(query: string, page: number): string {
		const q = encodeURIComponent(query);
		return page <= 1 ? `/?s=${q}` : `/page/${page}/?s=${q}`;
	}

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, 'Sektedoujin')
			.replace(/\s*[-|]\s*Sekte\s*Doujin.*$/i, '')
			.trim();
	}

	async getLatestManga(page: number): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			let list = this.parseCards(cheerio.load(await this.fetchHtml(this.listPath(p))));
			if (list.length < this.perPage && p === 1) {
				const home = this.parseCards(cheerio.load(await this.fetchHtml('/')));
				const seen = new Set(list.map((m) => m.id));
				for (const m of home) {
					if (seen.has(m.id)) continue;
					seen.add(m.id);
					list.push(m);
					if (list.length >= this.perPage) break;
				}
			}
			return list.slice(0, this.perPage);
		} catch (e) {
			console.error('[sektedoujin] getLatestManga', e);
			return [];
		}
	}
}
