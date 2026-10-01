/**
 * Lazy Girl Translations — Themesia novel TL
 * https://lazygirltranslations.com/
 *
 * Latest: homepage section "Latest Release" (.bixbox.releases.latesthome .listupd)
 * Series: /series/{slug}/
 * Chapter: /{slug}-chapter-{n}/
 * Archive: /series/?order=update
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types';
import { fetchWithCf } from '../../../lib/fetchWithCf';


const BASE = 'https://lazygirltranslations.com';

function absUrl(href: string | undefined): string {
	if (!href) return '';
	if (href.startsWith('//')) return `https:${href}`;
	if (href.startsWith('http')) return href;
	try {
		return new URL(href, BASE).href;
	} catch {
		return href;
	}
}

function pathOnly(href: string): string {
	try {
		const u = new URL(href.startsWith('http') ? href : absUrl(href));
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		return href.startsWith('/') ? href.replace(/\/$/, '') || '/' : `/${href}`;
	}
}

function parseChapterNumber(title: string, fallback = 0): number {
	const m =
		title.match(/chapter\s*(\d+(?:\.\d+)?)/i) ||
		title.match(/\bch\.?\s*(\d+(?:\.\d+)?)/i) ||
		title.match(/extra\s*(\d+(?:\.\d+)?)/i) ||
		title.match(/(\d+(?:\.\d+)?)/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function extractChapterNum(text: string): number | undefined {
	const t = (text || '').replace(/\s+/g, ' ').trim();
	if (!t) return undefined;
	const m =
		t.match(/(?:chapter|ch\.?|extra)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/(\d+(?:\.\d+)?)/);
	if (!m) return undefined;
	const n = parseFloat(m[1]);
	return Number.isNaN(n) ? undefined : n;
}

function seriesPathFromChapterPath(chapterPath: string): string | null {
	const p = chapterPath.replace(/\/$/, '');
	const m = p.match(/^\/(.+)-chapter-[\d.]+(?:-.*)?$/i) || p.match(/^\/(.+)-extra-[\d.]+(?:-.*)?$/i);
	if (!m) return null;
	return `/series/${m[1]}`;
}

function seriesPathFromHref(href: string): string | null {
	const id = pathOnly(href);
	if (id.includes('/series/') && !/\/series\/?(list-mode|page)?$/i.test(id)) {
		const m = id.match(/\/series\/([^/]+)/);
		return m ? `/series/${m[1]}` : null;
	}
	return seriesPathFromChapterPath(id);
}

export class LazyGirlTranslationsSource extends BaseSource {
	id = 'lazygirltranslations';
	name = 'Lazy Girl Translations';
	baseUrl = BASE;

	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http')
			? path
			: `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
		return fetchWithCf(url, {
			headers: {
				...this.headers,
				Referer: this.baseUrl + '/'
			}
		});
	}

	async getLatestManga(page = 1): Promise<Manga[]> {
		if (page <= 1) {
			const fromHome = await this.parseLatestRelease().catch(() => [] as Manga[]);
			if (fromHome.length) return fromHome.slice(0, 24);
		}
		return this.parseSeriesArchive(page);
	}

	private async parseLatestRelease(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		this.assertNotCf(html);
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		const root =
			$('.bixbox .releases.latesthome, .releases.latesthome, .bixbox:has(h2:contains("Latest Release"))')
				.first()
				.length > 0
				? $('.bixbox .releases.latesthome, .releases.latesthome').first().closest('.bixbox')
				: $('.bixbox').filter((_, el) => /latest\s*release/i.test($(el).find('h2,h3').text())).first();

		const cards =
			root.length > 0
				? root.find('.listupd .bs, .listupd .bsx, .bs, .bsx')
				: $('.listupd').first().find('.bs, .bsx');

		cards.each((_, el) => {
			const item = this.parseReleaseCard($, el);
			if (!item || seen.has(item.id)) return;
			seen.add(item.id);
			list.push(item);
		});

		return list;
	}

	private parseReleaseCard($: cheerio.CheerioAPI, el: any): Manga | null {
		const a = $(el).find('a').first();
		const href = a.attr('href') || '';
		if (!href) return null;

		const seriesId = seriesPathFromHref(href);
		if (!seriesId) return null;

		const rawTitle =
			a.attr('title') ||
			$(el).find('.tt, .title, h2, h3').first().text() ||
			a.text() ||
			'';
		const title = rawTitle
			.replace(/\s+/g, ' ')
			.replace(/\s*ch\.?\s*\d+.*$/i, '')
			.replace(/\s*chapter\s*\d+.*$/i, '')
			.trim();
		if (!title || title.length < 2) return null;

		const cover =
			$(el).find('img').attr('data-src') ||
			$(el).find('img').attr('data-lazy-src') ||
			$(el).find('img').attr('src') ||
			'';

		const latestChapter =
			extractChapterNum($(el).find('.epx, .epxs, .bigor, .nchapter').text()) ||
			extractChapterNum(rawTitle) ||
			extractChapterNum($(el).text());

		return {
			id: seriesId,
			title,
			cover: absUrl((cover || '').split('?')[0]),
			sourceId: this.id,
			type: 'novel',
			lang: 'en',
			...(latestChapter != null ? { latestChapter } : {})
		};
	}

	private async parseSeriesArchive(page: number): Promise<Manga[]> {
		const paths =
			page <= 1
				? ['/series/?order=update', '/series/?status=&type=&order=update']
				: [
						`/series/?page=${page}&order=update`,
						`/series/?page=${page}&status=&type=&order=update`
					];

		for (const path of paths) {
			try {
				const html = await this.fetchHtml(path);
				this.assertNotCf(html);
				const $ = cheerio.load(html);
				const list: Manga[] = [];
				const seen = new Set<string>();

				$('.listupd article.maindet, article.maindet, .listupd .bs, .listupd .bsx').each((_, el) => {
					const item = this.parseArchiveCard($, el);
					if (!item || seen.has(item.id)) return;
					seen.add(item.id);
					list.push(item);
				});

				if (list.length) return list.slice(0, 24);
			} catch {
	
			}
		}
		return [];
	}

	private parseArchiveCard($: cheerio.CheerioAPI, el: any): Manga | null {
		const a =
			$(el).find('a[href*="/series/"]').first().length > 0
				? $(el).find('a[href*="/series/"]').first()
				: $(el).find('a').first();
		const href = a.attr('href') || '';
		const seriesId = seriesPathFromHref(href);
		if (!seriesId) return null;

		const title =
			(a.attr('title') || $(el).find('h2, h3, .tt').first().text() || a.text())
				.replace(/\s+/g, ' ')
				.trim();
		if (!title || title.length < 2) return null;

		const cover =
			$(el).find('img').attr('data-src') ||
			$(el).find('img').attr('data-lazy-src') ||
			$(el).find('img').attr('src') ||
			'';

		const latestChapter =
			extractChapterNum($(el).find('.nchapter, .epx, .epxs').text()) ||
			extractChapterNum($(el).find('a[href*="chapter"]').text());

		return {
			id: seriesId,
			title,
			cover: absUrl((cover || '').split('?')[0]),
			sourceId: this.id,
			type: 'novel',
			lang: 'en',
			...(latestChapter != null ? { latestChapter } : {})
		};
	}

	private assertNotCf(html: string): void {
		const low = html.slice(0, 2500).toLowerCase();
		if (
			(low.includes('just a moment') ||
				low.includes('cf-browser-verification') ||
				low.includes('challenge-platform')) &&
			html.length < 25000
		) {
			throw new Error('Cloudflare blocked this request');
		}
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = encodeURIComponent(query.trim());
		const paths =
			page <= 1 ? [`/?s=${q}`] : [`/page/${page}/?s=${q}`, `/?s=${q}&page=${page}`];

		for (const path of paths) {
			try {
				const html = await this.fetchHtml(path);
				this.assertNotCf(html);
				const $ = cheerio.load(html);
				const list: Manga[] = [];
				const seen = new Set<string>();

				$('.listupd .bs, .listupd .bsx, article.maindet, .bs, .bsx').each((_, el) => {
					const item = this.parseArchiveCard($, el) || this.parseReleaseCard($, el);
					if (!item || seen.has(item.id)) return;
					seen.add(item.id);
					list.push(item);
				});

				if (!list.length) {
					$('a[href*="/series/"]').each((_, a) => {
						const href = $(a).attr('href') || '';
						const seriesId = seriesPathFromHref(href);
						if (!seriesId || seen.has(seriesId)) return;
						if (/list-mode|\/series\/?$/i.test(seriesId)) return;
						const title = ($(a).attr('title') || $(a).text()).replace(/\s+/g, ' ').trim();
						if (!title || title.length < 2) return;
						seen.add(seriesId);
						list.push({
							id: seriesId,
							title,
							cover: '',
							sourceId: this.id,
							type: 'novel',
							lang: 'en'
						});
					});
				}

				if (list.length) return list.slice(0, 24);
			} catch {
				/* next */
			}
		}
		return [];
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		if (!path.includes('/series/')) {
			path = `/series${path.startsWith('/') ? path : `/${path}`}`;
		}
		path = path.replace(/\/$/, '');

		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		this.assertNotCf(html);
		const $ = cheerio.load(html);

		const title =
			$('h1.entry-title, h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/[|\-–]/)[0].trim() ||
			'';

		if (!title || title.length < 2) throw new Error('Novel not found (empty title)');

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('.seriestucont .thumb img, .thumb img, .mdthumb img').attr('data-src') ||
			$('.seriestucont .thumb img, .thumb img, .mdthumb img').attr('src') ||
			$('img.wp-post-image').attr('src') ||
			'';
		cover = (cover || '').split('?')[0];

		let description = '';
		const syn =
			$('.entry-content, .seriestucontent, .series-synops, .wd-full .entry-content')
				.first();
		if (syn.length) {
			const parts = syn
				.find('p')
				.map((_, p) => $(p).text().replace(/\s+/g, ' ').trim())
				.get()
				.filter((t) => t.length > 40);
			description = parts.slice(0, 8).join('\n\n') || syn.text().replace(/\s+/g, ' ').trim();
		}
		if (!description) {
			description = $('meta[property="og:description"]').attr('content') || '';
		}

		const authors: string[] = [];
		const genres: string[] = [];
		let status = 'Ongoing';

		$('.spe span, .fmed, .wd-full, .infox .imptdt, .seriestuinfoleft li').each((_, el) => {
			const label = ($(el).find('b, strong').first().text() || $(el).text().split(':')[0] || '')
				.toLowerCase()
				.trim();
			const value = $(el)
				.clone()
				.children('b, strong')
				.remove()
				.end()
				.text()
				.replace(/^[:\s]+/, '')
				.replace(/\s+/g, ' ')
				.trim();
			const links = $(el)
				.find('a')
				.map((__, a) => $(a).text().trim())
				.get()
				.filter(Boolean);

			if (/author|penulis/i.test(label)) {
				for (const n of links.length ? links : value ? [value] : []) {
					if (n && !authors.includes(n)) authors.push(n);
				}
			} else if (/status/i.test(label)) {
				status = links[0] || value || status;
			} else if (/genre/i.test(label)) {
				for (const g of links.length ? links : value.split(/[,/]/)) {
					const t = g.trim();
					if (t && !genres.includes(t)) genres.push(t);
				}
			}
		});

		$('a[href*="/genre/"]').each((_, a) => {
			const g = $(a).text().trim();
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		const statusBadge = $('.status, span.status').first().text().trim();
		if (statusBadge && /ongoing|completed|hiatus|complete/i.test(statusBadge)) {
			status = statusBadge;
		}

		const chapters = this.parseChapterList($);
		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		return {
			id: pathOnly(path),
			title,
			cover: absUrl(cover),
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters,
			type: 'novel',
			lang: 'en',
			...(chapters[0]?.number != null ? { latestChapter: chapters[0].number } : {})
		};
	}

	private parseChapterList($: cheerio.CheerioAPI): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		$('.eplister li, #chapterlist li, .chapter-list li').each((i, li) => {
			const a = $(li).find('a').first();
			const href = a.attr('href') || '';
			if (!href || /\/series\//.test(href)) return;
			const id = pathOnly(href);
			if (seen.has(id)) return;

			const numText = $(li).find('.epl-num').first().text().replace(/\s+/g, ' ').trim();
			const dateText = $(li).find('.epl-date').first().text().replace(/\s+/g, ' ').trim();
			const rawFallback = (a.attr('title') || a.text()).replace(/\s+/g, ' ').trim();

			if (!numText && !/chapter|extra|ch\.?/i.test(id + rawFallback)) return;
			seen.add(id);

			const num = parseChapterNumber(numText || rawFallback, i + 1);
			out.push({
				id,
				title: `Chapter ${num}`,
				number: num,
				...(dateText ? { date: dateText } : {})
			});
		});

		if (!out.length) {
			$('a[href*="chapter"]').each((i, el) => {
				const href = $(el).attr('href') || '';
				if (!href || /\/series\//.test(href)) return;
				const id = pathOnly(href);
				if (seen.has(id)) return;
				if (!/chapter|extra/i.test(id)) return;
				seen.add(id);
				const num = parseChapterNumber($(el).text() || id, i + 1);
				out.push({ id, title: `Chapter ${num}`, number: num });
			});
		}

		return out;
	}

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		const path = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		this.assertNotCf(html);
		const $ = cheerio.load(html);

		const title =
			$('h1.entry-title, h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/[|\-–]/)[0].trim() ||
			'Chapter';

		const root = $('.entry-content, .reading-content, .text-left').first();
		root
			.find(
				'script, style, .sharedaddy, .jp-relatedposts, .code-block, .ads, .ad, nav, .navigation, form, .patreon, .ko-fi'
			)
			.remove();

		const paragraphs = root
			.find('p')
			.map((_, p) => $(p).text().replace(/\s+/g, ' ').trim())
			.get()
			.filter((t) => {
				if (!t || t.length < 2) return false;
				if (/accepting commissions via ko-fi/i.test(t)) return false;
				if (/missing chapters.*discord/i.test(t)) return false;
				if (/help this site by whitelisting/i.test(t)) return false;
				if (/^sponsored/i.test(t)) return false;
				return true;
			});

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		$('a[rel="prev"], a[rel="next"], .nav-previous a, .nav-next a, a').each((_, a) => {
			const href = $(a).attr('href') || '';
			const text = $(a).text().toLowerCase();
			const id = pathOnly(href);
			if (!/chapter|extra/i.test(id)) return;
			if (/prev|previous|older/i.test(text) || $(a).attr('rel') === 'prev') prevChapterId = id;
			if (/next|newer/i.test(text) || $(a).attr('rel') === 'next') nextChapterId = id;
		});

		return {
			title,
			content: paragraphs.join('\n\n') || root.text().replace(/\s+/g, ' ').trim(),
			prevChapterId,
			nextChapterId
		};
	}
}

export default LazyGirlTranslationsSource;
