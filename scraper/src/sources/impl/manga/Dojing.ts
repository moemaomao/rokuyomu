/**
 * Dojing (dojing.net) adapter – MangaReader theme (18+)
 * → extends ThemesiaSource
 *
 * List   : /manga/?order=update&page=N  (query page, /manga/page/N/)
 * Search : /?s=QUERY
 * Detail : /manga/{slug}/
 * Chapter: /{slug}-chapter-{n}/
 * Pages  : ts_reader.run / #readerarea
 *
 * Bahasa: Indonesian | NSFW
 * Site ~12 item/page → merge 2 site-pages per app page.
 */

import * as cheerio from 'cheerio';
import { ThemesiaSource } from '../../family/ThemesiaSource';
import type { Manga } from '../../types-manga';

export class DojingSource extends ThemesiaSource {
	id = 'dojing';
	name = 'Dojing';
	baseUrl = 'https://dojing.net';

	protected seriesPath = '/manga';
	protected defaultLang = 'id';
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
			.normalizeTitle(raw, 'Dojing')
			.replace(/\s*[-–|].*Dojing.*$/i, '')
			.replace(/\s*All Chapter.*$/i, '')
			.trim();
	}

	async getLatestManga(page: number): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const siteStart = (p - 1) * 2 + 1;
			const paths = [this.listPath(siteStart), this.listPath(siteStart + 1)];

			const seen = new Set<string>();
			const merged: Manga[] = [];

			for (const path of paths) {
				if (merged.length >= this.perPage) break;
				try {
					const html = await this.fetchHtml(path);
					if (!html || html.length < 500) continue;
					const batch = this.parseCards(cheerio.load(html));
					for (const m of batch) {
						if (seen.has(m.id)) continue;
						seen.add(m.id);
						merged.push(m);
						if (merged.length >= this.perPage) break;
					}
				} catch (e) {
					console.warn(`[dojing] fail ${path}`, e);
				}
			}

			console.log(`[dojing] latest page=${p} → ${merged.length}`);
			return merged.slice(0, this.perPage);
		} catch (e) {
			console.error('[dojing] getLatestManga', e);
			return [];
		}
	}
}
