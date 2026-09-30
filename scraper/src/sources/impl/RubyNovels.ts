/**
 * Ruby Novels (rubynovels.com) — Fictioneer theme novel site
 * Path: scraper/src/sources/impl/RubyNovels.ts
 *
 * - List: /stories/ + /stories/page/{n}/
 * - Homepage target: 24 titles (merge stories pages 1–3)
 * - Detail: /story/{slug}/
 * - Chapter: /story/{slug}/{chapter-slug}/
 * - Premium/password → isLocked: true
 * - Chapter title shortened to "Chapter N"
 * - Content: #chapter-content
 * - WP "by" names are translators, not original authors → skip as authors
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

function pathOnly(href: string, baseHost = 'https://rubynovels.com'): string {
	try {
		const u = new URL(
			href.startsWith('http')
				? href
				: `${baseHost}${href.startsWith('/') ? '' : '/'}${href}`
		);
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		return href.startsWith('/') ? href.replace(/\/$/, '') : `/${href}`;
	}
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function parseChapterNumber(text: string, fallback = 0): number {
	const t = (text || '').replace(/\s+/g, ' ').trim();
	const m =
		t.match(/(?:chapter|ch\.?|c)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\b(?:DHMM|BTAD|MR|IFPMHR|TCBD|TDBWMHB|MHF|TKPIMD)\s*(\d+)/i) ||
		t.match(/(\d+(?:\.\d+)?)/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function shortChapterTitle(number: number, raw?: string): string {
	if (number > 0) return `Chapter ${number}`;
	const n = parseChapterNumber(raw || '', 0);
	return n > 0 ? `Chapter ${n}` : 'Chapter';
}

/** Fictioneer date has .list-view + .grid-view → text() jadi dobel. Ambil satu saja. */
function cleanChapterDate($: cheerio.CheerioAPI, li: cheerio.Cheerio<any>): string {
	const dateRoot = li.find('.chapter-group__list-item-date, .date').first();
	const single =
		dateRoot.find('.list-view').first().text() ||
		dateRoot.find('.grid-view').first().text() ||
		dateRoot.find('span').first().text() ||
		dateRoot.text();
	let d = single.replace(/\s+/g, ' ').trim();
	// Kalau masih dobel (LongShort), potong di batas short format
	const dbl = d.match(
		/^((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i
	);
	if (dbl) return dbl[1];
	const short = d.match(/^([A-Z][a-z]{2}\s+\d{1,2},?\s+'?\d{2,4})/);
	if (short) return short[1];
	return d.slice(0, 32);
}

function isChapterLocked($: cheerio.CheerioAPI, a: any, li: cheerio.Cheerio<any>): boolean {
	const liClass = (li.attr('class') || '') + ' ' + ($(a).attr('class') || '');
	if (/\b_password\b|\bpassword\b|\b_locked\b|\blocked\b|\bpremium\b/i.test(liClass)) return true;
	if (li.find('.fa-lock, .fa-solid.fa-lock, [class*="lock"]').length > 0) return true;
	if ($(a).find('.fa-lock, [class*="lock"]').length > 0) return true;
	// Icon di sibling / subrow
	if (li.find('i.fa-lock, svg[class*="lock"]').length > 0) return true;
	const dataProtected =
		li.attr('data-password') ||
		li.attr('data-protected') ||
		$(a).attr('data-password') ||
		$(a).attr('data-protected');
	if (dataProtected && dataProtected !== '0' && dataProtected !== 'false') return true;
	return false;
}

/** WP authors on this site are translators, not original novel authors */
const SKIP_AUTHOR = /^(ruby|ruby\s*novels?|atlas\s*haven|atlas|wahab|red\s*rose|admin)$/i;

export class RubyNovelsSource extends BaseSource {
	id = 'rubynovels';
	name = 'Ruby Novels';
	baseUrl = 'https://rubynovels.com';
	kind = 'novel' as const;

	async getLatestManga(page = 1): Promise<Manga[]> {
		return this.getLatestNovels(page);
	}

	/** Hanya section "🆕 Latest Stories" di homepage — bukan /stories/ full list */
	async getLatestNovels(page = 1): Promise<Manga[]> {
		if (page > 1) return [];
		return this.parseLatestStories();
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

	/** Parse homepage section: <h2>🆕 Latest Stories</h2> + .wuxr-card */
	private async parseLatestStories(): Promise<Manga[]> {
		try {
			const html = await this.fetchHtml('/');
			const $ = cheerio.load(html);
			const list: Manga[] = [];
			const seen = new Set<string>();

			// Temukan heading Latest Stories, ambil section terdekat
			let section = $('h2')
				.filter((_, el) => /latest\s*stories/i.test($(el).text()))
				.closest('section, .wuxr-section, div')
				.first();

			if (!section.length) {
				// Fallback: section yang berisi wuxr-static-grid setelah teks Latest
				$('.wuxr-section, section').each((_, el) => {
					if (/latest\s*stories/i.test($(el).text().slice(0, 200))) {
						section = $(el);
						return false;
					}
				});
			}

			const root = section.length ? section : $.root();

			root.find('.wuxr-card').each((_, el) => {
				const item = this.parseWuxrCard($, el);
				if (item && !seen.has(item.id)) {
					seen.add(item.id);
					list.push(item);
				}
			});

			// Fallback: link di dalam section saja
			if (list.length < 2 && section.length) {
				section.find('a[href*="/story/"]').each((_, a) => {
					const href = $(a).attr('href') || '';
					const m = href.match(/\/story\/([a-z0-9\-]+)\/?$/i);
					if (!m) return;
					const id = `/story/${m[1]}`;
					if (seen.has(id)) return;
					const title =
						$(a).attr('title') ||
						$(a).find('.wuxr-card-title').text() ||
						$(a).text();
					const t = title.replace(/\s+/g, ' ').trim();
					if (!t || t.length < 3 || /read this story/i.test(t)) return;
					const img =
						$(a).closest('.wuxr-card').find('img').attr('src') ||
						$(a).find('img').attr('src') ||
						'';
					seen.add(id);
					list.push({
						id,
						title: t.slice(0, 200),
						cover: absUrl(this.baseUrl, (img || '').split('?')[0]),
						sourceId: this.id,
						type: 'novel',
						lang: 'en'
					});
				});
			}

			console.log(`[rubynovels] Latest Stories → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[rubynovels] parseLatestStories', e);
			return [];
		}
	}

	private parseWuxrCard($: cheerio.CheerioAPI, el: any): Manga | null {
		const root = $(el);
		const titleA = root.find('a.wuxr-card-title, a[href*="/story/"]').filter((_, a) => {
			const h = $(a).attr('href') || '';
			return /\/story\/[a-z0-9\-]+\/?$/i.test(h) && !/\/story\/[^/]+\/[^/]+/.test(h);
		}).first();

		const href = titleA.attr('href') || root.find('a.wuxr-card-cover-link').attr('href') || '';
		const m = href.match(/\/story\/([a-z0-9\-]+)/i);
		if (!m) return null;

		const id = `/story/${m[1]}`;
		const title =
			titleA.text().replace(/\s+/g, ' ').trim() ||
			root.find('img').attr('alt')?.trim() ||
			m[1];
		if (!title || title.length < 2) return null;

		const img = root.find('img').first();
		const cover =
			img.attr('data-src') || img.attr('data-lazy-src') || img.attr('src') || '';

		let latestChapter: number | undefined;
		const chText = root.find('.wuxr-meta-ch').first().text() || '';
		const n = parseChapterNumber(chText);
		if (n > 0) latestChapter = n;

		const badge = root.find('.wuxr-badge').first().text().trim();

		return {
			id,
			title: title.slice(0, 200),
			cover: absUrl(this.baseUrl, (cover || '').split('?')[0]),
			sourceId: this.id,
			type: badge || 'novel',
			lang: 'en',
			...(latestChapter != null ? { latestChapter } : {})
		};
	}

	private parseStoryCard($: cheerio.CheerioAPI, el: any): Manga | null {
		const root = $(el);

		const titleA = root
			.find('a.card__title, .card__title a, a[href*="/story/"]')
			.filter((_, a) => {
				const h = $(a).attr('href') || '';
				return /\/story\/[a-z0-9\-]+\/?$/i.test(h) && !/\/story\/[^/]+\/[^/]+/.test(h);
			})
			.first();

		const href =
			titleA.attr('href') || root.find('a[href*="/story/"]').first().attr('href') || '';
		const m = href.match(/\/story\/([a-z0-9\-]+)/i);
		if (!m) return null;

		const slug = m[1];
		const id = `/story/${slug}`;

		const title =
			titleA.text().replace(/\s+/g, ' ').trim() ||
			root.find('.card__title').first().text().replace(/\s+/g, ' ').trim() ||
			root.find('img').attr('alt')?.trim() ||
			slug;

		if (!title || title.length < 2) return null;

		const img = root.find('.card__image img, img.wp-post-image, img').first();
		const cover =
			img.attr('data-src') || img.attr('data-lazy-src') || img.attr('src') || '';

		let latestChapter: number | undefined;
		const chText =
			root.find('.card__footer-chapters').first().text() ||
			root.find('.card__link-list-link').first().text() ||
			'';
		const n = parseChapterNumber(chText);
		if (n > 0) latestChapter = n;

		const statusRaw =
			root.find('.card__footer-status').first().text().replace(/\s+/g, ' ').trim() || '';
		let status = 'Ongoing';
		if (/complete|completed|tamat/i.test(statusRaw)) status = 'Completed';
		else if (/hiatus/i.test(statusRaw)) status = 'Hiatus';
		else if (/ongoing/i.test(statusRaw)) status = 'Ongoing';

		return {
			id,
			title: title.slice(0, 200),
			cover: absUrl(this.baseUrl, (cover || '').split('?')[0]),
			sourceId: this.id,
			type: 'novel',
			status,
			lang: 'en',
			...(latestChapter != null ? { latestChapter } : {})
		};
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		return this.searchNovels(query, opts);
	}

	async searchNovels(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim();
		if (!q) return this.getLatestNovels(opts?.page ?? 1);

		const page = Math.max(1, opts?.page ?? 1);
		const path =
			page <= 1
				? `/?s=${encodeURIComponent(q)}`
				: `/page/${page}/?s=${encodeURIComponent(q)}`;

		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list: Manga[] = [];
			const seen = new Set<string>();

			$('.card__body, article.card, .card').each((_, el) => {
				const item = this.parseStoryCard($, el);
				if (item && !seen.has(item.id)) {
					seen.add(item.id);
					list.push(item);
				}
			});

			if (list.length < 2) {
				$('a[href*="/story/"]').each((_, a) => {
					const href = $(a).attr('href') || '';
					const m = href.match(/\/story\/([a-z0-9\-]+)\/?$/i);
					if (!m) return;
					const id = `/story/${m[1]}`;
					if (seen.has(id)) return;
					const title = ($(a).attr('title') || $(a).text()).replace(/\s+/g, ' ').trim();
					if (!title || title.length < 3) return;
					seen.add(id);
					list.push({
						id,
						title: title.slice(0, 200),
						cover: '',
						sourceId: this.id,
						type: 'novel',
						lang: 'en'
					});
				});
			}

			console.log(`[rubynovels] search "${q}" → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[rubynovels] search', e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		return this.getNovelDetails(mangaId);
	}

	async getNovelDetails(novelId: string): Promise<MangaDetails> {
		let path = pathOnly(novelId, this.baseUrl);
		if (!path.startsWith('/story/')) {
			path = `/story/${path.replace(/^\//, '')}`;
		}
		path = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			$('h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/\s*[|\-–]\s*/)[0]?.trim() ||
			path.split('/').filter(Boolean).pop() ||
			'';

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('.story__thumbnail img, .story-cover img, img.wp-post-image')
				.first()
				.attr('data-src') ||
			$('.story__thumbnail img, .story-cover img, img.wp-post-image').first().attr('src') ||
			$('img[src*="uploads"]').first().attr('src') ||
			'';
		cover = absUrl(this.baseUrl, (cover || '').split('?')[0]);

		const description =
			$('.story__summary, .story-summary, .summary, [class*="summary"]')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('meta[name="description"]').attr('content')?.trim() ||
			$('meta[property="og:description"]').attr('content')?.trim() ||
			'';

		// WP "by" = translator accounts — jangan jadikan author
		const authors: string[] = [];
		$('a[href*="/author/"]').each((_, a) => {
			const n = $(a).text().replace(/\s+/g, ' ').trim();
			if (n && !SKIP_AUTHOR.test(n) && !authors.includes(n)) authors.push(n);
		});

		const genres: string[] = [];
		$('a[href*="/genre/"], a[href*="/tag/"]').each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		let status = 'Ongoing';
		const statusText = $('.story__status, [class*="status"]').first().text();
		if (/complete/i.test(statusText)) status = 'Completed';
		else if (/hiatus/i.test(statusText)) status = 'Hiatus';

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('a.chapter-group__list-item-link, li.chapter-group__list-item a[href*="/story/"]').each(
			(_, a) => {
				const href = $(a).attr('href') || '';
				const cm = href.match(/\/story\/([a-z0-9\-]+)\/([a-z0-9\-]+)\/?$/i);
				if (!cm) return;

				const id = `/story/${cm[1]}/${cm[2]}`;
				if (seen.has(id)) return;
				seen.add(id);

				const rawTitle = $(a).text().replace(/\s+/g, ' ').trim() || cm[2];
				const number = parseChapterNumber(rawTitle, chapters.length + 1);

				const li = $(a).closest('li, .chapter-group__list-item');
				const locked = isChapterLocked($, a, li);
				const date = cleanChapterDate($, li);

				chapters.push({
					id,
					title: shortChapterTitle(number, rawTitle),
					number,
					date,
					...(locked ? { isLocked: true } : {})
				});
			}
		);

		if (!chapters.length) {
			$('a[href*="/story/"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const cm = href.match(/\/story\/([a-z0-9\-]+)\/([a-z0-9\-]+)\/?$/i);
				if (!cm) return;
				const id = `/story/${cm[1]}/${cm[2]}`;
				if (seen.has(id)) return;
				seen.add(id);
				const rawTitle = $(a).text().replace(/\s+/g, ' ').trim() || cm[2];
				const number = parseChapterNumber(rawTitle, chapters.length + 1);
				const li = $(a).closest('li, .chapter-group__list-item');
				const locked = isChapterLocked($, a, li);
				const date = cleanChapterDate($, li);
				chapters.push({
					id,
					title: shortChapterTitle(number, rawTitle),
					number,
					date,
					...(locked ? { isLocked: true } : {})
				});
			});
		}

		chapters.sort((a, b) => (b.number ?? 0) - (a.number ?? 0));

		console.log(
			`[rubynovels] details ${path} → ${chapters.length} ch (${chapters.filter((c) => c.isLocked).length} locked)`
		);

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
			latestChapter: chapters[0]?.number
		};
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
		let path = pathOnly(chapterId, this.baseUrl);
		if (!path.startsWith('/story/')) {
			path = `/story/${path.replace(/^\//, '')}`;
		}
		path = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const bodyText = $('body').text().toLowerCase();
		const hasPasswordForm =
			$('input[type="password"], form[class*="password"], .password-note, .chapter-password')
				.length > 0;
		if (
			hasPasswordForm ||
			(/password|ruby coins|premium|subscribers only|locked chapter/i.test(bodyText) &&
				$('#chapter-content p, .chapter__content p').length < 3)
		) {
			throw new Error('Chapter is locked / premium on Ruby Novels');
		}

		const rawTitle =
			$('.chapter__title, h1.chapter__title, h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/\s*[|\-–]\s*/)[0]?.trim() ||
			'';
		const number = parseChapterNumber(rawTitle, 0);
		const title = shortChapterTitle(number, rawTitle);

		const contentEl = $('#chapter-content, .chapter__content, .chapter-content').first();
		contentEl.find('script, style, noscript, .ads, .ad, iframe, .chapter__support').remove();

		let contentHtml = contentEl.html() || '';
		contentHtml = contentHtml
			.replace(/<script[\s\S]*?<\/script>/gi, '')
			.replace(/<style[\s\S]*?<\/style>/gi, '')
			.replace(/on\w+="[^"]*"/gi, '')
			.trim();

		if (!contentHtml || contentHtml.length < 40) {
			const paras = contentEl
				.find('p')
				.map((_, p) => $(p).text().trim())
				.get()
				.filter((t) => t.length > 5);
			if (paras.length) {
				contentHtml = paras.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
			}
		}

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		$('a[href*="/story/"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const cm = href.match(/\/story\/([a-z0-9\-]+)\/([a-z0-9\-]+)\/?$/i);
			if (!cm) return;
			const id = `/story/${cm[1]}/${cm[2]}`;
			const label = ($(a).text() + ' ' + ($(a).attr('aria-label') || '')).toLowerCase();
			const cls = ($(a).attr('class') || '').toLowerCase();
			if (/prev|previous|sebelum/i.test(label) || /prev/i.test(cls)) {
				prevChapterId = id;
			} else if (/next|lanjut|berikut/i.test(label) || /next/i.test(cls)) {
				nextChapterId = id;
			}
		});

		console.log(`[rubynovels] chapter ${path} → content=${contentHtml.length} chars`);

		return {
			title,
			content: contentHtml || '<p>No content</p>',
			prevChapterId,
			nextChapterId
		};
	}
}

export default RubyNovelsSource;
