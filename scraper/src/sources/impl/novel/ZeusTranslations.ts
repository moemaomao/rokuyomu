/**
 * Zeus Translations (zeustranslations.blogspot.com)
 * Path: scraper/src/sources/impl/novel/ZeusTranslations.ts
 *
 * Blogger site — JP→EN NTR / romance web novel fan translations.
 *
 * Architecture:
 *   - Series list  : label "Series" via Blogger JSON feed
 *   - Series code  : numeric label e.g. "00001", "00070" on each series post
 *   - Chapters     : posts tagged with that numeric label (exclude Series itself)
 *   - Chapter body : HTML after <a name="more"> (theme hides body without JS)
 *   - VIP label    : isLocked: true (paywall / empty body)
 *
 * Feeds:
 *   /feeds/posts/default/-/Series?alt=json&max-results=N&start-index=N
 *   /feeds/posts/default/-/{code}?alt=json&max-results=N&start-index=N
 *
 * Homepage target: 24 titles
 * Chapter titles: "Chapter N" only
 * Pagination: feed start-index
 *
 * Frontend id: zeustranslations
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://zeustranslations.blogspot.com';

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
		.replace(/&#\d+;/g, ' ')
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

function decodeEntities(s: string): string {
	return s
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

function parseChapterNumber(text: string, fallback = 0): number {
	const t = cleanText(text);
	const m =
		t.match(/(?:chapter|ch\.?|c)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function shortChapterTitle(n: number, raw?: string): string {
	if (n > 0) return `Chapter ${n}`;
	if (/prologue/i.test(raw || '')) return 'Prologue';
	if (/epilogue/i.test(raw || '')) return 'Epilogue';
	if (/side\s*story|extra/i.test(raw || '')) return 'Side Story';
	return 'Chapter';
}

function extractSeriesCode(categories: Array<{ term?: string }> | undefined): string | null {
	if (!Array.isArray(categories)) return null;
	for (const c of categories) {
		const t = (c?.term || '').trim();
		if (/^\d{3,5}$/.test(t)) return t;
	}
	return null;
}

function hasLabel(
	categories: Array<{ term?: string }> | undefined,
	label: string
): boolean {
	if (!Array.isArray(categories)) return false;
	const target = label.toLowerCase();
	return categories.some((c) => (c?.term || '').toLowerCase() === target);
}

function feedUrl(label: string, maxResults: number, startIndex = 1): string {
	const enc = encodeURIComponent(label);
	return `${BASE}/feeds/posts/default/-/${enc}?alt=json&max-results=${maxResults}&start-index=${startIndex}&orderby=published`;
}

type BloggerEntry = {
	id?: { $t?: string };
	title?: { $t?: string };
	published?: { $t?: string };
	updated?: { $t?: string };
	content?: { $t?: string };
	summary?: { $t?: string };
	category?: Array<{ term?: string }>;
	link?: Array<{ rel?: string; href?: string; type?: string }>;
	media$thumbnail?: { url?: string };
};

function entryAlternateHref(entry: BloggerEntry): string {
	const links = entry.link || [];
	const alt = links.find((l) => l.rel === 'alternate' && l.type?.includes('html'));
	return alt?.href || links.find((l) => l.rel === 'alternate')?.href || '';
}

function entryThumbnail(entry: BloggerEntry): string {
	const thumb = entry.media$thumbnail?.url || '';
	if (thumb) return thumb.replace(/\/s\d+-c\//, '/s400/').replace(/\/s\d+\//, '/s400/');
	const html = entry.content?.$t || entry.summary?.$t || '';
	const m = html.match(/src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)/i);
	return m ? m[1] : '';
}

function stripSeriesTitle(raw: string): string {
	return cleanText(raw)
		.replace(/\s*[-–|]\s*Zeus Translations\s*$/i, '')
		.replace(/\s*Chapter\s*\d+(\s*[-–]\s*\d+)?.*$/i, '')
		.replace(/\s*❤️.*$/i, '')
		.replace(/\s*Read NTR.*$/i, '')
		.trim();
}

function extractChapterHtml(html: string): string {
	let chunk = html;
	const more = html.search(/<a\s+name=["']more["'][^>]*>/i);
	if (more >= 0) chunk = html.slice(more);

	const $ = cheerio.load(chunk);

	$('script, style, noscript, iframe, .comments, #comments, .blog-pager').remove();

	const parts: string[] = [];
	$('h2, h3, p, blockquote').each((_, el) => {
		const tag = ((el as any).tagName || (el as any).name || '').toLowerCase();
		let t = cleanText(decodeEntities($(el).text()));
		if (!t || t.length < 2) return;
		if (/font size|font family|show comments|share to|labels?:|posted by|newer post|older post/i.test(t))
			return;
		if (/^advertisement|^sponsored/i.test(t)) return;
		if (/enterprise cloud|wealth management|credit markets|cyber insurance|maximizing corporate/i.test(t))
			return;
		if (tag === 'h2' || tag === 'h3') {
			parts.push(`<h3>${escapeHtml(t)}</h3>`);
		} else {
			parts.push(`<p>${escapeHtml(t)}</p>`);
		}
	});

	if (parts.length >= 2) return parts.join('\n');

	const fallback: string[] = [];
	$('p').each((_, p) => {
		const t = cleanText(decodeEntities($(p).text()));
		if (t.length > 30 && !/enterprise cloud|wealth management/i.test(t)) {
			fallback.push(`<p>${escapeHtml(t)}</p>`);
		}
	});
	return fallback.join('\n');
}

export class ZeusTranslationsSource extends BaseSource {
	id = 'zeustranslations';
	name = 'Zeus Translations';
	baseUrl = BASE;

	kind = 'novel' as const;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'application/json, text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	// ─── Feed helpers ────────────────────────────────────────────────────

	private async fetchFeed(
		label: string,
		maxResults: number,
		startIndex = 1
	): Promise<BloggerEntry[]> {
		const url = feedUrl(label, maxResults, startIndex);
		try {
			const res = await fetch(url, {
				headers: {
					...this.headers,
					Accept: 'application/json'
				}
			});
			if (!res.ok) return [];
			const data = (await res.json()) as {
				feed?: { entry?: BloggerEntry | BloggerEntry[] };
			};
			const entry = data?.feed?.entry;
			if (!entry) return [];
			return Array.isArray(entry) ? entry : [entry];
		} catch {
			return [];
		}
	}

	private async fetchAllFeed(
		label: string,
		pageSize = 150,
		hardCap = 800
	): Promise<BloggerEntry[]> {
		const all: BloggerEntry[] = [];
		let start = 1;
		while (all.length < hardCap) {
			const batch = await this.fetchFeed(label, pageSize, start);
			if (!batch.length) break;
			all.push(...batch);
			if (batch.length < pageSize) break;
			start += pageSize;
		}
		return all;
	}

	// ─── Latest ──────────────────────────────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		return this.getLatestNovels(page);
	}

	async getLatestNovels(page = 1): Promise<Manga[]> {
		const pageSize = 24;
		const startIndex = (Math.max(1, page) - 1) * pageSize + 1;
		const entries = await this.fetchFeed('Series', pageSize, startIndex);
		const list: Manga[] = [];
		const seen = new Set<string>();

		for (const e of entries) {
			const item = this.entryToManga(e);
			if (!item || seen.has(item.id)) continue;
			if (/^chapter\s*\d+/i.test(item.title)) continue;
			seen.add(item.id);
			list.push(item);
		}

		return list.slice(0, 24);
	}

	private entryToManga(entry: BloggerEntry): Manga | null {
		const href = entryAlternateHref(entry);
		if (!href) return null;
		const id = pathOnly(href);
		if (!id || id === '/') return null;

		const rawTitle = entry.title?.$t || '';
		const title = stripSeriesTitle(rawTitle);
		if (!title || title.length < 3) return null;

		const cover = entryThumbnail(entry);
		const cats = entry.category || [];

		let latestChapter: number | undefined;
		const range = rawTitle.match(/Chapter\s*(\d+)\s*[-–]\s*(\d+)/i);
		if (range) {
			latestChapter = parseFloat(range[2]);
		} else {
			const single = rawTitle.match(/Chapter\s*(\d+)/i);
			if (single) latestChapter = parseFloat(single[1]);
		}

		const status = hasLabel(cats, 'Completed') ? 'Completed' : 'Ongoing';

		return {
			id,
			title,
			cover: absUrl(cover),
			sourceId: this.id,
			type: 'novel',
			lang: 'en',
			status,
			...(latestChapter != null ? { latestChapter } : {})
		};
	}

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = query.trim();
		if (!q) return [];

		const all = await this.fetchFeed('Series', 80, 1);
		const ql = q.toLowerCase();
		const filtered = all
			.map((e) => this.entryToManga(e))
			.filter((m): m is Manga => !!m && m.title.toLowerCase().includes(ql));

		const start = (page - 1) * 24;
		return filtered.slice(start, start + 24);
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		path = path.replace(/\/$/, '');
		const pageUrl = path.startsWith('http') ? path : `${BASE}${path}`;

		const html = await this.fetchHtml(pageUrl);
		const $ = cheerio.load(html);
		const titleRaw =
			cleanText($('meta[property="og:title"]').attr('content') || '') ||
			cleanText($('title').first().text()) ||
			cleanText($('h2').first().text()) ||
			cleanText($('.post-title, .entry-title').first().text()) ||
			'';
		let title = stripSeriesTitle(
			titleRaw.replace(/\s*[-–|]\s*Zeus Translations\s*$/i, '')
		);
		if (!title || /^zeus translations$/i.test(title)) {
			title = stripSeriesTitle(cleanText($('h2').eq(0).text()));
		}
		if (!title || title.length < 2) {
			throw new Error('Novel not found (empty title)');
		}

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('meta[name="twitter:image"]').attr('content') ||
			'';
		if (!cover || cover.length < 8) {
			const imgM = html.match(
				/https:\/\/blogger\.googleusercontent\.com\/img\/[^"'\\s>]+\.(?:webp|jpg|jpeg|png)/i
			);
			if (imgM) cover = imgM[0];
		}
		cover = absUrl((cover || '').split('?')[0]);

		let description = '';
		const moreHtml = extractChapterHtml(html);
		if (moreHtml) {
			const $d = cheerio.load(moreHtml);
			const paras: string[] = [];
			$d('p').each((_, p) => {
				const t = cleanText($d(p).text());
				if (t.length > 50) paras.push(t);
			});
			description = paras.slice(0, 5).join('\n\n');
		}
		if (!description) {
			description =
				cleanText($('meta[property="og:description"]').attr('content') || '') ||
				cleanText($('meta[name="description"]').attr('content') || '');
		}

		const authors: string[] = [];
		const byMatch = titleRaw.match(/\(by\s+([^)]+)\)/i) || title.match(/\(by\s+([^)]+)\)/i);
		if (byMatch) {
			const name = cleanText(byMatch[1]);
			if (name && name.length < 60) authors.push(name);
		}

		const genres: string[] = [];
		for (const m of html.matchAll(/\/search\/label\/([^"'&<>\s]+)/gi)) {
			try {
				const g = decodeURIComponent(m[1].replace(/\+/g, ' '));
				if (
					g &&
					g.length < 30 &&
					!/^\d+$/.test(g) &&
					!/^series$/i.test(g) &&
					!genres.includes(g)
				) {
					genres.push(g);
				}
			} catch {
			}
		}
		if (!genres.includes('Adult')) genres.push('Adult');

		const status = genres.some((g) => /completed/i.test(g)) ? 'Completed' : 'Ongoing';

		let seriesCode: string | null = null;
		for (const m of html.matchAll(/\/search\/label\/(\d{3,5})/gi)) {
			seriesCode = m[1];
			break;
		}
		if (!seriesCode) {
			const m =
				html.match(/\/(\d{5})\.(?:webp|jpg|png)/i) ||
				html.match(/\/(\d{4})\.(?:webp|jpg|png)/i) ||
				html.match(/\b(000\d{2,3})\b/);
			if (m) seriesCode = m[1];
		}

		if (!seriesCode) {
			const seriesEntries = await this.fetchFeed('Series', 80, 1);
			const want = pathOnly(path);
			for (const e of seriesEntries) {
				const href = entryAlternateHref(e);
				if (pathOnly(href) === want) {
					seriesCode = extractSeriesCode(e.category);
					break;
				}
			}
		}

		let chapters: Chapter[] = [];
		if (seriesCode) {
			chapters = await this.fetchChaptersForCode(seriesCode, pathOnly(path));
		}
		if (chapters.length < 2) {
			const fromHtml = this.parseChaptersFromHtml($, pathOnly(path));
			if (fromHtml.length > chapters.length) chapters = fromHtml;
		}

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const cleanTitle = title.replace(/\s*\(by\s+[^)]+\)\s*$/i, '').trim() || title;

		return {
			id: pathOnly(path),
			title: cleanTitle,
			cover,
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters,
			type: 'novel',
			lang: 'en',
			...(chapters[0]?.number != null ? { latestChapter: chapters[0].number } : {})
		};
	}

	private async fetchChaptersForCode(
		code: string,
		seriesPath: string
	): Promise<Chapter[]> {
		const entries = await this.fetchAllFeed(code, 150, 900);
		const out: Chapter[] = [];
		const seenId = new Set<string>();
		const seenNum = new Set<number>();

		for (const e of entries) {
			if (hasLabel(e.category, 'Series')) continue;

			const href = entryAlternateHref(e);
			if (!href) continue;
			const id = pathOnly(href);
			if (id === seriesPath || seenId.has(id)) continue;
			seenId.add(id);

			const rawTitle = e.title?.$t || '';
			const num = parseChapterNumber(rawTitle, 0);
			if (num > 0 && seenNum.has(num)) continue;
			if (num > 0) seenNum.add(num);

			const locked = hasLabel(e.category, 'VIP');
			const date = e.published?.$t?.slice(0, 10);

			out.push({
				id,
				title: shortChapterTitle(num, rawTitle),
				number: num || out.length + 1,
				...(date ? { date } : {}),
				...(locked ? { isLocked: true } : {})
			});
		}

		return out;
	}

	private parseChaptersFromHtml(
		$: cheerio.CheerioAPI,
		seriesPath: string
	): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();
		let idx = 0;

		$('a').each((_, a) => {
			const href = $(a).attr('href') || '';
			if (!href.includes('zeustranslations.blogspot.com')) return;
			const id = pathOnly(href);
			if (id === seriesPath || seen.has(id)) return;
			const raw = cleanText($(a).attr('title') || $(a).text());
			if (!raw || !/chapter|prologue|epilogue/i.test(raw + id)) return;
			seen.add(id);
			idx += 1;
			const num = parseChapterNumber(raw, idx);
			out.push({
				id,
				title: shortChapterTitle(num, raw),
				number: num
			});
		});

		return out;
	}

	// ─── Chapter content ─────────────────────────────────────────────────

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		let path = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
		path = path.replace(/\/$/, '');
		const url = path.startsWith('http') ? path : `${BASE}${path}`;

		const html = await this.fetchHtml(url);
		const $ = cheerio.load(html);

		const rawTitle =
			cleanText($('meta[property="og:title"]').attr('content') || '') ||
			cleanText($('title').first().text()) ||
			cleanText($('h1').first().text()) ||
			cleanText($('h2').first().text()) ||
			'Chapter';

		const titleClean = rawTitle.replace(/\s*[-–|]\s*Zeus Translations\s*$/i, '');
		const num = parseChapterNumber(titleClean, 0);
		const title = shortChapterTitle(num, titleClean);
		const isVip =
			/vip-chapters|label\/VIP/i.test(html) &&
			!html.includes('name="more"') &&
			html.length < 40000;

		let content = extractChapterHtml(html);

		if (!content || content.length < 80) {
			try {
				const feedUrl2 = `${BASE}/feeds/posts/default?alt=json&max-results=1&q=${encodeURIComponent(titleClean.slice(0, 40))}`;
				const res = await fetch(feedUrl2, {
					headers: { ...this.headers, Accept: 'application/json' }
				});
				if (res.ok) {
					const data = (await res.json()) as {
						feed?: { entry?: BloggerEntry | BloggerEntry[] };
					};
					let entry = data?.feed?.entry;
					if (entry && !Array.isArray(entry)) entry = [entry];
					const body = Array.isArray(entry)
						? entry[0]?.content?.$t || entry[0]?.summary?.$t || ''
						: '';
					if (body && body.length > 100) {
						content = extractChapterHtml(body);
					}
				}
			} catch {
			}
		}

		if (!content || content.length < 80) {
			content = isVip
				? '<p>This chapter is VIP / locked on Zeus Translations. Content is not available without membership.</p>'
				: '<p>Content not available. The site may require JavaScript or the chapter is empty.</p>';
		}

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		try {
			let seriesCode: string | null = null;
			for (const m of html.matchAll(/\/search\/label\/(\d{3,5})/gi)) {
				seriesCode = m[1];
				break;
			}
			if (!seriesCode) {
				const m = html.match(/\b(000\d{2,3})\b/);
				if (m) seriesCode = m[1];
			}

			if (seriesCode) {
				const chapters = await this.fetchChaptersForCode(seriesCode, '');
				chapters.sort((a, b) => (a.number || 0) - (b.number || 0));

				const currentPath = pathOnly(path);
				let idx = chapters.findIndex((c) => c.id === currentPath);
				if (idx < 0 && num > 0) {
					idx = chapters.findIndex((c) => c.number === num);
				}

				if (idx >= 0) {
					if (idx > 0) prevChapterId = chapters[idx - 1].id;
					if (idx < chapters.length - 1) nextChapterId = chapters[idx + 1].id;
				}
			}
		} catch {
		}

		if (!prevChapterId || !nextChapterId) {
			$('#blog-pager-newer-link, a.blog-pager-newer-link').each((_, a) => {
				const href = $(a).attr('href') || '';
				if (href && !nextChapterId) nextChapterId = pathOnly(href);
			});
			$('#blog-pager-older-link, a.blog-pager-older-link').each((_, a) => {
				const href = $(a).attr('href') || '';
				if (href && !prevChapterId) prevChapterId = pathOnly(href);
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

export default ZeusTranslationsSource;
