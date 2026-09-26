/**
 * Maid - Manga Indonesia (www.maid.my.id)
 *
 * Latest  : /  |  /page/{n}/   → hanya .flexbox4-item (Latest Update)
 * Search  : /?s=
 * Detail  : /manga/{slug}/
 * Chapter : /{slug}-chapter-{n}-bahasa-indonesia/
 * Pages   : .reader-area img[data-lazy-src] → cdn.imgchest.com
 *
 * ID format:
 *   manga   : /manga/{slug}
 *   chapter : /{slug}-chapter-{n}-bahasa-indonesia
 *
 * Bahasa: Indonesian
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class MaidSource extends BaseSource {
	id = 'maid';
	name = 'Maid';
	baseUrl = 'https://www.maid.my.id';

	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'id';

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

	private imgSrc($el: cheerio.Cheerio<any>): string {
		return (
			$el.attr('data-lazy-src') ||
			$el.attr('data-src') ||
			$el.attr('data-original') ||
			$el.attr('src') ||
			''
		);
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath = String(path).match(
			/-chapter-(\d+(?:\.\d+)?)(?:-bahasa-indonesia)?/i
		);
		if (fromPath) {
			const n = parseFloat(fromPath[1]);
			if (Number.isFinite(n)) return n;
		}
		const m = String(text).match(
			/(?:chapter|chap|ch\.?|episode|ep\.?)\s*(\d+(?:\.\d+)?)/i
		);
		if (m) return parseFloat(m[1]);
		const n = String(text).match(/\b(\d+(?:\.\d+)?)\b/);
		return n ? parseFloat(n[1]) : NaN;
	}

	private mapStatus(raw?: string | null): string {
		const s = String(raw || '').toLowerCase();
		if (/\b(completed|complete|tamat|selesai|end)\b/.test(s)) return 'Completed';
		if (/\bhiatus\b/.test(s)) return 'Hiatus';
		return 'Ongoing';
	}

	private mapType(raw?: string | null): string {
		const t = String(raw || '').toLowerCase();
		if (t.includes('manhwa')) return 'manhwa';
		if (t.includes('manhua')) return 'manhua';
		if (t.includes('doujin')) return 'manga';
		if (t.includes('manga')) return 'manga';
		return 'manga';
	}

	private parseLatestCards($: cheerio.CheerioAPI): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		$('.flexbox4-item').each((_, el) => {
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
				$el.find('.title a, .title').first().text() ||
				'';
			title = title.replace(/\s+/g, ' ').trim();
			if (!title) return;

			let cover = this.imgSrc($el.find('img').first());
			if (cover.startsWith('data:')) cover = '';
			cover = this.absUrl((cover || '').split('?')[0]);

			const chText =
				$el.find('.chapter-link, ul.chapter a, .chapter-item a').first().text() ||
				'';
			const chNum = this.parseChapterNumber(chText);
			const latestChapter =
				Number.isFinite(chNum) && chNum >= 0 ? chNum : undefined;

			const type = this.mapType(
				$el.find('span.type').text() || $el.find('span.type').attr('class') || ''
			);

			out.push({
				id,
				sourceId: this.id,
				title,
				cover,
				type,
				status: 'Ongoing',
				latestChapter,
				lang: this.DEFAULT_LANG
			});
		});

		return out;
	}

	private parseSearchCards($: cheerio.CheerioAPI): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		const $cards = $('.flexbox2-item, .flexbox3-item, .flexbox4-item, article');
		$cards.each((_, el) => {
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
				$el.find('.title a, .title, h2, h3').first().text() ||
				'';
			title = title.replace(/\s+/g, ' ').trim();
			if (!title) return;

			let cover = this.imgSrc($el.find('img').first());
			if (cover.startsWith('data:')) cover = '';
			cover = this.absUrl((cover || '').split('?')[0]);

			const chText =
				$el.find('.chapter-link, ul.chapter a').first().text() || '';
			const chNum = this.parseChapterNumber(chText);

			const type = this.mapType(
				$el.find('span.type').text() || $el.find('span.type').attr('class') || ''
			);

			out.push({
				id,
				sourceId: this.id,
				title,
				cover,
				type,
				status: 'Ongoing',
				latestChapter: Number.isFinite(chNum) ? chNum : undefined,
				lang: this.DEFAULT_LANG
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
			const path = p <= 1 ? '/' : `/page/${p}/`;
			console.log(`[maid] latest p${p} → ${path}`);
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list = this.parseLatestCards($);
			console.log(`[maid] ${list.length} manga (latest only)`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[maid] getLatestManga', e);
			return [];
		}
	}

	async searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		if (!q) return this.getLatestManga(opts?.page || 1, opts);

		try {
			const page = Math.max(1, opts?.page || 1);
			const path =
				page <= 1
					? `/?s=${encodeURIComponent(q)}`
					: `/page/${page}/?s=${encodeURIComponent(q)}`;
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list = this.parseSearchCards($).slice(0, this.PER_PAGE);
			console.log(`[maid] search "${q}" → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[maid] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);
		if (!path.startsWith('/manga/')) {
			path = `/manga/${path.replace(/^\//, '')}`;
		}

		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		let title =
			$('.series-title h2, .series-titlex h2, h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content')?.replace(/\s*Bahasa Indonesia.*$/i, '').replace(/\s*[-|].*$/, '').trim() ||
			'Unknown';

		let cover =
			this.imgSrc($('.series-thumb img, .thumb img, img.wp-post-image').first()) ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		if (cover.startsWith('data:')) cover = '';
		cover = this.absUrl((cover || '').split('?')[0]);

		const status = this.mapStatus($('.series-infoz .status, span.status').first().text());
		const type = this.mapType($('.series-infoz .type, span.type').first().text());

		const authors: string[] = [];
		$('.series-infolist li, .series-infolist tr').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			const m = t.match(/Author\s*(.+)$/i);
			if (m) {
				for (const part of m[1].split(/,|&/)) {
					const n = part.trim();
					if (n && n !== '?' && !authors.includes(n)) authors.push(n);
				}
			}
		});

		let year = '';
		$('.series-infolist li, .series-infolist tr').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			const m = t.match(/Published\s*(\d{4})/i);
			if (m) year = m[1];
		});

		const genres: string[] = [];
		$('.series-genres a').each((_, a) => {
			const g = $(a).text().trim();
			if (g && !genres.includes(g) && g.length < 40) genres.push(g);
		});

		const rating =
			$('.series-infoz.score [itemprop="ratingValue"], .score').first().text().replace(/\s+/g, ' ').trim() ||
			'';

		const synopsis =
			$('.series-synops').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[name="description"]').attr('content')?.trim() ||
			'';

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('.series-chapterlist li').each((_, li) => {
			const $li = $(li);
			const a = $li.find('a[href*="-chapter-"]').first();
			const href = a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (seen.has(id) || !/-chapter-/i.test(id)) return;
			seen.add(id);

			const date = $li.find('.date, span.date').first().text().replace(/\s+/g, ' ').trim();
			const rawTitle = a.attr('title') || a.text() || '';
			const number = this.parseChapterNumber(rawTitle, id);
			const num = Number.isFinite(number) ? number : chapters.length + 1;

			chapters.push({
				id,
				title: `Chapter ${num}`,
				number: num,
				date
			});
		});

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const latestChapter =
			chapters.length && chapters[0].number != null
				? String(chapters[0].number)
				: undefined;

		const metaLines = [
			rating && `Rating: ${rating}`,
			authors.length && `Author: ${authors.join(' · ')}`,
			year && `Year: ${year}`,
			`Language: Indonesian`,
			`Type: ${type}`
		].filter(Boolean);

		console.log(`[maid] details ${path} → ch=${chapters.length}`);

		return {
			id: path.replace(/\/+$/, ''),
			sourceId: this.id,
			title,
			cover,
			type,
			status,
			description: [...metaLines, synopsis].filter(Boolean).join('\n'),
			authors,
			genres,
			chapters,
			latestChapter
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		if (!/-chapter-/i.test(path)) {
			console.error('[maid] getChapterPages bad id:', chapterId);
			return [];
		}

		const maxAttempts = 3;
		let lastErr: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const html = await this.fetchHtml(
					path.endsWith('/') ? path : `${path}/`
				);
				const $ = cheerio.load(html);
				const urls: string[] = [];
				const seen = new Set<string>();

				const push = (src: string) => {
					src = (src || '').trim();
					if (!src || src.startsWith('data:')) return;
					src = this.absUrl(src.split('?')[0]);
					if (!/^https?:\/\//i.test(src)) return;
					if (
						/logo|icon|avatar|ads|banner|spinner|placeholder|youtube|trakteer|wp-rocket/i.test(
							src
						)
					) {
						return;
					}
					if (seen.has(src)) return;
					seen.add(src);
					urls.push(src);
				};

				$('.reader-area img, #readerarea img, .content img').each((_, img) => {
					push(this.imgSrc($(img)));
				});

				if (urls.length === 0) {
					const found =
						html.match(/https:\/\/cdn\.imgchest\.com\/[^"'\\\s<>]+/gi) || [];
					for (const u of found) push(u);
				}

				if (urls.length > 0) {
					console.log(`[maid] ${urls.length} pages → ${path}`);
					return urls;
				}

				lastErr = new Error('0 images');
				console.warn(`[maid] 0 pages attempt=${attempt}`, path);
				await new Promise((r) => setTimeout(r, 400 * attempt));
			} catch (e) {
				lastErr = e;
				console.error(`[maid] getChapterPages attempt=${attempt}`, path, e);
				if (attempt < maxAttempts) {
					await new Promise((r) => setTimeout(r, 500 * attempt));
				}
			}
		}

		console.error('[maid] getChapterPages failed', path, lastErr);
		return [];
	}
}