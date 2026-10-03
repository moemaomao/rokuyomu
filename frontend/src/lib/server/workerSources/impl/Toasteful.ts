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
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types-manga';

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

	const pathDec = t.match(/-(\d+)-(\d+)(?:\.html)?$/i);
	if (pathDec && !/-v\d+c\d+/i.test(t)) {
		const whole = parseInt(pathDec[1], 10);
		const frac = parseInt(pathDec[2], 10);
		if (!Number.isNaN(whole) && !Number.isNaN(frac)) {
			return whole + frac / Math.pow(10, String(frac).length);
		}
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
		const tryPaths = [path];
		if (path.includes('alt=json') && !path.includes('json-in-script')) {
			tryPaths.push(path.replace('alt=json', 'alt=json-in-script') + '&callback=cb');
		}

		let lastErr: unknown;
		for (const p of tryPaths) {
			try {
				const rawText = await this.fetchHtml(p);
				const data = this.parseFeedPayload(rawText);
				const feed = data?.feed || {};
				const total =
					parseInt(feed?.['openSearch$totalResults']?.['$t'] || '0', 10) || 0;
				const raw = feed?.entry;
				const list: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];

				const entries: BlogEntry[] = list.map((e: any) => {
					const title = e?.title?.['$t'] || e?.title || '';
					const links = e?.link || [];
					const linkArr = Array.isArray(links) ? links : [links];
					const alt =
						linkArr.find((l: any) => l?.rel === 'alternate')?.href ||
						linkArr.find(
							(l: any) =>
								typeof l?.href === 'string' && l.href.includes('toasteful')
						)?.href ||
						'';
					const cats = (e?.category || [])
						.map((c: any) => c?.term || '')
						.filter(Boolean);
					const thumb =
						e?.['media$thumbnail']?.url || e?.media?.thumbnail?.url || '';
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
			} catch (err) {
				lastErr = err;
				console.warn(`[toasteful] feed try failed: ${p}`, err);
			}
		}
		throw lastErr || new Error('Feed fetch failed');
	}

	private parseFeedPayload(text: string): any {
		const t = (text || '').trim();
		if (t.startsWith('{')) {
			return JSON.parse(t);
		}

		const m = t.match(/^[a-zA-Z_$][\w$]*\s*\(\s*([\s\S]*)\s*\)\s*;?\s*$/);
		if (m) {
			return JSON.parse(m[1]);
		}

		const start = t.indexOf('{');
		const end = t.lastIndexOf('}');
		if (start >= 0 && end > start) {
			return JSON.parse(t.slice(start, end + 1));
		}
		throw new Error('Unable to parse feed payload');
	}

	private async fetchLatestFromHtml(page = 1): Promise<Manga[]> {
		const html = await this.fetchHtml(page <= 1 ? '/' : `/search?updated-max=&max-results=24&start=${(page - 1) * 24}&by-date=true`);
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();
        
		const scripts = $('script')
			.map((_, el) => $(el).html() || '')
			.get()
			.join('\n');
		const arrMatch = scripts.match(/fallbackNovels\s*=\s*\[([\s\S]*?)\];/);
		if (arrMatch) {
			const body = arrMatch[1];
			const objRe =
				/\{\s*url:\s*['"]([^'"]+)['"]\s*,\s*title:\s*["']([^"']+)["'][\s\S]*?(?:thumbnail:\s*(?:null|['"]([^'"]*)['"]))?/g;
			let om: RegExpExecArray | null;
			while ((om = objRe.exec(body)) !== null) {
				const url = om[1];
				const title = om[2];
				const thumb = om[3] || '';
				if (!url || !title) continue;
				const id = pathOnly(url, this.baseUrl).replace(/\.html$/i, '');
				if (seen.has(id)) continue;
				seen.add(id);
				list.push({
					id,
					title: title.slice(0, 250),
					cover: absUrl(this.baseUrl, (thumb || '').split('?')[0]),
					sourceId: this.id,
					type: 'novel',
					lang: 'en',
					status: 'Ongoing'
				});
			}
		}

		$('h3.post-title a, .post-title a, h2 a, a[href*="/20"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			let p = pathOnly(href, this.baseUrl).replace(/\.html$/i, '');
			if (!p.includes('/20')) return;

			if (isChapterPath(p)) {
				p = p
					.replace(/-v\d+c\d+(?:\.\d+)?$/i, '')
					.replace(/-\d+(?:\.\d+)?$/i, '');
			}
			if (!isSeriesPath(p) && !/^\/\d{4}\/\d{2}\/[a-z0-9\-]+$/i.test(p)) return;
			if (seen.has(p)) return;

			let title = $(a).text().replace(/\s+/g, ' ').trim();
			title = title
				.replace(/^\d+\.\s*/, '')
				.replace(/^(?:Volume\s*\d+\s*)?Chapter\s*\d+(?:\.\d+)?\s*/i, '')
				.trim();
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

		console.log(`[toasteful] html fallback page=${page} → ${list.length}`);
		return list.slice(0, 24);
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
		if (e.contentHtml) {
			const imgs = [
				...e.contentHtml.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)
			].map((m) => m[1]);
			const good =
				imgs.find(
					(s) =>
						/ibb\.co|blogger|bp\.blogspot|googleusercontent|imgur/i.test(s) &&
						!/icon|logo|pixel|1x1/i.test(s)
				) || imgs.find((s) => !/icon|logo|follow\.it|pixel/i.test(s));
			if (good) cover = good;
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

			if (list.length > 0) {
				console.log(`[toasteful] latest page=${p} → ${list.length}`);
				return list;
			}
			console.warn('[toasteful] feed returned 0 series, trying HTML fallback');
		} catch (err) {
			console.error('[toasteful] latest feed failed, HTML fallback', err);
		}

		try {
			return await this.fetchLatestFromHtml(p);
		} catch (err2) {
			console.error('[toasteful] html fallback failed', err2);
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

		const body = $('#post-body, .post-body.entry-content[itemprop], .post-body.entry-content, .post-body').first();
		const bodyHtml = body.html() || '';

		let cover = '';
		const coverCandidates: string[] = [];
		body.find('img').each((_, img) => {
			const src = $(img).attr('src') || $(img).attr('data-src') || '';
			if (!src) return;
			if (/follow\.it|icon|logo|avatar|button|badge|1x1|pixel/i.test(src)) return;
			coverCandidates.push(src);
		});
		cover =
			coverCandidates.find((s) => /ibb\.co|blogger|bp\.blogspot|googleusercontent|imgur|webp|png|jpg/i.test(s)) ||
			coverCandidates[0] ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = absUrl(this.baseUrl, (cover || '').split('?')[0]);

		const genres: string[] = [];
		let status = 'Ongoing';
		body.find('a[href*="/search/label/"]').each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (!g) return;
			if (/^completed$/i.test(g)) status = 'Completed';
			else if (/^dropped$|^hiatus$/i.test(g)) status = 'Hiatus';
			else if (/^ongoing$/i.test(g)) status = 'Ongoing';
			else if (!BLACKLIST_LABELS.has(g) && g.length < 40 && !genres.includes(g)) {
				genres.push(g);
			}
		});

		const genreLine = bodyHtml.match(/Genre\s*:\s*([\s\S]*?)(?:<a\s+name=["']more["']|Description\s*:|Other name|$)/i);
		if (genreLine) {
			const extra = cheerio.load(`<div>${genreLine[1]}</div>`)('div').text();
			extra.split(/[,|]/).forEach((g) => {
				const t = g.replace(/\s+/g, ' ').trim();
				if (t && t.length < 40 && !BLACKLIST_LABELS.has(t) && !genres.includes(t)) {
					genres.push(t);
				}
			});
		}

		let description = '';
		let metaHtml = bodyHtml;
		const tocCut = metaHtml.search(
			/<b[^>]*>\s*Chapter\s*:?\s*<\/b>|<div[^>]*>\s*<b[^>]*>\s*Chapter\s*:?\s*<\/b>|<!--Paste code|<b[^>]*>\s*<u>\s*Volume\s+\d+/i
		);
		if (tocCut > 0) metaHtml = metaHtml.slice(0, tocCut);

		const descMatch = metaHtml.match(
			/Description\s*:\s*<\/p>\s*([\s\S]*)/i
		) || metaHtml.match(
			/Description\s*:\s*([\s\S]*)/i
		) || metaHtml.match(
			/Synopsis\s*:\s*([\s\S]*)/i
		);
		if (descMatch) {
			description = cheerio
				.load(`<div>${descMatch[1]}</div>`)('div')
				.text()
				.replace(/\s+/g, ' ')
				.trim();
		}
		if (!description || description.length < 40) {
			const $meta = cheerio.load(`<div id="x">${metaHtml}</div>`);
			const paras = $meta('#x > p, #x p')
				.map((_, el) => $meta(el).text().replace(/\s+/g, ' ').trim())
				.get()
				.filter(
					(t) =>
						t.length > 40 &&
						!/^genre\s*:/i.test(t) &&
						!/^other name\s*:/i.test(t) &&
						!/^raw source/i.test(t) &&
						!/^chapter\s*\d/i.test(t) &&
						!/^volume\s*\d/i.test(t) &&
						!/enable javascript/i.test(t)
				);
			description = paras.slice(0, 8).join('\n\n');
		}

		if (description.length > 3000) description = description.slice(0, 3000).trim() + '…';

		const authors: string[] = [];
		const authorMatch = metaHtml.match(/Author\s*[:：]\s*([^<\n\r]+)/i);
		if (authorMatch) {
			const name = authorMatch[1].replace(/\s+/g, ' ').trim().slice(0, 80);
			if (name) authors.push(name);
		}

		let altTitle = '';
		const otherName = metaHtml.match(/Other name\s*:\s*([^<]+)/i);
		if (otherName) {
			altTitle = otherName[1].replace(/\s+/g, ' ').trim();
		}
		if (!altTitle) {
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
		}

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		const seriesSlug = (path.split('/').pop() || '').replace(/\.html$/i, '');

		const linkScope = body.length ? body : $('body');
		linkScope.find('a[href]').each((_, a) => {
			const href = ($(a).attr('href') || '').trim();
			if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

			let full = pathOnly(href, this.baseUrl).replace(/\.html$/i, '');
			if (!full.startsWith('/')) full = `/${full}`;

			if (!isChapterPath(full)) return;

			const chSlug = seriesSlugFromChapterPath(full);
			const sameSeries =
				chSlug === seriesSlug ||
				full.includes(`/${seriesSlug}-`) ||
				full.includes(`/${seriesSlug}/`);
			if (!sameSeries) return;

			const id = full;
			if (seen.has(id)) return;
			seen.add(id);

			const rawTitle = $(a).text().replace(/\s+/g, ' ').trim() || id;
			let number = parseChapterNumber(id, 0);
			if (number <= 0) number = parseChapterNumber(rawTitle, 0);
			if (number <= 0) number = chapters.length + 1;

			const parentHtml = (
				($(a).parent().html() || '') +
				' ' +
				($(a).attr('class') || '')
			).toLowerCase();
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
		if (nums.length && nums.length !== new Set(nums).size) {
			chapters.forEach((c, i) => {
				if (chapters.filter((x) => x.number === c.number).length > 1) {
				}
			});
			const dupCount = nums.length - new Set(nums).size;
			if (dupCount > chapters.length * 0.3) {
				chapters.forEach((c, i) => {
					c.number = i + 1;
					c.title = `Chapter ${i + 1}`;
				});
			}
		}
		chapters.reverse();

		console.log(
			`[toasteful] details ${path} → ${chapters.length} chapters, cover=${cover ? 'yes' : 'no'}, desc=${description.length}c`
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
			latestChapter: chapters[0]
				? chapters[0].number >= 1000
					? chapters[0].number % 1000 || chapters[0].number
					: chapters[0].number
				: undefined
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
