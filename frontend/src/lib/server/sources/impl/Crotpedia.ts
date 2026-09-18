import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class CrotpediaSource extends BaseSource {
	id = 'crotpedia';
	name = 'CrotPedia';
	baseUrl = 'https://crotpedia.net';

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
		const s = String(text || '');
		const m =
			s.match(/chapter[\s_-]*(\d+(?:\.\d+)?)/i) ||
			s.match(/\bch\.?\s*(\d+(?:\.\d+)?)/i) ||
			s.match(/(\d+(?:\.\d+)?)/);
		return m ? parseFloat(m[1]) : 0;
	}

	private seriesIdFromChapterPath(path: string): string | null {
		const p = this.cleanId(path);
		const m = p.match(/^\/baca\/(.+?)-chapter-[\d.]+/i);
		if (m?.[1]) return `/baca/series/${m[1]}`;
		return null;
	}

	private detectType(text: string): 'manga' | 'manhwa' | 'manhua' {
		const t = (text || '').toLowerCase();
		if (/\bmanhwa\b/.test(t)) return 'manhwa';
		if (/\bmanhua\b/.test(t)) return 'manhua';
		return 'manga';
	}

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		const push = (
			href: string,
			title: string,
			cover: string,
			typeText = '',
			chText = ''
		) => {
			const id = this.cleanId(href);
			if (!/^\/baca\/series\/[^/]+$/.test(id)) return;
			if (seen.has(id)) return;
			seen.add(id);

			title = (title || '').replace(/\s+/g, ' ').trim();
			if (!title) return;

			out.push({
				id,
				sourceId: this.id,
				title,
				cover: this.absUrl((cover || '').split('?')[0]),
				type: this.detectType(typeText),
				status: 'Ongoing',
				latestChapter: this.parseChapterNumber(chText) || undefined,
				lang: this.LIST_LANG
			});
		};

		$('.flexbox4-item').each((_, el) => {
			const $el = $(el);
			const a = $el.find('.title a[href*="/baca/series/"]').first().length
				? $el.find('.title a[href*="/baca/series/"]').first()
				: $el.find('a[href*="/baca/series/"]').first();
			const href = a.attr('href') || '';
			const title =
				a.attr('title') ||
				a.text() ||
				$el.find('img').attr('alt') ||
				'';
			const cover =
				$el.find('img').attr('src') ||
				$el.find('img').attr('data-src') ||
				'';
			const typeText = $el.find('.type').text() || '';
			const chText = $el.find('ul.chapter a').first().text() || '';
			push(href, title, cover, typeText, chText);
		});

		if (!out.length) {
			$('a[href*="/baca/series/"]').each((_, el) => {
				const $a = $(el);
				const href = $a.attr('href') || '';
				const title = ($a.attr('title') || $a.text() || '')
					.replace(/\s+/g, ' ')
					.trim();
				if (!title || title.length < 2) return;
				const $parent = $a.closest(
					'.flexbox4-item, .flexbox-item, article, li, div'
				);
				const cover =
					$parent.find('img').attr('src') ||
					$parent.find('img').attr('data-src') ||
					$a.find('img').attr('src') ||
					'';
				push(href, title, cover);
			});
		}

		return out;
	}

	private async fetchListPage(path: string): Promise<Manga[]> {
		try {
			const html = await this.fetchHtml(path);
			if (!html || html.length < 500) {
				console.warn('[crotpedia] empty html', path);
				return [];
			}
			const $ = cheerio.load(html);
			const list = this.parseCards($);
			console.log(`[crotpedia] ${path} → ${list.length} items`);
			return list;
		} catch (e) {
			console.warn('[crotpedia] fetchListPage failed', path, e);
			return [];
		}
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const seen = new Set<string>();
			const merged: Manga[] = [];

			const startSite = p;
			let sitePage = startSite;

			while (merged.length < this.PER_PAGE && sitePage < startSite + 3) {
				const path = sitePage <= 1 ? `/` : `/page/${sitePage}/`;
				const batch = await this.fetchListPage(path);
				if (!batch.length) break;

				for (const m of batch) {
					if (seen.has(m.id)) continue;
					seen.add(m.id);
					merged.push(m);
					if (merged.length >= this.PER_PAGE) break;
				}

				if (batch.length === 0) break;
				sitePage++;
			}

			const list = merged.slice(0, this.PER_PAGE);
			console.log(`[crotpedia] latest page=${p} → ${list.length} items`);
			return list;
		} catch (e) {
			console.error('[crotpedia] getLatestManga', e);
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
			const list = (await this.fetchListPage(path)).slice(0, this.PER_PAGE);
			console.log(`[crotpedia] search "${q}" → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[crotpedia] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);

		if (!/^\/baca\/series\//i.test(path)) {
			const series = this.seriesIdFromChapterPath(path);
			if (series) path = series;
		}

		if (!/^\/baca\/series\/[^/]+$/i.test(path)) {
			throw new Error(`Invalid crotpedia id: ${mangaId}`);
		}

		const html = await this.fetchHtml(path + '/');
		const $ = cheerio.load(html);

		let title =
			$('.series-title, .entry-title, h1.title, h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content') ||
			path;
		title = title
			.replace(/\s*[-|].*CrotPedia.*$/i, '')
			.replace(/\s+/g, ' ')
			.trim();

		let cover =
			$('.series-thumb img, .flexbox4-thumb img, .thumb img').first().attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		if (/crotpedia-project|logo/i.test(cover)) {
			cover =
				$('.series-thumb img, .thumb img').first().attr('src') || cover;
		}
		cover = this.absUrl((cover || '').split('?')[0]);

		const meta: Record<string, string> = {};
		$('li').each((_, el) => {
			const $el = $(el);
			const label = $el
				.find('b')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim()
				.toLowerCase();
			const value = $el
				.find('span')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			if (label && value) meta[label] = value;
		});

		const alt = meta['alternative'] || meta['alternatives'] || '';

		const authors: string[] = [];
		const authorRaw = meta['author'] || meta['authors'] || meta['artist'] || '';
		authorRaw
			.split(/,|\//)
			.map((s) => s.trim())
			.filter(Boolean)
			.forEach((n) => {
				if (!authors.includes(n)) authors.push(n);
			});

		let status = 'Ongoing';
		const statusHint =
			$('.series-infoz, .status, .type').text() +
			' ' +
			$('body').text().slice(0, 1500);
		if (/complete|finished|end/i.test(statusHint)) status = 'Completed';
		else if (/ongoing/i.test(statusHint)) status = 'Ongoing';

		let rating = $('.series-infoz.score span')
			.first()
			.text()
			.replace(/\s+/g, ' ')
			.trim();
		if (!rating || !/\d/.test(rating)) {
			rating = $('.series-infoz.score')
				.first()
				.text()
				.replace(/[^\d.]/g, '')
				.trim();
		}

		const genres: string[] = [];
		$('a[href*="/baca/genre/"]').each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (
				g &&
				g.length < 40 &&
				!genres.includes(g) &&
				!/^genre list$/i.test(g)
			) {
				genres.push(g);
			}
		});

		let synopsis = '';
		$('p').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (
				t.length > 40 &&
				!synopsis &&
				!/chapter list|comment|subscribe/i.test(t)
			) {
				synopsis = t;
			}
		});

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		$('a[href*="/baca/"]').each((_, a) => {
			const $a = $(a);
			const href = $a.attr('href') || '';
			if (!/chapter/i.test(href)) return;
			if (/\/series\//i.test(href)) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			const text = $a.text().replace(/\s+/g, ' ').trim();
			const number =
				this.parseChapterNumber(href) || this.parseChapterNumber(text);
			if (!number && !/chapter/i.test(text)) return;

			let date = '';
			const dateEl = $a.find('.date').text().trim();
			if (dateEl) date = dateEl;
			else {
				const parentText = $a.parent().text().replace(/\s+/g, ' ').trim();
				const dm = parentText.match(
					/(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}/i
				);
				if (dm) date = dm[0];
			}

			chapters.push({
				id,
				title: text || `Chapter ${number}`,
				number: number || 0,
				date
			});
		});

		chapters.sort((a, b) => (a.number || 0) - (b.number || 0));

		const latestChapter = chapters[chapters.length - 1]?.number;
		const typeText = $('.type').first().text() || '';

		const description = [
			alt && `Alternative: ${alt}`,
			authors.length && `Author(s): ${authors.join(', ')}`,
			rating && `Rating: ${rating}`,
			latestChapter != null && `Latest chapter: ${latestChapter}`,
			synopsis
		]
			.filter(Boolean)
			.join('\n\n');

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			type: this.detectType(typeText),
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
		if (!/\/baca\//i.test(path) || /\/series\//i.test(path)) {
			console.error('[crotpedia] not a chapter path:', chapterId);
			return [];
		}

		try {
			const html = await this.fetchHtml(path + '/');
			const $ = cheerio.load(html);
			const urls: string[] = [];
			const seen = new Set<string>();

			const pick = (src: string) => {
				if (!src || src.startsWith('data:')) return;
				src = this.absUrl(src.split('?')[0]);
				if (!/^https?:\/\//i.test(src)) return;
				if (
					/logo|icon|avatar|donasi|gravatar|banner|wp-content\/uploads\/2021/i.test(
						src
					)
				)
					return;
				if (/cover\.eromanga|resize=\d+/i.test(src) && !/reader\./i.test(src))
					return;
				if (seen.has(src)) return;
				seen.add(src);
				urls.push(src);
			};

			$('.entry-content img, #readerarea img, .reader-area img, article img').each(
				(_, img) => {
					const $img = $(img);
					pick($img.attr('src') || $img.attr('data-src') || '');
				}
			);

			const readerOnly = urls.filter((u) => /reader\.eromanga\.cfd/i.test(u));
			const finalUrls = readerOnly.length ? readerOnly : urls;

			console.log(`[crotpedia] ${finalUrls.length} pages → ${path}`);
			return finalUrls;
		} catch (e) {
			console.error('[crotpedia] getChapterPages failed', path, e);
			return [];
		}
	}
}
