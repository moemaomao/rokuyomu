/**
 * Tangerine Archive (tangerinearchive.com) — Madara / wp-manga
 * Path: scraper/src/sources/impl/novel/TangerineArchive.ts
 *
 * - List: homepage + /series/?m_orderby=latest|modified
 * - Homepage: merge latest to 24 titles
 * - Detail: /series/{slug}/
 * - Chapters AJAX POST: /series/{slug}/ajax/chapters/
 * - Chapter: /series/{slug}/chapter-{n}/
 * - Content: .reading-content / .text-left
 * - Prev/Next: a.btn.prev_page / a.btn.next_page + slug adjacent
 * - Premium: li.wp-manga-chapter.premium / .fa-lock → isLocked
 * - Search: /?s=&post_type=wp-manga
 * - Chapter title: "Chapter N" (bersih)
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://tangerinearchive.com';
const PER_PAGE = 24;

function absUrl(href: string | undefined): string {
	if (!href) return '';
	if (href.startsWith('//')) return `https:${href}`;
	if (href.startsWith('http')) return href;
	try {
		return new URL(href, BASE).href;
	} catch {
		return href;
	}
}

function pathOnly(href: string): string {
	try {
		const u = new URL(
			href.startsWith('http')
				? href
				: `${BASE}${href.startsWith('/') ? '' : '/'}${href}`
		);
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		return href.startsWith('/') ? href.replace(/\/$/, '') || '/' : `/${href}`;
	}
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function cleanText(s: string): string {
	return (s || '')
		.replace(/&#8217;/g, "'")
		.replace(/&#8216;/g, "'")
		.replace(/&#8220;/g, '"')
		.replace(/&#8221;/g, '"')
		.replace(/&#8230;/g, '…')
		.replace(/&amp;/g, '&')
		.replace(/&nbsp;/g, ' ')
		.replace(/<[^>]+>/g, '')
		.replace(/\u00a0/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function parseChapterNumber(text: string, fallback = 0): number {
	const t = (text || '').replace(/\s+/g, ' ').trim();
	if (/prologue/i.test(t) && !/\d/.test(t)) return 0;
	const m =
		t.match(/(?:chapter|ch\.?|c)\s*[.\-_]?\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\/chapter-(\d+(?:\.\d+)?)(?:\/|$)/i) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function shortChapterTitle(number: number, raw?: string): string {
	if (number > 0) return `Chapter ${number}`;
	if (/prologue/i.test(raw || '')) return 'Prologue';
	const n = parseChapterNumber(raw || '', 0);
	return n > 0 ? `Chapter ${n}` : 'Chapter';
}

function seriesIdFromHref(href: string): string | null {
	const p = pathOnly(href);
	const m = p.match(/^\/series\/([a-z0-9-]+)(?:\/|$)/i);
	if (!m) return null;
	if (/^(feed|genre)/i.test(m[1])) return null;
	return `/series/${m[1]}`;
}

function adjacentChapterPaths(path: string): {
	prev: string | null;
	next: string | null;
} {
	const p = path.replace(/\/$/, '');
	const m = p.match(/^(.*\/chapter-)(\d+(?:\.\d+)?)$/i);
	if (m) {
		const n = parseFloat(m[2]);
		const prevN =
			n > 1 ? (Number.isInteger(n) ? n - 1 : Math.floor(n)) : null;
		const nextN = Number.isInteger(n) ? n + 1 : Math.ceil(n);
		return {
			prev: prevN != null && prevN > 0 ? `${m[1]}${prevN}` : null,
			next: `${m[1]}${nextN}`
		};
	}
	return { prev: null, next: null };
}

export class TangerineArchiveSource extends BaseSource {
	id = 'tangerinearchive';
	name = 'Tangerine Archive';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept:
			'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		try {
			return await fetchWithCf(url, {
				headers: { ...this.headers, Referer: this.baseUrl }
			});
		} catch (e) {
			console.warn(
				'[tangerinearchive] fetchWithCf failed, plain fetch',
				String(e).slice(0, 100)
			);
			const res = await fetch(url, { headers: this.headers });
			if (!res.ok) {
				const t = await res.text().catch(() => '');
				throw new Error(`fetchHtml ${res.status}: ${t.slice(0, 100)}`);
			}
			return await res.text();
		}
	}

	private async postAjax(url: string): Promise<string> {
		const full = url.startsWith('http') ? url : `${this.baseUrl}${url}`;
		const res = await fetch(full, {
			method: 'POST',
			headers: {
				...this.headers,
				Referer: this.baseUrl,
				'X-Requested-With': 'XMLHttpRequest',
				'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
				Accept: '*/*'
			},
			body: ''
		});
		if (!res.ok) throw new Error(`POST ${full} → ${res.status}`);
		return res.text();
	}

	// ─── Latest ──────────────────────────────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		const p = Math.max(1, page);
		try {
			if (p === 1) {
				const seen = new Set<string>();
				const list: Manga[] = [];

				try {
					const home = await this.fetchHtml('/');
					for (const m of this.parseSeriesCards(home)) {
						if (seen.has(m.id)) continue;
						seen.add(m.id);
						list.push(m);
						if (list.length >= PER_PAGE) break;
					}
				} catch (e) {
					console.warn(
						'[tangerinearchive] homepage fail',
						String(e).slice(0, 80)
					);
				}

				if (list.length < PER_PAGE) {
					try {
						const html = await this.fetchHtml(
							'/series/?m_orderby=latest'
						);
						for (const m of this.parseSeriesCards(html)) {
							if (seen.has(m.id)) continue;
							seen.add(m.id);
							list.push(m);
							if (list.length >= PER_PAGE) break;
						}
					} catch (e) {
						console.warn(
							'[tangerinearchive] series fill fail',
							String(e).slice(0, 80)
						);
					}
				}

				if (list.length < PER_PAGE) {
					try {
						const html = await this.fetchHtml(
							'/series/page/2/?m_orderby=latest'
						);
						for (const m of this.parseSeriesCards(html)) {
							if (seen.has(m.id)) continue;
							seen.add(m.id);
							list.push(m);
							if (list.length >= PER_PAGE) break;
						}
					} catch {
					}
				}

				console.log(`[tangerinearchive] latest page=1 n=${list.length}`);
				return list.slice(0, PER_PAGE);
			}

			const html = await this.fetchHtml(
				`/series/page/${p}/?m_orderby=latest`
			);
			const list = this.parseSeriesCards(html);
			console.log(
				`[tangerinearchive] latest page=${p} n=${list.length}`
			);
			return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[tangerinearchive] latest', e);
			return [];
		}
	}

	private parseSeriesCards(html: string): Manga[] {
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		const push = (
			id: string,
			title: string,
			cover: string,
			latest?: number,
			status?: string
		) => {
			if (seen.has(id) || !title || title.length < 2) return;
			if (!/^\/series\/[a-z0-9-]+$/i.test(id)) return;
			seen.add(id);
			list.push({
				id,
				title: title.slice(0, 200),
				cover: cover ? absUrl(cover.split('?')[0]) : '',
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: status || 'Ongoing',
				...(latest != null && latest > 0
					? { latestChapter: Math.floor(latest) }
					: {})
			});
		};

		$('.page-item-detail, .page-listing-item').each((_, el) => {
			const root = $(el);
			const a = root.find('a[href*="/series/"]').first();
			const href = a.attr('href') || '';
			const id = seriesIdFromHref(href);
			if (!id) return;

			const title =
				cleanText(
					root
						.find('.post-title a, .manga-title, h3 a, h5 a, h3, h5')
						.first()
						.text()
				) ||
				cleanText(a.attr('title') || '') ||
				cleanText(a.find('img').attr('alt') || '') ||
				cleanText(a.text());

			const img = root.find('img').first();
			const cover =
				img.attr('data-src') || img.attr('data-lazy-src') || img.attr('src') || '';

			let latest = 0;
			root.find('a[href*="/chapter-"], .chapter-item a, .list-chapter a').each(
				(_, ca) => {
					const n = parseChapterNumber(
						$(ca).text() + ' ' + ($(ca).attr('href') || ''),
						0
					);
					if (n > latest) latest = n;
				}
			);
			const chMeta = cleanText(root.find('.chapter, .font-meta').first().text());
			const n2 = parseChapterNumber(chMeta, 0);
			if (n2 > latest) latest = n2;

			let status = 'Ongoing';
			const st = root.text();
			if (/completed/i.test(st)) status = 'Completed';
			else if (/hiatus/i.test(st)) status = 'Hiatus';

			push(id, title, cover, latest || undefined, status);
		});

		$('.c-tabs-item, .manga__item, .slider__item, .popular-item, .item-thumb').each(
			(_, el) => {
				const root = $(el);
				const a = root.find('a[href*="/series/"]').first();
				const href = a.attr('href') || '';
				const id = seriesIdFromHref(href);
				if (!id) return;
				const title =
					cleanText(
						root.find('.post-title a, h3, h4, h5, .manga-title').first().text()
					) ||
					cleanText(a.attr('title') || '') ||
					cleanText(a.find('img').attr('alt') || '');
				const img = root.find('img').first();
				const cover =
					img.attr('data-src') || img.attr('src') || '';
				let latest = 0;
				root.find('a[href*="/chapter-"]').each((_, ca) => {
					const n = parseChapterNumber(
						$(ca).text() + ' ' + ($(ca).attr('href') || ''),
						0
					);
					if (n > latest) latest = n;
				});
				push(id, title, cover, latest || undefined);
			}
		);

		if (list.length < 8) {
			$('a[href*="/series/"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const id = seriesIdFromHref(href);
				if (!id) return;
				if (!/^\/series\/[a-z0-9-]+$/i.test(id)) return;
				const title =
					cleanText($(a).attr('title') || '') ||
					cleanText($(a).find('img').attr('alt') || '') ||
					cleanText($(a).text());
				if (!title || /^(r15|r19|new|bl|completed)$/i.test(title)) return;
				const cover =
					$(a).find('img').attr('data-src') ||
					$(a).find('img').attr('src') ||
					'';
				push(id, title, cover);
			});
		}

		return list;
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
			const list = this.parseSeriesCards(html);
			console.log(
				`[tangerinearchive] search "${q}" page=${page} n=${list.length}`
			);
			return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[tangerinearchive] search', e);
			return [];
		}
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = pathOnly(mangaId);
		const chStrip = path.match(/^(\/series\/[a-z0-9-]+)\/chapter-/i);
		if (chStrip) path = chStrip[1];
		if (!path.startsWith('/series/')) {
			path = `/series/${path.replace(/^\//, '')}`;
		}
		const seriesPath = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(seriesPath);
		const $ = cheerio.load(html);

		let title =
			cleanText($('.post-title h1, .manga-title, h1').first().text()) ||
			cleanText(
				$('meta[property="og:title"]')
					.attr('content')
					?.split(/\s*[|\-–]\s*/)[0] || ''
			) ||
			path.split('/').pop()?.replace(/-/g, ' ') ||
			'';
	
		title = title.replace(/^(R\d+\s*)+/i, '').trim();

		let cover =
			$('.summary_image img, .manga-thumb img, .wp-post-image')
				.first()
				.attr('data-src') ||
			$('.summary_image img, .manga-thumb img, .wp-post-image')
				.first()
				.attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = absUrl((cover || '').split('?')[0]);

		const authors: string[] = [];
		$('.author-content a, .artist-content a').each((_, a) => {
			const n = cleanText($(a).text());
			if (n && !authors.includes(n)) authors.push(n);
		});

		const genres: string[] = [];
		$('.genres-content a, .wp-manga-genre a').each((_, a) => {
			const g = cleanText($(a).text());
			if (
				g &&
				g.length < 40 &&
				!genres.includes(g) &&
				!/^(red|completed|locked|unlocked)$/i.test(g)
			) {
				genres.push(g);
			}
		});

		let status = 'Ongoing';
		const st = cleanText(
			$('.post-status .summary-content, .post-status, .post-content_item').text()
		);
		if (/completed|complete/i.test(st)) status = 'Completed';
		else if (/hiatus/i.test(st)) status = 'Hiatus';
		else if (/canceled|cancelled/i.test(st)) status = 'Cancelled';

		let description =
			cleanText(
				$(
					'.description-summary .summary__content, .summary__content, .manga-excerpt, .description-summary'
				)
					.first()
					.text()
			) ||
			cleanText($('meta[property="og:description"]').attr('content') || '');
		if (description.length > 4000)
			description = description.slice(0, 4000) + '…';

		let altTitle = '';
		$('.post-content_item, .summary-heading').each((_, el) => {
			const t = cleanText($(el).text());
			if (/alt(ernate)?\s*name|other\s*name/i.test(t)) {
				altTitle = t
					.replace(/^.*?(alt(ernate)?\s*name|other\s*name)\s*:?\s*/i, '')
					.trim();
			}
		});

		const chapters = await this.fetchAllChapters(seriesPath);

		console.log(
			`[tangerinearchive] details ${path} → ${chapters.length} ch (${chapters.filter((c) => c.isLocked).length} locked)`
		);

		const details: MangaDetails = {
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

		const extra = details as MangaDetails & { altTitles?: string[] };
		if (altTitle) extra.altTitles = [altTitle];

		return details;
	}

	private async fetchAllChapters(seriesPath: string): Promise<Chapter[]> {
		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		const base = seriesPath.endsWith('/') ? seriesPath : `${seriesPath}/`;
		const seriesId = base.replace(/\/$/, '');

		const parseList = (ajaxHtml: string) => {
			const $ = cheerio.load(ajaxHtml);

			$('ul.main.version-chap li.wp-manga-chapter, li.wp-manga-chapter').each(
				(_, li) => {
					const $li = $(li);
					const a = $li.children('a').first().length
						? $li.children('a').first()
						: $li.find('a').first();

					const rawTitle = cleanText(a.text());
					const href = (a.attr('href') || '').trim();
					const liClass = ($li.attr('class') || '').toLowerCase();

					const isFree = /\bfree-chap\b/.test(liClass);
					const isPremium =
						/\bpremium\b|\bpremium-block\b/.test(liClass) ||
						($li.find('.coin').not('.free').length > 0 && !isFree) ||
						a.find('.fa-lock, .fas.fa-lock').length > 0;
					const isLocked = isPremium && !isFree;

					let number = parseChapterNumber(rawTitle, 0);
					if (number <= 0) number = parseChapterNumber(href, 0);
					if (number <= 0 && !/prologue/i.test(rawTitle)) return;
					if (/prologue/i.test(rawTitle) && number <= 0) number = 0;

					let id = '';
					if (href && href !== '#' && /\/chapter-/i.test(href)) {
						id = pathOnly(href);
					} else if (/prologue/i.test(rawTitle) && number <= 0) {
						id = `${seriesId}/prologue`;
					} else {
						const numStr = Number.isInteger(number)
							? String(number)
							: String(number);
						id = `${seriesId}/chapter-${numStr}`;
					}

					if (seen.has(id)) return;
					seen.add(id);

					const date =
						cleanText($li.find('.chapter-release-date').text()) || '';

					chapters.push({
						id,
						title: shortChapterTitle(number, rawTitle),
						number,
						date: date && !/^tba$/i.test(date) ? date : undefined,
						...(isLocked ? { isLocked: true } : {})
					});
				}
			);
		};

		try {
			const ajaxHtml = await this.postAjax(`${base}ajax/chapters/`);
			parseList(ajaxHtml);
		} catch (e) {
			console.warn(
				'[tangerinearchive] ajax chapters fail',
				String(e).slice(0, 100)
			);
		}

		if (chapters.length < 3) {
			try {
				const html = await this.fetchHtml(base);
				parseList(html);
			} catch (e) {
				console.error('[tangerinearchive] html chapters', e);
			}
		}

		chapters.sort((a, b) => {
			if (b.number !== a.number) return b.number - a.number;
			return (b.date || '').localeCompare(a.date || '');
		});

		return chapters;
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
		let path = pathOnly(chapterId);
		if (!path.startsWith('/series/')) {
			path = `/series/${path.replace(/^\//, '')}`;
		}
		const fetchPath = path.endsWith('/') ? path : `${path}/`;

		const adj = adjacentChapterPaths(path.replace(/\/$/, ''));
		let prevChapterId: string | null = adj.prev;
		let nextChapterId: string | null = adj.next;

		const html = await this.fetchHtml(fetchPath);
		const $ = cheerio.load(html);

		const bodyText = $('body').text().toLowerCase();
		const contentProbe = $('.reading-content p, .text-left p').length;
		if (
			contentProbe < 2 &&
			(/you need to (buy|unlock)|premium chapter|login to view|subscribe to read|not enough coin|purchase this chapter/i.test(
				bodyText
			) ||
				$('.premium-block, .c-blocked-content, .manga-locked').length > 0)
		) {
			throw new Error('Chapter is locked / premium on Tangerine Archive');
		}

		const rawTitle =
			cleanText(
				$('h1, .post-title h1, .chapter-heading').first().text()
			) ||
			cleanText(
				$('meta[property="og:title"]')
					.attr('content')
					?.split(/\s*[|\-–]\s*/)[0] || ''
			);
		const number = parseChapterNumber(path + ' ' + rawTitle, 0);
		const title = shortChapterTitle(number > 0 ? number : 0, rawTitle);

		const contentEl = $(
			'.reading-content .text-left, .reading-content, .text-left, .entry-content'
		).first();
		contentEl
			.find('script, style, noscript, iframe, .ads, .ad, .code-block, .sharedaddy')
			.remove();

		const parts: string[] = [];
		contentEl.find('p').each((_, p) => {
			const t = cleanText($(p).text());
			if (!t || t.length < 2) return;
			if (
				/^(support|patreon|ko-fi|discord|prev|next|advertisement)/i.test(t)
			)
				return;
			parts.push(`<p>${escapeHtml(t)}</p>`);
		});

		let content =
			parts.length > 0
				? parts.join('\n')
				: '<p><em>Empty content — locked or selector changed.</em></p>';

		$('a.btn.prev_page, a.prev_page, .nav-previous a, a[rel="prev"]').each(
			(_, a) => {
				const full = pathOnly($(a).attr('href') || '');
				if (/\/chapter-/i.test(full) || /\/prologue/i.test(full)) {
					prevChapterId = full;
				}
			}
		);
		$('a.btn.next_page, a.next_page, .nav-next a, a[rel="next"]').each(
			(_, a) => {
				const full = pathOnly($(a).attr('href') || '');
				if (/\/chapter-/i.test(full)) {
					nextChapterId = full;
				}
			}
		);

		console.log(
			`[tangerinearchive] chapter ${path} → ${parts.length}p prev=${prevChapterId} next=${nextChapterId}`
		);

		return { title, content, prevChapterId, nextChapterId };
	}
}

export default TangerineArchiveSource;
