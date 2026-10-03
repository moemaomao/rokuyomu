/**
 * Toasteful (www.toasteful.com) — Blogger novel TL site
 * Path: scraper/src/sources/impl/novel/Toasteful.ts
 *
 * - List: /feeds/posts/default/-/Web%20Novel?alt=json (24 / page)
 * - Detail: /YYYY/MM/{slug}.html  (TOC of chapter links)
 * - Chapter: /YYYY/MM/{slug}-{n}.html or /YYYY/MM/{slug}-v{vol}c{n}.html
 * - Content: #post-body / .post-body.entry-content[itemprop]
 * - Prev/Next: .ChapterNav a.prev / a.next (static href; JS-filled fallback by pattern)
 * - Search: feed ?q= + filter Web Novel label / series pages
 * - Chapter title shortened to "Chapter N"
 * - isLocked if password form / empty body
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BLACKLIST_LABELS = new Set([
	'Web Novel',
	'Ongoing',
	'Dropped',
	'Completed',
	'Hiatus'
]);

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

function pathOnly(href: string, baseHost = 'https://www.toasteful.com'): string {
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

	const volCh =
		t.match(/v(?:ol(?:ume)?)?[.\-_]?(\d+)\s*c(?:h(?:apter)?)?[.\-_]?(\d+(?:\.\d+)?)/i) ||
		t.match(/volume\s*(\d+)\s*chapter\s*(\d+(?:\.\d+)?)/i);
	if (volCh) {
		const vol = parseInt(volCh[1], 10);
		const ch = parseFloat(volCh[2]);
		if (!Number.isNaN(vol) && !Number.isNaN(ch)) return vol * 1000 + ch;
	}

	const pathNum = t.match(/-(\d+(?:\.\d+)?)(?:\.html)?$/i);
	if (pathNum) {
		const n = parseFloat(pathNum[1]);
		if (!Number.isNaN(n) && n > 0) return n;
	}

	const ch = t.match(/(?:chapter|ch\.?|c)\s*[.\-_]?\s*(\d+(?:\.\d+)?)/i);
	if (ch) {
		const n = parseFloat(ch[1]);
		if (!Number.isNaN(n)) return n;
	}

	const bare = t.match(/(?:^|[\s\-_/])(\d+(?:\.\d+)?)(?:$|[\s\-_/]|\.html)/);
	if (bare) {
		const n = parseFloat(bare[1]);
		if (!Number.isNaN(n) && n > 0) return n;
	}

	return fallback;
}

function shortChapterTitle(number: number, raw?: string): string {
	let display = number;
	if (number >= 1000) {
		const ep = number % 1000;
		if (ep > 0) display = ep;
	}
	if (display > 0) {
		return Number.isInteger(display) ? `Chapter ${display}` : `Chapter ${display}`;
	}
	const n = parseChapterNumber(raw || '', 0);
	if (n >= 1000) {
		const ep = n % 1000;
		if (ep > 0) return `Chapter ${ep}`;
	}
	return n > 0 ? `Chapter ${n}` : 'Chapter';
}

function isSeriesPath(path: string): boolean {
	const clean = path.replace(/\/$/, '');
	const m = clean.match(/^\/(\d{4})\/(\d{2})\/([a-z0-9\-]+)$/i);
	if (!m) return false;
	const slug = m[3];
	if (/-\d+(?:\.\d+)?$/i.test(slug)) return false;
	if (/-v\d+c\d+/i.test(slug)) return false;
	return true;
}

function isChapterPath(path: string): boolean {
	const clean = path.replace(/\/$/, '');
	const m = clean.match(/^\/(\d{4})\/(\d{2})\/([a-z0-9\-]+)(?:\.html)?$/i);
	if (!m) return false;
	const slug = m[3].replace(/\.html$/i, '');
	return /-\d+(?:\.\d+)?$/i.test(slug) || /-v\d+c\d+/i.test(slug);
}

function seriesSlugFromChapterPath(path: string): string {
	const clean = path.replace(/\/$/, '').replace(/\.html$/i, '');
	const parts = clean.split('/').filter(Boolean);
	const last = parts[parts.length - 1] || '';
	return last
		.replace(/-v\d+c\d+(?:\.\d+)?$/i, '')
		.replace(/-\d+(?:\.\d+)?$/i, '');
}

interface BlogEntry {
	title: string;
	link: string;
	published?: string;
	categories: string[];
	thumbnail?: string;
	contentHtml?: string;
}

export class ToastefulSource extends BaseSource {
	id = 'toasteful';
	name = 'Toasteful';
	baseUrl = 'https://www.toasteful.com';

	kind = 'novel' as const;

	// ─── Feed helpers ────────────────────────────────────────────────────

	private async fetchFeedJson(path: string): Promise<{
		entries: BlogEntry[];
		total: number;
	}> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const res = await fetch(url, {
			headers: {
				...this.headers,
				Accept: 'application/json',
				Referer: this.baseUrl
			}
		});
		if (!res.ok) {
			throw new Error(`Feed ${res.status} ${url}`);
		}
		const data = await res.json();
		const feed = data?.feed || {};
		const total = parseInt(feed?.['openSearch$totalResults']?.['$t'] || '0', 10) || 0;
		const raw = feed?.entry;
		const list: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];

		const entries: BlogEntry[] = list.map((e: any) => {
			const title = e?.title?.['$t'] || e?.title || '';
			const links = e?.link || [];
			const linkArr = Array.isArray(links) ? links : [links];
			const alt =
				linkArr.find((l: any) => l?.rel === 'alternate')?.href ||
				linkArr.find((l: any) => typeof l?.href === 'string' && l.href.includes('toasteful'))
					?.href ||
				'';
			const cats = (e?.category || []).map((c: any) => c?.term || '').filter(Boolean);
			const thumb =
				e?.['media$thumbnail']?.url ||
				e?.media?.thumbnail?.url ||
				'';
			const contentHtml = e?.content?.['$t'] || e?.summary?.['$t'] || '';
			return {
				title: String(title).replace(/\s+/g, ' ').trim(),
				link: alt,
				published: e?.published?.['$t'] || e?.updated?.['$t'],
				categories: cats,
				thumbnail: thumb,
				contentHtml
			};
		});

		return { entries, total };
	}

	private entryToManga(e: BlogEntry, statusHint?: string): Manga | null {
		if (!e.link) return null;
		const path = pathOnly(e.link, this.baseUrl);
		if (!isSeriesPath(path) && !path.match(/^\/\d{4}\/\d{2}\/[a-z0-9\-]+$/i)) {
			return null;
		}
		const id = path.replace(/\.html$/i, '');
		const cats = e.categories || [];
		let status = statusHint || 'Ongoing';
		if (cats.some((c) => /completed/i.test(c))) status = 'Completed';
		else if (cats.some((c) => /dropped|hiatus/i.test(c))) status = 'Hiatus';
		else if (cats.some((c) => /ongoing/i.test(c))) status = 'Ongoing';

		let cover = e.thumbnail || '';
		if (!cover && e.contentHtml) {
			const m = e.contentHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
			if (m) cover = m[1];
		}

		return {
			id,
			title: e.title.slice(0, 250),
			cover: absUrl(this.baseUrl, (cover || '').split('?')[0]),
			sourceId: this.id,
			type: 'novel',
			status,
			lang: 'en'
		};
	}

	// ─── Latest ──────────────────────────────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		return this.getLatestNovels(page);
	}

	async getLatestNovels(page = 1): Promise<Manga[]> {
		const p = Math.max(1, page);
		const max = 24;
		const start = (p - 1) * max + 1;
		const path = `/feeds/posts/default/-/Web%20Novel?alt=json&max-results=${max}&start-index=${start}`;

		try {
			const { entries } = await this.fetchFeedJson(path);
			const list: Manga[] = [];
			const seen = new Set<string>();

			for (const e of entries) {
				if ((e.categories || []).some((c) => /^dropped$/i.test(c))) continue;
				const item = this.entryToManga(e);
				if (!item || seen.has(item.id)) continue;
				seen.add(item.id);
				list.push(item);
			}

			console.log(`[toasteful] latest page=${p} → ${list.length}`);
			return list;
		} catch (err) {
			console.error('[toasteful] latest', err);
			return [];
		}
	}

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		return this.searchNovels(query, opts);
	}

	async searchNovels(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim();
		if (!q) return this.getLatestNovels(opts?.page ?? 1);

		const page = Math.max(1, opts?.page ?? 1);
		const max = 24;
		const start = (page - 1) * max + 1;

		try {
			const path = `/feeds/posts/default?alt=json&max-results=${max}&start-index=${start}&q=${encodeURIComponent(q)}`;
			const { entries } = await this.fetchFeedJson(path);
			const list: Manga[] = [];
			const seen = new Set<string>();

			for (const e of entries) {
				const cats = e.categories || [];
				const path = pathOnly(e.link, this.baseUrl);
				const isSeries =
					cats.some((c) => /^web novel$/i.test(c)) || isSeriesPath(path.replace(/\.html$/i, ''));

				if (isSeries) {
					const item = this.entryToManga(e);
					if (item && !seen.has(item.id)) {
						seen.add(item.id);
						list.push(item);
					}
					continue;
				}

				if (isChapterPath(path.replace(/\.html$/i, ''))) {
					const slug = seriesSlugFromChapterPath(path);
					const seriesGuess = path
						.replace(/\.html$/i, '')
						.replace(/-v\d+c\d+(?:\.\d+)?$/i, '')
						.replace(/-\d+(?:\.\d+)?$/i, '');
					const id = seriesGuess;
					if (seen.has(id)) continue;
					seen.add(id);
					list.push({
						id,
						title: e.title
							.replace(/^(?:Volume\s*\d+\s*)?Chapter\s*\d+(?:\.\d+)?\s*/i, '')
							.replace(/\s+/g, ' ')
							.trim()
							.slice(0, 250) || slug,
						cover: '',
						sourceId: this.id,
						type: 'novel',
						lang: 'en'
					});
				}
			}

			if (list.length < 2) {
				const htmlPath =
					page <= 1
						? `/search?q=${encodeURIComponent(q)}`
						: `/search?q=${encodeURIComponent(q)}&max-results=20&by-date=false`;
				const html = await this.fetchHtml(htmlPath);
				const $ = cheerio.load(html);
				$('h3.post-title a, .post-title a, a[href*="/20"]').each((_, a) => {
					const href = $(a).attr('href') || '';
					let p = pathOnly(href, this.baseUrl).replace(/\.html$/i, '');
					if (isChapterPath(p)) {
						p = p.replace(/-v\d+c\d+(?:\.\d+)?$/i, '').replace(/-\d+(?:\.\d+)?$/i, '');
					}
					if (!isSeriesPath(p) && !p.match(/^\/\d{4}\/\d{2}\/[a-z0-9\-]+$/i)) return;
					if (seen.has(p)) return;
					const title = $(a).text().replace(/\s+/g, ' ').trim();
					if (!title || title.length < 3) return;
					seen.add(p);
					list.push({
						id: p,
						title: title.slice(0, 250),
						cover: '',
						sourceId: this.id,
						type: 'novel',
						lang: 'en'
					});
				});
			}

			console.log(`[toasteful] search "${q}" page=${page} → ${list.length}`);
			return list;
		} catch (err) {
			console.error('[toasteful] search', err);
			return [];
		}
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		return this.getNovelDetails(mangaId);
	}

	async getNovelDetails(novelId: string): Promise<MangaDetails> {
		let path = pathOnly(novelId, this.baseUrl).replace(/\.html$/i, '');
		if (isChapterPath(path)) {
			path = path.replace(/-v\d+c\d+(?:\.\d+)?$/i, '').replace(/-\d+(?:\.\d+)?$/i, '');
		}
		const fetchPath = path.endsWith('.html') ? path : `${path}.html`;

		const html = await this.fetchHtml(fetchPath.startsWith('/') ? fetchPath : `/${fetchPath}`);
		const $ = cheerio.load(html);

		const title =
			$('h3.post-title, h1.post-title, .post-title')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim()
				.replace(/^Toasteful:\s*/i, '') ||
			$('meta[property="og:title"]')
				.attr('content')
				?.replace(/^Toasteful:\s*/i, '')
				?.trim() ||
			path.split('/').pop()?.replace(/-/g, ' ') ||
			'';

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('.post-body img, .entry-content img, #post-body img').first().attr('src') ||
			$('a[href*="ibb.co"] img, a[href*="blogspot"] img').first().attr('src') ||
			'';
		cover = absUrl(this.baseUrl, (cover || '').split('?')[0]);

		const genres: string[] = [];
		let status = 'Ongoing';
		$('.post-labels a, a[href*="/search/label/"]').each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (!g) return;
			if (/^completed$/i.test(g)) status = 'Completed';
			else if (/^dropped$|^hiatus$/i.test(g)) status = 'Hiatus';
			else if (/^ongoing$/i.test(g)) status = 'Ongoing';
			else if (!BLACKLIST_LABELS.has(g) && g.length < 40 && !genres.includes(g)) {
				genres.push(g);
			}
		});

		let description = '';
		const body = $('#post-body, .post-body.entry-content, .post-body').first();
		const bodyHtml = body.html() || '';
		const synMatch = bodyHtml.match(
			/Synopsis\s*:?\s*<\/?(?:b|strong|span)[^>]*>\s*([\s\S]*?)(?=<b>|<strong>|Chapter\s*List|Table\s*of|All\s*Chapter|<h[1-3])/i
		);
		if (synMatch) {
			description = cheerio
				.load(`<div>${synMatch[1]}</div>`)('div')
				.text()
				.replace(/\s+/g, ' ')
				.trim();
		}
		if (!description) {
			const paras = body
				.find('div, p, span')
				.map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
				.get()
				.filter(
					(t) =>
						t.length > 60 &&
						!/^chapter\s*\d/i.test(t) &&
						!/^notice:/i.test(t) &&
						!/enable javascript/i.test(t)
				);
			description = paras.slice(0, 6).join('\n\n');
		}

		const authors: string[] = [];
		const authorMatch = (body.text() || '').match(/Author\s*[:：]\s*([^\n\r<]+)/i);
		if (authorMatch) {
			const name = authorMatch[1].replace(/\s+/g, ' ').trim().slice(0, 80);
			if (name) authors.push(name);
		}

		let altTitle = '';
		body.find('a').each((_, a) => {
			const t = $(a).text().replace(/\s+/g, ' ').trim();
			const href = $(a).attr('href') || '';
			if (
				/[\u3040-\u30ff\u3400-\u9fff]/.test(t) &&
				(href.includes('kakuyomu') || href.includes('syosetu') || href.includes('ncode'))
			) {
				altTitle = t;
				return false;
			}
		});

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		const seriesSlug = path.split('/').pop() || '';

		$('a[href]').each((_, a) => {
			const href = $(a).attr('href') || '';
			let full = pathOnly(href, this.baseUrl).replace(/\.html$/i, '');
			if (!isChapterPath(full)) return;

			const chSlug = seriesSlugFromChapterPath(full);
			if (chSlug !== seriesSlug && !full.includes(`/${seriesSlug}-`)) return;

			const id = full.startsWith('/') ? full : `/${full}`;
			if (seen.has(id)) return;
			seen.add(id);

			const rawTitle = $(a).text().replace(/\s+/g, ' ').trim() || id;
			let number = parseChapterNumber(id, 0);
			if (number <= 0) number = parseChapterNumber(rawTitle, 0);
			if (number <= 0) number = chapters.length + 1;

			const parentHtml = (($(a).parent().html() || '') + ($(a).attr('class') || '')).toLowerCase();
			const isLocked =
				/\block\b|password|premium|patreon|ko-fi exclusive|members.?only|🔒/i.test(
					parentHtml + ' ' + rawTitle
				);

			chapters.push({
				id,
				title: shortChapterTitle(number, rawTitle),
				number,
				...(isLocked ? { isLocked: true } : {})
			});
		});

		chapters.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
		const nums = chapters.map((c) => c.number);
		if (nums.length !== new Set(nums).size) {
			chapters.forEach((c, i) => {
				c.number = i + 1;
				c.title = `Chapter ${i + 1}`;
			});
		}
		chapters.reverse();

		console.log(
			`[toasteful] details ${path} → ${chapters.length} chapters (${chapters.filter((c) => c.isLocked).length} locked)`
		);

		const details: MangaDetails & { altTitles?: string[] } = {
			id: path,
			title,
			cover,
			sourceId: this.id,
			description: description || '',
			authors,
			status,
			genres,
			chapters,
			type: 'novel',
			lang: 'en',
			latestChapter: chapters[0]?.number
		};
		if (altTitle) details.altTitles = [altTitle];

		return details as MangaDetails;
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
		let path = pathOnly(chapterId, this.baseUrl).replace(/\.html$/i, '');
		const fetchPath = `${path}.html`;

		const html = await this.fetchHtml(fetchPath.startsWith('/') ? fetchPath : `/${fetchPath}`);
		const $ = cheerio.load(html);

		const hasPassword =
			$('form.post-password-form, input[type="password"], .post-password-form').length > 0;
		if (hasPassword) {
			throw new Error('Chapter is locked / password-protected on Toasteful');
		}

		const rawTitle =
			$('h3.post-title, h1.post-title, .post-title')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim()
				.replace(/^Toasteful:\s*/i, '') ||
			$('meta[property="og:title"]')
				.attr('content')
				?.replace(/^Toasteful:\s*/i, '')
				?.trim() ||
			'';
		let number = parseChapterNumber(path, 0);
		if (number <= 0) number = parseChapterNumber(rawTitle, 0);
		const title = shortChapterTitle(number > 0 ? number : 1, rawTitle);

		const contentEl = $(
			'#post-body, .post-body.entry-content[itemprop], .post-body.entry-content, .post-body'
		).first();
		contentEl
			.find(
				'script, style, noscript, .ads, .ad, iframe, .ChapterNav, .js-notice, .sharedaddy, .comments, #comments, .post-footer, .post-header, .code-block'
			)
			.remove();

		let contentHtml = contentEl.html() || '';
		contentHtml = contentHtml
			.replace(/<script[\s\S]*?<\/script>/gi, '')
			.replace(/<style[\s\S]*?<\/style>/gi, '')
			.replace(/on\w+="[^"]*"/gi, '')
			.trim();

		if (!contentHtml || contentHtml.replace(/<[^>]+>/g, '').trim().length < 40) {
			const paras = contentEl
				.find('div, p, span')
				.map((_, el) => $(el).text().trim())
				.get()
				.filter((t) => t.length > 2 && !/^notice:/i.test(t));
			if (paras.length) {
				contentHtml = paras.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
			}
		}

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		const seriesSlug = seriesSlugFromChapterPath(path);

		$('.ChapterNav a.prev, .ch-bottom a.prev, a.prev').each((_, a) => {
			const href = ($(a).attr('href') || '').trim();
			if (!href || href === '#' || href === '') return;
			const full = pathOnly(href, this.baseUrl).replace(/\.html$/i, '');
			if (!isChapterPath(full)) return;
			if (seriesSlugFromChapterPath(full) !== seriesSlug) return;
			prevChapterId = full.startsWith('/') ? full : `/${full}`;
		});

		$('.ChapterNav a.next, .ch-bottom a.next, a.next').each((_, a) => {
			const href = ($(a).attr('href') || '').trim();
			if (!href || href === '#' || href === '') return;
			const full = pathOnly(href, this.baseUrl).replace(/\.html$/i, '');
			if (!isChapterPath(full)) return;
			if (seriesSlugFromChapterPath(full) !== seriesSlug) return;
			nextChapterId = full.startsWith('/') ? full : `/${full}`;
		});

		if ((!prevChapterId || !nextChapterId) && number > 0) {
			const m = path.match(/^(\/\d{4}\/\d{2}\/.+?)(?:-v(\d+)c(\d+(?:\.\d+)?)|-(\d+(?:\.\d+)?))$/i);
			if (m) {
				const base = m[1];
				if (m[2] != null) {
					const vol = parseInt(m[2], 10);
					const ch = parseFloat(m[3]);
					if (!nextChapterId) {
						nextChapterId = `${base}-v${vol}c${ch + 1}`;
					}
					if (!prevChapterId && ch > 1) {
						prevChapterId = `${base}-v${vol}c${ch - 1}`;
					}
				} else if (m[4] != null) {
					const ch = parseFloat(m[4]);
					if (!nextChapterId) nextChapterId = `${base}-${ch + 1}`;
					if (!prevChapterId && ch > 1) {
						const prevN = ch === Math.floor(ch) ? ch - 1 : Math.floor(ch);
						prevChapterId = `${base}-${prevN}`;
					}
				}
			}
		}

		console.log(
			`[toasteful] chapter ${path} → content=${contentHtml.length} chars prev=${prevChapterId} next=${nextChapterId}`
		);

		return {
			title,
			content: contentHtml || '<p>No content</p>',
			prevChapterId,
			nextChapterId
		};
	}
}

export default ToastefulSource;
