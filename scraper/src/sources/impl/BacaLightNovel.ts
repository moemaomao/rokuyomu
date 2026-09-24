/**
 * BacaLightNovel.co — Themesia LightNovel theme
 * Path: scraper/src/sources/impl/BacaLightNovel.ts
 *
 * Fixes:
 * - Homepage target 24 + badge Ch.XX (.epx / .epxs / .bigor)
 * - Detail: selector Themesia lebih lengkap (seriestu*, eplister, #chapterlist)
 * - Chapter title pendek "Chapter N"
 *
 * WAJIB hybrid Worker (Cloudflare ketat).
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
			const [home, p1, p2, p3] = await Promise.all([
				this.parseHomeLatest().catch(() => [] as Manga[]),
				this.fetchSeriesPage(1).catch(() => [] as Manga[]),
				this.fetchSeriesPage(2).catch(() => [] as Manga[]),
				this.fetchSeriesPage(3).catch(() => [] as Manga[])
			]);
			return this.dedupeById([...home, ...p1, ...p2, ...p3]).slice(0, 24);
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

	private assertNotCf(html: string): void {
		const low = html.slice(0, 2000).toLowerCase();
		if (
			(low.includes('just a moment') || low.includes('cf-browser-verification') || low.includes('challenge-platform')) &&
			html.length < 20000
		) {
			throw new Error('Cloudflare blocked this request');
		}
	}

	private async parseHomeLatest(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		this.assertNotCf(html);
		const $ = cheerio.load(html);
		const list: Manga[] = [];

		const selectors = [
			'.listupd .bs',
			'.listupd .bsx',
			'.bixbox .bs',
			'.bixbox .bsx',
			'.bs',
			'.bsx'
		];

		for (const sel of selectors) {
			$(sel).each((_, el) => {
				const item = this.parseCard($, el);
				if (item && !list.some((x) => x.id === item.id)) list.push(item);
			});
			if (list.length >= 20) break;
		}
		return list;
	}

	/** Ambil nomor chapter dari kartu Themesia */
	private extractLatestChapter($: cheerio.CheerioAPI, el: any): number | undefined {
		const root = $(el);
		const candidates = [
			root.find('.epx').first().text(),
			root.find('.epxs').first().text(),
			root.find('.bigor .epx').first().text(),
			root.find('.bigor .epxs').first().text(),
			root.find('.adds .epx').first().text(),
			root.find('.chapter').first().text(),
			root.find('.lchapter').first().text(),
			root.find('.latest').first().text(),
			root.find('.latest-chapter').first().text(),
			root.find('a[href*="chapter"]').first().text(),
			root.find('[class*="chapter"]').first().text()
		];
		for (const raw of candidates) {
			const n = extractChapterNum(raw);
			if (n != null) return n;
		}
		// Fallback: teks kartu yang mengandung chapter/ch
		const hit = root
			.find('span, div, a, small')
			.filter((_, s) => /(?:chapter|ch\.?|bab)\s*\d/i.test($(s).text()))
			.first()
			.text();
		return extractChapterNum(hit) ?? extractChapterNum(root.text());
	}

	private parseCard($: cheerio.CheerioAPI, el: any): Manga | null {
		const a =
			$(el).find('a[href*="/series/"]').first().length > 0
				? $(el).find('a[href*="/series/"]').first()
				: $(el).find('a').first();
		const href = a.attr('href') || '';
		if (!href || !/\/series\//.test(href)) return null;
		if (href.endsWith('/series/') || /\/series\/page\//.test(href) || /\/series\/list-mode/.test(href))
			return null;

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

		const latestChapter = this.extractLatestChapter($, el);

		return {
			id: pathOnly(href),
			title: title.replace(/\s+/g, ' ').trim(),
			cover: absUrl(this.baseUrl, (cover || '').split('?')[0]),
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
			this.assertNotCf(html);
			const $ = cheerio.load(html);
			const list: Manga[] = [];
			$('.listupd .bs, .listupd .bsx, .bixbox .bs, .bixbox .bsx, .bs, .bsx').each((_, el) => {
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
		const paths = [`/?s=${q}`, `/page/${page}/?s=${q}`, `/advanced-search/?title=${q}&page=${page}`];

		for (const path of paths) {
			try {
				const html = await this.fetchHtml(path);
				this.assertNotCf(html);
				const $ = cheerio.load(html);
				const list: Manga[] = [];
				$('.listupd .bs, .listupd .bsx, .bixbox .bs, .bs, .bsx').each((_, el) => {
					const item = this.parseCard($, el);
					if (item && !list.some((x) => x.id === item.id)) list.push(item);
				});
				if (list.length) return list;
			} catch {
				/* next */
			}
		}
		return [];
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		// Normalisasi id → selalu /series/slug/
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		if (!path.includes('/series/')) {
			path = `/series${path.startsWith('/') ? path : `/${path}`}`;
		}
		path = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(path);
		this.assertNotCf(html);
		const $ = cheerio.load(html);

		const title =
			$('.seriestuheader h1').first().text().trim() ||
			$('.series-titlex h1, .series-title h1').first().text().trim() ||
			$('h1.entry-title').first().text().trim() ||
			$('h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/[|\-–]/)[0].trim() ||
			$('title').text().split(/[|\-–]/)[0].trim();

		if (!title || title.length < 2) {
			throw new Error('Manga not found (empty title)');
		}

		const cover =
			$('.seriestucont .thumb img').attr('data-src') ||
			$('.seriestucont .thumb img').attr('src') ||
			$('.series-thumb img, .thumb img').attr('data-src') ||
			$('.series-thumb img, .thumb img').attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';

		// Synopsis — Themesia
		let description = '';
		const synSelectors = [
			'.seriestuhead .entry-content',
			'.entry-content.seriestucontent',
			'.series-synops',
			'.seriestucontent',
			'.entry-content'
		];
		for (const sel of synSelectors) {
			const el = $(sel).first();
			if (!el.length) continue;
			const parts = el
				.find('p')
				.map((_, p) => $(p).text().trim())
				.get()
				.filter((t) => t.length > 20);
			if (parts.length) {
				description = parts.join('\n\n');
				break;
			}
			const t = el.text().replace(/\s+/g, ' ').trim();
			if (t.length > 80) {
				description = t;
				break;
			}
		}

		const authors: string[] = [];
		const artists: string[] = [];
		const genres: string[] = [];
		let altTitle = '';
		let typeLabel = 'novel';
		let status = 'Ongoing';
		let published = '';

		// Info list Themesia
		$('.seriestuinfoleft li, .seriestuinfo li, .info-desc tr, .spe span, .wd-full, .fmed').each(
			(_, el) => {
				const label =
					$(el).find('b, strong').first().text().toLowerCase().trim() ||
					$(el).text().split(':')[0]?.toLowerCase().trim() ||
					'';
				const valueText = $(el)
					.clone()
					.children('b, strong')
					.remove()
					.end()
					.text()
					.replace(/^[:\s]+/, '')
					.replace(/\s+/g, ' ')
					.trim();
				const links: string[] = [];
				$(el)
					.find('a')
					.each((_, a) => {
						const t = $(a).text().trim();
						if (t) links.push(t);
					});

				if (/author|penulis|pengarang/i.test(label)) {
					for (const n of links.length ? links : valueText ? [valueText] : []) {
						if (n && !authors.includes(n)) authors.push(n);
					}
				} else if (/artist|ilustrator/i.test(label)) {
					for (const n of links.length ? links : valueText ? [valueText] : []) {
						if (n && !artists.includes(n)) artists.push(n);
					}
				} else if (/alternative|judul lain|native|other name/i.test(label)) {
					altTitle = links.join(', ') || valueText;
				} else if (/type|tipe|jenis/i.test(label)) {
					typeLabel = links[0] || valueText || typeLabel;
				} else if (/status/i.test(label)) {
					status = links[0] || valueText || status;
				} else if (/genre/i.test(label)) {
					for (const g of links.length ? links : valueText.split(/[,/]/)) {
						const t = g.trim();
						if (t && !genres.includes(t)) genres.push(t);
					}
				} else if (/released|tahun|year|dirilis/i.test(label)) {
					published = valueText;
				}
			}
		);

		$('.seriestugenre a, .genre-info a, a[href*="/genres/"], a[href*="/genre/"]').each((_, a) => {
			const g = $(a).text().trim();
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		if (!authors.length && artists.length) authors.push(...artists);

		const statusBadge = $('.status, span.status').first().text().trim();
		if (statusBadge && /ongoing|completed|tamat|hiatus|complete/i.test(statusBadge)) {
			status = statusBadge;
		}

		let rating: string | undefined;
		const ratingText = $('.rating .numscore, .rating-prc, [class*="rating"]').first().text().trim();
		if (ratingText) {
			const m = ratingText.match(/(\d+(?:\.\d+)?)/);
			if (m) rating = m[1];
		}

		// Chapters — Themesia eplister / #chapterlist
		const rawChapters: Chapter[] = [];
		const seen = new Set<string>();

		const chapterSelectors = [
			'#chapterlist li',
			'.eplister li',
			'ul.clstyle li',
			'.chapter-list li',
			'.eplister ul li'
		];

		for (const sel of chapterSelectors) {
			const items = $(sel);
			if (!items.length) continue;
			items.each((i, el) => {
				const a = $(el).find('a').first();
				const href = a.attr('href') || '';
				if (!href || href === '#' || href.startsWith('javascript')) return;

				const rawTitle = (
					a.attr('title') ||
					$(el).find('.epl-num, .chapternum, .epl-title, .chap').text() ||
					a.text()
				)
					.replace(/\s+/g, ' ')
					.trim();
				if (!rawTitle || rawTitle.length < 1) return;

				const date =
					$(el).find('.epl-date, .chapterdate, span.date').text().trim() || undefined;
				const num = parseChapterNumber(rawTitle, i + 1);
				const id = pathOnly(href);
				if (seen.has(id)) return;
				seen.add(id);

				rawChapters.push({
					id,
					title: `Chapter ${num}`,
					number: num,
					date
				});
			});
			if (rawChapters.length) break;
		}

		// Fallback: link chapter di halaman
		if (!rawChapters.length) {
			$('a[href*="chapter"]').each((i, el) => {
				const href = $(el).attr('href') || '';
				if (!href) return;
				const rawTitle = ($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim();
				if (!rawTitle || rawTitle.length < 2) return;
				const num = parseChapterNumber(rawTitle, i + 1);
				const id = pathOnly(href);
				if (seen.has(id)) return;
				seen.add(id);
				rawChapters.push({ id, title: `Chapter ${num}`, number: num });
			});
		}

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
		this.assertNotCf(html);
		const $ = cheerio.load(html);

		const title =
			$('h1.entry-title, h1, h2.title-chapter, .chapter-title').first().text().trim() ||
			$('title').text().split(/[|\-–]/)[0].trim() ||
			'Chapter';

		const containers = [
			'.epcontent.entry-content',
			'.entry-content .epcontent',
			'#readerarea',
			'.reader-area',
			'.epcontent',
			'.entry-content',
			'.reading-content',
			'#chapter-content',
			'.chapter-content'
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
					if (/bacalightnovel\.co|sakuranovel\.id/i.test(t)) return;
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
				if (/bacalightnovel|sakuranovel|cloudflare|cookie|privacy|adblock/i.test(t)) return;
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
