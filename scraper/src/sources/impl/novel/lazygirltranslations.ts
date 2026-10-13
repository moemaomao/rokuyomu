/**
 * Lazy Girl Translations adapter
 * → extends ThemesiaSource (novel / lightnovel theme)
 *
 * Domain  : https://lazygirltranslations.com
 * Latest  : /series/?order=update&page=N
 * Search  : /?s={q}
 * Detail  : /series/{slug}/
 * Chapter : /{slug}-chapter-{n}/  (root path)
 * Content : .epcontent / .entry-content / .reading-content (TEXT)
 * Bahasa default: en
 */

import * as cheerio from 'cheerio';
import { ThemesiaSource } from '../../family/ThemesiaSource';
import type { Manga } from '../../types-manga';

export class LazyGirlTranslationsSource extends ThemesiaSource {
	id = 'lazygirltranslations';
	name = 'Lazy Girl Translations';
	baseUrl = 'https://lazygirltranslations.com';

	protected seriesPath = '/series';
	protected defaultLang = 'en';
	protected perPage = 24;

	protected listPath(page: number): string {
		const p = Math.max(1, page || 1);
		if (p <= 1) return `${this.seriesPath}/?order=update`;
		return `${this.seriesPath}/?order=update&page=${p}`;
	}

	protected searchPath(query: string, page: number): string {
		const q = encodeURIComponent(query);
		return page <= 1 ? `/?s=${q}` : `/page/${page}/?s=${q}`;
	}

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, this.name)
			.replace(new RegExp(`\\s*[-|]\\s*${this.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*$`, 'i'), '')
			.trim();
	}

	async getLatestManga(page: number): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			let list = this.parseCards(
				cheerio.load(await this.fetchHtml(this.listPath(p)))
			);

			if (list.length < 8 && p === 1) {
				try {
					const home = this.parseCards(cheerio.load(await this.fetchHtml('/')));
					const seen = new Set(list.map((m) => m.id));
					for (const m of home) {
						if (seen.has(m.id)) continue;
						seen.add(m.id);
						list.push(m);
						if (list.length >= this.perPage) break;
					}
				} catch {
					/* ignore */
				}
			}

			console.log(`[${this.id}] latest page=${p} → ${list.length}`);
			return list.slice(0, this.perPage);
		} catch (e) {
			console.error(`[${this.id}] getLatestManga`, e);
			return [];
		}
	}

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}
}

export default LazyGirlTranslationsSource;
