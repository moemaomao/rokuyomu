/**
 * SkyNovel Vault — https://skynovelvault.com/
 * Custom WP theme (bukan Madara/Themesia)
 *
 * Series  : /category/{genre}/{slug}/   (+ /page/{n}/)
 * Chapter : /chapter-{n}-{title-slug}/
 * Latest  : homepage .sn-update-card + .sn-home-vault-card
 * Search  : /?s={q}
 *
 * Catatan: chapter baru sering VIP / Spirit Stone Exclusive.
 * Chapter free (awal) bisa dibaca normal.
 *
 * Path: scraper/src/sources/impl/novel/SkyNovelVault.ts
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types-manga';

const BASE = 'https://skynovelvault.com';
const PER_PAGE = 24;

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
		.replace(/\s+/g, ' ')
		.trim();
}

function parseChapterNumber(text: string, fallback = 0): number {
	const t = cleanText(text);
	const m =
		t.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\/chapter-(\d+)/i) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function shortChapterTitle(number: number): string {
	return number > 0 ? `Chapter ${number}` : 'Chapter';
}

/** /category/cultivation/mortal-bones → series id */
function seriesPathFromHref(href: string): string | null {
	const id = pathOnly(href);
	// /category/{genre}/{slug}
	const m = id.match(/^\/category\/([^/]+)\/([^/]+)\/?$/i);
	if (m) {
		const genre = m[1].toLowerCase();
		if (['latest-news', 'cultivation-basics', 'uncategorized'].includes(genre)) return null;
		return `/category/${m[1]}/${m[2]}`;
	}
	return null;
}

function normalizeStatus(raw: string): string {
	const v = (raw || '').toLowerCase();
	if (/complet|finish|end|tamat/i.test(v)) return 'Completed';
	if (/hiatus|on[\s-]?hold/i.test(v)) return 'Hiatus';
	if (/drop|cancel/i.test(v)) return 'Dropped';
	if (/ongoing|updating|active/i.test(v)) return 'Ongoing';
	return raw ? cleanText(raw) : 'Ongoing';
}

