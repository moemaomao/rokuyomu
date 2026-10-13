/**
 * Siikomik adapter (siikomik.id)
 * Theme: Madara (wp-manga) → extends MadaraSource
 *
 * seriesPath : /komik
 * Latest     : homepage / ; fill /semua-komik/ ; page 2+ → POST admin-ajax.php action=madara_load_more
 * Search     : /?s={q}&post_type=wp-manga
 * Detail     : /komik/{slug}/
 * Chapters   : POST /komik/{slug}/ajax/chapters/
 * Pages      : .wp-manga-chapter-img[data-src]
 * Catatan    : chapter premium (coin) terkunci tanpa login
 */

import * as cheerio from 'cheerio';
import { MadaraSource } from '../family/MadaraSource';
import type { Manga } from '../types-manga';

export class SiikomikSource extends MadaraSource {
	id = 'siikomik';
	name = 'Siikomik';
	baseUrl = 'https://siikomik.id';

	protected seriesPath = '/komik';
	protected defaultLang = 'id';
	protected perPage = 24;
	protected useAjaxChapters = true;

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, this.name)
			.replace(/&#8217;/g, "'")
			.replace(/&amp;/g, '&')
			.replace(/\s*[-|]\s*Siikomik.*$/i, '')
			.replace(/\s*[-|]\s*Chapter\s*\d+.*$/i, '')
			.trim();
	}

	protected absUrl(url: string): string {
		if (!url) return '';
		let u = url.trim().replace(/\s+/g, '');
		if (u.startsWith('http')) return u;
		if (u.startsWith('//')) return `https:${u}`;
		return `${this.baseUrl}${u.startsWith('/') ? '' : '/'}${u}`;
	}

	private async fetchMadaraPage(ajaxPage: number): Promise<Manga[]> {
		const body = new URLSearchParams({
			action: 'madara_load_more',
			page: String(ajaxPage),
			template: 'madara-core/content/content-archive',
			'vars[post_type]': 'wp-manga',
			'vars[post_status]': 'publish',
			'vars[posts_per_page]': String(this.perPage),
			'vars[orderby]': 'meta_value_num',
			'vars[meta_key]': '_latest_update',
			'vars[order]': 'desc',
			'vars[paged]': String(ajaxPage)
		});

		const res = await fetch(`${this.baseUrl}/wp-admin/admin-ajax.php`, {
			method: 'POST',
			headers: {
				...this.headers,
				'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
				'X-Requested-With': 'XMLHttpRequest',
				Referer: `${this.baseUrl}/semua-komik/`
			},
			body: body.toString(),
			redirect: 'follow'
		});
		const html = await res.text();
		if (!html || /no-posts/i.test(html)) return [];
		return this.parseCards(cheerio.load(html));
	}

	async getLatestManga(page: number): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);

			if (p === 1) {
				const homeHtml = await this.fetchHtml('/');
				let list = this.parseCards(cheerio.load(homeHtml));
				console.log(`[${this.id}] homepage → ${list.length}`);

				if (list.length < this.perPage) {
					try {
						const fill = this.parseCards(
							cheerio.load(await this.fetchHtml('/semua-komik/'))
						);
						const seen = new Set(list.map((m) => m.id));
						for (const m of fill) {
							if (seen.has(m.id)) continue;
							seen.add(m.id);
							list.push(m);
							if (list.length >= this.perPage) break;
						}
						console.log(`[${this.id}] home+semua → ${list.length}`);
					} catch {
						/* ignore */
					}
				}

				return list.slice(0, this.perPage);
			}

			const list = await this.fetchMadaraPage(p - 1);
			console.log(`[${this.id}] ajax page=${p} → ${list.length}`);
			return list.slice(0, this.perPage);
		} catch (e) {
			console.error(`[${this.id}] getLatestManga`, e);
			return [];
		}
	}
}

export default SiikomikSource;
