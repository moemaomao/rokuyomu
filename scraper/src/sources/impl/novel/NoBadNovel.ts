/**
 * No Bad Novel (www.nobadnovel.com) — Astro SSR novel site
 * Path: scraper/src/sources/impl/novel/NoBadNovel.ts
 *
 * URL:
 *   Series  : /series/{slug}
 *   Chapter : /series/{slug}/chapter-{n}-{title-slug}
 *   Latest  : homepage "Recent Updates" section (page 1)
 *   Browse  : /series  +  /series/page/{n}
 *   Search  : /series?keyword={q}
 *
 * Chapter title → "Chapter N" only
 * Content: p.mb-4.para
 * Prev/Next: adjacent chapter-{n±1}-* links (or series link)
 * fetchWithCf for all HTML fetches
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://www.nobadnovel.com';
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

function pathOnly(href: string, baseHost = BASE): string {
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


function parseUsDate(raw: string): number | undefined {
	const t = (raw || '').trim();
	const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
	if (m) {
		const month = parseInt(m[1], 10) - 1;
		const day = parseInt(m[2], 10);
		const year = parseInt(m[3], 10);
		const d = new Date(year, month, day);
		if (!Number.isNaN(d.getTime())) return d.getTime();
	}
	const iso = Date.parse(t);
	if (!Number.isNaN(iso)) return iso;
	return undefined;
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
	const pathM = t.match(/\/chapter-(\d+(?:\.\d+)?)/i);
	if (pathM) {
		const n = parseFloat(pathM[1]);
		if (!Number.isNaN(n)) return n;
	}
	const m =
		t.match(/(?:chapter|ch\.?|c)\s*[.\-_]?\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/^c(\d+(?:\.\d+)?)\b/i) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function isSeriesPath(path: string): boolean {
	return /^\/series\/[a-z0-9\-]+$/i.test(path) && !/\/chapter-/i.test(path);
}

function isChapterPath(path: string): boolean {
	return /^\/series\/[a-z0-9\-]+\/chapter-\d+/i.test(path);
}

export class NoBadNovelSource extends BaseSource {
	id = 'nobadnovel';
	name = 'No Bad Novel';
	baseUrl = BASE;

	kind = 'novel' as const;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: BASE + '/'
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

	private assertNotCf(html: string): void {
		const low = html.slice(0, 2000).toLowerCase();
		if (
			(low.includes('just a moment') ||
				low.includes('cf-browser-verification') ||
				low.includes('challenge-platform') ||
				low.includes('checking your browser')) &&
			html.length < 25000
		) {
			throw new Error('Cloudflare blocked this request (set BYPARR_URL / use fetchWithCf)');
		}
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

	async getLatestManga(page = 1): Promise<Manga[]> {
		if (page <= 1) {
			try {
				const home = await this.parseRecentUpdates();
				if (home.length) return home.slice(0, PAGE_SIZE);
			} catch {
			}
			return this.fetchSeriesPage(1);
		}
		return this.fetchSeriesPage(page);
	}

	private async parseRecentUpdates(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		this.assertNotCf(html);
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		let sectionRoot: cheerio.Cheerio<any> | null = null;
		$('h2, h3, h4').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim().toLowerCase();
			if (t.includes('recent update')) {
				sectionRoot = $(el).parent();
				return false;
			}
		});

		const scope = sectionRoot && sectionRoot.length ? sectionRoot : $.root();

		scope.find('a[href*="/series/"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const path = pathOnly(href, this.baseUrl);
			if (!isSeriesPath(path) || seen.has(path)) return;

			const title =
				($(a).find('.font-medium, .line-clamp-1, .line-clamp-2').first().text() ||
					$(a).attr('title') ||
					'')
					.replace(/\s+/g, ' ')
					.trim();
			if (!title || title.length < 2) return;
			if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(title)) return;

			const cover =
				$(a).find('img').attr('data-src') ||
				$(a).find('img').attr('src') ||
				'';

			const dateText = $(a)
				.find('.text-sm.text-gray-500, .text-gray-500')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			const updatedAt = parseUsDate(dateText);

			const statusBadge = $(a)
				.find('.badge')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim();

			seen.add(path);
			list.push({
				id: path,
				title: title.slice(0, 200),
				cover: absUrl(this.baseUrl, (cover || '').split('?')[0]),
				sourceId: this.id,
				type: 'novel',
				status: statusBadge || undefined,
				lang: 'en',
				...(updatedAt ? { updatedAt } : {})
			});
		});

		return this.dedupeById(list);
	}

	private async fetchSeriesPage(page: number): Promise<Manga[]> {
		const path = page <= 1 ? '/series' : `/series/page/${page}`;
		try {
			const html = await this.fetchHtml(path);
			this.assertNotCf(html);
			const $ = cheerio.load(html);
			return this.parseSeriesCards($);
		} catch {
			return [];
		}
	}

	private parseSeriesCards($: cheerio.CheerioAPI): Manga[] {
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('a[href*="/series/"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const path = pathOnly(href, this.baseUrl);
			if (!isSeriesPath(path) || seen.has(path)) return;

			const title =
				($(a).find('.font-semibold, .font-medium, .line-clamp-2').first().text() ||
					$(a).attr('title') ||
					$(a).find('img').attr('alt') ||
					$(a).text())
					.replace(/\s+/g, ' ')
					.trim();
			if (!title || title.length < 2) return;

			const cover =
				$(a).find('img').attr('data-src') ||
				$(a).find('img').attr('src') ||
				'';

			const statusBadge = $(a)
				.find('.badge')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim();

			const dateText = $(a)
				.find('.text-sm.text-gray-500, .text-gray-500, time, .date')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			const updatedAt = parseUsDate(dateText);

			seen.add(path);
			list.push({
				id: path,
				title: title.slice(0, 200),
				cover: absUrl(this.baseUrl, (cover || '').split('?')[0]),
				sourceId: this.id,
				type: 'novel',
				status: statusBadge || undefined,
				lang: 'en',
				...(updatedAt ? { updatedAt } : {})
			});
		});

		return this.dedupeById(list);
	}

	// ─── Search ───────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = query.trim();
		if (!q) return [];
		const page = opts?.page ?? 1;
		const path =
			page <= 1
				? `/series?keyword=${encodeURIComponent(q)}`
				: `/series/page/${page}?keyword=${encodeURIComponent(q)}`;

		try {
			const html = await this.fetchHtml(path);
			this.assertNotCf(html);
			const $ = cheerio.load(html);
			const cards = this.parseSeriesCards($);
			if (cards.length) return cards;

			const html2 = await this.fetchHtml(`/?q=${encodeURIComponent(q)}`);
			this.assertNotCf(html2);
			return this.parseSeriesCards(cheerio.load(html2));
		} catch {
			return [];
		}
	}

	// ─── Detail ───────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		if (!path.includes('/series/')) {
			path = `/series/${path.replace(/^\//, '')}`;
		}
		path = path.replace(/\/$/, '');

		const html = await this.fetchHtml(path);
		this.assertNotCf(html);
		const $ = cheerio.load(html);

		const title =
			$('h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/[|\-–]/)[0].trim() ||
			$('title').text().split(/[|\-–]/)[0].trim();

		if (!title || title.length < 2) {
			throw new Error('Novel not found (empty title)');
		}

		let cover =
			$('img[src*="cdn.nobadnovel"], .drop-shadow-2xl img, main img')
				.first()
				.attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = (cover || '').split('?')[0];

		let status = 'Ongoing';
		$('.badge').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (/ongoing|completed|hiatus|dropped/i.test(t)) {
				status = t;
			}
		});

		const authors: string[] = [];
		$('span, div').each((_, el) => {
			const txt = $(el).text().replace(/\s+/g, ' ').trim();
			if (/^Author:\s*/i.test(txt) && txt.length < 80) {
				const name = txt.replace(/^Author:\s*/i, '').trim();
				if (name && !authors.includes(name)) authors.push(name);
			}
		});
		$('span').each((_, el) => {
			if (/^Author:\s*$/i.test($(el).text().trim())) {
				const name = $(el).next().text().trim() || $(el).parent().text().replace(/Author:\s*/i, '').trim();
				if (name && name.length < 60 && !authors.includes(name)) authors.push(name);
			}
		});

		let description = '';
		const intro = $('#intro .content, #intro, [data-tab="intro"] + * .content').first();
		if (intro.length) {
			const clone = intro.clone();
			clone.find('script, style').remove();
			description = clone
				.html()
				?.replace(/<br\s*\/?>/gi, '\n')
				.replace(/<[^>]+>/g, '')
				.replace(/&nbsp;/g, ' ')
				.replace(/\n{3,}/g, '\n\n')
				.trim() || clone.text().replace(/\s+/g, ' ').trim();
		}
		if (!description) {
			description =
				$('meta[name="description"]').attr('content')?.trim() ||
				$('meta[property="og:description"]').attr('content')?.trim() ||
				'';
		}

		const genres: string[] = [];
		$('a[href*="/genre/"], a[href*="/tag/"], a[href*="/category/"]').each((_, a) => {
			const g = $(a).text().trim();
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		const chapters = this.parseChapterList($, path);
		chapters.sort((a, b) => b.number - a.number);

		const slug = path.split('/').filter(Boolean).pop() || '';
		return {
			id: pathOnly(path, this.baseUrl),
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

	private parseChapterList($: cheerio.CheerioAPI, seriesPath: string): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();
		const seriesSlug = seriesPath.replace(/\/$/, '').split('/').pop() || '';
		const $items = $('#chapter-list li, ol.chapter-list > li, #table li');
		const roots = $items.length ? $items : $('a[href*="/chapter-"]').parent();

		roots.each((_, el) => {
			const a = $(el).is('a') ? $(el) : $(el).find('a[href*="/chapter-"]').first();
			if (!a.length) return;
			const href = a.attr('href') || '';
			const path = pathOnly(href, this.baseUrl);
			if (!isChapterPath(path)) return;
			if (seriesSlug && !path.includes(`/${seriesSlug}/`)) return;

			const num = parseChapterNumber(path, 0);
			if (num <= 0) return;
			if (seen.has(path)) return;
			seen.add(path);

			const rowText = $(el).text().replace(/\s+/g, ' ').trim();
			let date: string | undefined;
			const dateMatch =
				rowText.match(/(\d{1,2}\/\d{1,2}\/\d{4})/) ||
				rowText.match(/(\d{4}-\d{2}-\d{2})/) ||
				rowText.match(/([A-Z][a-z]{2}\.?\s+\d{1,2},?\s+\d{4})/);
			if (dateMatch) date = dateMatch[1];

			const locked =
				/\b(lock|premium|vip|paywall|paid|coin)\b/i.test(rowText) ||
				$(el).find('.lock, .icon-lock, [class*="lock"], svg[class*="lock"]').length > 0 ||
				a.find('.lock, [class*="lock"]').length > 0;

			const ch: Chapter = {
				id: path,
				title: `Chapter ${num}`,
				number: num,
				...(date ? { date } : {})
			};
			if (locked) ch.isLocked = true;
			out.push(ch);
		});

		if (!out.length) {
			$('a[href*="/chapter-"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const path = pathOnly(href, this.baseUrl);
				if (!isChapterPath(path)) return;
				if (seriesSlug && !path.includes(`/${seriesSlug}/`)) return;
				const num = parseChapterNumber(path, 0);
				if (num <= 0 || seen.has(path)) return;
				seen.add(path);
				out.push({ id: path, title: `Chapter ${num}`, number: num });
			});
		}

		return out;
	}

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	// ─── Chapter content ──────────────────────────────────────────────────

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		const path = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
		const html = await this.fetchHtml(path);
		this.assertNotCf(html);
		const $ = cheerio.load(html);

		const num = parseChapterNumber(path, 0);
		const h1 = $('h1').first().text().replace(/\s+/g, ' ').trim();
		const title = num > 0 ? `Chapter ${num}` : h1 || 'Chapter';

		// Content paragraphs
		const parts: string[] = [];
		$('p.mb-4.para, p.para, article p, main p').each((_, p) => {
			const t = $(p).text().replace(/\s+/g, ' ').trim();
			if (!t || t.length < 2) return;
			if (/nobadnovel|cloudflare|cookie|privacy|adblock|subscribe/i.test(t)) return;
			parts.push(`<p>${escapeHtml(t)}</p>`);
		});

		let contentHtml = parts.join('\n');
		if (!contentHtml || contentHtml.length < 80) {
			const bodyText = $('main, article, .content').first();
			if (bodyText.length) {
				const clone = bodyText.clone();
				clone.find('script, style, nav, header, footer, .navbar, .menu, button, a').remove();
				const paras = clone.find('p');
				if (paras.length >= 3) {
					const alt: string[] = [];
					paras.each((_, p) => {
						const t = $(p).text().trim();
						if (t.length > 15) alt.push(`<p>${escapeHtml(t)}</p>`);
					});
					if (alt.length >= 3) contentHtml = alt.join('\n');
				}
			}
		}

		const seriesMatch = path.match(/^(\/series\/[a-z0-9\-]+)\//i);
		const seriesBase = seriesMatch ? seriesMatch[1] : '';

		let prevId: string | null = null;
		let nextId: string | null = null;

		$('a[href*="/chapter-"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const p = pathOnly(href, this.baseUrl);
			if (!isChapterPath(p)) return;
			const n = parseChapterNumber(p, -1);
			if (num > 0 && n === num - 1) prevId = p;
			if (num > 0 && n === num + 1) nextId = p;
		});

		if (!prevId && num > 1 && seriesBase) {
		}

		return {
			title,
			content:
				contentHtml ||
				'<p><em>Konten kosong — selector berubah atau chapter locked.</em></p>',
			prevChapterId: prevId,
			nextChapterId: nextId
		};
	}
}

export default NoBadNovelSource;
