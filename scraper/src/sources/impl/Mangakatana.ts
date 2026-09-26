/**
 * mangakatana.com adapter
 *
 * Latest : /latest | /latest/page/{n}
 * Search : /?search=QUERY&search_by=m_name
 * Detail : /manga/{slug}.{id}
 * Chapter: /manga/{slug}.{id}/c{num}
 * Pages  : var thzq=[...]
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class MangaKatanaSource extends BaseSource {
	id = 'mangakatana';
	name = 'MangaKatana';
	baseUrl = 'https://mangakatana.com';

	private readonly PER_PAGE = 24;
	private readonly SITE_PER_PAGE = 20;
	private readonly LIST_LANG = 'en';

	// ── Helpers ──────────────────────────────────────────────────────────────

	private absUrl(url: string): string {
		if (!url) return '';
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
		return id.replace(/\/+$/, '') || '/';
	}

	private parseChapterNumber(text: string): number {
		const s = String(text || '');
		const fromPath = s.match(/\/c(\d+(?:\.\d+)?)(?:\/|$)/i);
		if (fromPath) return parseFloat(fromPath[1]);
		const m = s.match(/(?:chapter|chap|ch\.?)\s*(\d+(?:\.\d+)?)/i);
		if (m) return parseFloat(m[1]);
		const n = s.match(/(\d+(?:\.\d+)?)/);
		return n ? parseFloat(n[1]) : 0;
	}

	private detectType(genres: string[] | string): 'manga' | 'manhwa' | 'manhua' {
		const g = (
			Array.isArray(genres) ? genres.join(' ') : String(genres || '')
		).toLowerCase();
		if (/\bmanhwa\b/.test(g)) return 'manhwa';
		if (/\bmanhua\b/.test(g)) return 'manhua';
		if (/\bwebtoon\b/.test(g)) return 'manhwa';
		return 'manga';
	}

	// ── List ─────────────────────────────────────────────────────────────────

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		$('#book_list .item[data-id]').each((i, el) => {
			const $el = $(el);

			let href = '';
			$el.find('a[href*="/manga/"]').each((_, link) => {
				const h = $(link).attr('href') || '';
				if (!h) return;
				if (/\/c[\d.]+/i.test(h) || /\/fc/i.test(h)) return;
				if (!href) href = h;
			});

			if (!href) {
				if (i === 0)
					console.warn(
						'[mangakatana] item0 no href',
						$el.html()?.slice(0, 200)
					);
				return;
			}

			const id = this.cleanId(href);

			if (!id.startsWith('/manga/')) return;
			if (id.split('/').length !== 3) return;
			if (seen.has(id)) return;
			seen.add(id);

			let title =
				$el.find('h3.title a').first().text() ||
				$el.find('h3.title').first().text() ||
				$el.find('.title a').first().text() ||
				'';
			title = title.replace(/\s+/g, ' ').trim();
			title = title
				.replace(/\s*-\s*Update chapter\s+\d+(?:\.\d+)?\s*$/i, '')
				.trim();
			if (!title) {
				if (i === 0)
					console.warn('[mangakatana] item0 no title', { href, id });
				return;
			}

			const cover =
				$el.find('picture source[type="image/webp"]').attr('srcset') ||
				$el.find('picture source').attr('srcset') ||
				$el.find('img').attr('src') ||
				$el.find('img').attr('data-src') ||
				'';

			const statusText = $el.find('.status').text();
			const status = /complete|finished|end/i.test(statusText)
				? 'Completed'
				: 'Ongoing';
			const chText = $el.find('.last_chap a, h3.title span').text() || '';
			const genreText = $el.find('.genres').text() || '';

			out.push({
				id,
				sourceId: this.id,
				title,
				cover: this.absUrl((cover || '').split('?')[0]),
				type: this.detectType(genreText),
				status,
				latestChapter: this.parseChapterNumber(chText) || undefined,
				lang: this.LIST_LANG
			});
		});

		return out;
	}

	private async fetchListPage(path: string): Promise<Manga[]> {
		try {
			const html = await this.fetchHtml(path);
			console.log(`[mangakatana] GET ${path} → html=${html?.length ?? 0}`);

			if (!html || html.length < 500) return [];
			if (/just a moment|cf-browser-verification|challenge-platform/i.test(html)) {
				console.error('[mangakatana] Cloudflare', path);
				return [];
			}

			const $ = cheerio.load(html);
			const hasList = $('#book_list').length > 0;
			const rawItems = $('#book_list .item[data-id]').length;
			const list = this.parseCards($);

			console.log(
				`[mangakatana] ${path} book_list=${hasList} rawItems=${rawItems} parsed=${list.length}`,
				list.slice(0, 3).map((m) => m.title)
			);
			return list;
		} catch (e) {
			console.warn('[mangakatana] fetch error', path, e);
			return [];
		}
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const start = (p - 1) * this.PER_PAGE;
			const startSite = Math.floor(start / this.SITE_PER_PAGE) + 1;
			const endSite =
				Math.floor((start + this.PER_PAGE - 1) / this.SITE_PER_PAGE) + 1;

			const seen = new Set<string>();
			const merged: Manga[] = [];

			for (let sp = startSite; sp <= endSite; sp++) {
				const path = sp <= 1 ? '/latest' : `/latest/page/${sp}`;
				let batch = await this.fetchListPage(path);

				if (!batch.length && sp > 1) {
					batch = await this.fetchListPage(`/page/${sp}`);
				}
				if (!batch.length && sp <= 1) {
					batch = await this.fetchListPage('/page/1');
				}

				for (const m of batch) {
					if (seen.has(m.id)) continue;
					seen.add(m.id);
					merged.push(m);
				}
			}

			const offset = start % this.SITE_PER_PAGE;
			const list = merged.slice(offset, offset + this.PER_PAGE);

			console.log(
				`[mangakatana] latest page=${p} sites=${startSite}-${endSite} → ${list.length} items`
			);
			return list;
		} catch (e) {
			console.error('[mangakatana] getLatestManga', e);
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
			const path =
				`/?search=${encodeURIComponent(q)}&search_by=m_name` +
				(page > 1 ? `&page=${page}` : '');
			const list = await this.fetchListPage(path);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[mangakatana] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const path = this.cleanId(mangaId);
		if (!/\/manga\//i.test(path)) {
			throw new Error(`Invalid mangakatana id: ${mangaId}`);
		}

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		let title =
			$('h1.heading, h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content') ||
			$('title').text().split('|')[0] ||
			path;
		title = title.replace(/\s*[-|].*MangaKatana.*$/i, '').trim();

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('.cover img, .media img, picture source').attr('srcset') ||
			$('.cover img, .media img').attr('src') ||
			'';
		cover = this.absUrl((cover || '').split('?')[0]);

		const meta: Record<string, string> = {};
		$('li.d-row-small, .d-row-small').each((_, el) => {
			const $el = $(el);
			const label = $el
				.find('.d-cell-small.label, .label')
				.first()
				.text()
				.replace(/:\s*$/, '')
				.trim()
				.toLowerCase();
			const value = $el
				.find('.d-cell-small.value, .value')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			if (label) meta[label] = value;
		});

		const alt =
			meta['alt name(s)'] ||
			meta['alt name'] ||
			$('.alt_name').text().replace(/\s+/g, ' ').trim() ||
			'';

		let status = 'Ongoing';
		const statusRaw = (meta['status'] || $('.value.status').text() || '').toLowerCase();
		if (/complete|finished|end/.test(statusRaw)) status = 'Completed';
		else if (/ongoing|publishing/.test(statusRaw)) status = 'Ongoing';

		const latestChapterLabel =
			meta['latest chapter(s)'] || meta['latest chapter'] || '';
		const updateAt =
			meta['update at'] || meta['updated'] || meta['last update'] || '';

		let rating = '';
		const ratingKeys = Object.keys(meta).filter((k) =>
			/rating|score|rate/.test(k)
		);
		if (ratingKeys.length) rating = meta[ratingKeys[0]];
		if (!rating) {
			const starText =
				$('.uk-rating, .rating, [class*="star"], [data-score]')
					.first()
					.attr('data-score') ||
				$('.uk-rating, .rating, [class*="score"]').first().text().trim();
			if (starText && /\d/.test(starText)) rating = starText.replace(/\s+/g, ' ');
		}
		if (!rating) {
			const ld = html.match(
				/"aggregateRating"\s*:\s*\{[^}]*"ratingValue"\s*:\s*"?([\d.]+)"?/i
			);
			if (ld) rating = ld[1];
		}

		const authors: string[] = [];
		$('a.author, a[href*="/author/"]').each((_, a) => {
			const n = $(a).text().trim();
			if (n && !authors.includes(n)) authors.push(n);
		});
		if (!authors.length && meta['author(s) / artist(s)']) {
			meta['author(s) / artist(s)']
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
				.forEach((n) => {
					if (!authors.includes(n)) authors.push(n);
				});
		}

		const genres: string[] = [];
		$('li.d-row-small .genres a, .d-row-small .value .genres a').each((_, a) => {
			const g = $(a).text().trim();
			if (g && !genres.includes(g) && g.length < 40) genres.push(g);
		});
		if (!genres.length) {
			$('.d-cell-small.value a[href*="/genre/"]').each((_, a) => {
				const g = $(a).text().trim();
				if (g && !genres.includes(g) && g.length < 40) genres.push(g);
			});
		}

		const type = this.detectType(genres);

		const synopsis =
			$('.summary p, .summary, #summary, .desc')
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('meta[name="description"]').attr('content') ||
			'';

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('.chapters a[href*="/manga/"][href*="/c"]').each((_, a) => {
			const $a = $(a);
			const href = $a.attr('href') || '';
			if (!href) return;
			if (!/\/c[\d.]+/i.test(href)) return;
			if (/\/fc$/i.test(href)) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			const chTitle =
				$a.text().replace(/\s+/g, ' ').trim() ||
				`Chapter ${this.parseChapterNumber(id)}`;

			const numberFromId = this.parseChapterNumber(id);
			const numberFromTitle = this.parseChapterNumber(chTitle);
			const number = numberFromId || numberFromTitle || 0;

			const date =
				$a
					.closest('tr, li, div')
					.find('.update_time, .date, time')
					.text()
					.trim() || '';

			chapters.push({
				id,
				title: chTitle,
				number,
				date
			});
		});

		chapters.sort((a, b) => (a.number || 0) - (b.number || 0));

		const latestChapter =
			this.parseChapterNumber(latestChapterLabel) ||
			chapters[chapters.length - 1]?.number;
		const latestUpdate =
			updateAt || chapters[chapters.length - 1]?.date || '';

		const description = [
			alt && `Alternative: ${alt}`,
			latestUpdate && `Latest update: ${latestUpdate}`,
			latestChapter != null && `Latest chapter: ${latestChapter}`,
			rating && `Rating: ${rating}`,
			synopsis
		]
			.filter(Boolean)
			.join('\n\n');

		console.log(
			`[mangakatana] details ${path} → type=${type}, chapters=${chapters.length}, genres=${genres.join(',')}`
		);

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			type,
			status,
			description,
			authors,
			genres,
			chapters,
			latestChapter
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		if (!/\/c[\d.]+/i.test(path)) {
			console.error(
				'[mangakatana] getChapterPages → not a chapter path:',
				chapterId
			);
			return [];
		}

		try {
			const html = await this.fetchHtml(path);
			const urls: string[] = [];
			const seen = new Set<string>();

			const thzqMatch = html.match(/var\s+thzq\s*=\s*\[([\s\S]*?)\];/);
			if (thzqMatch) {
				const re = /['"](https?:\/\/[^'"]+)['"]/g;
				let m: RegExpExecArray | null;
				while ((m = re.exec(thzqMatch[1])) !== null) {
					const u = m[1].replace(/\\u0026/g, '&');
					if (seen.has(u)) continue;
					seen.add(u);
					urls.push(u);
				}
			}

			if (!urls.length) {
				const ytaw = html.match(/var\s+ytaw\s*=\s*\[([\s\S]*?)\];/);
				if (ytaw) {
					const re = /['"](https?:\/\/[^'"]+)['"]/g;
					let m: RegExpExecArray | null;
					while ((m = re.exec(ytaw[1])) !== null) {
						const u = m[1];
						if (seen.has(u)) continue;
						seen.add(u);
						urls.push(u);
					}
				}
			}

			if (!urls.length) {
				const $ = cheerio.load(html);
				$('img[data-src], img[src]').each((_, img) => {
					let src = $(img).attr('data-src') || $(img).attr('src') || '';
					if (!src || src === '#' || src.startsWith('data:')) return;
					src = this.absUrl(src);
					if (!/^https?:\/\//i.test(src)) return;
					if (/logo|icon|avatar|static\/img/i.test(src)) return;
					if (seen.has(src)) return;
					seen.add(src);
					urls.push(src);
				});
			}

			console.log(`[mangakatana] ${urls.length} pages → ${path}`);
			return urls;
		} catch (e) {
			console.error('[mangakatana] getChapterPages failed', path, e);
			return [];
		}
	}
}
