/**
 * Sasangeyou (sasangeyou.net) — Themesia → extends ThemesiaSource
 *
 * Page 1 : homepage sections (+ fill /manga/?order=update)
 * Page 2+: /manga/page/{n}/?order=update
 * Search : /?s=  |  /page/{n}/?s=
 * Detail : /manga/{slug}/
 * Chapter: /{chapter-slug}/ (flat)
 */

import * as cheerio from 'cheerio';
import { ThemesiaSource } from '../../family/ThemesiaSource';
import type { Manga } from '../../types-manga';

export class SasangeyouSource extends ThemesiaSource {
	id = 'sasangeyou';
	name = 'Sasangeyou';
	baseUrl = 'https://sasangeyou.net';

	protected seriesPath = '/manga';
	protected defaultLang = 'id';
	protected perPage = 24;

	protected listPath(page: number): string {
		const p = Math.max(1, page || 1);
		if (p <= 1) return `${this.seriesPath}/?order=update`;
		return `${this.seriesPath}/page/${p}/?order=update`;
	}

	protected searchPath(query: string, page: number): string {
		const q = encodeURIComponent(query);
		return page <= 1 ? `/?s=${q}` : `/page/${page}/?s=${q}`;
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
		return super.normalizeTitle(raw, 'Sasangeyou').replace(/\s*[-|]\s*Sasangeyou.*$/i, '').trim();
	}

	async getLatestManga(page: number): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			if (p === 1) {
				let list = this.parseCards(cheerio.load(await this.fetchHtml('/')));
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
			console.error('[sasangeyou] getLatestManga', e);
			return [];
		}
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page || 1);
		if (!q) return this.getLatestManga(page);
		try {
			const html = await this.fetchHtml(this.searchPath(q, page));
			return this.parseCards(cheerio.load(html)).slice(0, this.perPage);
		} catch (e) {
			console.error('[sasangeyou] searchManga', e);
			return [];
		}
	}
}
