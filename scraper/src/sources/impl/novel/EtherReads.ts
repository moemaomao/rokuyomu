/**
 * EtherReads.com — WordPress Themesia lightnovel theme
 * Path: scraper/src/sources/impl/novel/EtherReads.ts
 *
 * - Homepage: section Latest Release (.listupd .stylefor)
 * - Series list: /series/?order=update&page=N
 * - Series: /series/{slug}/
 * - Chapter: /{slug}-v{vol}c{ch}/ atau /{slug}-c{ch}/
 * - Search: /?s={q}
 * - Paywall: .epl-price berisi angka (bukan "Free") → isLocked
 * - Chapter title bersih: "Chapter N" / "Vol. X Chapter Y"
 * - fetchWithCf via BaseSource.fetchHtml
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://etherreads.com';
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

function decodeHtml(s: string): string {
	return (s || '')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#8217;|&rsquo;|&#39;/g, "'")
		.replace(/&#8220;|&ldquo;/g, '"')
		.replace(/&#8221;|&rdquo;/g, '"')
		.replace(/&#8211;|&ndash;/g, '–')
		.replace(/&#8212;|&mdash;/g, '—')
		.replace(/&nbsp;/g, ' ');
}

function stripHtml(html: string): string {
	return decodeHtml(
		(html || '')
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/p>/gi, '\n\n')
			.replace(/<\/div>/gi, '\n')
			.replace(/<[^>]+>/g, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** Parse "Vol. 5 Ch. 67" / "Ch. 563(end)" → sort number + clean title */
function parseChapterLabel(text: string): { number: number; title: string } {
	const t = cleanText(text);
	const volCh = t.match(/vol\.?\s*(\d+)\s*ch\.?\s*(\d+(?:\.\d+)?)/i);
	if (volCh) {
		const vol = parseInt(volCh[1], 10);
		const ch = parseFloat(volCh[2]);
		return {
			number: vol * 10000 + ch,
			title: `Vol. ${vol} Chapter ${ch}`
		};
	}
	const chOnly = t.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i);
	if (chOnly) {
		const ch = parseFloat(chOnly[1]);
		return { number: ch, title: `Chapter ${ch}` };
	}
	const anyNum = t.match(/(\d+(?:\.\d+)?)/);
	if (anyNum) {
		const n = parseFloat(anyNum[1]);
		return { number: n, title: `Chapter ${n}` };
	}
	if (/prologue/i.test(t)) return { number: 0, title: 'Prologue' };
	return { number: 0, title: t || 'Chapter' };
}

function isSeriesPath(id: string): boolean {
	return /^\/series\/[^/]+$/i.test(id);
}

function isChapterPath(id: string): boolean {
	// /{slug}-v5c67 or /{slug}-c563
	return /^\/[^/]+-(?:v\d+c\d+|c\d+)/i.test(id);
}

function extractImg($el: any): string {
	const img = $el.find('img').first();
	const candidates = [
		img.attr('data-src'),
		img.attr('data-lazy-src'),
		img.attr('data-original'),
		img.attr('src'),
		(img.attr('srcset') || '').split(',').pop()?.trim().split(/\s+/)[0]
	];
	for (const c of candidates) {
		if (
			c &&
			!c.startsWith('data:') &&
			!/svg|sprite|icon|logo|placeholder|default/i.test(c)
		) {
			// strip resize query for higher res
			return absUrl(String(c).replace(/\?resize=\d+,\d+/i, '').split('?')[0]);
		}
	}
	return '';
}

