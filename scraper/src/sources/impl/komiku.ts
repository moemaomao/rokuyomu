/**
 * Komiku (komiku.org) adapter – Manga / Manhwa / Manhua Bahasa Indonesia
 *
 * List   : https://api.komiku.org/manga/  |  /manga/page/{n}/
 * Search : https://api.komiku.org/manga/?s=QUERY
 * Detail : https://komiku.org/manga/{slug}/
 * Chapter: /{slug}-chapter-{n}/
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';


export class KomikuSource extends BaseSource {
	id = 'komiku';
	name = 'Komiku';
	baseUrl = 'https://komiku.org';

	private readonly apiBase = 'https://api.komiku.org';
	private readonly PER_PAGE = 24;
	private readonly LIST_LANG = 'id';

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
		return id.replace(/\/+$/, '').split('?')[0] || '/';
	}

	private normalizeTitle(raw: string): string {
		if (!raw) return '';
		return raw
			.trim()
			.replace(/\s+/g, ' ')
			.replace(/\s*[-|]\s*Komiku.*$/i, '')
			.replace(/^Baca\s+(Komik\s+)?/i, '')
			.replace(/^Komik\s+/i, '')
			.trim();
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath = path.match(/-chapter-(\d+)(?:[.-](\d+))?/i);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null) {
				return parseFloat(`${major}.${fromPath[2]}`);
			}
			return major;
		}

		const m = String(text).match(
			/(?:chapter|chap|ch\.?|episode|ep\.?)\s*(\d+)(?:[.,](\d+))?/i
		);
		if (m) {
			if (m[2] != null) return parseFloat(`${m[1]}.${m[2]}`);
			return parseInt(m[1], 10);
		}

		const d = String(text).match(/\b(\d+)[.-](\d+)\b/);
		if (d) return parseFloat(`${d[1]}.${d[2]}`);

		const n = String(text).match(/\b(\d+(?:\.\d+)?)\b/);
		return n ? parseFloat(n[1]) : 0;
	}

	// ── List cards ───────────────────────────────────────────────────────────

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const mangas: Manga[] = [];
		const seen = new Set<string>();

		$('.bge').each((_, el) => {
			const $el = $(el);

			const a = $el.find('.kan a[href*="/manga/"]').first().length
				? $el.find('.kan a[href*="/manga/"]').first()
				: $el.find('a[href*="/manga/"]').first();

			const href = a.attr('href') || '';
			if (!href || !href.includes('/manga/')) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			const rawTitle =
				$el.find('.kan h3').first().text() ||
				$el.find('h3').text() ||
				a.find('h3').text() ||
				a.text() ||
				a.attr('title') ||
				'';
			const title = this.normalizeTitle(rawTitle);
			if (!title || title.toLowerCase() === 'untitled') return;

			const cover =
				$el.find('.bgei img').attr('src') ||
				$el.find('.bgei img').attr('data-src') ||
				$el.find('img').attr('src') ||
				'';

			const cardText = $el.text().toLowerCase();
			let type: 'manga' | 'manhwa' | 'manhua' = 'manga';
			if (cardText.includes('manhwa')) type = 'manhwa';
			else if (cardText.includes('manhua')) type = 'manhua';

			const badgeText = $el.find('.tpe, .status, span, .tpe1_inf').text().toLowerCase();
			let status = 'Ongoing';
			if (
				/\b(tamat|end|completed|complete)\b/.test(badgeText) &&
				!/\b(ongoing)\b/.test(badgeText)
			) {
				status = 'Completed';
			}

			let latestChapter: number | undefined;
			const newLinks = $el.find('.new1 a[href*="-chapter-"]');
			if (newLinks.length) {
				const $latest = newLinks.last();
				const chHref = $latest.attr('href') || '';
				const chText = $latest.text() || $latest.attr('title') || '';
				const n = this.parseChapterNumber(chText, this.cleanId(chHref));
				if (n > 0) latestChapter = n;
			}
			if (latestChapter == null) {
				const anyCh = $el.find('a[href*="-chapter-"]').last();
				if (anyCh.length) {
					const n = this.parseChapterNumber(
						anyCh.text() || anyCh.attr('title') || '',
						this.cleanId(anyCh.attr('href') || '')
					);
					if (n > 0) latestChapter = n;
				}
			}

			mangas.push({
				id,
				title,
				cover: this.absUrl(cover),
				sourceId: this.id,
				status,
				type,
				latestChapter,
				lang: this.LIST_LANG
			});
		});

		return mangas;
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(page: number): Promise<Manga[]> {
		const mangas: Manga[] = [];
		const seen = new Set<string>();

		const startPage = (page - 1) * 3 + 1;
		const pagesToFetch = [startPage, startPage + 1, startPage + 2];

		for (const p of pagesToFetch) {
			const path =
				p <= 1 ? `${this.apiBase}/manga/` : `${this.apiBase}/manga/page/${p}/`;

			try {
				const html = await this.fetchHtml(path);
				const $ = cheerio.load(html);
				for (const item of this.parseCards($)) {
					if (!seen.has(item.id)) {
						seen.add(item.id);
						mangas.push(item);
					}
				}
			} catch (e) {
				console.error(`[komiku] failed fetch page ${p}:`, e);
			}
		}

		console.log(`[komiku] latest page=${page} → ${mangas.length} items`);
		return mangas.slice(0, this.PER_PAGE);
	}

	async searchManga(query: string): Promise<Manga[]> {
		const q = (query || '').trim();
		if (!q) return [];

		const path = `${this.apiBase}/manga/?s=${encodeURIComponent(q)}`;
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);
		const mangas = this.parseCards($);
		console.log(`[komiku] search "${q}" → ${mangas.length} items`);
		return mangas.slice(0, this.PER_PAGE);
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const path = this.cleanId(
			mangaId.startsWith('/manga/')
				? mangaId
				: `/manga/${mangaId.replace(/^\//, '')}`
		);
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		let title =
			$('h1').first().text().trim() ||
			$('table.inftable td:contains("Judul:")').next().text().trim() ||
			$('meta[property="og:title"]').attr('content') ||
			path;
		title = this.normalizeTitle(title);

		let cover =
			$('.ims img').attr('src') ||
			$('.ims img').attr('data-src') ||
			$('img[itemprop="image"]').attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = this.absUrl(cover);

		let description = '';
		$('h2').each((_, h2) => {
			if ($(h2).text().toLowerCase().includes('sinopsis')) {
				description = $(h2)
					.nextAll('p')
					.first()
					.text()
					.replace(/\s+/g, ' ')
					.trim();
			}
		});
		if (!description) {
			description =
				$('.sinopsis, [itemprop="description"]')
					.first()
					.text()
					.replace(/\s+/g, ' ')
					.trim() || '';
		}

		let status = 'Ongoing';
		$('table.inftable tr').each((_, tr) => {
			const label = $(tr).find('td').first().text().toLowerCase();
			if (label.includes('status')) {
				const val = $(tr).find('td').last().text().trim().toLowerCase();
				if (/complete|tamat|end|finish/.test(val)) status = 'Completed';
			}
		});

		const authors: string[] = [];
		$('table.inftable tr').each((_, tr) => {
			const label = $(tr).find('td').first().text().toLowerCase();
			if (label.includes('author') || label.includes('pengarang')) {
				const val = $(tr).find('td').last().text().trim();
				if (val) authors.push(val);
			}
		});

		const genres: string[] = [];
		$('table.inftable tr').each((_, tr) => {
			const label = $(tr).find('td').first().text().toLowerCase();
			if (label.includes('genre') || label.includes('tema')) {
				$(tr)
					.find('td')
					.last()
					.find('a')
					.each((__, a) => {
						const t = $(a).text().trim();
						if (t && !genres.includes(t)) genres.push(t);
					});
				if (genres.length === 0) {
					const txt = $(tr).find('td').last().text().trim();
					txt.split(/,|\//).forEach((g) => {
						const t = g.trim();
						if (t && !genres.includes(t)) genres.push(t);
					});
				}
			}
		});
		$('.genre a').each((_, a) => {
			const t = $(a).text().trim();
			if (t && !genres.includes(t)) genres.push(t);
		});

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$(
			'#Daftar_Chapter tr, table#Daftar_Chapter tr, .bixbox .listing tr, table.ttingkat tr, #chapter_list li, .daftar-chapter li'
		).each((_, el) => {
			const $el = $(el);
			const $a = $el
				.find(
					'a[href*="-chapter-"], a[href*="chapter"], a[href*="ch-"], a[href*="/ch/"]'
				)
				.first();
			const href = $a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			if (!/-chapter-/i.test(id) && !/chapter/i.test(id)) return;
			seen.add(id);

			const chapterTitle =
				$a.text().replace(/\s+/g, ' ').trim() ||
				$a.attr('title') ||
				`Chapter ${chapters.length + 1}`;

			const number =
				this.parseChapterNumber(chapterTitle, id) || chapters.length + 1;

			const date =
				$el
					.find('.tanggalseries, .date, td:last-child')
					.text()
					.replace(/\s+/g, ' ')
					.trim() || '';

			chapters.push({ id, title: chapterTitle, number, date });
		});

		if (chapters.length === 0) {
			$('a[href*="-chapter-"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const id = this.cleanId(href);
				if (seen.has(id)) return;
				seen.add(id);
				const chapterTitle =
					$(a).text().replace(/\s+/g, ' ').trim() ||
					$(a).attr('title') ||
					'Chapter';
				const number =
					this.parseChapterNumber(chapterTitle, id) || chapters.length + 1;
				chapters.push({ id, title: chapterTitle, number, date: '' });
			});
		}

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
			latestChapter: chapters.length
				? chapters[chapters.length - 1].number
				: undefined
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(
			chapterId.startsWith('/') ? chapterId : `/${chapterId}`
		);
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const images: string[] = [];
		const seen = new Set<string>();

		$(
			'#Baca_Komik img, #readerarea img, .reader img, .img-land img, .post-reading img'
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
				!/logo|icon|avatar|spinner|ads|lazy\.jpg|komikuplus|promo|asset\/img|thumb|placeholder/i.test(
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
					/\.(jpg|jpeg|png|webp)/i.test(src) &&
					!/logo|icon|avatar|spinner|ads|lazy\.jpg|komikuplus|promo|asset\/img|thumb|placeholder/i.test(
						src
					)
				) {
					seen.add(src);
					images.push(src);
				}
			});
		}

		console.log(`[komiku] ${images.length} pages → ${path}`);
		return images;
	}
}
