/**
 * Red Panda Translations — Themesia novel TL
 * https://redpanda-translations.com/
 *
 * Latest  : homepage section "Latest Release" (.bixbox.releases.latesthome .listupd / .utao)
 * Series  : /series/{slug}/
 * Chapter : /{slug}-ch{n}/  atau /{slug}-ch{n}-{m}/
 * Archive : /series/?order=update  + /series/page/{n}/?order=update
 * Search  : /?s={q}
 *
 * Konten = text novel → getChapterPages() = []
 * Chapter title dibersihkan jadi "Chapter N" saja.
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://redpanda-translations.com';
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

function parseChapterNumber(title: string, fallback = 0): number {
	const t = cleanText(title);
	const m =
		t.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\bch\.?\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/(\d+(?:\.\d+)?)/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function shortChapterTitle(number: number): string {
	return number > 0 ? `Chapter ${number}` : 'Chapter';
}

function seriesPathFromHref(href: string): string | null {
	const id = pathOnly(href);
	const m = id.match(/\/series\/([^/]+)/);
	if (m && !/\/series\/?(list-mode|page|feed)?$/i.test(id)) {
		return `/series/${m[1]}`;
	}
	// chapter URL → series: /{slug}-ch{n}/ → /series/{slug}
	const ch = id.match(/^\/(.+)-ch[\d.]+(?:-[\d.]+)?(?:-.*)?$/i);
	if (ch) return `/series/${ch[1]}`;
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

export class RedPandaTranslationsSource extends BaseSource {
	id = 'redpandatranslations';
	name = 'Red Panda Translations';
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
			const fromHome = await this.parseLatestReleaseHome().catch(() => [] as Manga[]);
			if (fromHome.length >= 8) return fromHome.slice(0, PER_PAGE);
		}
		return this.parseSeriesArchive(page);
	}

	private async parseLatestReleaseHome(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		const $ = cheerio.load(html);
		$('script, style, noscript, iframe').remove();

		const list: Manga[] = [];
		const seen = new Set<string>();

		const root =
			$('.bixbox.releases.latesthome, .releases.latesthome, .bixbox.releases').first().length > 0
				? $('.bixbox.releases.latesthome, .releases.latesthome, .bixbox.releases').first()
				: $('body');

		root.find('.utao, .uta, .bsx, .bs').each((_, el) => {
			const item = this.parseCard($, el);
			if (item && !seen.has(item.id)) {
				seen.add(item.id);
				list.push(item);
			}
		});

		if (list.length < 8) {
			root.find('a[href*="/series/"]').each((_, a) => {
				const seriesId = seriesPathFromHref($(a).attr('href') || '');
				if (!seriesId || seen.has(seriesId)) return;
				const title = cleanText($(a).attr('title') || $(a).text());
				if (!title || title.length < 2) return;
				const parent = $(a).closest('.utao, .uta, .bsx, .bs, li, article, div');
				const img =
					parent.find('img').first().attr('data-src') ||
					parent.find('img').first().attr('src') ||
					'';
				const chText =
					parent.find('.nchapter, .chapter, a[href*="-ch"]').first().text() || '';
				const n = parseChapterNumber(chText);
				seen.add(seriesId);
				list.push({
					id: seriesId,
					title: title.slice(0, 200),
					cover: absUrl((img || '').split('?')[0]),
					sourceId: this.id,
					type: 'novel',
					lang: 'en',
					...(n > 0 ? { latestChapter: n } : {})
				});
			});
		}

		return list;
	}

	private async parseSeriesArchive(page: number): Promise<Manga[]> {
		const path =
			page <= 1
				? '/series/?order=update'
				: `/series/page/${page}/?order=update`;
		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			$('script, style, noscript').remove();

			const list: Manga[] = [];
			const seen = new Set<string>();

			$('.listupd .bsx, .listupd .bs, .bsx, .bs, .utao').each((_, el) => {
				const item = this.parseCard($, el);
				if (item && !seen.has(item.id)) {
					seen.add(item.id);
					list.push(item);
				}
			});

			if (list.length < 4) {
				$('a[href*="/series/"]').each((_, a) => {
					const seriesId = seriesPathFromHref($(a).attr('href') || '');
					if (!seriesId || seen.has(seriesId)) return;
					const title = cleanText($(a).attr('title') || $(a).text());
					if (!title || title.length < 2) return;
					const parent = $(a).closest('.bsx, .bs, .utao, article, li, div');
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
			}

			return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[redpandatranslations] archive', page, e);
			return [];
		}
	}

	private parseCard($: cheerio.CheerioAPI, el: any): Manga | null {
		const root = $(el);

		const a = root
			.find('a[href*="/series/"]')
			.filter((_, link) => {
				const h = pathOnly($(link).attr('href') || '');
				return /\/series\/[^/]+\/?$/.test(h) && !/\/series\/(page|list-mode|feed)/i.test(h);
			})
			.first();

		let href = a.attr('href') || root.find('a[href*="/series/"]').first().attr('href') || '';
		let seriesId = seriesPathFromHref(href);

		if (!seriesId) {
			const chHref =
				root.find('a[href*="-ch"]').first().attr('href') ||
				root.find('a[href*="-ch"]').first().attr('href') ||
				'';
			seriesId = seriesPathFromHref(chHref || '');
		}
		if (!seriesId) return null;

		const title =
			cleanText(a.attr('title') || '') ||
			cleanText(root.find('.ntitle, .tt, .title, h2, h3, a.series').first().text()) ||
			cleanText(a.text());
		if (!title || title.length < 2) return null;

		const img =
			root.find('img').first().attr('data-src') ||
			root.find('img').first().attr('data-lazy-src') ||
			root.find('img').first().attr('src') ||
			'';

		let latestChapter: number | undefined;
		const chLinks = root.find('a[href*="-ch"]');
		if (chLinks.length) {
			const first = chLinks.first();
			const fromText = parseChapterNumber(cleanText(first.text()));
			const fromHref = parseChapterNumber(pathOnly(first.attr('href') || ''));
			const n = fromText > 0 ? fromText : fromHref;
			if (n > 0) latestChapter = n;
		}
		if (latestChapter == null) {
			const chText = cleanText(root.find('.nchapter, .chapter, .epx, .luf li').first().text());
			const n = parseChapterNumber(chText);
			if (n > 0) latestChapter = n;
		}

		let status: string | undefined;
		const st = cleanText(root.find('.status, .todstat, [class*="status"]').first().text());
		if (st) status = normalizeStatus(st);

		return {
			id: seriesId,
			title: title.slice(0, 200),
			cover: absUrl((img || '').split('?')[0]),
			sourceId: this.id,
			type: 'novel',
			status,
			lang: 'en',
			...(latestChapter != null ? { latestChapter } : {})
		};
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

			$('.listupd .bsx, .listupd .bs, .bsx, .bs, .utao').each((_, el) => {
				const item = this.parseCard($, el);
				if (item && !seen.has(item.id)) {
					seen.add(item.id);
					list.push(item);
				}
			});

			if (list.length < 2) {
				$('a[href*="/series/"]').each((_, a) => {
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

			return list;
		} catch (e) {
			console.error('[redpandatranslations] search', e);
			return [];
		}
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = pathOnly(mangaId);
		if (!path.startsWith('/series/')) {
			path = `/series/${path.replace(/^\//, '')}`;
		}
		path = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);
		$('script, style, noscript, iframe').remove();

		const title =
			cleanText($('h1.entry-title, h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '')
				.split(/\s*[|\-–]\s*/)[0]
				.trim() ||
			'';

		if (!title || title.length < 2) {
			throw new Error('Novel not found (empty title)');
		}

		let cover =
			$('.sertothumb img, .thumb img, .sertobig img').first().attr('data-src') ||
			$('.sertothumb img, .thumb img, .sertobig img').first().attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			$('img.wp-post-image').first().attr('src') ||
			'';
		cover = absUrl((cover || '').split('?')[0]);

		// Synopsis
		let description =
			cleanText($('.sersysn, .sersys.entry-content, .entry-content.sersys, .series-synops').first().text()) ||
			cleanText($('meta[name="description"]').attr('content') || '') ||
			'';
		if (description.length > 4000) description = description.slice(0, 4000) + '…';

		const authors: string[] = [];
		const genres: string[] = [];
		let status = 'Ongoing';
		let altTitle = '';
		let release = '';

		$('.serl, .sertoinfo .infox, .infotable tr').each((_, el) => {
			const label = cleanText(
				$(el).find('.sername, th, .fiv').first().text()
			).toLowerCase();
			const valEl = $(el).find('.serval, td, .fw').first();
			const val = cleanText(valEl.text());
			if (!label && !val) return;

			if (/author|writer/i.test(label)) {
				valEl.find('a').each((_, a) => {
					const n = cleanText($(a).text());
					if (n && !authors.includes(n)) authors.push(n);
				});
				if (!authors.length && val) authors.push(val);
			} else if (/artist/i.test(label)) {
				valEl.find('a').each((_, a) => {
					const n = cleanText($(a).text());
					if (n && !authors.includes(n)) authors.push(n);
				});
			} else if (/genre|tag/i.test(label)) {
				valEl.find('a').each((_, a) => {
					const g = cleanText($(a).text());
					if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
				});
				if (!genres.length && val) {
					for (const g of val.split(/[,/|]/)) {
						const t = g.trim();
						if (t && t.length < 40 && !genres.includes(t)) genres.push(t);
					}
				}
			} else if (/status/i.test(label)) {
				status = normalizeStatus(val);
			} else if (/alternative|alt\.?\s*title|other name/i.test(label)) {
				altTitle = val;
			} else if (/release|year|published/i.test(label)) {
				release = val;
			} else if (/type/i.test(label) && val && !genres.includes(val)) {
				genres.unshift(val);
			}
		});

		const badge = cleanText($('.sertostat, .status-value, .status').first().text());
		if (badge) status = normalizeStatus(badge);

		$('a[href*="/genre/"], a[href*="/genres/"]').each((_, a) => {
			const g = cleanText($(a).text());
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		const metaExtra: string[] = [];
		if (altTitle) metaExtra.push(`Alternative: ${altTitle}`);
		if (release) metaExtra.push(`Release: ${release}`);
		if (metaExtra.length) {
			description = (description ? description + '\n\n' : '') + metaExtra.join('\n');
		}

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('.eplister a, .eplisterfull a, #chapterlist a, .clstyle a').each((_, a) => {
			const href = $(a).attr('href') || '';
			const id = pathOnly(href);
			if (!id || seen.has(id)) return;
			if (!/-ch[\d.]+/i.test(id) && !/\/chapter/i.test(id)) return;
			seen.add(id);

			const numText =
				cleanText($(a).find('.chapternum, .epl-num').text()) ||
				cleanText($(a).text());
			const number = parseChapterNumber(numText, chapters.length + 1);
			const date =
				cleanText($(a).find('.chapterdate, .epl-date').text()) || undefined;

			chapters.push({
				id,
				title: shortChapterTitle(number),
				number,
				date
			});
		});

		if (!chapters.length) {
			$('a[href*="-ch"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const id = pathOnly(href);
				if (!id || seen.has(id) || !/-ch[\d.]+/i.test(id)) return;
				seen.add(id);
				const number = parseChapterNumber(cleanText($(a).text()), chapters.length + 1);
				chapters.push({
					id,
					title: shortChapterTitle(number),
					number
				});
			});
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
		if (!path || path === '/') {
			throw new Error('Invalid chapterId');
		}

		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const rawTitle =
			cleanText($('h1.entry-title, h1, .entry-header h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '') ||
			'Chapter';
		const number = parseChapterNumber(rawTitle || path);
		const title = shortChapterTitle(number > 0 ? number : 0) || rawTitle;

		const contentEl = $('.epcontent').first().length
			? $('.epcontent').first()
			: $('#readerarea, .reader-area, .epcontent.entry-content').first();

		if (!contentEl.length) {
			throw new Error(`Chapter content not found: ${path}`);
		}

		contentEl
			.find(
				'script, style, noscript, iframe, .ads, .ad, .code-block, nav, .sharedaddy, .misc, .socials, .tts__listent_content, [class*="tts_"]'
			)
			.remove();

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

		const textLen = content.replace(/<[^>]+>/g, '').trim().length;
		if (textLen < 40) {
			const plain = contentEl.text().replace(/\s+/g, ' ').trim();
			if (plain.length < 40) {
				throw new Error(`Chapter empty: ${path}`);
			}
			content = plain
				.split(/\n+/)
				.map((p) => p.trim())
				.filter((p) => p.length > 0)
				.map(
					(p) =>
						`<p>${p
							.replace(/&/g, '&amp;')
							.replace(/</g, '&lt;')
							.replace(/>/g, '&gt;')}</p>`
				)
				.join('\n');
		}

		// Next / Prev
		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		const prevA = $('a[rel="prev"], .ch-prev-btn, a.prevchap, .nav-previous a').first();
		const nextA = $('a[rel="next"], .ch-next-btn, a.nextchap, .nav-next a').first();

		if (prevA.length) {
			const h = prevA.attr('href') || '';
			if (h) prevChapterId = pathOnly(h);
		}
		if (nextA.length) {
			const h = nextA.attr('href') || '';
			if (h) nextChapterId = pathOnly(h);
		}

		if (!prevChapterId || !nextChapterId) {
			const options = $('select.chapter option, select.sl-chap option, .navigator select option');
			const ids: string[] = [];
			options.each((_, opt) => {
				const v = $(opt).attr('value') || $(opt).attr('data-url') || '';
				if (v && (v.includes('-ch') || v.includes('/'))) ids.push(pathOnly(v));
			});
			const idx = ids.findIndex((id) => id === path || path.startsWith(id));
			if (idx >= 0) {
				if (!nextChapterId && idx > 0) nextChapterId = ids[idx - 1];
				if (!prevChapterId && idx < ids.length - 1) prevChapterId = ids[idx + 1];
			}
		}

		return {
			title,
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default RedPandaTranslationsSource;
