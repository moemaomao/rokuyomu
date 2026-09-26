/**
 * MadaraScans adapter (https://madarascans.org)
 *
 * Theme: Themesia / WordPress mangareader
 * Series list  : /series/  |  /series/?order=update&page={n}
 * Search       : /?s={q}   |  /?s={q}&page={n}
 * Detail       : /series/{slug}/
 * Chapter      : /{slug}-chapter-{n}/
 * Pages        : ts_reader.run({ sources:[{ images:[...] }] })
 *
 * ID format:
 *   manga   : /series/{slug}
 *   chapter : /{slug}-chapter-{n}
 *
 * Bahasa default: English
 *
 * Catatan pagination (Sep 2026):
 * Path-style /series/page/N/?order=update rusak di situs
 * (semua page mengembalikan konten page 1).
 * Harus pakai query-style: /series/?order=update&page=N
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class MadaraScansSource extends BaseSource {
	id = 'madarascans';
	name = 'MadaraScans';
	baseUrl = 'https://madarascans.org';

	private readonly PER_PAGE = 24;
	private readonly SITE_PER_PAGE = 30;
	private readonly DEFAULT_LANG = 'en';

	private absUrl(url: string): string {
		if (!url) return '';
		if (url.startsWith('http')) return url;
		if (url.startsWith('//')) return `https:${url}`;
		return `${this.baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
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
		return id.replace(/\/+$/, '').split('?')[0] || '/';
	}

	private normalizeTitle(raw: string): string {
		if (!raw) return '';
		return raw
			.trim()
			.replace(/\s+/g, ' ')
			.replace(/\s*[-|]\s*Madarascans.*$/i, '')
			.replace(/\s*Manga\s*$/i, '')
			.trim();
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath = path.match(/-chapter-(\d+)(?:[.-](\d+))?/i);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null && fromPath[2].length <= 2) {
				return parseFloat(`${major}.${fromPath[2]}`);
			}
			return major;
		}
		const m = String(text).match(/(?:chapter|chap|ch\.?)\s*(\d+)(?:[.,](\d+))?/i);
		if (m) {
			if (m[2] != null) return parseFloat(`${m[1]}.${m[2]}`);
			return parseInt(m[1], 10);
		}
		const n = String(text).match(/\b(\d+(?:\.\d+)?)\b/);
		return n ? parseFloat(n[1]) : 0;
	}

	private mapStatus(raw: string): string {
		const s = String(raw || '').toLowerCase();
		if (/complete|end|finished/.test(s)) return 'Completed';
		if (/hiatus/.test(s)) return 'Hiatus';
		if (/drop|cancel/.test(s)) return 'Dropped';
		return 'Ongoing';
	}

	private mapType(raw: string): string {
		const t = String(raw || '').toLowerCase();
		if (t.includes('manhwa')) return 'manhwa';
		if (t.includes('manhua')) return 'manhua';
		return 'manga';
	}

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const mangas: Manga[] = [];
		const seen = new Set<string>();

		$('.listupd .bs, .bs').each((_, card) => {
			const $card = $(card);

			const $link = $card
				.find('a[href*="/series/"]')
				.filter((_, a) => {
					const h = ($(a).attr('href') || '').split('?')[0];
					return /\/series\/[^/]+\/?$/.test(h);
				})
				.first();

			const href = $link.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (!/^\/series\/[^/]+$/i.test(id) || seen.has(id)) return;
			if (/\/series\/(page|list-mode|feed)/i.test(id)) return;
			seen.add(id);

			const title =
				this.normalizeTitle(
					$link.attr('title') ||
						$card.find('.tt').first().text() ||
						$card.find('img').attr('alt') ||
						''
				) || id.split('/').pop() || id;

			const $img = $card.find('img').first();
			let cover =
				$img.attr('data-src') ||
				$img.attr('data-lazy-src') ||
				$img.attr('src') ||
				'';
			if (cover.startsWith('data:')) cover = '';
			cover = this.absUrl(cover);

			const statusText =
				$card.find('.status i, .imptdt .status').text() ||
				$card.find('.status-dot').attr('class') ||
				'';
			const status = this.mapStatus(statusText);

			const cardText = $card.text();
			let type = 'manga';
			if (/\bmanhwa\b/i.test(cardText)) type = 'manhwa';
			else if (/\bmanhua\b/i.test(cardText)) type = 'manhua';

			let latestChapter: string | undefined;
			const epText = $card.find('.epxs').first().text().replace(/\s+/g, ' ').trim();
			if (epText) {
				const n = this.parseChapterNumber(epText);
				if (n > 0) latestChapter = String(n);
				else {
					const cleaned = epText.replace(/^chapter\s*/i, '').replace(/\s*END\s*$/i, '').trim();
					if (cleaned && cleaned !== '?' && cleaned !== '0') latestChapter = cleaned;
				}
			}
			if (!latestChapter) {
				const cardHtml = $.html($card) || '';
				const em =
					cardHtml.match(/class=["']epxs["'][^>]*>\s*Chapter\s*([\d.]+)/i) ||
					cardHtml.match(/Chapter\s+([\d.]+)\s*(?:END)?/i);
				if (em?.[1]) latestChapter = em[1];
			}
			if (!latestChapter) {
				const chHref =
					$card.find('a[href*="-chapter-"]').attr('href') ||
					'';
				const n2 = this.parseChapterNumber('', chHref);
				if (n2 > 0) latestChapter = String(n2);
			}

			mangas.push({
				id,
				sourceId: this.id,
				title,
				cover,
				type,
				status,
				latestChapter,
				lang: this.DEFAULT_LANG
			});
		});

		return mangas;
	}

	private async fetchCatalogPages(
		buildPath: (sitePage: number) => string,
		appPage: number
	): Promise<Manga[]> {
		const p = Math.max(1, Number(appPage) || 1);
		const start = (p - 1) * this.PER_PAGE;
		const siteStart = Math.floor(start / this.SITE_PER_PAGE) + 1;
		const offsetInFirst = start % this.SITE_PER_PAGE;

		const merged: Manga[] = [];
		const seen = new Set<string>();

		for (
			let sp = siteStart;
			sp <= siteStart + 2 && merged.length < offsetInFirst + this.PER_PAGE;
			sp++
		) {
			try {
				const html = await this.fetchHtml(buildPath(sp));
				const list = this.parseCards(cheerio.load(html));
				for (const m of list) {
					if (seen.has(m.id)) continue;
					seen.add(m.id);
					merged.push(m);
				}
				if (list.length === 0) break;
			} catch (e) {
				console.error('[madarascans] catalog page', sp, e);
				break;
			}
		}

		return merged.slice(offsetInFirst, offsetInFirst + this.PER_PAGE);
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			
			const list = await this.fetchCatalogPages((sitePage) => {
				if (sitePage <= 1) return `/series/?order=update`;
				return `/series/?order=update&page=${sitePage}`;
			}, page);

			console.log(`[madarascans] latest page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[madarascans] getLatestManga', e);
			return [];
		}
	}

	async searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page || 1);
		if (!q) return this.getLatestManga(page, opts);

		try {
			const list = await this.fetchCatalogPages((sitePage) => {
				const params = new URLSearchParams({ s: q });
				if (sitePage > 1) {
					params.set('page', String(sitePage));
				}
				return `/?${params.toString()}`;
			}, page);

			console.log(`[madarascans] search "${q}" page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[madarascans] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);

		if (/chapter/i.test(path) && !path.startsWith('/series/')) {
			const slug = path
				.replace(/^\//, '')
				.replace(/-chapter-[\d.]+\/?$/i, '');
			path = `/series/${slug}`;
		}
		if (!path.startsWith('/series/')) {
			path = `/series/${path.replace(/^\//, '')}`;
		}

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			this.normalizeTitle(
				$('h1.entry-title, h1').first().text() ||
					$('.seriestuheader h1, .infox h1').first().text() ||
					''
			) || path.split('/').pop() || path;

		const $cover = $(
			'.thumb img, .seriestucont .thumb img, .infox img, img.wp-post-image'
		).first();
		let cover =
			$cover.attr('data-src') ||
			$cover.attr('data-lazy-src') ||
			$cover.attr('src') ||
			'';
		if (cover.startsWith('data:')) cover = '';
		cover = this.absUrl(cover);

		const description =
			$('.entry-content p, .seriestucontent .entry-content, .wd-full .entry-content')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('meta[name="description"]').attr('content') ||
			'';

		const genres: string[] = [];
		$('.seriestugenre a, .mgen a, a[href*="/genres/"]').each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		const authors: string[] = [];
		$('.fmed, .infotable tr, .tsinfo .imptdt').each((_, el) => {
			const label = $(el).text().toLowerCase();
			if (/author|artist|pengarang/.test(label)) {
				$(el)
					.find('a')
					.each((__, a) => {
						const t = $(a).text().replace(/\s+/g, ' ').trim();
						if (t && !authors.includes(t)) authors.push(t);
					});
			}
		});

		let status = 'Ongoing';
		$('.status i, .imptdt, .tsinfo .imptdt').each((_, el) => {
			const t = $(el).text();
			if (/ongoing|complete|hiatus|drop/i.test(t)) {
				status = this.mapStatus(t);
			}
		});

		let type = 'manga';
		const typeText = $('.imptdt, .tsinfo').text();
		if (/\bmanhwa\b/i.test(typeText)) type = 'manhwa';
		else if (/\bmanhua\b/i.test(typeText)) type = 'manhua';

		const chapters: Chapter[] = [];
		const seenCh = new Set<string>();

		$('#chapterlist a, .eplister a, .chbox a').each((_, a) => {
			const $a = $(a);
			const href = $a.attr('href') || '';
			if (!href || !/chapter/i.test(href)) return;

			const id = this.cleanId(href);
			if (seenCh.has(id)) return;
			seenCh.add(id);

			const rawText =
				$a.find('.chapternum').text().replace(/\s+/g, ' ').trim() ||
				$a.text().replace(/\s+/g, ' ').trim();
			const date =
				$a.find('.chapterdate').text().replace(/\s+/g, ' ').trim() || '';

			const number = this.parseChapterNumber(rawText || id, id);
			if (!Number.isFinite(number)) return;

			const chapterTitle =
				rawText && /chapter|ch\.?/i.test(rawText)
					? rawText
					: `Chapter ${number}`;

			chapters.push({
				id,
				title: chapterTitle,
				number,
				date: date || undefined
			});
		});

		chapters.sort((a, b) => (a.number || 0) - (b.number || 0));

		const latestChapter = chapters.length
			? String(chapters[chapters.length - 1].number)
			: undefined;

		const metaLines = [
			authors.length && `Author: ${authors.join(' · ')}`,
			`Type: ${type}`,
			`Language: English`
		].filter(Boolean);

		console.log(
			`[madarascans] details ${path} → ch=${chapters.length} status=${status}`
		);

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			type,
			status,
			description: [...metaLines, description].filter(Boolean).join('\n'),
			authors,
			genres: genres.filter((g) => !/^(manhwa|manhua|manga)$/i.test(g)),
			chapters,
			latestChapter,
			lang: this.DEFAULT_LANG
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	private parseTsReaderImages(html: string): string[] {
		const images: string[] = [];
		const seen = new Set<string>();
		const push = (src: string) => {
			src = (src || '').replace(/\\\//g, '/').trim().split('?')[0];
			src = this.absUrl(src);
			if (
				!src ||
				seen.has(src) ||
				!/^https?:\/\//i.test(src) ||
				src.startsWith('data:') ||
				/logo|icon|avatar|spinner|ads|banner|placeholder|readerarea\.svg/i.test(
					src
				)
			) {
				return;
			}
			seen.add(src);
			images.push(src);
		};

		const m = html.match(/ts_reader\.run\((\{[\s\S]*?\})\);/);
		if (!m?.[1]) return images;

		const unescaped = m[1].replace(/\\\//g, '/');

		let blob = unescaped;
		const srcBlock = unescaped.match(
			/"sources"\s*:\s*\[[\s\S]*?"images"\s*:\s*\[([\s\S]*?)\]/
		);
		if (srcBlock?.[1]) blob = srcBlock[1];
		else {
			const only = unescaped.match(/"images"\s*:\s*\[([\s\S]*?)\]/);
			if (only?.[1]) blob = only[1];
		}

		const urls = blob.match(/https?:\/\/[^\s"'\\<>]+/g) || [];
		for (const u of urls) {
			push(u);
		}

		return images;
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		let path = this.cleanId(chapterId);

		if (/^\/series\//i.test(path) && /chapter/i.test(path)) {
			path = path.replace(/^\/series\//i, '/');
		}

		const maxAttempts = 2;
		let lastErr: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const html = await this.fetchHtml(path);

				let images = this.parseTsReaderImages(html);

				if (images.length === 0) {
					const $ = cheerio.load(html);
					const seen = new Set<string>();
					const push = (src: string) => {
						src = this.absUrl((src || '').trim().split('?')[0]);
						if (
							!src ||
							seen.has(src) ||
							!/^https?:\/\//i.test(src) ||
							src.startsWith('data:') ||
							/logo|icon|avatar|spinner|ads|banner|placeholder|readerarea\.svg/i.test(
								src
							)
						) {
							return;
						}
						seen.add(src);
						images.push(src);
					};

					$('#readerarea img, .readerarea img, .rdminimal img').each((_, img) => {
						push(
							$(img).attr('data-src') ||
								$(img).attr('data-lazy-src') ||
								$(img).attr('src') ||
								''
						);
					});
				}

				if (images.length === 0) {
					const re =
						/https?:\/\/(?:i\d\.wp\.com\/)?(?:madarascans\.org|madascans\.com)\/wp-content\/uploads\/[^"'\\\s<>]+/gi;
					const found = (html.replace(/\\\//g, '/').match(re) || []);
					const seen = new Set<string>();
					for (const u of found) {
						const src = this.absUrl(u.trim().split('?')[0]);
						if (
							src &&
							!seen.has(src) &&
							!/logo|icon|avatar|readerarea\.svg|thumb|cover/i.test(src)
						) {
							seen.add(src);
							images.push(src);
						}
					}
				}

				if (images.length === 0) {
					console.warn(
						`[madarascans] 0 pages attempt=${attempt}`,
						path,
						'hasTsReader=',
						html.includes('ts_reader')
					);
					lastErr = new Error('MadaraScans chapter has 0 images');
					continue;
				}

				console.log(`[madarascans] ${images.length} pages → ${path}`);
				return images;
			} catch (e) {
				lastErr = e;
				console.error(`[madarascans] getChapterPages attempt=${attempt}`, path, e);
			}
		}

		console.error('[madarascans] getChapterPages failed', path, lastErr);
		return [];
	}
}
