/**
 * KS Group Scans adapter (https://ksgroupscans.com)
 *
 * Theme: WordPress Madara (MangaBooth)
 * Home     : /home-site/  (redirect from /)
 * Latest   : /manga/?m_orderby=latest  |  /manga/page/{n}/?m_orderby=latest
 * Search   : /?s={q}&post_type=wp-manga
 * Detail   : /manga/{slug}/
 * Chapters : POST /manga/{slug}/ajax/chapters/?t=1
 * Chapter  : /manga/{slug}/chapter-{n}/
 * Pages    : .reading-content img / .wp-manga-chapter-img
 *
 * ID format:
 *   manga   : /manga/{slug}
 *   chapter : /manga/{slug}/chapter-{n}
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class KSGroupScansSource extends BaseSource {
	id = 'ksgroupscans';
	name = 'KS Group Scans';
	baseUrl = 'https://ksgroupscans.com';

	private readonly PER_PAGE = 24;
	private readonly SITE_PER_PAGE = 12;
	private readonly DEFAULT_LANG = 'en';

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
			.replace(/\s*[-|–]\s*KS\s*(Group\s*)?Scans.*$/i, '')
			.trim();
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath =
			path.match(/\/chapter-(\d+)(?:[.-](\d+))?/i) ||
			path.match(/\/ch-(\d+)(?:-(\d+))?/i);
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

	private mapStatus(raw: string): string {
		const s = String(raw || '').toLowerCase();
		if (/complete|end|finished/.test(s)) return 'Completed';
		if (/hiatus/.test(s)) return 'Hiatus';
		if (/drop|cancel/.test(s)) return 'Dropped';
		return 'Ongoing';
	}

	private preferFullCover(url: string): string {
		if (!url) return '';
		return url.replace(/-\d+x\d+(\.\w+)(\?.*)?$/, '$1$2');
	}

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		$('.page-item-detail').each((_, card) => {
			const $card = $(card);
			const $a = $card
				.find(
					'h3 a[href*="/manga/"], h5 a[href*="/manga/"], a[href*="/manga/"]'
				)
				.filter((_, el) => {
					const h = ($(el).attr('href') || '').split('?')[0];
					return /\/manga\/[^/]+\/?$/.test(h);
				})
				.first();

			const href = $a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (seen.has(id) || /\/manga\/(page|genre|tag)/i.test(id)) return;
			seen.add(id);

			const title = this.normalizeTitle(
				$a.attr('title') || $a.text() || $card.find('img').attr('alt') || ''
			);
			if (!title) return;

			const $img = $card.find('img').first();
			let cover =
				$img.attr('data-src') ||
				$img.attr('data-lazy-src') ||
				$img.attr('src') ||
				'';
			if (cover.startsWith('data:')) cover = '';
			cover = this.preferFullCover(this.absUrl(cover));

			let latestChapter: string | undefined;
			const chText = $card
				.find(
					'.chapter-item a, .list-chapter a, .font-meta.chapter a, .chapter a'
				)
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			if (chText) {
				const n = this.parseChapterNumber(chText);
				if (n > 0) latestChapter = String(n);
			}

			const typeText = $card.text().toLowerCase();
			let type = 'manga';
			if (/\bmanhwa\b/.test(typeText)) type = 'manhwa';
			else if (/\bmanhua\b/.test(typeText)) type = 'manhua';

			res.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type,
				status: 'Ongoing',
				latestChapter,
				lang: this.DEFAULT_LANG
			});
		});

		return res;
	}

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
			sp <= siteStart + 3 && merged.length < offsetInFirst + this.PER_PAGE;
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
				console.error('[ksgroupscans] catalog page', sp, e);
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
				if (sitePage <= 1) return `/manga/?m_orderby=latest`;
				return `/manga/page/${sitePage}/?m_orderby=latest`;
			}, page);

			console.log(`[ksgroupscans] latest page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[ksgroupscans] getLatestManga', e);
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
			const params = new URLSearchParams({ s: q, post_type: 'wp-manga' });
			if (page > 1) params.set('page', String(page));
			const html = await this.fetchHtml(`/?${params.toString()}`);
			const list = this.parseCards(cheerio.load(html));
			console.log(`[ksgroupscans] search "${q}" page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[ksgroupscans] searchManga', e);
			return [];
		}
	}

	private async fetchChaptersAjax(mangaPath: string): Promise<Chapter[]> {
		const base = mangaPath.endsWith('/') ? mangaPath : `${mangaPath}/`;
		const url = `${this.baseUrl}${base}ajax/chapters/?t=1`;

		const response = await fetch(url, {
			method: 'POST',
			headers: {
				...this.headers,
				Referer: `${this.baseUrl}${base}`,
				Origin: this.baseUrl,
				'X-Requested-With': 'XMLHttpRequest',
				'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
			},
			body: ''
		});

		if (!response.ok) {
			console.error('[ksgroupscans] chapters ajax', response.status, url);
			return [];
		}

		const html = await response.text();
		const $ = cheerio.load(html);
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('li.wp-manga-chapter').each((_, li) => {
			const $li = $(li);
			const $a = $li.find('a').first();
			const href = $a.attr('href') || '';
			if (!href || href.startsWith('javascript')) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			const rawText = $a.text().replace(/\s+/g, ' ').trim();
			const date =
				$li.find('.chapter-release-date').text().replace(/\s+/g, ' ').trim() ||
				$li.find('span i, time').text().replace(/\s+/g, ' ').trim() ||
				'';

			const number = this.parseChapterNumber(rawText || id, id);
			if (!Number.isFinite(number)) return;

			chapters.push({
				id,
				title: rawText || `Chapter ${number}`,
				number,
				date: date || undefined
			});
		});

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));
		return chapters;
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);

		if (/\/chapter/i.test(path) && path.includes('/manga/')) {
			const m = path.match(/(\/manga\/[^/]+)/i);
			if (m) path = m[1];
		}
		if (!path.startsWith('/manga/')) {
			path = `/manga/${path.replace(/^\//, '')}`;
		}

		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const title = this.normalizeTitle(
			$('h1').first().text() ||
				$('meta[property="og:title"]').attr('content') ||
				''
		);

		let cover =
			$('.summary_image img').first().attr('data-src') ||
			$('.summary_image img').first().attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = this.preferFullCover(this.absUrl(cover));

		const description =
			$('.description-summary .summary__content, .summary__content')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() || '';

		const genres: string[] = [];
		$('.genres-content a').each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (
				g &&
				g.length < 40 &&
				!/^(manga|manhwa|manhua)$/i.test(g) &&
				!genres.includes(g)
			) {
				genres.push(g);
			}
		});

		const authors: string[] = [];
		$('.author-content a, .artist-content a').each((_, a) => {
			const t = $(a).text().replace(/\s+/g, ' ').trim();
			if (t && !authors.includes(t)) authors.push(t);
		});

		let status = 'Ongoing';
		$('.post-status').each((_, el) => {
			const t = $(el).text();
			if (/status/i.test(t)) status = this.mapStatus(t);
		});

		let type = 'manga';
		const typeText = $('.post-content_item, .summary-content').text();
		if (/\bmanhwa\b/i.test(typeText)) type = 'manhwa';
		else if (/\bmanhua\b/i.test(typeText)) type = 'manhua';

		const chapters = await this.fetchChaptersAjax(path);
		const latestChapter =
			chapters.length > 0 ? String(chapters[0].number) : undefined;

		console.log(
			`[ksgroupscans] details ${path} → ch=${chapters.length} status=${status}`
		);

		return {
			id: path,
			sourceId: this.id,
			title: title || path.split('/').filter(Boolean).pop() || path,
			cover,
			type,
			status,
			description,
			authors,
			genres,
			chapters,
			latestChapter,
			lang: this.DEFAULT_LANG
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		try {
			const path = this.cleanId(chapterId);
			const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
			const $ = cheerio.load(html);

			const pages: string[] = [];
			const seen = new Set<string>();

			const push = (src?: string | null) => {
				if (!src || src.startsWith('data:')) return;
				const url = this.absUrl(src.split(/\s+/)[0].split('?')[0]);
				if (!url || seen.has(url)) return;
				if (/logo|icon|avatar|emoji|spinner|loading/i.test(url)) return;
				seen.add(url);
				pages.push(url);
			};

			$('.reading-content img, .page-break img, .wp-manga-chapter-img').each(
				(_, img) => {
					const $img = $(img);
					push(
						$img.attr('data-src') ||
							$img.attr('data-lazy-src') ||
							$img.attr('src')
					);
				}
			);

			if (pages.length === 0) {
				const re =
					/(https?:\/\/[^"'\\\s]+\/wp-content\/uploads\/[^"'\\\s]+\.(?:webp|jpg|jpeg|png|avif))/gi;
				let m: RegExpExecArray | null;
				while ((m = re.exec(html)) !== null) push(m[1]);
			}

			console.log(
				`[ksgroupscans] getChapterPages ${path} → ${pages.length} pages`
			);
			return pages;
		} catch (e) {
			console.error('[ksgroupscans] getChapterPages', e);
			return [];
		}
	}
}
