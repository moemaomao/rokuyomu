/**
 * Puffberry.top — Fictioneer (WordPress) novel site
 * Path: scraper/src/sources/impl/novel/Puffberry.ts
 *
 * - Homepage Latest Updates → 24 judul
 * - Novel list: /novels/ + /novels/page/{n}/
 * - Story: /story/{slug}/
 * - Chapter: /story/{slug}/{chapter-slug}/
 * - Search: /?s={q}
 * - Premium chapters: li.chapter-group__list-item._premium → isLocked + lock badge
 * - Chapter list: title bersih (Chapter N), tanpa judul novel
 * - Pagination + prev/next chapter content
 * - fetchWithCf via BaseSource.fetchHtml
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://puffberry.top';
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
		.replace(/&nbsp;/g, ' ');
}

function stripHtml(html: string): string {
	return decodeHtml(
		(html || '')
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/p>/gi, '\n\n')
			.replace(/<\/div>/gi, '\n')
			.replace(/<[^>]+>/g, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
}

function parseChapterNumber(text: string, fallback = 0): number {
	const t = cleanText(text);
	if (!t) return fallback;
	// Prefer C75 / Chapter 75 / Ch. 12 patterns
	const m =
		t.match(/(?:^|\s)c(?:h(?:apter)?)?\.?\s*(\d+(?:\.\d+)?)\b/i) ||
		t.match(/(?:chapter|chap|ep\.?|episode)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\b(\d+(?:\.\d+)?)\s*$/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	if (/prologue/i.test(t)) return 0;
	const any = t.match(/\b(\d+(?:\.\d+)?)\b/);
	return any ? parseFloat(any[1]) : fallback;
}

/** Chapter title bersih: "Chapter 12" saja, tanpa judul novel */
function cleanChapterTitle(raw: string, number: number): string {
	const t = cleanText(raw);
	// Buang prefix judul novel yang biasanya di depan "C12" / "Chapter 12"
	const stripped = t
		.replace(/^.*?\b(?:chapter|ch\.?|c)\s*(\d+(?:\.\d+)?)\b.*$/i, (_, n) => `Chapter ${n}`)
		.replace(/^.*?\b(\d+(?:\.\d+)?)\s*$/i, (_, n) => `Chapter ${n}`);
	if (/^Chapter\s+\d/i.test(stripped)) return stripped;
	if (number > 0) return `Chapter ${number}`;
	if (/prologue/i.test(t)) return 'Prologue';
	return t.slice(0, 80) || (number > 0 ? `Chapter ${number}` : 'Chapter');
}

function normalizeStatus(raw: string): string {
	const v = (raw || '').toLowerCase();
	if (/complet|finish|end|tamat/i.test(v)) return 'Completed';
	if (/hiatus|on[\s-]?hold/i.test(v)) return 'Hiatus';
	if (/drop|cancel/i.test(v)) return 'Dropped';
	if (/ongoing|updating|active/i.test(v)) return 'Ongoing';
	return raw ? cleanText(raw) : 'Ongoing';
}

function isStoryPath(id: string): boolean {
	// /story/slug  (bukan chapter)
	return /^\/story\/[^/]+\/?$/.test(id);
}

function isChapterPath(id: string): boolean {
	return /^\/story\/[^/]+\/[^/]+\/?$/.test(id);
}

