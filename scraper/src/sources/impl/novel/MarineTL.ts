/**
 * MarineTL (marinetl.xyz) — Fictioneer theme novel site
 * Path: scraper/src/sources/impl/MarineTL.ts
 *
 * - List: /stories/ + /stories/page/{n}/  (section Stories only)
 * - Homepage target: 24 titles (page 1 merges stories pages 1–3)
 * - Detail: /story/{slug}/
 * - Chapter: /story/{slug}/{chapter-slug}/
 * - Premium/password chapters → isLocked: true (frontend shows lock icon)
 * - Chapter title shortened to "Chapter N"
 * - Content: #chapter-content
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types';

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

function pathOnly(href: string, baseHost = 'https://marinetl.xyz'): string {
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
		t.match(/(?:chapter|ch\.?|c)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\bC(\d+(?:\.\d+)?)\b/) ||
		t.match(/(\d+(?:\.\d+)?)/);
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

export class MarineTLSource extends BaseSource {
	id = 'marinetl';
	name = 'MarineTL';
	baseUrl = 'https://marinetl.xyz';

	kind = 'novel' as const;

	// ─── Latest / Stories list ───────────────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		return this.getLatestNovels(page);
	}

	async getLatestNovels(page = 1): Promise<Manga[]> {
		if (page <= 1) {
			const [p1, p2, p3] = await Promise.all([
				this.fetchStoriesPage(1).catch(() => [] as Manga[]),
				this.fetchStoriesPage(2).catch(() => [] as Manga[]),
				this.fetchStoriesPage(3).catch(() => [] as Manga[])
			]);
			return this.dedupeById([...p1, ...p2, ...p3]).slice(0, 24);
		}
		
		const sitePage = page + 2;
		return this.fetchStoriesPage(sitePage);
	}

	private dedupeById(items: Manga[]): Manga[] {
		const seen = new Set<string>();
		const out: Manga[] = [];
		for (const m of items) {
			if (seen.has(m.id)) continue;
			seen.add(m.id);
			out.push(m);
		}
		return out;
	}

	private async fetchStoriesPage(page: number): Promise<Manga[]> {
		const path = page <= 1 ? '/stories/' : `/stories/page/${page}/`;
		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list: Manga[] = [];
			const seen = new Set<string>();

			$('.card__body, article.card, .card').each((_, el) => {
				const item = this.parseStoryCard($, el);
				if (item && !seen.has(item.id)) {
					seen.add(item.id);
					list.push(item);
				}
			});

			if (list.length < 4) {
				$('a[href*="/story/"]').each((_, a) => {
					const href = $(a).attr('href') || '';
					const m = href.match(/\/story\/([a-z0-9\-]+)\/?$/i);
					if (!m) return;
					const id = `/story/${m[1]}`;
					if (seen.has(id)) return;
					const title =
						$(a).attr('title') ||
						$(a).find('.card__title, h2, h3').first().text() ||
						$(a).text();
					const t = title.replace(/\s+/g, ' ').trim();
					if (!t || t.length < 3) return;
					const img =
						$(a).find('img').attr('data-src') ||
						$(a).find('img').attr('src') ||
						$(a).closest('.card, .card__body').find('img').attr('data-src') ||
						$(a).closest('.card, .card__body').find('img').attr('src') ||
						'';
					seen.add(id);
					list.push({
						id,
						title: t.slice(0, 200),
						cover: absUrl(this.baseUrl, (img || '').split('?')[0]),
						sourceId: this.id,
						type: 'novel',
						lang: 'en'
					});
				});
			}

			console.log(`[marinetl] stories page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[marinetl] fetchStoriesPage', page, e);
			return [];
		}
	}

	private parseStoryCard($: cheerio.CheerioAPI, el: any): Manga | null {
		const root = $(el);

		const titleA = root
			.find('a.card__title, .card__title a, a[href*="/story/"]')
			.filter((_, a) => {
				const h = $(a).attr('href') || '';
				return /\/story\/[a-z0-9\-]+\/?$/i.test(h) && !/\/story\/[^/]+\/[^/]+/.test(h);
			})
			.first();

		const href =
			titleA.attr('href') || root.find('a[href*="/story/"]').first().attr('href') || '';
		const m = href.match(/\/story\/([a-z0-9\-]+)/i);
		if (!m) return null;

		const slug = m[1];
		const id = `/story/${slug}`;

		const title =
			titleA.text().replace(/\s+/g, ' ').trim() ||
			root.find('.card__title').first().text().replace(/\s+/g, ' ').trim() ||
			root.find('img').attr('alt')?.trim() ||
			slug;

		if (!title || title.length < 2) return null;

		const img = root.find('.card__image img, img.wp-post-image, img').first();
		const cover =
			img.attr('data-src') || img.attr('data-lazy-src') || img.attr('src') || '';

		let latestChapter: number | undefined;
		const chText =
			root.find('.card__footer-chapters').first().text() ||
			root.find('.card__link-list-link').first().text() ||
			'';
		const n = parseChapterNumber(chText);
		if (n > 0) latestChapter = n;

		const statusRaw =
			root.find('.card__footer-status').first().text().replace(/\s+/g, ' ').trim() ||
			'';
		let status = 'Ongoing';
		if (/complete|completed|tamat/i.test(statusRaw)) status = 'Completed';
		else if (/hiatus/i.test(statusRaw)) status = 'Hiatus';
		else if (/ongoing/i.test(statusRaw)) status = 'Ongoing';

		return {
			id,
			title: title.slice(0, 200),
			cover: absUrl(this.baseUrl, (cover || '').split('?')[0]),
			sourceId: this.id,
			type: 'novel',
			status,
			lang: 'en',
			...(latestChapter != null ? { latestChapter } : {})
		};
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
				? `/?s=${encodeURIComponent(q)}`
				: `/page/${page}/?s=${encodeURIComponent(q)}`;

		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list: Manga[] = [];
			const seen = new Set<string>();

			$('.card__body, article.card, .card').each((_, el) => {
				const item = this.parseStoryCard($, el);
				if (item && !seen.has(item.id)) {
					seen.add(item.id);
					list.push(item);
				}
			});

			if (list.length < 2) {
				$('a[href*="/story/"]').each((_, a) => {
					const href = $(a).attr('href') || '';
					const m = href.match(/\/story\/([a-z0-9\-]+)\/?$/i);
					if (!m) return;
					const id = `/story/${m[1]}`;
					if (seen.has(id)) return;
					const title = ($(a).attr('title') || $(a).text()).replace(/\s+/g, ' ').trim();
					if (!title || title.length < 3) return;
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

			console.log(`[marinetl] search "${q}" → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[marinetl] search', e);
			return [];
		}
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		return this.getNovelDetails(mangaId);
	}

	async getNovelDetails(novelId: string): Promise<MangaDetails> {
		let path = pathOnly(novelId, this.baseUrl);
		if (!path.startsWith('/story/')) {
			path = `/story/${path.replace(/^\//, '')}`;
		}
		path = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			$('h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/\s*[|\-–]\s*/)[0]?.trim() ||
			path.split('/').filter(Boolean).pop() ||
			'';

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('.story__thumbnail img, .story-cover img, img.wp-post-image')
				.first()
				.attr('data-src') ||
			$('.story__thumbnail img, .story-cover img, img.wp-post-image').first().attr('src') ||
			$('img[src*="uploads"]').first().attr('src') ||
			'';
		cover = absUrl(this.baseUrl, (cover || '').split('?')[0]);

		let description =
			$('.story__summary, .story-summary, .summary, [class*="summary"]')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('meta[name="description"]').attr('content')?.trim() ||
			$('meta[property="og:description"]').attr('content')?.trim() ||
			'';

		const authors: string[] = [];
		const skipAuthor = /^(marinetl|zen0s|admin)$/i;
		$('a[href*="/author/"]').each((_, a) => {
			const n = $(a).text().replace(/\s+/g, ' ').trim();
			if (n && !skipAuthor.test(n) && !authors.includes(n)) authors.push(n);
		});

		const genres: string[] = [];
		$('a[href*="/genre/"], a[href*="/tag/"]').each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		let status = 'Ongoing';
		const statusText = $('.story__status, [class*="status"]').first().text();
		if (/complete/i.test(statusText)) status = 'Completed';
		else if (/hiatus/i.test(statusText)) status = 'Hiatus';

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('a.chapter-group__list-item-link, li.chapter-group__list-item a[href*="/story/"]').each(
			(_, a) => {
				const href = $(a).attr('href') || '';
				const cm = href.match(/\/story\/([a-z0-9\-]+)\/([a-z0-9\-]+)\/?$/i);
				if (!cm) return;

				const id = `/story/${cm[1]}/${cm[2]}`;
				if (seen.has(id)) return;
				seen.add(id);

				const rawTitle = $(a).text().replace(/\s+/g, ' ').trim() || cm[2];
				const number = parseChapterNumber(rawTitle, chapters.length + 1);

				const li = $(a).closest('li, .chapter-group__list-item');
				const liClass = (li.attr('class') || '') + ' ' + ($(a).attr('class') || '');
				const isLocked =
					/\b_password\b|\bpassword\b/i.test(liClass) ||
					li.find('.fa-lock, [class*="lock"]').length > 0 ||
					$(a).find('.fa-lock, [class*="lock"]').length > 0;

				const date =
					li
						.find('.chapter-group__list-item-date, .date')
						.first()
						.text()
						.replace(/\s+/g, ' ')
						.trim() || '';

				chapters.push({
					id,
					title: shortChapterTitle(number, rawTitle),
					number,
					date,
					...(isLocked ? { isLocked: true } : {})
				});
			}
		);

		if (!chapters.length) {
			$('a[href*="/story/"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const cm = href.match(/\/story\/([a-z0-9\-]+)\/([a-z0-9\-]+)\/?$/i);
				if (!cm) return;
				const id = `/story/${cm[1]}/${cm[2]}`;
				if (seen.has(id)) return;
				seen.add(id);
				const rawTitle = $(a).text().replace(/\s+/g, ' ').trim() || cm[2];
				const number = parseChapterNumber(rawTitle, chapters.length + 1);
				const cls = (($(a).attr('class') || '') + ' ' + ($(a).parent().attr('class') || '')).toLowerCase();
				const isLocked = /\b_password\b|\bpassword\b/.test(cls);
				chapters.push({
					id,
					title: shortChapterTitle(number, rawTitle),
					number,
					...(isLocked ? { isLocked: true } : {})
				});
			});
		}

		chapters.sort((a, b) => (b.number ?? 0) - (a.number ?? 0));

		console.log(
			`[marinetl] details ${path} → ${chapters.length} chapters (${chapters.filter((c) => c.isLocked).length} locked)`
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

	// ─── Chapter content (novel text) ────────────────────────────────────

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
		if (!path.startsWith('/story/')) {
			path = `/story/${path.replace(/^\//, '')}`;
		}
		path = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const bodyText = $('body').text().toLowerCase();
		const hasPasswordForm =
			$('input[type="password"], form[class*="password"], .password-note, .chapter-password').length >
			0;
		if (
			hasPasswordForm ||
			(/password|patreon|subscribers only|locked chapter/i.test(bodyText) &&
				$('#chapter-content p, .chapter__content p').length < 3)
		) {
			throw new Error('Chapter is locked / premium on MarineTL');
		}

		const rawTitle =
			$('.chapter__title, h1.chapter__title, h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/\s*[|\-–]\s*/)[0]?.trim() ||
			'';
		const number = parseChapterNumber(rawTitle, 0);
		const title = shortChapterTitle(number, rawTitle);

		const contentEl = $('#chapter-content, .chapter__content, .chapter-content').first();
		contentEl.find('script, style, noscript, .ads, .ad, iframe, .chapter__support').remove();

		let contentHtml = contentEl.html() || '';
		contentHtml = contentHtml
			.replace(/<script[\s\S]*?<\/script>/gi, '')
			.replace(/<style[\s\S]*?<\/style>/gi, '')
			.replace(/on\w+="[^"]*"/gi, '')
			.trim();

		if (!contentHtml || contentHtml.length < 40) {
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

		$('a[href*="/story/"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const cm = href.match(/\/story\/([a-z0-9\-]+)\/([a-z0-9\-]+)\/?$/i);
			if (!cm) return;
			const id = `/story/${cm[1]}/${cm[2]}`;
			const label = ($(a).text() + ' ' + ($(a).attr('aria-label') || '')).toLowerCase();
			const cls = ($(a).attr('class') || '').toLowerCase();
			if (/prev|previous|sebelum/i.test(label) || /prev/i.test(cls)) {
				prevChapterId = id;
			} else if (/next|lanjut|berikut/i.test(label) || /next/i.test(cls)) {
				nextChapterId = id;
			}
		});

		console.log(`[marinetl] chapter ${path} → content=${contentHtml.length} chars`);

		return {
			title,
			content: contentHtml || '<p>No content</p>',
			prevChapterId,
			nextChapterId
		};
	}
}

export default MarineTLSource;
