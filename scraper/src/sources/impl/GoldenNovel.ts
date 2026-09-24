/**
 * GoldenNovel.com — WordPress NovelPress theme
 * Path: scraper/src/sources/impl/GoldenNovel.ts
 *
 * URL:
 *   Novel   : /index.php/category/{genre}/{slug}/
 *   Chapter : /index.php/{genre}/{slug}/chapter-{n}-{title}/
 *   TOC page: ?chpage={n}
 *   Content : .np-chapter__content.np-reader-content
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types';

function absUrl(base: string, href: string | undefined): string {
	if (!href) return '';
	if (href.startsWith('//')) return `https:${href}`;
	if (href.startsWith('http')) return href;
	try {
		return new URL(href, base).href;
	} catch {
		return href;
	}
}

function pathOnly(href: string): string {
	try {
		const u = new URL(
			href.startsWith('http')
				? href
				: `https://goldennovel.com${href.startsWith('/') ? '' : '/'}${href}`
		);
		// drop query for stable id
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		return href.startsWith('/') ? href : `/${href}`;
	}
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function parseChapterNumber(title: string, fallback: number): number {
	const m =
		title.match(/chapter\s*(\d+(?:\.\d+)?)/i) ||
		title.match(/\bch\.?\s*(\d+(?:\.\d+)?)/i) ||
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
		t.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/(\d+(?:\.\d+)?)\s*chapters?/i) ||
		t.match(/(\d+(?:\.\d+)?)/);
	if (!m) return undefined;
	const n = parseFloat(m[1]);
	return Number.isNaN(n) ? undefined : n;
}

export class GoldenNovelSource extends BaseSource {
	id = 'goldennovel';
	name = 'GoldenNovel';
	baseUrl = 'https://goldennovel.com';

	async getLatestManga(page = 1): Promise<Manga[]> {
		if (page <= 1) {
			const [home, list1] = await Promise.all([
				this.parseHome().catch(() => [] as Manga[]),
				this.fetchNovelList(1).catch(() => [] as Manga[])
			]);
			return this.dedupeById([...home, ...list1]).slice(0, 24);
		}
		return this.fetchNovelList(page);
	}

	private dedupeById(items: Manga[]): Manga[] {
		const seen = new Set<string>();
		const out: Manga[] = [];
		for (const m of items) {
			if (seen.has(m.id)) continue;
			seen.add(m.id);
			out.push(m);
		}
		return out;
	}

	private async parseHome(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		const $ = cheerio.load(html);
		return this.parseNovelCards($);
	}

	private async fetchNovelList(page: number): Promise<Manga[]> {
		// Novel List page — try common NovelPress paths
		const paths =
			page <= 1
				? ['/index.php/novel-list/', '/novel-list/', '/index.php/novels/']
				: [
						`/index.php/novel-list/page/${page}/`,
						`/novel-list/page/${page}/`,
						`/index.php/novel-list/?page=${page}`
					];
		for (const path of paths) {
			try {
				const html = await this.fetchHtml(path);
				const $ = cheerio.load(html);
				const list = this.parseNovelCards($);
				if (list.length) return list;
			} catch {
				/* next */
			}
		}
		// Fallback: homepage only already done for page 1
		if (page > 1) {
			try {
				const html = await this.fetchHtml(`/page/${page}/`);
				const $ = cheerio.load(html);
				return this.parseNovelCards($);
			} catch {
				return [];
			}
		}
		return [];
	}

	private parseNovelCards($: cheerio.CheerioAPI): Manga[] {
		const list: Manga[] = [];
		const seen = new Set<string>();

		// NovelPress cards
		$('.np-novel-card').each((_, el) => {
			const a = $(el).find('a[href*="/category/"]').first().length
				? $(el).find('a[href*="/category/"]').first()
				: $(el).find('a').first();
			const href = a.attr('href') || '';
			if (!href || !/\/category\//.test(href)) return;
			const id = pathOnly(href);
			if (seen.has(id)) return;
			seen.add(id);

			const title =
				$(el).find('.np-novel-card__title').text().trim() ||
				a.attr('title') ||
				a.text().trim();
			if (!title || title.length < 2) return;

			const cover =
				$(el).find('.np-novel-card__cover img').attr('data-src') ||
				$(el).find('.np-novel-card__cover img').attr('src') ||
				$(el).find('img').attr('data-src') ||
				$(el).find('img').attr('src') ||
				'';

			const meta = $(el).find('.np-novel-card__meta').text().replace(/\s+/g, ' ').trim();
			const latestChapter =
				extractChapterNum(meta) ??
				extractChapterNum($(el).find('.np-novel-card__meta, .np-meta-item').text());

			const status = /ongoing/i.test(meta)
				? 'Ongoing'
				: /completed|complete/i.test(meta)
					? 'Completed'
					: undefined;

			list.push({
				id,
				title: title.replace(/\s+/g, ' ').trim(),
				cover: absUrl(this.baseUrl, (cover || '').split('?')[0]),
				sourceId: this.id,
				type: 'novel',
				status,
				lang: 'en',
				...(latestChapter != null ? { latestChapter } : {})
			});
		});

		// Latest Updates rows
		$('.np-chapter-row, .np-latest-item, a[href*="/category/"]').each((_, el) => {
			const isLink = el.tagName?.toLowerCase() === 'a';
			const a = isLink ? $(el) : $(el).find('a[href*="/category/"]').first();
			const href = a.attr('href') || '';
			if (!href || !/\/category\//.test(href)) return;
			// skip pure chapter links
			if (/\/chapter-/.test(href)) return;
			const id = pathOnly(href);
			if (seen.has(id)) return;
			seen.add(id);

			const title = (a.attr('title') || a.text()).replace(/\s+/g, ' ').trim();
			if (!title || title.length < 2) return;

			const parent = isLink ? $(el).parent() : $(el);
			const cover =
				parent.find('img').attr('data-src') || parent.find('img').attr('src') || '';
			const chText =
				parent.find('a[href*="chapter"]').first().text() ||
				parent.text().match(/Chapter\s*\d+/i)?.[0] ||
				'';
			const latestChapter = extractChapterNum(chText);

			list.push({
				id,
				title,
				cover: absUrl(this.baseUrl, (cover || '').split('?')[0]),
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				...(latestChapter != null ? { latestChapter } : {})
			});
		});

		return list;
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = encodeURIComponent(query);
		const paths = [
			`/?s=${q}`,
			`/index.php/?s=${q}`,
			`/page/${page}/?s=${q}`
		];
		for (const path of paths) {
			try {
				const html = await this.fetchHtml(path);
				const $ = cheerio.load(html);
				const list = this.parseNovelCards($);
				if (list.length) return list;
			} catch {
				/* next */
			}
		}
		return [];
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		// Pastikan path novel category
		if (!path.includes('/category/')) {
			// mungkin user punya slug saja — tetap coba
			path = path.startsWith('/index.php') ? path : `/index.php${path}`;
		}
		const novelUrl = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(novelUrl);
		const $ = cheerio.load(html);

		const title =
			$('h1').first().text().trim() ||
			$('.np-novel-header h1, .entry-title').first().text().trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/[|\-–]/)[0].trim() ||
			$('title').text().split(/[|\-–]/)[0].trim();

		if (!title || title.length < 2) {
			throw new Error('Manga not found (empty title)');
		}

		const coverEl = $('.np-novel-cover img, .np-novel-header img, article img').first();
		let cover =
			coverEl.attr('data-src') ||
			coverEl.attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = (cover || '').split('?')[0];

		// Synopsis
		let description =
			$('.np-novel-synopsis, .np-synopsis, .entry-content p')
				.map((_, p) => $(p).text().trim())
				.get()
				.filter((t) => t.length > 40)
				.slice(0, 8)
				.join('\n\n') ||
			$('meta[property="og:description"]').attr('content') ||
			'';

		const authors: string[] = [];
		const genres: string[] = [];
		let status = 'Ongoing';

		// Fact labels NovelPress
		$('.np-fact-label, .np-meta-item, .np-novel-meta li').each((_, el) => {
			const text = $(el).text().replace(/\s+/g, ' ').trim();
			const low = text.toLowerCase();
			if (/author/i.test(low)) {
				const name = text.replace(/author[:\s]*/i, '').trim();
				if (name && !authors.includes(name)) authors.push(name);
			} else if (/status/i.test(low)) {
				const s = text.replace(/status[:\s]*/i, '').trim();
				if (s) status = s;
			} else if (/genre/i.test(low)) {
				$(el)
					.find('a')
					.each((_, a) => {
						const g = $(a).text().trim();
						if (g && !genres.includes(g)) genres.push(g);
					});
			}
		});

		// Author fallback
		if (!authors.length) {
			const authorText = $('[class*="author"]').first().text().replace(/author[:\s]*/i, '').trim();
			if (authorText && authorText.length < 60) authors.push(authorText);
		}

		// Genre from breadcrumbs / tags
		$('a[href*="/category/"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			// genre-level only: /category/{genre}/ without novel slug depth
			if (/\/category\/[^/]+\/?$/.test(href.replace(this.baseUrl, ''))) {
				const g = $(a).text().trim();
				if (g && g.length < 40 && !/novel list|home/i.test(g) && !genres.includes(g)) {
					genres.push(g);
				}
			}
		});

		// Chapters — page 1 + pagination ?chpage=
		const chapters = await this.fetchAllChapters(novelUrl, $);

		chapters.sort((a, b) => {
			const na = typeof a.number === 'number' ? a.number : 0;
			const nb = typeof b.number === 'number' ? b.number : 0;
			return nb - na;
		});

		return {
			id: pathOnly(novelUrl),
			title,
			cover: absUrl(this.baseUrl, cover),
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters,
			type: 'novel',
			lang: 'en'
		};
	}

	/** TOC: .np-toc__item + ?chpage=N */
	private async fetchAllChapters(novelUrl: string, $first: cheerio.CheerioAPI): Promise<Chapter[]> {
		const seen = new Set<string>();
		const out: Chapter[] = [];

		const ingest = ($: cheerio.CheerioAPI) => {
			$('.np-toc__item a.np-toc__link, .np-toc__link, a[href*="chapter-"]').each((i, el) => {
				const href = $(el).attr('href') || '';
				if (!href || !/chapter-/.test(href)) return;
				const rawTitle = (
					$(el).find('.np-toc__num').text() ||
					$(el).attr('title') ||
					$(el).text()
				)
					.replace(/\s+/g, ' ')
					.trim();
				if (!rawTitle) return;
				const num = parseChapterNumber(rawTitle, out.length + 1);
				const id = pathOnly(href);
				if (seen.has(id)) return;
				seen.add(id);
				out.push({ id, title: `Chapter ${num}`, number: num });
			});
		};

		ingest($first);

		// Max page dari pagination
		let maxPage = 1;
		$first('.page-numbers a, a.page-numbers').each((_, el) => {
			const href = $first(el).attr('href') || '';
			const m = href.match(/chpage=(\d+)/);
			if (m) maxPage = Math.max(maxPage, parseInt(m[1], 10));
			const t = $first(el).text().trim();
			if (/^\d+$/.test(t)) maxPage = Math.max(maxPage, parseInt(t, 10));
		});

		// Cap biar tidak spam (max 20 halaman TOC)
		maxPage = Math.min(maxPage, 20);

		if (maxPage > 1) {
			const base = novelUrl.includes('?') ? novelUrl.split('?')[0] : novelUrl;
			const jobs: Promise<void>[] = [];
			for (let p = 2; p <= maxPage; p++) {
				jobs.push(
					(async () => {
						try {
							const html = await this.fetchHtml(`${base}?chpage=${p}`);
							ingest(cheerio.load(html));
						} catch {
							/* skip page */
						}
					})()
				);
			}
			await Promise.all(jobs);
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
		const $ = cheerio.load(html);

		const title =
			$('h1').first().text().trim() ||
			$('.np-reader-bar__titles, .chapter-title').first().text().trim() ||
			$('title').text().split(/[|\-–]/)[0].trim() ||
			'Chapter';

		const el = $('.np-chapter__content, .np-reader-content, .np-reader-main').first();
		let contentHtml = '';

		if (el.length) {
			const clone = el.clone();
			clone.find('script, style, iframe, .ads, .ad, nav, .np-reader-bar, .np-toc-select').remove();
			const paras = clone.find('p');
			if (paras.length >= 2) {
				const parts: string[] = [];
				paras.each((_, p) => {
					const t = $(p).text().trim();
					if (!t) return;
					if (/goldennovel\.com/i.test(t)) return;
					parts.push(`<p>${escapeHtml(t)}</p>`);
				});
				if (parts.length >= 2) contentHtml = parts.join('\n');
			}
			if (!contentHtml) {
				const inner = clone.html()?.trim() || '';
				if (inner.length > 100) contentHtml = inner;
			}
		}

		if (!contentHtml || contentHtml.length < 50) {
			const parts: string[] = [];
			$('article p, main p, .entry-content p').each((_, p) => {
				const t = $(p).text().trim();
				if (t.length < 15) return;
				if (/goldennovel|cookie|privacy/i.test(t)) return;
				parts.push(`<p>${escapeHtml(t)}</p>`);
			});
			if (parts.length) contentHtml = parts.join('\n');
		}

		const prevHref =
			$('a[rel="prev"]').attr('href') ||
			$('.np-nav-prev a, a.prev-chapter').first().attr('href');
		const nextHref =
			$('a[rel="next"]').attr('href') ||
			$('.np-nav-next a, a.next-chapter').first().attr('href');

		return {
			title,
			content:
				contentHtml ||
				'<p><em>Konten kosong — selector berubah atau halaman terblokir.</em></p>',
			prevChapterId: prevHref ? pathOnly(prevHref) : null,
			nextChapterId: nextHref ? pathOnly(nextHref) : null
		};
	}
}

export default GoldenNovelSource;
