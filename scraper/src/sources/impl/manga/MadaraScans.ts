/**
 * MadaraScans adapter (https://madarascans.org)
 * → extends ThemesiaSource
 *
 * Theme: Themesia / mangareader (bukan Madara)
 * List   : /series/?order=update&page=N
 * Search : /?s={q}
 * Detail : /series/{slug}/
 * Chapter: /{slug}-chapter-{n}/
 * Pages  : ts_reader / #readerarea
 */

import * as cheerio from 'cheerio';
import { ThemesiaSource } from '../../family/ThemesiaSource';
import type { Manga } from '../../types-manga';

export class MadaraScansSource extends ThemesiaSource {
	id = 'madarascans';
	name = 'MadaraScans';
	baseUrl = 'https://madarascans.org';

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
		return page <= 1 ? `/?s=${q}` : `/?s=${q}&page=${page}`;
	}

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, 'MadaraScans')
			.replace(/\s*[-|]\s*Madara\s*Scans.*$/i, '')
			.trim();
	}

	protected parseCards($: cheerio.CheerioAPI): Manga[] {
		const mangas: Manga[] = [];
		const seen = new Set<string>();

		$('.listupd .bs, .listupd .bsx, .bs, .bsx').each((_, card) => {
			const $card = $(card);
			const $link = $card
				.find('a[href*="/series/"]')
				.filter((_, a) => {
					const h = ($(a).attr('href') || '').split('?')[0];
					return /\/series\/[^/]+\/?$/.test(h);
				})
				.first();

			const href = $link.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (!/^\/series\/[^/]+$/i.test(id) || seen.has(id)) return;
			if (/\/series\/(page|list-mode|feed)/i.test(id)) return;
			seen.add(id);

			const title =
				this.normalizeTitle(
					$link.attr('title') ||
						$card.find('.tt').first().text() ||
						$card.find('img').attr('alt') ||
						''
				) ||
				id.split('/').pop() ||
				id;

			const $img = $card.find('img').first();
			let cover =
				$img.attr('data-src') ||
				$img.attr('data-lazy-src') ||
				$img.attr('src') ||
				'';
			if (cover.startsWith('data:')) cover = '';
			cover = this.preferFullCover(this.absUrl(cover));

			let latestChapter: string | undefined;
			const epText = $card
				.find('.epxs, .epx')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			if (epText) {
				const n = this.parseChapterNumber(epText);
				if (n > 0) latestChapter = String(n);
				else {
					const cleaned = epText
						.replace(/^chapter\s*/i, '')
						.replace(/\s*END\s*$/i, '')
						.trim();
					if (cleaned && cleaned !== '?' && cleaned !== '0') {
						latestChapter = cleaned;
					}
				}
			}
			if (!latestChapter) {
				const cardHtml = $.html($card) || '';
				const em =
					cardHtml.match(/class=["']epxs["'][^>]*>\s*Chapter\s*([\d.]+)/i) ||
					cardHtml.match(/Chapter\s+([\d.]+)\s*(?:END)?/i);
				if (em?.[1]) latestChapter = em[1];
			}
			if (!latestChapter) {
				const chHref = $card.find('a[href*="-chapter-"]').attr('href') || '';
				const n2 = this.parseChapterNumber('', chHref);
				if (n2 > 0) latestChapter = String(n2);
			}

			mangas.push({
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

		return mangas;
	}
}
