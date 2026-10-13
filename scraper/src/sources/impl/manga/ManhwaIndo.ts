/**
 * ManhwaIndo adapter (www.manhwaindo.my)
 * → extends ThemesiaSource
 *
 * Theme: Themesia / WordPress manga (mangareader)
 * Latest (Project Update) : /project-updates/  &  /project-updates/page/{n}/
 * Series list             : /series/?order=update
 * Search                  : /?s=
 * Detail                  : /series/{slug}/
 * Chapter                 : /{slug}-chapter-{num}/
 * Pages                   : #readerarea img / .rdminimal img
 *
 * Catalog utama = Project Update.
 */

import * as cheerio from 'cheerio';
import { ThemesiaSource } from '../../family/ThemesiaSource';
import type { Manga } from '../../types-manga';

export class ManhwaIndoSource extends ThemesiaSource {
	id = 'manhwaindo';
	name = 'ManhwaIndo';
	baseUrl = 'https://www.manhwaindo.my';

	protected seriesPath = '/series';
	protected defaultLang = 'id';
	protected perPage = 24;

	protected listPath(page: number): string {
		const p = Math.max(1, page || 1);
		if (p <= 1) return '/project-updates/';
		return `/project-updates/page/${p}/`;
	}

	protected searchPath(query: string, page: number): string {
		const q = encodeURIComponent(query);
		return page <= 1 ? `/?s=${q}` : `/page/${page}/?s=${q}`;
	}

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, 'ManhwaIndo')
			.replace(/\s*[-|]\s*Manhwa\s*Indo.*$/i, '')
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
			console.error('[manhwaindo] getLatestManga', e);
			return [];
		}
	}
}
