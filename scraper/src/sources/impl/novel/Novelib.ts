/**
 * Novelib (novelib.com) — Fictioneer theme novel site
 * Path: scraper/src/sources/impl/novel/Novelib.ts
 *
 * - List: /browse/ + /browse/page/{n}/
 * - Homepage: 24 titles (page 1 merges browse pages 1–3)
 * - Detail: /story/{slug}/
 * - Chapter: /story/{slug}/{chapter-slug}/
 * - Premium/password chapters → isLocked: true (lock icon)
 * - Chapter title shortened to "Chapter N"
 * - Content: #chapter-content
 * - Search: /?s= + /page/{n}/?s=
 * - Prev/Next: a.button._navigation._prev / ._next
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
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

function pathOnly(href: string, baseHost = 'https://novelib.com'): string {
	try {
		const u = new URL(
			href.startsWith('http')
				? href
				: `${baseHost}${href.startsWith('/') ? '' : '/'}${href}`
		);
        
		return (u.pathname.replace(/\/$/, '') || '/') ;
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
		t.match(/\bC(\d+(?:\.\d+)?)\b/) ||
		t.match(/-c(\d+(?:\.\d+)?)(?:\/|$)/i) ||
		t.match(/(\d+(?:\.\d+)?)/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function shortChapterTitle(number: number, raw?: string): string {
	if (number > 0) {
		return Number.isInteger(number) ? `Chapter ${number}` : `Chapter ${number}`;
	}
	const n = parseChapterNumber(raw || '', 0);
	return n > 0 ? `Chapter ${n}` : 'Chapter';
}

export class NovelibSource extends BaseSource {
	id = 'novelib';
	name = 'Novelib';
	baseUrl = 'https://novelib.com';

	kind = 'novel' as const;

	// ─── Latest / Browse list ────────────────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		return this.getLatestNovels(page);
	}

	async getLatestNovels(page = 1): Promise<Manga[]> {
		const p = Math.max(1, page);

		if (p <= 1) {
			const [a, b, c] = await Promise.all([
				this.fetchBrowsePage(1).catch(() => [] as Manga[]),
				this.fetchBrowsePage(2).catch(() => [] as Manga[]),
				this.fetchBrowsePage(3).catch(() => [] as Manga[])
			]);
			const merged = this.dedupeById([...a, ...b, ...c]).slice(0, 24);
			console.log(`[novelib] latest page=1 → ${merged.length}`);
			return merged;
		}

		const sitePage = p + 2;
		const list = await this.fetchBrowsePage(sitePage);
		console.log(`[novelib] latest page=${p} → ${list.length}`);
		return list;
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

	private async fetchBrowsePage(page: number): Promise<Manga[]> {
		const path = page <= 1 ? '/browse/' : `/browse/page/${page}/`;
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('.card._story, article.card, .card__body, .card').each((_, el) => {
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

		return list;
	}

	private parseStoryCard($: cheerio.CheerioAPI, el: any): Manga | null {
		const root = $(el);
		const a =
			root.find('.card__title a, h3 a, h2 a, a.card__image').first().length
				? root.find('.card__title a, h3 a, h2 a').first()
				: root.find('a[href*="/story/"]').first();

		const href = a.attr('href') || root.find('a[href*="/story/"]').first().attr('href') || '';
		const m = href.match(/\/story\/([a-z0-9\-]+)\/?/i);
		if (!m) return null;

		const id = `/story/${m[1]}`;
		const title = (
			a.text() ||
			root.find('.card__title').first().text() ||
			$(a).attr('title') ||
			m[1]
		)
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 200);
		if (!title) return null;

		let cover =
			root.find('.card__image img, img').first().attr('src') ||
			root.find('.card__image img, img').first().attr('data-src') ||
			root.find('a.card__image').attr('href') ||
			'';

		const lightbox = root.find('a.card__image[href]').attr('href') || '';
		if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(lightbox)) cover = lightbox;

		const statusRaw =
			root.find('.card__footer-status, .card-footer-status').first().text().replace(/\s+/g, ' ').trim() ||
			'';
		let status = 'Ongoing';
		if (/complete|completed|tamat/i.test(statusRaw)) status = 'Completed';
		else if (/hiatus/i.test(statusRaw)) status = 'Hiatus';
		else if (/cancel/i.test(statusRaw)) status = 'Cancelled';
		else if (/ongoing/i.test(statusRaw)) status = 'Ongoing';

		let latestChapter: number | undefined;
		const chText = root
			.find('.card__link-list-link, .card__link-list-item a')
			.first()
			.text()
			.replace(/\s+/g, ' ')
			.trim();
		const n = parseChapterNumber(chText, 0);
		if (n > 0) latestChapter = n;

		return {
			id,
			title,
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

			$('.card._story, article.card, .card__body, .card').each((_, el) => {
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

			console.log(`[novelib] search "${q}" page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[novelib] search', e);
			return [];
		}
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		return this.getNovelDetails(mangaId);
	}

	async getNovelDetails(novelId: string): Promise<MangaDetails> {
		let path = pathOnly(novelId, this.baseUrl);
		const chMatch = path.match(/^(\/story\/[a-z0-9\-]+)\/[a-z0-9\-]+$/i);
		if (chMatch) path = chMatch[1];
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
			$('.story__thumbnail img, .story-thumbnail img, .wp-post-image').first().attr('src') ||
			$('.story__header img, article img').first().attr('src') ||
			'';
		cover = absUrl(this.baseUrl, (cover || '').split('?')[0]);

		const authors: string[] = [];
		$('.story__author a, .author a, a[rel="author"], .story__meta .author').each((_, a) => {
			const n = $(a).text().replace(/\s+/g, ' ').trim();
			if (n && n.length < 80 && !authors.includes(n)) authors.push(n);
		});
		if (!authors.length) {
			const am = $('body').text().match(/Author\s*[:：]\s*([^\n\r<]+)/i);
			if (am) {
				const n = am[1].replace(/\s+/g, ' ').trim().slice(0, 80);
				if (n) authors.push(n);
			}
		}

		const genres: string[] = [];
		$(
			'.story__taxonomies a, .tag-pill, .story__tags a, a[href*="/tag/"], a[href*="/genre/"], .genre a'
		).each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (g && g.length < 40 && !genres.includes(g) && !/^#/.test(g)) {
				genres.push(g.replace(/^#/, ''));
			}
		});

		let status = 'Ongoing';
		const statusText =
			$('.story__status, .card__footer-status, [class*="status"]').first().text() ||
			$('body').text().slice(0, 3000);
		if (/completed|complete/i.test(statusText)) status = 'Completed';
		else if (/hiatus/i.test(statusText)) status = 'Hiatus';
		else if (/cancel/i.test(statusText)) status = 'Cancelled';

		let description = '';
		const summary = $('.story__summary, .story-summary, .summary').first();
		summary.find('script, style, .code-block, .ads, iframe').remove();
		description = summary
			.text()
			.replace(/\s+/g, ' ')
			.trim();
		if (!description || description.length < 40) {
			description = $('meta[property="og:description"], meta[name="description"]')
				.attr('content')
				?.replace(/\s+/g, ' ')
				.trim() || '';
		}
		if (description.length > 3000) description = description.slice(0, 3000) + '…';

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('li.chapter-group__list-item, .chapter-group__list-item').each((_, li) => {
			const $li = $(li);
			const a = $li.find('a.chapter-group__list-item-link, a[href*="/story/"]').first();
			const href = a.attr('href') || '';
			const full = pathOnly(href, this.baseUrl);
			if (!/\/story\/[^/]+\/[^/]+/i.test(full)) return;

			const id = full.startsWith('/') ? full : `/${full}`;
			if (seen.has(id)) return;
			seen.add(id);

			const rawTitle = a.text().replace(/\s+/g, ' ').trim() || id;
			let number = parseChapterNumber(rawTitle + ' ' + id, 0);
			if (number <= 0) number = chapters.length + 1;

			const liClass = ($li.attr('class') || '').toLowerCase();
			const isLocked =
				/\b_password\b|\bpassword\b|premium|_locked/i.test(liClass) ||
				$li.find('.fa-lock, [class*="lock"]').length > 0 ||
				a.find('.fa-lock, [class*="lock"]').length > 0;

			const date =
				$li
					.find(
						'.chapter-group__list-item-date .list-view, time .list-view, .chapter-group__list-item-date .grid-view, time .grid-view'
					)
					.first()
					.text()
					.replace(/\s+/g, ' ')
					.trim() ||
				$li
					.find('time[datetime]')
					.first()
					.attr('datetime') ||
				'';

			chapters.push({
				id,
				title: shortChapterTitle(number, rawTitle),
				number,
				date,
				...(isLocked ? { isLocked: true } : {})
			});
		});

		if (!chapters.length) {
			$('a[href*="/story/"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const cm = href.match(/\/story\/([a-z0-9\-]+)\/([a-z0-9\-]+)\/?/i);
				if (!cm) return;
				const id = `/story/${cm[1]}/${cm[2]}`;
				if (seen.has(id)) return;
				seen.add(id);
				const rawTitle = $(a).text().replace(/\s+/g, ' ').trim() || cm[2];
				const number = parseChapterNumber(rawTitle + ' ' + id, chapters.length + 1);
				const cls = (
					($(a).attr('class') || '') +
					' ' +
					($(a).parent().attr('class') || '')
				).toLowerCase();
				const isLocked =
					/\b_password\b|\bpassword\b|premium/i.test(cls) ||
					$(a).find('.fa-lock').length > 0;
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
			`[novelib] details ${path} → ${chapters.length} ch (${chapters.filter((c) => c.isLocked).length} locked)`
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
		if (!path.startsWith('/story/')) {
			path = `/story/${path.replace(/^\//, '')}`;
		}
		path = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const bodyText = $('body').text().toLowerCase();
		const hasPasswordForm =
			$('input[type="password"], form[class*="password"], .password-note, .chapter-password')
				.length > 0;
		const contentProbe = $('#chapter-content p, .chapter__content p').length;
		if (
			hasPasswordForm ||
			(/password|subscribers only|locked chapter|members only|premium chapter/i.test(bodyText) &&
				contentProbe < 3)
		) {
			throw new Error('Chapter is locked / premium on Novelib');
		}

		const rawTitle =
			$('.chapter__title, h1.chapter__title, h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/\s*[|\-–]\s*/)[0]?.trim() ||
			'';
		const number = parseChapterNumber(rawTitle + ' ' + path, 0);
		const title = shortChapterTitle(number > 0 ? number : 1, rawTitle);

		const contentEl = $('#chapter-content, .chapter__content, .chapter-content').first();
		contentEl
			.find(
				'script, style, noscript, .ads, .ad, iframe, .code-block, .chapter__support, .adsbygoogle'
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

		$('a.button._navigation._prev, a._navigation._prev, a.micro-menu__prev').each((_, a) => {
			const href = ($(a).attr('href') || '').trim();
			if (!href || href === '#') return;
			const full = pathOnly(href, this.baseUrl);
			if (/\/story\/[^/]+\/[^/]+/i.test(full)) {
				prevChapterId = full.startsWith('/') ? full : `/${full}`;
			}
		});
		$('a.button._navigation._next, a._navigation._next, a.micro-menu__next').each((_, a) => {
			const href = ($(a).attr('href') || '').trim();
			if (!href || href === '#') return;
			const full = pathOnly(href, this.baseUrl);
			if (/\/story\/[^/]+\/[^/]+/i.test(full)) {
				nextChapterId = full.startsWith('/') ? full : `/${full}`;
			}
		});

		if (!prevChapterId) {
			$('a[rel="prev"]').each((_, a) => {
				const full = pathOnly($(a).attr('href') || '', this.baseUrl);
				if (/\/story\/[^/]+\/[^/]+/i.test(full)) {
					prevChapterId = full.startsWith('/') ? full : `/${full}`;
				}
			});
		}
		if (!nextChapterId) {
			$('a[rel="next"]').each((_, a) => {
				const full = pathOnly($(a).attr('href') || '', this.baseUrl);
				if (/\/story\/[^/]+\/[^/]+/i.test(full)) {
					nextChapterId = full.startsWith('/') ? full : `/${full}`;
				}
			});
		}

		console.log(
			`[novelib] chapter ${path} → ${contentHtml.length}c prev=${prevChapterId} next=${nextChapterId}`
		);

		return {
			title,
			content: contentHtml || '<p>No content</p>',
			prevChapterId,
			nextChapterId
		};
	}
}

export default NovelibSource;
