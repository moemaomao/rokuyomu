/**
 * ThunderScans EN adapter (en-thunderscans.com)
 * → extends ThemesiaSource
 *
 * Theme     : Themesia / MangaReader + child theme custom CSS
 * Latest    : /comics/?order=update  |  /comics/?page=N&order=update
 * Search    : /?s={query}  |  /page/{n}/?s={query}
 * Detail    : /comics/{slug}/
 * Chapter   : /{seriesSlug}-chapter-{n}/  (free) | locked modal (paywall)
 * Pages     : ts_reader.run / #readerarea
 *
 * ID format:
 *   manga   : /comics/{slug}
 *   chapter : /{chapter-path}   e.g. /howling-chapter-5
 *
 * Bahasa default: English
 */

import * as cheerio from 'cheerio';
import { ThemesiaSource } from '../../family/ThemesiaSource';
import type { Manga } from '../../types-manga';

export class ThunderScansSource extends ThemesiaSource {
	id = 'thunderscans';
	name = 'ThunderScans';
	baseUrl = 'https://en-thunderscans.com';

	protected seriesPath = '/comics';
	protected defaultLang = 'en';
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
			.normalizeTitle(raw, 'ThunderScans')
			.replace(/\s*[-|]\s*Thunder\s*Scans.*$/i, '')
			.replace(/\s*All the comics on this website.*$/i, '')
			.trim();
	}

	protected parseCards($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		$('.listupd .bs, .listupd .bsx, .bs, .bsx').each((_, el) => {
			const $card = $(el);
			const $a = $card
				.find('a[href*="/comics/"]')
				.filter((_, a) => {
					const h = ($(a).attr('href') || '').split('?')[0];
					return (
						/\/comics\/[^/]+\/?$/.test(h) &&
						!/\/comics\/(page|list-mode)/i.test(h) &&
						!/chapter/i.test(h)
					);
				})
				.first();

			const href = $a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (!id.includes('/comics/') || seen.has(id)) return;
			if (/\/comics\/(page|list-mode|feed)/i.test(id)) return;
			seen.add(id);

			const title = this.normalizeTitle(
				$card.find('.tt').first().text() ||
					$a.attr('title') ||
					$card.find('img').attr('alt') ||
					''
			);
			if (!title) return;

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
					cardHtml.match(
						/class=["']epxs["'][^>]*>\s*(?:Chapter\s*)?(\d+(?:\.\d+)?)/i
					) || cardHtml.match(/Chapter\s+([\d.]+)\s*(?:END)?/i);
				if (em?.[1]) latestChapter = em[1];
			}
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
			let list = this.parseCards(
				cheerio.load(await this.fetchHtml(this.listPath(p)))
			);

			if (list.length < 8 && p === 1) {
				try {
					const home = this.parseCards(
						cheerio.load(await this.fetchHtml('/'))
					);
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

			const pageList = list.slice(0, this.perPage);
			console.log(`[thunderscans] latest page=${p} → ${pageList.length}`);
			return pageList;
		} catch (e) {
			console.error('[thunderscans] getLatestManga', e);
			return [];
		}
	}
}

export default ThunderScansSource;
