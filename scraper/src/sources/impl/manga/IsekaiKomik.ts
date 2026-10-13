/**
 * IsekaiKomik adapter (MangaThemesia / mangareader)
 * → extends ThemesiaSource
 *
 * List/Latest : /  |  /page/{n}/  (homepage cards)
 * Fallback    : /manga/?order=update
 * Search      : /?s=
 * Detail      : /manga/{slug}/
 * Chapter     : /{slug}-chapter-{n}/
 * Pages       : ts_reader.run / #readerarea
 *
 * Bahasa default: Indonesian
 */

import * as cheerio from 'cheerio';
import { ThemesiaSource } from '../../family/ThemesiaSource';
import type { Manga } from '../../types-manga';

export class IsekaiKomikSource extends ThemesiaSource {
	id = 'isekaikomik';
	name = 'IsekaiKomik';
	baseUrl = 'https://ch1.isekaikomik.site';

	protected seriesPath = '/manga';
	protected defaultLang = 'id';
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
			.normalizeTitle(raw, 'IsekaiKomik')
			.replace(/\s*[-|]\s*Isekai\s*Komik.*$/i, '')
			.trim();
	}

	async getLatestManga(page: number): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			let list = this.parseCards(cheerio.load(await this.fetchHtml(this.listPath(p))));
			if (list.length < 8 && p === 1) {
				const fill = this.parseCards(
					cheerio.load(await this.fetchHtml(`${this.seriesPath}/?order=update`))
				);
				const seen = new Set(list.map((m) => m.id));
				for (const m of fill) {
					if (seen.has(m.id)) continue;
					seen.add(m.id);
					list.push(m);
					if (list.length >= this.perPage) break;
				}
			}
			return list.slice(0, this.perPage);
		} catch (e) {
			console.error('[isekaikomik] getLatestManga', e);
			return [];
		}
	}
}
