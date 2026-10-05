/**
 * TigerTranslations.org — classic WordPress blog (Nostalgic Blog theme)
 * Path: scraper/src/sources/impl/novel/TigerTranslations.ts
 *
 * URL:
 *   Latest  : /  + /page/{n}/   (h2 title links: "Series – N Part M")
 *   Series  : /{slug}/          (TOC links in .the-content)
 *   Chapter : /YYYY/MM/DD/{series}-{n}[-part-m]/
 *   Category: /category/{long-slug}/
 *   Search  : menu + /?s=
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://tigertranslations.org';
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

function slugify(title: string): string {
	return title
		.toLowerCase()
		.replace(/['']/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
}

function isDateTitle(t: string): boolean {
	const s = cleanText(t);
	if (!s) return true;
	if (
		/^(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(
			s
		)
	)
		return true;
	if (/^\d{1,2}\s+\d{4}/.test(s)) return true;
	return false;
}

function parseSeriesPostTitle(
	raw: string
): { series: string; chapter: number; part?: number } | null {
	const t = cleanText(raw);
	if (!t || isDateTitle(t)) return null;

	let m = t.match(
		/^(.+?)\s*[–—\-]\s*(\d+(?:\.\d+)?)\s*(?:Part|Pt\.?)\s*(\d+)\s*$/i
	);
	if (m) {
		const series = cleanText(m[1]);
		if (series.length < 2 || isDateTitle(series)) return null;
		return { series, chapter: parseFloat(m[2]), part: parseInt(m[3], 10) };
	}

	m = t.match(/^(.+?)\s*[–—\-]\s*(\d+(?:\.\d+)?)\s*$/);
	if (m) {
		const series = cleanText(m[1]);
		if (series.length < 2 || isDateTitle(series)) return null;
		return { series, chapter: parseFloat(m[2]) };
	}

	return null;
}

function parseChapterFromUrl(path: string): {
	seriesSlug: string;
	chapter: number;
	part?: number;
} | null {
	const p = pathOnly(path);
	let m = p.match(/^\/\d{4}\/\d{2}\/\d{2}\/([^/]+)$/i);
	const slug = m ? m[1] : p.replace(/^\//, '').split('/').pop() || '';
	if (!slug) return null;

	m = slug.match(/^(.+?)-(\d+(?:\.\d+)?)-part-(\d+)$/i);
	if (m) {
		return {
			seriesSlug: m[1],
			chapter: parseFloat(m[2]),
			part: parseInt(m[3], 10)
		};
	}
	m = slug.match(/^(.+?)-(\d+(?:\.\d+)?)$/i);
	if (m) {
		return { seriesSlug: m[1], chapter: parseFloat(m[2]) };
	}
	return null;
}

function chapterNumber(ch: number, part?: number): number {
	if (part != null && part > 0) return ch + part / 10;
	return ch;
}

function chapterLabel(ch: number, part?: number): string {
	if (part != null && part > 0) return `Chapter ${ch} Part ${part}`;
	return `Chapter ${ch}`;
}

function isChapterUrl(path: string): boolean {
	return /^\/\d{4}\/\d{2}\/\d{2}\//.test(pathOnly(path));
}

function isSeriesPath(path: string): boolean {
	const p = pathOnly(path);
	if (!p || p === '/') return false;
	if (isChapterUrl(p)) return false;
	if (/^\/(category|author|tag|page|wp-|feed|comments|donations)/i.test(p))
		return false;
	return /^\/[a-z0-9][a-z0-9\-]+$/i.test(p);
}

export class TigerTranslationsSource extends BaseSource {
	id = 'tigertranslations';
	name = 'Tiger Translations';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept:
			'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	private menuCache: { at: number; items: Manga[] } | null = null;

	private assertNotCf(html: string): void {
		const low = html.slice(0, 2000).toLowerCase();
		if (
			(low.includes('just a moment') ||
				low.includes('one moment, please') ||
				low.includes('cf-browser-verification') ||
				low.includes('challenge-platform') ||
				low.includes('checking your browser') ||
				low.includes('request is being verified')) &&
			html.length < 25000
		) {
			throw new Error(
				'Cloudflare blocked this request (set BYPARR_URL / use fetchWithCf)'
			);
		}
	}

	async getLatestManga(page = 1): Promise<Manga[]> {
		const p = Math.max(1, page);
		const path = p <= 1 ? '/' : `/page/${p}/`;

		try {
			const html = await this.fetchHtml(path);
			this.assertNotCf(html);
			const $ = cheerio.load(html);
			$('script, style, noscript').remove();

			const list: Manga[] = [];
			const seen = new Set<string>();

			$('h2 a, h3 a, .entry-title a').each((_, a) => {
				const href = $(a).attr('href') || '';
				const titleText = cleanText($(a).text());
				if (!href || !titleText || isDateTitle(titleText)) return;

				const parsed = parseSeriesPostTitle(titleText);
				if (!parsed) return;

				const fromUrl = parseChapterFromUrl(href);
				const seriesSlug = fromUrl?.seriesSlug || slugify(parsed.series);
				const seriesId = `/${seriesSlug}`;
				const chNum = chapterNumber(
					fromUrl?.chapter ?? parsed.chapter,
					fromUrl?.part ?? parsed.part
				);

				if (seen.has(seriesId)) {
					const existing = list.find((x) => x.id === seriesId);
					if (existing) {
						const prev = Number(existing.latestChapter) || 0;
						if (chNum > prev) existing.latestChapter = Math.floor(chNum);
					}
					return;
				}
				seen.add(seriesId);

				list.push({
					id: seriesId,
					title: parsed.series.slice(0, 200),
					cover: '',
					sourceId: this.id,
					type: 'novel',
					lang: 'en',
					status: 'Ongoing',
					latestChapter: Math.floor(chNum)
				});
			});

			const menu = await this.fetchMenuSeries().catch(() => [] as Manga[]);
			for (const item of list) {
				const match = menu.find(
					(m) =>
						m.id === item.id ||
						m.title.toLowerCase() === item.title.toLowerCase() ||
						slugify(m.title) === item.id.replace(/^\//, '')
				);
				if (match) {
					item.id = match.id;
					if (match.cover) item.cover = match.cover;
				}
			}

			return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[tigertranslations] latest', page, e);
			return [];
		}
	}

	private async fetchMenuSeries(): Promise<Manga[]> {
		const now = Date.now();
		if (this.menuCache && now - this.menuCache.at < 15 * 60_000) {
			return this.menuCache.items;
		}

		const html = await this.fetchHtml('/');
		this.assertNotCf(html);
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$(
			'ul.menu-wrap a, nav a, .menu a, .navigation a, #site-navigation a, header a'
		).each((_, a) => {
			const href = $(a).attr('href') || '';
			const path = pathOnly(href);
			if (!isSeriesPath(path)) return;
			const title = cleanText($(a).text());
			if (!title || title.length < 2 || isDateTitle(title)) return;
			if (/^(home|about|contact|donate|patreon|discord|login)/i.test(title))
				return;
			if (seen.has(path)) return;
			seen.add(path);
			list.push({
				id: path,
				title: title.slice(0, 200),
				cover: '',
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: 'Ongoing'
			});
		});

		this.menuCache = { at: now, items: list };
		return list;
	}

	async searchManga(
		query: string,
		opts?: { page?: number }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page ?? 1);
		if (!q) return this.getLatestManga(page);

		const menu = await this.fetchMenuSeries().catch(() => [] as Manga[]);
		const ql = q.toLowerCase();
		let hits = menu.filter(
			(m) =>
				m.title.toLowerCase().includes(ql) ||
				m.id.toLowerCase().includes(ql.replace(/\s+/g, '-'))
		);

		if (hits.length < 3) {
			try {
				const path =
					page <= 1
						? `/?s=${encodeURIComponent(q)}`
						: `/page/${page}/?s=${encodeURIComponent(q)}`;
				const html = await this.fetchHtml(path);
				this.assertNotCf(html);
				const $ = cheerio.load(html);
				const seen = new Set(hits.map((h) => h.id));

				$('h2 a, h3 a, .entry-title a').each((_, a) => {
					const href = $(a).attr('href') || '';
					const titleText = cleanText($(a).text());
					if (!titleText || isDateTitle(titleText)) return;

					const parsed = parseSeriesPostTitle(titleText);
					const fromUrl = parseChapterFromUrl(href);
					const seriesTitle = parsed?.series || titleText;
					const seriesSlug = fromUrl?.seriesSlug || slugify(seriesTitle);
					const id = `/${seriesSlug}`;
					if (seen.has(id)) return;
					seen.add(id);
					hits.push({
						id,
						title: seriesTitle.slice(0, 200),
						cover: '',
						sourceId: this.id,
						type: 'novel',
						lang: 'en',
						status: 'Ongoing',
						...(parsed
							? { latestChapter: Math.floor(parsed.chapter) }
							: {})
					});
				});
			} catch (e) {
				console.error('[tigertranslations] search', e);
			}
		}

		const start = (page - 1) * PER_PAGE;
		return hits.slice(start, start + PER_PAGE);
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = pathOnly(mangaId);
		if (path.startsWith('/series/')) {
			path = `/${path.replace(/^\/series\//, '')}`;
		}
		if (isChapterUrl(path)) {
			const fromUrl = parseChapterFromUrl(path);
			if (fromUrl) path = `/${fromUrl.seriesSlug}`;
		}

		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		this.assertNotCf(html);
		const $ = cheerio.load(html);

		const title =
			cleanText($('h1.entry-title, h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '')
				.split(/\s*[|\-–]\s*/)[0]
				.trim() ||
			cleanText($('title').text().split(/[|\-–]/)[0]);

		if (!title || title.length < 2) {
			throw new Error('Novel not found (empty title)');
		}

		let cover =
			$(
				'div.the-content > p > img, div.the-content > img, div.the-content > span > img'
			)
				.first()
				.attr('src') ||
			$('div.the-content img').first().attr('data-src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = absUrl((cover || '').split('?')[0]);
		if (/logo|icon|avatar|gravatar|emoji|wp-includes/i.test(cover)) cover = '';

		let description = '';
		const content = $('div.the-content, .entry-content').first();
		if (content.length) {
			const parts: string[] = [];
			content.children('p').each((_, p) => {
				const $p = $(p);
				const links = $p.find('a');
				const text = cleanText($p.text());
				if (!text || text.length < 30) return;
				if (links.length > 0 && /chapter\s*\d/i.test(text) && text.length < 100)
					return;
				if (/^(chapter|page\s*\d|author\s*:)/i.test(text)) return;
				parts.push(text);
			});
			description = parts.slice(0, 6).join('\n\n');
		}
		if (!description) {
			description = cleanText(
				$('meta[name="description"]').attr('content') || ''
			);
		}
		if (description.length > 4000) description = description.slice(0, 4000) + '…';

		const authors: string[] = [];
		const bodyText = cleanText(content.text() || $('article').text());
		const authorM = bodyText.match(/Author\s*:\s*([^\n\r]{2,100})/i);
		if (authorM) {
			const name = cleanText(authorM[1].split(/\s{2,}|Author/i)[0]);
			if (name && name.length < 80) authors.push(name);
		}

		let altTitle = '';
		content.find('p').each((_, p) => {
			if (altTitle) return;
			const t = cleanText($(p).text());
			if (/[\u3040-\u30ff\u3400-\u9fff]/.test(t) && t.length < 120) {
				altTitle = t;
			}
		});

		let chapters = this.parseTocChapters($);

		if (chapters.length < 5) {
			const catCh = await this.fetchCategoryChapters(title, path).catch(
				() => [] as Chapter[]
			);
			if (catCh.length > chapters.length) chapters = catCh;
		}

		const seen = new Set<string>();
		chapters = chapters.filter((c) => {
			if (seen.has(c.id)) return false;
			seen.add(c.id);
			return true;
		});
		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const details: MangaDetails = {
			id: pathOnly(path),
			title,
			cover,
			sourceId: this.id,
			description,
			authors,
			status: 'Ongoing',
			genres: [],
			chapters,
			type: 'novel',
			lang: 'en'
		};

		const extra = details as MangaDetails & { altTitles?: string[] };
		if (altTitle) extra.altTitles = [altTitle];

		return details;
	}

	private parseTocChapters($: cheerio.CheerioAPI): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		$('div.the-content a, .entry-content a').each((_, a) => {
			const href = $(a).attr('href') || '';
			if (
				!href ||
				href === '#' ||
				/patreon|ko-fi|novelupdates|discord|paypal|donate/i.test(href)
			)
				return;

			const path = pathOnly(href);
			if (!isChapterUrl(path)) return;

			const parsed = parseChapterFromUrl(path);
			if (!parsed || parsed.chapter <= 0) return;
			if (seen.has(path)) return;
			seen.add(path);

			out.push({
				id: path,
				title: chapterLabel(parsed.chapter, parsed.part),
				number: chapterNumber(parsed.chapter, parsed.part)
			});
		});

		return out;
	}

	private async fetchCategoryChapters(
		seriesTitle: string,
		seriesPath: string
	): Promise<Chapter[]> {
		const slug = seriesPath.replace(/^\//, '') || slugify(seriesTitle);
		const candidates = [
			`/category/${slug}/`,
			`/category/${slugify(seriesTitle)}/`
		];

		const out: Chapter[] = [];
		const seen = new Set<string>();

		for (const cat of candidates) {
			for (let page = 1; page <= 40; page++) {
				const path = page <= 1 ? cat : `${cat}page/${page}/`;
				let html: string;
				try {
					html = await this.fetchHtml(path);
					this.assertNotCf(html);
				} catch {
					break;
				}
				const $ = cheerio.load(html);
				let found = 0;

				$('h2 a, h3 a, .entry-title a').each((_, a) => {
					const href = $(a).attr('href') || '';
					const titleText = cleanText($(a).text());
					if (!href || isDateTitle(titleText)) return;

					const pathId = pathOnly(href);
					if (!isChapterUrl(pathId)) return;

					const fromUrl = parseChapterFromUrl(pathId);
					if (!fromUrl || fromUrl.chapter <= 0) return;
					if (seen.has(pathId)) return;
					seen.add(pathId);

					out.push({
						id: pathId,
						title: chapterLabel(fromUrl.chapter, fromUrl.part),
						number: chapterNumber(fromUrl.chapter, fromUrl.part)
					});
					found++;
				});

				if (found === 0) break;
				const hasNext =
					$(`a[href*="/page/${page + 1}"]`).length > 0 ||
					$('a.next, .nav-previous a').length > 0;
				if (!hasNext) break;
			}
			if (out.length >= 10) break;
		}

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

		const fromUrl = parseChapterFromUrl(path);
		const title = fromUrl
			? chapterLabel(fromUrl.chapter, fromUrl.part)
			: cleanText($('h1.entry-title, h1').first().text()) ||
				cleanText($('title').text().split(/[|\-–]/)[0]) ||
				'Chapter';

		const extractContent = ($doc: cheerio.CheerioAPI): string => {
			const el = $doc('div.the-content, .entry-content').first();
			if (!el.length) return '';
			const clone = el.clone();
			clone
				.find(
					'script, style, iframe, .sharedaddy, .comments, #comments, .nav-links, form, .wp-block-template-part'
				)
				.remove();

			const parts: string[] = [];
			clone.find('p').each((_, p) => {
				const t = cleanText($doc(p).text());
				if (!t) return;
				if (/^(page\s*\d+|next chapter|previous chapter)$/i.test(t)) return;
				if (
					/tigertranslations\.org|patreon|ko-fi|discord/i.test(t) &&
					t.length < 80
				)
					return;
				parts.push(`<p>${escapeHtml(t)}</p>`);
			});
			if (parts.length >= 2) return parts.join('\n');
			return clone.html()?.trim() || '';
		};

		let contentHtml = extractContent($);

		const m = path.match(/^(\/\d{4}\/\d{2}\/\d{2}\/)(.+)$/);
		if (m) {
			const page2Path = `${m[1]}${m[2].replace(/\/$/, '')}-2`;
			try {
				const html2 = await this.fetchHtml(
					page2Path.endsWith('/') ? page2Path : `${page2Path}/`
				);
				if (
					html2 &&
					html2.length > 500 &&
					!/not found|404/i.test(html2.slice(0, 500))
				) {
					this.assertNotCf(html2);
					const extra = extractContent(cheerio.load(html2));
					if (extra && extra.length > 80) {
						contentHtml = (contentHtml || '') + '\n' + extra;
					}
				}
			} catch {
			}
		}

		for (const r of [
			'Page 1',
			'Page 2',
			'Next Chapter',
			'Previous Chapter',
			'PAGE 1',
			'PAGE 2'
		]) {
			contentHtml = contentHtml.split(r).join('');
		}

		const prevHref =
			$('a[rel="prev"]').attr('href') ||
			$('.nav-previous a, a.prev').first().attr('href');
		const nextHref =
			$('a[rel="next"]').attr('href') ||
			$('.nav-next a, a.next').first().attr('href');

		let prevFromContent: string | undefined;
		let nextFromContent: string | undefined;
		$('div.the-content a, .entry-content a').each((_, a) => {
			const t = cleanText($(a).text()).toLowerCase();
			const h = $(a).attr('href') || '';
			if (!h || h === '#') return;
			if (/previous|prev\s*chapter|←/.test(t)) prevFromContent = h;
			if (/^next(\s|$)|next\s*chapter|→/.test(t)) nextFromContent = h;
		});

		return {
			title,
			content:
				contentHtml ||
				'<p><em>Empty content — possible Cloudflare block or selector change.</em></p>',
			prevChapterId: pathOnly(prevHref || prevFromContent || '') || null,
			nextChapterId: pathOnly(nextHref || nextFromContent || '') || null
		};
	}
}

export default TigerTranslationsSource;
