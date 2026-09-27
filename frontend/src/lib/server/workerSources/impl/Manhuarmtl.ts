/**
 * ManhuaRMTL adapter (manhuarmtl.com)
 *
 * Theme: Madara (custom child – mrm-r-item grid)
 * Latest   : /manga/?m_orderby=modified  &  /manga/page/{n}/?m_orderby=modified
 * Search   : /?s={q}&post_type=wp-manga
 * Detail   : /manga/{slug}/
 * Chapter  : /manga/{slug}/chapter-{num}/
 * Pages    : .reading-content img / .page-break img  →  cdn.manhuarmtl.com
 *
 * ID format:
 *   manga   : /manga/{slug}
 *   chapter : /manga/{slug}/chapter-{num}
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class ManhuarmtlSource extends BaseSource {
	id = 'manhuarmtl';
	name = 'ManhuaRMTL';
	baseUrl = 'https://manhuarmtl.com';

	private readonly PER_PAGE = 24;
	/** List page returns up to ~200 cards */
	private readonly SITE_PER_PAGE = 200;
	private readonly DEFAULT_LANG = 'en';

	// ── Helpers ──────────────────────────────────────────────────────────────

	private absUrl(url: string): string {
		if (!url) return '';
		url = url.trim();
		if (url.startsWith('http')) return url;
		if (url.startsWith('//')) return `https:${url}`;
		return `${this.baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
	}

	private cleanId(link: string): string {
		let id = (link || '').trim();
		if (id.startsWith('http')) {
			try {
				id = new URL(id).pathname;
			} catch {
				/* ignore */
			}
		}
		if (!id.startsWith('/')) id = `/${id}`;
		return id.replace(/\/+$/, '').split('?')[0] || '/';
	}

	private normalizeTitle(raw: string): string {
		if (!raw) return '';
		return raw
			.trim()
			.replace(/\s+/g, ' ')
			.replace(/\s*[-|]\s*ManhuaR?MTL.*$/i, '')
			.replace(/\s*Read Online.*$/i, '')
			.trim();
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath = String(path).match(/chapter[_-]?(\d+)(?:[.-](\d+))?/i);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null && fromPath[2].length <= 2) {
				return parseFloat(`${major}.${fromPath[2]}`);
			}
			return major;
		}
		const m = String(text).match(/(?:chapter|chap|ch\.?)\s*(\d+)(?:[.,](\d+))?/i);
		if (m) {
			if (m[2] != null && m[2].length <= 2) {
				return parseFloat(`${m[1]}.${m[2]}`);
			}
			return parseInt(m[1], 10);
		}
		const n = String(text).match(/\b(\d+(?:\.\d{1,2})?)\b/);
		return n ? parseFloat(n[1]) : NaN;
	}

	private mapStatus(raw?: string | null): string {
		const s = String(raw || '').toLowerCase();
		if (/\b(completed|complete|end|finished|tamat)\b/.test(s)) return 'Completed';
		if (/\bhiatus\b/.test(s)) return 'Hiatus';
		if (/\b(cancelled|dropped|canceled)\b/.test(s)) return 'Cancelled';
		return 'Ongoing';
	}

	private mapType(raw: string): 'manga' | 'manhwa' | 'manhua' {
		const t = String(raw || '').toLowerCase();
		if (t.includes('manhwa')) return 'manhwa';
		if (t.includes('manhua')) return 'manhua';
		if (t.includes('manga')) return 'manga';
		return 'manhua';
	}

	// ── List cards ───────────────────────────────────────────────────────────

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const mangas: Manga[] = [];
		const seen = new Set<string>();

		const $items = $('li.mrm-r-item, .mrm-r-item');
		$items.each((_, el) => {
			const $el = $(el);
			const $a =
				$el.find('a.mrm-r-item__link[href*="/manga/"]').first() ||
				$el.find('a[href*="/manga/"]').filter((_, a) => {
					const h = ($(a).attr('href') || '').split('?')[0];
					return /\/manga\/[^/]+\/?$/.test(h) && !/chapter/i.test(h);
				}).first();

			const href = $a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (!/^\/manga\/[^/]+$/i.test(id) || seen.has(id)) return;
			seen.add(id);

			const $img = $el.find('img').first();
			let title =
				$el.find('.mrm-r-item__title').first().text() ||
				$a.attr('title') ||
				$img.attr('alt') ||
				$a.text() ||
				'';
			title = this.normalizeTitle(title);
			if (!title || title.length < 2) {
				const slug = id.split('/').filter(Boolean).pop() || '';
				title = slug
					.split('-')
					.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
					.join(' ');
			}
			if (!title) return;

			let cover =
				$img.attr('data-src') ||
				$img.attr('data-lazy-src') ||
				$img.attr('src') ||
				'';
			cover = this.absUrl((cover || '').trim().split('?')[0]);

			let latestChapter: number | undefined;
			const chText = $el.find('.mrm-r-item__chapter, a[href*="chapter"]').first().text();
			const chMatch = chText.match(/(?:Chapter|Ch\.?)\s*(\d+(?:\.\d+)?)/i);
			if (chMatch) latestChapter = parseFloat(chMatch[1]);

			mangas.push({
				id,
				title,
				cover,
				sourceId: this.id,
				status: 'Ongoing',
				type: 'manhua',
				latestChapter,
				lang: this.DEFAULT_LANG
			});
		});

		// fallback: classic Madara / generic
		if (mangas.length === 0) {
			$('.page-item-detail, .c-tabs-item__content, .manga').each((_, el) => {
				const $el = $(el);
				const $a = $el
					.find('a[href*="/manga/"]')
					.filter((_, a) => {
						const h = ($(a).attr('href') || '').split('?')[0];
						return /\/manga\/[^/]+\/?$/.test(h) && !/chapter/i.test(h);
					})
					.first();
				const href = $a.attr('href') || '';
				if (!href) return;
				const id = this.cleanId(href);
				if (!/^\/manga\/[^/]+$/i.test(id) || seen.has(id)) return;
				seen.add(id);

				const $img = $el.find('img').first();
				let title =
					$el.find('.post-title, h3, h5, .title').first().text() ||
					$a.attr('title') ||
					$img.attr('alt') ||
					'';
				title = this.normalizeTitle(title);
				if (!title) return;

				let cover =
					$img.attr('data-src') ||
					$img.attr('data-lazy-src') ||
					$img.attr('src') ||
					'';
				cover = this.absUrl((cover || '').trim().split('?')[0]);

				mangas.push({
					id,
					title,
					cover,
					sourceId: this.id,
					status: 'Ongoing',
					type: 'manhua',
					lang: this.DEFAULT_LANG
				});
			});
		}

		return mangas;
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	private async fetchCatalogPages(
		buildPath: (sitePage: number) => string,
		appPage: number
	): Promise<Manga[]> {
		const p = Math.max(1, Number(appPage) || 1);
		const start = (p - 1) * this.PER_PAGE;
		const siteStart = Math.floor(start / this.SITE_PER_PAGE) + 1;
		const offsetInFirst = start % this.SITE_PER_PAGE;

		const merged: Manga[] = [];
		const seen = new Set<string>();

		for (
			let sp = siteStart;
			sp <= siteStart + 1 && merged.length < offsetInFirst + this.PER_PAGE;
			sp++
		) {
			try {
				const html = await this.fetchHtml(buildPath(sp));
				const list = this.parseCards(cheerio.load(html));
				for (const m of list) {
					if (seen.has(m.id)) continue;
					seen.add(m.id);
					merged.push(m);
				}
				if (list.length === 0) break;
			} catch (e) {
				console.error('[manhuarmtl] catalog page', sp, e);
				break;
			}
		}

		return merged.slice(offsetInFirst, offsetInFirst + this.PER_PAGE);
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const list = await this.fetchCatalogPages((sitePage) => {
				if (sitePage <= 1) return `/manga/?m_orderby=modified`;
				return `/manga/page/${sitePage}/?m_orderby=modified`;
			}, page);

			console.log(`[manhuarmtl] latest appPage=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[manhuarmtl] getLatestManga', e);
			return [];
		}
	}

	async searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page || 1);
		if (!q) return this.getLatestManga(page, opts);

		try {
			const list = await this.fetchCatalogPages((sitePage) => {
				const params = new URLSearchParams({
					s: q,
					post_type: 'wp-manga'
				});
				if (sitePage > 1) params.set('page', String(sitePage));
				return `/?${params.toString()}`;
			}, page);

			console.log(`[manhuarmtl] search "${q}" appPage=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[manhuarmtl] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	private contentItem($: cheerio.CheerioAPI, label: string): string {
		let found = '';
		$('.post-content_item').each((_, el) => {
			const $el = $(el);
			const heading = $el.find('h5, .summary-heading').first().text().trim().toLowerCase();
			if (heading.includes(label.toLowerCase())) {
				found = $el.find('.summary-content').first().text().replace(/\s+/g, ' ').trim();
			}
		});
		return found;
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);

		if (/chapter/i.test(path)) {
			const m = path.match(/^(\/manga\/[^/]+)/i);
			if (m) path = m[1];
		}
		if (!path.startsWith('/manga/')) {
			path = `/manga/${path.replace(/^\//, '')}`;
		}
		path = path.replace(/\/+$/, '');

		const html = await this.fetchHtml(path + '/');
		const $ = cheerio.load(html);

		let title =
			$('h1').first().text().trim() ||
			$('.post-title h1, .post-title h3').first().text().trim() ||
			$('meta[property="og:title"]').attr('content') ||
			path;
		title = this.normalizeTitle(title);

		let cover =
			$('.summary_image img, .tab-summary img, .thumb img')
				.first()
				.attr('data-src') ||
			$('.summary_image img, .tab-summary img').first().attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = this.absUrl((cover || '').trim().split('?')[0]);

		let description =
			$('.description-summary .summary__content, .summary__content, .description-summary')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('meta[name="description"]').attr('content') ||
			'';

		const status = this.mapStatus(this.contentItem($, 'status'));
		const type = this.mapType(this.contentItem($, 'type'));
		const year = (this.contentItem($, 'release') || '').match(/\b(19|20)\d{2}\b/)?.[0] || '';

		const authors = (this.contentItem($, 'author') || $('.author-content').text() || '')
			.split(/[,&]/)
			.map((s) => s.trim())
			.filter((s) => s && s !== '-');
		const artists = (this.contentItem($, 'artist') || $('.artist-content').text() || '')
			.split(/[,&]/)
			.map((s) => s.trim())
			.filter((s) => s && s !== '-');

		// Hanya Tag(s)/Genres dari panel detail — JANGAN ambil semua
		// link /manga-genre/ di page (itu daftar genre site-wide).
		const genres: string[] = [];
		const pushGenre = (t: string) => {
			t = (t || '').trim();
			if (
				!t ||
				t.length > 40 ||
				genres.includes(t) ||
				/^(manhwa|manhua|manga|full color|longstrip|web comic|webtoon|male lead|female lead)$/i.test(
					t
				)
			) {
				return;
			}
			genres.push(t);
		};

		$('.post-content_item').each((_, el) => {
			const $el = $(el);
			const heading = $el
				.find('h5, .summary-heading')
				.first()
				.text()
				.trim()
				.toLowerCase();
			if (!heading.includes('tag') && !heading.includes('genre')) return;
			$el.find('.summary-content a').each((_, a) => pushGenre($(a).text()));
			if (genres.length === 0) {
				const raw = $el.find('.summary-content').first().text();
				for (const part of raw.split(/[,]/)) pushGenre(part);
			}
		});

		if (genres.length === 0) {
			$('.genres-content a, .wp-manga-tags a').each((_, a) =>
				pushGenre($(a).text())
			);
		}

		const rating =
			$('.post-total-rating .score, #averagerate, .numscore').first().text().trim() || '';

		const alt =
			this.contentItem($, 'alternative') ||
			$('.alternative-name, .summary-content .alternative').first().text().trim() ||
			'';

		// Chapters
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('li.wp-manga-chapter, .listing-chapters_wrap li, .wp-manga-chapter').each((_, li) => {
			const $li = $(li);
			const $a = $li.find('a[href*="/manga/"]').first();
			const href = $a.attr('href') || '';
			const id = this.cleanId(href);
			if (seen.has(id) || !/chapter/i.test(id)) return;
			seen.add(id);

			let rawText = $a.text().replace(/\s+/g, ' ').trim();
			const date =
				$li.find('.chapter-release-date, .c-new-tag, i, span').last().text().trim() ||
				$li
					.text()
					.match(
						/\d+\s*(?:hours?|hrs?|days?|weeks?|months?|years?)\s*ago|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s*\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/i
					)?.[0] ||
				'';

			rawText = rawText
				.replace(date, '')
				.replace(/\s*\d+\s*(hours?|hrs?|days?|weeks?|months?|years?)\s*ago.*$/i, '')
				.replace(
					/\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s*\d{4}.*$/i,
					''
				)
				.trim();

			const number = this.parseChapterNumber(rawText || id, id);
			if (!Number.isFinite(number)) return;

			const chapterTitle =
				rawText && /chapter|ch\.?/i.test(rawText)
					? rawText
					: `Chapter ${number}`;

			chapters.push({
				id,
				title: chapterTitle,
				number,
				date: date.trim()
			});
		});

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const latestChapter =
			chapters.length && chapters[0].number != null
				? String(chapters[0].number)
				: undefined;

		const allCreators = [...authors];
		for (const a of artists) {
			if (!allCreators.includes(a)) allCreators.push(a);
		}

		const metaLines = [
			alt && `Alternative: ${alt}`,
			rating && `Rating: ${rating}`,
			authors.length && `Author: ${authors.join(' · ')}`,
			artists.length && `Artist: ${artists.join(' · ')}`,
			year && `Publication: ${year}`,
			chapters[0]?.date && `Updated: ${chapters[0].date}`,
			`Language: English (MTL)`,
			`Type: ${type}`
		].filter(Boolean);

		const fullDescription = [...metaLines, description]
			.filter(Boolean)
			.join('\n');

		console.log(
			`[manhuarmtl] details ${path} → ch=${chapters.length} status=${status} year=${year}`
		);

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			description: fullDescription,
			authors: allCreators,
			genres,
			status,
			chapters,
			type,
			latestChapter
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(
			chapterId.startsWith('/') ? chapterId : `/${chapterId}`
		);

		const maxAttempts = 3;
		let lastErr: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const html = await this.fetchHtml(path.endsWith('/') ? path : path + '/');
				const lower = html.toLowerCase();
				if (
					lower.includes('cf-browser-verification') ||
					lower.includes('just a moment') ||
					(lower.includes('challenge-platform') && html.length < 5000)
				) {
					console.warn(`[manhuarmtl] chapter blocked/CF attempt=${attempt}`, path);
					lastErr = new Error('Manhuarmtl chapter blocked by CF');
					await new Promise((r) => setTimeout(r, 500 * attempt));
					continue;
				}

				const $ = cheerio.load(html);
				const images: string[] = [];
				const seen = new Set<string>();

				const push = (src: string) => {
					src = this.absUrl((src || '').trim().split('?')[0]);
					if (
						!src ||
						seen.has(src) ||
						!/^https?:\/\//i.test(src) ||
						/logo|icon|avatar|spinner|ads|banner|placeholder|gravatar|emoji/i.test(
							src
						) ||
						/\.gif(\?|$)/i.test(src)
					) {
						return;
					}
					seen.add(src);
					images.push(src);
				};

				$(
					'.reading-content img, .page-break img, .wp-manga-chapter-img, #images img, .text-left img'
				).each((_, img) => {
					push(
						$(img).attr('data-src') ||
							$(img).attr('data-lazy-src') ||
							$(img).attr('src') ||
							''
					);
				});

				if (images.length === 0) {
					$('img').each((_, img) => {
						const src =
							$(img).attr('data-src') ||
							$(img).attr('data-lazy-src') ||
							$(img).attr('src') ||
							'';
						if (
							/cdn\.manhuarmtl\.com|\/Chapter_|split_/i.test(src) ||
							/\.(jpg|jpeg|png|webp|avif)(\?|$)/i.test(src)
						) {
							push(src);
						}
					});
				}

				if (images.length === 0) {
					const re = /https?:\/\/cdn\.manhuarmtl\.com\/[^"'\\\s<>]+/gi;
					const found = html.match(re) || [];
					for (const u of found) push(u);
				}

				if (images.length === 0) {
					console.warn(
						`[manhuarmtl] 0 pages attempt=${attempt}`,
						path,
						'htmlLen=',
						html.length
					);
					lastErr = new Error('Manhuarmtl chapter has 0 images');
					await new Promise((r) => setTimeout(r, 400 * attempt));
					continue;
				}

				console.log(`[manhuarmtl] ${images.length} pages → ${path}`);
				return images;
			} catch (e) {
				lastErr = e;
				console.error(`[manhuarmtl] getChapterPages attempt=${attempt}`, path, e);
				if (attempt < maxAttempts) {
					await new Promise((r) => setTimeout(r, 500 * attempt));
				}
			}
		}

		console.error('[manhuarmtl] getChapterPages failed', path, lastErr);
		return [];
	}
}
