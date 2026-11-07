/**
 * Nomad Translations — WordPress novel blog
 * https://nomad-translations.com/
 *
 * Path: scraper/src/sources/impl/novel/NomadTranslations.ts
 *
 * URL pattern:
 *   Latest   : /  (list of series cards)
 *   Series   : /{slug}/
 *   Chapter  : /{series-slug}/{abbrev}-chapter-{n}/  or /{series-slug}/{abbrev}-chapter-{n}-{title}/
 *   Search   : /?s={q}
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';
import { fetchWithCf } from '../../../lib/fetchWithCf';

const BASE = 'https://nomad-translations.com';

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

function parseChapterNumber(text: string, fallback = 0): number {
	const t = cleanText(text);
	if (!t) return fallback;
	const m =
		t.match(/chapter\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\bch\.?\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/-chapter-(\d+(?:\.\d+)?)/i) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

const BLOCKED_SLUGS = new Set([
	'about',
	'about-policies',
	'about-and-policies',
	'privacy',
	'privacy-policy',
	'cookies',
	'cookies-policy',
	'cookie-policy',
	'contact',
	'terms',
	'terms-of-service',
	'disclaimer',
	'donate',
	'donation',
	'novel-list',
	'novellist',
	'novel-list-2',
	'list',
	'home',
	'blog',
	'sample-page',
	'wp-login',
	'wp-admin',
	'feed',
	'comments',
	'cart',
	'shop',
	'my-account'
]);

function isSeriesPath(path: string): boolean {
	const p = path.replace(/\/$/, '');
	if (!p || p === '/') return false;
	if (/^\/(page|tag|category|author|wp-|feed|comments|cdn-cgi)/i.test(p)) return false;
	// /slug only
	if (!/^\/[^/]+$/.test(p)) return false;
	if (/chapter/i.test(p)) return false;
	const slug = p.slice(1).toLowerCase();
	if (BLOCKED_SLUGS.has(slug)) return false;
	if (/^(about|privacy|cookie|policy|terms|contact|donate|novel-?list)/i.test(slug)) return false;
	return true;
}

function isJunkTitle(title: string): boolean {
	const t = (title || '').trim();
	if (!t || t.length < 4) return true;
	return /^(read more|nomad translations|home|about|privacy|cookies?|policy|terms|contact|novel list|leave a reply)/i.test(
		t
	);
}

function isChapterPath(path: string): boolean {
	const p = path.replace(/\/$/, '');
	return /^\/[^/]+\/[^/]*chapter[^/]*$/i.test(p);
}

export class NomadTranslationsSource extends BaseSource {
	id = 'nomadtranslations';
	name = 'Nomad Translations';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		return fetchWithCf(url, {
			headers: {
				...this.headers,
				Referer: this.baseUrl
			}
		});
	}

	async getLatestManga(page = 1): Promise<Manga[]> {
		const path = page <= 1 ? '/' : `/page/${page}/`;
		const html = await this.fetchHtml(path);
		return this.parseSeriesList(html);
	}

	private parseSeriesList(html: string): Manga[] {
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		const cards = $(
			'article, .post, .entry, .wp-block-post, .type-post, li, .entry-content > ul > li'
		);

		cards.each((_, el) => {
			const $el = $(el);
			const a = $el
				.find('a[href]')
				.filter((_, x) => {
					const id = pathOnly($(x).attr('href') || '');
					return isSeriesPath(id);
				})
				.first();
			const href = a.attr('href') || '';
			const id = pathOnly(href);
			if (!isSeriesPath(id) || seen.has(id)) return;

			const title =
				cleanText(a.attr('title') || '') ||
				cleanText($el.find('h2, h3, .entry-title, .post-title').first().text()) ||
				cleanText(a.text());
			if (!title || isJunkTitle(title)) return;

			const cover =
				$el.find('img').attr('src') ||
				$el.find('img').attr('data-src') ||
				$el.find('img').attr('data-lazy-src') ||
				'';

			const body = cleanText($el.text());
			let status: string | undefined;
			if (/completed/i.test(body)) status = 'Completed';
			else if (/currently translating|updating|ongoing/i.test(body)) status = 'Ongoing';
			else if (/future translation/i.test(body)) status = 'Hiatus';

			const dateText =
				cleanText($el.find('time, .entry-date, .posted-on').first().text()) ||
				body.match(/(\d{2}\/\d{2}\/\d{4})/)?.[1] ||
				'';
			let updatedAt: number | undefined;
			if (dateText) {
				const parts = dateText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
				if (parts) {
					const ts = Date.parse(`${parts[3]}-${parts[2]}-${parts[1]}`);
					if (!Number.isNaN(ts)) updatedAt = ts;
				}
			}

			seen.add(id);
			list.push({
				id,
				title: title.slice(0, 200),
				cover: absUrl((cover || '').split('?')[0]),
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				...(status ? { status } : {}),
				...(updatedAt != null ? { updatedAt } : {})
			});
		});

		if (list.length < 5) {
			$('a[href]').each((_, el) => {
				const href = $(el).attr('href') || '';
				const id = pathOnly(href);
				if (!isSeriesPath(id) || seen.has(id)) return;
				if (!href.includes('nomad-translations.com') && !href.startsWith('/')) return;
				const title = cleanText($(el).attr('title') || $(el).text());
				if (!title || isJunkTitle(title)) return;
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

		return list;
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page ?? 1);
		if (!q) return this.getLatestManga(page);

		const path =
			page <= 1
				? `/?s=${encodeURIComponent(q)}`
				: `/page/${page}/?s=${encodeURIComponent(q)}`;
		const html = await this.fetchHtml(path);
		return this.parseSeriesList(html);
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = pathOnly(mangaId);
		if (!path.startsWith('/')) path = `/${path}`;
		path = path.replace(/\/$/, '');

		const html = await this.fetchHtml(`${path}/`);
		const $ = cheerio.load(html);

		const title =
			cleanText($('h1.entry-title, h1.post-title, article h1, h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '')
				.split(/\s*[|\-–—]\s*/)[0]
				.trim() ||
			path.replace(/^\//, '').replace(/-/g, ' ');

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('article img, .entry-content img, .post-thumbnail img').first().attr('src') ||
			'';
		cover = absUrl((cover || '').split('?')[0]);
		if (/logo|avatar|gravatar|wp-includes/i.test(cover)) cover = '';

		let description = '';
		const $content = $('.entry-content, .post-content, article .content, .wp-block-post-content').first();
		const paras: string[] = [];
		$content.find('p').each((_, p) => {
			const t = cleanText($(p).text());
			if (!t) return;
			if (/^calid chapter|^chapter \d|leave a reply|required fields/i.test(t)) return;
			paras.push(t);
		});
		description = paras.slice(0, 8).join('\n\n');
		if (!description) {
			description = cleanText($('meta[name="description"]').attr('content') || '');
		}
		if (description.length > 4000) description = description.slice(0, 4000) + '…';

		const bodyAll = cleanText($content.text() + ' ' + $('article').text());
		let status = 'Ongoing';
		if (/completed translation|completed!!|–\s*completed/i.test(bodyAll)) status = 'Completed';
		else if (/future translation/i.test(bodyAll)) status = 'Hiatus';
		else if (/currently translating|updating/i.test(bodyAll)) status = 'Ongoing';

		const altTitles: string[] = [];
		const abbrev = title.match(/\(([A-Z0-9]{2,})\)$/);
		if (abbrev) altTitles.push(abbrev[1]);

		const chapters = this.parseChapters($, path);

		const details: MangaDetails & { altTitles?: string[] } = {
			id: path,
			title: title.slice(0, 200),
			cover,
			description,
			authors: [],
			genres: [],
			status,
			type: 'novel',
			sourceId: this.id,
			lang: 'en',
			chapters,
			...(chapters.length
				? { latestChapter: Math.max(...chapters.map((c) => c.number || 0)) }
				: {})
		};
		if (altTitles.length) details.altTitles = altTitles;
		return details;
	}

	private parseChapters($: cheerio.CheerioAPI, seriesPath: string): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();
        
		$('a[href]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const id = pathOnly(href);
			if (!isChapterPath(id)) return;
			if (!id.startsWith(seriesPath + '/')) return;
			if (seen.has(id)) return;
			seen.add(id);

			const text = cleanText($(a).text() || $(a).attr('title') || '');
			const number = parseChapterNumber(text + ' ' + id, 0);
			out.push({
				id,
				title: number > 0 ? `Chapter ${number}` : text.slice(0, 80) || 'Chapter',
				number: number || out.length + 1
			});
		});

		out.sort((a, b) => (a.number || 0) - (b.number || 0));
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
			cleanText($('h1.entry-title, h1.post-title, article h1, h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '')
				.split(/\s*[|\-–—]\s*/)[0]
				.trim() ||
			'Chapter';

		const contentRoot = $(
			'.entry-content, .post-content, article .content, .wp-block-post-content, article'
		).first();

		const clone = contentRoot.clone();
		clone
			.find(
				'script, style, noscript, iframe, nav, .sharedaddy, .comments-area, #comments, .wp-block-comments, form, .navigation, .nav-links, .post-navigation'
			)
			.remove();

		const parts: string[] = [];
		clone.find('p, h2, h3, h4').each((_, el) => {
			const tag = ((el as any).tagName || (el as any).name || 'p').toLowerCase();
			const t = cleanText($(el).text());
			if (!t || t.length < 1) return;
			if (/^leave a (reply|comment)|required fields|nomad translations$/i.test(t)) return;
			if (tag.startsWith('h')) {
				parts.push(`<p><strong>${escapeHtml(t)}</strong></p>`);
			} else {
				parts.push(`<p>${escapeHtml(t)}</p>`);
			}
		});

		let content = parts.join('\n');
		if (!content || content.length < 40) {
			const raw = cleanText(clone.text());
			if (raw.length > 40) {
				content = raw
					.split(/\n\s*\n/)
					.map((s) => cleanText(s))
					.filter((s) => s.length > 2)
					.map((s) => `<p>${escapeHtml(s)}</p>`)
					.join('\n');
			}
		}

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		$('a[rel="prev"], a[rel="next"], .nav-previous a, .nav-next a, a').each((_, a) => {
			const href = $(a).attr('href') || '';
			const id = pathOnly(href);
			if (!isChapterPath(id)) return;
			const text = cleanText($(a).text() || $(a).attr('title') || '').toLowerCase();
			const rel = ($(a).attr('rel') || '').toLowerCase();
			if (rel === 'prev' || /prev|previous|older|«/i.test(text)) prevChapterId = id;
			if (rel === 'next' || /next|newer|»/i.test(text)) nextChapterId = id;
		});

		return {
			title,
			content:
				content ||
				'<p><em>Empty content — Cloudflare may have blocked the request.</em></p>',
			prevChapterId,
			nextChapterId
		};
	}
}

export default NomadTranslationsSource;
