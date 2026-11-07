/**
 * Hosted Novel (hostednovel.com) — Laravel novel reader
 * Path: scraper/src/sources/impl/novel/HostedNovel.ts
 *
 * - List: /novels (all series ~55 on one page)
 * - Homepage: 24 titles per page (client-side slice of full list)
 * - Detail: /novel/{slug}
 * - Chapter: /novel/{slug}/chapter-{n}  (also chapter-n.m)
 * - Chapter title → "Chapter N"
 * - Content: .chapter-content
 * - Prev/Next: link[rel=prev|next] + text links
 * - Search: filter full list by title (site search is client-side)
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

function pathOnly(href: string, baseHost = 'https://hostednovel.com'): string {
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
	const pathM = t.match(/\/chapter-(\d+(?:\.\d+)?)/i);
	if (pathM) {
		const n = parseFloat(pathM[1]);
		if (!Number.isNaN(n)) return n;
	}
	const m =
		t.match(/(?:chapter|ch\.?|c)\s*[.\-_]?\s*(\d+(?:\.\d+)?)/i) ||
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

function isSeriesPath(path: string): boolean {
	return /^\/novel\/[a-z0-9\-]+$/i.test(path) && !/\/chapter-/i.test(path);
}

function isChapterPath(path: string): boolean {
	return /^\/novel\/[a-z0-9\-]+\/chapter-[\d.]+$/i.test(path);
}

export class HostedNovelSource extends BaseSource {
	id = 'hostednovel';
	name = 'Hosted Novel';
	baseUrl = 'https://hostednovel.com';

	kind = 'novel' as const;

	private catalogCache: { at: number; items: Manga[] } | null = null;

	// ─── Catalog ─────────────────────────────────────────────────────────

	private async fetchCatalog(force = false): Promise<Manga[]> {
		const now = Date.now();
		if (!force && this.catalogCache && now - this.catalogCache.at < 10 * 60_000) {
			return this.catalogCache.items;
		}

		const html = await this.fetchHtml('/novels');
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		const coverBySlug = new Map<string, string>();
		$('img').each((_, img) => {
			const src = $(img).attr('data-src') || $(img).attr('src') || '';
			if (!/hostednovelcdn\.com\/covers/i.test(src)) return;
			const parent = $(img).closest('a, div, li, article');
			const href =
				parent.find('a[href*="/novel/"]').first().attr('href') ||
				parent.closest('a').attr('href') ||
				$(img).parent().find('a[href*="/novel/"]').attr('href') ||
				'';
			const p = pathOnly(href, this.baseUrl);
			if (isSeriesPath(p)) {
				const slug = p.split('/').pop() || '';
				if (slug && !coverBySlug.has(slug)) coverBySlug.set(slug, src);
			}
		});

		const latestBySlug = new Map<string, number>();
		$('a[href*="/chapter-"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const full = pathOnly(href, this.baseUrl);
			const m = full.match(/^\/novel\/([a-z0-9\-]+)\/chapter-([\d.]+)$/i);
			if (!m) return;
			const n = parseFloat(m[2]);
			if (Number.isNaN(n)) return;
			const prev = latestBySlug.get(m[1]) || 0;
			if (n > prev) latestBySlug.set(m[1], n);
		});

		$('a[href*="/novel/"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const path = pathOnly(href, this.baseUrl);
			if (!isSeriesPath(path)) return;
			if (seen.has(path)) return;

			let title = $(a).text().replace(/\s+/g, ' ').trim();
			if (!title || title.length < 2) {
				title =
					$(a).attr('title') ||
					$(a).find('img').attr('alt') ||
					path.split('/').pop()?.replace(/-/g, ' ') ||
					'';
			}
			title = title.replace(/\s+/g, ' ').trim().slice(0, 200);
			if (!title) return;

			const slug = path.split('/').pop() || '';
			let cover =
				coverBySlug.get(slug) ||
				$(a).find('img').attr('data-src') ||
				$(a).find('img').attr('src') ||
				'';
			if (/logo\.svg|icon|avatar/i.test(cover)) cover = '';

			const latestChapter = latestBySlug.get(slug);

			seen.add(path);
			list.push({
				id: path,
				title,
				cover: absUrl(this.baseUrl, (cover || '').split('?')[0]),
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: 'Ongoing',
				...(latestChapter != null ? { latestChapter } : {})
			});
		});

		if (list.length < 5) {
			const home = await this.fetchHtml('/').catch(() => '');
			if (home) {
				const $h = cheerio.load(home);
				$h('a[href*="/novel/"]').each((_, a) => {
					const path = pathOnly($h(a).attr('href') || '', this.baseUrl);
					if (!isSeriesPath(path) || seen.has(path)) return;
					const title = $h(a)
						.text()
						.replace(/\s+/g, ' ')
						.trim()
						.slice(0, 200);
					if (!title || title.length < 2) return;
					seen.add(path);
					list.push({
						id: path,
						title,
						cover: '',
						sourceId: this.id,
						type: 'novel',
						lang: 'en'
					});
				});
			}
		}

		this.catalogCache = { at: now, items: list };
		console.log(`[hostednovel] catalog → ${list.length}`);
		return list;
	}

	// ─── Latest ──────────────────────────────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		return this.getLatestNovels(page);
	}

	async getLatestNovels(page = 1): Promise<Manga[]> {
		const p = Math.max(1, page);
		const per = 24;
		try {
			const all = await this.fetchCatalog();
			const slice = all.slice((p - 1) * per, p * per);
			console.log(`[hostednovel] latest page=${p} → ${slice.length}`);
			return slice;
		} catch (e) {
			console.error('[hostednovel] latest', e);
			return [];
		}
	}

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		return this.searchNovels(query, opts);
	}

	async searchNovels(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim().toLowerCase();
		if (!q) return this.getLatestNovels(opts?.page ?? 1);

		const page = Math.max(1, opts?.page ?? 1);
		const per = 24;
		try {
			const all = await this.fetchCatalog();
			const filtered = all.filter(
				(m) =>
					m.title.toLowerCase().includes(q) ||
					m.id.toLowerCase().includes(q.replace(/\s+/g, '-'))
			);
			const slice = filtered.slice((page - 1) * per, page * per);
			console.log(`[hostednovel] search "${q}" page=${page} → ${slice.length}`);
			return slice;
		} catch (e) {
			console.error('[hostednovel] search', e);
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
			path = path.replace(/\/chapter-[\d.]+$/i, '');
		}
		if (!path.startsWith('/novel/')) {
			path = `/novel/${path.replace(/^\//, '')}`;
		}

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			$('h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/\s*[|\-–]\s*/)[0]?.trim() ||
			path.split('/').pop()?.replace(/-/g, ' ') ||
			'';

		let cover =
			$('section[aria-labelledby="novel-details-heading"] img').first().attr('src') ||
			$('section[aria-labelledby="novel-details-heading"] img').first().attr('data-src') ||
			$('img.min-h-\\[350px\\], img[class*="min-h-"]').first().attr('src') ||
			'';
		if (!cover || !/hostednovelcdn\.com\/covers/i.test(cover)) {
			const h1Html = $.html($('h1').first());
			const afterH1 = h1Html ? html.split($('h1').first().toString())[1] || html : html;
			const m = afterH1.match(
				/<img[^>]+src="(https:\/\/www\.hostednovelcdn\.com\/covers\/[^"]+)"[^>]*class="[^"]*(?:min-h|w-\[300px\]|shadow-lg)[^"]*"/i
			) || afterH1.match(
				/<img[^>]+src="(https:\/\/www\.hostednovelcdn\.com\/covers\/[^"]+)"/i
			);
			if (m) cover = m[1];
		}
		cover = absUrl(this.baseUrl, (cover || '').split('?')[0]);

		const authors: string[] = [];
	
		$('dt, th, .font-medium, span, p').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (/^Author\s*:?\s*$/i.test(t) || /^Author\s*:/i.test(t)) {
				const dd = $(el).next('dd, span, div, p');
				let name = dd.text().replace(/\s+/g, ' ').trim();
				if (!name && /Author\s*:\s*(.+)/i.test(t)) {
					name = t.replace(/^Author\s*:\s*/i, '').trim();
				}
				if (name && name.length < 100 && !authors.includes(name)) authors.push(name);
			}
		});
	
		if (!authors.length) {
			const am = $('body').text().match(/Author\s*:\s*([^\n\r]{2,80})/i);
			if (am) authors.push(am[1].replace(/\s+/g, ' ').trim());
		}

		const genres: string[] = [];
		$('dt, th, span, p').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (!/^Genres?\s*:/i.test(t) && t !== 'Genres:' && t !== 'Genre:') return;
			const box = $(el).next('dd, div, span');
			box.find('a').each((__, a) => {
				const g = $(a).text().replace(/\s+/g, ' ').trim();
				if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
			});
			if (!genres.length) {
				const raw = box.text().replace(/\s+/g, ' ').trim();
				raw.split(/[,|/]/).forEach((g) => {
					const x = g.trim();
					if (x && x.length < 40 && !genres.includes(x)) genres.push(x);
				});
			}
		});

		let status = 'Ongoing';
		const bodySlice = $('body').text().slice(0, 8000);
		if (/\bCompleted\b/i.test(bodySlice) && /Status\s*:/i.test(bodySlice)) {
			const sm = bodySlice.match(/Status\s*:\s*(\w+)/i);
			if (sm) {
				if (/complete/i.test(sm[1])) status = 'Completed';
				else if (/hiatus/i.test(sm[1])) status = 'Hiatus';
				else if (/ongoing/i.test(sm[1])) status = 'Ongoing';
			}
		}

		let description = '';
	
		$('h2, h3, h4, span, div').each((_, el) => {
			if (description) return;
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (!/^Synopsis$/i.test(t) && !/^Description$/i.test(t)) return;
			const prose = $(el).closest('div').parent().find('.prose, .mt-10.prose').first();
			if (prose.length) {
				description = prose.text().replace(/\s+/g, ' ').trim();
			} else {
				description = $(el).parent().next().text().replace(/\s+/g, ' ').trim();
			}
		});
		if (!description || description.length < 40) {
			description =
				$('.prose').first().text().replace(/\s+/g, ' ').trim() ||
				$('meta[property="og:description"], meta[name="description"]')
					.attr('content')
					?.replace(/\s+/g, ' ')
					.trim() ||
				'';
		}
		if (description.length > 3000) description = description.slice(0, 3000) + '…';

		const seriesSlug = path.split('/').pop() || '';
		const seriesPrefix = `/novel/${seriesSlug}/`;
		const seen = new Set<string>();
		const chapters: Chapter[] = [];

		const extractChaptersFrom = ($doc: cheerio.CheerioAPI) => {
			
			const roots = $doc('li.flow-root a[href*="/chapter-"], #chapters a[href*="/chapter-"], a[href*="/chapter-"]');
			roots.each((_, a) => {
				const href = $doc(a).attr('href') || '';
				const full = pathOnly(href, this.baseUrl);
				if (!isChapterPath(full)) return;
				if (!full.includes(seriesPrefix)) return;

				const id = full;
				if (seen.has(id)) return;
				seen.add(id);

				const rawTitle = $doc(a).text().replace(/\s+/g, ' ').trim() || id;
				const number = parseChapterNumber(id + ' ' + rawTitle, 0) || 0;
				if (number <= 0) return;

				const $a = $doc(a);
				const isLocked =
					$a.find('svg[class*="lock"], .fa-lock, [data-locked], .lock-closed').length > 0 ||
					/\b(fa-lock|lock-closed|is-locked|premium-only|paywall)\b/i.test(
						($a.attr('class') || '') + ' ' + ($a.parent().attr('class') || '')
					) ||
					$a.parent().find('svg[class*="lock-closed"], .fa-lock').length > 0;

				chapters.push({
					id,
					title: shortChapterTitle(number, rawTitle),
					number,
					...(isLocked ? { isLocked: true } : {})
				});
			});
		};

		extractChaptersFrom($);

		let maxPage = 1;
		$('a[href*="?page="]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const m = href.match(/[?&]page=(\d+)/);
			if (m) {
				const n = parseInt(m[1], 10);
				if (n > maxPage) maxPage = n;
			}
		});
	
		maxPage = Math.min(maxPage, 40);

		if (maxPage > 1) {
			const pages: number[] = [];
			for (let i = 2; i <= maxPage; i++) pages.push(i);
			for (let i = 0; i < pages.length; i += 5) {
				const batch = pages.slice(i, i + 5);
				const htmls = await Promise.all(
					batch.map((pg) =>
						this.fetchHtml(`${path}?page=${pg}`).catch(() => '')
					)
				);
				for (const h of htmls) {
					if (!h) continue;
					extractChaptersFrom(cheerio.load(h));
				}
			}
		}

		chapters.sort((a, b) => (b.number ?? 0) - (a.number ?? 0));

		console.log(
			`[hostednovel] details ${path} → ${chapters.length} ch, cover=${cover ? 'yes' : 'no'}`
		);

		return {
			id: path,
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
		if (!path.startsWith('/novel/')) {
			path = `/novel/${path.replace(/^\//, '')}`;
		}

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const bodyText = $('body').text().toLowerCase();
		const contentProbe = $('.chapter-content p').length;
		if (
			contentProbe < 2 &&
			(/login to (?:read|continue)|subscribers only|premium chapter|unlock chapter|paywall/i.test(
				bodyText
			) ||
				$('input[type="password"]').length > 0)
		) {
			throw new Error('Chapter is locked / premium on Hosted Novel');
		}

		const rawTitle =
			$('h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/\s*[|\-–]\s*/)[0]?.trim() ||
			'';
		const number = parseChapterNumber(path + ' ' + rawTitle, 0);
		const title = shortChapterTitle(number > 0 ? number : 1, rawTitle);

		const contentEl = $('.chapter-content, #chapter-content, .reader-content').first();
		contentEl.find('script, style, noscript, iframe, .ads, .ad').remove();

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

		const relPrev = $('link[rel="prev"]').attr('href') || '';
		const relNext = $('link[rel="next"]').attr('href') || '';
		if (relPrev) {
			const p = pathOnly(relPrev, this.baseUrl);
			if (isChapterPath(p)) prevChapterId = p;
		}
		if (relNext) {
			const p = pathOnly(relNext, this.baseUrl);
			if (isChapterPath(p)) nextChapterId = p;
		}

		// Text links
		if (!prevChapterId || !nextChapterId) {
			$('a[href*="/chapter-"]').each((_, a) => {
				const text = $(a).text().replace(/\s+/g, ' ').trim().toLowerCase();
				const href = $(a).attr('href') || '';
				const full = pathOnly(href, this.baseUrl);
				if (!isChapterPath(full)) return;
				if (!prevChapterId && /prev/i.test(text)) prevChapterId = full;
				if (!nextChapterId && /^next|next\s*›|next\s*»/i.test(text)) nextChapterId = full;
			});
		}

		console.log(
			`[hostednovel] chapter ${path} → ${contentHtml.length}c prev=${prevChapterId} next=${nextChapterId}`
		);

		return {
			title,
			content: contentHtml || '<p>No content</p>',
			prevChapterId,
			nextChapterId
		};
	}
}

export default HostedNovelSource;
