import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class KomikindoSource extends BaseSource {
	id = 'komikindo';
	name = 'Komikindo';
	baseUrl = 'https://komikindo.ch';
	badge = 'ID';

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
		return id.replace(/\/+$/, '') || '/';
	}

	private parseChapterNumber(text: string): number {
		const m = String(text).match(
			/(?:chapter|chap|ch\.?|episode|ep\.?)\s*(\d+(?:\.\d+)?)/i
		);
		if (m) return parseFloat(m[1]);
		const n = String(text).match(/(\d+(?:\.\d+)?)/);
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

	private speValue($: cheerio.CheerioAPI, label: RegExp): string {
		let found = '';
		$('.infox .spe span, .spe span').each((_, el) => {
			const raw = $(el).text().replace(/\s+/g, ' ').trim();
			const m = raw.match(label);
			if (m) {
				found = (m[1] || '').replace(/\s+/g, ' ').trim();
				return false;
			}
		});
		return found;
	}

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		$('.listupd .animepost, .animepost, .bs .bsx').each((_, el) => {
			const $el = $(el);
			const a = $el.find('a[href*="/komik/"]').first();
			const href = a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (!/^\/komik\/[^/]+$/.test(id)) return;
			if (seen.has(id)) return;
			seen.add(id);

			let title =
				a.attr('title') ||
				$el.find('.tt, .title, h2, h3, h4').first().text() ||
				a.text() ||
				'';
			title = title
				.replace(/\s+/g, ' ')
				.replace(/^Komik\s+/i, '')
				.replace(/\s*(Chapter|Ch\.?)\s*\d+.*$/i, '')
				.trim();
			if (!title || title.length < 2) return;

			let cover = this.imgSrc($el.find('img').first());
			cover = this.absUrl((cover || '').split('?')[0]);

			const chText =
				$el.find('.lsch a, .lchapter, .epxs, a[href*="-chapter-"]').first().text() ||
				'';
			const chNum = this.parseChapterNumber(chText);
			const latestChapter =
				Number.isFinite(chNum) && chNum >= 0 ? chNum : undefined;

			let status = 'Ongoing';
			const statusTxt = $el.find('.status, .manga-status, .stts').text().toLowerCase();
			if (/complete|selesai|tamat|end/.test(statusTxt)) status = 'Completed';

			let type = 'manga';
			const flagClass =
				$el.find('.typeflag').attr('class') ||
				$el.find('[class*="typeflag"]').attr('class') ||
				'';
			if (/\bmanhwa\b/i.test(flagClass)) type = 'manhwa';
			else if (/\bmanhua\b/i.test(flagClass)) type = 'manhua';
			else if (/\bmanga\b/i.test(flagClass)) type = 'manga';
			else {
				const t = ($el.text() + ' ' + href).toLowerCase();
				if (t.includes('manhwa')) type = 'manhwa';
				else if (t.includes('manhua')) type = 'manhua';
			}

			out.push({
				id,
				sourceId: this.id,
				title,
				cover,
				type,
				status,
				latestChapter,
				lang: this.LIST_LANG
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
			const path = p <= 1 ? `/komik-terbaru/` : `/komik-terbaru/page/${p}/`;
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list = this.parseCards($);
			console.log(`[komikindo] latest page=${p} → ${list.length} items`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[komikindo] getLatestManga', e);
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
			console.log(`[komikindo] search "${q}" → ${list.length} items`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[komikindo] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);
		if (!path.startsWith('/komik/')) {
			path = `/komik/${path.replace(/^\//, '')}`;
		}

		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const title =
			$('.infox h1, .entry-title, h1.entry-title, h1')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.replace(/^Komik\s+/i, '')
				.trim() ||
			$('meta[property="og:title"]')
				.attr('content')
				?.replace(/\s*[-|].*$/, '')
				.trim() ||
			'Unknown';

		let cover =
			this.imgSrc($('.thumb img, .ime img, img.wp-post-image').first()) ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = this.absUrl((cover || '').split('?')[0]);

		const statusRaw = this.speValue($, /Status:\s*(.+)$/i);
		let status = 'Ongoing';
		if (/selesai|complete|tamat|end|finished/i.test(statusRaw)) status = 'Completed';
		else if (/hiatus/i.test(statusRaw)) status = 'Hiatus';
		else if (/berjalan|ongoing/i.test(statusRaw)) status = 'Ongoing';

		const typeRaw = this.speValue($, /Jenis Komik:\s*(.+)$/i);
		let type = 'manga';
		if (/manhwa/i.test(typeRaw)) type = 'manhwa';
		else if (/manhua/i.test(typeRaw)) type = 'manhua';
		else if (/manga/i.test(typeRaw)) type = 'manga';

		const authors: string[] = [];
		const pengarang = this.speValue($, /Pengarang:\s*(.+)$/i);
		const ilustrator = this.speValue($, /Ilustrator:\s*(.+)$/i);
		for (const name of [pengarang, ilustrator]) {
			if (!name) continue;
			for (const part of name.split(/,|&/)) {
				const n = part.trim();
				if (n && !authors.includes(n)) authors.push(n);
			}
		}

		const alt = this.speValue($, /Judul Alternatif:\s*(.+)$/i);

		const genres: string[] = [];
		$('.genre-info a, .genxed a, a[rel="tag"]').each((_, a) => {
			const g = $(a).text().trim();
			if (g && !genres.includes(g) && g.length < 40) genres.push(g);
		});

		const rating =
			$('[itemprop="ratingValue"]').first().text().replace(/\s+/g, ' ').trim() ||
			$('.ratingmanga [itemprop="ratingValue"]').text().trim() ||
			'';

		const synopsis =
			$('.desc .entry-content, .desc, .sinopsis')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('meta[name="description"]').attr('content')?.trim() ||
			'';

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('#chapter_list li, .listeps li, .bxcl li').each((_, li) => {
			const $li = $(li);
			const a = $li.find('a[href*="-chapter-"]').first();
			const href = a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			let chTitle =
				a.attr('title') || a.find('chapter').text() || a.text() || '';
			chTitle = chTitle
				.replace(/\s+/g, ' ')
				.replace(/^Komik\s+/i, '')
				.trim();

			const date =
				$li
					.find('.dt a, .dt, .chapterdate')
					.first()
					.text()
					.replace(/\s+/g, ' ')
					.trim() || '';

			const fromPath = id.match(/-chapter-(\d+(?:\.\d+)?)/i);
			let number = fromPath ? parseFloat(fromPath[1]) : NaN;
			if (!Number.isFinite(number)) {
				number = this.parseChapterNumber(chTitle);
			}
			if (!Number.isFinite(number) || number < 0) {
				number = chapters.length + 1;
			}

			chapters.push({
				id,
				title: /chapter/i.test(chTitle) ? chTitle : `Chapter ${number}`,
				number,
				date
			});
		});

		chapters.sort((a, b) => {
			const na = a.number ?? -1;
			const nb = b.number ?? -1;
			return nb - na;
		});

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

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		if (!/-chapter-/i.test(path)) {
			console.error('[komikindo] getChapterPages → not a chapter path:', chapterId);
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
				'.img-landmine img',
				'#chimg img',
				'img[src*="/data/"]'
			]) {
				$(sel).each((_, img) => {
					let src = this.imgSrc($(img));
					if (!src || src.startsWith('data:')) return;
					src = this.absUrl(src.split('?')[0]);
					if (!/^https?:\/\//i.test(src)) return;
					if (
						/logo|icon|avatar|ads|banner|spinner|placeholder|fav\.|wp-content\/uploads\/2020/i.test(
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

			console.log(`[komikindo] ${urls.length} pages → ${path}`);
			return urls;
		} catch (e) {
			console.error('[komikindo] getChapterPages', path, e);
			return [];
		}
	}
}
