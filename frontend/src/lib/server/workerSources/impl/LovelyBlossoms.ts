/**
 * LovelyBlossoms.com — Madara theme (novel)
 * Path: scraper/src/sources/impl/LovelyBlossoms.ts
 *
 * URL:
 *   Novel   : /novel/{slug}/
 *   Chapter : /novel/{slug}/chapter-N/
 *   Latest  : /  + /page/{n}/
 *   Chapters AJAX: POST /novel/{slug}/ajax/chapters/?t=1
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
				: `https://lovelyblossoms.com${href.startsWith('/') ? '' : '/'}${href}`
		);
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
		title.match(/\bbab\s*(\d+(?:\.\d+)?)/i) ||
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
		t.match(/(?:chapter|ch\.?|bab)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/(\d+(?:\.\d+)?)/);
	if (!m) return undefined;
	const n = parseFloat(m[1]);
	return Number.isNaN(n) ? undefined : n;
}

export class LovelyBlossomsSource extends BaseSource {
	id = 'lovelyblossoms';
	name = 'LovelyBlossoms';
	baseUrl = 'https://lovelyblossoms.com';

	async getLatestManga(page = 1): Promise<Manga[]> {
		if (page <= 1) {
			const [home, p2] = await Promise.all([
				this.parseHomeLatest().catch(() => [] as Manga[]),
				this.fetchPage(2).catch(() => [] as Manga[])
			]);
			return this.dedupeById([...home, ...p2]).slice(0, 24);
		}
		return this.fetchPage(page);
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

	private assertNotCf(html: string): void {
		const low = html.slice(0, 2000).toLowerCase();
		if (
			(low.includes('just a moment') ||
				low.includes('cf-browser-verification') ||
				low.includes('challenge-platform')) &&
			html.length < 20000
		) {
			throw new Error('Cloudflare blocked this request');
		}
	}

	/** Homepage Latest Updates */
	private async parseHomeLatest(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		this.assertNotCf(html);
		const $ = cheerio.load(html);
		return this.parseListingCards($);
	}

	private async fetchPage(page: number): Promise<Manga[]> {
		const path = page <= 1 ? '/' : `/page/${page}/`;
		try {
			const html = await this.fetchHtml(path);
			this.assertNotCf(html);
			const $ = cheerio.load(html);
			return this.parseListingCards($);
		} catch {
			return [];
		}
	}

	private parseListingCards($: cheerio.CheerioAPI): Manga[] {
		const list: Manga[] = [];

		// Madara homepage cards
		const cards = $(
			'.page-item-detail, .c-tabs-item__content, .page-listing-item, .manga, .badge-ext-1'
		);

		if (cards.length) {
			cards.each((_, el) => {
				const item = this.parseCard($, el);
				if (item && !list.some((x) => x.id === item.id)) list.push(item);
			});
		}

		// Fallback: latest update list (title + chapter links)
		if (list.length < 8) {
			$('a[href*="/novel/"]').each((_, el) => {
				const href = $(el).attr('href') || '';
				// Hanya link novel (bukan chapter)
				if (!href || !/\/novel\/[^/]+\/?$/.test(href.replace(this.baseUrl, ''))) return;
				const title = ($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim();
				if (!title || title.length < 2) return;
				const parent = $(el).closest('div, article, li, .col-6, .col-md-3, .page-item-detail');
				const cover =
					parent.find('img').attr('data-src') ||
					parent.find('img').attr('data-lazy-src') ||
					parent.find('img').attr('src') ||
					$(el).find('img').attr('src') ||
					'';
				const id = pathOnly(href);
				if (list.some((x) => x.id === id)) return;

				const chText =
					parent.find('a[href*="chapter"]').first().text() ||
					parent.find('.chapter, .list-chapter, .chapter-item').first().text() ||
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
		}

		return list;
	}

	private parseCard($: cheerio.CheerioAPI, el: any): Manga | null {
		const novelLinks = $(el)
			.find('a[href*="/novel/"]')
			.filter((_, x) => {
				const h = $(x).attr('href') || '';
				return /\/novel\/[^/]+\/?$/.test(h.replace(this.baseUrl, ''));
			});
		const a = novelLinks.first().length
			? novelLinks.first()
			: $(el).find('.post-title a, h3 a, h5 a').first();

		const href = a.attr('href') || '';
		if (!href || !/\/novel\//.test(href)) return null;
		if (/\/novel\/[^/]+\/.+/i.test(href.replace(this.baseUrl, ''))) return null;

		const title =
			a.attr('title') ||
			$(el).find('.post-title, h3, h5').first().text().trim() ||
			a.text().trim();
		if (!title || title.length < 2) return null;

		const cover =
			$(el).find('img').attr('data-src') ||
			$(el).find('img').attr('data-lazy-src') ||
			$(el).find('img').attr('src') ||
			'';

		const typeText =
			$(el).find('.manga-type, span.type').first().text().trim() || 'novel';
		const status =
			$(el).find('.manga-status, .status').first().text().trim() || undefined;

		const chText =
			$(el).find('.list-chapter a, .chapter-item a, .chapter a, a[href*="chapter"]').first().text() ||
			$(el).find('.list-chapter, .chapter-item, .chapter').first().text() ||
			'';
		const latestChapter = extractChapterNum(chText);

		return {
			id: pathOnly(href),
			title: title.replace(/\s+/g, ' ').trim(),
			cover: absUrl(this.baseUrl, (cover || '').split('?')[0]),
			sourceId: this.id,
			type: typeText || 'novel',
			status,
			lang: 'en',
			...(latestChapter != null ? { latestChapter } : {})
		};
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = encodeURIComponent(query);
		const path =
			page <= 1
				? `/?s=${q}&post_type=wp-manga`
				: `/page/${page}/?s=${q}&post_type=wp-manga`;
		try {
			const html = await this.fetchHtml(path);
			this.assertNotCf(html);
			const $ = cheerio.load(html);
			return this.parseListingCards($);
		} catch {
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		if (!path.includes('/novel/')) {
			path = `/novel${path.startsWith('/') ? path : `/${path}`}`;
		}
		const novelPath = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(novelPath);
		this.assertNotCf(html);
		const $ = cheerio.load(html);

		const title =
			$('.post-title h1').first().text().trim() ||
			$('.post-title h2').first().text().trim() ||
			$('h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/[|\-–]/)[0].trim() ||
			$('title').text().split(/[|\-–]/)[0].trim();

		if (!title || title.length < 2) {
			throw new Error('Manga not found (empty title)');
		}

		// Cover
		const coverEl = $('.summary_image img, .tab-summary img').first();
		let cover =
			coverEl.attr('data-src') ||
			coverEl.attr('data-lazy-src') ||
			coverEl.attr('data-original') ||
			coverEl.attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			$('meta[name="twitter:image"]').attr('content') ||
			'';
		if (cover.startsWith('data:') || /placeholder|no[-_]?image/i.test(cover)) {
			cover =
				$('meta[property="og:image"]').attr('content') ||
				$('meta[name="twitter:image"]').attr('content') ||
				'';
		}
		cover = (cover || '').split('?')[0];

		// Synopsis
		let description = '';
		const summary = $(
			'.description-summary .summary__content, .summary__content, .manga-excerpt, .description-summary'
		);
		if (summary.length) {
			description = summary
				.find('p')
				.map((_, p) => $(p).text().trim())
				.get()
				.filter(Boolean)
				.join('\n\n');
			if (!description) description = summary.text().replace(/\s+/g, ' ').trim();
		}

		const authors: string[] = [];
		const artists: string[] = [];
		const genres: string[] = [];
		let altTitle = '';
		let typeLabel = 'novel';
		let status = 'Ongoing';
		let published = '';

		$('.post-content_item').each((_, el) => {
			const label = $(el)
				.find('.summary-heading, h5, h6, strong, b')
				.first()
				.text()
				.toLowerCase()
				.trim();
			const valueEl = $(el).find('.summary-content').length
				? $(el).find('.summary-content')
				: $(el);
			const valueText = valueEl.text().replace(/\s+/g, ' ').trim();
			const links: string[] = [];
			valueEl.find('a').each((_, a) => {
				const t = $(a).text().trim();
				if (t) links.push(t);
			});

			if (/author|penulis|pengarang/i.test(label)) {
				for (const n of links.length ? links : valueText ? [valueText] : []) {
					const clean = n.replace(/^author\(s\)\s*/i, '').trim();
					if (clean && !authors.includes(clean)) authors.push(clean);
				}
			} else if (/artist|ilustrator/i.test(label)) {
				for (const n of links.length ? links : valueText ? [valueText] : []) {
					if (n && !artists.includes(n)) artists.push(n);
				}
			} else if (/alternative|native|other name/i.test(label)) {
				altTitle = links.join(', ') || valueText;
			} else if (/type|tipe|jenis/i.test(label)) {
				typeLabel = links[0] || valueText || typeLabel;
			} else if (/status/i.test(label)) {
				status = links[0] || valueText || status;
			} else if (/genre/i.test(label)) {
				for (const g of links.length ? links : valueText.split(/[,/]/)) {
					const t = g.trim();
					if (t && !genres.includes(t)) genres.push(t);
				}
			} else if (/release|year/i.test(label)) {
				published = valueText;
			}
		});

		$('.genres-content a, a[href*="/manga-genre/"], a[href*="/genre/"]').each((_, a) => {
			const g = $(a).text().trim();
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		if (!authors.length && artists.length) authors.push(...artists);

		let rating: string | undefined;
		const ratingText = $('.post-total-rating .score, #averagerate, .rating .score')
			.first()
			.text()
			.trim();
		if (ratingText) {
			const m = ratingText.match(/(\d+(?:\.\d+)?)/);
			if (m) rating = m[1];
		}

		// Chapters via AJAX
		let chapters = await this.fetchChaptersAjax(novelPath);
		if (!chapters.length) {
			chapters = this.parseChapterList($);
		}

		chapters.sort((a, b) => {
			const na = typeof a.number === 'number' ? a.number : 0;
			const nb = typeof b.number === 'number' ? b.number : 0;
			return nb - na;
		});

		const details: MangaDetails = {
			id: pathOnly(path),
			title,
			cover: absUrl(this.baseUrl, cover),
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters,
			type: typeLabel || 'novel',
			lang: 'en'
		};

		const extra = details as MangaDetails & {
			artists?: string[];
			altTitles?: string[];
			rating?: string;
			published?: string;
		};
		if (artists.length) extra.artists = artists;
		if (altTitle) extra.altTitles = [altTitle];
		if (rating) extra.rating = rating;
		if (published) extra.published = published;

		return details;
	}

	/** POST /novel/{slug}/ajax/chapters/?t=1 */
	private async fetchChaptersAjax(novelPath: string): Promise<Chapter[]> {
		const base = novelPath.endsWith('/') ? novelPath : `${novelPath}/`;
		const url = absUrl(this.baseUrl, `${base}ajax/chapters/?t=1`);

		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: {
					...this.headers,
					'X-Requested-With': 'XMLHttpRequest',
					Referer: absUrl(this.baseUrl, base),
					Origin: this.baseUrl,
					'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
				},
				body: ''
			});
			if (!res.ok) return [];
			const html = await res.text();
			if (!html || html.length < 50) return [];
			const $ch = cheerio.load(html);
			return this.parseChapterList($ch);
		} catch {
			return [];
		}
	}

	private parseChapterList($: cheerio.CheerioAPI): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		$('li.wp-manga-chapter').each((i, el) => {
			const a = $(el).find('> a').first().length
				? $(el).find('> a').first()
				: $(el).find('a').first();
			const href = a.attr('href') || '';
			if (!href || href === '#' || href.startsWith('javascript')) return;

			const rawTitle = (a.attr('title') || a.text()).replace(/\s+/g, ' ').trim();
			if (!rawTitle || rawTitle.length < 2) return;

			const date =
				$(el).find('.chapter-release-date i, .chapter-release-date').text().trim() ||
				undefined;

			const num = parseChapterNumber(rawTitle, i + 1);
			const id = pathOnly(href);
			if (seen.has(id)) return;
			seen.add(id);

			out.push({
				id,
				title: `Chapter ${num}`,
				number: num,
				date
			});
		});

		if (!out.length) {
			$('a[href*="/chapter"]').each((i, el) => {
				const href = $(el).attr('href') || '';
				if (!href || !/\/novel\//.test(href)) return;
				const rawTitle = ($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim();
				if (!rawTitle || rawTitle.length < 2) return;
				const num = parseChapterNumber(rawTitle, i + 1);
				const id = pathOnly(href);
				if (seen.has(id)) return;
				seen.add(id);
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
			$('h1, h2.chapter-title, .reading-title, .c-breadcrumb li.active').first().text().trim() ||
			$('title').text().split(/[|\-–]/)[0].trim() ||
			'Chapter';

		const containers = [
			'.reading-content',
			'.text-left',
			'.chapter-content',
			'#chapter-content',
			'.entry-content .reading-content',
			'.read-container',
			'article .content',
			'.post-content'
		];

		let contentHtml = '';
		for (const sel of containers) {
			const el = $(sel).first();
			if (!el.length) continue;
			const clone = el.clone();
			clone
				.find(
					'script, style, iframe, .ads, .ad, nav, .nav, .reader-settings, .comments, .code-block, .sharedaddy, .chapter-warning'
				)
				.remove();

			const paras = clone.find('p');
			if (paras.length >= 2) {
				const parts: string[] = [];
				paras.each((_, p) => {
					const t = $(p).text().trim();
					if (!t) return;
					if (/lovelyblossoms\.com/i.test(t)) return;
					parts.push(`<p>${escapeHtml(t)}</p>`);
				});
				if (parts.length >= 2) {
					contentHtml = parts.join('\n');
					break;
				}
			}
			const inner = clone.html()?.trim() || '';
			if (inner.length > 200) {
				contentHtml = inner;
				break;
			}
		}

		if (!contentHtml || contentHtml.length < 50) {
			const parts: string[] = [];
			$('body p').each((_, p) => {
				const t = $(p).text().trim();
				if (t.length < 20) return;
				if (/lovelyblossoms|cloudflare|cookie|privacy|adblock/i.test(t)) return;
				parts.push(`<p>${escapeHtml(t)}</p>`);
			});
			if (parts.length) contentHtml = parts.join('\n');
		}

		const prevHref =
			$('a[rel="prev"]').attr('href') ||
			$('.prev_page a, a.prev, .nav-previous a').first().attr('href');
		const nextHref =
			$('a[rel="next"]').attr('href') ||
			$('.next_page a, a.next, .nav-next a').first().attr('href');

		return {
			title,
			content:
				contentHtml ||
				'<p><em>Konten kosong — kemungkinan diblokir Cloudflare atau selector berubah.</em></p>',
			prevChapterId: prevHref ? pathOnly(prevHref) : null,
			nextChapterId: nextHref ? pathOnly(nextHref) : null
		};
	}
}

export default LovelyBlossomsSource;