export class SkyNovelVaultSource extends BaseSource {
	id = 'skynovelvault';
	name = 'SkyNovel Vault';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	// ─── Latest ──────────────────────────────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		if (page <= 1) {
			const fromHome = await this.parseHomepage().catch(() => [] as Manga[]);
			if (fromHome.length >= 6) return fromHome.slice(0, PER_PAGE);
		}
		// Page 2+: scrap vault / cultivation library pages
		return this.parseCatalog(page);
	}

	/** Homepage: Latest Updates + vault cards */
	private async parseHomepage(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		const $ = cheerio.load(html);
		$('script, style, noscript, iframe').remove();

		const list: Manga[] = [];
		const seen = new Set<string>();

		// 1) Latest Updates — .sn-update-card
		$('.sn-update-card').each((_, el) => {
			const root = $(el);
			const seriesA = root.find('.sn-update-title a, a.sn-update-cover').first();
			const seriesId = seriesPathFromHref(seriesA.attr('href') || '');
			if (!seriesId || seen.has(seriesId)) return;

			const title =
				cleanText(seriesA.attr('title') || '') ||
				cleanText(root.find('.sn-update-title').text()) ||
				cleanText(seriesA.text());
			if (!title || title.length < 2) return;

			const img =
				root.find('img').first().attr('data-src') ||
				root.find('img').first().attr('src') ||
				'';

			let latestChapter: number | undefined;
			const chA = root.find('a.sn-update-chapter').first();
			if (chA.length) {
				const n =
					parseChapterNumber(cleanText(chA.attr('title') || chA.text())) ||
					parseChapterNumber(pathOnly(chA.attr('href') || ''));
				if (n > 0) latestChapter = n;
			}
			// batch text: "30-chapter batch: Ch. 951-980"
			if (latestChapter == null) {
				const batch = cleanText(root.find('.sn-update-batch').text());
				const m = batch.match(/ch\.?\s*(\d+)\s*[-–]\s*(\d+)/i);
				if (m) latestChapter = parseFloat(m[2]);
			}

			seen.add(seriesId);
			list.push({
				id: seriesId,
				title: title.slice(0, 200),
				cover: absUrl((img || '').split('?')[0]),
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				...(latestChapter != null ? { latestChapter } : {})
			});
		});

		// 2) Vault / book cards — lebih banyak judul
		$('.sn-home-vault-card, .sn-book-card').each((_, el) => {
			const root = $(el);
			const a = root.find('a.sn-cover-wrap, a[href*="/category/"]').first();
			const seriesId = seriesPathFromHref(a.attr('href') || '');
			if (!seriesId || seen.has(seriesId)) return;

			const title =
				cleanText(root.find('.sn-title').text()) ||
				cleanText(a.attr('title') || '') ||
				cleanText(root.find('img').attr('alt') || '') ||
				cleanText(a.text());
			if (!title || title.length < 2) return;

			const img =
				root.find('img').first().attr('data-src') ||
				root.find('img').first().attr('src') ||
				'';

			// meta: "2,070 Chapters (606 Free)"
			let latestChapter: number | undefined;
			const meta = cleanText(root.find('.sn-meta, .sn-home-vault-metrics').text());
			const m = meta.match(/([\d,]+)\s*chapters?/i);
			if (m) {
				const n = parseFloat(m[1].replace(/,/g, ''));
				if (n > 0) latestChapter = n;
			}

			let status: string | undefined;
			if (root.find('.sn-badge-completed, [class*="completed"]').length) {
				status = 'Completed';
			}

			seen.add(seriesId);
			list.push({
				id: seriesId,
				title: title.slice(0, 200),
				cover: absUrl((img || '').split('?')[0]),
				sourceId: this.id,
				type: 'novel',
				status,
				lang: 'en',
				...(latestChapter != null ? { latestChapter } : {})
			});
		});

		return list;
	}

	/** Catalog fallback: /category/cultivation/ page N */
	private async parseCatalog(page: number): Promise<Manga[]> {
		// cultivation library is the main catalog; page via WP
		const path =
			page <= 1
				? '/category/cultivation/'
				: `/category/cultivation/page/${page}/`;
		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list: Manga[] = [];
			const seen = new Set<string>();

			$('.sn-book-card, .sn-home-vault-card, article').each((_, el) => {
				const root = $(el);
				const a = root
					.find('a[href*="/category/"]')
					.filter((__, link) => !!seriesPathFromHref($(link).attr('href') || ''))
					.first();
				const seriesId = seriesPathFromHref(a.attr('href') || '');
				if (!seriesId || seen.has(seriesId)) return;

				const title =
					cleanText(root.find('.sn-title, h2, h3').first().text()) ||
					cleanText(a.attr('title') || '') ||
					cleanText(a.text());
				if (!title || title.length < 2) return;

				const img =
					root.find('img').first().attr('data-src') ||
					root.find('img').first().attr('src') ||
					'';

				seen.add(seriesId);
				list.push({
					id: seriesId,
					title: title.slice(0, 200),
					cover: absUrl((img || '').split('?')[0]),
					sourceId: this.id,
					type: 'novel',
					lang: 'en'
				});
			});

			// fallback links
			if (list.length < 4) {
				$('a[href*="/category/"]').each((_, a) => {
					const seriesId = seriesPathFromHref($(a).attr('href') || '');
					if (!seriesId || seen.has(seriesId)) return;
					const title = cleanText($(a).attr('title') || $(a).text());
					if (!title || title.length < 2) return;
					seen.add(seriesId);
					list.push({
						id: seriesId,
						title: title.slice(0, 200),
						cover: '',
						sourceId: this.id,
						type: 'novel',
						lang: 'en'
					});
				});
			}

			return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[skynovelvault] catalog', page, e);
			return [];
		}
	}

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page ?? 1);
		if (!q) return this.getLatestManga(page);

		const path =
			page <= 1
				? `/?s=${encodeURIComponent(q)}`
				: `/page/${page}/?s=${encodeURIComponent(q)}`;

		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list: Manga[] = [];
			const seen = new Set<string>();

			$('a[href*="/category/"]').each((_, a) => {
				const seriesId = seriesPathFromHref($(a).attr('href') || '');
				if (!seriesId || seen.has(seriesId)) return;
				const title = cleanText($(a).attr('title') || $(a).text());
				if (!title || title.length < 2) return;
				const parent = $(a).closest('article, .sn-book-card, li, div');
				const img =
					parent.find('img').first().attr('data-src') ||
					parent.find('img').first().attr('src') ||
					'';
				seen.add(seriesId);
				list.push({
					id: seriesId,
					title: title.slice(0, 200),
					cover: absUrl((img || '').split('?')[0]),
					sourceId: this.id,
					type: 'novel',
					lang: 'en'
				});
			});

			return list;
		} catch (e) {
			console.error('[skynovelvault] search', e);
			return [];
		}
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = pathOnly(mangaId);
		if (!path.startsWith('/category/')) {
			path = `/category/cultivation/${path.replace(/^\//, '')}`;
		}
		path = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);
		$('script, style, noscript, iframe').remove();

		const title =
			cleanText($('h1.entry-title, h1, .page-title').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '')
				.split(/\s*[|\-–]\s*/)[0]
				.trim() ||
			'';

		if (!title || title.length < 2) {
			throw new Error('Novel not found (empty title)');
		}

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('.sn-cover img, .post-thumb img, img.wp-post-image').first().attr('data-src') ||
			$('.sn-cover img, .post-thumb img, img.wp-post-image').first().attr('src') ||
			'';
		cover = absUrl((cover || '').split('?')[0]);

		// Introduction / synopsis
		let description =
			cleanText($('.sn-novel-panel').first().text()) ||
			cleanText($('.term-description, .category-description').first().text()) ||
			cleanText($('meta[name="description"]').attr('content') || '') ||
			'';
		// trim "Introduction" prefix
		description = description.replace(/^Introduction\s*/i, '');
		if (description.length > 4000) description = description.slice(0, 4000) + '…';

		const authors: string[] = [];
		const genres: string[] = [];
		let status = 'Ongoing';

		// Tags / genres dari link
		$('a[href*="/tag/"], a[rel="tag"]').each((_, a) => {
			const g = cleanText($(a).text());
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});
		// category parent as genre (cultivation / apocalypse)
		const pathParts = path.split('/').filter(Boolean);
		if (pathParts[1] && !genres.map((g) => g.toLowerCase()).includes(pathParts[1])) {
			genres.unshift(pathParts[1].replace(/-/g, ' '));
		}

		if ($('.sn-badge-completed, [class*="completed"]').length) {
			status = 'Completed';
		}

		// Chapters — .hentry posts (free list, paginated)
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		const collectChapters = ($page: cheerio.CheerioAPI) => {
			$page('a[href*="/chapter-"]').each((_, a) => {
				const href = $page(a).attr('href') || '';
				const id = pathOnly(href);
				if (!id || seen.has(id) || !/\/chapter-\d+/i.test(id)) return;
				seen.add(id);

				const number = parseChapterNumber(
					cleanText($page(a).attr('title') || $page(a).text()) || id
				);
				chapters.push({
					id,
					title: shortChapterTitle(number > 0 ? number : 0),
					number: number > 0 ? number : chapters.length + 1
				});
			});
		};

		collectChapters($);

		// Fetch extra chapter pages (max 5 pages ≈ 500 free chapters)
		const lastPageLink = $('a.page-numbers, .pagination a, .nav-links a')
			.filter((_, a) => /^\d+$/.test(cleanText($(a).text())))
			.last();
		let maxPage = 1;
		if (lastPageLink.length) {
			const n = parseInt(cleanText(lastPageLink.text()), 10);
			if (n > 1) maxPage = Math.min(n, 5);
		} else {
			// coba deteksi "page/10/"
			$('a[href*="/page/"]').each((_, a) => {
				const m = ($(a).attr('href') || '').match(/\/page\/(\d+)/);
				if (m) maxPage = Math.max(maxPage, Math.min(parseInt(m[1], 10), 5));
			});
		}

		if (maxPage > 1) {
			const baseSeries = path.replace(/\/$/, '');
			for (let p = 2; p <= maxPage; p++) {
				try {
					const pageHtml = await this.fetchHtml(`${baseSeries}/page/${p}/`);
					const $p = cheerio.load(pageHtml);
					collectChapters($p);
				} catch {
					break;
				}
			}
		}

		chapters.sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
		const latestChapter = chapters.length > 0 ? chapters[0].number : undefined;

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
			...(latestChapter != null ? { latestChapter } : {})
		};
	}

	// ─── Chapter ─────────────────────────────────────────────────────────

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		let path = String(chapterId || '').trim();
		if (!path.startsWith('/')) path = `/${path}`;
		path = pathOnly(path);
		if (!path || path === '/') throw new Error('Invalid chapterId');

		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const rawTitle =
			cleanText($('h1.entry-title, h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '') ||
			'Chapter';
		const number = parseChapterNumber(rawTitle || path);
		const title = shortChapterTitle(number > 0 ? number : 0) || rawTitle;

		// VIP / Spirit Stone lock
		const bodyText = $('body').text();
		const isLocked =
			/permanently unlock it using/i.test(bodyText) ||
			(/Spirit Stone Exclusive/i.test(bodyText) &&
				/Unlock Current Chapter/i.test(bodyText));

		const contentEl = $('.entry-content').first();
		if (!contentEl.length) {
			throw new Error(`Chapter content not found: ${path}`);
		}

		contentEl
			.find(
				'script, style, noscript, iframe, .ads, .ad, .code-block, nav, .sharedaddy, .misc, .socials, .wp-block-buttons, form'
			)
			.remove();

		// Strip inline color/background
		let content = contentEl.html() || '';
		content = content
			.replace(/\s*style="([^"]*)"/gi, (_m, style: string) => {
				const cleaned = String(style)
					.replace(/color\s*:\s*[^;]+;?/gi, '')
					.replace(/background(-color)?\s*:\s*[^;]+;?/gi, '')
					.trim()
					.replace(/;\s*;/g, ';')
					.replace(/^;|;$/g, '');
				return cleaned ? ` style="${cleaned}"` : '';
			})
			.trim();

		// Hapus chrome di awal (menu novel, font controls, dll)
		content = content
			.replace(/☰[\s\S]{0,80}?Chapter\s+\d+[^\n<]*/i, '')
			.replace(/Advertisement/gi, '')
			.trim();

		const textLen = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;

		if (isLocked && textLen < 200) {
			content =
				'<p><em>This chapter is locked (VIP / Spirit Stone Exclusive on SkyNovel Vault). Open the original site and unlock it, or read free earlier chapters.</em></p>';
		} else if (textLen < 40) {
			throw new Error(`Chapter empty: ${path}`);
		}

		// Next / Prev
		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		const prevA = $('a[rel="prev"]').first();
		const nextA = $('a[rel="next"]').first();
		if (prevA.length) prevChapterId = pathOnly(prevA.attr('href') || '');
		if (nextA.length) nextChapterId = pathOnly(nextA.attr('href') || '');

		return {
			title,
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default SkyNovelVaultSource;
