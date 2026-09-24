/**
 * BacaLightNovel.co — Themesia LightNovel theme
 * Path: scraper/src/sources/impl/BacaLightNovel.ts
 *
 * URL pattern:
 *   Series list : /series/  |  /series/page/{n}/
 *   Series page : /series/{slug}/
 *   Chapter     : /{slug}-chapter-{n}/   (flat di root)
 *
 * Catatan: situs dilindungi Cloudflare → sebaiknya hybrid Worker.
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types';

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
				: `https://bacalightnovel.co${href.startsWith('/') ? '' : '/'}${href}`
		);
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		return href.startsWith('/') ? href : `/${href}`;
	}
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
		title.match(/\bbab\s*(\d+(?:\.\d+)?)/i) ||
		title.match(/(\d+(?:\.\d+)?)\s*[-–—]/) ||
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
		t.match(/(?:chapter|ch\.?|bab)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/(\d+(?:\.\d+)?)/);
	if (!m) return undefined;
	const n = parseFloat(m[1]);
	return Number.isNaN(n) ? undefined : n;
}

export class BacaLightNovelSource extends BaseSource {
	id = 'bacalightnovel';
	name = 'BacaLightNovel';
	baseUrl = 'https://bacalightnovel.co';

	async getLatestManga(page = 1): Promise<Manga[]> {
		if (page <= 1) {
			const [home, p1, p2] = await Promise.all([
				this.parseHomeLatest().catch(() => [] as Manga[]),
				this.fetchSeriesPage(1).catch(() => [] as Manga[]),
				this.fetchSeriesPage(2).catch(() => [] as Manga[])
			]);
			return this.dedupeById([...home, ...p1, ...p2]).slice(0, 24);
		}
		return this.fetchSeriesPage(page);
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

	/** Homepage — update terbaru / novel baru */
	private async parseHomeLatest(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		const $ = cheerio.load(html);
		const list: Manga[] = [];

		const selectors = [
			'.listupd .bs',
			'.listupd .bsx',
			'.bixbox .bs',
			'.bixbox .bsx',
			'.series-card',
			'article.series',
			'.post-item',
			'.flexbox .series'
		];

		for (const sel of selectors) {
			$(sel).each((_, el) => {
				const item = this.parseCard($, el);
				if (item && !list.some((x) => x.id === item.id)) list.push(item);
			});
			if (list.length >= 16) break;
		}

		// Fallback: link /series/
		if (list.length < 8) {
			$('a[href*="/series/"]').each((_, el) => {
				const href = $(el).attr('href') || '';
				if (!href || href.endsWith('/series/') || /\/series\/page\//.test(href)) return;
				if (!/\/series\/[^/]+\/?$/.test(href.replace(this.baseUrl, ''))) return;
				const title = ($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim();
				if (!title || title.length < 2) return;
				const parent = $(el).closest('div, article, li');
				const cover =
					parent.find('img').attr('data-src') ||
					parent.find('img').attr('data-lazy-src') ||
					parent.find('img').attr('src') ||
					'';
				const id = pathOnly(href);
				if (list.some((x) => x.id === id)) return;
				const chText =
					parent.find('.epx, .chapter, .lchapter, a[href*="chapter"]').first().text() || '';
				const latestChapter = extractChapterNum(chText);
				list.push({
					id,
					title,
					cover: absUrl(this.baseUrl, cover.split('?')[0]),
					sourceId: this.id,
					type: 'novel',
					lang: 'id',
					...(latestChapter != null ? { latestChapter } : {})
				});
			});
		}

		return list;
	}

	private parseCard($: cheerio.CheerioAPI, el: any): Manga | null {
		const a =
			$(el).find('a[href*="/series/"]').first().length > 0
				? $(el).find('a[href*="/series/"]').first()
				: $(el).find('a').first();
		const href = a.attr('href') || '';
		if (!href || !/\/series\//.test(href)) return null;
		if (href.endsWith('/series/') || /\/series\/page\//.test(href)) return null;

		const title =
			a.attr('title') ||
			$(el).find('.tt, .title, h2, h3, .series-title, .entry-title').first().text().trim() ||
			a.text().trim();
		if (!title || title.length < 2) return null;

		const cover =
			$(el).find('img').attr('data-src') ||
			$(el).find('img').attr('data-lazy-src') ||
			$(el).find('img').attr('src') ||
			'';

		const status =
			$(el).find('.status, .status-series, .hot').text().trim() || undefined;
		const typeText =
			$(el).find('.type, .series-type, span.type').first().text().trim() || 'novel';

		const chText =
			$(el).find('.epx, .epxs, .chapter, .latest, .lchapter, .latest-chapter').first().text() ||
			$(el).find('a[href*="chapter"]').first().text() ||
			'';
		const latestChapter = extractChapterNum(chText);

		return {
			id: pathOnly(href),
			title: title.replace(/\s+/g, ' ').trim(),
			cover: absUrl(this.baseUrl, cover.split('?')[0]),
			sourceId: this.id,
			type: typeText || 'novel',
			status,
			lang: 'id',
			...(latestChapter != null ? { latestChapter } : {})
		};
	}

	private async fetchSeriesPage(page: number): Promise<Manga[]> {
		const path = page <= 1 ? '/series/' : `/series/page/${page}/`;
		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list: Manga[] = [];
			const cards = $(
				[
					'.listupd .bs',
					'.listupd .bsx',
					'.bixbox .bs',
					'.series-card',
					'article.series',
					'.bs',
					'.bsx'
				].join(', ')
			);
			cards.each((_, el) => {
				const item = this.parseCard($, el);
				if (item && !list.some((x) => x.id === item.id)) list.push(item);
			});
			return list;
		} catch {
			return [];
		}
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = encodeURIComponent(query);

		// Themesia: sering pakai ?s= atau advanced-search
		const paths = [
			`/?s=${q}`,
			`/page/${page}/?s=${q}`,
			`/advanced-search/?title=${q}&page=${page}`
		];

		for (const path of paths) {
			try {
				const html = await this.fetchHtml(path);
				const $ = cheerio.load(html);
				const list: Manga[] = [];
				const cards = $(
					'.listupd .bs, .listupd .bsx, .bixbox .bs, .series-card, article.series, .bs, .bsx'
				);
				cards.each((_, el) => {
					const item = this.parseCard($, el);
					if (item && !list.some((x) => x.id === item.id)) list.push(item);
				});
				if (list.length) return list;
			} catch {
				/* try next */
			}
		}
		return [];
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const title =
			$('.seriestuheader h1, .series-title h1, h1.entry-title').first().text().trim() ||
			$('h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content')?.split('|')[0].trim() ||
			$('title').text().split('|')[0].trim();

		const cover =
			$('.seriestucont .thumb img, .series-thumb img, .thumb img').attr('data-src') ||
			$('.seriestucont .thumb img, .series-thumb img, .thumb img').attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';

		// Synopsis
		let description = '';
		const syn = $('.seriestuhead .entry-content, .series-synops, .entry-content.seriestucontent');
		if (syn.length) {
			description = syn
				.find('p')
				.map((_, p) => $(p).text().trim())
				.get()
				.filter(Boolean)
				.join('\n\n');
			if (!description) description = syn.text().replace(/\s+/g, ' ').trim();
		}
		if (!description) {
			description = $('.entry-content p')
				.map((_, p) => $(p).text().trim())
				.get()
				.filter((t) => t.length > 40)
				.slice(0, 6)
				.join('\n\n');
		}

		const authors: string[] = [];
		const artists: string[] = [];
		const genres: string[] = [];
		let altTitle = '';
		let typeLabel = 'novel';
		let status = 'Ongoing';
		let published = '';

		// Themesia info table
		$('.seriestuinfoleft li, .info-desc tr, .spe span, .wd-full').each((_, el) => {
			const text = $(el).text().replace(/\s+/g, ' ').trim();
			const label = $(el).find('b, strong').first().text().toLowerCase().trim() ||
				text.split(':')[0]?.toLowerCase() ||
				'';
			const valueText = $(el)
				.clone()
				.children('b, strong')
				.remove()
				.end()
				.text()
				.replace(/^[:\s]+/, '')
				.trim();
			const links: string[] = [];
			$(el)
				.find('a')
				.each((_, a) => {
					const t = $(a).text().trim();
					if (t) links.push(t);
				});

			if (/author|penulis|pengarang/i.test(label)) {
				const names = links.length ? links : valueText ? [valueText] : [];
				for (const n of names) {
					if (n && !authors.includes(n)) authors.push(n);
				}
			} else if (/artist|ilustrator/i.test(label)) {
				const names = links.length ? links : valueText ? [valueText] : [];
				for (const n of names) {
					if (n && !artists.includes(n)) artists.push(n);
				}
			} else if (/alternative|judul lain|native|other name/i.test(label)) {
				altTitle = links.join(', ') || valueText;
			} else if (/type|tipe|jenis/i.test(label)) {
				typeLabel = links[0] || valueText || typeLabel;
			} else if (/status/i.test(label)) {
				status = links[0] || valueText || status;
			} else if (/genre/i.test(label)) {
				for (const g of links.length ? links : valueText.split(/,|\//)) {
					const t = g.trim();
					if (t && !genres.includes(t)) genres.push(t);
				}
			} else if (/released|tahun|year|dirilis/i.test(label)) {
				published = valueText;
			}
		});

		// Genre chips
		$('.seriestugenre a, .genre-info a, a[href*="/genres/"], a[href*="/genre/"]').each((_, a) => {
			const g = $(a).text().trim();
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		if (!authors.length && artists.length) authors.push(...artists);

		// Status badge
		const statusBadge = $('.status, .//hot, span.status').first().text().trim();
		if (statusBadge && /ongoing|completed|tamat|hiatus/i.test(statusBadge)) {
			status = statusBadge;
		}

		let rating: string | undefined;
		const ratingText = $('.rating .numscore, .rating-prc, [class*="rating"]').first().text().trim();
		if (ratingText) {
			const m = ratingText.match(/(\d+(?:\.\d+)?)/);
			if (m) rating = m[1];
		}

		// ── Chapters ──
		// Themesia: .eplister li / #chapterlist li / .chapter-list li
		const rawChapters: Chapter[] = [];
		const chapterSelectors = [
			'#chapterlist li',
			'.eplister li',
			'.chapter-list li',
			'ul.clstyle li',
			'.eplister ul li'
		];

		for (const sel of chapterSelectors) {
			const items = $(sel);
			if (!items.length) continue;
			items.each((i, el) => {
				const a = $(el).find('a').first();
				const href = a.attr('href') || '';
				if (!href) return;
				const rawTitle = (
					a.attr('title') ||
					$(el).find('.epl-num, .chapternum, .epl-title').text() ||
					a.text()
				)
					.replace(/\s+/g, ' ')
					.trim();
				if (!rawTitle) return;
				const date =
					$(el).find('.epl-date, .chapterdate, span.date').text().trim() || undefined;
				const num = parseChapterNumber(rawTitle, i + 1);
				rawChapters.push({
					id: pathOnly(href),
					title: `Chapter ${num}`,
					number: num,
					date
				});
			});
			if (rawChapters.length) break;
		}

		// Fallback: semua link chapter
		if (!rawChapters.length) {
			$('a[href*="chapter"]').each((i, el) => {
				const href = $(el).attr('href') || '';
				if (!href) return;
				const rawTitle = ($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim();
				if (!rawTitle || rawTitle.length < 2) return;
				const num = parseChapterNumber(rawTitle, i + 1);
				const id = pathOnly(href);
				if (rawChapters.some((c) => c.id === id)) return;
				rawChapters.push({
					id,
					title: `Chapter ${num}`,
					number: num
				});
			});
		}

		// Newest first
		rawChapters.sort((a, b) => {
			const na = typeof a.number === 'number' ? a.number : 0;
			const nb = typeof b.number === 'number' ? b.number : 0;
			return nb - na;
		});

		const details: MangaDetails = {
			id: pathOnly(path),
			title,
			cover: absUrl(this.baseUrl, cover),
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters: rawChapters,
			type: typeLabel || 'novel',
			lang: 'id'
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

		const bodyText = $('body').text();
		if (
			/just a moment|cf-browser-verification|challenge-platform|verify you are human/i.test(html) &&
			bodyText.length < 500
		) {
			throw new Error('Cloudflare blocked this request');
		}

		const title =
			$('h1.entry-title, h1, h2.title-chapter, .chapter-title').first().text().trim() ||
			$('title').text().split('|')[0].trim() ||
			'Chapter';

		const containers = [
			'.epcontent.entry-content',
			'.entry-content .epcontent',
			'#readerarea',
			'.reader-area',
			'.entry-content',
			'.reading-content',
			'#chapter-content',
			'.chapter-content',
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
					'script, style, iframe, .ads, .ad, nav, .nav, .reader-settings, .comments, .code-block, .sharedaddy, .chlu, .chapter-nav'
				)
				.remove();

			const paras = clone.find('p');
			if (paras.length >= 2) {
				const parts: string[] = [];
				paras.each((_, p) => {
					const t = $(p).text().trim();
					if (!t) return;
					if (/bacalightnovel\.co/i.test(t)) return;
					if (/^daftar isi$/i.test(t)) return;
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
				if (/bacalightnovel|cloudflare|cookie|privacy|adblock/i.test(t)) return;
				parts.push(`<p>${escapeHtml(t)}</p>`);
			});
			if (parts.length) contentHtml = parts.join('\n');
		}

		const prevHref =
			$('a[rel="prev"]').attr('href') ||
			$('a.prev, .nav-previous a, a:contains("Sebelumnya")').first().attr('href');
		const nextHref =
			$('a[rel="next"]').attr('href') ||
			$('a.next, .nav-next a, a:contains("Selanjutnya")').first().attr('href');

		return {
			title,
			content:
				contentHtml ||
				'<p><em>Konten kosong — kemungkinan diblokir Cloudflare atau selector berubah.</em></p>',
			prevChapterId: prevHref ? pathOnly(prevHref) : null,
			nextChapterId: nextHref ? pathOnly(nextHref) : null
		};
	}
}

export default BacaLightNovelSource;
