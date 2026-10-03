/**
 * Transweaver (transweaver.com) — Themesia lightnovel novel TL
 * Path: scraper/src/sources/impl/novel/Transweaver.ts
 *
 * URL pattern:
 *   Latest   : /  (section Latest)  + /series/?order=update&page={n}
 *   Series   : /series/{slug}/
 *   Chapter  : /{dd}/{mm}/{yyyy}/{id}/{slug}/
 *   Search   : /?s={q}
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';
import { fetchWithCf } from '../../../lib/fetchWithCf';

const BASE = 'https://transweaver.com';
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

function parseChapterNumber(text: string, fallback = 0): number {
	const t = cleanText(text);
	if (!t) return fallback;

	if (/epilogue/i.test(t)) {
		const m = t.match(/epilogue\s*(\d+(?:\.\d+)?)/i);
		return m ? 9000 + parseFloat(m[1]) : 9000;
	}
	if (/\bside\b/i.test(t)) {
		const m = t.match(/side\s*(\d+(?:\.\d+)?)/i);
		return m ? 8000 + parseFloat(m[1]) : 8000;
	}
	if (/\bextra\b/i.test(t)) {
		const m = t.match(/extra\s*(\d+(?:\.\d+)?)/i);
		return m ? 7000 + parseFloat(m[1]) : 7000;
	}

	const m =
		t.match(/(?:chapter|ch\.?|c)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function extractLatestLabel(text: string): string | number | undefined {
	const t = cleanText(text);
	if (!t) return undefined;

	if (/epilogue/i.test(t)) {
		const m = t.match(/epilogue\s*(\d+)/i);
		return m ? `Epilogue ${m[1]}` : 'Epilogue';
	}
	if (/\bside\b/i.test(t)) {
		const m = t.match(/side\s*(\d+)/i);
		return m ? `Side ${m[1]}` : 'Side';
	}
	if (/\bextra\b/i.test(t)) {
		const m = t.match(/extra\s*(\d+)/i);
		return m ? `Extra ${m[1]}` : 'Extra';
	}

	const m =
		t.match(/(?:chapter|ch\.?|c)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n) && n < 7000) return n;
	}
	return undefined;
}

function shortChapterTitle(...texts: string[]): string {
	const t = cleanText(texts.filter(Boolean).join(' '));
	if (!t) return 'Chapter';

	if (/epilogue/i.test(t)) {
		const m = t.match(/epilogue\s*(\d+)/i);
		return m ? `Epilogue ${m[1]}` : 'Epilogue';
	}
	if (/\bside\b/i.test(t)) {
		const m = t.match(/side\s*(\d+)/i);
		return m ? `Side ${m[1]}` : 'Side';
	}
	if (/\bextra\b/i.test(t)) {
		const m = t.match(/extra\s*(\d+)/i);
		return m ? `Extra ${m[1]}` : 'Extra';
	}

	const m =
		t.match(/(?:chapter|ch\.?|c)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n) && n < 7000) return `Chapter ${n}`;
	}
	return 'Chapter';
}

function isLockedText(...parts: string[]): boolean {
	const joined = parts.join(' ');
	return /🔒|🔐|lock|locked|premium|paywall|members?\s*only/i.test(joined);
}

function normalizeStatus(raw: string): string {
	const v = (raw || '').toLowerCase();
	if (/complet|finish|end|tamat/i.test(v)) return 'Completed';
	if (/hiatus|on\s*hold/i.test(v)) return 'Hiatus';
	if (/drop|cancel/i.test(v)) return 'Dropped';
	if (/ongoing|ongoing|continue/i.test(v)) return 'Ongoing';
	return raw ? cleanText(raw) : 'Ongoing';
}

function seriesPathFromHref(href: string): string | null {
	const id = pathOnly(href);
	if (id.includes('/series/') && !/\/series\/?(list-mode|page|feed)?$/i.test(id)) {
		const m = id.match(/\/series\/([^/]+)/);
		return m ? `/series/${m[1]}` : null;
	}
	return null;
}

export class TransweaverSource extends BaseSource {
	id = 'transweaver';
	name = 'Transweaver';
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

	private assertNotCf(html: string): void {
		const low = (html || '').toLowerCase();
		if (
			low.includes('cf-browser-verification') ||
			low.includes('challenge-platform') ||
			low.includes('just a moment') ||
			(low.includes('cloudflare') && low.includes('ray id') && html.length < 5000)
		) {
			throw new Error('Cloudflare blocked this request');
		}
	}

	async getLatestManga(page = 1): Promise<Manga[]> {
		const pageNum = Math.max(1, page);

		if (pageNum <= 1) {
			const fromHome = await this.parseHomepageLatest().catch(() => [] as Manga[]);
			const seen = new Set(fromHome.map((m) => m.id));
			const merged = [...fromHome];

			for (let p = 1; merged.length < PER_PAGE && p <= 3; p++) {
				const fromArchive = await this.parseSeriesArchive(p).catch(() => [] as Manga[]);
				for (const item of fromArchive) {
					if (seen.has(item.id)) continue;
					seen.add(item.id);
					merged.push(item);
					if (merged.length >= PER_PAGE) break;
				}
			}
			return merged.slice(0, PER_PAGE);
		}

		return this.parseSeriesArchive(pageNum);
	}

	private async parseHomepageLatest(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		this.assertNotCf(html);
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		const roots = $(
			'.bixbox.releases.latesthome, .releases.latesthome, .bixbox:has(h2:contains("Latest")), .bixbox:has(h3:contains("Latest"))'
		);

		const cards =
			roots.length > 0
				? roots.first().find('.listupd .bs, .listupd .bsx, .bs, .bsx')
				: $('.listupd').first().find('.bs, .bsx');

		cards.each((_, el) => {
			const item = this.parseReleaseCard($, el);
			if (!item || seen.has(item.id)) return;
			seen.add(item.id);
			list.push(item);
		});

		if (list.length < 8) {
			$('.listupd .bs, .listupd .bsx, article.maindet').each((_, el) => {
				const item = this.parseReleaseCard($, el) || this.parseArchiveCard($, el);
				if (!item || seen.has(item.id)) return;
				seen.add(item.id);
				list.push(item);
			});
		}

		return list;
	}

	private parseReleaseCard($: cheerio.CheerioAPI, el: any): Manga | null {
		const a = $(el).find('a[href*="/series/"]').first().length
			? $(el).find('a[href*="/series/"]').first()
			: $(el).find('a').first();
		const href = a.attr('href') || '';
		if (!href) return null;

		const seriesId = seriesPathFromHref(href);
		if (!seriesId) return null;

		const rawTitle =
			a.attr('title') ||
			$(el).find('.tt, .title, h2, h3').first().text() ||
			a.text() ||
			'';
		const title = cleanText(rawTitle)
			.replace(/\s*ch\.?\s*\d+.*$/i, '')
			.replace(/\s*chapter\s*\d+.*$/i, '')
			.replace(/\s*🔒.*$/i, '');
		if (!title || title.length < 2) return null;

		const cover =
			$(el).find('img').attr('data-src') ||
			$(el).find('img').attr('data-lazy-src') ||
			$(el).find('img').attr('src') ||
			'';

		const latestChapter =
			extractLatestLabel($(el).find('.epx, .epxs, .bigor, .nchapter').text()) ||
			extractLatestLabel(rawTitle) ||
			extractLatestLabel($(el).text());

		return {
			id: seriesId,
			title: title.slice(0, 200),
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
						`/series/page/${page}/?order=update`,
						`/series/?page=${page}&status=&type=&order=update`
					];

		for (const path of paths) {
			try {
				const html = await this.fetchHtml(path);
				this.assertNotCf(html);
				const $ = cheerio.load(html);
				const list: Manga[] = [];
				const seen = new Set<string>();

				$('.listupd article.maindet, article.maindet, .listupd .bs, .listupd .bsx').each(
					(_, el) => {
						const item = this.parseArchiveCard($, el);
						if (!item || seen.has(item.id)) return;
						seen.add(item.id);
						list.push(item);
					}
				);

				if (list.length) return list.slice(0, PER_PAGE);
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

		const title = cleanText(
			a.attr('title') || $(el).find('h2, h3, .tt').first().text() || a.text()
		);
		if (!title || title.length < 2) return null;

		const cover =
			$(el).find('img').attr('data-src') ||
			$(el).find('img').attr('data-lazy-src') ||
			$(el).find('img').attr('src') ||
			'';

		const latestChapter =
			extractLatestLabel($(el).find('.nchapter, .epx, .epxs').text()) ||
			extractLatestLabel($(el).find('a[href*="chapter"]').text());

		const statusBadge = cleanText(
			$(el).find('.status, span.Ongoing, span.Completed, span.Hiatus').first().text()
		);

		return {
			id: seriesId,
			title: title.slice(0, 200),
			cover: absUrl((cover || '').split('?')[0]),
			sourceId: this.id,
			type: 'novel',
			lang: 'en',
			...(latestChapter != null ? { latestChapter } : {}),
			...(statusBadge ? { status: normalizeStatus(statusBadge) } : {})
		};
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = encodeURIComponent(query.trim());
		if (!q) return [];

		const paths =
			page <= 1
				? [`/?s=${q}`, `/?s=${q}&post_type=wp-manga`]
				: [`/page/${page}/?s=${q}`, `/?s=${q}&page=${page}`, `/page/${page}/?s=${q}&post_type=wp-manga`];

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
						const title = cleanText($(a).attr('title') || $(a).text());
						if (!title || title.length < 2) return;
						seen.add(seriesId);
						list.push({
							id: seriesId,
							title: title.slice(0, 200),
							cover: '',
							sourceId: this.id,
							type: 'novel',
							lang: 'en'
						});
					});
				}

				if (list.length) return list.slice(0, PER_PAGE);
			} catch {
				/* next path */
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
			cleanText($('h1.entry-title, h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '').split(/[|\-–]/)[0].trim() ||
			'';

		if (!title || title.length < 2) throw new Error('Novel not found (empty title)');

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('.mdthumb img, .thumb img, .seriestucont .thumb img').attr('data-src') ||
			$('.mdthumb img, .thumb img, .seriestucont .thumb img').attr('src') ||
			$('img.wp-post-image').attr('src') ||
			'';
		cover = (cover || '').split('?')[0];

		let description = '';
		const syn = $('.sersys.entry-content, .sersysn .entry-content, .entry-content, .series-synops').first();
		if (syn.length) {
			const parts = syn
				.find('p')
				.map((_, p) => cleanText($(p).text()))
				.get()
				.filter((t) => t.length > 20);
			description = parts.slice(0, 12).join('\n\n') || cleanText(syn.text());
		}
		if (!description) {
			description = cleanText($('meta[property="og:description"]').attr('content') || '');
		}

		const authors: string[] = [];
		const artists: string[] = [];
		const genres: string[] = [];
		let status = 'Ongoing';
		let novelType = 'Web Novel';
		let altTitle = '';
		let released = '';
		let nativeLang = '';

		$('.serl').each((_, el) => {
			const label = cleanText($(el).find('.sername').first().text()).toLowerCase();
			const valueEl = $(el).find('.serval').first();
			const links = valueEl
				.find('a')
				.map((__, a) => cleanText($(a).text()))
				.get()
				.filter(Boolean);
			const value = cleanText(valueEl.text()) || links.join(', ');

			if (/^author/i.test(label)) {
				for (const n of links.length ? links : value ? [value] : []) {
					if (n && !authors.includes(n)) authors.push(n);
				}
			} else if (/^artist/i.test(label)) {
				for (const n of links.length ? links : value ? [value] : []) {
					if (n && !artists.includes(n)) artists.push(n);
				}
			} else if (/^type/i.test(label)) {
				novelType = links[0] || value || novelType;
			} else if (/native\s*language|language/i.test(label)) {
				nativeLang = links[0] || value;
				if (nativeLang && !altTitle) altTitle = nativeLang;
			} else if (/released|release|published|year/i.test(label)) {
				released = links[0] || value;
			} else if (/alternative|alt\.?\s*title|other\s*name/i.test(label)) {
				altTitle = links[0] || value;
			} else if (/status/i.test(label)) {
				status = normalizeStatus(links[0] || value);
			} else if (/genre/i.test(label)) {
				for (const g of links.length ? links : value.split(/[,/]/)) {
					const t = cleanText(g);
					if (t && !genres.includes(t)) genres.push(t);
				}
			}
		});

		const badge = cleanText(
			$('span.Ongoing, span.Completed, span.Hiatus, span.Dropped, .status').first().text()
		);
		if (badge && /ongoing|completed|hiatus|dropped/i.test(badge)) {
			status = normalizeStatus(badge);
		}

		$('.genxed a, a[href*="/genre/"]').each((_, a) => {
			const g = cleanText($(a).text());
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		if (artists.length) {
			for (const a of artists) {
				if (!authors.includes(a)) {
				}
			}
		}

		const chapters = this.parseChapterList($);
		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const metaBits: string[] = [];
		if (altTitle && altTitle !== title) metaBits.push(`Alt / Native: ${altTitle}`);
		if (artists.length) metaBits.push(`Artist: ${artists.join(', ')}`);
		if (released) metaBits.push(`Released: ${released}`);
		if (nativeLang && nativeLang !== altTitle) metaBits.push(`Language: ${nativeLang}`);
		if (novelType) metaBits.push(`Type: ${novelType}`);
		const enrichedDescription =
			metaBits.length > 0
				? `${description}${description ? '\n\n' : ''}${metaBits.join(' · ')}`
				: description;

		return {
			id: pathOnly(path),
			title,
			cover: absUrl(cover),
			sourceId: this.id,
			description: enrichedDescription,
			authors: authors.length ? authors : artists.length ? artists : [],
			status,
			genres,
			chapters,
			type: novelType || 'novel',
			lang: 'en',
			...(chapters[0]
				? {
						latestChapter:
							extractLatestLabel(chapters[0].title) ??
							(chapters[0].number < 7000 ? chapters[0].number : chapters[0].title)
					}
				: {})
		};
	}

	private parseChapterList($: cheerio.CheerioAPI): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		$('.eplister li, #chapterlist li, .chapter-list li, .eplisterfull li').each((i, li) => {
			const a = $(li).find('a').first();
			const href = a.attr('href') || '';
			if (!href) return;
			if (/\/series\/[^/]+\/?$/.test(pathOnly(href))) return;

			const id = pathOnly(href);
			if (seen.has(id)) return;

			const numText = cleanText($(li).find('.epl-num').first().text());
			const titleText = cleanText($(li).find('.epl-title').first().text());
			const dateText = cleanText($(li).find('.epl-date').first().text());
			const rawFallback = cleanText(a.attr('title') || a.text());
			const combined = `${numText} ${titleText} ${rawFallback} ${id}`;

			if (!numText && !/chapter|extra|side|epilogue|ch\.?/i.test(combined)) {
				return;
			}
			seen.add(id);

			const num = parseChapterNumber(titleText || numText || rawFallback, i + 1);
			const locked = isLockedText(titleText, rawFallback, numText, $(li).html() || '');

			out.push({
				id,
				title: shortChapterTitle(titleText, numText, rawFallback),
				number: num,
				...(dateText ? { date: dateText } : {}),
				...(locked ? { isLocked: true } : {})
			});
		});

		if (!out.length) {
			$('a[href]').each((i, el) => {
				const href = $(el).attr('href') || '';
				const id = pathOnly(href);
				if (!href || seen.has(id)) return;
				if (/\/series\//.test(id) && !/chapter|epilogue|side|extra/i.test(id)) return;
				if (!/chapter|extra|side|epilogue/i.test(id + $(el).text())) return;
				seen.add(id);
				const text = cleanText($(el).text());
				const num = parseChapterNumber(text || id, i + 1);
				out.push({
					id,
					title: shortChapterTitle(text),
					number: num,
					...(isLockedText(text) ? { isLocked: true } : {})
				});
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
			cleanText($('h1.entry-title, h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '').split(/[|\-–]/)[0].trim() ||
			'Chapter';

		const root = $('.epcontent, .entry-content, .reading-content, .text-left').first();
		root
			.find(
				'script, style, noscript, iframe, .sharedaddy, .jp-relatedposts, .code-block, .ads, .ad, nav, .navigation, form, .patreon, .ko-fi, .mycred, .comments-area, #comments, .relatedpost, .socialbutton'
			)
			.remove();

		const paragraphs = root
			.find('p')
			.map((_, p) => {
				const t = cleanText($(p).text());
				return t;
			})
			.get()
			.filter((t) => {
				if (!t || t.length < 1) return false;
				if (/accepting commissions via ko-fi/i.test(t)) return false;
				if (/missing chapters.*discord/i.test(t)) return false;
				if (/help this site by whitelisting/i.test(t)) return false;
				if (/^sponsored/i.test(t)) return false;
				if (/please\s+login|members\s+only|unlock\s+this\s+chapter/i.test(t)) return false;
				return true;
			});

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		$('a[rel="prev"], a[rel="next"], .nav-previous a, .nav-next a, .ch-prev-btn, .ch-next-btn, a').each(
			(_, a) => {
				const href = $(a).attr('href') || '';
				const text = cleanText($(a).text()).toLowerCase();
				const id = pathOnly(href);
				if (!id || id === '/' || /\/series\/[^/]+\/?$/.test(id)) return;
				if (!/\/\d{2}\/\d{2}\/\d{4}\//.test(id) && !/chapter|epilogue|side|extra/i.test(id + text)) {
					return;
				}
				if (/prev|previous|older/i.test(text) || $(a).attr('rel') === 'prev') {
					prevChapterId = id;
				}
				if (/next|newer/i.test(text) || $(a).attr('rel') === 'next') {
					nextChapterId = id;
				}
			}
		);

		if (!prevChapterId || !nextChapterId) {
			$('.nextprev a, .nav-links a, .chapter-nav a').each((_, a) => {
				const href = $(a).attr('href') || '';
				const text = cleanText($(a).text()).toLowerCase();
				const id = pathOnly(href);
				if (!id) return;
				if (!prevChapterId && /prev|previous/i.test(text)) prevChapterId = id;
				if (!nextChapterId && /next/i.test(text)) nextChapterId = id;
			});
		}

		const escapeHtml = (s: string) =>
			s
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;');

		let content = '';
		if (paragraphs.length) {
			content = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
		} else {
			const rawHtml = root.html() || '';
			if (/<p[\s>]/i.test(rawHtml)) {
				content = rawHtml
					.replace(/<script[\s\S]*?<\/script>/gi, '')
					.replace(/<style[\s\S]*?<\/style>/gi, '');
			} else {
				content = escapeHtml(cleanText(root.text()))
					.split(/(?<=[.!?…])\s+(?=[A-Z“"‘'])/)
					.filter((s) => s.trim().length > 0)
					.map((s) => `<p>${s.trim()}</p>`)
					.join('\n');
			}
		}

		if (!content || /please\s+login|unlock\s+this\s+chapter|members\s+only/i.test(content)) {
			return {
				title,
				content: content || '<p>This chapter is locked / requires login on Transweaver.</p>',
				prevChapterId,
				nextChapterId
			};
		}

		return {
			title,
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default TransweaverSource;
