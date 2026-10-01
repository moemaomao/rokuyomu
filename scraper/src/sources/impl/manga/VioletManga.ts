/**
 * Violet Manga / Violet Scans adapter (violetmanga.com)
 *
 * - Latest  : section "Latest Comics" di homepage (/) dan /page/N/
 * - Search  : /?s=query
 * - Detail  : /comics/{slug}/
 * - Chapter : /{slug}-chapter-{n}/  → ts_reader.run({ sources: [{ images: [...] }] })
 * - Premium : chapter dengan data-bs-target="#lockedChapterModal" / data-coin → isLocked: true
 *
 * Bahasa default: English
 */

import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types';
import * as cheerio from 'cheerio';

export class VioletMangaSource extends BaseSource {
	id = 'violetmanga';
	name = 'Violet Manga';
	baseUrl = 'https://violetmanga.com';
	private readonly DEFAULT_LANG = 'en';

	// ── Helpers ──────────────────────────────────────────────────────────────

	private absUrl(href: string): string {
		if (!href) return '';
		if (href.startsWith('http')) return href;
		if (href.startsWith('//')) return `https:${href}`;
		return `${this.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
	}

	private cleanId(link: string): string {
		let id = (link || '').trim();
		if (id.startsWith('http')) {
			try {
				id = new URL(id).pathname;
			} catch {
				/* ignore */
			}
		}
		if (!id.startsWith('/')) id = `/${id}`;
		return id.replace(/\/+$/, '') || '/';
	}

	private parseChapterNumber(raw: string): number {
		const m = String(raw || '').match(/(\d+(?:\.\d+)?)/);
		return m ? parseFloat(m[1]) : NaN;
	}

	private mapType(text: string): string {
		const t = text.toLowerCase();
		if (t.includes('manhwa')) return 'manhwa';
		if (t.includes('manhua')) return 'manhua';
		if (t.includes('manga')) return 'manga';
		return 'manhwa';
	}

	private mapStatus(text: string): string {
		const t = (text || '').toLowerCase();
		if (t.includes('complet')) return 'Completed';
		if (t.includes('hiatus')) return 'Hiatus';
		if (t.includes('drop') || t.includes('cancel')) return 'Cancelled';
		return 'Ongoing';
	}

private parseLatestCards($: cheerio.CheerioAPI): Manga[] {
	const res: Manga[] = [];
	const seen = new Set<string>();
	const $section = $('.violet-latest-comics, .bixbox.violet-latest-comics').first();
	const $cards = $section.length
		? $section.find('.violet-card-shell, .bs')
		: $('.violet-card-shell, .bs');

	$cards.each((_, el) => {
		const $card = $(el);
		const a =
			$card.find('a[href*="/comics/"]').first().attr('href') ||
			$card.find('.tt').closest('a').attr('href') ||
			$card.find('a').first().attr('href') ||
			'';
		if (!a || !a.includes('/comics/')) return;

		const id = this.cleanId(a);
		if (seen.has(id)) return;
		seen.add(id);

		const title =
			$card.find('.tt').first().text().replace(/\s+/g, ' ').trim() ||
			$card.find('a[title]').attr('title')?.trim() ||
			'';
		if (!title) return;

		const img = $card.find('img').first();
		let cover =
			img.attr('src') ||
			img.attr('data-src') ||
			img.attr('data-lazy-src') ||
			'';
		cover = this.absUrl(cover);

		const typeText =
			$card.find('.violet-format, .colored, span.type').first().text() ||
			$card.text();
		const type = this.mapType(typeText);

		const statusText =
			$card.find('.status i, .status, .status-dot').parent().text() ||
			$card.find('.status').text() ||
			'';
		const status = this.mapStatus(statusText);

		let latestChapter: string | undefined;
		$card.find('.epxs, .chapter-list .epxs').each((__, chEl) => {
			const t = $(chEl).text().replace(/\s+/g, ' ').trim();
			const n = this.parseChapterNumber(t);
			if (Number.isFinite(n)) {
				latestChapter = String(n);
				return false;
			}
		});

		res.push({
			id,
			title,
			cover,
			sourceId: this.id,
			type,
			status,
			latestChapter,
			lang: this.DEFAULT_LANG
		} as Manga & { lang?: string });
	});

	return res;
}

	private parseSearchCards($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		$('.listupd .bs, .listupd .bsx, .bs').each((_, el) => {
			const $card = $(el);
			const a = $card.find('a[href*="/comics/"]').first();
			const href = a.attr('href') || '';
			if (!href || href.includes('/chapter')) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			const title =
				$card.find('.tt').first().text().replace(/\s+/g, ' ').trim() ||
				a.attr('title')?.trim() ||
				'';
			if (!title) return;

			const img = $card.find('img').first();
			let cover =
				img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || '';
			cover = this.absUrl(cover);

			const type = this.mapType(
				$card.find('.violet-format, .colored, span.type').first().text() || $card.text()
			);
			const status = this.mapStatus($card.find('.status').text() || '');

			res.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type,
				status,
				lang: this.DEFAULT_LANG
			} as Manga & { lang?: string });
		});

		return res;
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
	page: number,
	_opts?: { lang?: string; type?: string }
): Promise<Manga[]> {
	const p = Math.max(1, Number(page) || 1);

	// Page 1: section "Latest Comics" di homepage
	if (p <= 1) {
		const html = await this.fetchHtml('/');
		const $ = cheerio.load(html);
		return this.parseLatestCards($);
	}

	// Page 2+: AJAX Load More (bukan /page/N/)
	const body = new URLSearchParams({
		action: 'load_more_manga_posts',
		page: String(p)
	});

	const res = await fetch(`${this.baseUrl}/wp-admin/admin-ajax.php`, {
		method: 'POST',
		headers: {
			...this.headers,
			'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
			Referer: `${this.baseUrl}/`,
			'X-Requested-With': 'XMLHttpRequest'
		},
		body: body.toString()
	});

	if (!res.ok) {
		throw new Error(`VioletManga load more failed: ${res.status}`);
	}

	const text = await res.text();
	let html = text;

	try {
		const json = JSON.parse(text) as { success?: boolean; data?: string };
		if (json && typeof json === 'object') {
			if (json.success === false) return [];
			if (typeof json.data === 'string') html = json.data;
		}
	} catch {
	}

	if (!html || !html.trim()) return [];

	const $ = cheerio.load(html);
	return this.parseLoadMoreCards($);
}

private parseLoadMoreCards($: cheerio.CheerioAPI): Manga[] {
	const res: Manga[] = [];
	const seen = new Set<string>();

	$('.violet-card-shell, .bs').each((_, el) => {
		const $card = $(el);
		const a =
			$card.find('a[href*="/comics/"]').first().attr('href') ||
			$card.find('.tt').closest('a').attr('href') ||
			$card.find('a').first().attr('href') ||
			'';
		if (!a || !a.includes('/comics/')) return;

		const id = this.cleanId(a);
		if (seen.has(id)) return;
		seen.add(id);

		const title =
			$card.find('.tt').first().text().replace(/\s+/g, ' ').trim() ||
			$card.find('a[title]').attr('title')?.trim() ||
			'';
		if (!title) return;

		const img = $card.find('img').first();
		let cover =
			img.attr('src') ||
			img.attr('data-src') ||
			img.attr('data-lazy-src') ||
			'';
		cover = this.absUrl(cover);

		const type = this.mapType(
			$card.find('.violet-format, .colored, span.type').first().text() ||
				$card.text()
		);
		const status = this.mapStatus($card.find('.status').text() || '');

		let latestChapter: string | undefined;
		$card.find('.epxs').each((__, chEl) => {
			const n = this.parseChapterNumber($(chEl).text());
			if (Number.isFinite(n)) {
				latestChapter = String(n);
				return false;
			}
		});

		res.push({
			id,
			title,
			cover,
			sourceId: this.id,
			type,
			status,
			latestChapter,
			lang: this.DEFAULT_LANG
		} as Manga & { lang?: string });
	});

	return res;
}

	async searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page || 1);
		if (!q) return this.getLatestManga(page, opts);

		const path =
			page <= 1
				? `/?s=${encodeURIComponent(q)}`
				: `/page/${page}/?s=${encodeURIComponent(q)}`;
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);
		return this.parseSearchCards($);
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);
		if (!path.includes('/comics/')) {
			path = `/comics/${path.replace(/^\//, '')}`;
		}

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			$('h1.entry-title, h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('title')
				.text()
				.replace(/\s*[|\-–].*$/, '')
				.trim();

		let cover =
			$('.thumb img, .seriestucontl img, .main-info img').first().attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = this.absUrl(cover);

		const description =
			$('.entry-content .wd-full p, .seriestucon .entry-content, .summary .entry-content, .desc')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('meta[name="description"]').attr('content')?.trim() ||
			'';

		let status = 'Ongoing';
		$('.imptdt, .spe span, .status').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (/status/i.test(t) || $(el).find('.status-dot').length) {
				status = this.mapStatus(t);
			}
		});
		const statusDot = $('.status-dot').attr('class') || '';
		if (statusDot) status = this.mapStatus(statusDot);

		const type = this.mapType(
			$('.violet-format, .colored').first().text() ||
				$('.imptdt').text() ||
				''
		);

		const genres: string[] = [];
		$('.mgen a, .seriestugenre a, a[href*="/genres/"]').each((_, el) => {
			const g = $(el).text().trim();
			if (g && !genres.includes(g)) genres.push(g);
		});

		const authors: string[] = [];
		$('.imptdt, .spe span, .fmed').each((_, el) => {
			const $el = $(el);
			const label = $el.text().toLowerCase();
			if (label.includes('author') || label.includes('artist')) {
				$el.find('a').each((__, a) => {
					const n = $(a).text().trim();
					if (n && !authors.includes(n)) authors.push(n);
				});
			}
		});

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('#chapterlist li, .eplister li, #chapterlist ul li').each((i, el) => {
			const $li = $(el);
			const $a = $li.find('a').first();
			if (!$a.length) return;

			const href = $a.attr('href') || '';
			const isLocked =
				!!$a.attr('data-bs-target')?.includes('lockedChapterModal') ||
				!!$a.attr('data-coin') ||
				!!$a.attr('data-bs-toggle')?.includes('modal') ||
				$li.find('.text-gold, [class*="lock"]').length > 0 ||
				/lock|premium|coin/i.test($a.html() || '');

			// Locked chapter sering tidak punya href normal
			let id = href ? this.cleanId(href) : '';
			if (!id || id === '/') {
				const dataTitle = $a.attr('data-title') || $li.find('.chapternum').text();
				const num = this.parseChapterNumber(dataTitle || String(i));
				id = `${path}-chapter-${Number.isFinite(num) ? num : i}`;
			}
			if (seen.has(id)) return;
			seen.add(id);

			const chText =
				$li.find('.chapternum').text().replace(/\s+/g, ' ').trim() ||
				$a.attr('data-title') ||
				$a.text().replace(/\s+/g, ' ').trim();
			let number = this.parseChapterNumber(
				$li.attr('data-num') || chText
			);
			if (!Number.isFinite(number)) number = i + 1;

			const date =
				$li.find('.chapterdate').text().replace(/\s+/g, ' ').trim() || undefined;

			chapters.push({
				id,
				title: chText.startsWith('Chapter') ? chText : `Chapter ${number}`,
				number,
				date,
				isLocked: isLocked || undefined
			});
		});

		chapters.sort((a, b) => b.number - a.number);

		const latestChapter =
			chapters.length > 0 ? String(chapters[0].number) : undefined;

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			type,
			description,
			authors,
			status,
			genres,
			chapters,
			latestChapter
		};
	}

	// ── Chapter pages ────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		const html = await this.fetchHtml(path);

		// ts_reader.run({...})
		const m = html.match(/ts_reader\.run\((\{[\s\S]*?\})\)/);
		if (m?.[1]) {
			try {
				const data = JSON.parse(m[1]);
				const sources = data.sources || [];
				for (const src of sources) {
					const images = src.images || src.images?.length ? src.images : null;
					if (Array.isArray(images) && images.length) {
						return images.map((u: string) => this.absUrl(String(u)));
					}
				}
			} catch (e) {
				console.error('[violetmanga] parse ts_reader failed', e);
			}
		}

		// Fallback: img di #readerarea / .readercontent
		const $ = cheerio.load(html);
		const pages: string[] = [];
		$('#readerarea img, .readercontent img, .entry-content img').each((_, el) => {
			const src =
				$(el).attr('src') ||
				$(el).attr('data-src') ||
				$(el).attr('data-lazy-src') ||
				'';
			if (
				src &&
				!src.includes('readerarea.svg') &&
				!src.includes('loading') &&
				!src.includes('gravatar') &&
				!src.includes('i.ibb.co')
			) {
				pages.push(this.absUrl(src));
			}
		});
		return pages;
	}
}

export default VioletMangaSource;