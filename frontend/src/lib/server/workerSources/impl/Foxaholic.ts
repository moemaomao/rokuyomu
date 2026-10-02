/**
 * Foxaholic.com — Madara (WP Manga) novel translation site
 * Path: scraper/src/sources/impl/novel/Foxaholic.ts
 *
 * URL pattern:
 *   Latest   : /  (section Latest Releases)  + /novel/?m_orderby=latest&page/{n}
 *   Series   : /novel/{slug}/
 *   Chapter  : /novel/{slug}/{chapter-slug}/
 *   Search   : /?s={q}&post_type=wp-manga
 *   List     : /novel/?m_orderby=latest  |  /novel/page/{n}/?m_orderby=latest
 *
 * Konten = text novel → getChapterPages() = []
 * Chapter title dibersihkan jadi "Chapter N" saja (tanpa judul panjang).
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types-manga';

const BASE = 'https://www.foxaholic.com';
const PER_PAGE = 24;

function absUrl(href: string | undefined | null): string {
	if (!href) return '';
	const h = String(href).trim();
	if (!h) return '';
	if (h.startsWith('//')) return `https:${h}`;
	if (/^https?:\/\//i.test(h)) return h;
	try {
		return new URL(h.startsWith('/') ? h : `/${h}`, BASE).href;
	} catch {
		return h;
	}
}

function pathOnly(href: string): string {
	try {
		const u = new URL(href.startsWith('http') ? href : absUrl(href));
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		const p = href.startsWith('/') ? href : `/${href}`;
		return p.replace(/\/$/, '') || '/';
	}
}

function cleanText(s: string): string {
	return (s || '')
		.replace(/\u00a0/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function decodeHtml(s: string): string {
	return (s || '')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#8217;|&rsquo;|&#39;/g, "'")
		.replace(/&#8220;|&ldquo;/g, '"')
		.replace(/&#8221;|&rdquo;/g, '"')
		.replace(/&#8211;|&ndash;/g, '–')
		.replace(/&#8212;|&mdash;/g, '—')
		.replace(/&nbsp;/g, ' ')
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function parseChapterNumber(text: string, fallback = 0): number {
	const t = cleanText(text);
	if (!t) return fallback;
	const m =
		t.match(/(?:chapter|ch\.?|c)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function shortChapterTitle(number: number): string {
	if (number > 0) return `Chapter ${number}`;
	return 'Chapter';
}

function normalizeStatus(raw: string): string {
	const v = (raw || '').toLowerCase();
	if (/complet|finish|end|tamat/i.test(v)) return 'Completed';
	if (/hiatus|on[\s-]?hold/i.test(v)) return 'Hiatus';
	if (/drop|cancel/i.test(v)) return 'Dropped';
	if (/ongoing|updating|active/i.test(v)) return 'Ongoing';
	return raw ? cleanText(raw) : 'Ongoing';
}

export class FoxaholicSource extends BaseSource {
	id = 'foxaholic';
	name = 'Foxaholic';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};


	async getLatestManga(page = 1): Promise<Manga[]> {
		if (page <= 1) {
			const fromHome = await this.parseLatestReleasesHome().catch(() => [] as Manga[]);
			if (fromHome.length >= 8) return fromHome.slice(0, PER_PAGE);
			return this.fetchNovelListPage(1);
		}
		return this.fetchNovelListPage(page);
	}

	private async parseLatestReleasesHome(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		const $ = cheerio.load(html);
		$('script, style, noscript, iframe').remove();

		const list: Manga[] = [];
		const seen = new Set<string>();
		const latestSection = $(
			'.c-page__content .page-content-listing, .c-blog-post, .slider__container, .manga-slider, .widget_recent_entries, .latest-releases, [class*="latest"]'
		);

		const containers =
			latestSection.length > 0
				? latestSection
				: $('body');

		containers.find('a[href*="/novel/"]').each((_, el) => {
			const href = $(el).attr('href') || '';
			const id = pathOnly(href);
			if (!/^\/novel\/[^/]+\/?$/.test(id) || /\/novel\/page\//i.test(id)) return;
			if (seen.has(id)) return;

			const title =
				cleanText($(el).attr('title') || '') ||
				cleanText($(el).find('img').attr('alt') || '') ||
				cleanText($(el).text());
			if (!title || title.length < 2) return;
			if (/^(read|chapter|view|more|see all|latest)/i.test(title)) return;

			const parent = $(el).closest(
				'.page-item-detail, .c-tabs-item__content, .manga-item, .item, .post, article, .col-6, .col-md-3, .col-sm-6, li, .slide-item'
			);
			const img =
				parent.find('img').first().attr('data-src') ||
				parent.find('img').first().attr('data-lazy-src') ||
				parent.find('img').first().attr('src') ||
				$(el).find('img').attr('data-src') ||
				$(el).find('img').attr('src') ||
				'';

			let latestChapter: number | undefined;
			const chText =
				parent.find('.chapter, .latest-chap, .chapter-item, .post-on').first().text() ||
				parent.find('a[href*="/novel/"]').filter((_, a) => {
					const h = $(a).attr('href') || '';
					return /\/novel\/[^/]+\/[^/]+/.test(h);
				}).first().text() ||
				'';
			const n = parseChapterNumber(chText);
			if (n > 0) latestChapter = n;

			seen.add(id);
			list.push({
				id,
				title: title.slice(0, 200),
				cover: absUrl((img || '').split('?')[0]),
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				...(latestChapter != null ? { latestChapter } : {})
			});
		});

		if (list.length < 8) {
			$('.page-item-detail, .c-tabs-item__content, .manga-item').each((_, el) => {
				const a = $(el).find('a[href*="/novel/"]').filter((_, link) => {
					const h = pathOnly($(link).attr('href') || '');
					return /^\/novel\/[^/]+\/?$/.test(h);
				}).first();
				const href = a.attr('href') || '';
				const id = pathOnly(href);
				if (!id || seen.has(id)) return;

				const title =
					cleanText(a.attr('title') || '') ||
					cleanText($(el).find('.post-title h3, .post-title h4, h3, h5').first().text()) ||
					cleanText(a.text());
				if (!title || title.length < 2) return;

				const img =
					$(el).find('img').first().attr('data-src') ||
					$(el).find('img').first().attr('src') ||
					'';
				const chText = $(el).find('.chapter a, .latest-chap a').first().text();
				const n = parseChapterNumber(chText);
				seen.add(id);
				list.push({
					id,
					title: title.slice(0, 200),
					cover: absUrl((img || '').split('?')[0]),
					sourceId: this.id,
					type: 'novel',
					lang: 'en',
					...(n > 0 ? { latestChapter: n } : {})
				});
			});
		}

		return this.dedupeById(list);
	}

	private async fetchNovelListPage(page: number): Promise<Manga[]> {
		const path =
			page <= 1
				? '/novel/?m_orderby=latest'
				: `/novel/page/${page}/?m_orderby=latest`;
		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			$('script, style, noscript').remove();

			const list: Manga[] = [];
			const seen = new Set<string>();

			$('.page-item-detail, .c-tabs-item__content, .manga-item, .page-listing-item').each(
				(_, el) => {
					const a = $(el)
						.find('a[href*="/novel/"]')
						.filter((_, link) => {
							const h = pathOnly($(link).attr('href') || '');
							return /^\/novel\/[^/]+\/?$/.test(h);
						})
						.first();
					const href = a.attr('href') || '';
					const id = pathOnly(href);
					if (!id || seen.has(id)) return;

					const title =
						cleanText(a.attr('title') || '') ||
						cleanText($(el).find('.post-title h3 a, .post-title h3, h3 a, h5 a').first().text()) ||
						cleanText(a.text());
					if (!title || title.length < 2) return;

					const img =
						$(el).find('img').first().attr('data-src') ||
						$(el).find('img').first().attr('data-lazy-src') ||
						$(el).find('img').first().attr('src') ||
						'';
					const chText =
						$(el).find('.chapter a, .latest-chap a, .chapter-item a').first().text() || '';
					const n = parseChapterNumber(chText);

					let status: string | undefined;
					const st = cleanText(
						$(el).find('.manga-title-badges, .status, .post-status').first().text()
					);
					if (st) status = normalizeStatus(st);

					seen.add(id);
					list.push({
						id,
						title: title.slice(0, 200),
						cover: absUrl((img || '').split('?')[0]),
						sourceId: this.id,
						type: 'novel',
						status,
						lang: 'en',
						...(n > 0 ? { latestChapter: n } : {})
					});
				}
			);

			return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[foxaholic] fetchNovelListPage', page, e);
			return [];
		}
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

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page ?? 1);
		if (!q) return this.getLatestManga(page);

		const path =
			page <= 1
				? `/?s=${encodeURIComponent(q)}&post_type=wp-manga`
				: `/page/${page}/?s=${encodeURIComponent(q)}&post_type=wp-manga`;

		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list: Manga[] = [];
			const seen = new Set<string>();

			$('.c-tabs-item__content, .page-item-detail, .tab-content-wrap .row .col-12').each(
				(_, el) => {
					const a = $(el).find('.post-title h3 a, .post-title h4 a, h3 a, h4 a').first();
					const href = a.attr('href') || $(el).find('a[href*="/novel/"]').first().attr('href') || '';
					const id = pathOnly(href);
					if (!id || !id.includes('/novel/') || seen.has(id)) return;
					if (!/^\/novel\/[^/]+\/?$/.test(id)) return;

					const title = cleanText(a.text() || a.attr('title') || '');
					if (!title || title.length < 2) return;

					const img =
						$(el).find('img').first().attr('data-src') ||
						$(el).find('img').first().attr('src') ||
						'';
					const chText = $(el).find('.latest-chap .chapter a, .chapter a').first().text();
					const n = parseChapterNumber(chText);

					seen.add(id);
					list.push({
						id,
						title: title.slice(0, 200),
						cover: absUrl((img || '').split('?')[0]),
						sourceId: this.id,
						type: 'novel',
						lang: 'en',
						...(n > 0 ? { latestChapter: n } : {})
					});
				}
			);

			return list;
		} catch (e) {
			console.error('[foxaholic] search', e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = pathOnly(mangaId);
		if (!path.startsWith('/novel/')) {
			path = `/novel/${path.replace(/^\//, '')}`;
		}
		path = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			cleanText($('.post-title h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '')
				.split(/\s*[|\-–]\s*/)[0]
				.trim() ||
			cleanText($('h1').first().text()) ||
			'';

		if (!title || title.length < 2) {
			throw new Error('Novel not found (empty title)');
		}

		let cover =
			$('.summary_image img').attr('data-src') ||
			$('.summary_image img').attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			$('.summary_image a img').attr('data-src') ||
			'';
		cover = absUrl((cover || '').split('?')[0]);

		let description =
			cleanText(
				$('.description-summary .summary__content, .summary__content, .manga-excerpt, .description-summary')
					.first()
					.text()
			) ||
			cleanText($('meta[name="description"]').attr('content') || '') ||
			'';
		if (description.length > 4000) description = description.slice(0, 4000) + '…';

		const authors: string[] = [];
		$('.author-content a, .artist-content a, a[href*="novel-author"], a[href*="/manga-author/"]').each(
			(_, a) => {
				const n = cleanText($(a).text());
				if (n && n.length < 80 && !authors.includes(n)) authors.push(n);
			}
		);
	
		if (!authors.length) {
			$('.post-content_item').each((_, el) => {
				const label = cleanText($(el).find('.summary-heading, h5').text()).toLowerCase();
				if (/author|artist/i.test(label)) {
					const val = cleanText($(el).find('.summary-content').text());
					if (val && !authors.includes(val)) authors.push(val);
				}
			});
		}

		const genres: string[] = [];
		$('.genres-content a, .wp-manga-tags a, a[href*="/genre/"], a[href*="/manga-genre/"]').each(
			(_, a) => {
				const g = cleanText($(a).text());
				if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
			}
		);

		$('.tags-content a, a[href*="/manga-tag/"]').each((_, a) => {
			const t = cleanText($(a).text());
			if (t && t.length < 40 && !genres.includes(t)) genres.push(t);
		});

		let status = 'Ongoing';
		let altTitle = '';
		let release = '';

		$('.post-content_item, .post-status').each((_, el) => {
			const label = cleanText($(el).find('.summary-heading, h5, .summary-heading h5').text()).toLowerCase();
			const val = cleanText($(el).find('.summary-content').text());
			if (!val) return;
			if (/status/i.test(label)) status = normalizeStatus(val);
			else if (/alternative|alt\.?\s*title|other name/i.test(label)) altTitle = val;
			else if (/release|year|published/i.test(label)) release = val;
			else if (/type/i.test(label) && !genres.includes(val)) {
				genres.unshift(val);
			}
		});

		const metaExtra: string[] = [];
		if (altTitle) metaExtra.push(`Alternative: ${altTitle}`);
		if (release) metaExtra.push(`Release: ${release}`);
		if (metaExtra.length) {
			description = (description ? description + '\n\n' : '') + metaExtra.join('\n');
		}

		let chapters = this.parseChaptersFromDom($);

		if (chapters.length < 3) {
			const ajaxChapters = await this.fetchChaptersAjax($, path).catch(() => [] as Chapter[]);
			if (ajaxChapters.length > chapters.length) chapters = ajaxChapters;
		}

		chapters.sort((a, b) => (b.number ?? 0) - (a.number ?? 0));

		const latestChapter = chapters.length > 0 ? chapters[0].number : undefined;

		return {
			id: path.replace(/\/$/, ''),
			title,
			cover,
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters,
			type: 'novel',
			lang: 'en',
			...(latestChapter != null ? { latestChapter } : {})
		};
	}

	private parseChaptersFromDom($: cheerio.CheerioAPI): Chapter[] {
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('li.wp-manga-chapter, .wp-manga-chapter, .version-chap li, .listing-chapters_wrap li').each(
			(i, el) => {
				const a = $(el).find('a').first();
				const href = a.attr('href') || '';
				if (!href) return;
				const id = pathOnly(href);
				if (!id.includes('/novel/') || seen.has(id)) return;
				if (!/\/novel\/[^/]+\/[^/]+/.test(id)) return;
				seen.add(id);

				const rawTitle = cleanText(a.text());
				const number = parseChapterNumber(rawTitle, chapters.length + 1);
				const date =
					cleanText($(el).find('.chapter-release-date, .release-date, i, time').first().text()) ||
					undefined;

				chapters.push({
					id,
					title: shortChapterTitle(number), // bersih: "Chapter N" saja
					number,
					date
				});
			}
		);

		return chapters;
	}

	private async fetchChaptersAjax(
		$: cheerio.CheerioAPI,
		_seriesPath: string
	): Promise<Chapter[]> {
		const holder = $('#manga-chapters-holder, .c-page__content #manga-chapters-holder');
		const novelId =
			holder.attr('data-id') ||
			$('input[name="manga_id"], #manga_id').attr('value') ||
			$('[data-id]').first().attr('data-id');
		if (!novelId) return [];

		try {
			const body = new URLSearchParams({
				action: 'manga_get_chapters',
				manga: String(novelId)
			});
			const res = await fetch(`${BASE}/wp-admin/admin-ajax.php`, {
				method: 'POST',
				headers: {
					...this.headers,
					'Content-Type': 'application/x-www-form-urlencoded',
					'X-Requested-With': 'XMLHttpRequest',
					Referer: BASE + '/'
				},
				body: body.toString()
			});
			if (!res.ok) return [];
			const ajaxHtml = await res.text();
			const $a = cheerio.load(ajaxHtml);
			return this.parseChaptersFromDom($a);
		} catch {
			return [];
		}
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
		const path = pathOnly(chapterId);
		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const blocked = $('.text-left a, .entry-content a, .reading-content a')
			.filter((_, a) => /chapter/i.test($(a).text()) && !!$(a).attr('href'))
			.first();
		if (blocked.length) {
			const realHref = blocked.attr('href');
			if (realHref && pathOnly(realHref) !== path) {
				return this.getChapterContent(pathOnly(realHref));
			}
		}

		const rawTitle =
			cleanText($('.wp-manga-nav .nav-links, h1, .chapter-title, .entry-title').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '') ||
			'Chapter';
		const number = parseChapterNumber(rawTitle);
		const title = shortChapterTitle(number > 0 ? number : 0) || rawTitle;

		let contentEl = $(
			'.entry-content_wrap, .reading-content, .text-left, .entry-content, .chapter-content, #chapter-content'
		).first();
		if (!contentEl.length) contentEl = $('article .entry-content, .c-blog-post').first();

		contentEl.find('script, style, noscript, iframe, .ads, .ad, .code-block, nav, .sharedaddy').remove();
		let content = contentEl.html() || contentEl.text() || '';

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		const prevA = $(
			'a.prev_page, a.btn.prev_page, .nav-previous a, a[rel="prev"], .wp-manga-nav a.prev'
		).first();
		const nextA = $(
			'a.next_page, a.btn.next_page, .nav-next a, a[rel="next"], .wp-manga-nav a.next'
		).first();

		if (prevA.length) {
			const h = prevA.attr('href') || '';
			if (h && /\/novel\//.test(h)) prevChapterId = pathOnly(h);
		}
		if (nextA.length) {
			const h = nextA.attr('href') || '';
			if (h && /\/novel\//.test(h)) nextChapterId = pathOnly(h);
		}

		if (!prevChapterId || !nextChapterId) {
			const options = $('.selectpicker option, select.chapter-select option, #single-pager option');
			const currentPath = path;
			const ids: string[] = [];
			options.each((_, opt) => {
				const v = $(opt).attr('data-redirect') || $(opt).attr('value') || '';
				if (v && /\/novel\//.test(v)) ids.push(pathOnly(v));
			});
			const idx = ids.findIndex((id) => id === currentPath || currentPath.startsWith(id));
			if (idx >= 0) {
		
				if (!nextChapterId && idx > 0) nextChapterId = ids[idx - 1];
				if (!prevChapterId && idx < ids.length - 1) prevChapterId = ids[idx + 1];
			}
		}

		return {
			title,
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default FoxaholicSource;
