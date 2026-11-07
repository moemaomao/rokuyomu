/**
 * NHV Novels (nhvnovels.com) — custom WP theme (novel)
 * Path: scraper/src/sources/impl/novel/NhvNovels.ts
 *
 * URLs:
 *   Novel   : /novels/{slug}/
 *   Chapter : /chapters/{chapter-slug}/
 *   List    : /  (Recently Updated · .rec-upd-card)
 *             /novels/  (all series)
 *             /?s=  (search)
 *
 * API:
 *   GET /wp-json/custom/v1/latest-novels
 *
 * Chapter lock: data-type="premium" on .chapter-item · mycred paywall
 * Nav: .chapter-nav button[onclick*="location.href"]
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const PAGE_SIZE = 24;

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

function pathOnly(href: string): string {
	try {
		const u = new URL(
			href.startsWith('http')
				? href
				: `https://nhvnovels.com${href.startsWith('/') ? '' : '/'}${href}`
		);
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		return href.startsWith('/') ? href.replace(/\/$/, '') : `/${href}`;
	}
}

function decodeEntities(s: string): string {
	return s
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
		.replace(/&#8217;/g, "'")
		.replace(/&#8216;/g, "'")
		.replace(/&#8220;/g, '"')
		.replace(/&#8221;/g, '"')
		.replace(/&#8211;/g, '–')
		.replace(/&#8230;/g, '…')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#039;/g, "'")
		.replace(/&nbsp;/g, ' ')
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

function parseChapterNumber(text: string, fallback: number): number {
	const m =
		text.match(/chapter\s*(\d+(?:\.\d+)?)/i) ||
		text.match(/\bch\.?\s*(\d+(?:\.\d+)?)/i) ||
		text.match(/(\d+(?:\.\d+)?)/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function extractOnclickHref(onclick: string | undefined): string {
	if (!onclick) return '';
	const m = onclick.match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
	return m?.[1] || '';
}

function isValidChapterPath(href: string | undefined): boolean {
	if (!href) return false;
	const h = href.trim();
	if (!h || h === '#' || h.startsWith('javascript')) return false;
	return /\/chapters\//i.test(h);
}

function isNovelPath(path: string): boolean {
	return /^\/novels\/[a-z0-9][a-z0-9\-]*$/i.test(path);
}

function largerCover(url: string): string {
	if (!url) return '';
	return url
		.replace(/-\d+x\d+(\.\w+)$/i, '$1')
		.replace(/-\d+x\d+\./i, '.');
}

function cleanNovelTitle(raw: string): string {
	let t = decodeEntities(raw || '');
	t = t
		.replace(/\s+(OnGoing|Completed|Hiatus|Dropped)\b.*$/i, '')
		.replace(/\s+(CN|KR|JP|EN)\b.*$/i, '')
		.trim();
	return t.slice(0, 200);
}

function isJunkTitle(title: string): boolean {
	const t = (title || '').trim();
	if (!t || t.length < 2) return true;
	return /^(view all|read now|continue|novels|home|sign in|login|library|rankings|gems|dmca|search)$/i.test(
		t
	);
}

export class NhvNovelsSource extends BaseSource {
	id = 'nhvnovels';
	name = 'NHV Novels';
	baseUrl = 'https://nhvnovels.com';

	kind = 'novel' as const;

	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const html = await fetchWithCf(url, {
			headers: {
				...this.headers,
				Referer: `${this.baseUrl}/`
			}
		});
		this.assertNotCf(html, url);
		return html;
	}

	private assertNotCf(html: string, url: string): void {
		const low = (html || '').slice(0, 4000).toLowerCase();
		const looksCf =
			(low.includes('just a moment') ||
				low.includes('cf-browser-verification') ||
				low.includes('challenge-platform') ||
				low.includes('verify you are human') ||
				low.includes('checking your browser')) &&
			html.length < 30000;
		if (looksCf) {
			throw new Error(
				`Cloudflare challenge on ${url} (set BYPARR_URL / fetchWithCf)`
			);
		}
	}

	private async fetchNhvJson<T>(path: string): Promise<T> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		console.log(`[nhvnovels] GET json ${url}`);
		const text = await fetchWithCf(url, {
			headers: {
				...this.headers,
				Accept: 'application/json, text/plain, */*',
				Referer: `${this.baseUrl}/`
			}
		});
		this.assertNotCf(text, url);
		const trimmed = (text || '').trim();
		if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) {
			throw new Error(
				`latest-novels not JSON (len=${trimmed.length}): ${trimmed.slice(0, 120)}`
			);
		}
		return JSON.parse(trimmed) as T;
	}

	// ─── Latest ──────────────────────────────────────────────────────────

	async getLatestManga(
		page = 1,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		return this.getLatestNovels(page);
	}

	async getLatestNovels(page = 1): Promise<Manga[]> {
		const p = Math.max(1, page);
		console.log(`[nhvnovels] getLatestNovels page=${p}`);
		try {
			if (p === 1) {
				const api = await this.fetchLatestFromApi().catch((e) => {
					console.warn('[nhvnovels] API failed:', String(e));
					return [] as Manga[];
				});
				console.log(`[nhvnovels] API → ${api.length}`);

				const home = await this.parseRecentlyUpdatedHome().catch((e) => {
					console.warn('[nhvnovels] home failed:', String(e));
					return [] as Manga[];
				});
				console.log(`[nhvnovels] home → ${home.length}`);

				let list = this.dedupe([...api, ...home]);
				if (list.length < 8) {
					const extra = await this.parseNovelsList(1).catch((e) => {
						console.warn('[nhvnovels] novels list failed:', String(e));
						return [] as Manga[];
					});
					console.log(`[nhvnovels] /novels/ → ${extra.length}`);
					list = this.dedupe([...list, ...extra]);
				}
				console.log(`[nhvnovels] latest page=1 total → ${list.length}`);
				return list.slice(0, PAGE_SIZE);
			}
			const list = await this.parseNovelsList(p);
			console.log(`[nhvnovels] latest page=${p} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[nhvnovels] getLatestNovels FATAL', e);
			return [];
		}
	}

	private dedupe(items: Manga[]): Manga[] {
		const seen = new Set<string>();
		const out: Manga[] = [];
		for (const m of items) {
			if (!m?.id || !m?.title) continue;
			if (!isNovelPath(m.id) && !m.id.startsWith('/novels/')) continue;
			if (seen.has(m.id)) continue;
			seen.add(m.id);
			out.push(m);
		}
		return out;
	}

	private async fetchLatestFromApi(): Promise<Manga[]> {
		const data = await this.fetchNhvJson<
			Array<{ title?: string; cover?: string; link?: string; tags?: string[] }>
		>('/wp-json/custom/v1/latest-novels');
		if (!Array.isArray(data)) {
			console.warn('[nhvnovels] API not array', typeof data);
			return [];
		}
		const list: Manga[] = [];
		for (const n of data) {
			if (!n?.link || !n?.title) continue;
			const id = pathOnly(n.link);
			if (!isNovelPath(id)) continue;
			list.push({
				id,
				title: cleanNovelTitle(n.title),
				cover: largerCover(n.cover || ''),
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: 'Ongoing'
			});
		}
		return list;
	}

	private async parseRecentlyUpdatedHome(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		const push = (
			href: string,
			title: string,
			cover: string,
			latestChapter?: number
		) => {
			const id = pathOnly(href);
			if (!isNovelPath(id) || seen.has(id)) return;
			const t = cleanNovelTitle(title);
			if (isJunkTitle(t)) return;
			seen.add(id);
			list.push({
				id,
				title: t,
				cover: largerCover(absUrl(this.baseUrl, cover)),
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: 'Ongoing',
				...(latestChapter != null && !Number.isNaN(latestChapter) && latestChapter > 0
					? { latestChapter }
					: {})
			});
		};

		$('.rec-upd-card, .rec-upd-main .rec-upd-card').each((_, el) => {
			const $el = $(el);
			let href =
				$el.find('a[href*="/novels/"]').first().attr('href') ||
				$el.find('a[href*="/novels/"]').last().attr('href') ||
				'';
			if (!href) {
				const raw = $el.html() || '';
				const m = raw.match(/href="(https?:\/\/[^"]*\/novels\/[^"]+)"/i);
				if (m) href = m[1];
			}
			if (!href || !/\/novels\//i.test(href)) return;

			const title =
				$el.find('.rec-upd-left-content h1, .rec-upd-left-content h2, h1, h2, h3').first().text() ||
				$el.find('img').attr('alt') ||
				'';
			const img =
				$el.find('img.rec-upd-img, img').attr('data-src') ||
				$el.find('img.rec-upd-img, img').attr('src') ||
				'';
			const infoText = $el.find('.rec-upd-info').text() || $el.text();
			const chMatch = infoText.match(/(\d+)\s*Ch/i);
			const latestChapter = chMatch ? parseInt(chMatch[1], 10) : undefined;
			push(href, title, img, latestChapter);
		});

		if (list.length < 6) {
			$('a[href*="/novels/"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const id = pathOnly(href);
				if (!isNovelPath(id) || seen.has(id)) return;
				const parent = $(a).closest('div, article, li, a');
				const title =
					$(a).find('h1, h2, h3, h4').first().text() ||
					parent.find('h1, h2, h3, h4').first().text() ||
					$(a).attr('title') ||
					$(a).find('img').attr('alt') ||
					$(a).text();
				const img =
					parent.find('img').attr('data-src') ||
					parent.find('img').attr('src') ||
					$(a).find('img').attr('src') ||
					'';
				const infoText = parent.text();
				const chMatch = infoText.match(/(\d+)\s*Ch/i);
				const latestChapter = chMatch ? parseInt(chMatch[1], 10) : undefined;
				push(href, title, img, latestChapter);
			});
		}

		return list;
	}

	private async parseNovelsList(page: number): Promise<Manga[]> {
		const html = await this.fetchHtml('/novels/');
		const $ = cheerio.load(html);
		const all: Manga[] = [];
		const seen = new Set<string>();

		$('a[href*="/novels/"]').each((_, el) => {
			const href = $(el).attr('href') || '';
			const path = pathOnly(href);
			if (!isNovelPath(path)) return;
			if (seen.has(path)) return;

			let title = cleanNovelTitle(
				$(el).attr('title') ||
					$(el).find('h1, h2, h3, h4').first().text() ||
					$(el).text()
			);
			if (isJunkTitle(title)) {
				const parent = $(el).closest('div, article, li');
				title = cleanNovelTitle(
					parent.find('h1, h2, h3, h4, .title').first().text() || title
				);
			}
			if (isJunkTitle(title)) return;

			seen.add(path);
			const parent = $(el).closest('div, article, li, a');
			const cover =
				parent.find('img').attr('data-src') ||
				parent.find('img').attr('src') ||
				$(el).find('img').attr('src') ||
				'';
			const parentText = parent.text().replace(/\s+/g, ' ');
			const chMatch = parentText.match(/(\d+)\s*Ch/i);
			const latestChapter = chMatch ? parseInt(chMatch[1], 10) : undefined;
			let status = 'Ongoing';
			if (/\bCompleted\b/i.test(parentText)) status = 'Completed';
			else if (/\bHiatus\b/i.test(parentText)) status = 'Hiatus';
			else if (/\bDropped\b/i.test(parentText)) status = 'Dropped';

			all.push({
				id: path,
				title,
				cover: largerCover(absUrl(this.baseUrl, cover)),
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status,
				...(latestChapter != null && !Number.isNaN(latestChapter)
					? { latestChapter }
					: {})
			});
		});

		const start = (Math.max(1, page) - 1) * PAGE_SIZE;
		return all.slice(start, start + PAGE_SIZE);
	}

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		return this.searchNovels(query, opts);
	}

	async searchNovels(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = (query || '').trim();
		if (!q) return this.getLatestNovels(page);

		console.log(`[nhvnovels] search "${q}" page=${page}`);
		try {
			const html = await this.fetchHtml(`/?s=${encodeURIComponent(q)}`);
			const $ = cheerio.load(html);
			const list: Manga[] = [];
			const seen = new Set<string>();

			$('a[href*="/novels/"]').each((_, el) => {
				const href = $(el).attr('href') || '';
				const id = pathOnly(href);
				if (!isNovelPath(id) || seen.has(id)) return;
				const title = cleanNovelTitle(
					$(el).attr('title') ||
						$(el).find('h1, h2, h3').first().text() ||
						$(el).text()
				);
				if (isJunkTitle(title)) return;
				seen.add(id);
				const parent = $(el).closest('div, article, li');
				const cover =
					parent.find('img').attr('data-src') ||
					parent.find('img').attr('src') ||
					$(el).find('img').attr('src') ||
					'';
				list.push({
					id,
					title,
					cover: largerCover(absUrl(this.baseUrl, cover)),
					sourceId: this.id,
					type: 'novel',
					lang: 'en'
				});
			});

			console.log(`[nhvnovels] search → ${list.length}`);
			const start = (Math.max(1, page) - 1) * PAGE_SIZE;
			return list.slice(start, start + PAGE_SIZE);
		} catch (e) {
			console.error('[nhvnovels] search', e);
			return [];
		}
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		return this.getNovelDetails(mangaId);
	}

	async getNovelDetails(novelId: string): Promise<MangaDetails> {
		let path = pathOnly(novelId);
		if (path.includes('/chapters/')) {
			path = path.replace(/\/chapters\/.*$/i, '');
		}
		if (!path.includes('/novels/')) {
			path = `/novels${path.startsWith('/') ? path : `/${path}`}`;
		}
		path = pathOnly(path);
		const novelPath = path.endsWith('/') ? path : `${path}/`;

		console.log(`[nhvnovels] details ${novelPath}`);
		const html = await this.fetchHtml(novelPath);
		const $ = cheerio.load(html);

		const title = cleanNovelTitle(
			$('.novel-title, h1.novel-title, .novel-header h1, h1').first().text() ||
				$('meta[property="og:title"]').attr('content') ||
				$('title').text().split(/[|\-–]/)[0]
		);
		if (!title || title.length < 2) throw new Error('Novel not found (empty title)');

		let cover =
			$('.novel-image img, .novel-header img').attr('data-src') ||
			$('.novel-image img, .novel-header img').attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = largerCover(cover);

		let description = '';
		const desc = $('.novel-description, .novel-description-wrapper').first();
		if (desc.length) {
			description = desc
				.find('p')
				.map((_, p) => $(p).text().trim())
				.get()
				.filter(Boolean)
				.join('\n\n');
			if (!description) description = desc.text().replace(/\s+/g, ' ').trim();
		}
		if (!description) {
			description =
				$('meta[property="og:description"]').attr('content')?.trim() || '';
		}
		description = decodeEntities(description);

		const authors: string[] = [];
		$('.badge-author, a.badge-author, .badges a[href*="/author/"]').each((_, a) => {
			const t = decodeEntities($(a).text());
			if (t && !authors.includes(t)) authors.push(t);
		});

		const genres: string[] = [];
		$('.badge.genre, .badges a[href*="genre"], .badges .badge').each((_, el) => {
			const t = decodeEntities($(el).text());
			if (!t || t.length > 40) return;
			if (/ongoing|completed|views|★|release|translator|author|hiatus|dropped/i.test(t))
				return;
			if (!genres.includes(t)) genres.push(t);
		});

		let status = 'Ongoing';
		$('.badges .badge, .novel-details .badge').each((_, el) => {
			const t = $(el).text().trim();
			if (/ongoing|completed|hiatus|dropped/i.test(t)) {
				status = /complete/i.test(t)
					? 'Completed'
					: /hiatus/i.test(t)
						? 'Hiatus'
						: /drop/i.test(t)
							? 'Dropped'
							: 'Ongoing';
			}
		});

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		$('.chapter-item, .chapters-container .chapter-item, a.chapter-title-link').each(
			(i, el) => {
				const $el = $(el);
				const isItem = $el.hasClass('chapter-item') || $el.is('div, li');
				const a = isItem
					? $el.find('a.chapter-title-link, a[href*="/chapters/"]').first()
					: $el;
				let href =
					$el.attr('data-url') ||
					a.attr('href') ||
					$el.find('a').first().attr('href') ||
					'';
				if (!href || !/\/chapters\//.test(href)) return;
				const id = pathOnly(href);
				if (seen.has(id)) return;
				seen.add(id);

				const rawTitle = decodeEntities(
					$el.find('.chapter-title, .chapter-number').first().text() ||
						a.text() ||
						$el.text()
				);
				const num =
					parseInt($el.attr('data-chapter-number') || '', 10) ||
					parseChapterNumber(rawTitle, i + 1);

				const dataType = ($el.attr('data-type') || '').toLowerCase();
				const locked =
					dataType === 'premium' ||
					dataType === 'paid' ||
					$el.find('.premium, .lock, .fa-lock, [class*="lock"]').length > 0;

				const ch: Chapter = {
					id,
					title: `Chapter ${num}`,
					number: num
				};
				if (locked) ch.isLocked = true;
				chapters.push(ch);
			}
		);

		if (chapters.length < 1) {
			$('a[href*="/chapters/"]').each((i, a) => {
				const href = $(a).attr('href') || '';
				const id = pathOnly(href);
				if (!/\/chapters\//i.test(id) || seen.has(id)) return;
				seen.add(id);
				const raw = decodeEntities($(a).text());
				const num = parseChapterNumber(raw + ' ' + id, i + 1);
				chapters.push({ id, title: `Chapter ${num}`, number: num });
			});
		}

		chapters.sort((a, b) => b.number - a.number);

		console.log(
			`[nhvnovels] details ${path} → ${chapters.length} ch locked=${chapters.filter((c) => c.isLocked).length}`
		);

		return {
			id: pathOnly(novelPath),
			title,
			cover: absUrl(this.baseUrl, cover),
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters,
			type: 'novel',
			lang: 'en',
			...(chapters[0]?.number ? { latestChapter: chapters[0].number } : {})
		};
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
		let path = pathOnly(chapterId);
		if (!path.includes('/chapters/')) {
			path = `/chapters${path.startsWith('/') ? path : `/${path}`}`;
		}
		const fetchPath = path.endsWith('/') ? path : `${path}/`;
		console.log(`[nhvnovels] chapter ${fetchPath}`);

		const html = await this.fetchHtml(fetchPath);
		const $ = cheerio.load(html);

		const title = decodeEntities(
			$('.chapter-title, h1').first().text() ||
				$('title').text().split(/[|\-–]/)[0].trim() ||
				'Chapter'
		);

		const container = $('.chapter-text, .chapter-container .chapter-text').first();
		let contentHtml = '';

		if (container.length) {
			if (
				container.find('.mycred-sell-this-wrapper, .mycred-sell-entire-content').length ||
				/Premium Content/i.test(container.text())
			) {
				throw new Error('Chapter is locked / premium on NHV Novels');
			}
			const clone = container.clone();
			clone
				.find(
					'script, style, iframe, .ads, .ad, .mycred-sell-this-wrapper, noscript'
				)
				.remove();
			const paras = clone.find('p');
			if (paras.length) {
				const parts: string[] = [];
				paras.each((_, p) => {
					const t = $(p).text().trim();
					if (!t) return;
					if (/nhvnovels|premium content|login to access/i.test(t)) return;
					parts.push(`<p>${escapeHtml(t)}</p>`);
				});
				contentHtml = parts.join('\n');
			}
			if (!contentHtml) contentHtml = clone.html()?.trim() || '';
		}

		if (!contentHtml || contentHtml.replace(/<[^>]+>/g, '').trim().length < 40) {
			throw new Error('Chapter content empty or locked on NHV Novels');
		}

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		$('.chapter-nav button[onclick], .chapter-nav a').each((_, el) => {
			const label = (($(el).attr('aria-label') || $(el).text()) + '').toLowerCase();
			const href =
				extractOnclickHref($(el).attr('onclick')) || $(el).attr('href') || '';
			if (!isValidChapterPath(href)) return;
			const id = pathOnly(href);
			if (/prev/i.test(label) && !prevChapterId) prevChapterId = id;
			if (/next/i.test(label) && !nextChapterId) nextChapterId = id;
		});

		console.log(
			`[nhvnovels] chapter ok ${contentHtml.length}c prev=${prevChapterId} next=${nextChapterId}`
		);

		return {
			title,
			content: contentHtml,
			prevChapterId,
			nextChapterId
		};
	}
}

export default NhvNovelsSource;
