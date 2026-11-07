/**
 * Violet Manga adapter (violetmanga.com)
 * → extends ThemesiaSource
 *
 * Latest  : /comics/?order=update&page=N
 * Search  : /?s=query
 * Detail  : /comics/{slug}/
 * Chapter : /{slug}-chapter-{n}/
 * Pages   : ts_reader / #readerarea
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
		if (p <= 1) return `${this.seriesPath}/?order=update`;
		return `${this.seriesPath}/?order=update&page=${p}`;
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

	protected parseCards($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		$('.listupd .bs, .listupd .bsx, .bs, .bsx').each((_, el) => {
			const $card = $(el);
			const a = $card
				.find('a[href*="/comics/"]')
				.filter((_, link) => {
					const h = ($(link).attr('href') || '').split('?')[0];
					return /\/comics\/[^/]+\/?$/.test(h) && !/chapter/i.test(h);
				})
				.first();
			const href = a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (seen.has(id) || /\/comics\/(page|list-mode)/i.test(id)) return;
			seen.add(id);

			const title = this.normalizeTitle(
				$card.find('.tt').first().text() ||
					a.attr('title') ||
					$card.find('img').attr('alt') ||
					''
			);
			if (!title) return;

			const img = $card.find('img').first();
			let cover =
				img.attr('data-src') ||
				img.attr('data-lazy-src') ||
				img.attr('src') ||
				'';
			if (cover.startsWith('data:')) cover = '';
			cover = this.preferFullCover(this.absUrl(cover));

			let latestChapter: string | undefined;
			$card.find('.epxs, .epx, .chapter-list .epxs').each((_, chEl) => {
				const t = $(chEl).text().replace(/\s+/g, ' ').trim();
				const n = this.parseChapterNumber(t);
				if (n > 0) {
					latestChapter = String(n);
					return false;
				}
			});
			if (!latestChapter) {
				const chHref = $card.find('a[href*="-chapter-"]').attr('href') || '';
				const n2 = this.parseChapterNumber('', chHref);
				if (n2 > 0) latestChapter = String(n2);
			}

			res.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type: this.mapType($card.text()),
				status: 'Ongoing',
				latestChapter,
				lang: this.defaultLang
			});
		});

		return res;
	}

	async getLatestManga(page: number): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const list = this.parseCards(
				cheerio.load(await this.fetchHtml(this.listPath(p)))
			);
			console.log(`[violetmanga] latest page=${p} → ${list.length}`);
			return list.slice(0, this.perPage);
		} catch (e) {
			console.error('[violetmanga] getLatestManga', e);
			return [];
		}
	}
}
