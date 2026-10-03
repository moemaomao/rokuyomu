/**
 * MainichiTL (mainichitl.com) — WordPress novel TL site
 * Path: scraper/src/sources/impl/novel/MainichiTL.ts
 *
 * - List: /current/ + /caught-up/ + /completed/ (merged, target ~24 on page 1)
 * - Detail: /{slug}/
 * - Chapter: /{slug}/episode-N-.../ or /{slug}/volume-N-episode-.../
 * - Premium/password chapters → isLocked: true (frontend shows lock icon)
 * - Chapter title shortened to "Chapter N" / "Episode N"
 * - Content: .entry-content
 * - Search: /?s={query}
 * - Pagination: page>1 continues through merged list / search pages
 * - next/prev extracted from chapter page nav links
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const SKIP_SLUGS = new Set([
	'',
	'feed',
	'comments',
	'wp-json',
	'xmlrpc.php',
	'latest-posts',
	'current',
	'caught-up',
	'completed',
	'legal',
	'privacy-policy',
	'terms-and-conditions',
	'dmca',
	'about-us',
	'page',
	'category',
	'tag',
	'author',
	'search',
	'wp-content',
	'wp-admin',
	'wp-includes',
	'sample-page',
	'home'
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

function pathOnly(href: string, baseHost = 'https://mainichitl.com'): string {
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

	const volEp = t.match(/volume-(\d+)[-_/]episode-(\d+(?:\.\d+)?)/i);
	if (volEp) {
		const vol = parseInt(volEp[1], 10);
		const ep = parseFloat(volEp[2]);
		if (!Number.isNaN(vol) && !Number.isNaN(ep)) return vol * 1000 + ep;
	}

	const pathEp = t.match(/\/episode-(\d+(?:\.\d+)?)/i);
	if (pathEp) {
		const n = parseFloat(pathEp[1]);
		if (!Number.isNaN(n)) return n;
	}

	const textEp = t.match(
		/(?:episode|ep\.?|chapter|ch\.?)\s*[.\-_]?\s*(\d+(?:\.\d+)?)/i
	);
	if (textEp) {
		const n = parseFloat(textEp[1]);
		if (!Number.isNaN(n)) return n;
	}

	const bare = t.match(/(?:^|[\s\-_/])(\d+(?:\.\d+)?)(?:$|[\s\-_/])/);
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
	if (display > 0) return `Chapter ${display}`;
	const n = parseChapterNumber(raw || '', 0);
	if (n >= 1000) {
		const ep = n % 1000;
		if (ep > 0) return `Chapter ${ep}`;
	}
	return n > 0 ? `Chapter ${n}` : 'Chapter';
}

function isSeriesPath(path: string): boolean {
	const clean = path.replace(/\/$/, '').replace(/^\//, '');
	if (!clean || clean.includes('/')) return false;
	if (SKIP_SLUGS.has(clean.toLowerCase())) return false;
	if (/^page\/\d+/i.test(clean)) return false;
	return true;
}

function isChapterPath(path: string): boolean {
	const clean = path.replace(/\/$/, '');
	return /\/(?:episode|volume)-\d+/i.test(clean) || /\/chapter-\d+/i.test(clean);
}

function seriesIdFromPath(path: string): string {
	const p = pathOnly(path);
	const parts = p.split('/').filter(Boolean);
	if (!parts.length) return p;
	if (isChapterPath(p) && parts.length >= 2) {
		return `/${parts[0]}`;
	}
	return `/${parts[0]}`;
}

export class MainichiTLSource extends BaseSource {
	id = 'mainichitl';
	name = 'MainichiTL';
	baseUrl = 'https://mainichitl.com';

	kind = 'novel' as const;

	// ─── Latest / series list ────────────────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		return this.getLatestNovels(page);
	}

	async getLatestNovels(page = 1): Promise<Manga[]> {
		const p = Math.max(1, page);

		if (p <= 1) {
			const [current, caughtUp, completed] = await Promise.all([
				this.fetchSeriesListPage('/current/').catch(() => [] as Manga[]),
				this.fetchSeriesListPage('/caught-up/').catch(() => [] as Manga[]),
				this.fetchSeriesListPage('/completed/').catch(() => [] as Manga[])
			]);

			const seen = new Set<string>();
			const merged: Manga[] = [];
			for (const item of [...current, ...caughtUp, ...completed]) {
				if (seen.has(item.id)) continue;
				seen.add(item.id);
				merged.push(item);
				if (merged.length >= 24) break;
			}

			console.log(`[mainichitl] latest page=1 → ${merged.length} titles`);
			return merged;
		}

		const allCompleted = await this.fetchSeriesListPage('/completed/').catch(() => [] as Manga[]);
		const page1Count = await this.countPage1().catch(() => 24);
		const offset = (p - 2) * 24 + Math.max(0, 24 - page1Count);
		const slice = allCompleted.slice(Math.max(0, offset), Math.max(0, offset) + 24);
		console.log(`[mainichitl] latest page=${p} → ${slice.length} titles`);
		return slice;
	}

	private async countPage1(): Promise<number> {
		const list = await this.getLatestNovels(1);
		return list.length;
	}

	private async fetchSeriesListPage(path: string): Promise<Manga[]> {
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('#content a, .entry-content a, .page-content a, article a').each((_, a) => {
			const href = $(a).attr('href') || '';
			if (!href.includes('mainichitl.com') && !href.startsWith('/')) return;
			const path = pathOnly(href, this.baseUrl);
			if (!isSeriesPath(path)) return;
			if (isChapterPath(path)) return;

			const id = path.startsWith('/') ? path : `/${path}`;
			if (seen.has(id)) return;

			const title = ($(a).text() || $(a).attr('title') || '')
				.replace(/\s+/g, ' ')
				.trim();
			if (!title || title.length < 4) return;
			if (/^(home|menu|skip|scroll|privacy|terms|dmca|legal|about)/i.test(title)) return;

			seen.add(id);
			list.push({
				id,
				title: title.slice(0, 250),
				cover: '',
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: path.includes('completed') || /\/completed\//i.test(path) ? 'Completed' : undefined
			});
		});

		if (list.length < 2) {
			$('a[href]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const path = pathOnly(href, this.baseUrl);
				if (!isSeriesPath(path) || isChapterPath(path)) return;
				const id = path.startsWith('/') ? path : `/${path}`;
				if (seen.has(id)) return;
				const title = ($(a).text() || '').replace(/\s+/g, ' ').trim();
				if (!title || title.length < 8) return;
				seen.add(id);
				list.push({
					id,
					title: title.slice(0, 250),
					cover: '',
					sourceId: this.id,
					type: 'novel',
					lang: 'en'
				});
			});
		}

		const statusHint =
			/\/completed\//i.test(path) ? 'Completed' : /\/current\//i.test(path) ? 'Ongoing' : 'Ongoing';
		for (const item of list) {
			if (!item.status) item.status = statusHint;
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
				? `/?s=${encodeURIComponent(q)}`
				: `/page/${page}/?s=${encodeURIComponent(q)}`;

		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list: Manga[] = [];
			const seen = new Set<string>();

			$('article, .post, .hentry, .entry').each((_, el) => {
				const $el = $(el);
				const a =
					$el.find('h1 a, h2 a, h3 a, .entry-title a, a').first() ||
					$el.find('a[href*="mainichitl.com"]').first();
				const href = a.attr('href') || '';
				if (!href) return;
				let path = pathOnly(href, this.baseUrl);

				if (isChapterPath(path)) {
					path = seriesIdFromPath(path);
				}
				if (!isSeriesPath(path) && !path.match(/^\/[a-z0-9\-]+$/i)) return;

				const id = path.startsWith('/') ? path : `/${path}`;
				if (seen.has(id)) return;

				const title = (
					a.text() ||
					$el.find('.entry-title, h1, h2, h3').first().text() ||
					''
				)
					.replace(/\s+/g, ' ')
					.trim()
					.replace(/\s*[–\-]\s*Mainichi TL.*$/i, '')
					.replace(/^Episode\s+\d+\s*[–\-]\s*/i, '');
				if (!title || title.length < 3) return;

				const cover =
					$el.find('img').first().attr('src') ||
					$el.find('img').first().attr('data-src') ||
					'';

				seen.add(id);
				list.push({
					id,
					title: title.slice(0, 250),
					cover: absUrl(this.baseUrl, (cover || '').split('?')[0]),
					sourceId: this.id,
					type: 'novel',
					lang: 'en'
				});
			});

			if (list.length < 2) {
				$('a[href]').each((_, a) => {
					const href = $(a).attr('href') || '';
					let path = pathOnly(href, this.baseUrl);
					if (isChapterPath(path)) path = seriesIdFromPath(path);
					if (!isSeriesPath(path)) return;
					const id = path.startsWith('/') ? path : `/${path}`;
					if (seen.has(id)) return;
					const title = ($(a).text() || $(a).attr('title') || '')
						.replace(/\s+/g, ' ')
						.trim();
					if (!title || title.length < 8) return;
					if (/episode\s+\d+/i.test(title) && title.length < 40) return;
					seen.add(id);
					list.push({
						id,
						title: title.slice(0, 250),
						cover: '',
						sourceId: this.id,
						type: 'novel',
						lang: 'en'
					});
				});
			}

			console.log(`[mainichitl] search "${q}" page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[mainichitl] search', e);
			return [];
		}
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		return this.getNovelDetails(mangaId);
	}

	async getNovelDetails(novelId: string): Promise<MangaDetails> {
		let path = pathOnly(novelId, this.baseUrl);
		if (isChapterPath(path)) {
			path = seriesIdFromPath(path);
		}
		path = path.endsWith('/') ? path : `${path}/`;
		if (!path.startsWith('/')) path = `/${path}`;

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			$('h1.entry-title, h1.section-title, article h1, h1')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim()
				.replace(/\s*[–\-]\s*Mainichi TL.*$/i, '') ||
			$('meta[property="og:title"]')
				.attr('content')
				?.split(/\s*[|\-–]\s*/)[0]
				?.trim() ||
			path.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') ||
			'';

		const cover =
			absUrl(
				this.baseUrl,
				(
					$('meta[property="og:image"]').attr('content') ||
					$('article img, .entry-content img, .wp-post-image').first().attr('src') ||
					$('article img').first().attr('data-src') ||
					''
				).split('?')[0]
			) || '';

		let altTitle = '';
		$('.entry-content a, article a').each((_, a) => {
			const t = $(a).text().replace(/\s+/g, ' ').trim();
			const href = $(a).attr('href') || '';
			if (
				/[\u3040-\u30ff\u3400-\u9fff]/.test(t) &&
				(href.includes('kakuyomu') ||
					href.includes('syosetu') ||
					href.includes('ncode') ||
					t.length > 5)
			) {
				altTitle = t;
				return false;
			}
		});
		if (!altTitle) {
			const jp = $('.entry-content')
				.text()
				.match(/[\u3040-\u30ff\u3400-\u9fff][\u3040-\u30ff\u3400-\u9fff\s　]{4,80}/);
			if (jp) altTitle = jp[0].trim();
		}

		const authors: string[] = [];
		const authorMatch =
			$('.entry-content, article')
				.text()
				.match(/Author\s*[:：]\s*([^\n\r<]+)/i) ||
			$('body')
				.text()
				.match(/Author\s*[:：]\s*([^\n\r]+)/i);
		if (authorMatch) {
			const name = authorMatch[1]
				.replace(/\s+/g, ' ')
				.trim()
				.split(/[\|–\-]/)[0]
				.trim();
			if (name && name.length < 80) authors.push(name);
		}

		$('.entry-content a, article a').each((_, a) => {
			const prev = $(a).parent().text() || $(a).prev().text() || '';
			if (/author/i.test(prev) || /author/i.test($(a).parent().html() || '')) {
				const n = $(a).text().replace(/\s+/g, ' ').trim();
				if (n && n.length < 60 && !authors.includes(n)) authors.push(n);
			}
		});

		let description = '';
		const contentRoot = $('.entry-content, .page-content, article .entry-content').first();
		const synopsisHeader = contentRoot
			.find('h2, h3, p, strong')
			.filter((_, el) => /synopsis|summary|sinopsis/i.test($(el).text()))
			.first();
		if (synopsisHeader.length) {
			const parts: string[] = [];
			let node = synopsisHeader.next();
			while (node.length && !/table of content|toc|chapter list|episode\s+\d/i.test(node.text())) {
				const tag = (node.prop('tagName') || '').toLowerCase();
				if (tag === 'h2' || tag === 'h3') break;
				const t = node.text().replace(/\s+/g, ' ').trim();
				if (t && t.length > 20 && !/^author/i.test(t)) parts.push(t);
				node = node.next();
				if (parts.join(' ').length > 2000) break;
			}
			description = parts.join('\n\n');
		}
		if (!description) {
			const paras = contentRoot
				.find('p')
				.map((_, p) => $(p).text().replace(/\s+/g, ' ').trim())
				.get()
				.filter(
					(t) =>
						t.length > 40 &&
						!/^author/i.test(t) &&
						!/^episode\s+\d/i.test(t) &&
						!/table of content/i.test(t)
				);
			description = paras.slice(0, 8).join('\n\n');
		}

		let status = 'Ongoing';
		const bodyLower = $('body').text().toLowerCase();
		if (/completed|complete|tamat|完結/.test(bodyLower) && /caught.?up|completed series/i.test(bodyLower)) {
		}

		const genres: string[] = [];
		$('a[rel="tag"], .genre a, .tags a').each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (g && g.length < 40) genres.push(g);
		});

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		const seriesPath = path.replace(/\/$/, '');

		contentRoot.find('a[href]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const fullPath = pathOnly(href, this.baseUrl);
			if (!isChapterPath(fullPath) && !/\/episode-|\/volume-\d+-episode-/i.test(fullPath)) {
				return;
			}

			const series = seriesIdFromPath(fullPath);
			if (series !== seriesPath) return;

			const id = fullPath.startsWith('/') ? fullPath : `/${fullPath}`;
			if (seen.has(id)) return;
			seen.add(id);

			const rawTitle = $(a).text().replace(/\s+/g, ' ').trim() || id;
			let number = parseChapterNumber(id, 0);
			if (number <= 0) number = parseChapterNumber(rawTitle, 0);
			if (number <= 0) number = chapters.length + 1;

			const parentHtml = (($(a).parent().html() || '') + ' ' + ($(a).attr('class') || '')).toLowerCase();
			const isLocked =
				/\block\b|password|premium|patreon|ko-fi|paywall|members.?only|🔒|🔐/i.test(
					parentHtml + ' ' + rawTitle
				) ||
				$(a).find('.fa-lock, [class*="lock"], .dashicons-lock').length > 0 ||
				$(a).parent().find('.fa-lock, [class*="lock"]').length > 0;

			chapters.push({
				id,
				title: shortChapterTitle(number, rawTitle),
				number,
				...(isLocked ? { isLocked: true } : {})
			});
		});

		if (!chapters.length) {
			const slug = seriesPath.replace(/^\//, '');
			$(`a[href*="/${slug}/"]`).each((_, a) => {
				const href = $(a).attr('href') || '';
				const fullPath = pathOnly(href, this.baseUrl);
				if (!isChapterPath(fullPath)) return;
				const id = fullPath.startsWith('/') ? fullPath : `/${fullPath}`;
				if (seen.has(id)) return;
				seen.add(id);
				const rawTitle = $(a).text().replace(/\s+/g, ' ').trim() || id;
				let number = parseChapterNumber(id, 0);
				if (number <= 0) number = parseChapterNumber(rawTitle, 0);
				if (number <= 0) number = chapters.length + 1;
				chapters.push({
					id,
					title: shortChapterTitle(number, rawTitle),
					number
				});
			});
		}


		chapters.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
		const nums = chapters.map((c) => c.number);
		const hasDupes = nums.length !== new Set(nums).size;
		if (hasDupes) {
			chapters.forEach((c, i) => {
				c.number = i + 1;
				c.title = `Chapter ${i + 1}`;
			});
		}

		chapters.reverse();

		if (/caught.?up|completed/i.test($('title').text() + bodyLower.slice(0, 500))) {
		}

		const artists: string[] = [];

		console.log(
			`[mainichitl] details ${path} → ${chapters.length} chapters (${chapters.filter((c) => c.isLocked).length} locked)`
		);

		const details: MangaDetails & {
			altTitles?: string[];
			artists?: string[];
			release?: string;
		} = {
			id: path.replace(/\/$/, ''),
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

		if (altTitle) {
			(details as any).altTitles = [altTitle];
		}
		if (artists.length) {
			(details as any).artists = artists;
		}

		return details as MangaDetails;
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
		path = path.endsWith('/') ? path : `${path}/`;
		if (!path.startsWith('/')) path = `/${path}`;

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const bodyText = $('body').text().toLowerCase();
		const hasPasswordForm =
			$('input[type="password"], form[class*="password"], .password-note, .chapter-password')
				.length > 0;
		const contentProbe = $('.entry-content p, article .entry-content p').length;
		if (
			hasPasswordForm ||
			(/password|patreon|subscribers only|locked chapter|members only|ko-fi exclusive/i.test(
				bodyText
			) &&
				contentProbe < 3)
		) {
			throw new Error('Chapter is locked / premium on MainichiTL');
		}

		const rawTitle =
			$('h1.entry-title, h1.section-title, article h1, h1')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim()
				.replace(/\s*[–\-]\s*Mainichi TL.*$/i, '') ||
			$('meta[property="og:title"]')
				.attr('content')
				?.split(/\s*[|\-–]\s*/)[0]
				?.trim() ||
			'';

		let number = parseChapterNumber(path, 0);
		if (number <= 0) number = parseChapterNumber(rawTitle, 0);
		const title = shortChapterTitle(number > 0 ? number : 1, rawTitle);

		const contentEl = $('.entry-content, .post-content, article .entry-content').first();
		contentEl
			.find(
				'script, style, noscript, .ads, .ad, iframe, .code-block, .sharedaddy, .wp-block-separator, nav, .nav-links, .post-navigation, .comments-area, #comments, .entry-meta'
			)
			.remove();

		let contentHtml = contentEl.html() || '';
		contentHtml = contentHtml
			.replace(/<script[\s\S]*?<\/script>/gi, '')
			.replace(/<style[\s\S]*?<\/style>/gi, '')
			.replace(/on\w+="[^"]*"/gi, '')
			.replace(/<div class=['"]code-block[\s\S]*?<\/div>/gi, '')
			.trim();

		if (!contentHtml || contentHtml.replace(/<[^>]+>/g, '').trim().length < 40) {
			const paras = contentEl
				.find('p')
				.map((_, p) => $(p).text().trim())
				.get()
				.filter((t) => t.length > 5 && !/^\[TLN/i.test(t));
			if (paras.length) {
				contentHtml = paras.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
			}
		}

		contentHtml = contentHtml.replace(
			/^(\s*<p[^>]*>\s*<em>[^<]{10,200}<\/em>\s*<\/p>\s*)+/i,
			''
		);

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		const seriesSlug = seriesIdFromPath(path).replace(/^\//, '');
		const currentId = path.replace(/\/$/, '');

		$('a.wp-block-button__link, .wp-block-button a').each((_, a) => {
			const label = ($(a).text() || '').replace(/\s+/g, ' ').trim().toUpperCase();
			const href = $(a).attr('href') || '';
			const full = pathOnly(href, this.baseUrl);
			if (!isChapterPath(full)) return;
			if (!full.includes(`/${seriesSlug}/`)) return;
			const id = full.startsWith('/') ? full : `/${full}`;
			if (id === currentId) return;

			if (label === 'PREV' || label === 'PREVIOUS' || label === '← PREV') {
				prevChapterId = id;
			} else if (label === 'NEXT' || label === 'NEXT →' || label === 'NEXT»') {
				nextChapterId = id;
			}
		});

		if (!prevChapterId) {
			$('a[rel="prev"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const full = pathOnly(href, this.baseUrl);
				if (isChapterPath(full) && full.includes(`/${seriesSlug}/`)) {
					prevChapterId = full.startsWith('/') ? full : `/${full}`;
				}
			});
		}
		if (!nextChapterId) {
			$('a[rel="next"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const full = pathOnly(href, this.baseUrl);
				if (isChapterPath(full) && full.includes(`/${seriesSlug}/`)) {
					nextChapterId = full.startsWith('/') ? full : `/${full}`;
				}
			});
		}

		console.log(
			`[mainichitl] chapter ${path} → content=${contentHtml.length} chars prev=${prevChapterId} next=${nextChapterId}`
		);

		return {
			title,
			content: contentHtml || '<p>No content</p>',
			prevChapterId,
			nextChapterId
		};
	}
}

export default MainichiTLSource;
