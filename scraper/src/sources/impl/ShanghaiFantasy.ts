/**
 * Shanghai Fantasy (shanghaifantasy.com)
 * Novel translation — WP + Fictioneer-like
 *
 * WAJIB hybrid Worker (Cloudflare sangat ketat).
 *
 * - Filter ketat path/title → nav/footer (Discord, Login, Privacy) tidak masuk
 * - Chapter title hanya "Chapter N"
 * - Cover kosong dari latest-chapters diisi ulang dari card/library
 * - Decode HTML entities (&#8217; → ')
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types';

const BLOCKED_PATH =
	/\/(library|genre|tag|author|page|wp-|category|about|forum|patreon|discord|recruitment|login|sign-?up|contact|privacy|terms|tos|search|home|feed|rss|sitemap|cart|checkout|account|profile|membership|support|ko-fi|kofi)(\/|$)/i;

const BLOCKED_TITLE =
	/^(discord|recruitment|login|sign\s*up|contact(\s*us)?|privacy|terms(\s*of\s*service)?|tos|library|search|home|about|forum|patreon|ko-?fi|view more|clear selected|sorted by|total results|all types|ongoing|completed|hiatus)$/i;

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
				: `https://shanghaifantasy.com${href.startsWith('/') ? '' : '/'}${href}`
		);
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		return href.startsWith('/') ? href : `/${href}`;
	}
}

/** Path valid novel: slug panjang, bukan nav/utility */
function isNovelPath(p: string): boolean {
	if (!p || p === '/' || p.length < 8) return false;
	if (BLOCKED_PATH.test(p)) return false;
	if (/-chapter[-_]?\d/i.test(p) || /\/chapter[-_]?\d/i.test(p)) return false;
	const slug = p.replace(/^\//, '');
	if (!/[a-z]/i.test(slug)) return false;
	if (/^(page|post|posts|novel|novels|series)\d*$/i.test(slug)) return false;
	return true;
}

function isValidTitle(title: string): boolean {
	const t = title.replace(/\s+/g, ' ').trim();
	if (!t || t.length < 4) return false;
	if (BLOCKED_TITLE.test(t)) return false;
	if (/^(ongoing|completed|hiatus|novel|manga|manhwa)$/i.test(t)) return false;
	return true;
}

function decodeEntities(s: string): string {
	return s
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&nbsp;/g, ' ');
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function parseChapterNumber(title: string, fallback: number): number {
	const m =
		title.match(/chapter\s*(\d+(?:\.\d+)?)/i) ||
		title.match(/\bch\.?\s*(\d+(?:\.\d+)?)/i) ||
		title.match(/(\d+(?:\.\d+)?)/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function extractChapterNum(text: string): number | undefined {
	const t = (text || '').replace(/\s+/g, ' ').trim();
	if (!t) return undefined;
	const m =
		t.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/(\d+(?:\.\d+)?)/);
	if (!m) return undefined;
	const n = parseFloat(m[1]);
	return Number.isNaN(n) ? undefined : n;
}

/** Judul chapter pendek: "Chapter 52" */
function shortChapterTitle(raw: string, num: number): string {
	const n = Number.isFinite(num) && num > 0 ? num : parseChapterNumber(raw, 0);
	if (n > 0) return `Chapter ${n}`;
	const m = raw.match(/chapter\s*(\d+(?:\.\d+)?)/i);
	if (m) return `Chapter ${m[1]}`;
	return decodeEntities(raw).slice(0, 40);
}

/** Dari URL chapter → path novel (buang -chapter-N...) */
function novelPathFromChapter(href: string): string | null {
	const p = pathOnly(href);
	const m = p.match(/^(.+?)-chapter[-_]?\d/i);
	if (m && m[1].length >= 8) return m[1];
	const m2 = p.match(/^(.+?)[-_](\d+)(?:[-_].*)?$/);
	if (m2 && m2[1].length >= 6 && !BLOCKED_PATH.test(m2[1])) {
		if (/^\d+$/.test(m2[2]) && parseInt(m2[2], 10) < 5000) {
			return m2[1];
		}
	}
	return null;
}

export class ShanghaiFantasySource extends BaseSource {
	id = 'shanghaifantasy';
	name = 'Shanghai Fantasy';
	baseUrl = 'https://shanghaifantasy.com';

	private assertNotCf(html: string): void {
		const low = html.slice(0, 3000).toLowerCase();
		if (
			(low.includes('just a moment') ||
				low.includes('cf-browser-verification') ||
				low.includes('challenge-platform') ||
				low.includes('verify you are human')) &&
			html.length < 25000
		) {
			throw new Error('Cloudflare blocked this request');
		}
	}

	async getLatestManga(page = 1): Promise<Manga[]> {
		if (page <= 1) {
			const [fromChapters, fromCards, fromLib] = await Promise.all([
				this.parseLatestFromChapters().catch(() => [] as Manga[]),
				this.parseHomeNovelCards().catch(() => [] as Manga[]),
				this.fetchLibrary(1).catch(() => [] as Manga[])
			]);

			// Cover map dari sumber yang punya gambar
			const coverMap = new Map<string, string>();
			for (const m of [...fromCards, ...fromLib]) {
				if (m.cover) coverMap.set(m.id, m.cover);
			}

			const merged = this.dedupeById([...fromChapters, ...fromCards, ...fromLib]);
			for (const m of merged) {
				if (!m.cover && coverMap.has(m.id)) {
					m.cover = coverMap.get(m.id)!;
				}
			}
			return merged.slice(0, 24);
		}
		return this.fetchLibrary(page);
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

	/** Utama: blok "Latest Chapters" di homepage */
	private async parseLatestFromChapters(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		this.assertNotCf(html);
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('a[href]').each((_, el) => {
			const href = $(el).attr('href') || '';
			if (!href || !/chapter/i.test(href)) return;

			const fullTitle = decodeEntities(
				($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim()
			);
			if (!fullTitle || fullTitle.length < 8) return;
			if (!/chapter\s*\d/i.test(fullTitle) && !/-chapter-/i.test(href)) return;

			const novelPath = novelPathFromChapter(href);
			if (!novelPath || !isNovelPath(novelPath) || seen.has(novelPath)) return;
			seen.add(novelPath);

			const novelTitle = decodeEntities(
				fullTitle
					.replace(/\s*[|–—-]\s*Chapter\s+\d+.*$/i, '')
					.replace(/\s+Chapter\s+\d+.*$/i, '')
					.replace(/\s+Ch\.?\s*\d+.*$/i, '')
					.trim()
			);
			if (!isValidTitle(novelTitle)) return;

			const latestChapter = extractChapterNum(fullTitle);

			list.push({
				id: novelPath,
				title: novelTitle,
				cover: '',
				sourceId: this.id,
				type: 'novel',
				status: 'Ongoing',
				lang: 'en',
				...(latestChapter != null ? { latestChapter } : {})
			});
		});

		return list;
	}

	/** Card novel di homepage — wajib ada cover image */
	private async parseHomeNovelCards(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		this.assertNotCf(html);
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('a[href]').each((_, el) => {
			const href = $(el).attr('href') || '';
			const p = pathOnly(href);
			if (!isNovelPath(p) || seen.has(p)) return;

			const $a = $(el);
			const img =
				$a.find('img').attr('data-src') ||
				$a.find('img').attr('src') ||
				$a.closest('article, .card, div').find('img').first().attr('data-src') ||
				$a.closest('article, .card, div').find('img').first().attr('src') ||
				'';

			if (!img || img.startsWith('data:') || /placeholder|avatar|logo|icon/i.test(img)) {
				return;
			}

			const title =
				$a.attr('title') ||
				$a.find('img').attr('alt') ||
				$a.find('h2, h3, .title, span').first().text() ||
				$a.text();
			const cleanTitle = decodeEntities((title || '').replace(/\s+/g, ' ').trim());
			if (!isValidTitle(cleanTitle)) return;

			seen.add(p);
			list.push({
				id: p,
				title: cleanTitle,
				cover: absUrl(this.baseUrl, img.split('?')[0]),
				sourceId: this.id,
				type: 'novel',
				status: 'Ongoing',
				lang: 'en'
			});
		});

		return list;
	}

	private async fetchLibrary(page: number): Promise<Manga[]> {
		const paths =
			page <= 1
				? ['/library/', '/library/?orderby=date']
				: [`/library/page/${page}/`, `/library/?page=${page}`];

		for (const path of paths) {
			try {
				const html = await this.fetchHtml(path);
				this.assertNotCf(html);
				const $ = cheerio.load(html);
				const list: Manga[] = [];
				const seen = new Set<string>();

				$('a[href]').each((_, el) => {
					const href = $(el).attr('href') || '';
					const p = pathOnly(href);
					if (!isNovelPath(p) || seen.has(p)) return;

					const $a = $(el);
					const img =
						$a.find('img').attr('data-src') ||
						$a.find('img').attr('src') ||
						$a.closest('article, .card, li, div').find('img').first().attr('data-src') ||
						$a.closest('article, .card, li, div').find('img').first().attr('src') ||
						'';

					if (!img || img.startsWith('data:') || /placeholder|avatar|logo|icon/i.test(img)) {
						return;
					}

					const title =
						$a.attr('title') ||
						$a.find('img').attr('alt') ||
						$a.find('h2, h3, .title').first().text() ||
						$a.text();
					const cleanTitle = decodeEntities((title || '').replace(/\s+/g, ' ').trim());
					if (!isValidTitle(cleanTitle)) return;

					const parentText = $a.closest('article, .card, li, div').text();
					const status = /completed|complete/i.test(parentText)
						? 'Completed'
						: /hiatus/i.test(parentText)
							? 'Hiatus'
							: 'Ongoing';

					seen.add(p);
					list.push({
						id: p,
						title: cleanTitle,
						cover: absUrl(this.baseUrl, img.split('?')[0]),
						sourceId: this.id,
						type: 'novel',
						status,
						lang: 'en'
					});
				});

				if (list.length) return list;
			} catch {
				/* next path */
			}
		}
		return [];
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = encodeURIComponent(query);
		const paths = [`/?s=${q}`, `/page/${page}/?s=${q}`, `/library/?s=${q}`];

		for (const path of paths) {
			try {
				const html = await this.fetchHtml(path);
				this.assertNotCf(html);
				const $ = cheerio.load(html);
				const list: Manga[] = [];
				const seen = new Set<string>();

				$('a[href]').each((_, el) => {
					const href = $(el).attr('href') || '';
					const p = pathOnly(href);
					if (!isNovelPath(p) || seen.has(p)) return;

					const $a = $(el);
					const title =
						$a.attr('title') ||
						$a.find('img').attr('alt') ||
						$a.find('h2, h3, .title').first().text() ||
						$a.text();
					const cleanTitle = decodeEntities((title || '').replace(/\s+/g, ' ').trim());
					if (!isValidTitle(cleanTitle)) return;

					const img =
						$a.find('img').attr('data-src') ||
						$a.find('img').attr('src') ||
						$a.closest('article, li, div').find('img').first().attr('data-src') ||
						$a.closest('article, li, div').find('img').first().attr('src') ||
						'';

					seen.add(p);
					list.push({
						id: p,
						title: cleanTitle,
						cover: img ? absUrl(this.baseUrl, img.split('?')[0]) : '',
						sourceId: this.id,
						type: 'novel',
						lang: 'en'
					});
				});

				if (list.length) return list;
			} catch {
				/* next */
			}
		}
		return [];
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		path = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(path);
		this.assertNotCf(html);
		const $ = cheerio.load(html);

		const title = decodeEntities(
			$('h1').first().text().trim() ||
				$('meta[property="og:title"]').attr('content')?.split(/[|\-–]/)[0].trim() ||
				$('title').text().split(/[|\-–]/)[0].trim() ||
				''
		);

		if (!title || title.length < 2) {
			throw new Error('Novel not found (empty title)');
		}

		let cover =
			$('img[class*="object-cover"]').attr('src') ||
			$('img[class*="object-cover"]').attr('data-src') ||
			$('meta[property="og:image"]').attr('content') ||
			$('article img, .thumb img, .cover img').first().attr('src') ||
			'';
		cover = (cover || '').split('?')[0];

		let description =
			$('div[x-show*="Synopsis"], [x-show*="synopsis"]')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('.synopsis, .entry-content, [class*="synopsis"]')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('meta[property="og:description"]').attr('content') ||
			'';
		description = decodeEntities(description);

		const authors: string[] = [];
		const genres: string[] = [];
		let status = 'Ongoing';

		$('div.grid p.text-sm, .info p, .meta p, [class*="info"] p').each((_, el) => {
			const text = $(el).text().replace(/\s+/g, ' ').trim();
			const low = text.toLowerCase();
			if (/author/i.test(low)) {
				const name = decodeEntities(text.replace(/author[:\s]*/i, '').trim());
				if (name && name.length < 80 && !authors.includes(name)) authors.push(name);
			} else if (/status/i.test(low)) {
				const s = text.replace(/status[:\s]*/i, '').trim();
				if (s) status = s;
			}
		});

		$('a[href*="/genre/"], a[href*="/tag/"]').each((_, a) => {
			const g = $(a).text().trim();
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		let chapters = await this.fetchChaptersViaApi($).catch(() => [] as Chapter[]);
		if (!chapters.length) {
			chapters = this.parseChaptersFromHtml($);
		}

		chapters.sort((a, b) => {
			const na = typeof a.number === 'number' ? a.number : 0;
			const nb = typeof b.number === 'number' ? b.number : 0;
			return nb - na;
		});

		return {
			id: pathOnly(path),
			title,
			cover: absUrl(this.baseUrl, cover),
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters,
			type: 'novel',
			lang: 'en'
		};
	}

	private async fetchChaptersViaApi($: cheerio.CheerioAPI): Promise<Chapter[]> {
		const novelId =
			$('div#likebox').attr('data-novel') ||
			$('[data-novel]').attr('data-novel') ||
			$('[data-story]').attr('data-story');
		if (!novelId) return [];

		const novelJson = await this.fetchJson<{ categories?: number[] }>(
			`/wp-json/wp/v2/novel/${novelId}`
		);
		const catId = novelJson?.categories?.[0];
		if (!catId) return [];

		let total = 999;
		$('div.grid p.text-sm, p.text-sm').each((_, el) => {
			const t = $(el).text();
			if (/chapter/i.test(t)) {
				const nums = t.match(/\d+/g);
				if (nums) {
					const sum = nums.reduce((a, b) => a + parseInt(b, 10), 0);
					if (sum > 0) total = Math.min(sum + 50, 2000);
				}
			}
		});

		const chaptersJson = await this.fetchJson<
			Array<{ title?: string; permalink?: string; locked?: boolean; url?: string }>
		>(`/wp-json/fiction/v1/chapters?category=${catId}&order=asc&per_page=${total}`);

		if (!Array.isArray(chaptersJson)) return [];

		const out: Chapter[] = [];
		const seen = new Set<string>();
		for (const ch of chaptersJson) {
			if (ch.locked) continue;
			const url = ch.permalink || ch.url || '';
			if (!url) continue;
			const id = pathOnly(url);
			if (seen.has(id)) continue;
			seen.add(id);
			const rawTitle = decodeEntities((ch.title || 'Chapter').replace(/\s+/g, ' ').trim());
			const num = parseChapterNumber(rawTitle, out.length + 1);
			out.push({
				id,
				title: shortChapterTitle(rawTitle, num),
				number: num
			});
		}
		return out;
	}

	private parseChaptersFromHtml($: cheerio.CheerioAPI): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		$('a[href*="-chapter-"], a[href*="/chapter"], [class*="chapter"] a').each((_, el) => {
			const href = $(el).attr('href') || '';
			if (!href) return;
			const id = pathOnly(href);
			if (seen.has(id) || BLOCKED_PATH.test(id)) return;
			seen.add(id);

			const rawTitle = decodeEntities(
				($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim()
			);
			if (!rawTitle || rawTitle.length < 3) return;
			const num = parseChapterNumber(rawTitle, out.length + 1);
			out.push({
				id,
				title: shortChapterTitle(rawTitle, num),
				number: num
			});
		});

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
		this.assertNotCf(html);
		const $ = cheerio.load(html);

		const rawTitle =
			$('h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/[|\-–]/)[0].trim() ||
			$('title').text().split(/[|\-–]/)[0].trim() ||
			'Chapter';
		const decoded = decodeEntities(rawTitle);
		const num = parseChapterNumber(decoded, 0);
		const title = num > 0 ? shortChapterTitle(decoded, num) : decoded;

		let contentHtml = '';
		const postId =
			$('a.comment-reply-link').attr('data-postid') ||
			$('input#comment_post_ID').attr('value') ||
			$('[data-postid]').attr('data-postid');

		if (postId) {
			try {
				const post = await this.fetchJson<{ content?: { rendered?: string } }>(
					`/wp-json/wp/v2/posts/${postId}`
				);
				const rendered = post?.content?.rendered || '';
				if (rendered.length > 80) {
					const $c = cheerio.load(rendered);
					$c('script, style, iframe, .ads, .ad, nav').remove();
					const paras = $c('p');
					if (paras.length >= 2) {
						const parts: string[] = [];
						paras.each((_, p) => {
							const t = $c(p).text().trim();
							if (!t || /shanghaifantasy|cookie|privacy|patreon/i.test(t)) return;
							parts.push(`<p>${escapeHtml(t)}</p>`);
						});
						if (parts.length >= 2) contentHtml = parts.join('\n');
					}
					if (!contentHtml) contentHtml = $c('body').html()?.trim() || rendered;
				}
			} catch {
				/* fallback HTML */
			}
		}

		if (!contentHtml || contentHtml.length < 80) {
			const el = $(
				'.chapter-content, .entry-content, article .content, [class*="chapter-body"], .post-content'
			).first();
			if (el.length) {
				const clone = el.clone();
				clone.find('script, style, iframe, .ads, .ad, nav, .comments, form').remove();
				const paras = clone.find('p');
				if (paras.length >= 2) {
					const parts: string[] = [];
					paras.each((_, p) => {
						const t = $(p).text().trim();
						if (!t || t.length < 5) return;
						if (/shanghaifantasy|cookie|privacy|patreon|support/i.test(t)) return;
						parts.push(`<p>${escapeHtml(t)}</p>`);
					});
					if (parts.length) contentHtml = parts.join('\n');
				}
				if (!contentHtml) contentHtml = clone.html()?.trim() || '';
			}
		}

		const prevHref =
			$('a[rel="prev"]').attr('href') ||
			$('a')
				.filter((_, a) => /previous|prev|←/i.test($(a).text()))
				.first()
				.attr('href');
		const nextHref =
			$('a[rel="next"]').attr('href') ||
			$('a')
				.filter((_, a) => /next|→/i.test($(a).text()))
				.first()
				.attr('href');

		return {
			title,
			content:
				contentHtml ||
				'<p><em>Konten kosong — selector berubah, chapter locked, atau CF block.</em></p>',
			prevChapterId: prevHref ? pathOnly(prevHref) : null,
			nextChapterId: nextHref ? pathOnly(nextHref) : null
		};
	}
}

export default ShanghaiFantasySource;