export class PuffberrySource extends BaseSource {
	id = 'puffberry';
	name = 'Puffberry';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	// ─── Latest (homepage Latest Updates → 24 judul) ─────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		const pageNum = Math.max(1, page);
		if (pageNum <= 1) {
			const fromHome = await this.parseLatestUpdatesHome().catch(() => [] as Manga[]);
			if (fromHome.length >= 8) return fromHome.slice(0, PER_PAGE);
			return this.fetchNovelsPage(1);
		}
		return this.fetchNovelsPage(pageNum);
	}

	/** Ambil dari section "Latest Updates" di homepage */
	private async parseLatestUpdatesHome(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		const $ = cheerio.load(html);
		$('script, style, noscript, iframe').remove();

		const list: Manga[] = [];
		const seen = new Set<string>();

		// Prioritas: section Latest Updates
		let $section = $('h2.wp-block-heading')
			.filter((_, el) => /Latest Updates/i.test($(el).text()))
			.first()
			.nextAll('section, div, ul')
			.first();

		if (!$section.length) {
			$section = $('.latest-updates, [class*="latest-update"], .card-block').first();
		}
		if (!$section.length) {
			$section = $('body');
		}

		const parseCard = (el: any) => {
			const $el = $(el);
			const a =
				$el.find('a.card__image, a[href*="/story/"]').filter((_, link) => {
					const p = pathOnly($(link).attr('href') || '');
					return isStoryPath(p);
				}).first() ||
				$el.find('a[href*="/story/"]').first();

			const href = a.attr('href') || $el.attr('href') || '';
			const id = pathOnly(href);
			if (!isStoryPath(id) || seen.has(id)) return;

			const title =
				cleanText(a.attr('title') || '') ||
				cleanText($el.find('.card__title, h3, h4, .post-title, a.card__title').first().text()) ||
				cleanText(a.text());
			if (!title || title.length < 2) return;
			if (/^(read|chapter|view|more|see all|latest|c\d+)/i.test(title)) return;

			const img =
				$el.find('img').first().attr('data-src') ||
				$el.find('img').first().attr('data-lazy-src') ||
				$el.find('img').first().attr('src') ||
				a.find('img').attr('src') ||
				'';

			let latestChapter: number | undefined;
			const chBadge = cleanText(
				$el.find('[class*="chapter"], .card__footer, .card__meta, time').first().text() ||
					$el.find('a[href*="-c"]').first().text()
			);
			const n = parseChapterNumber(chBadge);
			if (n > 0) latestChapter = n;

			let status: string | undefined;
			const stText = cleanText($el.text());
			if (/Ongoing/i.test(stText)) status = 'Ongoing';
			else if (/Completed/i.test(stText)) status = 'Completed';
			else if (/Hiatus/i.test(stText)) status = 'Hiatus';

			seen.add(id);
			list.push({
				id,
				title: title.slice(0, 200),
				cover: absUrl((img || '').split('?')[0]),
				sourceId: this.id,
				type: 'novel',
				status,
				lang: 'en',
				...(latestChapter != null ? { latestChapter } : {})
			});
		};

		// Card di Latest Updates
		$section.find('.card, li.card, .post-card, article.card, [class*="card"]').each((_, el) => {
			parseCard(el);
		});

		// Fallback: semua link story unik di section
		if (list.length < 8) {
			$section.find('a[href*="/story/"]').each((_, el) => {
				const href = $(el).attr('href') || '';
				const id = pathOnly(href);
				if (!isStoryPath(id) || seen.has(id)) return;
				const title =
					cleanText($(el).attr('title') || '') ||
					cleanText($(el).find('img').attr('alt') || '') ||
					cleanText($(el).text());
				if (!title || title.length < 3) return;
				const img =
					$(el).find('img').attr('src') ||
					$(el).closest('.card, li, article').find('img').attr('src') ||
					'';
				seen.add(id);
				list.push({
					id,
					title: title.slice(0, 200),
					cover: absUrl((img || '').split('?')[0]),
					sourceId: this.id,
					type: 'novel',
					lang: 'en'
				});
			});
		}

		// Kalau masih kurang, ambil dari Latest Stories carousel juga
		if (list.length < PER_PAGE) {
			$('.latest-stories .card, .small-card-block .card, .splide__slide .card').each((_, el) => {
				parseCard(el);
			});
		}

		return this.dedupeById(list).slice(0, PER_PAGE);
	}

	/** /novels/ + pagination */
	private async fetchNovelsPage(page: number): Promise<Manga[]> {
		const path =
			page <= 1 ? '/novels/' : `/novels/page/${page}/`;
		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			$('script, style, noscript').remove();

			const list: Manga[] = [];
			const seen = new Set<string>();

			$('.card, li.card, article.card, .post-card, [class*="_story"]').each((_, el) => {
				const $el = $(el);
				const a = $el
					.find('a[href*="/story/"]')
					.filter((_, link) => isStoryPath(pathOnly($(link).attr('href') || '')))
					.first();
				const href = a.attr('href') || '';
				const id = pathOnly(href);
				if (!isStoryPath(id) || seen.has(id)) return;

				const title =
					cleanText(a.attr('title') || '') ||
					cleanText($el.find('.card__title, h3, h4, a.card__title').first().text()) ||
					cleanText(a.text());
				if (!title || title.length < 2) return;

				const img =
					$el.find('img').first().attr('data-src') ||
					$el.find('img').first().attr('src') ||
					'';

				let latestChapter: number | undefined;
				const meta = cleanText($el.find('.card__footer, .card__meta, time').text());
				const n = parseChapterNumber(meta);
				if (n > 0) latestChapter = n;

				let status: string | undefined;
				const body = cleanText($el.text());
				if (/Ongoing/i.test(body)) status = 'Ongoing';
				else if (/Completed/i.test(body)) status = 'Completed';
				else if (/Hiatus/i.test(body)) status = 'Hiatus';

				seen.add(id);
				list.push({
					id,
					title: title.slice(0, 200),
					cover: absUrl((img || '').split('?')[0]),
					sourceId: this.id,
					type: 'novel',
					status,
					lang: 'en',
					...(latestChapter != null ? { latestChapter } : {})
				});
			});

			return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[puffberry] fetchNovelsPage', page, e);
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

		// Fictioneer search: /?s=query  (+ page/n/ untuk pagination)
		const path =
			page <= 1
				? `/?s=${encodeURIComponent(q)}`
				: `/page/${page}/?s=${encodeURIComponent(q)}`;

		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list: Manga[] = [];
			const seen = new Set<string>();

			// Hasil search bisa chapter atau story — prioritaskan story card
			$('.card, article, .search-result, li').each((_, el) => {
				const $el = $(el);
				// Skip pure chapter results yang menunjuk ke -cN
				const storyLink = $el
					.find('a[href*="/story/"]')
					.filter((_, a) => isStoryPath(pathOnly($(a).attr('href') || '')))
					.first();
				let href = storyLink.attr('href') || '';
				// Kadang hanya chapter link; ambil parent story
				if (!href) {
					const ch = $el.find('a[href*="/story/"]').first().attr('href') || '';
					const m = pathOnly(ch).match(/^(\/story\/[^/]+)/);
					if (m) href = m[1];
				}
				const id = pathOnly(href);
				if (!isStoryPath(id) || seen.has(id)) return;

				const title =
					cleanText(storyLink.attr('title') || '') ||
					cleanText($el.find('h2, h3, h4, .card__title, .entry-title').first().text()) ||
					cleanText(storyLink.text());
				if (!title || title.length < 2) return;
				// Skip judul yang cuma "C75" dll
				if (/^c\d+$/i.test(title) || /chapter\s*\d+$/i.test(title)) return;

				const img =
					$el.find('img').first().attr('data-src') ||
					$el.find('img').first().attr('src') ||
					'';

				seen.add(id);
				list.push({
					id,
					title: title.slice(0, 200),
					cover: absUrl((img || '').split('?')[0]),
					sourceId: this.id,
					type: 'novel',
					lang: 'en'
				});
			});

			// Fallback: kumpulkan story unik dari semua link
			if (list.length < 4) {
				$('a[href*="/story/"]').each((_, el) => {
					const href = $(el).attr('href') || '';
					const id = pathOnly(href);
					let storyId = id;
					if (isChapterPath(id)) {
						const m = id.match(/^(\/story\/[^/]+)/);
						if (m) storyId = m[1];
					}
					if (!isStoryPath(storyId) || seen.has(storyId)) return;
					const title = cleanText($(el).attr('title') || $(el).text());
					if (!title || title.length < 3 || /^c\d+$/i.test(title)) return;
					seen.add(storyId);
					list.push({
						id: storyId,
						title: title.slice(0, 200),
						cover: '',
						sourceId: this.id,
						type: 'novel',
						lang: 'en'
					});
				});
			}

			return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[puffberry] search', e);
			return [];
		}
	}

	// ─── Details + chapter list ──────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = pathOnly(mangaId);
		if (!path.startsWith('/story/')) {
			path = `/story/${path.replace(/^\//, '')}`;
		}
		// Pastikan hanya story path, buang chapter slug jika ada
		const m = path.match(/^(\/story\/[^/]+)/);
		if (m) path = m[1];
		path = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			cleanText($('h1.story__identity-title, h1.singular__title, h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '')
				.split(/\s*[|\-–]\s*Puffberry/i)[0]
				.trim() ||
			'';

		if (!title || title.length < 2) {
			throw new Error('Novel not found (empty title)');
		}

		let cover =
			$('.story__thumbnail img, .wp-post-image, img.wp-post-image').first().attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			$('.header-background img, [class*="cover"] img').first().attr('src') ||
			'';
		cover = absUrl((cover || '').split('?')[0]);

		// Description
		let description = '';
		const descEl = $(
			'.story__content, .story-content, .content-section .wp-block-post-content, .singular__content > p'
		).first();
		if (descEl.length) {
			description = stripHtml(descEl.html() || descEl.text()).slice(0, 4000);
		}
		if (!description) {
			description =
				cleanText($('meta[name="description"]').attr('content') || '') ||
				cleanText($('meta[property="og:description"]').attr('content') || '');
		}

		// Author
		const authors: string[] = [];
		$('a[href*="/author/"], .story__meta a[rel="author"], .byline a, .author a').each((_, a) => {
			const n = cleanText($(a).text());
			if (n && n.length < 80 && !/berry|admin|login/i.test(n) && !authors.includes(n)) {
				authors.push(n);
			}
		});
		// Situs ini sering "by berry"
		if (!authors.length) {
			const by = cleanText($('.story__meta, .byline, .author').first().text());
			const am = by.match(/by\s+([^\n|,]+)/i);
			if (am) authors.push(cleanText(am[1]));
		}
		if (!authors.length) authors.push('berry');

		// Genres / tags
		const genres: string[] = [];
		$(
			'a[href*="/tag/"], a[href*="/genre/"], a[href*="/fcn_genre/"], .tag-cloud a, .story__taxonomies a, .genre a'
		).each((_, a) => {
			const n = cleanText($(a).text());
			if (n && n.length < 60 && !genres.includes(n)) genres.push(n);
		});

		// Status
		let status = 'Ongoing';
		const bodyText = cleanText($('body').text());
		if (/\bCompleted\b/i.test(bodyText)) status = 'Completed';
		else if (/\bHiatus\b/i.test(bodyText)) status = 'Hiatus';
		else if (/\bOngoing\b/i.test(bodyText)) status = 'Ongoing';

		// Chapters
		const chapters = this.parseChapterList($, path);

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
			...(chapters.length ? { latestChapter: chapters[0]?.number } : {})
		};
	}

	/**
	 * Parse chapter list dari story page.
	 * - Title bersih: "Chapter N" saja
	 * - isLocked = true jika class _premium (paywall / gembok)
	 * - Sort newest first
	 */
	private parseChapterList($: cheerio.CheerioAPI, storyPath: string): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();
		const storySlug = storyPath.replace(/^\/story\//, '').replace(/\/$/, '');

		$('li.chapter-group__list-item, .chapter-group__list-item').each((_, el) => {
			const $li = $(el);
			// Skip fold toggle rows
			if ($li.hasClass('_folding-toggle')) return;

			const a = $li.find('a.chapter-group__list-item-link, a[href*="/story/"]').first();
			const href = a.attr('href') || '';
			const id = pathOnly(href);
			if (!isChapterPath(id) || seen.has(id)) return;

			const rawTitle = cleanText(a.text() || a.attr('title') || '');
			const number = parseChapterNumber(rawTitle || id);
			const title = cleanChapterTitle(rawTitle, number);

			const date =
				$li.find('time').attr('datetime') ||
				cleanText($li.find('time .list-view, time').first().text()) ||
				undefined;

			// Premium / paywall → gembok
			const isLocked =
				$li.hasClass('_premium') ||
				!!$li.find('.fa-lock, [class*="lock"], [class*="premium"]').length ||
				/fa-lock|_premium/i.test($li.attr('class') || '');

			seen.add(id);
			out.push({
				id,
				title,
				number: number || out.length + 1,
				date: date || undefined,
				isLocked
			});
		});

		// Fallback kalau selector Fictioneer berubah
		if (out.length === 0) {
			$(`a[href*="/story/${storySlug}/"]`).each((_, el) => {
				const href = $(el).attr('href') || '';
				const id = pathOnly(href);
				if (!isChapterPath(id) || seen.has(id)) return;
				const rawTitle = cleanText($(el).text() || $(el).attr('title') || '');
				const number = parseChapterNumber(rawTitle || id);
				seen.add(id);
				out.push({
					id,
					title: cleanChapterTitle(rawTitle, number),
					number: number || out.length + 1,
					isLocked: false
				});
			});
		}

		// Newest first
		out.sort((a, b) => b.number - a.number);
		return out;
	}

	// ─── Chapter content (novel reader) ──────────────────────────────────

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
		if (!isChapterPath(path)) {
			throw new Error(`Invalid chapter id: ${chapterId}`);
		}

		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		// Locked / premium gate
		const bodyText = $('body').text().toLowerCase();
		if (
			(/premium|unlock|purchase|buy berrys|paywall|locked chapter/i.test(bodyText) &&
				!$('.chapter__content, .chapter-content, article .content, .entry-content').length) ||
			$('.password-form, .chapter-password, [class*="paywall"]').length
		) {
			throw new Error('Chapter is locked / premium on Puffberry');
		}

		const rawTitle =
			cleanText($('h1.chapter__identity-title, h1.singular__title, h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '').split(/\s*[|\-–]/)[0] ||
			'Chapter';
		const number = parseChapterNumber(rawTitle || path);
		const title = cleanChapterTitle(rawTitle, number);

		// Content body
		let contentHtml = '';
		const contentSelectors = [
			'.chapter__content',
			'.chapter-content',
			'article.chapter .content',
			'.entry-content',
			'.post-content',
			'main.chapter .content-section',
			'[class*="chapter-content"]'
		];
		for (const sel of contentSelectors) {
			const el = $(sel).first();
			if (el.length) {
				el.find('script, style, noscript, iframe, .ads, .ad, nav, .chapter-nav, .share').remove();
				contentHtml = el.html() || '';
				if (contentHtml && contentHtml.length > 80) break;
			}
		}

		// Fallback: main text blocks
		if (!contentHtml || contentHtml.length < 80) {
			const main = $('main, article, .singular__content').first();
			main.find('script, style, nav, header, footer, .ads, .chapter-nav').remove();
			contentHtml = main.html() || '';
		}

		// Bersihkan iklan / noise yang sering muncul di Fictioneer
		contentHtml = (contentHtml || '')
			.replace(/Discover more[\s\S]*?(?=<p|$)/gi, '')
			.replace(/Book a Safari[\s\S]*?(?=<p|$)/gi, '')
			.replace(/Shop Terrariums[\s\S]*?(?=<p|$)/gi, '')
			.replace(/Try Organic Teas[\s\S]*?(?=<p|$)/gi, '')
			.replace(/Study Biology[\s\S]*?(?=<p|$)/gi, '')
			.replace(/Find Grief Support[\s\S]*?(?=<p|$)/gi, '');

		let content = contentHtml.trim();
		// Jika plain text, bungkus jadi paragraf
		if (content && !/<p|<br|<div/i.test(content)) {
			content = content
				.split(/\n{2,}/)
				.map((p) => `<p>${escapeHtml(p.trim())}</p>`)
				.join('');
		}

		// Prev / Next
		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		const prevA =
			$('a.button._previous, a._previous, a[rel="prev"], a.micro-menu__previous, a.previous').first() ||
			$('a').filter((_, a) => /prev(ious)?/i.test($(a).text())).first();
		const nextA =
			$('a.button._next, a._next, a[rel="next"], a.micro-menu__next, a.next').first() ||
			$('a').filter((_, a) => /^next$/i.test(cleanText($(a).text()))).first();

		if (prevA.length) {
			const p = pathOnly(prevA.attr('href') || '');
			if (isChapterPath(p)) prevChapterId = p;
		}
		if (nextA.length) {
			const n = pathOnly(nextA.attr('href') || '');
			if (isChapterPath(n)) nextChapterId = n;
		}

		// Fallback dari micro-menu / chapter nav
		if (!prevChapterId || !nextChapterId) {
			$('a[href*="/story/"]').each((_, el) => {
				const href = $(el).attr('href') || '';
				const id = pathOnly(href);
				if (!isChapterPath(id)) return;
				const cls = ($(el).attr('class') || '') + ' ' + cleanText($(el).text());
				if (!prevChapterId && /prev|previous/i.test(cls)) prevChapterId = id;
				if (!nextChapterId && /next/i.test(cls) && !/previous/i.test(cls)) nextChapterId = id;
			});
		}

		return {
			title,
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export default PuffberrySource;
