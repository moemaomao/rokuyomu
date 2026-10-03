/**
 * Bcatranslation / Bcat00 Novel (bcatranslation.com) — Madara / wp-manga
 * Path: scraper/src/sources/impl/novel/Bcatranslation.ts
 *
 * - List: homepage + /novel/ (series cards)
 * - Homepage: 24 titles (page 1 merges latest from home)
 * - Detail: /novel/{slug}/
 * - Chapters AJAX POST: /novel/{slug}/ajax/chapters/?t={page}
 * - Chapter: /novel/{slug}/chapter-{n}/
 * - Content: .reading-content .text-left
 * - Prev/Next: a.btn.prev_page / a.btn.next_page
 * - Premium: li.wp-manga-chapter.premium → isLocked
 * - Search: /?s=&post_type=wp-manga
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

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

function pathOnly(href: string, baseHost = 'https://bcatranslation.com'): string {
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
	const n = parseChapterNumber(raw || '', 0);
	return n > 0 ? `Chapter ${n}` : 'Chapter';
}

export class BcatranslationSource extends BaseSource {
	id = 'bcatranslation';
	name = 'Bcatranslation';
	baseUrl = 'https://bcatranslation.com';

	kind = 'novel' as const;

	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		return fetchWithCf(url, {
			headers: {
				...this.headers,
				Referer: this.baseUrl
			}
		});
	}

	private async postAjax(url: string): Promise<string> {
		const res = await fetch(url, {
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
		if (!res.ok) {
			throw new Error(`POST ${url} → ${res.status}`);
		}
		return res.text();
	}

	// ─── Latest ──────────────────────────────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		return this.getLatestNovels(page);
	}

	async getLatestNovels(page = 1): Promise<Manga[]> {
		const p = Math.max(1, page);
		try {
			if (p <= 1) {
				const html = await this.fetchHtml('/');
				const list = this.parseSeriesCards(html).slice(0, 24);
				if (list.length >= 12) {
					console.log(`[bcatranslation] latest page=1 → ${list.length}`);
					return list;
				}
				const all = await this.fetchHtml('/novel/');
				const more = this.parseSeriesCards(all).slice(0, 24);
				console.log(`[bcatranslation] latest page=1 (novel/) → ${more.length}`);
				return more;
			}

			const html = await this.fetchHtml('/novel/');
			const all = this.parseSeriesCards(html);
			const per = 24;
			const slice = all.slice((p - 1) * per, p * per);
			console.log(`[bcatranslation] latest page=${p} → ${slice.length}`);
			return slice;
		} catch (e) {
			console.error('[bcatranslation] latest', e);
			return [];
		}
	}

	private parseSeriesCards(html: string): Manga[] {
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		const cleanCover = (src: string) =>
			absUrl(this.baseUrl, (src || '').replace(/&amp;/g, '&').split('?')[0]);

		const push = (id: string, title: string, cover: string, latest?: number) => {
			if (seen.has(id)) return;
			if (!title || title.length < 2) return;
			if (!/^\/novel\/[a-z0-9\-]+$/i.test(id)) return;
			seen.add(id);
			list.push({
				id,
				title: title.slice(0, 200),
				cover: cover ? cleanCover(cover) : '',
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: 'Ongoing',
				...(latest != null && latest > 0 ? { latestChapter: latest } : {})
			});
		};

		$('article.rr-series-card, .rr-series-card, .rr-card').each((_, el) => {
			const root = $(el);
			const a = root.find('a[href*="/novel/"]').first();
			const href = a.attr('href') || '';
			const m = href.match(/\/novel\/([a-z0-9\-]+)\/?/i);
			if (!m) return;
			const id = `/novel/${m[1]}`;
			const title =
				root.find('.rr-title, .post-title, h3, h2').first().text().replace(/\s+/g, ' ').trim() ||
				a.find('img').attr('alt') ||
				a.text().replace(/\s+/g, ' ').trim();
			const cover =
				root.find('img').first().attr('data-src') ||
				root.find('img').first().attr('src') ||
				'';
		
			let latest = 0;
			root.find('a[href*="/chapter-"], .rr-chapter a, .chapter a').each((_, ca) => {
				const t = $(ca).text() + ' ' + ($(ca).attr('href') || '');
				const n = parseChapterNumber(t, 0);
				if (n > latest) latest = n;
			});
			push(id, title, cover, latest || undefined);
		});

		$('.manga__item, .manga-item, div[data-post-id]').each((_, el) => {
			const root = $(el);
			const a =
				root.find('.manga__thumb a[href*="/novel/"], .manga__thumb_item a, a[href*="/novel/"]').first();
			const href = a.attr('href') || '';
			const m = href.match(/\/novel\/([a-z0-9\-]+)\/?/i);
			if (!m) return;
			const id = `/novel/${m[1]}`;

			const title =
				root
					.find(
						'.manga__content .post-title a, .manga__content h2 a, .manga__content h3 a, .post-title a, h2 a, h3 a'
					)
					.first()
					.text()
					.replace(/\s+/g, ' ')
					.trim() ||
				a.find('img').attr('alt') ||
				a.attr('title') ||
				m[1].replace(/-/g, ' ');

			const cover =
				root.find('.manga__thumb img, .manga__thumb_item img, img.wp-post-image, img').first().attr(
					'data-src'
				) ||
				root.find('.manga__thumb img, .manga__thumb_item img, img.wp-post-image, img').first().attr(
					'src'
				) ||
				'';

			let latest = 0;
			root.find('a[href*="/chapter-"], .chapter-item a, .list-chapter a, .font-meta a').each(
				(_, ca) => {
					const t = $(ca).text() + ' ' + ($(ca).attr('href') || '');
					const n = parseChapterNumber(t, 0);
					if (n > latest) latest = n;
				}
			);
			push(id, title, cover, latest || undefined);
		});

		$('.page-item-detail, .page-listing-item').each((_, el) => {
			const root = $(el);
			const a = root.find('a[href*="/novel/"]').first();
			const href = a.attr('href') || '';
			const m = href.match(/\/novel\/([a-z0-9\-]+)\/?/i);
			if (!m) return;
			const id = `/novel/${m[1]}`;
			const title =
				root.find('.post-title a, .manga-title, h3 a, h5 a').first().text().replace(/\s+/g, ' ').trim() ||
				a.attr('title') ||
				a.text().replace(/\s+/g, ' ').trim();
			const cover =
				root.find('img').first().attr('data-src') ||
				root.find('img').first().attr('src') ||
				'';
			let latest = 0;
			root.find('a[href*="/chapter-"]').each((_, ca) => {
				const n = parseChapterNumber($(ca).text() + ' ' + ($(ca).attr('href') || ''), 0);
				if (n > latest) latest = n;
			});
			push(id, title, cover, latest || undefined);
		});

		if (list.length < 10) {
			$('a[href*="/novel/"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const m = href.match(/\/novel\/([a-z0-9\-]+)\/?$/i);
				if (!m) return;
				const id = `/novel/${m[1]}`;
				const title = (
					$(a).attr('title') ||
					$(a).find('img').attr('alt') ||
					$(a).text()
				)
					.replace(/\s+/g, ' ')
					.trim();
				const cover =
					$(a).find('img').attr('data-src') ||
					$(a).find('img').attr('src') ||
					$(a).parent().find('img').first().attr('src') ||
					'';
				push(id, title, cover);
			});
		}

		return list;
	}

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		return this.searchNovels(query, opts);
	}

	async searchNovels(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim();
		if (!q) return this.getLatestNovels(opts?.page ?? 1);

		const page = Math.max(1, opts?.page ?? 1);
		const path =
			page <= 1
				? `/?s=${encodeURIComponent(q)}&post_type=wp-manga`
				: `/page/${page}/?s=${encodeURIComponent(q)}&post_type=wp-manga`;

		try {
			const html = await this.fetchHtml(path);
			const list = this.parseSeriesCards(html);
			console.log(`[bcatranslation] search "${q}" page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[bcatranslation] search', e);
			return [];
		}
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		return this.getNovelDetails(mangaId);
	}

	async getNovelDetails(novelId: string): Promise<MangaDetails> {
		let path = pathOnly(novelId, this.baseUrl);
		const chStrip = path.match(/^(\/novel\/[a-z0-9\-]+)\/chapter-/i);
		if (chStrip) path = chStrip[1];
		if (!path.startsWith('/novel/')) {
			path = `/novel/${path.replace(/^\//, '')}`;
		}
		const seriesPath = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(seriesPath);
		const $ = cheerio.load(html);

		const title =
			$('h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('.post-title h1, .manga-title').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/\s*[|\-–]\s*/)[0]?.trim() ||
			path.split('/').pop()?.replace(/-/g, ' ') ||
			'';

		let cover =
			$('.summary_image img, .manga-thumb img, .wp-post-image').first().attr('data-src') ||
			$('.summary_image img, .manga-thumb img, .wp-post-image').first().attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = absUrl(this.baseUrl, (cover || '').split('?')[0]);

		const authors: string[] = [];
		$('.author-content a, .artist-content a, .post-content_item:contains("Author") a').each(
			(_, a) => {
				const n = $(a).text().replace(/\s+/g, ' ').trim();
				if (n && !authors.includes(n)) authors.push(n);
			}
		);

		const genres: string[] = [];
		$('.genres-content a, .wp-manga-genre a, a[rel="tag"]').each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		let status = 'Ongoing';
		const st = $('.post-status .summary-content, .post-content_item')
			.text()
			.replace(/\s+/g, ' ');
		if (/completed|complete/i.test(st)) status = 'Completed';
		else if (/hiatus/i.test(st)) status = 'Hiatus';
		else if (/canceled|cancelled/i.test(st)) status = 'Cancelled';

		let description =
			$('.description-summary .summary__content, .summary__content, .manga-excerpt')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('meta[property="og:description"]').attr('content')?.replace(/\s+/g, ' ').trim() ||
			'';
		if (description.length > 3000) description = description.slice(0, 3000) + '…';

		const chapters = await this.fetchAllChapters(seriesPath);

		console.log(
			`[bcatranslation] details ${path} → ${chapters.length} ch (${chapters.filter((c) => c.isLocked).length} locked)`
		);

		return {
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
			latestChapter: chapters[0]?.number
		};
	}

	private async fetchAllChapters(seriesPath: string): Promise<Chapter[]> {
		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		const base = seriesPath.endsWith('/') ? seriesPath : `${seriesPath}/`;
		const seriesId = base.replace(/\/$/, '');

		const parseAjax = (ajaxHtml: string): { added: number; maxPage: number } => {
			const $ = cheerio.load(ajaxHtml);
			let maxPage = 1;
			let added = 0;

			$('ul.main.version-chap li.wp-manga-chapter, li.wp-manga-chapter').each((_, li) => {
				const $li = $(li);
				const a = $li.children('a').first().length
					? $li.children('a').first()
					: $li.find('a').first();

				const rawTitle = a.text().replace(/\s+/g, ' ').trim();
				const href = (a.attr('href') || '').trim();
				const liClass = ($li.attr('class') || '').toLowerCase();

				const isFree = /\bfree-chap\b/.test(liClass);
				const isPremium =
					/\bpremium\b|\bpremium-block\b/.test(liClass) ||
					($li.find('.coin').not('.free').length > 0 && !isFree) ||
					a.find('.fa-lock').length > 0;
				const isLocked = isPremium && !isFree;

				let number = parseChapterNumber(rawTitle, 0);
				if (number <= 0) number = parseChapterNumber(href, 0);
				if (number <= 0) return;

				let id = '';
				if (href && href !== '#' && /\/chapter-/i.test(href)) {
					const full = pathOnly(href, this.baseUrl);
					id = full.startsWith('/') ? full : `/${full}`;
				} else {
					const numStr = Number.isInteger(number) ? String(number) : String(number);
					id = `${seriesId}/chapter-${numStr}`;
				}

				if (seen.has(id)) return;
				seen.add(id);

				const date =
					$li.find('.chapter-release-date').text().replace(/\s+/g, ' ').trim() || '';

				chapters.push({
					id,
					title: shortChapterTitle(number, rawTitle),
					number,
					date,
					...(isLocked ? { isLocked: true } : {})
				});
				added++;
			});

			$('.pagination a[data-page], .pagination .page, a[data-page]').each((_, el) => {
				const dp = $(el).attr('data-page');
				if (dp) {
					const n = parseInt(dp, 10);
					if (!Number.isNaN(n) && n > maxPage) maxPage = n;
				}
				const cls = $(el).attr('class') || '';
				const cm = cls.match(/page-(\d+)/);
				if (cm) {
					const n = parseInt(cm[1], 10);
					if (n > maxPage) maxPage = n;
				}
			});
			$('.pagination .page').each((_, el) => {
				const t = $(el).text().replace(/[^\d]/g, '');
				if (t) {
					const n = parseInt(t, 10);
					if (!Number.isNaN(n) && n > maxPage) maxPage = n;
				}
			});

			return { added, maxPage };
		};

		try {
			const first = await this.postAjax(`${this.baseUrl}${base}ajax/chapters/?t=1`);
			const r1 = parseAjax(first);
			let maxPage = Math.min(Math.max(r1.maxPage, 1), 60);

			// Fetch remaining pages; stop early after 2 consecutive empty pages
			let emptyStreak = 0;
			for (let pg = 2; pg <= maxPage; pg++) {
				try {
					const h = await this.postAjax(`${this.baseUrl}${base}ajax/chapters/?t=${pg}`);
					const r = parseAjax(h);
					// Pagination on later pages may reveal higher max
					if (r.maxPage > maxPage) maxPage = Math.min(r.maxPage, 60);
					if (r.added === 0) {
						emptyStreak++;
						if (emptyStreak >= 2) break;
					} else {
						emptyStreak = 0;
					}
				} catch {
					emptyStreak++;
					if (emptyStreak >= 2) break;
				}
			}

			console.log(
				`[bcatranslation] ajax chapters ${base} → ${chapters.length} (pages≤${maxPage})`
			);
		} catch (e) {
			console.warn('[bcatranslation] ajax chapters failed, fallback static', e);
			try {
				const html = await this.fetchHtml(base);
				const $ = cheerio.load(html);
				$('a[href*="/chapter-"]').each((_, a) => {
					const full = pathOnly($(a).attr('href') || '', this.baseUrl);
					if (!/\/chapter-/i.test(full)) return;
					const id = full.startsWith('/') ? full : `/${full}`;
					if (seen.has(id)) return;
					seen.add(id);
					const number = parseChapterNumber(id, 0);
					if (number <= 0) return;
					chapters.push({
						id,
						title: shortChapterTitle(number),
						number
					});
				});
			} catch {
				/* ignore */
			}
		}

		chapters.sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
		return chapters;
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
		let path = pathOnly(chapterId, this.baseUrl);
		if (!path.startsWith('/novel/')) {
			path = `/novel/${path.replace(/^\//, '')}`;
		}
		const fetchPath = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(fetchPath);
		const $ = cheerio.load(html);

		// Locked / coin wall
		const bodyText = $('body').text().toLowerCase();
		const contentProbe = $('.reading-content p, .text-left p').length;
		if (
			contentProbe < 2 &&
			(/you need to (buy|unlock)|premium chapter|login to view|subscribe to read|not enough coin/i.test(
				bodyText
			) ||
				$('.premium-block, .c-blocked-content').length > 0)
		) {
			throw new Error('Chapter is locked / premium on Bcatranslation');
		}

		const rawTitle =
			$('h1, .post-title h1, .chapter-heading').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/\s*[|\-–]\s*/)[0]?.trim() ||
			'';
		const number = parseChapterNumber(path + ' ' + rawTitle, 0);
		const title = shortChapterTitle(number > 0 ? number : 1, rawTitle);

		const contentEl = $('.reading-content .text-left, .reading-content, .text-left').first();
		contentEl.find('script, style, noscript, iframe, .ads, .ad, .code-block').remove();

		let contentHtml = contentEl.html() || '';
		contentHtml = contentHtml
			.replace(/<script[\s\S]*?<\/script>/gi, '')
			.replace(/<style[\s\S]*?<\/style>/gi, '')
			.replace(/on\w+="[^"]*"/gi, '')
			.trim();

		if (!contentHtml || contentHtml.replace(/<[^>]+>/g, '').trim().length < 40) {
			const paras = contentEl
				.find('p')
				.map((_, p) => $(p).text().trim())
				.get()
				.filter((t) => t.length > 5);
			if (paras.length) {
				contentHtml = paras.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
			}
		}

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		$('a.btn.prev_page, a.prev_page, .nav-previous a').each((_, a) => {
			const full = pathOnly($(a).attr('href') || '', this.baseUrl);
			if (/\/chapter-/i.test(full)) {
				prevChapterId = full.startsWith('/') ? full : `/${full}`;
			}
		});
		$('a.btn.next_page, a.next_page, .nav-next a').each((_, a) => {
			const full = pathOnly($(a).attr('href') || '', this.baseUrl);
			if (/\/chapter-/i.test(full)) {
				nextChapterId = full.startsWith('/') ? full : `/${full}`;
			}
		});

		console.log(
			`[bcatranslation] chapter ${path} → ${contentHtml.length}c prev=${prevChapterId} next=${nextChapterId}`
		);

		return {
			title,
			content: contentHtml || '<p>No content</p>',
			prevChapterId,
			nextChapterId
		};
	}
}

export default BcatranslationSource;
