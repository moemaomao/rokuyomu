/**
 * Noromax (noromax02.my.id) — Themesia MangaReader → extends ThemesiaSource
 *
 * Page 1 : /project/ (+ fill /manga/?order=update)
 * Page 2+: /manga/?order=update&page={n}
 * Search : /?s=
 * Detail : /manga/{slug}/
 * Chapter: /{slug}-chapter-{n}/
 */

import * as cheerio from 'cheerio';
import { ThemesiaSource } from '../../family/ThemesiaSource';
import type { Manga } from '../../types-manga';

export class NoromaxSource extends ThemesiaSource {
	id = 'noromax';
	name = 'Noromax';
	baseUrl = 'https://noromax02.my.id';

	protected seriesPath = '/manga';
	protected defaultLang = 'id';
	protected perPage = 24;

	protected listPath(page: number): string {
		const p = Math.max(1, page || 1);
		return p <= 1
			? `${this.seriesPath}/?order=update`
			: `${this.seriesPath}/?order=update&page=${p}`;
	}

	protected searchPath(query: string, page: number): string {
		const q = encodeURIComponent(query);
		return page <= 1 ? `/?s=${q}` : `/?s=${q}&page=${page}`;
	}

	protected parseChapterNumber(text: string, path = ''): number {
		const fromPath =
			path.match(/(?:ch|chapter)[_-]?(\d+)(?:[.-](\d+))?/i) ||
			path.match(/-(\d+)(?:[.-](\d+))?\/?$/i);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null && fromPath[2].length <= 2) {
				return parseFloat(`${major}.${fromPath[2]}`);
			}
			return major;
		}
		return super.parseChapterNumber(text, path);
	}

	protected normalizeTitle(raw: string): string {
		return super.normalizeTitle(raw, 'Noromax').replace(/\s*[-|]\s*Noromax.*$/i, '').trim();
	}

	async getLatestManga(page: number): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			if (p === 1) {
				const projectHtml = await this.fetchHtml('/project/');
				let list = this.parseCards(cheerio.load(projectHtml));
				if (list.length < this.perPage) {
					const fill = this.parseCards(
						cheerio.load(await this.fetchHtml('/manga/?order=update'))
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
			}
			const html = await this.fetchHtml(this.listPath(p));
			return this.parseCards(cheerio.load(html)).slice(0, this.perPage);
		} catch (e) {
			console.error('[noromax] getLatestManga', e);
			return [];
		}
	}
}
