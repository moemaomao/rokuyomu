/**
 * Sakuranovel.id — hybrid worker adapter (Cloudflare Worker)
 * Path: frontend/src/lib/server/workerSources/impl/Sakuranovel.ts
 *
 * Fixes:
 * - Homepage: ambil lebih banyak judul (target ~24)
 * - Chapter list: chapter terbaru di atas
 * - Metadata: status, type, authors, genres, alt title, rating lebih lengkap
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
				: `https://sakuranovel.id${href.startsWith('/') ? '' : '/'}${href}`
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

/** Extract chapter number from title e.g. "Chapter 282 – ..." → 282 */
function parseChapterNumber(title: string, fallback: number): number {
	const m =
		title.match(/chapter\s*(\d+(?:\.\d+)?)/i) ||
		title.match(/\bch\.?\s*(\d+(?:\.\d+)?)/i) ||
		title.match(/\b(\d+(?:\.\d+)?)\s*[-–—]/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

export class SakuranovelSource extends BaseSource {
	id = 'sakuranovel';
	name = 'Sakuranovel';
	baseUrl = 'https://sakuranovel.id';

	/**
	 * Latest list for homepage.
	 * Halaman /series/ sering hanya ~10–12 kartu → gabung homepage + page 1–3.
	 */
	async getLatestManga(page = 1): Promise<Manga[]> {
		if (page <= 1) {
			const [home, p1, p2, p3] = await Promise.all([
				this.parseHomeLatest().catch(() => [] as Manga[]),
				this.fetchSeriesPage(1).catch(() => [] as Manga[]),
				this.fetchSeriesPage(2).catch(() => [] as Manga[]),
				this.fetchSeriesPage(3).catch(() => [] as Manga[])
			]);
			// Home dulu (punya latestChapter), lalu series pages
			const merged = this.dedupeById([...home, ...p1, ...p2, ...p3]);
			return merged.slice(0, 24);
		}
		return this.fetchSeriesPage(page);
	}

	private async fetchSeriesPage(page: number): Promise<Manga[]> {
		const path = page <= 1 ? '/series/' : `/series/page/${page}/`;
		const html = await this.fetchHtml(path);
		return this.parseSeriesCards(html);
	}

	/** Kartu "Latest Update" di homepage — biasanya lebih fresh */
	private async parseHomeLatest(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		const $ = cheerio.load(html);
		const list: Manga[] = [];

		// Beberapa layout: latest update / listupd / flexbox
		const selectors = [
			'.listupd .bs',
			'.listupd .bsx',
			'.latest .series',
			'.flexbox2 .flexbox2-item',
			'.serieslist .serieslist-item',
			'article.series',
			'.post-item'
		];

		for (const sel of selectors) {
			$(sel).each((_, el) => {
				const a = $(el).find('a[href*="/series/"]').first();
				const href = a.attr('href') || $(el).find('a').first().attr('href') || '';
				if (!href || !/\/series\//.test(href)) return;
				const title =
					a.attr('title') ||
					$(el).find('.tt, .title, h2, h3, .series-title, .entry-title').first().text().trim() ||
					a.text().trim();
				const cover =
					$(el).find('img').attr('data-src') ||
					$(el).find('img').attr('data-lazy-src') ||
					$(el).find('img').attr('src') ||
					'';
				const status =
					$(el).find('.status, .status-series, .hot').text().trim() || undefined;
				const typeText =
					$(el).find('.type, .series-type, span.type').first().text().trim() || 'novel';
				if (!title || title.length < 2) return;
				const id = pathOnly(href);
				if (list.some((x) => x.id === id)) return;
				const latestRaw =
					$(el).find('.epx, .chapter, .latest, .latest-chapter, .lchapter').first().text().trim() ||
					'';
				const chMatch =
					latestRaw.match(/(?:chapter|ch\.?|bab)\s*(\d+(?:\.\d+)?)/i) ||
					latestRaw.match(/(\d+(?:\.\d+)?)/);
				list.push({
					id,
					title,
					cover: absUrl(this.baseUrl, cover.split('?')[0]),
					sourceId: this.id,
					type: typeText || 'novel',
					status,
					lang: 'id',
					latestChapter: chMatch ? chMatch[1] : latestRaw || undefined
				});
			});
			if (list.length >= 16) break;
		}
		return list;
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

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		try {
			const body = new URLSearchParams({
				action: 'data_fetch',
				keyword: query
			});
			const res = await fetch(`${this.baseUrl}/wp-admin/admin-ajax.php`, {
				method: 'POST',
				headers: {
					...this.headers,
					'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
					'X-Requested-With': 'XMLHttpRequest',
					Referer: this.baseUrl + '/',
					Origin: this.baseUrl
				},
				body: body.toString()
			});
			if (res.ok) {
				const html = await res.text();
				const $ = cheerio.load(html);
				const list: Manga[] = [];
				$('.searchbox').each((_, el) => {
					const a = $(el).find('a').first();
					const href = a.attr('href') || '';
					const title = a.attr('title') || a.text().trim();
					const cover = $(el).find('img').attr('src') || '';
					const status = $(el).find('.status').text().trim() || undefined;
					const typeText = $(el)
						.find('.type')
						.map((_, t) => $(t).text().trim())
						.get()
						.filter(Boolean)
						.join(', ');
					if (href && title) {
						list.push({
							id: pathOnly(href),
							title,
							cover: absUrl(this.baseUrl, cover.split('?')[0]),
							sourceId: this.id,
							type: typeText || 'novel',
							status,
							lang: 'id'
						});
					}
				});
				if (list.length) return list;
			}
		} catch {
			/* fall through */
		}

		const page = opts?.page ?? 1;
		const q = encodeURIComponent(query);
		const html = await this.fetchHtml(`/advanced-search/?title=${q}&page=${page}`);
		return this.parseSeriesCards(html);
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const root = $('.series .container .series-flex');
		const left = root.find('.series-flexleft');
		const right = root.find('.series-flexright');

		const title =
			left.find('.series-titlex h2').text().trim() ||
			$('h1').first().text().trim() ||
			$('title').text().split('|')[0].trim();

		const cover =
			left.find('img').attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';

		const description = right
			.find('.series-synops p')
			.map((_, el) => $(el).text().trim())
			.get()
			.filter(Boolean)
			.join('\n\n');

		const authors: string[] = [];
		const artists: string[] = [];
		let altTitle = '';
		let typeLabel = 'novel';
		let published = '';

		left.find('ul.series-infolist li').each((_, el) => {
			const label = $(el).find('b').text().toLowerCase().trim();
			const valueText = $(el)
				.clone()
				.children('b')
				.remove()
				.end()
				.text()
				.trim();
			const links: string[] = [];
			$(el)
				.find('a')
				.each((_, a) => {
					const t = $(a).text().trim();
					if (t) links.push(t);
				});

			if (label.includes('author') || label.includes('penulis') || label.includes('pengarang')) {
				const names = links.length ? links : valueText ? [valueText] : [];
				for (const n of names) {
					if (n && !authors.includes(n)) authors.push(n);
				}
			} else if (label.includes('artist') || label.includes('ilustrator')) {
				const names = links.length ? links : valueText ? [valueText] : [];
				for (const n of names) {
					if (n && !artists.includes(n)) artists.push(n);
				}
			} else if (
				label.includes('alternative') ||
				label.includes('judul lain') ||
				label.includes('native') ||
				label.includes('original')
			) {
				altTitle = links.join(', ') || valueText;
			} else if (label.includes('type') || label.includes('tipe') || label.includes('jenis')) {
				typeLabel = links.join(', ') || valueText || typeLabel;
			} else if (label.includes('released') || label.includes('tahun') || label.includes('year')) {
				published = valueText;
			}
		});

		// Gabung artist ke authors jika kosong
		if (!authors.length && artists.length) authors.push(...artists);

		const genres: string[] = [];
		right.find('.series-genres a').each((_, el) => {
			const g = $(el).text().trim();
			if (g) genres.push(g);
		});

		let status = 'Ongoing';
		left.find('.series-infoz.block span, .series-infoz span').each((_, el) => {
			const cls = ($(el).attr('class') || '').toLowerCase();
			const t = $(el).text().trim();
			if (cls.includes('status') || /ongoing|completed|tamat|hiatus|complete/i.test(t)) {
				status = t || status;
			}
			// Type badge di infoz (China / Japan / Korea / Web Novel)
			if (cls.includes('type') || /china|japan|korea|web\s*novel|light\s*novel/i.test(t)) {
				if (t && typeLabel === 'novel') typeLabel = t;
			}
		});

		// Rating
		let rating: string | undefined;
		const ratingEl = left.find('.series-infoz .rating, .rating, [class*="rating"]').first();
		if (ratingEl.length) {
			rating = ratingEl.text().trim() || ratingEl.attr('data-rating') || undefined;
		}

		// ── Chapters: site biasanya newest-first; pastikan newest di atas ──
		const rawChapters: Chapter[] = [];
		right.find('ul.series-chapterlists li').each((i, el) => {
			const a = $(el).find('a').first();
			const href = a.attr('href') || '';
			const ctitle = (a.attr('title') || a.text().trim()).replace(/\s+/g, ' ').trim();
			const date = $(el).find('span.date').text().trim() || undefined;
			if (href && ctitle) {
				rawChapters.push({
					id: pathOnly(href),
					title: ctitle,
					number: parseChapterNumber(ctitle, i + 1),
					date
				});
			}
		});

		// Sort: chapter number descending (newest / highest first)
		rawChapters.sort((a, b) => {
			const na = typeof a.number === 'number' ? a.number : parseChapterNumber(a.title, 0);
			const nb = typeof b.number === 'number' ? b.number : parseChapterNumber(b.title, 0);
			if (nb !== na) return nb - na;
			// fallback: jika number sama, jaga urutan DOM (asumsi newest first di HTML)
			return 0;
		});

		const chapters = rawChapters;

		const details: MangaDetails = {
			id: pathOnly(path),
			title,
			cover: absUrl(this.baseUrl, cover),
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters,
			type: typeLabel || 'novel',
			lang: 'id'
		};

		// Field ekstra jika tipe mendukung (hindari break type)
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
			/just a moment|cf-browser-verification|challenge-platform|verify you are human/i.test(
				html
			) &&
			bodyText.length < 500
		) {
			throw new Error('Cloudflare blocked this request');
		}

		const title =
			$('h2.title-chapter').first().text().trim() ||
			$('h1').first().text().trim() ||
			$('title').text().split('|')[0].trim() ||
			'Chapter';

		const containers = [
			'main .content .asdasd',
			'main .content',
			'.entry-content',
			'.reading-content',
			'#chapter-content',
			'.chapter-content',
			'article .content',
			'article',
			'.post-content',
			'#content'
		];

		let contentHtml = '';
		for (const sel of containers) {
			const el = $(sel).first();
			if (!el.length) continue;

			const clone = el.clone();
			clone
				.find('script, style, iframe, .ads, .ad, nav, .nav, .reader-settings, .comments')
				.remove();

			const paras = clone.find('p');
			if (paras.length >= 2) {
				const parts: string[] = [];
				paras.each((_, p) => {
					const t = $(p).text().trim();
					if (!t) return;
					if (/sakuranovel\.id/i.test(t)) return;
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
				if (/sakuranovel|cloudflare|cookie|privacy/i.test(t)) return;
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

	/** Ambil teks chapter terbaru dari kartu (untuk badge Ch. di homepage) */
	private extractLatestChapter($: cheerio.CheerioAPI, el: any): string | undefined {
		const root = $(el);
		const candidates = [
			root.find('.epx').first().text(),
			root.find('.chapter').first().text(),
			root.find('.latest').first().text(),
			root.find('.latest-chapter').first().text(),
			root.find('.lchapter').first().text(),
			root.find('.bigor .epxs').first().text(),
			root.find('[class*="chapter"]').first().text(),
			root.find('span').filter((_, s) => /chapter|ch\.?\s*\d|bab\s*\d/i.test($(s).text())).first().text()
		];
		for (const raw of candidates) {
			const t = (raw || '').replace(/\s+/g, ' ').trim();
			if (!t) continue;
			// Ambil nomor jika ada, biar badge "Ch. 123"
			const m = t.match(/(?:chapter|ch\.?|bab)\s*(\d+(?:\.\d+)?)/i) || t.match(/(\d+(?:\.\d+)?)/);
			if (m) return m[1];
			if (t.length < 40) return t;
		}
		return undefined;
	}

	private parseSeriesCards(html: string): Manga[] {
		const $ = cheerio.load(html);
		const list: Manga[] = [];

		const cards = $(
			[
				'.series-card',
				'.listupd .bs',
				'.listupd .bsx',
				'article.series',
				'.flexbox .series',
				'.flexbox2-item',
				'.series-item',
				'.list-series .item',
				'.serieslist li',
				'.post-list .post',
				'.bs',
				'.bsx'
			].join(', ')
		);

		if (cards.length) {
			cards.each((_, el) => {
				const a =
					$(el).find('a[href*="/series/"]').first().length > 0
						? $(el).find('a[href*="/series/"]').first()
						: $(el).find('a').first();
				const href = a.attr('href') || '';
				const title =
					a.attr('title') ||
					$(el).find('.tt, .title, h2, h3, .series-title, .entry-title').first().text().trim() ||
					a.text().trim();
				const cover =
					$(el).find('img').attr('data-src') ||
					$(el).find('img').attr('data-lazy-src') ||
					$(el).find('img').attr('src') ||
					'';
				const status =
					$(el).find('.status, .status-series').text().trim() || undefined;
				const typeText =
					$(el).find('.type, span.type, .series-type').first().text().trim() || 'novel';
				const latestChapter = this.extractLatestChapter($, el);
				if (href && title && /\/series\//.test(href)) {
					const id = pathOnly(href);
					if (list.some((x) => x.id === id)) return;
					list.push({
						id,
						title,
						cover: absUrl(this.baseUrl, cover.split('?')[0]),
						sourceId: this.id,
						type: typeText || 'novel',
						status,
						lang: 'id',
						latestChapter
					});
				}
			});
		}

		if (!list.length) {
			$('a[href*="/series/"]').each((_, el) => {
				const href = $(el).attr('href') || '';
				if (!href || href.endsWith('/series/') || /\/series\/page\//.test(href)) return;
				const title = $(el).attr('title') || $(el).text().trim();
				if (!title || title.length < 2) return;
				const parent = $(el).closest('div, article, li');
				const cover =
					parent.find('img').attr('data-src') || parent.find('img').attr('src') || '';
				const id = pathOnly(href);
				if (list.some((x) => x.id === id)) return;
				const latestChapter = this.extractLatestChapter($, parent.get(0) || el);
				list.push({
					id,
					title,
					cover: absUrl(this.baseUrl, cover.split('?')[0]),
					sourceId: this.id,
					type: 'novel',
					lang: 'id',
					latestChapter
				});
			});
		}

		return list;
	}
}

export default SakuranovelSource;
