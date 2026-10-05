/**
 * NoiceTranslations.com — Madara theme (novel / fan TL)
 * Path: scraper/src/sources/impl/novel/NoiceTranslations.ts
 *
 * URL:
 *   Novel   : /manga/{slug}/
 *   Chapter : /manga/{slug}/chapter-N/
 *   Latest  : /  (Latest Series) + /page/{n}/
 *   Search  : /?s={q}&post_type=wp-manga
 *   Chapters AJAX: POST /manga/{slug}/ajax/chapters/?t=1
 *
 * Locked chapters: class premium-block / premium / coin-N  (href often "#")
 * Free chapters: class free-chap
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://noicetranslations.com';
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

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function parseChapterNumber(title: string, fallback = 0): number {
	const t = cleanText(title);
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

function extractChapterNum(text: string): number | undefined {
	const t = cleanText(text);
	if (!t) return undefined;
	const m =
		t.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/(\d+(?:\.\d+)?)/);
	if (!m) return undefined;
	const n = parseFloat(m[1]);
	return Number.isNaN(n) ? undefined : n;
}

function isLockedChapter($: cheerio.CheerioAPI, el: any): boolean {
	const $el = $(el);
	const cls = (
		($el.attr('class') || '') +
		' ' +
		($el.find('a').first().attr('class') || '')
	)
		.toLowerCase()
		.trim();

	if (/\bfree-chap\b/.test(cls)) return false;
	if (/\bfree\b/.test(cls) && !/\bpremium\b/.test(cls)) return false;

	if (
		/\bpremium-block\b|\bpremium\b|\bto_be_free\b|\bcoin-\d+\b|\bpaid\b|\bpaywall\b|\blocked\b/.test(
			cls
		)
	) {
		return true;
	}

	const text = $el.text().replace(/\s+/g, ' ').toLowerCase();
	if (/\bunlocks?\s+in\b/.test(text)) return true;

	const href = ($el.find('a').first().attr('href') || '').trim();
	if (
		(!href || href === '#' || href.startsWith('javascript')) &&
		/chapter\s*\d/i.test(text)
	) {
		return true;
	}

	return false;
}

function cleanDate(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	let t = raw.replace(/\s+/g, ' ').trim();
	if (!t) return undefined;
	t = t.replace(/unlocks?\s+in\s+[\s\S]*$/i, '').trim();
	t = t.replace(/^(?:free\s*)?chapter\s*\d+(?:\.\d+)?\s*:?\s*/i, '').trim();
	const half = Math.floor(t.length / 2);
	if (half > 4) {
		const a = t.slice(0, half).trim();
		const b = t.slice(half).trim();
		if (a === b) t = a;
	}
	const parts = t
		.split(/\s{2,}|\s*\|\s*/)
		.map((p) => p.trim())
		.filter(Boolean);
	if (parts.length === 2 && parts[0] === parts[1]) t = parts[0];
	return t || undefined;
}

function normalizeStatus(raw: string): string | undefined {
	const v = cleanText(raw || '').toLowerCase();
	if (!v) return undefined;
	if (/^(new|hot|trending|featured|popular|update|updated)$/i.test(v)) return undefined;
	if (/complet|finish|end|tamat/i.test(v)) return 'Completed';
	if (/hiatus|on[\s-]?hold/i.test(v)) return 'Hiatus';
	if (/drop|cancel/i.test(v)) return 'Dropped';
	if (/ongoing|on[\s-]?going|updating|active/i.test(v)) return 'Ongoing';

	return undefined;
}

function isNovelPath(path: string): boolean {
	return /^\/manga\/[^/]+\/?$/.test(path) && !/\/manga\/page\//i.test(path);
}

