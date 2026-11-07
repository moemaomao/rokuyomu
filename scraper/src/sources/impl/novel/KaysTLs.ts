/**
 * Kay's Translations — https://kaystls.site/
 * WordPress (Astra) — Japanese isekai web novels
 *
 * Path: scraper/src/sources/impl/novel/KaysTLs.ts
 *
 *   Latest  : /browse/  (+ homepage recent chapters)
 *   Series  : /{slug}/
 *   Chapter : /{slug}/chapter-{n}/
 *   Search  : /?s={q}
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';
import { fetchWithCf } from '../../../lib/fetchWithCf';

const BASE = 'https://kaystls.site';

const BLOCKED = new Set([
	'browse',
	'feed',
	'comments',
	'my-account-2',
	'my-account',
	'about',
	'privacy',
	'privacy-policy',
	'cookies',
	'contact',
	'patreon',
	'wp-login',
	'wp-admin',
	'sample-page',
	'home',
	'author'
]);

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
		t.match(/chapter[-\s]*(\d+(?:\.\d+)?)/i) ||
		t.match(/\bch\.?\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function isSeriesPath(path: string): boolean {
	const p = path.replace(/\/$/, '');
	if (!p || p === '/') return false;
	if (!/^\/[^/]+$/.test(p)) return false;
	const slug = p.slice(1).toLowerCase();
	if (BLOCKED.has(slug)) return false;
	if (/^(page|tag|category|author|wp-|feed|cdn-cgi)/i.test(slug)) return false;
	if (/chapter/i.test(slug)) return false;
	return true;
}

function isChapterPath(path: string): boolean {
	const p = path.replace(/\/$/, '');
	return /^\/[^/]+\/chapter[-\d]/i.test(p);
}

export class KaysTLsSource extends BaseSource {
	id = 'kaystls';
	name = "Kay's Translations";
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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
		const fromHome = this.parseLatestFromHome(html);
		if (fromHome.length) return fromHome;
		if (page <= 1) {
			const browse = await this.fetchHtml('/browse/');
			return this.parseSeriesFromHtml(browse);
		}
		return [];
	}

	private parseLatestFromHome(html: string): Manga[] {
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('a[href*="chapter-"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const chPath = pathOnly(href);
			if (!isChapterPath(chPath)) return;

			const parts = chPath.split('/').filter(Boolean);
			if (parts.length < 2) return;
			const seriesId = `/${parts[0]}`;
			if (seen.has(seriesId) || !isSeriesPath(seriesId)) return;
			seen.add(seriesId);

			const number = parseChapterNumber(chPath, 0);
			let title = cleanText($(a).attr('title') || '');
			// Prefer series title from nearby heading / parent article
			const $art = $(a).closest('article, .post, .entry, li');
			const seriesLink = $art
				.find('a[href]')
				.filter((__, x) => isSeriesPath(pathOnly($(x).attr('href') || '')))
				.first();
			if (seriesLink.length) {
				title = cleanText(seriesLink.attr('title') || seriesLink.text()) || title;
			}
			if (!title || title.length < 3 || /chapter\s*\d/i.test(title)) {
				title = parts[0].replace(/-/g, ' ');
				title = title.replace(/\w/g, (c) => c.toUpperCase());
			}

			const cover =
				$art.find('img').attr('src') ||
				$art.find('img').attr('data-src') ||
				'';

			list.push({
				id: seriesId,
				title: title.slice(0, 200),
				cover: absUrl((cover || '').split('?')[0]),
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: 'Ongoing',
				...(number > 0 ? { latestChapter: number } : {})
			});
		});

		return list;
	}

	private parseSeriesFromHtml(html: string): Manga[] {
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		const latestBySeries = new Map<string, number>();
		$('a[href]').each((_, a) => {
			const id = pathOnly($(a).attr('href') || '');
			if (!isChapterPath(id)) return;
			const seriesId = '/' + id.split('/').filter(Boolean)[0];
			const n = parseChapterNumber(id, 0);
			if (n > 0) {
				const prev = latestBySeries.get(seriesId) || 0;
				if (n > prev) latestBySeries.set(seriesId, n);
			}
		});

		$('a[href]').each((_, a) => {
			const href = $(a).attr('href') || '';
			if (!href.includes('kaystls.site') && !href.startsWith('/')) return;
			const id = pathOnly(href);
			if (!isSeriesPath(id) || seen.has(id)) return;

			const title = cleanText($(a).attr('title') || $(a).text());
			if (!title || title.length < 4) return;
			if (/^browse|home|patreon|read more|my account/i.test(title)) return;

			const $parent = $(a).closest('article, .post, li, .entry, .wp-block-post, div');
			const cover =
				$parent.find('img').attr('src') ||
				$parent.find('img').attr('data-src') ||
				'';

			seen.add(id);
			const latestChapter = latestBySeries.get(id);
			list.push({
				id,
				title: title.slice(0, 200),
				cover: absUrl((cover || '').split('?')[0]),
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: 'Ongoing',
				...(latestChapter != null ? { latestChapter } : {})
			});
		});

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
		return this.parseSeriesFromHtml(html);
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
		if (/logo|avatar|gravatar|wp-includes|cropped-Picture/i.test(cover)) cover = '';

		const $content = $(
			'.entry-content, .post-content, article .content, .wp-block-post-content'
		).first();

		const paras: string[] = [];
		$content.find('p').each((_, p) => {
			const t = cleanText($(p).text());
			if (!t) return;
			if (/^chapter\s*\d|leave a (reply|comment)|required fields/i.test(t)) return;
			paras.push(t);
		});
		let description = paras.slice(0, 10).join('\n\n');
		if (!description) {
			description = cleanText($('meta[name="description"]').attr('content') || '');
		}
		if (description.length > 4000) description = description.slice(0, 4000) + '…';

		const chapters = this.parseChapters($, path);

		return {
			id: path,
			title: title.slice(0, 200),
			cover,
			description,
			authors: [],
			genres: [],
			status: 'Ongoing',
			type: 'novel',
			sourceId: this.id,
			lang: 'en',
			chapters,
			...(chapters.length
				? { latestChapter: Math.max(...chapters.map((c) => c.number || 0)) }
				: {})
		};
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
				'script, style, noscript, iframe, nav, .sharedaddy, .comments-area, #comments, form, .navigation, .nav-links, .post-navigation, .jp-relatedposts'
			)
			.remove();

		const parts: string[] = [];
		clone.find('p, h2, h3, h4').each((_, el) => {
			const tag = ((el as any).tagName || (el as any).name || 'p').toLowerCase();
			const t = cleanText($(el).text());
			if (!t || t.length < 1) return;
			if (/^leave a (reply|comment)|required fields|kay.?s translations$/i.test(t))
				return;
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

		if (!prevChapterId || !nextChapterId) {
			const num = parseChapterNumber(path, 0);
			const series = path.split('/').slice(0, 2).join('/');
			if (num > 1 && !prevChapterId) {
				prevChapterId = `${series}/chapter-${num - 1}`;
			}
			if (num > 0 && !nextChapterId) {
				nextChapterId = `${series}/chapter-${num + 1}`;
			}
		}

		return {
			title,
			content: content || '<p><em>Empty content.</em></p>',
			prevChapterId,
			nextChapterId
		};
	}
}

export default KaysTLsSource;