export class EtherReadsSource extends BaseSource {
	id = 'etherreads';
	name = 'EtherReads';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	// ─── Latest — section Latest Release ─────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		const pageNum = Math.max(1, page);
		if (pageNum <= 1) {
			const fromHome = await this.parseLatestHome().catch(() => [] as Manga[]);
			if (fromHome.length > 0) return fromHome.slice(0, PER_PAGE);
			return this.fetchSeriesList(1);
		}
		return this.fetchSeriesList(pageNum);
	}

	/** Hanya blok Latest Release (.listupd .stylefor) */
	private async parseLatestHome(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		const $ = cheerio.load(html);
		$('script, style, noscript, iframe').remove();

		const ordered: Manga[] = [];
		const seen = new Set<string>();

		// Scope ke listupd setelah heading Latest Release bila mungkin
		const $cards = $('.listupd .stylefor, .listupd .bs, .listupd .bsx');
		const $targets = $cards.length ? $cards : $('.stylefor');

		$targets.each((_, el) => {
			const $el = $(el);
			const a = $el
				.find('a[href*="/series/"]')
				.filter((__, link) => isSeriesPath(pathOnly($(link).attr('href') || '')))
				.first();
			const href = a.attr('href') || '';
			const id = pathOnly(href);
			if (!isSeriesPath(id) || seen.has(id)) return;

			const title =
				cleanText(a.attr('title') || '') ||
				cleanText($el.find('.fortitle a, .col-title a, h2 a, h3 a').first().text()) ||
				cleanText(a.text());
			if (!title || title.length < 2) return;
			if (/^(view all|novels|series)/i.test(title)) return;

			const chapText = cleanText(
				$el.find('.forchap a, .col-chap a, .chapter').first().text()
			);
			const { number: latestChapter } = parseChapterLabel(chapText);

			const cover = extractImg($el);

			// Status dari popular / badge jika ada
			let status: string | undefined;
			const st = cleanText($el.text());
			if (/\bCompleted\b/i.test(st)) status = 'Completed';
			else if (/\bHiatus\b/i.test(st)) status = 'Hiatus';
			else if (/\bOngoing\b/i.test(st)) status = 'Ongoing';

			seen.add(id);
			ordered.push({
				id,
				title: title.slice(0, 200),
				cover,
				sourceId: this.id,
				type: 'novel',
				status,
				lang: 'en',
				...(latestChapter > 0 ? { latestChapter } : {})
			});
		});

		return ordered.slice(0, PER_PAGE);
	}

	private async fetchSeriesList(page: number): Promise<Manga[]> {
		const qs = new URLSearchParams({
			status: '',
			type: '',
			order: 'update'
		});
		if (page > 1) qs.set('page', String(page));
		const path = `/series/?${qs.toString()}`;

		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			$('script, style, noscript').remove();

			const ordered: Manga[] = [];
			const seen = new Set<string>();

			// Cards di series list
			const $cards = $(
				'.listupd .bs, .listupd .bsx, .listupd .stylefor, article, .post'
			);
			const parseCard = ($el: cheerio.Cheerio<any>) => {
				const a = $el
					.find('a[href*="/series/"]')
					.filter((__, link) => isSeriesPath(pathOnly($(link).attr('href') || '')))
					.first();
				const href = a.attr('href') || '';
				const id = pathOnly(href);
				if (!isSeriesPath(id) || seen.has(id)) return;

				const title =
					cleanText(a.attr('title') || '') ||
					cleanText($el.find('h2 a, h3 a, .tt, .fortitle a').first().text()) ||
					cleanText(a.text());
				if (!title || title.length < 2) return;
				if (/^(view all|novels|series lists?|text mode)/i.test(title)) return;

				const chapText = cleanText(
					$el.find('.forchap a, .epx, .chapter a, a[href*="-c"], a[href*="-v"]').first().text()
				);
				const { number: latestChapter } = parseChapterLabel(chapText);
				const cover = extractImg($el);

				seen.add(id);
				ordered.push({
					id,
					title: title.slice(0, 200),
					cover,
					sourceId: this.id,
					type: 'novel',
					lang: 'en',
					...(latestChapter > 0 ? { latestChapter } : {})
				});
			};

			if ($cards.length) {
				$cards.each((_, el) => parseCard($(el)));
			}

			// Fallback: heading links
			if (ordered.length < 3) {
				$('a[href*="/series/"]').each((_, el) => {
					const href = $(el).attr('href') || '';
					const id = pathOnly(href);
					if (!isSeriesPath(id) || seen.has(id)) return;
					const title = cleanText($(el).attr('title') || $(el).text());
					if (!title || title.length < 2) return;
					if (/^(view all|novels|series)/i.test(title)) return;
					seen.add(id);
					ordered.push({
						id,
						title: title.slice(0, 200),
						cover: extractImg($(el).parent()) || extractImg($(el)),
						sourceId: this.id,
						type: 'novel',
						lang: 'en'
					});
				});
			}

			return ordered.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[etherreads] fetchSeriesList', page, e);
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
			const ordered: Manga[] = [];
			const seen = new Set<string>();

			const $cards = $('.listupd .bs, .listupd .bsx, article, .stylefor');
			if ($cards.length) {
				$cards.each((_, el) => {
					const $el = $(el);
					const a = $el
						.find('a[href*="/series/"]')
						.filter((__, link) => isSeriesPath(pathOnly($(link).attr('href') || '')))
						.first();
					const id = pathOnly(a.attr('href') || '');
					if (!isSeriesPath(id) || seen.has(id)) return;
					const title =
						cleanText(a.attr('title') || '') ||
						cleanText($el.find('h2, h3, .tt').first().text()) ||
						cleanText(a.text());
					if (!title || title.length < 2) return;
					seen.add(id);
					ordered.push({
						id,
						title: title.slice(0, 200),
						cover: extractImg($el),
						sourceId: this.id,
						type: 'novel',
						lang: 'en'
					});
				});
			}

			if (ordered.length < 2) {
				$('a[href*="/series/"]').each((_, el) => {
					const id = pathOnly($(el).attr('href') || '');
					if (!isSeriesPath(id) || seen.has(id)) return;
					const title = cleanText($(el).attr('title') || $(el).text());
					if (!title || title.length < 2) return;
					if (/^(novels|series)/i.test(title)) return;
					seen.add(id);
					ordered.push({
						id,
						title: title.slice(0, 200),
						cover: extractImg($(el).parent()),
						sourceId: this.id,
						type: 'novel',
						lang: 'en'
					});
				});
			}

			return ordered.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[etherreads] search', e);
			return [];
		}
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = pathOnly(mangaId);
		if (!path.startsWith('/series/')) {
			path = `/series/${path.replace(/^\//, '')}`;
		}
		path = path.replace(/\/$/, '') + '/';

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			cleanText($('h1.entry-title, h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '')
				.split(/\s*[|\-–]\s*Ether Reads/i)[0]
				.trim() ||
			'';

		if (!title || title.length < 2) {
			throw new Error('Novel not found (empty title)');
		}

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('.thumb img, .seriestuimg img, .wp-post-image').first().attr('src') ||
			$('img.ts-post-image').first().attr('src') ||
			'';
		cover = absUrl(String(cover).replace(/\?resize=\d+,\d+/i, '').split('?')[0]);

		// Synopsis
		let description = '';
		const $syn = $(
			'.entry-content .desc, .seriestucon .entry-content, .summary .entry-content, #sidexsinopsis, .desc'
		).first();
		if ($syn.length) {
			description = stripHtml($syn.html() || $syn.text()).slice(0, 4000);
		}
		if (!description || description.length < 40) {
			const $p = $('.entry-content p, .seriestucontent p').first();
			if ($p.length) description = stripHtml($p.html() || $p.text()).slice(0, 4000);
		}
		if (!description) {
			description = cleanText(
				$('meta[name="description"]').attr('content') ||
					$('meta[property="og:description"]').attr('content') ||
					''
			);
		}

		// Authors / genres dari info box Themesia
		const authors: string[] = [];
		const genres: string[] = [];
		let status = 'Ongoing';

		// .spe / info list
		$('.spe span, .info-desc span, .wd-full, .fmed').each((_, el) => {
			const label = cleanText($(el).find('b, strong').first().text()).toLowerCase();
			const val = cleanText(
				$(el)
					.clone()
					.children('b, strong')
					.remove()
					.end()
					.text()
			);
			if (!val) return;
			if (/author|writer|artist|illustrator/i.test(label)) {
				val.split(/[,&]/).forEach((n) => {
					const t = cleanText(n);
					if (t && !authors.includes(t)) authors.push(t);
				});
			} else if (/status/i.test(label)) {
				status = /complet|finish/i.test(val)
					? 'Completed'
					: /hiatus/i.test(val)
						? 'Hiatus'
						: 'Ongoing';
			}
		});

		// Genres links
		$('a[href*="/genre/"], .seriestugenre a, .mgen a').each((_, a) => {
			const n = cleanText($(a).text());
			if (n && n.length < 40 && !genres.includes(n)) genres.push(n);
		});

		// Fallback status from body text
		const body = cleanText($('body').text());
		if (/Status:\s*Completed/i.test(body)) status = 'Completed';
		else if (/Status:\s*Hiatus/i.test(body)) status = 'Hiatus';
		else if (/Status:\s*Ongoing/i.test(body)) status = 'Ongoing';

		const chapters = this.parseChapterList($);

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
			...(chapters.length ? { latestChapter: chapters[0]?.number } : {})
		};
	}

	/**
	 * .eplister li → chapter list
	 * isLocked jika .epl-price bukan "Free" (angka = paid)
	 * Title bersih tanpa subtitle
	 */
	private parseChapterList($: cheerio.CheerioAPI): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		$('.eplister li, #chapterlist li, .chapter-list li').each((_, el) => {
			const $li = $(el);
			const a = $li.find('a').first();
			const href = a.attr('href') || '';
			const id = pathOnly(href);
			if (!id || seen.has(id)) return;
			if (!isChapterPath(id) && !/-c\d+/i.test(id) && !/-v\d+c\d+/i.test(id)) return;

			const numText =
				cleanText($li.find('.epl-num').text()) ||
				cleanText(a.find('.epl-num').text()) ||
				cleanText(a.text());
			const { number, title } = parseChapterLabel(numText);

			// Price: "Free" → unlocked; angka / non-free → locked
			const price = cleanText(
				$li.find('.epl-price').text() || a.find('.epl-price').text()
			);
			const isLocked =
				!!price &&
				!/^free$/i.test(price) &&
				(/^\d+/.test(price) || /coin|paid|premium|unlock/i.test(price));

			const date =
				cleanText($li.find('.epl-date').text()) ||
				cleanText($li.find('time').attr('datetime') || '') ||
				undefined;

			seen.add(id);
			out.push({
				id,
				title,
				number,
				date: date || undefined,
				isLocked
			});
		});

		// Fallback: semua link chapter
		if (out.length < 2) {
			$('a[href*="-c"], a[href*="-v"]').each((_, el) => {
				const href = $(el).attr('href') || '';
				const id = pathOnly(href);
				if (!id || seen.has(id)) return;
				if (!isChapterPath(id) && !/-c\d+/i.test(id)) return;
				const { number, title } = parseChapterLabel(
					cleanText($(el).text()) || id
				);
				seen.add(id);
				out.push({ id, title, number, isLocked: false });
			});
		}

		out.sort((a, b) => b.number - a.number);
		return out;
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
		const path = pathOnly(chapterId);
		if (!path) throw new Error(`Invalid chapter id: ${chapterId}`);

		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		// Locked gate
		const bodyLower = $('body').text().toLowerCase();
		if (
			(/buy this chapter|unlock chapter|login to (read|unlock)|premium chapter|not enough/i.test(
				bodyLower
			) &&
				!$('.entry-content p, .epcontent p').length) ||
			$('.paywall, .login-to-read, .chapter-locked').length
		) {
			throw new Error('Chapter is locked / premium on EtherReads');
		}

		const { number, title: labelTitle } = parseChapterLabel(path);
		const h1 = cleanText($('h1.entry-title, h1').first().text());
		const title =
			labelTitle && labelTitle !== 'Chapter'
				? labelTitle
				: h1.replace(/\s*[|\-–]\s*Ether Reads.*$/i, '').trim() || 'Chapter';

		// Content
		let contentHtml = '';
		for (const sel of [
			'.epcontent',
			'.entry-content',
			'#readerarea',
			'.text-left',
			'.postbody .entry-content',
			'article .entry-content'
		]) {
			const el = $(sel).first();
			if (el.length) {
				el.find(
					'script, style, noscript, iframe, nav, .ads, .ad, .sharedaddy, .code-block, .chapter-nav, .nav-previous, .nav-next'
				).remove();
				contentHtml = el.html() || '';
				if (contentHtml && contentHtml.length > 80) break;
			}
		}

		if (!contentHtml || contentHtml.length < 60) {
			const main = $('article, .postbody').first();
			main.find('script, style, nav, header, footer, .ads').remove();
			contentHtml = main.html() || '';
		}

		let content = (contentHtml || '').trim();
		if (content && !/<p|<br|<div/i.test(content)) {
			content = content
				.split(/\n{2,}/)
				.map((p) => `<p>${escapeHtml(p.trim())}</p>`)
				.join('');
		}

		// Prev / Next
		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		$('a[rel="prev"], a[rel="next"]').each((_, el) => {
			const href = $(el).attr('href') || '';
			const id = pathOnly(href);
			if (!id) return;
			const rel = ($(el).attr('rel') || '').toLowerCase();
			if (rel === 'prev') prevChapterId = id;
			if (rel === 'next') nextChapterId = id;
		});

		if (!prevChapterId || !nextChapterId) {
			$('a').each((_, el) => {
				const href = $(el).attr('href') || '';
				const id = pathOnly(href);
				if (!id || (!isChapterPath(id) && !/-c\d+/i.test(id))) return;
				const label = cleanText($(el).text());
				if (!prevChapterId && /^prev/i.test(label)) prevChapterId = id;
				if (!nextChapterId && /^next/i.test(label)) nextChapterId = id;
			});
		}

		return {
			title,
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default EtherReadsSource;
