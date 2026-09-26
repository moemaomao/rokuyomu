/**
 * mangaindo.best adapter (MangaThemesia)
 *
 * List   : /home/  |  /home/page/{n}/
 * Search : /?s=QUERY
 * Detail : /manga/{slug}/
 * Chapter: /{slug}-chapter-{n}/
 *
 * ID format:
 *   manga   : "/manga/{slug}"
 *   chapter : "/{slug}-chapter-{n}"
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class MangaindoSource extends BaseSource {
	id = 'mangaindo';
	name = 'Mangaindo';
	baseUrl = 'https://mangaindo.best';

	private readonly PER_PAGE = 24;

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

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath = path.match(/-chapter-(\d+)(?:[.-](\d+))?/i);
		if (fromPath) {
			if (fromPath[2] != null) return parseFloat(`${fromPath[1]}.${fromPath[2]}`);
			return parseInt(fromPath[1], 10);
		}
		const m = String(text).match(
			/(?:chapter|chap|ch\.?|episode|ep\.?)\s*(\d+)(?:[.,](\d+))?/i
		);
		if (m) {
			if (m[2] != null) return parseFloat(`${m[1]}.${m[2]}`);
			return parseInt(m[1], 10);
		}
		const n = String(text).match(/\b(\d+(?:\.\d+)?)\b/);
		return n ? parseFloat(n[1]) : NaN;
	}

	private imgSrc($el: cheerio.Cheerio<any>): string {
		return (
			$el.attr('data-src') ||
			$el.attr('data-lazy-src') ||
			$el.attr('data-original') ||
			$el.attr('src') ||
			''
		);
	}

	// ── List ─────────────────────────────────────────────────────────────────

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		$('.listupd .bsx, .bs .bsx, .bsx').each((_, el) => {
			const $el = $(el);
			const a = $el.find('a[href*="/manga/"]').first();
			const href = a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (!/^\/manga\/[^/]+$/.test(id)) return;
			if (seen.has(id)) return;
			seen.add(id);

			let title =
				a.attr('title') ||
				$el.find('.tt').first().text() ||
				a.text() ||
				'';
			title = title
				.replace(/\s+/g, ' ')
				.replace(/\s*(Chapter|Ch\.?)\s*\d+.*$/i, '')
				.trim();
			if (!title || title.length < 2) return;

			let cover = this.imgSrc($el.find('img').first());
			cover = this.absUrl((cover || '').split('?')[0]);

			const chText = $el.find('.epxs, .lsch, a[href*="-chapter-"]').first().text() || '';
			const chNum = this.parseChapterNumber(chText);
			const latestChapter = Number.isFinite(chNum) ? chNum : undefined;

			let status = 'Ongoing';
			const st = $el.find('.status, .stts').text().toLowerCase();
			if (/complete|selesai|tamat|end/.test(st)) status = 'Completed';

			// <span class="type Manhwa"></span>
			let type = 'manga';
			const typeClass =
				$el.find('span.type').attr('class') ||
				$el.find('[class*="type"]').first().attr('class') ||
				'';
			if (/\bmanhwa\b/i.test(typeClass)) type = 'manhwa';
			else if (/\bmanhua\b/i.test(typeClass)) type = 'manhua';
			else if (/\bmanga\b/i.test(typeClass)) type = 'manga';

			out.push({
				id,
				sourceId: this.id,
				title,
				cover,
				type,
				status,
				latestChapter
			});
		});

		return out;
	}

				async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			// Site 20/page → ambil 2 page, gabung jadi 24
			const start = (p - 1) * 2 + 1;
			const pagesToFetch = [start, start + 1];

			const seen = new Set<string>();
			const mangas: Manga[] = [];

			for (const pg of pagesToFetch) {
				// WAJIB query ?page= — path /manga/page/N/ tidak beda isinya
				const path =
					pg <= 1
						? `/manga/?order=update`
						: `/manga/?order=update&page=${pg}`;

				try {
					const html = await this.fetchHtml(path);
					const $ = cheerio.load(html);
					for (const item of this.parseCards($)) {
						if (seen.has(item.id)) continue;
						seen.add(item.id);
						mangas.push(item);
					}
				} catch (e) {
					console.error(`[mangaindo] fetch page ${pg}`, e);
				}
			}

			console.log(`[mangaindo] latest page=${p} → ${mangas.length} items`);
			return mangas.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[mangaindo] getLatestManga', e);
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
				page <= 1
					? `/?s=${encodeURIComponent(q)}`
					: `/page/${page}/?s=${encodeURIComponent(q)}`;
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list = this.parseCards($);
			console.log(`[mangaindo] search "${q}" → ${list.length} items`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[mangaindo] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);
		if (!path.startsWith('/manga/')) {
			path = `/manga/${path.replace(/^\//, '')}`;
		}

		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const title =
			$('h1.entry-title, h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content')?.replace(/\s*[-|].*$/, '').trim() ||
			'Unknown';

		let cover =
			this.imgSrc($('.thumb img, .seriestucontl img, img.wp-post-image').first()) ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = this.absUrl((cover || '').split('?')[0]);

		const alt =
			$('.seriestualt').first().text().replace(/\s+/g, ' ').trim() || '';

		let status = 'Ongoing';
		let type = 'manga';
		const authors: string[] = [];

		$('table tr, .infotable tr, .wd-full').each((_, row) => {
			const $row = $(row);
			const label = $row.find('td, th, b, .title').first().text().toLowerCase();
			const val = $row.find('td').last().text().replace(/\s+/g, ' ').trim();
			const full = $row.text().replace(/\s+/g, ' ').trim();

			if (/status/i.test(label) || /^status\b/i.test(full)) {
				if (/complete|selesai|tamat|end|finished/i.test(val || full)) status = 'Completed';
				else if (/hiatus/i.test(val || full)) status = 'Hiatus';
				else if (/ongoing|berjalan/i.test(val || full)) status = 'Ongoing';
			}
			if (/type|jenis/i.test(label) || /\btype\b/i.test(full)) {
				if (/manhwa/i.test(val || full)) type = 'manhwa';
				else if (/manhua/i.test(val || full)) type = 'manhua';
				else if (/manga/i.test(val || full)) type = 'manga';
			}
			if (/author|pengarang|artist|ilustrator/i.test(label)) {
				const names = val
					.split(/,|&/)
					.map((s) => s.trim())
					.filter(Boolean);
				for (const n of names) {
					if (n && !authors.includes(n)) authors.push(n);
				}
			}
		});

		const bodyText = $('article, .seriestucontent, .main-info').text();
		if (type === 'manga') {
			if (/\bManhwa\b/.test(bodyText)) type = 'manhwa';
			else if (/\bManhua\b/.test(bodyText)) type = 'manhua';
		}

		const genres: string[] = [];
		$('.seriestugenre a, .genre-info a, a[rel="tag"]').each((_, a) => {
			const g = $(a).text().trim();
			if (g && !genres.includes(g) && g.length < 40) genres.push(g);
		});

		const rating =
			$('.numscore').first().text().replace(/\s+/g, ' ').trim() ||
			$('[itemprop="ratingValue"]').text().trim() ||
			'';

		const synopsis =
			$('.entry-content[itemprop="description"], .entry-content, .seriestucontd p')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('meta[name="description"]').attr('content')?.trim() ||
			'';

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('#chapterlist li, .eplister li, .clstyle li').each((_, li) => {
			const $li = $(li);
			const a = $li.find('a[href*="-chapter-"]').first();
			const href = a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			const dataNum = $li.attr('data-num');
			let number = dataNum != null && dataNum !== '' ? parseFloat(dataNum) : NaN;

			const chTitle =
				a.find('.chapternum').text().replace(/\s+/g, ' ').trim() ||
				a.attr('title') ||
				a.text().replace(/\s+/g, ' ').trim() ||
				'Chapter';

			if (!Number.isFinite(number)) {
				number = this.parseChapterNumber(chTitle, id);
			}
			if (!Number.isFinite(number) || number < 0) {
				number = chapters.length + 1;
			}

			const date =
				a.find('.chapterdate').text().replace(/\s+/g, ' ').trim() ||
				$li.find('.chapterdate').text().trim() ||
				'';

			chapters.push({
				id,
				title: /chapter/i.test(chTitle) ? chTitle : `Chapter ${number}`,
				number,
				date
			});
		});

		// Newest first
		chapters.sort((a, b) => (b.number ?? -1) - (a.number ?? -1));

		const latestUpdate = chapters[0]?.date || '';
		const latestChapter = chapters[0]?.number;

		const description = [
			alt && `Alternative: ${alt}`,
			rating && `Rating: ${rating}`,
			latestUpdate && `Latest update: ${latestUpdate}`,
			latestChapter != null && `Latest chapter: ${latestChapter}`,
			synopsis
		]
			.filter(Boolean)
			.join('\n\n');

		return {
			id: path.replace(/\/+$/, ''),
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

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		if (!/-chapter-/i.test(path)) {
			console.error('[mangaindo] getChapterPages → not a chapter path:', chapterId);
			return [];
		}

		try {
			const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
			const $ = cheerio.load(html);
			const urls: string[] = [];
			const seen = new Set<string>();

			for (const sel of [
				'#readerarea img',
				'.readerarea img',
				'#readerarea img.alignnone',
				'.entry-content img',
				'img[src*="b-cdn.net"]',
				'img[src*="/ch-"]'
			]) {
				$(sel).each((_, img) => {
					let src = this.imgSrc($(img));
					if (!src || src.startsWith('data:')) return;
					src = this.absUrl(src.split('?')[0]);
					if (!/^https?:\/\//i.test(src)) return;
					if (
						/logo|icon|avatar|ads|banner|spinner|placeholder|emoji|wp-content\/themes/i.test(
							src
						)
					) {
						return;
					}
					if (seen.has(src)) return;
					seen.add(src);
					urls.push(src);
				});
				if (urls.length > 3) break;
			}

			console.log(`[mangaindo] ${urls.length} pages → ${path}`);
			return urls;
		} catch (e) {
			console.error('[mangaindo] getChapterPages', path, e);
			return [];
		}
	}
 }
