/**
 * RaysVault.com — custom WP + Elementor novel site
 * https://raysvault.com/
 *
 * Path: scraper/src/sources/impl/novel/RaysVault.ts
 *
 * URL pattern:
 *   Latest   : /  (.rv-latest-updates .rv-novel-card)
 *   Series   : /category/novel/{slug}/
 *   Chapters : /category/novel/{slug}/page/{n}/  (Elementor posts)
 *   Chapter  : /novel/{slug}/chapter-{n}-.../
 *   Search   : /?s={q}
 *
 * BaseSource.fetchHtml → fetchWithCf (CF-aware)
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';
import { fetchWithCf } from '../../../lib/fetchWithCf';

const BASE = 'https://raysvault.com';
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

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function parseChapterNumber(text: string, fallback = 0): number {
	const t = cleanText(text);
	if (!t) return fallback;
	const m =
		t.match(/chapter\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\bch\.?\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\/chapter-(\d+(?:\.\d+)?)/i) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function extractChapterNum(text: string): number | undefined {
	const n = parseChapterNumber(text, NaN);
	return Number.isNaN(n) ? undefined : n;
}

function isSeriesPath(path: string): boolean {
	const p = path.replace(/\/$/, '');
	return /^\/category\/novel\/[^/]+$/.test(p) && !/\/(page|feed)$/i.test(p);
}

function isChapterPath(path: string): boolean {
	const p = path.replace(/\/$/, '');
	return /^\/novel\/[^/]+\/chapter-[^/]+$/i.test(p);
}

function slugFromSeriesPath(path: string): string {
	const m = path.replace(/\/$/, '').match(/^\/category\/novel\/([^/]+)$/);
	return m ? m[1] : path.replace(/^\/+|\/+$/g, '');
}

export class RaysVaultSource extends BaseSource {
	id = 'raysvault';
	name = "Ray's Vault";
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		return fetchWithCf(url, {
			headers: {
				...this.headers,
				Referer: this.baseUrl
			}
		});
	}

	async getLatestManga(page = 1): Promise<Manga[]> {
		if (page <= 1) {
			const home = await this.parseHomeLatest();
			if (home.length) return home.slice(0, PER_PAGE);
		}
		if (page > 1) return [];
		return this.parseHomeLatest();
	}

	private dedupeById(items: Manga[]): Manga[] {
		const seen = new Set<string>();
		const out: Manga[] = [];
		for (const m of items) {
			if (!m.id || seen.has(m.id)) continue;
			seen.add(m.id);
			out.push(m);
		}
		return out;
	}

	private async parseHomeLatest(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('.rv-novel-card, .rv-updates-grid .rv-novel-card').each((_, el) => {
			const a = $(el)
				.find('a.rv-cover-link, a.rv-novel-title, a[href*="/category/novel/"]')
				.filter((_, x) => isSeriesPath(pathOnly($(x).attr('href') || '')))
				.first();
			const href = a.attr('href') || '';
			const id = pathOnly(href);
			if (!isSeriesPath(id) || seen.has(id)) return;

			const title =
				cleanText(a.attr('title') || '') ||
				cleanText($(el).find('.rv-novel-title, h3, h2').first().text()) ||
				cleanText($(el).find('img').attr('alt') || '') ||
				cleanText(a.text());
			if (!title || title.length < 2) return;

			const cover =
				$(el).find('img.rv-cover-image, img').first().attr('src') ||
				$(el).find('img').first().attr('data-src') ||
				'';

			const chHref =
				$(el).find('.rv-chapter-list a[href*="/novel/"]').first().attr('href') ||
				$(el).find('a[href*="/chapter-"]').first().attr('href') ||
				'';
			const chText =
				$(el).find('.rv-chapter-list a').first().text() ||
				chHref ||
				'';
			const latestChapter =
				extractChapterNum(chText) ?? extractChapterNum(pathOnly(chHref));

			seen.add(id);
			list.push({
				id,
				title: title.slice(0, 200),
				cover: absUrl((cover || '').split('?')[0]),
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				...(latestChapter != null ? { latestChapter } : {})
			});
		});

		if (list.length < 5) {
			$('a[href*="/category/novel/"]').each((_, el) => {
				const href = $(el).attr('href') || '';
				const id = pathOnly(href);
				if (!isSeriesPath(id) || seen.has(id)) return;
				const title =
					cleanText($(el).attr('title') || '') ||
					cleanText($(el).find('img').attr('alt') || '') ||
					cleanText($(el).text());
				if (!title || title.length < 2) return;
				const parent = $(el).closest('.rv-novel-card, div, article, li');
				const cover =
					parent.find('img').attr('src') ||
					$(el).find('img').attr('src') ||
					'';
				const chHref = parent.find('a[href*="/chapter-"]').first().attr('href') || '';
				const latestChapter = extractChapterNum(chHref);
				seen.add(id);
				list.push({
					id,
					title: title.slice(0, 200),
					cover: absUrl((cover || '').split('?')[0]),
					sourceId: this.id,
					type: 'novel',
					lang: 'en',
					...(latestChapter != null ? { latestChapter } : {})
				});
			});
		}

		return this.dedupeById(list);
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page ?? 1);
		if (!q) return this.getLatestManga(page);

		const path =
			page <= 1
				? `/?s=${encodeURIComponent(q)}`
				: `/page/${page}/?s=${encodeURIComponent(q)}`;
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('.rv-novel-card, article, .elementor-post').each((_, el) => {
			const a = $(el)
				.find('a[href*="/category/novel/"]')
				.filter((_, x) => isSeriesPath(pathOnly($(x).attr('href') || '')))
				.first();
			const href = a.attr('href') || '';
			const id = pathOnly(href);
			if (!isSeriesPath(id) || seen.has(id)) return;
			const title =
				cleanText(a.attr('title') || '') ||
				cleanText($(el).find('h2, h3, .rv-novel-title').first().text()) ||
				cleanText(a.text());
			if (!title || title.length < 2) return;
			const cover =
				$(el).find('img').first().attr('src') ||
				$(el).find('img').first().attr('data-src') ||
				'';
			seen.add(id);
			list.push({
				id,
				title: title.slice(0, 200),
				cover: absUrl((cover || '').split('?')[0]),
				sourceId: this.id,
				type: 'novel',
				lang: 'en'
			});
		});

		if (!list.length) {
			$('a[href*="/category/novel/"]').each((_, el) => {
				const id = pathOnly($(el).attr('href') || '');
				if (!isSeriesPath(id) || seen.has(id)) return;
				const title =
					cleanText($(el).attr('title') || '') ||
					cleanText($(el).text());
				if (!title || title.length < 2) return;
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

		return this.dedupeById(list);
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = pathOnly(mangaId);
		if (!path.startsWith('/category/novel/')) {
			const slug = path.replace(/^\/+/, '').replace(/^category\/novel\//, '');
			path = `/category/novel/${slug}`;
		}
		path = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			cleanText($('.elementor-heading-title').first().text()) ||
			cleanText($('h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '')
				.split(/\s*[|\-–]\s*/)[0]
				.trim() ||
			slugFromSeriesPath(pathOnly(path)).replace(/-/g, ' ');

		const isJunkCover = (src: string) =>
			!src ||
			/lockup|logo|patreon|cropped-default|emoji|avatar|icon|button/i.test(src);

		let cover = '';
		$('img').each((_, img) => {
			if (cover) return;
			const src =
				$(img).attr('src') ||
				$(img).attr('data-src') ||
				$(img).attr('data-lazy-src') ||
				'';
			if (!/wp-content\/uploads/i.test(src)) return;
			if (isJunkCover(src)) return;
			cover = src;
		});
		if (!cover) {
			const og = $('meta[property="og:image"]').attr('content') || '';
			if (og && !isJunkCover(og)) cover = og;
		}
		cover = absUrl((cover || '').split('?')[0]);

		let description =
			cleanText($('meta[name="description"]').attr('content') || '') ||
			cleanText($('.elementor-widget-text-editor, .entry-content, .elementor-post__excerpt').first().text()) ||
			'';
		if (description.length > 4000) description = description.slice(0, 4000) + '…';

		const authors: string[] = [];
		$('a[href*="/author/"], .author a, .elementor-post-info__item--type-author a').each((_, a) => {
			const n = cleanText($(a).text());
			if (!n || n.length >= 80) return;
			if (/^\d+$/.test(n)) return;
			if (!authors.includes(n)) authors.push(n);
		});

		const genres: string[] = [];
		$('a[href*="/genre/"], a[href*="/tag/"], .elementor-post-info__terms-list a').each((_, a) => {
			const g = cleanText($(a).text());
			if (g && g.length < 40 && !/^\d+$/.test(g) && !genres.includes(g)) genres.push(g);
		});

		const chapters = await this.collectAllChapters(pathOnly(path));

		let updatedAt: number | undefined;
		const lastCh = chapters.length ? chapters[chapters.length - 1] : undefined;
		if (lastCh?.date) {
			const ts = Date.parse(lastCh.date);
			if (!Number.isNaN(ts)) updatedAt = ts;
		}

		return {
			id: pathOnly(path),
			title: title.slice(0, 200),
			cover,
			description,
			authors,
			genres,
			status: 'Ongoing',
			type: 'novel',
			sourceId: this.id,
			lang: 'en',
			chapters,
			...(updatedAt != null ? { updatedAt } : {}),
			...(lastCh ? { latestChapter: lastCh.number } : {})
		};
	}

	private async collectAllChapters(seriesPath: string): Promise<Chapter[]> {
		const base = seriesPath.endsWith('/') ? seriesPath : `${seriesPath}/`;
		const seen = new Set<string>();
		const out: Chapter[] = [];

		const parsePage = (html: string) => {
			const $ = cheerio.load(html);
			$('a[href*="/novel/"][href*="/chapter-"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const id = pathOnly(href);
				if (!isChapterPath(id) || seen.has(id)) return;
				seen.add(id);
				const rawTitle = cleanText($(a).text());
				const number = parseChapterNumber(rawTitle || id, 0);
				out.push({
					id,
					title: number > 0 ? `Chapter ${number}` : rawTitle || 'Chapter',
					number: number || out.length + 1,
				});
			});
	
			$('article.elementor-post a[href*="/chapter-"], .elementor-post__title a').each((_, a) => {
				const href = $(a).attr('href') || '';
				const id = pathOnly(href);
				if (!isChapterPath(id) || seen.has(id)) return;
				seen.add(id);
				const rawTitle = cleanText($(a).text());
				const number = parseChapterNumber(rawTitle || id, 0);
				out.push({
					id,
					title: number > 0 ? `Chapter ${number}` : rawTitle || 'Chapter',
					number: number || out.length + 1,
				});
			});
		};

		const firstHtml = await this.fetchHtml(base);
		parsePage(firstHtml);

		const $first = cheerio.load(firstHtml);
		let maxPage = 1;
		$first('a[href*="/page/"]').each((_, a) => {
			const href = $first(a).attr('href') || '';
			const m = href.match(/\/page\/(\d+)/);
			if (m) maxPage = Math.max(maxPage, parseInt(m[1], 10));
		});
		maxPage = Math.min(maxPage, 40);

		const jobs: Promise<void>[] = [];
		for (let p = 2; p <= maxPage; p++) {
			jobs.push(
				this.fetchHtml(`${base}page/${p}/`)
					.then((html) => parsePage(html))
					.catch(() => undefined)
			);
		}
		if (jobs.length) await Promise.all(jobs);

		out.sort((a, b) => (a.number || 0) - (b.number || 0));
		return out;
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
		const path = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const title =
			cleanText($('h1.entry-title, h1.elementor-heading-title, h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '')
				.split(/\s*[|\-–]\s*/)[0]
				.trim() ||
			'Chapter';

		const bodyText = cleanText($('body').text());
		if (
			(/members? only|early access|login to (read|continue)|become a (member|patron)/i.test(bodyText) ||
				$('.rv-login-notice, .members-only, .paid-content').length > 0) &&
			$('.elementor-widget-theme-post-content p').length < 3
		) {
			throw new Error('Chapter is locked / members-only');
		}

		const contentRoot = $(
			'.elementor-widget-theme-post-content .elementor-widget-container, .elementor-widget-theme-post-content, .entry-content, .post-content, article .elementor-widget-text-editor'
		).first();

		const clone = contentRoot.clone();
		clone
			.find(
				'script, style, noscript, iframe, nav, .sharedaddy, .wpdiscuz, .comments-area, .elementor-location-header, .elementor-location-footer'
			)
			.remove();

		const parts: string[] = [];
		clone.find('p').each((_, p) => {
			const t = cleanText($(p).text());
			if (!t || t.length < 2) return;
			if (/^(prev|next|share|support|comment|login|register|patreon)/i.test(t) && t.length < 50) return;
			parts.push(`<p>${escapeHtml(t)}</p>`);
		});

		let content = parts.join('\n');
		if (!content || content.length < 40) {
			const raw = cleanText(clone.text());
			if (raw.length > 40) {
				content = raw
					.split(/\n\s*\n/)
					.map((s) => cleanText(s))
					.filter((s) => s.length > 2)
					.map((s) => `<p>${escapeHtml(s)}</p>`)
					.join('\n');
			}
		}

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		$('a[rel="prev"], a[rel="next"], a').each((_, a) => {
			const href = $(a).attr('href') || '';
			const id = pathOnly(href);
			if (!isChapterPath(id)) return;
			const text = cleanText($(a).text() || $(a).attr('title') || '').toLowerCase();
			const rel = ($(a).attr('rel') || '').toLowerCase();
			if (rel === 'prev' || /prev|previous|older/i.test(text)) prevChapterId = id;
			if (rel === 'next' || /next|newer/i.test(text)) nextChapterId = id;
		});

		if (!prevChapterId || !nextChapterId) {
			const m = pathOnly(path).match(/^(.*\/chapter-)(\d+)(.*)$/i);
			if (m) {
				const n = parseInt(m[2], 10);
				if (!prevChapterId && n > 1) {
					prevChapterId = `${m[1]}${n - 1}${m[3] || ''}`.replace(/\/$/, '');
				}
				if (!nextChapterId) {
					nextChapterId = `${m[1]}${n + 1}${m[3] || ''}`.replace(/\/$/, '');
				}
			}
		}

		return {
			title,
			content:
				content ||
				'<p><em>Empty content — chapter may be locked or selector changed.</em></p>',
			prevChapterId,
			nextChapterId
		};
	}
}

export default RaysVaultSource;
