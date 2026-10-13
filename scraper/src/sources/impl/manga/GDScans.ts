/**
 * GD Scans adapter (https://gdscans.com)
 * Theme: WordPress Madara → extends MadaraSource
 *
 * Latest  : /manga/?m_orderby=latest  |  /manga/page/{n}/?m_orderby=latest
 * Search  : /?s={q}&post_type=wp-manga
 * Detail  : /manga/{slug}/
 * Chapters: POST /manga/{slug}/ajax/chapters/?t=1
 * Chapter : /manga/{slug}/volume-{v}/ch-{n}/
 * Pages   : .reading-content img / .wp-manga-chapter-img
 */

import * as cheerio from 'cheerio';
import { MadaraSource } from '../../family/MadaraSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';

export class GDScansSource extends MadaraSource {
	id = 'gdscans';
	name = 'GD Scans';
	baseUrl = 'https://gdscans.com';

	protected seriesPath = '/manga';
	protected defaultLang = 'en';
	protected perPage = 24;
	/** Site lists ~10 items per HTML page */
	private readonly SITE_PER_PAGE = 10;

	protected listPath(page: number): string {
		if (page <= 1) return `/manga/?m_orderby=latest`;
		return `/manga/page/${page}/?m_orderby=latest`;
	}

	protected searchPath(query: string, page: number): string {
		const params = new URLSearchParams({ s: query, post_type: 'wp-manga' });
		if (page > 1) params.set('page', String(page));
		return `/?${params.toString()}`;
	}

	/** GD uses /ch-N in path */
	protected parseChapterNumber(text: string, path = ''): number {
		const fromPath =
			path.match(/\/ch-(\d+)(?:-(\d+))?/i) ||
			path.match(/\/chapter-(\d+)(?:[.-](\d+))?/i);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null && fromPath[2].length <= 2) {
				return parseFloat(`${major}.${fromPath[2]}`);
			}
			return major;
		}
		return super.parseChapterNumber(text, path);
	}

	protected normalizeTitle(raw: string): string {
		return super.normalizeTitle(raw, 'GD Scans').replace(/\s*GD\s*Scans.*$/i, '').trim();
	}

	/** Merge several site pages (10/item) to fill ~perPage */
	private async fetchCatalogPages(
		buildPath: (sitePage: number) => string,
		appPage: number
	): Promise<Manga[]> {
		const p = Math.max(1, Number(appPage) || 1);
		const start = (p - 1) * this.perPage;
		const siteStart = Math.floor(start / this.SITE_PER_PAGE) + 1;
		const offsetInFirst = start % this.SITE_PER_PAGE;

		const merged: Manga[] = [];
		const seen = new Set<string>();

		for (
			let sp = siteStart;
			sp <= siteStart + 3 && merged.length < offsetInFirst + this.perPage;
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
				console.error('[gdscans] catalog page', sp, e);
				break;
			}
		}

		return merged.slice(offsetInFirst, offsetInFirst + this.perPage);
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const list = await this.fetchCatalogPages((sitePage) => this.listPath(sitePage), page);
			console.log(`[gdscans] latest page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[gdscans] getLatestManga', e);
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
			const html = await this.fetchHtml(this.searchPath(q, page));
			const list = this.parseCards(cheerio.load(html));
			console.log(`[gdscans] search "${q}" page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[gdscans] searchManga', e);
			return [];
		}
	}

	/** POST ajax chapters (Madara default GET is not enough here) */
	protected async fetchChaptersAjax(mangaPath: string): Promise<Chapter[]> {
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
			console.error('[gdscans] chapters ajax', response.status, url);
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

		if (/\/(volume|ch|chapter)/i.test(path) && path.includes('/manga/')) {
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
			if (g && g.length < 40 && !/^(manga|manhwa|manhua)$/i.test(g) && !genres.includes(g)) {
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

		console.log(`[gdscans] details ${path} → ch=${chapters.length} status=${status}`);

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
			lang: this.defaultLang
		};
	}

	// getChapterPages → pakai implementasi MadaraSource (selector sama)
}