export class NoiceTranslationsSource extends BaseSource {
	id = 'noicetranslations';
	name = 'Noice Translations';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept:
			'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	async getLatestManga(page = 1): Promise<Manga[]> {
		if (page <= 1) {
			const fromHome = await this.parseLatestSeriesHome().catch(
				() => [] as Manga[]
			);
			if (fromHome.length >= 8) {
				return this.dedupeById(fromHome).slice(0, PER_PAGE);
			}
			return this.fetchListingPage(1);
		}
		return this.fetchListingPage(page);
	}

	private assertNotCf(html: string): void {
		const low = html.slice(0, 2000).toLowerCase();
		if (
			(low.includes('just a moment') ||
				low.includes('cf-browser-verification') ||
				low.includes('challenge-platform') ||
				low.includes('checking your browser')) &&
			html.length < 25000
		) {
			throw new Error(
				'Cloudflare blocked this request (set BYPARR_URL / use fetchWithCf)'
			);
		}
	}

	private async parseLatestSeriesHome(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		this.assertNotCf(html);
		const $ = cheerio.load(html);
		$('script, style, noscript, iframe').remove();

		const list: Manga[] = [];
		const seen = new Set<string>();

		const cards = $(
			'.page-item-detail, .c-tabs-item__content, .page-listing-item, .manga, .badge-ext-1'
		);
		if (cards.length) {
			cards.each((_, el) => {
				const item = this.parseCard($, el);
				if (item && !seen.has(item.id)) {
					seen.add(item.id);
					list.push(item);
				}
			});
		}

		$('a[href*="/manga/"]').each((_, el) => {
			const href = $(el).attr('href') || '';
			const id = pathOnly(href);
			if (!isNovelPath(id) || seen.has(id)) return;

			const title =
				cleanText($(el).attr('title') || '') ||
				cleanText($(el).find('img').attr('alt') || '') ||
				cleanText($(el).text());
			if (!title || title.length < 2) return;
			if (/^(read|chapter|view|more|see all|latest|new)$/i.test(title)) return;

			const parent = $(el).closest(
				'.page-item-detail, .c-tabs-item__content, .page-listing-item, .item, article, li, .col-6, .col-md-3, .col-sm-6, div'
			);
			const img =
				parent.find('img').first().attr('data-src') ||
				parent.find('img').first().attr('data-lazy-src') ||
				parent.find('img').first().attr('src') ||
				$(el).find('img').attr('data-src') ||
				$(el).find('img').attr('src') ||
				'';

			const chText =
				parent
					.find(
						'.list-chapter a, .chapter-item a, .chapter a, .btn-link, a[href*="chapter"]'
					)
					.first()
					.text() ||
				parent.find('.chapter, .list-chapter, .chapter-item').first().text() ||
				'';
			const latestChapter = extractChapterNum(chText);

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

		return list;
	}

	private async fetchListingPage(page: number): Promise<Manga[]> {
		const path = page <= 1 ? '/' : `/page/${page}/`;
		try {
			const html = await this.fetchHtml(path);
			this.assertNotCf(html);
			const $ = cheerio.load(html);
			$('script, style, noscript').remove();
			return this.parseListingCards($).slice(0, PER_PAGE);
		} catch (e) {
			console.error('[noicetranslations] fetchListingPage', page, e);
			return [];
		}
	}

	private parseListingCards($: cheerio.CheerioAPI): Manga[] {
		const list: Manga[] = [];
		const seen = new Set<string>();

		const cards = $(
			'.page-item-detail, .c-tabs-item__content, .page-listing-item, .manga, .badge-ext-1'
		);
		if (cards.length) {
			cards.each((_, el) => {
				const item = this.parseCard($, el);
				if (item && !seen.has(item.id)) {
					seen.add(item.id);
					list.push(item);
				}
			});
		}

		if (list.length < 8) {
			$('a[href*="/manga/"]').each((_, el) => {
				const href = $(el).attr('href') || '';
				const id = pathOnly(href);
				if (!isNovelPath(id) || seen.has(id)) return;
				const title =
					cleanText($(el).attr('title') || '') ||
					cleanText($(el).text());
				if (!title || title.length < 2) return;
				const parent = $(el).closest(
					'.page-item-detail, .c-tabs-item__content, div, article, li'
				);
				const cover =
					parent.find('img').attr('data-src') ||
					parent.find('img').attr('src') ||
					'';
				const chText =
					parent.find('.chapter a, .list-chapter a').first().text() || '';
				const latestChapter = extractChapterNum(chText);
				seen.add(id);
				list.push({
					id,
					title: title.slice(0, 200),
					cover: absUrl((cover || '').split('?')[0]),
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
			.find('a[href*="/manga/"]')
			.filter((_, x) => {
				const h = pathOnly($(x).attr('href') || '');
				return isNovelPath(h);
			});
		const a = novelLinks.first().length
			? novelLinks.first()
			: $(el).find('.post-title a, h3 a, h5 a').first();

		const href = a.attr('href') || '';
		if (!href || !/\/manga\//.test(href)) return null;
		const id = pathOnly(href);
		if (!isNovelPath(id)) return null;

		const title =
			cleanText(a.attr('title') || '') ||
			cleanText($(el).find('.post-title, h3, h5').first().text()) ||
			cleanText(a.text());
		if (!title || title.length < 2) return null;

		const cover =
			$(el).find('img').first().attr('data-src') ||
			$(el).find('img').first().attr('data-lazy-src') ||
			$(el).find('img').first().attr('src') ||
			'';

		const statusRaw = cleanText(
			$(el).find('.manga-status, .post-status, .status').first().text()
		);
		const status = statusRaw ? normalizeStatus(statusRaw) : undefined;

		const chText =
			$(el).find('.list-chapter a, .chapter-item a, .chapter a').first().text() ||
			$(el).find('a[href*="chapter"]').first().text() ||
			$(el).find('.list-chapter, .chapter-item, .chapter, .btn-link').first().text() ||
			'';
		let latestChapter = extractChapterNum(chText);
		if (latestChapter == null) {
			const hit = $(el)
				.find('span, a, div, small')
				.filter(
					(_, s) =>
						/(?:chapter|ch\.?)\s*\d/i.test($(s).text()) &&
						$(s).text().trim().length < 40
				)
				.first()
				.text();
			latestChapter = extractChapterNum(hit);
		}

		return {
			id,
			title: title.slice(0, 200),
			cover: absUrl((cover || '').split('?')[0]),
			sourceId: this.id,
			type: 'novel',
			status,
			lang: 'en',
			...(latestChapter != null ? { latestChapter } : {})
		};
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

	async searchManga(
		query: string,
		opts?: { page?: number }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page ?? 1);
		if (!q) return this.getLatestManga(page);

		const path =
			page <= 1
				? `/?s=${encodeURIComponent(q)}&post_type=wp-manga`
				: `/page/${page}/?s=${encodeURIComponent(q)}&post_type=wp-manga`;

		try {
			const html = await this.fetchHtml(path);
			this.assertNotCf(html);
			const $ = cheerio.load(html);
			return this.parseListingCards($);
		} catch (e) {
			console.error('[noicetranslations] search', e);
			return [];
		}
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = pathOnly(mangaId);
		if (!path.includes('/manga/')) {
			path = `/manga/${path.replace(/^\//, '')}`;
		}
		const novelPath = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(novelPath);
		this.assertNotCf(html);
		const $ = cheerio.load(html);

		const title =
			cleanText($('.post-title h1').first().text()) ||
			cleanText($('.post-title h2').first().text()) ||
			cleanText($('h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '')
				.split(/\s*[|\-–]\s*/)[0]
				.trim() ||
			cleanText($('title').text().split(/[|\-–]/)[0]);

		if (!title || title.length < 2) {
			throw new Error('Novel not found (empty title)');
		}

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
		cover = absUrl((cover || '').split('?')[0]);

		let description = '';
		const summary = $(
			'.description-summary .summary__content, .summary__content, .manga-excerpt, .description-summary, .summary-content'
		);
		if (summary.length) {
			description = summary
				.find('p')
				.map((_, p) => cleanText($(p).text()))
				.get()
				.filter(Boolean)
				.join('\n\n');
			if (!description) description = cleanText(summary.text());
		}
		if (!description) {
			description = cleanText($('meta[name="description"]').attr('content') || '');
		}
		if (description.length > 4000) description = description.slice(0, 4000) + '…';

		const authors: string[] = [];
		const artists: string[] = [];
		const genres: string[] = [];
		let altTitle = '';
		let typeLabel = 'novel';
		let status = 'Ongoing';
		let published = '';

		$('.post-content_item, .post-content > div').each((_, el) => {
			const label = cleanText(
				$(el).find('.summary-heading, h5, h6, strong, b').first().text()
			).toLowerCase();
			const valueEl = $(el).find('.summary-content').length
				? $(el).find('.summary-content')
				: $(el);
			const valueText = cleanText(valueEl.text());
			const links: string[] = [];
			valueEl.find('a').each((_, a) => {
				const t = cleanText($(a).text());
				if (t) links.push(t);
			});

			if (/author|penulis|pengarang/i.test(label)) {
				for (const n of links.length ? links : valueText ? [valueText] : []) {
					const clean = n.replace(/^author\(s\)\s*/i, '').trim();
					if (clean && clean.length < 80 && !authors.includes(clean)) {
						authors.push(clean);
					}
				}
			} else if (/artist|ilustrator/i.test(label)) {
				for (const n of links.length ? links : valueText ? [valueText] : []) {
					if (n && n.length < 80 && !artists.includes(n)) artists.push(n);
				}
			} else if (/alternative|native|other name|alt\.?\s*title/i.test(label)) {
				altTitle = links.join(', ') || valueText;
			} else if (/^type$|tipe|jenis/i.test(label)) {
				typeLabel = links[0] || valueText || typeLabel;
			} else if (/status/i.test(label)) {
				status = normalizeStatus(links[0] || valueText) || status;
			} else if (/^genre/i.test(label)) {
				for (const g of links.length ? links : valueText.split(/[,/]/)) {
					const t = g.trim();
					if (t && t.length < 40 && !genres.includes(t)) genres.push(t);
				}
			} else if (/^tag/i.test(label)) {
				for (const g of links.length ? links : valueText.split(/[,/]/)) {
					const t = g.trim();
					if (t && t.length < 40 && !genres.includes(t)) genres.push(t);
				}
			} else if (/^year$|released|release|tahun|published/i.test(label)) {
				const year = valueText.match(/\b(19|20)\d{2}\b/);
				published = year ? year[0] : valueText.slice(0, 20);
			}
		});

		$('.summary_content .genres-content a, .tab-summary .genres-content a, .post-content .genres-content a').each(
			(_, a) => {
				const g = cleanText($(a).text());
				if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
			}
		);

		$('.author-content a, a[href*="manga-author"], a[href*="/novel-author/"]').each(
			(_, a) => {
				const n = cleanText($(a).text());
				if (n && n.length < 80 && !authors.includes(n)) authors.push(n);
			}
		);

		const statusBadge = cleanText(
			$('.post-status .summary-content, .manga-status, span.status').first().text()
		);
		if (
			statusBadge &&
			/ongoing|completed|hiatus|dropped|complete|on\s*going/i.test(statusBadge)
		) {
			status = normalizeStatus(statusBadge) || status;
		}

		if (!authors.length && artists.length) authors.push(...artists);

		let rating: string | undefined;
		const ratingText =
			cleanText($('.post-total-rating .score').first().text()) ||
			cleanText($('#averagerate').first().text()) ||
			cleanText($('.rating .score').first().text()) ||
			$('[itemprop="ratingValue"]').attr('content') ||
			'';
		if (ratingText) {
			const m = ratingText.match(/(\d+(?:\.\d+)?)/);
			if (m && parseFloat(m[1]) > 0) rating = m[1];
		}

		let chapters = await this.fetchChaptersAjax(novelPath);
		if (!chapters.length) {
			chapters = this.parseChapterList($);
		}

		// Newest first
		chapters.sort((a, b) => {
			const na = typeof a.number === 'number' ? a.number : 0;
			const nb = typeof b.number === 'number' ? b.number : 0;
			return nb - na;
		});

		const details: MangaDetails = {
			id: pathOnly(path),
			title,
			cover,
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

	private async fetchChaptersAjax(novelPath: string): Promise<Chapter[]> {
		const base = novelPath.endsWith('/') ? novelPath : `${novelPath}/`;
		const url = absUrl(`${base}ajax/chapters/?t=1`);

		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: {
					...this.headers,
					'X-Requested-With': 'XMLHttpRequest',
					Referer: absUrl(base),
					Origin: BASE,
					'Content-Type':
						'application/x-www-form-urlencoded; charset=UTF-8'
				},
				body: ''
			});
			if (res.ok) {
				const html = await res.text();
				if (html && html.length >= 50) {
					const $ch = cheerio.load(html);
					return this.parseChapterList($ch);
				}
			}
		} catch {
		}

		try {
			const html = await fetchWithCf(url, {
				headers: {
					...this.headers,
					'X-Requested-With': 'XMLHttpRequest',
					Referer: absUrl(base)
				}
			});
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

		const pushChapter = (
			href: string,
			rawTitle: string,
			date: string | undefined,
			locked: boolean,
			fallbackNum: number
		) => {
			if (!rawTitle || rawTitle.length < 2) return;
			const num = parseChapterNumber(rawTitle, fallbackNum);
			let id = pathOnly(href);
			if (!href || href === '#' || href.startsWith('javascript') || href.endsWith('/#')) {
				id = `/manga/locked/chapter-${num}`;
			}
			if (seen.has(id)) return;
			seen.add(id);

			const ch: Chapter = {
				id,
				title: num > 0 ? `Chapter ${num}` : 'Chapter',
				number: num,
				date: cleanDate(date)
			};
			if (locked) ch.isLocked = true;
			out.push(ch);
		};

		$('li.wp-manga-chapter, .wp-manga-chapter, li.chapter-item').each((i, el) => {
			const a = $(el).find('> a').first().length
				? $(el).find('> a').first()
				: $(el).find('a').first();
			const href = a.attr('href') || '';
			const rawTitle = cleanText(
				a.attr('title') ||
					a.clone().children().remove().end().text() ||
					a.text() ||
					$(el).text()
			);
			const dateEl = $(el).find('.chapter-release-date i').first().length
				? $(el).find('.chapter-release-date i').first()
				: $(el).find('.chapter-release-date').first();
			const date = cleanDate(dateEl.text());
			const locked = isLockedChapter($, el);
			pushChapter(href, rawTitle, date, locked, i + 1);
		});

		if (!out.length) {
			$('a[href*="chapter"], a[href="#"]').each((i, el) => {
				const parent = $(el).closest('li, div, tr');
				const raw = cleanText(
					$(el).attr('title') || $(el).text() || parent.text()
				);
				if (!/chapter\s*\d/i.test(raw)) return;
				const href = $(el).attr('href') || '';
				const locked =
					isLockedChapter($, parent.get(0) as any) ||
					/\bunlocks?\s+in\b|\bpremium\b|\blocked\b/i.test(parent.text());
				const date =
					cleanDate(
						parent.find('.chapter-release-date, time, .date').text()
					) || undefined;
				pushChapter(href, raw, date, locked, i + 1);
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
		if (/\/locked\//i.test(chapterId)) {
			return {
				title: 'Locked Chapter',
				content:
					'<p><em>This chapter is locked (paywall / early access). Read it on the website or unlock with coins.</em></p>',
				prevChapterId: null,
				nextChapterId: null
			};
		}

		const path = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		this.assertNotCf(html);
		const $ = cheerio.load(html);

		const title =
			cleanText(
				$('h1, h2.chapter-title, .reading-title, .c-breadcrumb li.active')
					.first()
					.text()
			) ||
			cleanText($('title').text().split(/[|\-–]/)[0]) ||
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
					'script, style, iframe, .ads, .ad, nav, .nav, .reader-settings, .comments, .code-block, .sharedaddy, .chapter-warning, .c-ads, input'
				)
				.remove();

			const paras = clone.find('p');
			if (paras.length >= 2) {
				const parts: string[] = [];
				paras.each((_, p) => {
					const t = cleanText($(p).text());
					if (!t) return;
					if (
						/noicetranslations\.com|cloudflare|cookie|privacy|adblock|buy\s*coin/i.test(
							t
						)
					)
						return;
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
				const t = cleanText($(p).text());
				if (t.length < 20) return;
				if (
					/noicetranslations|cloudflare|cookie|privacy|adblock|consent|buy\s*coin/i.test(
						t
					)
				)
					return;
				parts.push(`<p>${escapeHtml(t)}</p>`);
			});
			if (parts.length) contentHtml = parts.join('\n');
		}

		if (
			!contentHtml ||
			contentHtml.length < 80 ||
			/unlock|premium|subscribe|buy\s*coin|paywall/i.test(
				$('.reading-content, .chapter-content').text()
			)
		) {
			const lockHint =
				$('.premium-block, .c-premium, .locked-chapter, .paywall').length > 0;
			if (lockHint || contentHtml.length < 80) {
				contentHtml =
					contentHtml ||
					'<p><em>Content unavailable — chapter is likely paywalled / still locked.</em></p>';
			}
		}

		const prevHref =
			$('a[rel="prev"]').attr('href') ||
			$('a.btn.prev_page, a.prev_page, .prev_page a, a.prev, .nav-previous a')
				.filter((_, el) => {
					const h = $(el).attr('href') || '';
					return !!h && h !== '#' && !h.startsWith('javascript');
				})
				.first()
				.attr('href');
		const nextHref =
			$('a[rel="next"]').attr('href') ||
			$('a.btn.next_page, a.next_page, .next_page a, a.next, .nav-next a')
				.filter((_, el) => {
					const h = $(el).attr('href') || '';
					return !!h && h !== '#' && !h.startsWith('javascript');
				})
				.first()
				.attr('href');

		return {
			title,
			content:
				contentHtml ||
				'<p><em>Empty content — possible Cloudflare block or selector change.</em></p>',
			prevChapterId: prevHref ? pathOnly(prevHref) : null,
			nextChapterId: nextHref ? pathOnly(nextHref) : null
		};
	}
}

export default NoiceTranslationsSource;
