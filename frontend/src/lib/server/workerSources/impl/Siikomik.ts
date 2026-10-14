/**
 * Siikomik adapter (siikomik.id)
 * Theme: Madara custom (slider grid + /komik/) → extends MadaraSource
 *
 * Latest     : GET /wp-json/madara/v1/manga?page=N&per_page=24
 *              (HTML list cards have NO chapter badges — API has latest_chapter)
 * Search     : /?s={q}&post_type=wp-manga
 * Detail     : /komik/{slug}/
 * Chapters   : POST /komik/{slug}/ajax/chapters/
 * Pages      : .wp-manga-chapter-img[data-src]
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
	protected cardSelector =
		'.slider__item, .page-item-detail, .manga, .page-listing-item .col-12, .badge-pos-1, .c-tabs-item__content';

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, this.name)
			.replace(/&#8217;/g, "'")
			.replace(/&amp;/g, '&')
			.replace(/\s*[-|]\s*Siikomik.*$/i, '')
			.replace(/\s*[-|]\s*Chapter\s*\d+.*$/i, '')
			.replace(/^(?:18\+?\s*)?(?:HOT\s*)+/i, '')
			.replace(
				/\s+(?:Drama|Romance|Smut|Fantasy|Action|Comedy|Horror|Mystery|Historical|Adult|Mature|Slice of Life|School Life|Supernatural)(?:\s+(?:Drama|Romance|Smut|Fantasy|Action|Comedy|Horror|Mystery|Historical|Adult|Mature|Slice of Life|School Life|Supernatural))*\s*$/i,
				''
			)
			.trim();
	}

	protected absUrl(url: string): string {
		if (!url) return '';
		let u = url.trim().replace(/\s+/g, '');
		if (u.startsWith('http')) return u;
		if (u.startsWith('//')) return `https:${u}`;
		return `${this.baseUrl}${u.startsWith('/') ? '' : '/'}${u}`;
	}

	private imgSrc($img: cheerio.Cheerio<any>): string {
		let cover =
			$img.attr('data-src') ||
			$img.attr('data-lazy-src') ||
			$img.attr('data-srcset')?.split(',')[0]?.trim().split(/\s+/)[0] ||
			$img.attr('srcset')?.split(',')[0]?.trim().split(/\s+/)[0] ||
			$img.attr('src') ||
			'';
		if (/^data:image/i.test(cover) || /dflazy/i.test(cover)) {
			cover =
				$img.attr('data-src') ||
				$img.attr('data-srcset')?.split(',')[0]?.trim().split(/\s+/)[0] ||
				'';
		}
		return (cover || '').trim();
	}

	private latestFromApi(raw: unknown): string | undefined {
		const text = String(raw || '')
			.replace(/<[^>]+>/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		if (!text) return undefined;
		const n = this.parseChapterNumber(text);
		return n > 0 ? String(n) : undefined;
	}

	protected parseCards($: cheerio.CheerioAPI): Manga[] {
		const mangas: Manga[] = [];
		const seen = new Set<string>();

		const push = (
			id: string,
			titleRaw: string,
			cover: string,
			latestChapter?: string,
			status = 'Ongoing'
		) => {
			if (!id || seen.has(id)) return;
			if (!/^\/komik\/[^/]+$/i.test(id)) return;
			seen.add(id);
			const title =
				this.normalizeTitle(titleRaw) || id.split('/').filter(Boolean).pop() || id;
			if (!title) return;
			mangas.push({
				id,
				title,
				cover: this.preferFullCover(this.absUrl(cover)),
				sourceId: this.id,
				type: 'manhwa',
				status,
				latestChapter,
				lang: this.defaultLang
			});
		};

		$(this.cardSelector).each((_, el) => {
			const $el = $(el);
			const $a = $el
				.find('a[href*="/komik/"]')
				.filter((_, a) => {
					const h = (($(a).attr('href') || '').split('?')[0] || '').replace(
						/\/+$/,
						''
					);
					return /\/komik\/[^/]+$/i.test(h) && !/\/chapter-/i.test(h);
				})
				.first();
			if (!$a.length) return;

			const id = this.cleanId($a.attr('href') || '');
			const title =
				$el
					.find(
						'.post-title a, .post-title h3, .post-title h4, .post-title h5, .post-title'
					)
					.first()
					.text() ||
				$a.attr('title') ||
				$el.find('img').attr('alt') ||
				'';

			const cover = this.imgSrc($el.find('img').first());

			let latestChapter: string | undefined;
			$el.find('a[href*="/chapter-"]').each((_, a) => {
				const n = this.parseChapterNumber(
					$(a).text(),
					$(a).attr('href') || ''
				);
				if (n > 0 && (!latestChapter || n > parseFloat(latestChapter))) {
					latestChapter = String(n);
				}
			});
			if (!latestChapter) {
				const chText = $el
					.find(
						'.chapter-item, .list-chapter, .chapter, .font-meta.chapter, .chapter-link, .meta-item.latest-chap'
					)
					.first()
					.text();
				const n = this.parseChapterNumber(chText);
				if (n > 0) latestChapter = String(n);
			}

			const badge = $el.find('.manga-title-badges').text().toLowerCase();
			const status = /end|tamat|complete/.test(badge) ? 'Completed' : 'Ongoing';

			push(id, title, cover, latestChapter, status);
		});

		if (mangas.length < 8) {
			$('a[href*="/komik/"]').each((_, el) => {
				const href = ($(el).attr('href') || '').split('?')[0];
				const id = this.cleanId(href);
				if (!/^\/komik\/[^/]+$/i.test(id) || seen.has(id)) return;
				if (/\/chapter-/i.test(id)) return;

				const $a = $(el);
				const $item = $a.closest('.slider__item, .page-item-detail, .manga').length
					? $a.closest('.slider__item, .page-item-detail, .manga')
					: $a.parent();

				const $img = $a.find('img').first().length
					? $a.find('img').first()
					: $item.find('img').first();

				const title =
					$item.find('.post-title').first().text() ||
					$a.attr('title') ||
					$img.attr('alt') ||
					id;

				push(id, title, this.imgSrc($img));
			});
		}

		return mangas;
	}

	private async fetchMadaraApi(page: number): Promise<Manga[]> {
		const p = Math.max(1, page || 1);
		const url = `${this.baseUrl}/wp-json/madara/v1/manga?page=${p}&per_page=${this.perPage}`;
		const res = await fetch(url, {
			headers: {
				...this.headers,
				Accept: 'application/json',
				Referer: `${this.baseUrl}/`
			},
			redirect: 'follow'
		});
		if (!res.ok) throw new Error(`madara api ${res.status}`);
		const json = (await res.json()) as {
			success?: boolean;
			data?: Array<{
				title?: string;
				url?: string;
				thumbnail?: string;
				status?: string;
				type?: string;
				latest_chapter?: string;
			}>;
		};
		const rows = Array.isArray(json?.data) ? json.data : [];
		const out: Manga[] = [];
		const seen = new Set<string>();

		for (const row of rows) {
			const id = this.cleanId(row.url || '');
			if (!id || !/^\/komik\/[^/]+$/i.test(id) || seen.has(id)) continue;
			seen.add(id);
			const title = this.normalizeTitle(row.title || '') || id.split('/').pop() || id;
			const st = String(row.status || '').toLowerCase();
			const status = /end|tamat|complete|finish/.test(st) ? 'Completed' : 'Ongoing';
			const typeRaw = String(row.type || '').toLowerCase();
			const type =
				typeRaw.includes('manhwa')
					? 'manhwa'
					: typeRaw.includes('manhua')
						? 'manhua'
						: typeRaw.includes('novel')
							? 'novel'
							: 'manga';

			out.push({
				id,
				title,
				cover: this.preferFullCover(this.absUrl(row.thumbnail || '')),
				sourceId: this.id,
				type,
				status,
				latestChapter: this.latestFromApi(row.latest_chapter),
				lang: this.defaultLang
			});
		}
		return out;
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

			try {
				const apiList = await this.fetchMadaraApi(p);
				if (apiList.length) {
					console.log(`[${this.id}] madara api page=${p} → ${apiList.length}`);
					return apiList.slice(0, this.perPage);
				}
			} catch (e) {
				console.warn(`[${this.id}] madara api failed, fallback HTML`, e);
			}

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
