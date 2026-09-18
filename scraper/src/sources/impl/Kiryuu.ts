import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class KiryuuSource extends BaseSource {
	id = 'kiryuu';
	name = 'Kiryuu';
	baseUrl = 'https://v7.kiryuu.to';

	private readonly PER_PAGE = 24;
	private readonly LIST_LANG = 'id';

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
		return id.replace(/\/+$/, '').split('?')[0] || '/';
	}

	private normalizeTitle(raw: string): string {
		if (!raw) return '';
		return raw
			.trim()
			.replace(/\s+/g, ' ')
			.replace(/\s*[-|]\s*Kiryuu.*$/i, '')
			.replace(/\s*Bahasa Indonesia.*$/i, '')
			.replace(/^Baca\s+/i, '')
			.trim();
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath = path.match(/\/chapter-(\d+)(?:[.-](\d+))?/i);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null && fromPath[2].length <= 2) {
				return parseFloat(`${major}.${fromPath[2]}`);
			}
			return major;
		}
		const m = String(text).match(
			/(?:chapter|chap|ch\.?)\s*(\d+)(?:[.,](\d+))?/i
		);
		if (m) {
			if (m[2] != null) return parseFloat(`${m[1]}.${m[2]}`);
			return parseInt(m[1], 10);
		}
		const n = String(text).match(/\b(\d+(?:\.\d+)?)\b/);
		return n ? parseFloat(n[1]) : 0;
	}

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const mangas: Manga[] = [];
		const seen = new Set<string>();

		let $cards = $('#search-results > div');
		if ($cards.length === 0) {
			$cards = $('div').filter((_, el) => {
				const $el = $(el);
				return (
					$el.find('a[href*="/manga/"]').length > 0 &&
					$el.find('a[href*="/chapter-"]').length > 0 &&
					$el.find('h1, h2, h3').length > 0
				);
			});
		}

		$cards.each((_, card) => {
			const $card = $(card);

			const $mangaLink = $card
				.find('a[href*="/manga/"]')
				.filter((_, a) => {
					const h = ($(a).attr('href') || '').split('?')[0];
					return /\/manga\/[^/]+\/?$/.test(h);
				})
				.first();

			const href = $mangaLink.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			let title =
				$card.find('h1, h2, h3').first().text() ||
				$mangaLink.attr('title') ||
				$card.find('img.wp-post-image, img').first().attr('alt') ||
				'';
			title = this.normalizeTitle(title);
			if (!title) {
				const slug = id.split('/').filter(Boolean).pop() || '';
				title = slug
					.split('-')
					.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
					.join(' ');
			}
			if (!title) return;

			let cover =
				$card.find('img.wp-post-image').attr('src') ||
				$card.find('img[src*="uploads"]').attr('src') ||
				$card.find('img').first().attr('src') ||
				'';
			cover = this.absUrl(cover);

			const typeAlt = (
				$card
					.find('img[alt="manhwa"], img[alt="manhua"], img[alt="manga"]')
					.attr('alt') || ''
			).toLowerCase();
			let type: 'manga' | 'manhwa' | 'manhua' = 'manga';
			if (typeAlt === 'manhwa') type = 'manhwa';
			else if (typeAlt === 'manhua') type = 'manhua';

			const cardText = $card.text().toLowerCase();
			let status = 'Ongoing';
			if (/\b(tamat|completed|end|finish)\b/i.test(cardText)) {
				status = 'Completed';
			}

			let latestChapter: number | undefined;
			const chText =
				$card.find('a[href*="/chapter-"] p, a[href*="/chapter-"]').first().text() ||
				'';
			const chMatch = chText.match(/(\d+(?:\.\d+)?)/);
			if (chMatch) {
				latestChapter = parseFloat(chMatch[1]);
			}

			mangas.push({
				id,
				title,
				cover,
				sourceId: this.id,
				status,
				type,
				latestChapter,
				lang: this.LIST_LANG
			});
		});

		return mangas;
	}

	async getLatestManga(page: number): Promise<Manga[]> {
		try {
			const url =
				page <= 1
					? `${this.baseUrl}/project/`
					: `${this.baseUrl}/project/?the_page=${page}`;
			console.log(`[kiryuu] project p${page} → ${url}`);
			const html = await this.fetchHtml(url);
			const $ = cheerio.load(html);
			const list = this.parseCards($);
			console.log(
				`[kiryuu] ${list.length} manga, ch:`,
				list[0]?.latestChapter,
				list[0]?.title
			);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[kiryuu] getLatestManga:', e);
			return [];
		}
	}

	async searchManga(query: string): Promise<Manga[]> {
		const q = (query || '').trim();
		if (!q) return [];
		const path = `${this.baseUrl}/?s=${encodeURIComponent(q)}`;
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);
		return this.parseCards($).slice(0, this.PER_PAGE);
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const path = this.cleanId(
			mangaId.startsWith('/') ? mangaId : `/${mangaId.replace(/^\//, '')}`
		);
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		let title =
			$('h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content') ||
			path;
		title = this.normalizeTitle(title);

		let cover =
			$('.thumb img, .imentry img, img.wp-post-image').attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			$('img').first().attr('src') ||
			'';
		cover = this.absUrl(cover);

		let description =
			$('.entry-content p, .desc, .summary, [itemprop="description"]')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('meta[name="description"]').attr('content') ||
			'';

		let status = 'Ongoing';
		const bodyText = $('body').text().toLowerCase();
		if (/\b(tamat|completed|end|finish)\b/.test(bodyText)) {
			status = 'Completed';
		}

		const authors: string[] = [];
		$('a[href*="/writer/"], a[href*="/author/"]').each((_, a) => {
			const t = $(a).text().trim();
			if (t && !authors.includes(t)) authors.push(t);
		});

		const genres: string[] = [];
		$('a[href*="/genres/"], a[href*="/genre/"]').each((_, a) => {
			const t = $(a).text().trim();
			if (t && !genres.includes(t) && t.length < 30) genres.push(t);
		});

		let type: 'manga' | 'manhwa' | 'manhua' = 'manga';
		if (/\bmanhwa\b/i.test(bodyText)) type = 'manhwa';
		else if (/\bmanhua\b/i.test(bodyText)) type = 'manhua';

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('a[href*="/chapter-"]').each((_, a) => {
			const $a = $(a);
			const href = $a.attr('href') || '';
			const id = this.cleanId(href);
			if (seen.has(id) || !id.includes('/chapter-')) return;
			seen.add(id);

			let rawText = $a.text().replace(/\s+/g, ' ').trim();

			const chapterTitle =
				rawText
					.replace(
						/\s*\d+\s*(hours?|hrs?|days?|weeks?|months?|years?|jam|hari|minggu|bulan|tahun)\s*ago.*$/i,
						''
					)
					.replace(/\s*\d{1,2}\/\d{1,2}\/\d{2,4}.*$/, '')
					.trim() || `Chapter ${chapters.length + 1}`;

			const number =
				this.parseChapterNumber(chapterTitle, id) || chapters.length + 1;

			const date =
				$a.parent().find('span, time').not($a).last().text().trim() ||
				$a.closest('li, div').find('span, time').last().text().trim() ||
				'';

			chapters.push({ id, title: chapterTitle, number, date });
		});

		chapters.sort((a, b) => a.number - b.number);

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			description,
			authors,
			genres,
			status,
			chapters,
			type,
			latestChapter: chapters.length
				? chapters[chapters.length - 1].number
				: undefined
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(
			chapterId.startsWith('/') ? chapterId : `/${chapterId}`
		);
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const images: string[] = [];
		const seen = new Set<string>();

		$(
			'#readerarea img, .readerarea img, .rdminimal img, #chapter_images img, .chapter-image img'
		).each((_, img) => {
			let src =
				$(img).attr('data-src') ||
				$(img).attr('data-lazy-src') ||
				$(img).attr('src') ||
				'';
			src = this.absUrl(src);
			if (
				src &&
				!seen.has(src) &&
				!/logo|icon|avatar|spinner|ads|banner|gif|placeholder|wp-content\/uploads\/202[0-9]\/(0[5-9]|1[0-2])\/.*\.(gif|png)/i.test(
					src
				)
			) {
				seen.add(src);
				images.push(src);
			}
		});

		if (images.length === 0) {
			$('img').each((_, img) => {
				let src = $(img).attr('data-src') || $(img).attr('src') || '';
				src = this.absUrl(src);
				if (
					src &&
					!seen.has(src) &&
					(/cdn\.uqni\.net|\/users\//i.test(src) ||
						/\.(jpg|jpeg|png|webp)/i.test(src)) &&
					!/logo|icon|avatar|spinner|ads|banner|gif|placeholder/i.test(src)
				) {
					seen.add(src);
					images.push(src);
				}
			});
		}

		return images;
	}
}
