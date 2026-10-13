/**
 * ManhwaIndo adapter (www.manhwaindo.my)
 * → extends ThemesiaSource
 *
 * Latest : /series/?order=update&page=N
 * Search : /?s=
 * Detail : /series/{slug}/
 * Chapter: /{slug}-chapter-{num}/
 * Pages  : #readerarea img / .rdminimal img
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
		if (p <= 1) return `${this.seriesPath}/?order=update`;
		return `${this.seriesPath}/?order=update&page=${p}`;
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

	protected parseCards($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		$('.listupd .bs, .listupd .bsx, .bs, .bsx').each((_, el) => {
			const $el = $(el);
			const $a = $el
				.find('a[href*="/series/"]')
				.filter((_, a) => {
					const h = ($(a).attr('href') || '').split('?')[0];
					return /\/series\/[^/]+\/?$/.test(h);
				})
				.first();
			const href = $a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (!/^\/series\/[^/]+$/i.test(id) || seen.has(id)) return;
			if (/\/series\/(page|list-mode|feed)/i.test(id)) return;
			seen.add(id);

			const title = this.normalizeTitle(
				$el.find('.tt, .hottitle').first().text() ||
					$a.attr('title') ||
					$el.find('img').attr('alt') ||
					''
			);
			if (!title) return;

			const $img = $el.find('img').first();
			let cover =
				$img.attr('data-src') ||
				$img.attr('data-lazy-src') ||
				$img.attr('src') ||
				'';
			if (cover.startsWith('data:')) cover = '';
			cover = this.preferFullCover(this.absUrl(cover));

			let latestChapter: string | undefined;
			const epText = $el
				.find('.epxs, .epx')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			if (epText) {
				const n = this.parseChapterNumber(epText);
				if (n > 0) latestChapter = String(n);
			}

			res.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type: this.mapType($el.text()),
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
			const siteStart = (p - 1) * 2 + 1;
			const seen = new Set<string>();
			const merged: Manga[] = [];

			for (const sp of [siteStart, siteStart + 1]) {
				if (merged.length >= this.perPage) break;
				try {
					const batch = this.parseCards(
						cheerio.load(await this.fetchHtml(this.listPath(sp)))
					);
					for (const m of batch) {
						if (seen.has(m.id)) continue;
						seen.add(m.id);
						merged.push(m);
					}
					if (batch.length === 0) break;
				} catch (e) {
					console.error('[manhwaindo] catalog page', sp, e);
					break;
				}
			}

			if (merged.length === 0 && p === 1) {
				try {
					const alt = this.parseCards(
						cheerio.load(await this.fetchHtml('/project-updates/'))
					);
					for (const m of alt) {
						if (seen.has(m.id)) continue;
						seen.add(m.id);
						merged.push(m);
					}
				} catch {
					/* ignore */
				}
			}

			console.log(`[manhwaindo] latest page=${p} → ${merged.length}`);
			return merged.slice(0, this.perPage);
		} catch (e) {
			console.error('[manhwaindo] getLatestManga', e);
			return [];
		}
	}
}
