/**
 * GoldenNovel.com — WordPress NovelPress theme
 * Path: scraper/src/sources/impl/GoldenNovel.ts
 *
 * Fixes:
 * - Jangan parse genre card sebagai novel
 * - Cover dari .np-cover-img
 * - TOC .np-toc__item + ?chpage=
 * - Prev/Next: .np-chapter__nav-btn--prev/next
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
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		return href.startsWith('/') ? href : `/${href}`;
	}
}

/** Novel path harus: /.../category/{genre}/{slug}  (bukan cuma genre) */
function isNovelPath(href: string): boolean {
	const p = pathOnly(href);
	// /index.php/category/fantasy/zero-soul-mage  OR  /category/fantasy/zero-soul-mage
	return /\/category\/[^/]+\/[^/]+$/.test(p);
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
		const paths =
			page <= 1
				? ['/index.php/novel-list/', '/novel-list/']
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
		return [];
	}

	private parseNovelCards($: cheerio.CheerioAPI): Manga[] {
		const list: Manga[] = [];
		const seen = new Set<string>();

		// Hanya .np-novel-card (bukan .np-genre-card)
		$('.np-novel-card').each((_, el) => {
			const a =
				$(el).find('a.np-novel-card__cover[href*="/category/"]').first().length > 0
					? $(el).find('a.np-novel-card__cover[href*="/category/"]').first()
					: $(el).find('a[href*="/category/"]').first();

			const href = a.attr('href') || '';
			if (!href || !isNovelPath(href)) return;

			const id = pathOnly(href);
			if (seen.has(id)) return;
			seen.add(id);

			const title =
				$(el).find('.np-novel-card__title').text().trim() ||
				a.attr('aria-label')?.replace(/^Read\s+/i, '').trim() ||
				a.attr('title') ||
				a.text().trim();
			if (!title || title.length < 2) return;

			// Cover: .np-cover-img di dalam .np-cover / .np-novel-card__cover
			const cover =
				$(el).find('img.np-cover-img').attr('data-src') ||
				$(el).find('img.np-cover-img').attr('src') ||
				$(el).find('.np-novel-card__cover img').attr('data-src') ||
				$(el).find('.np-novel-card__cover img').attr('src') ||
				$(el).find('img').attr('data-src') ||
				$(el).find('img').attr('src') ||
				'';

			const meta = $(el).find('.np-novel-card__meta').text().replace(/\s+/g, ' ').trim();
			const latestChapter =
				extractChapterNum(meta) ??
				extractChapterNum($(el).find('.np-meta-item, .np-novel-card__meta').text());

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

		// Latest Updates: baris novel + chapter (bukan genre)
		$('.np-chapter-row__novel a[href*="/category/"], .np-latest a[href*="/category/"]').each(
			(_, el) => {
				const href = $(el).attr('href') || '';
				if (!href || !isNovelPath(href) || /\/chapter-/.test(href)) return;
				const id = pathOnly(href);
				if (seen.has(id)) return;
				seen.add(id);

				const title = ($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim();
				if (!title || title.length < 2) return;

				const parent = $(el).closest('.np-chapter-row, .np-latest-item, li, div');
				const chText =
					parent.find('a[href*="chapter"]').first().text() ||
					parent.text().match(/Chapter\s*\d+/i)?.[0] ||
					'';
				const latestChapter = extractChapterNum(chText);

				list.push({
					id,
					title,
					cover: '',
					sourceId: this.id,
					type: 'novel',
					lang: 'en',
					...(latestChapter != null ? { latestChapter } : {})
				});
			}
		);

		return list;
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = encodeURIComponent(query);
		const paths = [`/?s=${q}`, `/index.php/?s=${q}`, `/page/${page}/?s=${q}`];
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

		const coverEl = $(
			'.np-novel-cover img.np-cover-img, .np-novel-cover img, .np-novel-header img, img.np-cover-img'
		).first();
		let cover =
			coverEl.attr('data-src') ||
			coverEl.attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = (cover || '').split('?')[0];

		let description =
			$('.np-novel-synopsis, .np-synopsis')
				.find('p')
				.map((_, p) => $(p).text().trim())
				.get()
				.filter((t) => t.length > 30)
				.join('\n\n') ||
			$('.entry-content p')
				.map((_, p) => $(p).text().trim())
				.get()
				.filter((t) => t.length > 40)
				.slice(0, 6)
				.join('\n\n') ||
			$('meta[property="og:description"]').attr('content') ||
			'';

		const authors: string[] = [];
		const genres: string[] = [];
		let status = 'Ongoing';

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

		if (!authors.length) {
			const authorText = $('[class*="author"]')
				.first()
				.text()
				.replace(/author[:\s]*/i, '')
				.trim();
			if (authorText && authorText.length < 60) authors.push(authorText);
		}

		$('a[href*="/category/"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const p = pathOnly(href);
			// genre only: /category/{genre}
			if (/\/category\/[^/]+$/.test(p)) {
				const g = $(a).text().trim();
				if (g && g.length < 40 && !/novel list|home/i.test(g) && !genres.includes(g)) {
					genres.push(g);
				}
			}
		});

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

	private async fetchAllChapters(novelUrl: string, $first: cheerio.CheerioAPI): Promise<Chapter[]> {
		const seen = new Set<string>();
		const out: Chapter[] = [];

		const ingest = ($: cheerio.CheerioAPI) => {
			// struktur: li.np-toc__item > a.np-toc__link
			$('li.np-toc__item a.np-toc__link, a.np-toc__link, .np-toc a[href*="chapter-"]').each(
				(_, el) => {
					const href = $(el).attr('href') || '';
					if (!href || !/chapter-/.test(href)) return;
					const rawTitle = ($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim();
					if (!rawTitle) return;
					const num = parseChapterNumber(rawTitle, out.length + 1);
					const id = pathOnly(href);
					if (seen.has(id)) return;
					seen.add(id);
					out.push({ id, title: `Chapter ${num}`, number: num });
				}
			);
		};

		ingest($first);

		let maxPage = 1;
		$first('.page-numbers a, a.page-numbers').each((_, el) => {
			const href = $first(el).attr('href') || '';
			const m = href.match(/chpage=(\d+)/);
			if (m) maxPage = Math.max(maxPage, parseInt(m[1], 10));
			const t = $first(el).text().trim();
			if (/^\d+$/.test(t)) maxPage = Math.max(maxPage, parseInt(t, 10));
		});
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
							/* skip */
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
			$('.np-reader-bar__chapter, .np-reader-bar__titles').first().text().trim() ||
			$('title').text().split(/[|\-–]/)[0].trim() ||
			'Chapter';

		const el = $('.np-chapter__content, .np-reader-content').first();
		let contentHtml = '';

		if (el.length) {
			const clone = el.clone();
			clone
				.find('script, style, iframe, .ads, .ad, nav, .np-reader-bar, .np-toc-select, .np-chapter__nav')
				.remove();
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
			$('article p, main p').each((_, p) => {
				const t = $(p).text().trim();
				if (t.length < 15) return;
				if (/goldennovel|cookie|privacy/i.test(t)) return;
				parts.push(`<p>${escapeHtml(t)}</p>`);
			});
			if (parts.length) contentHtml = parts.join('\n');
		}

		// Prev / Next — NovelPress
		const prevHref =
			$('a.np-chapter__nav-btn--prev').attr('href') ||
			$('.np-chapter__nav a[href*="chapter-"]').filter((_, a) =>
				/previous|prev|←/i.test($(a).text())
			).first().attr('href') ||
			$('a[rel="prev"]').attr('href');

		const nextHref =
			$('a.np-chapter__nav-btn--next').attr('href') ||
			$('.np-chapter__nav a[href*="chapter-"]').filter((_, a) =>
				/next|→/i.test($(a).text())
			).first().attr('href') ||
			$('a[rel="next"]').attr('href');

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
