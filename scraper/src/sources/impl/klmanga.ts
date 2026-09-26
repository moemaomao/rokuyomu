import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class KlmangaSource extends BaseSource {
	id = 'klmanga';
	name = 'KLManga';
	baseUrl = 'https://klmanga.me';

	private readonly PER_PAGE = 24;

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
		return id.replace(/\/+$/, '');
	}

	private normalizeTitle(raw: string): string {
		if (!raw) return '';
		return raw
			.trim()
			.replace(/\s+/g, ' ')
			.replace(/\s*[-|]\s*KLManga.*$/i, '')
			.trim();
	}

	private extractCover($el: cheerio.Cheerio<any>): string {
		const img =
			$el.find('img.manga-poster-img').attr('data-src') ||
			$el.find('img.manga-poster-img').attr('src') ||
			$el.find('img[data-src]').attr('data-src') ||
			$el.find('img').attr('src') ||
			'';
		return this.absUrl(img);
	}

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const mangas: Manga[] = [];
		const seen = new Set<string>();

		$('.item.flw-item, .item.item-spc.flw-item, .flw-item').each((_, el) => {
			const $el = $(el);
			const a =
				$el.find('a.manga-poster').first() ||
				$el.find('h3.manga-name a').first() ||
				$el.find('a[href*="/raw/"]').first();

			const href = a.attr('href') || '';
			if (!href || !href.includes('/raw/')) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			const rawTitle =
				$el.find('h3.manga-name a').attr('title') ||
				$el.find('h3.manga-name a').text() ||
				$el.find('.manga-name').text() ||
				a.attr('title') ||
				'';
			const title = this.normalizeTitle(rawTitle);
			if (!title) return;

			mangas.push({
				id,
				title,
				cover: this.extractCover($el),
				sourceId: this.id,
				status: 'Ongoing'
			});
		});

		// Fallback
		if (mangas.length === 0) {
			$('a[href*="/raw/"]').each((_, el) => {
				const href = $(el).attr('href') || '';
				const id = this.cleanId(href);
				if (!/\/raw\/[^/]+\/?$/.test(id) || seen.has(id)) return;
				seen.add(id);

				const title = this.normalizeTitle(
					(($(el).attr('title') || $(el).text()) as string).trim()
				);
				if (title) {
					mangas.push({
						id,
						title,
						cover: '',
						sourceId: this.id,
						status: 'Ongoing'
					});
				}
			});
		}

		return mangas;
	}

	// ── List / Search ────────────────────────────────────────────────────────

	async getLatestManga(page: number): Promise<Manga[]> {
		const p = Math.max(1, page | 0);
		const path = p <= 1 ? '/latest-updated/' : `/latest-updated/?p=${p}`;

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);
		const mangas = this.parseCards($);
		return mangas.slice(0, this.PER_PAGE);
	}

	async searchManga(query: string): Promise<Manga[]> {
		const q = encodeURIComponent((query || '').trim());
		if (!q) return [];

		const html = await this.fetchHtml(`/?q=${q}`);
		const $ = cheerio.load(html);
		const mangas = this.parseCards($);
		return mangas.slice(0, this.PER_PAGE);
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const path = this.cleanId(
			mangaId.startsWith('/raw/') ? mangaId : `/raw/${mangaId.replace(/^\//, '')}`
		);
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		// Title
		let title =
			$('.anisc-detail h2.manga-name, h2.manga-name, .manga-name').first().text().trim() ||
			$('meta[property="og:title"]').attr('content') ||
			$('h1').first().text().trim() ||
			path;
		title = this.normalizeTitle(title);

		// Cover
		let cover =
			$('.ani_detail-stage img[data-src], .manga-poster img[data-src], img.manga-poster-img')
				.first()
				.attr('data-src') ||
			$('.ani_detail-stage img, .manga-poster img').first().attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = this.absUrl(cover);

		// Description
		const description =
			$('.description, .description-more, .anisc-detail .description')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() || '';

		// Status (地位)
		let status = 'Ongoing';
		$('.anisc-info .item, .anisc-info-wrap .item').each((_, el) => {
			const $item = $(el);
			const head = $item.find('.item-head').text().toLowerCase();
			if (head.includes('地位') || head.includes('status')) {
				const val = $item.find('.name').text().trim().toLowerCase();
				if (/complete|完|end|finish/.test(val)) status = 'Completed';
			}
		});

		// Genres
		const genres: string[] = [];
		$('.genres a, .anisc-detail .genres a').each((_, a) => {
			const t = $(a).text().trim();
			if (t && !genres.includes(t)) genres.push(t);
		});

		const authors: string[] = [];
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('li.chapter-item, .reading-item.chapter-item, .chapters-list-ul li').each((_, el) => {
			const $li = $(el);
			const $a = $li.find('a.item-link, a[href*="/chapter-"]').first();
			const href = $a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			const dataNumber = $li.attr('data-number') || $a.attr('data-number') || '';
			const chapterTitle =
				$a.find('.name').text().trim() ||
				$a.attr('title') ||
				$a.text().replace(/\s+/g, ' ').trim() ||
				`Chapter ${dataNumber || chapters.length + 1}`;

			const numMatch =
				dataNumber ||
				chapterTitle.match(/(?:第|chap(?:ter)?|ch\.?)\s*(\d+(?:\.\d+)?)/i)?.[1] ||
				'';
			const number = numMatch ? parseFloat(numMatch) : chapters.length + 1;

			chapters.push({
				id,
				title: chapterTitle,
				number,
				date: ''
			});
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
			type: 'manga',
			latestChapter: chapters.length ? chapters[chapters.length - 1].number : undefined
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(
			chapterId.startsWith('/raw/')
				? chapterId
				: `/raw/${chapterId.replace(/^\//, '')}`
		);

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const readingId =
			$('#wrapper').attr('data-reading-id') ||
			$('[data-reading-id]').attr('data-reading-id') ||
			'';

		if (!readingId) {
			const images: string[] = [];
			const seen = new Set<string>();
			$('img.image-vertical, img.lazyload[data-src], .container-reader-chapter img').each(
				(_, img) => {
					const src =
						$(img).attr('data-src') ||
						$(img).attr('data-original') ||
						$(img).attr('src') ||
						'';
					const url = this.absUrl(src);
					if (url && !seen.has(url) && !/logo|icon|avatar|spinner|gif;base64/i.test(url)) {
						seen.add(url);
						images.push(url);
					}
				}
			);
			return images;
		}

		const json = await this.fetchJson<{ status: number; html: string }>(
			`/json/chapter?mode=vertical&id=${readingId}`
		);

		if (!json?.html) return [];

		const $json = cheerio.load(json.html);
		const images: string[] = [];
		const seen = new Set<string>();

		$json('img.image-vertical, img.lazyload, img[data-src]').each((_, img) => {
			const src =
				$json(img).attr('data-src') ||
				$json(img).attr('src') ||
				'';
			const url = this.absUrl(src);
			if (url && !seen.has(url) && !/logo|icon|avatar|spinner|gif;base64|bullion/i.test(url)) {
				seen.add(url);
				images.push(url);
			}
		});

		return images;
	}
}