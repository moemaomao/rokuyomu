/**
 * KnoxT (knoxt.space) — Themesia "lightnovel" theme + StackProtect/CF
 * Path: scraper/src/sources/impl/novel/KnoxT.ts
 *
 * URLs:
 *   Latest  : /series/?order=update  (+ /page/{n}/)
 *   Search  : /?s={q}
 *   Novel   : /{slug}/
 *   Chapter : /{slug}-chapter-{n}/  (atau -chapter-{n}-end/)
 *
 * Selectors (Themesia LN):
 *   list cards : .listupd .bs / .bsx a, .series a
 *   detail     : .infox, .thumb img, .entry-content[itemprop=description]
 *   chapters   : .eplister li a  (.epl-num / .epl-title / .epl-date)
 *   content    : .entry-content[itemprop=text], .epcontent
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

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

function pathOnly(href: string, base: string): string {
	try {
		const u = new URL(
			href.startsWith('http')
				? href
				: `${base}${href.startsWith('/') ? '' : '/'}${href}`
		);
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		return href.startsWith('/') ? href.replace(/\/$/, '') || '/' : `/${href}`;
	}
}

function decodeEntities(s: string): string {
	return (s || '')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#039;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function stripHtml(html: string): string {
	return decodeEntities(
		html
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/p>/gi, '\n\n')
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

function parseChapterNumber(text: string, fallback = 0): number {
	const t = (text || '').replace(/\s+/g, ' ').trim();
	const m =
		t.match(/(?:chapter|ch\.?|chap)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	if (/prologue/i.test(t)) return 0;
	if (/epilogue|extra|end/i.test(t) && fallback > 0) return fallback;
	return fallback;
}

function isSeriesPath(path: string): boolean {
	if (!path || path === '/') return false;
	const p = path.replace(/\/$/, '');
	if (p.split('/').filter(Boolean).length !== 1) return false;
	const skip =
		/^(series|genre|type|writer|tag|page|all-novels|faq|recruitment|bookmarks|advertise-with-us|wp-json|wp-admin|wp-content|author|category|feed)$/i;
	const seg = p.replace(/^\//, '');
	if (skip.test(seg)) return false;
	if (/chapter/i.test(seg)) return false;
	return true;
}

function isChapterPath(path: string): boolean {
	return /chapter/i.test(path);
}

function largerCover(url: string): string {
	if (!url) return '';
	return url
		.replace(/\?.*$/, '')
		.replace(/-\d+x\d+(\.\w+)$/i, '$1')
		.replace(/[?&](w|h|resize|fit)=[^&]+/gi, '');
}

export class KnoxTSource extends BaseSource {
	id = 'knoxt';
	name = 'KnoxT';
	baseUrl = 'https://knoxt.space';

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept:
			'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: 'https://knoxt.space/'
	};

	protected async fetchHtml(path: string): Promise<string> {
	const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
	const headers: Record<string, string> = {
		...this.headers,
		Referer: this.baseUrl + '/'
	};
	const jar =
		(typeof process !== 'undefined' &&
			(process.env?.KNOXT_COOKIE || process.env?.KNOXT_COOKIES)) ||
		'';
	if (jar) {
		headers.Cookie = jar;
	}
	console.log(
		`[knoxt] GET ${url} cookie=${jar ? 'yes' : 'no'}`
	);
	return fetchWithCf(url, { headers });
    }

	private parseListCards($: cheerio.CheerioAPI, scope?: string): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();
		const root = scope ? $(scope) : $.root();

		const push = (href: string, title: string, cover: string, latest?: number) => {
			const id = pathOnly(href, this.baseUrl);
			if (!isSeriesPath(id) || seen.has(id)) return;
			const t = decodeEntities(title);
			if (!t || t.length < 2) return;
			seen.add(id);
			const card: Manga = {
				id,
				title: t,
				cover: largerCover(absUrl(this.baseUrl, cover)),
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: 'Ongoing'
			};
			if (latest != null && !Number.isNaN(latest) && latest > 0) {
				card.latestChapter = latest;
			}
			out.push(card);
		};

		// 1) Latest Release cards: .utao / .uta (homepage .releases.latesthome)
		root.find('.utao, .uta').each((_, el) => {
			const $el = $(el);
			const a = $el.find('a.series').first().length
				? $el.find('a.series').first()
				: $el.find('.imgu a, a[href]').first();
			const href = a.attr('href') || '';
			if (!href) return;
			const title =
				a.attr('title') ||
				$el.find('.luf h3, h3, h4, .tt').first().text() ||
				a.text();
			const cover =
				$el.find('img').attr('data-src') ||
				$el.find('img').attr('data-lazy-src') ||
				$el.find('img').attr('src') ||
				'';
			// Badge: chapter terbaru dari .luf ul li a pertama (Ch. 68)
			let latest: number | undefined;
			const chText =
				$el.find('.luf ul li a').first().text() ||
				$el.find('.epxs, .chapter, .nchapter a').first().text();
			if (chText) {
				const n = parseChapterNumber(chText, 0);
				if (n > 0) latest = n;
			}
			push(href, title, cover, latest);
		});

		// 2) Standard Themesia grid: .listupd .bsx
		if (out.length < 5) {
			root.find('.listupd .bs, .listupd .bsx, .bsx').each((_, el) => {
				const $el = $(el);
				const a = $el.find('a').first();
				const href = a.attr('href') || '';
				if (!href) return;
				const title =
					a.attr('title') ||
					$el.find('.tt, .ntt, h2, h3, h4').first().text() ||
					a.text();
				const cover =
					$el.find('img').attr('data-src') ||
					$el.find('img').attr('data-lazy-src') ||
					$el.find('img').attr('src') ||
					'';
				let latest: number | undefined;
				const chText = $el.find('.epxs, .chapter').first().text();
				if (chText) {
					const n = parseChapterNumber(chText, 0);
					if (n > 0) latest = n;
				}
				push(href, title, cover, latest);
			});
		}

		return out;
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		const p = Math.max(1, page | 0);
		const seen = new Set<string>();
		const merge = (items: Manga[]) => {
			const out: Manga[] = [];
			for (const m of items) {
				if (seen.has(m.id)) continue;
				seen.add(m.id);
				out.push(m);
			}
			return out;
		};

		let list: Manga[] = [];

		// Page 1: section Latest Release di homepage (prioritas)
		if (p === 1) {
			try {
				const home = await this.fetchHtml('/');
				const $h = cheerio.load(home);
				// Scope ke blok Latest Release saja
				const fromLatest = this.parseListCards(
					$h,
					'.releases.latesthome, .bixbox .listupd, .listupd'
				);
				list = merge(fromLatest);
			} catch {
				/* continue */
			}
		}

		// Series sorted by update (pagination) — isi sampai ≥24
		if (list.length < PAGE_SIZE) {
			const path =
				p <= 1
					? '/series/?status=&type=&order=update'
					: `/series/page/${p}/?status=&type=&order=update`;
			try {
				const html = await this.fetchHtml(path);
				list = merge([...list, ...this.parseListCards(cheerio.load(html))]);
			} catch {
				/* continue */
			}
		}

		// Page 1: jika masih kurang, ambil page 2 series
		if (p === 1 && list.length < PAGE_SIZE) {
			try {
				const html2 = await this.fetchHtml(
					'/series/page/2/?status=&type=&order=update'
				);
				list = merge([...list, ...this.parseListCards(cheerio.load(html2))]);
			} catch {
				/* continue */
			}
		}

		// Last resort: all-novels (alphabetical — hindari jika bisa)
		if (list.length < 1) {
			const allPath = p <= 1 ? '/all-novels/' : `/all-novels/page/${p}/`;
			const allHtml = await this.fetchHtml(allPath);
			list = merge(this.parseListCards(cheerio.load(allHtml)));
		}

		return list.slice(0, PAGE_SIZE);
	}

	async searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		if (!q) return this.getLatestManga(opts?.page ?? 1, opts);

		const p = Math.max(1, (opts?.page ?? 1) | 0);
		const path =
			p <= 1
				? `/?s=${encodeURIComponent(q)}`
				: `/page/${p}/?s=${encodeURIComponent(q)}`;
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);
		return this.parseListCards($).slice(0, PAGE_SIZE);
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		let path = pathOnly(mangaId, this.baseUrl);
		if (!path.startsWith('/')) path = `/${path}`;
		const fetchPath = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(fetchPath);
		const $ = cheerio.load(html);

		const title = decodeEntities(
			$('h1.entry-title, .infox h1, h1').first().text() ||
				$('meta[property="og:title"]').attr('content') ||
				''
		).replace(/\s*[-|–]\s*KnoxT.*$/i, '');

		let cover =
			$('.thumb img, .sertothumb img, .info-side img')
				.first()
				.attr('data-src') ||
			$('.thumb img, .sertothumb img').first().attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = largerCover(absUrl(this.baseUrl, cover));

		const altTitle = decodeEntities($('.infox .alter, span.alter').first().text());

		const authors: string[] = [];
		$('.spe span, .info-content span, .fmed').each((_, el) => {
			const label = $(el).find('b').first().text().replace(/:/g, '').trim();
			if (!/^authors?$/i.test(label)) return;
			$(el)
				.find('a')
				.each((__, a) => {
					const t = decodeEntities($(a).text());
					if (t && !authors.includes(t)) authors.push(t);
				});
			if (!authors.length) {
				const raw = decodeEntities($(el).clone().children('b').remove().end().text());
				for (const part of raw.split(/[,;/]+/)) {
					const t = part.trim();
					if (t && !authors.includes(t)) authors.push(t);
				}
			}
		});

		let status = 'Ongoing';
		let release = '';
		let language = '';
		let typeMeta = 'novel';
		$('.spe span, .info-content span').each((_, el) => {
			const label = $(el).find('b').first().text().replace(/:/g, '').trim().toLowerCase();
			const val = decodeEntities(
				$(el).clone().children('b').remove().end().text()
			);
			if (label === 'status' && val) {
				status = /complete/i.test(val) ? 'Completed' : /hiatus/i.test(val) ? 'Hiatus' : 'Ongoing';
			} else if (label === 'released' && val) {
				release = val;
			} else if ((label === 'native language' || label === 'language') && val) {
				language = val;
			} else if (label === 'type' && val) {
				typeMeta = val;
			}
		});

		// Genre HANYA dari blok info novel (.genxed / .mgen di dalam .infox / .bigcontent)
		// Jangan ambil semua a[href*="/genre/"] — itu nyampur sidebar/rekomendasi.
		const genres: string[] = [];
		const genreRoot = $(
			'.infox .genxed, .infox .mgen, .bigcontent .genxed, .bigcontent .mgen, .info-content .genxed'
		);
		if (genreRoot.length) {
			genreRoot.find('a[href*="/genre/"]').each((_, a) => {
				const g = decodeEntities($(a).text());
				if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
			});
		} else {
			$('.infox a[href*="/genre/"], .info-content a[href*="/genre/"], .spe a[href*="/genre/"]').each(
				(_, a) => {
					const g = decodeEntities($(a).text());
					if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
				}
			);
		}

		let description = '';
		const descEl = $(
			'.entry-content[itemprop="description"], .entry-content .desc, .synp .entry-content, .scontent'
		).first();
		if (descEl.length) {
			const clone = descEl.clone();
			clone.find('script, style, .code-block, .ad-container, .ads').remove();
			description = stripHtml(clone.html() || clone.text());
		}
		if (!description) {
			description =
				$('meta[property="og:description"]').attr('content')?.trim() || '';
		}

		// Meta lines for frontend parseMeta (satu key per baris)
		const metaLines: string[] = [];
		if (altTitle) metaLines.push(`Alt title: ${altTitle}`);
		if (typeMeta) metaLines.push(`Type: ${typeMeta}`);
		if (release) metaLines.push(`Published: ${release}`);
		if (language) metaLines.push(`Language: ${language}`);
		if (metaLines.length) {
			description = description
				? `${description}\n\n${metaLines.join('\n')}`
				: metaLines.join('\n');
		}

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		$('.eplister li a, .eplister a, #chapterlist a, .chapter-list a').each((i, a) => {
			const href = $(a).attr('href') || '';
			if (!href) return;
			const id = pathOnly(href, this.baseUrl);
			if (!isChapterPath(id) || seen.has(id)) return;
			seen.add(id);

			const numText =
				$(a).find('.epl-num').text() ||
				$(a).find('.epl-title').text() ||
				$(a).text() ||
				id;
			const num = parseChapterNumber(numText + ' ' + id, chapters.length + 1);
			const date = decodeEntities($(a).find('.epl-date').text()) || undefined;

			// Clean list title
			chapters.push({
				id,
				title: `Chapter ${num}`,
				number: num,
				date: date || undefined
			});
		});

		chapters.sort((a, b) => b.number - a.number);

		return {
			id: path.replace(/\/$/, '') || path,
			title: title || path,
			cover,
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters,
			type: 'novel',
			lang: 'en',
			...(chapters[0]?.number != null ? { latestChapter: chapters[0].number } : {})
		};
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
		let path = pathOnly(chapterId, this.baseUrl);
		if (!path.startsWith('/')) path = `/${path}`;
		const fetchPath = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(fetchPath);
		const $ = cheerio.load(html);

		const rawTitle = decodeEntities(
			$('h1.entry-title, h1').first().text() ||
				$('title').text().split(/[|\-–]/)[0] ||
				''
		);
		const num = parseChapterNumber(rawTitle + ' ' + path, 0);
		const title = num > 0 ? `Chapter ${num}` : rawTitle || 'Chapter';

		const container = $(
			'.entry-content[itemprop="text"], .epcontent, .entry-content, .reader-area'
		).first();
		if (!container.length) {
			throw new Error('Chapter content empty on KnoxT');
		}

		const clone = container.clone();
		clone
			.find(
				'script, style, noscript, iframe, .code-block, .ad-container, .ads, .kln, .sharedaddy, .jp-relatedposts, nav, .nav-links, .chapternav'
			)
			.remove();

		let contentHtml = '';
		const paras = clone.find('p');
		if (paras.length) {
			const parts: string[] = [];
			paras.each((_, p) => {
				const t = $(p).text().trim();
				if (!t) return;
				if (
					/knoxt|donate|ko-fi|discord|advertisement|subscribe|patreon/i.test(t) &&
					t.length < 120
				) {
					return;
				}
				parts.push(`<p>${escapeHtml(t)}</p>`);
			});
			contentHtml = parts.join('\n');
		}
		if (!contentHtml) contentHtml = (clone.html() || '').trim();

		const plain = contentHtml.replace(/<[^>]+>/g, '').trim();
		if (plain.length < 40) {
			throw new Error('Chapter content empty or locked on KnoxT');
		}

		// Prev / next from chapter nav links
		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		$('a[href*="chapter"], .nav-previous a, .nav-next a, a.ch-prev-btn, a.ch-next-btn').each(
			(_, a) => {
				const href = $(a).attr('href') || '';
				const id = pathOnly(href, this.baseUrl);
				if (!isChapterPath(id)) return;
				const label = ($(a).text() + ' ' + ($(a).attr('rel') || '') + ' ' + ($(a).attr('class') || '')).toLowerCase();
				if (/prev|sebelum|back/i.test(label) && !prevChapterId) prevChapterId = id;
				if (/next|lanjut|forward/i.test(label) && !nextChapterId) nextChapterId = id;
			}
		);

		return {
			title,
			content: contentHtml,
			prevChapterId,
			nextChapterId
		};
	}
}

export default KnoxTSource;
