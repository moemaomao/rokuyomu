/**
 * Novels Pyramid (novelspyramid.com)
 * Path: scraper/src/sources/impl/NovelsPyramid.ts
 *
 * Novel source — English translations (WordPress).
 *
 * Recently Updated (homepage):
 *   POST /wp-admin/admin-ajax.php
 *     action=get_recently_updated_novels
 *     update_type=free | locked
 *
 * URL pattern:
 *   Novel   : /novel/{slug}/
 *   Chapter : /chapters/{chapter-slug}/
 *   Catalog : /novels/  (SPA-ish; prefer AJAX + novel pages)
 *
 * Chapter body: #reading-content / .chapter-content
 *
 * Frontend:
 *   id: novelspyramid  → add to novelSources.ts, server SOURCES, sourceMeta
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://novelspyramid.com';
const AJAX = `${BASE}/wp-admin/admin-ajax.php`;

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
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#8217;/g, "'")
		.replace(/&#8216;/g, "'")
		.replace(/&#8230;/g, '…')
		.replace(/\s+/g, ' ')
		.trim();
}

function decodeEntities(s: string): string {
	return cleanText(s);
}

/** WordPress-style slug from title */
function slugify(title: string): string {
	return title
		.toLowerCase()
		.replace(/[''`]/g, '')
		.replace(/[\[\]{}()]/g, '')
		.replace(/&/g, 'and')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-+/g, '-');
}

function parseChapterNumber(text: string, fallback = 0): number {
	const t = text || '';
	const m =
		t.match(/(?:chapter|ch\.?)\s*[:.]?\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function normalizeStatus(s?: string): string {
	const v = (s || '').toLowerCase();
	if (v.includes('complete') || v.includes('finished') || v.includes('end')) return 'Completed';
	if (v.includes('hiatus') || v.includes('hold')) return 'Hiatus';
	if (v.includes('drop')) return 'Dropped';
	return 'Ongoing';
}

function preferFullCover(src: string): string {
	if (!src) return '';
	// strip WP size suffix -200x300.jpg → .jpg
	return src.replace(/-\d+x\d+(\.[a-z]+)$/i, '$1');
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export class NovelsPyramidSource extends BaseSource {
	id = 'novelspyramid';
	name = 'Novels Pyramid';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	// ── Recently Updated (AJAX) ─────────────────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		const pageNum = Math.max(1, page);

		// Page 2+: catalog via load_novels AJAX (Recently Updated is a single feed)
		if (pageNum > 1) {
			return this.fetchLoadNovels({ page: pageNum, sort: 'recent' });
		}

		// Page 1: Recently Updated — preserve server order (last updated first)
		const ordered: Manga[] = [];
		const seen = new Set<string>();

		const pushUnique = (m: Manga) => {
			if (seen.has(m.id)) return;
			seen.add(m.id);
			ordered.push(m);
		};

		// free first (true "recently updated"), then locked updates, then home extras
		try {
			const html = await this.fetchRecentlyUpdated('free');
			for (const m of this.parseRecentlyUpdatedHtml(html, false)) pushUnique(m);
		} catch (e) {
			console.warn('[NovelsPyramid] free updates failed', e);
		}
		try {
			const html = await this.fetchRecentlyUpdated('locked');
			for (const m of this.parseRecentlyUpdatedHtml(html, true)) pushUnique(m);
		} catch {
			/* ignore */
		}
		try {
			const home = await this.fetchHtml('/');
			for (const m of this.parseHomeNovelLinks(home)) pushUnique(m);
		} catch {
			/* ignore */
		}

		return ordered.slice(0, 40);
	}

	/** Catalog pagination: POST action=load_novels */
	private async fetchLoadNovels(opts: {
		page?: number;
		search?: string;
		sort?: string;
		genre?: string;
		status?: string;
		language?: string;
	}): Promise<Manga[]> {
		const body = new URLSearchParams({
			action: 'load_novels',
			search: opts.search || '',
			genre: opts.genre || '',
			sort: opts.sort || 'recent',
			status: opts.status || '',
			language: opts.language || '',
			page: String(opts.page ?? 1)
		});
		const res = await fetch(AJAX, {
			method: 'POST',
			headers: {
				...this.headers,
				'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
				'X-Requested-With': 'XMLHttpRequest',
				Accept: '*/*',
				Referer: `${BASE}/novels/`,
				Origin: BASE
			},
			body: body.toString()
		});
		if (!res.ok) throw new Error(`load_novels: ${res.status}`);
		const html = await res.text();
		// Response may be HTML fragment or JSON { success, data: html }
		let fragment = html;
		try {
			const j = JSON.parse(html) as any;
			if (typeof j?.data === 'string') fragment = j.data;
			else if (typeof j?.data?.html === 'string') fragment = j.data.html;
			else if (typeof j?.html === 'string') fragment = j.html;
		} catch {
			/* plain HTML */
		}
		return this.parseHomeNovelLinks(fragment).length
			? this.parseHomeNovelLinks(fragment)
			: this.parseRecentlyUpdatedHtml(fragment, false);
	}

	private async fetchRecentlyUpdated(updateType: 'free' | 'locked'): Promise<string> {
		const body = new URLSearchParams({
			action: 'get_recently_updated_novels',
			update_type: updateType
		});
		const res = await fetch(AJAX, {
			method: 'POST',
			headers: {
				...this.headers,
				'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
				'X-Requested-With': 'XMLHttpRequest',
				Accept: '*/*',
				Referer: `${BASE}/`,
				Origin: BASE
			},
			body: body.toString()
		});
		if (!res.ok) throw new Error(`AJAX ${updateType}: ${res.status}`);
		return await res.text();
	}

	private parseRecentlyUpdatedHtml(html: string, locked: boolean): Manga[] {
		const $ = cheerio.load(html);
		const out: Manga[] = [];
		const seen = new Set<string>();

		$('a.novel-card').each((_: number, el: any) => {
			const chHref = $(el).attr('href') || '';
			const title = cleanText($(el).find('h4').first().text());
			if (!title || title.length < 2) return;

			const chLabel = cleanText($(el).find('p').first().text());
			const latestChapter = parseChapterNumber(chLabel, 0) || undefined;

			let cover =
				$(el).find('img').attr('src') ||
				$(el).find('img').attr('data-src') ||
				$(el).find('img').attr('data-lazy-src') ||
				'';
			cover = preferFullCover(absUrl(cover));

			const slug = slugify(title);
			if (!slug) return;
			const id = `/novel/${slug}`;
			if (seen.has(id)) return;
			seen.add(id);

			// badges: Korean / Completed / Short Novel
			const badges: string[] = [];
			$(el)
				.find('.badge')
				.each((__: number, b: any) => {
					const t = cleanText($(b).text());
					if (t) badges.push(t);
				});
			const status = normalizeStatus(badges.find((b) => /complete|ongoing|hold/i.test(b)));

			out.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status,
				...(latestChapter != null && latestChapter > 0 ? { latestChapter } : {}),
				// stash chapter path for locked flag awareness (not in Manga type — skip)
				...(locked ? {} : {})
			});
		});

		return out;
	}

	private parseHomeNovelLinks(html: string): Manga[] {
		const $ = cheerio.load(html);
		const out: Manga[] = [];
		const seen = new Set<string>();

		$('a[href*="/novel/"]').each((_: number, el: any) => {
			const href = $(el).attr('href') || '';
			const m = href.match(/\/novel\/([a-z0-9-]+)\/?/i);
			if (!m) return;
			const slug = m[1];
			if (slug === 'page') return;
			const id = `/novel/${slug}`;
			if (seen.has(id)) return;

			let title =
				cleanText($(el).attr('title') || '') ||
				cleanText($(el).find('h1,h2,h3,h4').first().text()) ||
				cleanText($(el).text());
			if (!title || title.length < 3) return;
			if (/^read novel$/i.test(title)) {
				// sibling heading
				title =
					cleanText($(el).parent().find('h1,h2,h3').first().text()) ||
					slug.replace(/-/g, ' ');
			}
			if (/^(read novel|browse all|home)$/i.test(title)) return;

			seen.add(id);
			let cover =
				$(el).find('img').attr('src') ||
				$(el).closest('div').find('img').first().attr('src') ||
				'';
			cover = preferFullCover(absUrl(cover));

			out.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type: 'novel',
				lang: 'en'
			});
		});
		return out;
	}

	private async parseNovelsCatalog(page: number): Promise<Manga[]> {
		const path = page <= 1 ? '/novels/' : `/novels/page/${page}/`;
		try {
			const html = await this.fetchHtml(path);
			return this.parseHomeNovelLinks(html).slice(0, 30);
		} catch {
			return [];
		}
	}

	// ── Search ──────────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = query.trim();
		if (!q) return [];
		const page = Math.max(1, opts?.page ?? 1);
		try {
			const list = await this.fetchLoadNovels({ page, search: q, sort: 'recent' });
			if (list.length) return list.slice(0, 24);
		} catch {
			/* fall through */
		}
		const paths = [`/?s=${encodeURIComponent(q)}`, `/novels/?s=${encodeURIComponent(q)}`];
		const byId = new Map<string, Manga>();
		for (const path of paths) {
			try {
				const html = await this.fetchHtml(path);
				for (const m of this.parseHomeNovelLinks(html)) {
					if (!byId.has(m.id)) byId.set(m.id, m);
				}
			} catch {
				/* next */
			}
		}
		const ql = q.toLowerCase();
		return [...byId.values()]
			.filter((m) => m.title.toLowerCase().includes(ql))
			.slice(0, 24);
	}

	// ── Details ─────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		if (!path.includes('/novel/')) {
			path = `/novel/${path.replace(/^\//, '')}`;
		}
		path = path.replace(/\/$/, '') + '/';

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const slugMatch = path.match(/\/novel\/([a-z0-9-]+)/i);
		const slug = slugMatch?.[1] || '';
		const id = `/novel/${slug}`;

		const title =
			cleanText($('h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '').split(/[|\-–]/)[0].trim() ||
			cleanText($('title').text()).split(/[|\-–]/)[0].trim() ||
			slug.replace(/-/g, ' ');

		if (!title || title.length < 2) {
			throw new Error(`NovelsPyramid: novel not found (${path})`);
		}

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('.post-thumbnail img, .novel-cover img, article img').first().attr('src') ||
			$('img[src*="uploads"]').first().attr('src') ||
			'';
		cover = preferFullCover(absUrl(cover));

		// Description: longest paragraph block / meta
		let description =
			cleanText($('meta[property="og:description"]').attr('content') || '') ||
			cleanText($('meta[name="description"]').attr('content') || '');
		const descCandidates: string[] = [];
		$('p').each((_: number, el: any) => {
			const t = cleanText($(el).text());
			if (t.length > 80) descCandidates.push(t);
		});
		if (descCandidates.length) {
			descCandidates.sort((a, b) => b.length - a.length);
			if (descCandidates[0].length > description.length) description = descCandidates[0];
		}

		// Authors
		const authors: string[] = [];
		$('a[href*="author"], .author a, .novel-author').each((_: number, el: any) => {
			const t = cleanText($(el).text());
			if (t && t.length < 60 && !authors.includes(t)) authors.push(t);
		});

		// Genres from badges / links
		const genres: string[] = [];
		$('a[href*="genre="], a[href*="/genre/"], .badge, .genre a').each((_: number, el: any) => {
			const t = cleanText($(el).text());
			if (t && t.length < 40 && !/korean|english|chinese|japanese|short novel/i.test(t)) {
				if (!genres.includes(t)) genres.push(t);
			}
		});

		// Status
		let status = 'Ongoing';
		const bodyText = $('body').text();
		if (/completed/i.test(bodyText)) status = 'Completed';
		else if (/hiatus|on hold/i.test(bodyText)) status = 'Hiatus';

		// Chapters from #chapter-list
		const chapters = this.parseChapterList($);

		return {
			id,
			title,
			cover,
			sourceId: this.id,
			description,
			authors,
			status,
			genres: genres.slice(0, 20),
			chapters,
			type: 'novel',
			lang: 'en',
			...(chapters.length ? { latestChapter: chapters[0]?.number } : {})
		};
	}

	private parseChapterList($: cheerio.CheerioAPI): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		$('#chapter-list li.chapter-item, ul#chapter-list li, .chapter-list li').each(
			(_: number, el: any) => {
				const a = $(el).find('a[href*="/chapters/"]').first();
				const href = a.attr('href') || $(el).find('a').attr('href') || '';
				if (!href || !/\/chapters\//i.test(href)) return;

				const id = pathOnly(href);
				if (seen.has(id)) return;
				seen.add(id);

				const orderAttr = $(el).attr('data-order');
				const titleRaw =
					cleanText(a.find('h3').text()) ||
					cleanText(a.text()) ||
					cleanText($(el).text());
				const num =
					(orderAttr ? parseFloat(orderAttr) : NaN) ||
					parseChapterNumber(titleRaw, out.length + 1);

				// Locked = shows gem price (e.g. "150 💎") — free chapters only have chevron
				const rowHtml = $(el).html() || '';
				const rowText = cleanText($(el).text());
				const isLocked = /💎/.test(rowHtml) || /💎/.test(rowText) || /\d+\s*gems?/i.test(rowText);

				out.push({
					id,
					title: `Chapter ${num}`,
					number: num,
					...(isLocked ? { isLocked: true } : {})
				});
			}
		);

		// Fallback: any /chapters/ link on page
		if (!out.length) {
			$('a[href*="/chapters/"]').each((i: number, el: any) => {
				const href = $(el).attr('href') || '';
				const id = pathOnly(href);
				if (!id || seen.has(id)) return;
				seen.add(id);
				const titleRaw = cleanText($(el).text());
				const num = parseChapterNumber(titleRaw, i + 1);
				out.push({ id, title: `Chapter ${num}`, number: num });
			});
		}

		out.sort((a, b) => {
			if (b.number !== a.number) return b.number - a.number;
			return (b.id || '').localeCompare(a.id || '');
		});
		return out;
	}

	// ── Chapter ─────────────────────────────────────────────────────────────

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		let path = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
		if (!path.includes('/chapters/')) {
			path = `/chapters/${path.replace(/^\//, '')}`;
		}
		path = path.replace(/\/$/, '') + '/';

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		let title =
			cleanText($('h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '').split(/[|\-–]/)[0].trim() ||
			cleanText($('title').text()).split(/[|\-–]/)[0].trim() ||
			'Chapter';

		// Content
		let contentHtml =
			$('#reading-content').html() ||
			$('.chapter-content #reading-content').html() ||
			$('.chapter-content').html() ||
			$('article .entry-content').html() ||
			'';

		// Paywall / empty detection
		const textProbe = cleanText($('#reading-content').text() || $('.chapter-content').text());
		if (
			textProbe.length < 40 ||
			/unlock this chapter|login to (read|continue)|not enough gems|subscribe to read/i.test(
				textProbe
			)
		) {
			throw new Error(
				`NovelsPyramid: chapter locked or empty (${path}). May require login/gems.`
			);
		}

		// Clean scripts/styles from fragment
		const $c = cheerio.load(`<div id="x">${contentHtml}</div>`);
		$c('script, style, noscript, .ads, .sharedaddy, .code-block').remove();
		const paragraphs: string[] = [];
		$c('#x p').each((_: number, el: any) => {
			const t = cleanText($c(el).text());
			if (t) paragraphs.push(t);
		});
		if (!paragraphs.length) {
			const raw = cleanText($c('#x').text());
			if (raw.length > 40) {
				raw.split(/\n+/).forEach((l) => {
					const t = l.trim();
					if (t) paragraphs.push(t);
				});
			}
		}

		const content = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
		if (content.length < 40) {
			throw new Error(`NovelsPyramid: could not extract chapter text (${path})`);
		}

		// Prev / next
		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		$('a[href*="/chapters/"]').each((_: number, el: any) => {
			const t = cleanText($(el).text()).toLowerCase();
			const href = pathOnly($(el).attr('href') || '');
			if (!href) return;
			if (/^prev|previous|←/.test(t)) prevChapterId = href;
			if (/^next|→/.test(t)) nextChapterId = href;
		});

		return {
			title,
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default NovelsPyramidSource;
