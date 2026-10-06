/**
 * Eastern Wordsmith (easternwordsmith.com) — custom novel site + Cloudflare
 * Path: scraper/src/sources/impl/novel/EasternWordsmith.ts
 *
 * URLs:
 *   Home / Latest : /  (section "Latest Updates")
 *   All novels    : /novels
 *   Updates feed  : /updates
 *   Novel detail  : /novel/{Title With Spaces}
 *   Chapter       : /chapter/{numericId}
 *   Cover         : /novel-image/{id}
 *
 * Test: curl.exe "http://localhost:3000/easternwordsmith/latest?page=1"
 */
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const PAGE_SIZE = 24;
const BASE = 'https://easternwordsmith.com';

function absUrl(href: string | undefined): string {
	if (!href) return '';
	let h = String(href).trim();
	h = h.replace(/^https?:\/\/web\.archive\.org\/web\/\d+(?:id_|im_)?\//i, '');
	if (h.startsWith('//')) return `https:${h}`;
	if (/^https?:\/\//i.test(h)) return h;
	try {
		return new URL(h, BASE).href;
	} catch {
		return h.startsWith('/') ? `${BASE}${h}` : `${BASE}/${h}`;
	}
}

function pathOnly(href: string): string {
	try {
		const u = new URL(absUrl(href));
		let p = u.pathname || '/';
		// decode then re-normalize
		try {
			p = decodeURIComponent(p);
		} catch {
			/* keep */
		}
		if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
		return p || '/';
	} catch {
		let p = href.startsWith('/') ? href : `/${href}`;
		p = p.replace(/\/$/, '') || '/';
		return p;
	}
}

/** Encode path for fetch — keep /novel/Foo Bar as /novel/Foo%20Bar */
function encodePath(path: string): string {
	if (path.startsWith('http')) return path;
	const parts = path.split('/').map((seg, i) => {
		if (i === 0 && seg === '') return '';
		try {
			return encodeURIComponent(decodeURIComponent(seg));
		} catch {
			return encodeURIComponent(seg);
		}
	});
	return parts.join('/');
}

function decodeEntities(s: string): string {
	return (s || '')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#039;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function stripHtml(html: string): string {
	return decodeEntities(
		html
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/p>/gi, '\n\n')
			.replace(/<[^>]+>/g, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
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
	const patterns = [
		/(?:chapter|ch\.?)\s*v?\d*\s*[cC]?[.\-_]?\s*(\d+(?:\.\d+)?)/i,
		/(?:chapter|ch\.?)\s*[.\-_]?\s*(\d+(?:\.\d+)?)/i,
		/\/chapter\/(\d+)(?:\/|$)/i,
		/\b(\d+(?:\.\d+)?)\b/
	];
	for (const re of patterns) {
		const m = t.match(re);
		if (m) {
			const n = parseFloat(m[1]);
			if (!Number.isNaN(n) && n > 0) return n;
		}
	}
	return fallback;
}

function shortChapterTitle(number: number, raw?: string): string {
	if (number > 0) return `Chapter ${number}`;
	const n = parseChapterNumber(raw || '', 0);
	return n > 0 ? `Chapter ${n}` : 'Chapter';
}

function isNovelPath(path: string): boolean {
	const p = pathOnly(path);
	return /^\/novel\/.+/i.test(p) && !/\/chapter\//i.test(p);
}

function isChapterPath(path: string): boolean {
	return /^\/chapter\/\d+/i.test(pathOnly(path));
}

function normalizeCover(src: string | undefined): string {
	if (!src) return '';
	let s = absUrl(src);
	s = s.replace(/^https?:\/\/web\.archive\.org\/web\/\d+im_\//i, '');
	if (/no[_-]?image/i.test(s)) return '';
	return s;
}

function isChallengeHtml(html: string): boolean {
	const head = html.slice(0, 8000).toLowerCase();
	return (
		head.includes('just a moment') ||
		head.includes('cf-browser-verification') ||
		head.includes('challenge-platform') ||
		head.includes('checking your browser') ||
		(head.includes('cloudflare') && head.includes('enable javascript'))
	);
}

export class EasternWordsmithSource extends BaseSource {
	id = 'easternwordsmith';
	name = 'Eastern Wordsmith';
	baseUrl = BASE;
	kind = 'novel' as const;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: BASE + '/'
	};

	protected async fetchHtml(path: string): Promise<string> {
		const raw = path.startsWith('http')
			? path
			: `${this.baseUrl}${encodePath(path.startsWith('/') ? path : `/${path}`)}`;

		// 1) Normal path (cookie jar + Byparr if CF HTML detected)
		try {
			const html = await fetchWithCf(raw, {
				headers: {
					...this.headers,
					Referer: this.baseUrl + '/'
				}
			});
			if (!isChallengeHtml(html) && html.length > 500) {
				return html;
			}
			console.warn(
				`[easternwordsmith] fetchWithCf returned challenge/short body len=${html.length}, forcing Byparr`
			);
		} catch (e: any) {
			// Node "fetch failed" / ECONNRESET / etc. — never reached CF detector
			console.warn(
				`[easternwordsmith] direct fetch failed (${e?.message || e}), forcing Byparr for ${raw}`
			);
		}

		// 2) Force Byparr solve (site often blocks bare Node TLS before CF page)
		const { solveWithByparr, isByparrEnabled } = await import('../../../lib/byparr');
		if (!isByparrEnabled()) {
			throw new Error(
				`Cannot reach ${raw} and BYPARR_URL is not set. Start Byparr and set BYPARR_URL.`
			);
		}

		const solved = await solveWithByparr(raw, { maxTimeoutMs: 90_000 });
		if (!solved.html || isChallengeHtml(solved.html)) {
			throw new Error(
				`Byparr did not return usable HTML for ${raw} (len=${solved.html?.length || 0})`
			);
		}
		console.log(
			`[easternwordsmith] Byparr OK ${raw} len=${solved.html.length} cookies=${Boolean(solved.cookieHeader)}`
		);
		return solved.html;
	}

	// ─── List parsers ────────────────────────────────────────────────────

	private parseSeriesCards($: cheerio.CheerioAPI, htmlLen: number): Manga[] {
		const list: Manga[] = [];
		const seen = new Set<string>();

		const push = (href: string, title: string, cover: string, latest?: number) => {
			let path = pathOnly(href);
			// relative "novel/Foo" → "/novel/Foo"
			if (!path.startsWith('/novel/') && /novel\//i.test(href)) {
				const m = href.match(/novel\/([^?#]+)/i);
				if (m) path = `/novel/${decodeURIComponent(m[1]).replace(/\/$/, '')}`;
			}
			if (!isNovelPath(path)) return;

			const key = path.toLowerCase();
			if (seen.has(key)) return;
			seen.add(key);

			const t = decodeEntities(title).slice(0, 200);
			if (!t || t.length < 2) return;

			list.push({
				id: path,
				title: t,
				cover: cover || '',
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				...(latest && latest > 0 ? { latestChapter: latest } : {})
			});
		};

		// A) Latest Updates cards: h6 > a[href*="novel"]
		$('h6 a[href*="novel"], h5 a[href*="novel"], h4 a[href*="novel"]').each((_, el) => {
			const a = $(el);
			const href = a.attr('href') || '';
			const title = a.text().replace(/\s+/g, ' ').trim();
			if (!title) return;

			let cover = '';
			let latest = 0;
			const row = a.closest('.row');
			const scope = row.length ? row : a.parent().parent();
			const img =
				scope.find('img').first().attr('src') ||
				scope.find('img').first().attr('data-src') ||
				'';
			cover = normalizeCover(img);
			const chText =
				scope.find('a[href*="chapter"]').first().text().replace(/\s+/g, ' ').trim() || '';
			latest = parseChapterNumber(chText, 0);
			push(href, title, cover, latest);
		});

		// B) Any anchor with novel/ in href
		$('a[href*="novel"]').each((_, el) => {
			const a = $(el);
			const href = a.attr('href') || '';
			if (!/novel\//i.test(href)) return;
			if (/chapter/i.test(href) && !/\/novel\//i.test(href)) return;

			let title = a.text().replace(/\s+/g, ' ').trim();
			if (!title || title.length < 2) {
				title = a.attr('title') || a.find('img').attr('alt') || '';
			}
			title = title.replace(/\s+/g, ' ').trim();
			if (!title || title.length < 2) return;
			// skip nav labels
			if (/^(home|novels?|updates?|contact|login|register|all novels)$/i.test(title)) return;

			let cover = '';
			const imgEl = a.find('img').first();
			if (imgEl.length) {
				cover = normalizeCover(imgEl.attr('src') || imgEl.attr('data-src'));
			} else {
				const near = a.closest('.row, .col-12, .col-6, .col-lg-6, .card, article');
				cover = normalizeCover(
					near.find('img').first().attr('src') || near.find('img').first().attr('data-src')
				);
			}

			let latest = 0;
			const parent = a.closest('.row, .col-12, .col-lg-6, .col-6');
			const chText =
				parent.find('a[href*="chapter"]').first().text().replace(/\s+/g, ' ').trim() || '';
			latest = parseChapterNumber(chText, 0);

			push(href, title, cover, latest);
		});

		// C) Regex fallback on raw-ish text links if still empty
		if (list.length === 0) {
			const body = $.root().html() || '';
			const re = /href=["']([^"']*novel\/[^"']+)["'][^>]*>([^<]{3,200})</gi;
			let m: RegExpExecArray | null;
			while ((m = re.exec(body))) {
				const href = m[1];
				const title = decodeEntities(m[2]).replace(/\s+/g, ' ').trim();
				if (/chapter/i.test(href) && !/\/novel\//i.test(href)) continue;
				push(href, title, '', 0);
			}
		}

		console.log(
			`[easternwordsmith] parse cards htmlLen=${htmlLen} → ${list.length} titles`
		);
		return list;
	}

	private async collectLatestPool(): Promise<Manga[]> {
		const merged: Manga[] = [];
		const seen = new Set<string>();
		const errors: string[] = [];

		const addAll = (items: Manga[]) => {
			for (const m of items) {
				const key = m.id.toLowerCase();
				if (seen.has(key)) {
					const existing = merged.find((x) => x.id.toLowerCase() === key);
					if (existing) {
						if (!existing.cover && m.cover) existing.cover = m.cover;
						if (!existing.latestChapter && m.latestChapter) {
							existing.latestChapter = m.latestChapter;
						}
					}
					continue;
				}
				seen.add(key);
				merged.push(m);
			}
		};

		const tryPath = async (path: string) => {
			try {
				const html = await this.fetchHtml(path);
				console.log(`[easternwordsmith] fetched ${path} len=${html.length}`);
				const $ = cheerio.load(html);
				addAll(this.parseSeriesCards($, html.length));
			} catch (e: any) {
				const msg = e?.message || String(e);
				errors.push(`${path}: ${msg}`);
				console.warn(`[easternwordsmith] ${path} failed:`, msg);
			}
		};

		await tryPath('/');
		await tryPath('/updates');
		await tryPath('/novels');

		if (merged.length === 0 && errors.length) {
			throw new Error(
				`Eastern Wordsmith: no titles parsed. Errors: ${errors.join(' | ')}`
			);
		}

		return merged;
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		const p = Math.max(1, page || 1);
		const pool = await this.collectLatestPool();
		const start = (p - 1) * PAGE_SIZE;
		const slice = pool.slice(start, start + PAGE_SIZE);
		console.log(
			`[easternwordsmith] latest page=${p} pool=${pool.length} → ${slice.length}`
		);
		return slice;
	}

	async searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page ?? 1);
		if (!q) return this.getLatestManga(page, opts);

		const qLower = q.toLowerCase();
		const pool = await this.collectLatestPool();
		let matched = pool.filter((m) => m.title.toLowerCase().includes(qLower));

		if (matched.length === 0) {
			for (const path of [
				`/?s=${encodeURIComponent(q)}`,
				`/novels?search=${encodeURIComponent(q)}`,
				`/search?q=${encodeURIComponent(q)}`
			]) {
				try {
					const html = await this.fetchHtml(path);
					const $ = cheerio.load(html);
					const found = this.parseSeriesCards($, html.length);
					const filtered = found.filter((m) => m.title.toLowerCase().includes(qLower));
					if (filtered.length) {
						matched = filtered;
						break;
					}
					if (found.length && found.length <= 30) {
						matched = found;
						break;
					}
				} catch {
					/* ignore */
				}
			}
		}

		const start = (page - 1) * PAGE_SIZE;
		return matched.slice(start, start + PAGE_SIZE);
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		if (!path.toLowerCase().startsWith('/novel/')) {
			path = `/novel/${mangaId.replace(/^\/+/, '')}`;
		}
		path = path.replace(/\/$/, '');

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			$('title')
				.first()
				.text()
				.replace(/\s*[|\-–].*$/, '')
				.replace(/\s+/g, ' ')
				.trim() ||
			$('h1, h2, h3').first().text().replace(/\s+/g, ' ').trim() ||
			decodeURIComponent(path.split('/').pop() || 'Unknown');

		let cover = '';
		$('img').each((_, img) => {
			if (cover) return;
			const src = $(img).attr('src') || $(img).attr('data-src') || '';
			if (/novel-image/i.test(src)) cover = normalizeCover(src);
		});
		if (!cover) cover = normalizeCover($('img').first().attr('src'));

		const authors: string[] = [];
		const genres: string[] = [];
		let status = 'Unknown';
		let description = '';
		const altTitles: string[] = [];

		$('.row').each((_, row) => {
			const $row = $(row);
			const label = $row
				.find('.col-4, .col-sm-4, .col-md-4')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.replace(/:/g, '')
				.trim()
				.toLowerCase();
			const value = $row
				.find('.col-8, .col-sm-8, .col-md-8')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			if (!label || !value) return;

			if (/author|artist|writer/.test(label)) {
				value.split(/,|\/|&/).forEach((a) => {
					const t = a.trim();
					if (t && !authors.includes(t)) authors.push(t);
				});
			} else if (/genre|tag/.test(label)) {
				value.split(/,|\//).forEach((g) => {
					const t = g.trim();
					if (t && !genres.includes(t)) genres.push(t);
				});
			} else if (/status/.test(label)) {
				status = value;
			} else if (/alternate|alt|other name/.test(label)) {
				value.split(/,/).forEach((a) => {
					const t = a.trim();
					if (t && t.toLowerCase() !== title.toLowerCase()) altTitles.push(t);
				});
			} else if (/description|synopsis/.test(label)) {
				description = value;
			}
		});

		if (!description) {
			description =
				$('meta[name="description"]').attr('content')?.trim() ||
				$('meta[property="og:description"]').attr('content')?.trim() ||
				'';
		}
		if (description.length > 4000) description = description.slice(0, 4000) + '…';

		const chapters: Chapter[] = [];
		const seenCh = new Set<string>();

		const ingest = (href: string, rawTitle: string, date: string, locked: boolean) => {
			const id = pathOnly(href);
			if (!isChapterPath(id)) return;
			if (seenCh.has(id)) return;
			seenCh.add(id);

			let number = parseChapterNumber(rawTitle, 0);
			if (number <= 0) number = parseChapterNumber(id, 0);
			if (number <= 0) number = chapters.length + 1;

			chapters.push({
				id,
				title: shortChapterTitle(number, rawTitle),
				number,
				date: date || undefined,
				...(locked ? { isLocked: true } : {})
			});
		};

		const scan = (root: cheerio.Cheerio<AnyNode>) => {
			root.find('a[href*="chapter"]').each((_, el) => {
				const a = $(el);
				const href = a.attr('href') || '';
				if (!/chapter\/\d+/i.test(href)) return;
				const rawTitle = a.text().replace(/\s+/g, ' ').trim();
				if (!rawTitle) return;

				let date = '';
				const row = a.closest('.row');
				if (row.length) {
					date = row.find('.col-4, .right').last().text().replace(/\s+/g, ' ').trim() || '';
					if (/chapter/i.test(date)) date = '';
				}

				const locked =
					a.find('.fa-lock, i.fa-lock').length > 0 ||
					row.find('.fa-lock, i.fa-lock').length > 0 ||
					/\b(lock|premium|paywall|vip)\b/i.test(`${a.attr('class')} ${row.attr('class')}`);

				ingest(href, rawTitle, date, locked);
			});
		};

		const scroll = $('.Dscroll');
		if (scroll.length) scan(scroll);
		else scan($.root());

		chapters.sort((a, b) => b.number - a.number);

		console.log(
			`[easternwordsmith] details ${path} → ${chapters.length} ch (${chapters.filter((c) => c.isLocked).length} locked)`
		);

		return {
			id: path,
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
			...(chapters[0]?.number != null ? { latestChapter: chapters[0].number } : {})
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
		let path = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
		if (!path.startsWith('/chapter/')) {
			path = `/chapter/${chapterId.replace(/^\/+/, '')}`;
		}
		path = path.replace(/\/$/, '');

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const pageTitle = $('title').first().text().replace(/\s+/g, ' ').trim() || 'Chapter';
		const number = parseChapterNumber(pageTitle, parseChapterNumber(path, 0));
		const title = shortChapterTitle(number, pageTitle);

		const bodyText = $('body').text().toLowerCase();
		if (
			($('.fa-lock, .premium-block').length > 0 ||
				/premium chapter|members only|subscribe to read|login to (view|read)/i.test(bodyText)) &&
			$('p').length < 3
		) {
			throw new Error('Chapter is locked / paywalled on Eastern Wordsmith');
		}

		$('script, style, nav, header, footer, iframe, noscript, .navbar, #disqus_thread').remove();

		const paragraphs: string[] = [];
		$('p').each((_, p) => {
			const t = $(p).text().replace(/\s+/g, ' ').trim();
			if (!t || t.length < 2) return;
			if (/ad-blocker|ads are our only|please enable|disqus|cloudflare/i.test(t)) return;
			paragraphs.push(t);
		});

		let content = '';
		if (paragraphs.length >= 2) {
			content = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
		} else {
			let best = '';
			$('div, article, section').each((_, el) => {
				const t = stripHtml($.html(el) || '');
				if (t.length > best.length) best = t;
			});
			content = best
				.split(/\n+/)
				.map((l) => l.trim())
				.filter((l) => l.length > 1)
				.map((l) => `<p>${escapeHtml(l)}</p>`)
				.join('\n');
		}

		if (!content || content.replace(/<[^>]+>/g, '').trim().length < 40) {
			throw new Error('Chapter content empty or locked on Eastern Wordsmith');
		}

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		$('a[href*="chapter/"]').each((_, el) => {
			const a = $(el);
			const t = a.text().replace(/\s+/g, ' ').trim().toLowerCase();
			const id = pathOnly(a.attr('href') || '');
			if (!isChapterPath(id) || id === path) return;
			if (t.includes('prev') || t === '«' || t === '‹') prevChapterId = id;
			if (t.includes('next') || t === '»' || t === '›') nextChapterId = id;
		});

		const curNum = parseInt(path.split('/').pop() || '', 10);
		if (!Number.isNaN(curNum) && curNum > 0) {
			if (!prevChapterId) prevChapterId = `/chapter/${curNum - 1}`;
			if (!nextChapterId) nextChapterId = `/chapter/${curNum + 1}`;
		}

		return { title, content, prevChapterId, nextChapterId };
	}
}

export default EasternWordsmithSource;
