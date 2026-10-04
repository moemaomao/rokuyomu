/**
 * OssanTL (ossantl.my.id) — Themesia / lightnovel theme (novel)
 * Path: scraper/src/sources/impl/novel/OssanTL.ts
 *
 * URL:
 *   Series  : /series/{slug}/
 *   Chapter : /{series-slug}/{chapter-slug}/
 *   Latest  : homepage .listupd .utao (Latest Release) → 24 titles
 *   List    : /series/?status=&type=&order=update&page=N
 *   Search  : /?s={q}
 *   Chapters: .eplister li (epl-num / epl-title / epl-date)
 *   Content : .entry-content / .epcontent / .chapter-content
 *   Prev/Next: a[rel=prev|next] + .naveps / .nvs links
 *   Lock    : isLocked when premium / paywall markers present
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://ossantl.my.id';
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
		t.match(/(?:chapter|ch\.?|bab|episode|ep\.?)\s*[.\-_]?\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function extractChapterNum(text: string): number | undefined {
	const n = parseChapterNumber(text, -1);
	return n >= 0 ? n : undefined;
}

function cleanDate(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	let t = raw.replace(/\s+/g, ' ').trim();
	if (!t) return undefined;
	t = t.replace(/unlocks?\s+in\s+[\s\S]*$/i, '').trim();
	return t || undefined;
}

function isLockedChapter($: cheerio.CheerioAPI, el: any): boolean {
	const $el = $(el);
	const cls = (
		($el.attr('class') || '') +
		' ' +
		($el.find('a').first().attr('class') || '') +
		' ' +
		($el.find('i, svg, span').attr('class') || '')
	)
		.toLowerCase()
		.trim();

	if (/\bfree-chap\b|\bfree\b/.test(cls) && !/\bpremium\b/.test(cls)) return false;
	if (
		/\bpremium-block\b|\bpremium\b|\bto_be_free\b|\bcoin-\d+\b|\bpaid\b|\bpaywall\b|\blocked\b|\bmember\b/.test(
			cls
		)
	) {
		return true;
	}

	const text = $el.text().replace(/\s+/g, ' ').toLowerCase();
	if (/\bunlocks?\s+in\b|\bpremium\b|\blocked\b|\bmembers?\s+only\b|\bpaywall\b/.test(text)) {
		return true;
	}

	if ($el.find('.fa-lock, .fas.fa-lock, .fa-lock-alt, [class*="lock"]').length) {
		return true;
	}

	const href = ($el.find('a').first().attr('href') || '').trim();
	if ((!href || href === '#' || href.startsWith('javascript')) && /ch\.?\s*\d|chapter\s*\d/i.test(text)) {
		return true;
	}

	return false;
}

function isSeriesPath(path: string): boolean {
	return /^\/series\/[a-z0-9\-]+$/i.test(path);
}

export class OssanTLSource extends BaseSource {
	id = 'ossantl';
	name = 'OssanTL';
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
			const home = await this.parseHomeLatest().catch(() => [] as Manga[]);
			if (home.length >= PAGE_SIZE) return home.slice(0, PAGE_SIZE);
			const list = await this.fetchSeriesPage(1).catch(() => [] as Manga[]);
			return this.dedupeById([...home, ...list]).slice(0, PAGE_SIZE);
		}
		return this.fetchSeriesPage(page);
	}

	private async parseHomeLatest(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		this.assertNotCf(html);
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('.listupd .utao, .listupd .uta, .latesthome + .listupd .utao').each((_, el) => {
			const item = this.parseUtaCard($, el);
			if (item && !seen.has(item.id)) {
				seen.add(item.id);
				list.push(item);
			}
		});

		if (list.length < 8) {
			$('.listupd a.series.tip, .listupd a[href*="/series/"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const path = pathOnly(href, this.baseUrl);
				if (!isSeriesPath(path) || seen.has(path)) return;
				const title =
					($(a).attr('title') || $(a).find('h3').text() || $(a).text())
						.replace(/\s+/g, ' ')
						.trim();
				if (!title || title.length < 2) return;
				const parent = $(a).closest('.uta, .utao, .bs, .bsx, div');
				const cover =
					parent.find('img').attr('data-src') ||
					parent.find('img').attr('data-lazy-src') ||
					parent.find('img').attr('src') ||
					$(a).find('img').attr('src') ||
					'';
				const chText =
					parent.find('.luf ul li a, .nchapter a, a[href*="chapter"]').first().text() ||
					'';
				const latestChapter = extractChapterNum(chText);
				seen.add(path);
				list.push({
					id: path,
					title,
					cover: absUrl(this.baseUrl, (cover || '').split('?')[0]),
					sourceId: this.id,
					type: 'novel',
					lang: 'en',
					...(latestChapter != null ? { latestChapter } : {})
				});
			});
		}

		return list.slice(0, PAGE_SIZE);
	}

	private parseUtaCard($: cheerio.CheerioAPI, el: any): Manga | null {
		const a =
			$(el).find('a.series.tip[href*="/series/"]').first().length
				? $(el).find('a.series.tip[href*="/series/"]').first()
				: $(el).find('a[href*="/series/"]').first();
		const href = a.attr('href') || '';
		const path = pathOnly(href, this.baseUrl);
		if (!isSeriesPath(path)) return null;

		const title =
			(a.attr('title') || $(el).find('h3').first().text() || a.text())
				.replace(/\s+/g, ' ')
				.trim();
		if (!title || title.length < 2) return null;

		const cover =
			$(el).find('.imgu img, img').attr('data-src') ||
			$(el).find('.imgu img, img').attr('data-lazy-src') ||
			$(el).find('.imgu img, img').attr('src') ||
			'';

		const chText =
			$(el).find('.luf ul li a').first().text() ||
			$(el).find('a[href*="chapter"]').first().text() ||
			'';
		const latestChapter = extractChapterNum(chText);

		return {
			id: path,
			title,
			cover: absUrl(this.baseUrl, (cover || '').split('?')[0]),
			sourceId: this.id,
			type: 'novel',
			lang: 'en',
			...(latestChapter != null ? { latestChapter } : {})
		};
	}

	private async fetchSeriesPage(page: number): Promise<Manga[]> {
		const path =
			page <= 1
				? '/series/?status=&type=&order=update'
				: `/series/?status=&type=&order=update&page=${page}`;
		try {
			const html = await this.fetchHtml(path);
			this.assertNotCf(html);
			const $ = cheerio.load(html);
			return this.parseSeriesListCards($);
		} catch {
			return [];
		}
	}

	private parseSeriesListCards($: cheerio.CheerioAPI): Manga[] {
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('.maindet, .listupd .maindet').each((_, el) => {
			const a = $(el).find('a[href*="/series/"]').first();
			const href = a.attr('href') || '';
			const path = pathOnly(href, this.baseUrl);
			if (!isSeriesPath(path) || seen.has(path)) return;

			const title =
				(a.attr('title') ||
					$(el).find('h2 a, h2, h3 a, h3').first().text() ||
					a.text())
					.replace(/\s+/g, ' ')
					.trim();
			if (!title || title.length < 2) return;

			const cover =
				$(el).find('.mdthumb img, img').attr('data-src') ||
				$(el).find('.mdthumb img, img').attr('data-lazy-src') ||
				$(el).find('.mdthumb img, img').attr('src') ||
				'';

			const chText =
				$(el).find('.nchapter a, .mdinfodet a').first().text() ||
				$(el).find('a[href*="chapter"]').first().text() ||
				'';
			const latestChapter = extractChapterNum(chText);

			const statusText =
				$(el).find('.status, .mdstatus, span[class*="status"]').first().text().trim() ||
				undefined;

			seen.add(path);
			list.push({
				id: path,
				title,
				cover: absUrl(this.baseUrl, (cover || '').split('?')[0]),
				sourceId: this.id,
				type: 'novel',
				status: statusText,
				lang: 'en',
				...(latestChapter != null ? { latestChapter } : {})
			});
		});

		if (!list.length) {
			$('.bs, .bsx, .listupd .bs').each((_, el) => {
				const a = $(el).find('a[href*="/series/"]').first();
				const href = a.attr('href') || '';
				const path = pathOnly(href, this.baseUrl);
				if (!isSeriesPath(path) || seen.has(path)) return;
				const title =
					(a.attr('title') || $(el).find('.tt, h2, h3').first().text() || a.text())
						.replace(/\s+/g, ' ')
						.trim();
				if (!title || title.length < 2) return;
				const cover =
					$(el).find('img').attr('data-src') ||
					$(el).find('img').attr('src') ||
					'';
				const chText =
					$(el).find('.epxs, .chapter, a[href*="chapter"]').first().text() || '';
				const latestChapter = extractChapterNum(chText);
				seen.add(path);
				list.push({
					id: path,
					title,
					cover: absUrl(this.baseUrl, (cover || '').split('?')[0]),
					sourceId: this.id,
					type: 'novel',
					lang: 'en',
					...(latestChapter != null ? { latestChapter } : {})
				});
			});
		}

		return list;
	}

	// ─── Search ───────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = encodeURIComponent(query.trim());
		if (!q) return [];

		const path =
			page <= 1
				? `/?s=${q}`
				: `/page/${page}/?s=${q}`;

		try {
			const html = await this.fetchHtml(path);
			this.assertNotCf(html);
			const $ = cheerio.load(html);

			const fromMaindet = this.parseSeriesListCards($);
			if (fromMaindet.length) return fromMaindet;

			const list: Manga[] = [];
			const seen = new Set<string>();
			$('.bsx, .bs, .listupd a[href*="/series/"]').each((_, el) => {
				const $el = $(el);
				const a =
					$el.is('a') && ($el.attr('href') || '').includes('/series/')
						? $el
						: $el.find('a[href*="/series/"]').first();
				const href = a.attr('href') || '';
				const pathId = pathOnly(href, this.baseUrl);
				if (!isSeriesPath(pathId) || seen.has(pathId)) return;
				const title =
					(a.attr('title') || $el.find('.tt, h2, h3').first().text() || a.text())
						.replace(/\s+/g, ' ')
						.trim();
				if (!title || title.length < 2) return;
				const cover =
					$el.find('img').attr('data-src') ||
					$el.find('img').attr('src') ||
					a.find('img').attr('src') ||
					'';
				seen.add(pathId);
				list.push({
					id: pathId,
					title,
					cover: absUrl(this.baseUrl, (cover || '').split('?')[0]),
					sourceId: this.id,
					type: 'novel',
					lang: 'en'
				});
			});
			return list;
		} catch {
			return [];
		}
	}

	// ─── Details ──────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		if (!path.includes('/series/')) {
			path = `/series/${path.replace(/^\//, '')}`;
		}
		const seriesPath = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(seriesPath);
		this.assertNotCf(html);
		const $ = cheerio.load(html);

		const title =
			$('.infox h1.entry-title, h1.entry-title, .infox h1').first().text().trim() ||
			$('h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/[|\-–]/)[0].trim() ||
			$('title').text().split(/[|\-–]/)[0].trim();

		if (!title || title.length < 2) {
			throw new Error('Novel not found (empty title)');
		}

		const coverEl = $('.thumbook img, .thumb img, .sertothumb img, .mdthumb img').first();
		let cover =
			coverEl.attr('data-src') ||
			coverEl.attr('data-lazy-src') ||
			coverEl.attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		if (cover.startsWith('data:') || /placeholder|no[-_]?image/i.test(cover)) {
			cover = $('meta[property="og:image"]').attr('content') || '';
		}
		cover = (cover || '').split('?')[0];

		let description = '';
		const descBox = $('.entry-content, .desc, .synopsis, .sinfo .desc').first();
		if (descBox.length) {
			const clone = descBox.clone();
			clone.find('script, style, .ads, .ad, .code-block').remove();
			const paras = clone
				.find('p')
				.map((_, p) => $(p).text().trim())
				.get()
				.filter((t) => t && t.length > 20 && !/read complete|no registration|ossantl/i.test(t));
			description = paras.join('\n\n') || clone.text().replace(/\s+/g, ' ').trim();
		}

		description = description
			.replace(/Read complete[\s\S]*?OssanTL\.?/gi, '')
			.replace(/You can also read[\s\S]*?registration required[^.]*\./gi, '')
			.trim();

		const authors: string[] = [];
		const artists: string[] = [];
		const genres: string[] = [];
		let altTitle = '';
		let typeLabel = 'novel';
		let status = 'Ongoing';
		let published = '';

		$('.spe span, .infox .spe span').each((_, el) => {
			const raw = $(el).text().replace(/\s+/g, ' ').trim();
			const label = $(el).find('b').first().text().replace(/:$/, '').trim().toLowerCase();
			const links = $(el)
				.find('a')
				.map((_, a) => $(a).text().trim())
				.get()
				.filter(Boolean);
			const valueText = raw
				.replace(new RegExp(`^${label}\\s*:?\\s*`, 'i'), '')
				.replace(/\s+/g, ' ')
				.trim();

			if (/^author/.test(label)) {
				for (const n of links.length ? links : valueText ? [valueText] : []) {
					const clean = n.replace(/^author\(s\)\s*/i, '').trim();
					if (clean && !authors.includes(clean)) authors.push(clean);
				}
			} else if (/^artist/.test(label)) {
				for (const n of links.length ? links : valueText ? [valueText] : []) {
					if (n && !artists.includes(n)) artists.push(n);
				}
			} else if (/^status/.test(label)) {
				status = links[0] || valueText || status;
			} else if (/^type/.test(label)) {
				typeLabel = links[0] || valueText || typeLabel;
			} else if (/released|release|year|published/.test(label)) {
				const year = valueText.match(/\b(19|20)\d{2}\b/);
				published = year ? year[0] : valueText.slice(0, 20);
			}
		});

		const alter = $('.alter, .alternative, span.alter').first().text().replace(/\s+/g, ' ').trim();
		if (alter) altTitle = alter;

		$('.genxed a, .genres a, a[href*="/genre/"]').each((_, a) => {
			const g = $(a).text().trim();
			if (g && g.length < 40 && !genres.includes(g) && !/^#/.test(g)) genres.push(g);
		});

		if (!authors.length && artists.length) authors.push(...artists);

		let rating: string | undefined;
		const ratingText =
			$('.rating .numscore, .numscore, .score, [itemprop="ratingValue"]').first().text().trim() ||
			$('[itemprop="ratingValue"]').attr('content') ||
			'';
		if (ratingText) {
			const m = ratingText.match(/(\d+(?:\.\d+)?)/);
			if (m && parseFloat(m[1]) > 0) rating = m[1];
		}

		const chapters = this.parseChapterList($);
		chapters.sort((a, b) => {
			const na = typeof a.number === 'number' ? a.number : 0;
			const nb = typeof b.number === 'number' ? b.number : 0;
			return nb - na;
		});

		const details: MangaDetails = {
			id: pathOnly(path, this.baseUrl),
			title,
			cover: absUrl(this.baseUrl, cover),
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters,
			type: typeLabel || 'novel',
			lang: 'en'
		};

		const extra = details as MangaDetails & {
			artists?: string[];
			altTitles?: string[];
			rating?: string;
			published?: string;
		};
		if (artists.length) extra.artists = artists;
		if (altTitle) extra.altTitles = [altTitle];
		if (rating) extra.rating = rating;
		if (published) extra.published = published;

		return details;
	}

	private parseChapterList($: cheerio.CheerioAPI): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		const pushChapter = (
			href: string,
			numText: string,
			date: string | undefined,
			locked: boolean,
			fallbackNum: number
		) => {
			const num = parseChapterNumber(numText || href, fallbackNum);
			let id = pathOnly(href, this.baseUrl);
			if (!href || href === '#' || href.startsWith('javascript')) {
				id = `/locked/chapter-${num}`;
			}
			if (seen.has(id)) return;
			seen.add(id);

			const ch: Chapter = {
				id,
				title: num > 0 ? `Chapter ${num}` : 'Chapter',
				number: num > 0 ? num : fallbackNum,
				date: cleanDate(date)
			};
			if (locked) ch.isLocked = true;
			out.push(ch);
		};

		$('.eplister li, .eplisterfull li, ul li[data-id], ul li[data-ID]').each((i, el) => {
			const a = $(el).find('a').first();
			const href = a.attr('href') || '';
			const numText =
				$(el).find('.epl-num').first().text().trim() ||
				a.find('.epl-num').text().trim() ||
				a.text().trim();
			const date =
				$(el).find('.epl-date').first().text().trim() ||
				a.find('.epl-date').text().trim() ||
				undefined;
			const locked = isLockedChapter($, el);
			pushChapter(href, numText, date, locked, i + 1);
		});

		if (!out.length) {
			$('a[href*="chapter"], .bxcl a, .chapter-list a').each((i, el) => {
				const href = $(el).attr('href') || '';
				if (!href || href.includes('/series/')) return;
				const parent = $(el).closest('li, div, tr');
				const raw =
					$(el).find('.epl-num').text() ||
					($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim();
				if (!/ch\.?\s*\d|chapter\s*\d/i.test(raw) && !/chapter/i.test(href)) return;
				const locked =
					isLockedChapter($, parent.get(0) as any) ||
					/\bunlocks?\s+in\b|\bpremium\b|\blocked\b/i.test(parent.text());
				const date =
					parent.find('.epl-date, .chapter-release-date, time, .date').text().trim() ||
					undefined;
				pushChapter(href, raw, date, locked, i + 1);
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
		if (/\/locked\//i.test(chapterId)) {
			return {
				title: 'Locked Chapter',
				content:
					'<p><em>This chapter is locked (paywall / members only). Read it on the website.</em></p>',
				prevChapterId: null,
				nextChapterId: null
			};
		}

		const path = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		this.assertNotCf(html);
		const $ = cheerio.load(html);

		const title =
			$('h1.entry-title, h1, h2.chapter-title, .reading-title, .c-breadcrumb li.active')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('title').text().split(/[|\-–]/)[0].trim() ||
			'Chapter';

		const containers = [
			'.epcontent',
			'.entry-content',
			'.chapter-content',
			'#chapter-content',
			'.reading-content',
			'.text-left',
			'article .content',
			'.post-content'
		];

		let contentHtml = '';
		for (const sel of containers) {
			const el = $(sel).first();
			if (!el.length) continue;
			const clone = el.clone();
			clone
				.find(
					'script, style, iframe, .ads, .ad, nav, .nav, .reader-settings, .comments, .code-block, .sharedaddy, .chapter-warning, .c-ads, .donat-template-block, .naveps, .ts-breadcrumb, .adblock_title, .adblock_subtitle'
				)
				.remove();

			const paras = clone.find('p');
			if (paras.length >= 2) {
				const parts: string[] = [];
				paras.each((_, p) => {
					const t = $(p).text().trim();
					if (!t) return;
					if (
						/ossantl\.my\.id|cloudflare|cookie|privacy|adblock|ads blocker|support us by disabling/i.test(
							t
						)
					)
						return;
					parts.push(`<p>${escapeHtml(t)}</p>`);
				});
				if (parts.length >= 2) {
					contentHtml = parts.join('\n');
					break;
				}
			}
			const inner = clone.html()?.trim() || '';
			if (inner.length > 200) {
				contentHtml = inner;
				break;
			}
		}

		if (!contentHtml || contentHtml.length < 50) {
			const parts: string[] = [];
			$('body p').each((_, p) => {
				const t = $(p).text().trim();
				if (t.length < 20) return;
				if (/ossantl|cloudflare|cookie|privacy|adblock|consent|support us/i.test(t)) return;
				parts.push(`<p>${escapeHtml(t)}</p>`);
			});
			if (parts.length) contentHtml = parts.join('\n');
		}

		if (
			!contentHtml ||
			contentHtml.length < 80 ||
			/unlock|premium|subscribe|members?\s+only|paywall/i.test(
				$('.entry-content, .epcontent, .chapter-content').text()
			)
		) {
			const lockHint =
				$('.premium-block, .c-premium, .locked-chapter, .paywall, .fa-lock').length > 0;
			if (lockHint || contentHtml.length < 80) {
				contentHtml =
					contentHtml ||
					'<p><em>Konten tidak tersedia — chapter kemungkinan paywall / masih locked.</em></p>';
			}
		}

		const prevHref =
			$('a[rel="prev"]').attr('href') ||
			$('.naveps a[rel="prev"], .nvs a[rel="prev"], a.prev, .ch-prev-btn, a.btn.prev_page')
				.filter((_, el) => {
					const h = $(el).attr('href') || '';
					return !!h && h !== '#' && !h.startsWith('javascript');
				})
				.first()
				.attr('href');

		const nextHref =
			$('a[rel="next"]').attr('href') ||
			$('.naveps a[rel="next"], .nvs a[rel="next"], a.next, .ch-next-btn, a.btn.next_page')
				.filter((_, el) => {
					const h = $(el).attr('href') || '';
					return !!h && h !== '#' && !h.startsWith('javascript');
				})
				.first()
				.attr('href');

		let prevId = prevHref ? pathOnly(prevHref, this.baseUrl) : null;
		let nextId = nextHref ? pathOnly(nextHref, this.baseUrl) : null;

		if (!prevId || !nextId) {
			$('.naveps a, .nvs a, .chapter-nav a').each((_, a) => {
				const h = $(a).attr('href') || '';
				if (!h || h === '#' || h.startsWith('javascript') || h.includes('/series/')) return;
				const txt = ($(a).text() + ' ' + ($(a).attr('class') || '')).toLowerCase();
				const icon = $(a).find('i, svg').attr('class') || '';
				if (!prevId && (/prev|previous|fa-angle-left|fa-arrow-left/i.test(txt + icon))) {
					prevId = pathOnly(h, this.baseUrl);
				}
				if (!nextId && (/next|fa-angle-right|fa-arrow-right/i.test(txt + icon))) {
					nextId = pathOnly(h, this.baseUrl);
				}
			});
		}

		return {
			title,
			content:
				contentHtml ||
				'<p><em>Konten kosong — kemungkinan diblokir Cloudflare atau selector berubah.</em></p>',
			prevChapterId: prevId,
			nextChapterId: nextId
		};
	}
}

export default OssanTLSource;
