/**
 * Mangasusu adapter (mangasusuku.com)
 *
 * Theme: Themesia / WordPress manga
 * Latest   : /komik/?order=update&page={n}   (bukan /komik/page/n/)
 * Project  : /project/
 * Search   : /?s=&page={n}
 * Detail   : /komik/{slug}/
 * Chapter  : /{slug}-chapter-{num}/
 * Pages    : #readerarea img  /  cdn.uqni.net
 *
 * ID format:
 *   manga   : /komik/{slug}
 *   chapter : /{slug}-chapter-{num}
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class MangasusuSource extends BaseSource {
	id = 'mangasusu';
	name = 'Mangasusu';
	baseUrl = 'https://mangasusuku.com';

	private readonly PER_PAGE = 24;
	private readonly SITE_PER_PAGE = 20;
	private readonly DEFAULT_LANG = 'id';

	// ── Helpers ──────────────────────────────────────────────────────────────

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
			.replace(/\s*[-|]\s*Mangasusu.*$/i, '')
			.replace(/\s*Bahasa Indonesia.*$/i, '')
			.replace(/^Baca\s+/i, '')
			.trim();
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath = String(path).match(/chapter[_-]?(\d+)(?:[.-](\d+))?/i);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null && fromPath[2].length <= 2) {
				return parseFloat(`${major}.${fromPath[2]}`);
			}
			return major;
		}
		const m = String(text).match(/(?:chapter|chap|ch\.?)\s*(\d+)(?:[.,](\d+))?/i);
		if (m) {
			if (m[2] != null && m[2].length <= 2) {
				return parseFloat(`${m[1]}.${m[2]}`);
			}
			return parseInt(m[1], 10);
		}
		const n = String(text).match(/\b(\d+(?:\.\d{1,2})?)\b/);
		return n ? parseFloat(n[1]) : NaN;
	}

	private mapStatus(raw?: string | null): string {
		const s = String(raw || '').toLowerCase();
		if (/\b(completed|complete|tamat|selesai|end|finish)\b/.test(s)) return 'Completed';
		if (/\bhiatus\b/.test(s)) return 'Hiatus';
		if (/\b(cancelled|dropped|canceled)\b/.test(s)) return 'Cancelled';
		return 'Ongoing';
	}

	private mapType(raw: string): 'manga' | 'manhwa' | 'manhua' {
		const t = String(raw || '').toLowerCase();
		if (t.includes('manhwa')) return 'manhwa';
		if (t.includes('manhua')) return 'manhua';
		if (t.includes('manga')) return 'manga';
		return 'manhwa';
	}

	// ── List cards ───────────────────────────────────────────────────────────

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const mangas: Manga[] = [];
		const seen = new Set<string>();

		const $cards = $('.listupd .bs, .bs');
		$cards.each((_, card) => {
			const $card = $(card);
			const $a = $card
				.find('a[href*="/komik/"]')
				.filter((_, el) => {
					const h = ($(el).attr('href') || '').split('?')[0];
					return /\/komik\/[^/]+\/?$/.test(h);
				})
				.first();

			const href = $a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (!/^\/komik\/[^/]+$/i.test(id) || seen.has(id)) return;
			if (/\/komik\/(page|list-mode|feed)/i.test(id)) return;
			seen.add(id);

			const $img = $card.find('img').first();
			let title =
				$card.find('.tt, .ntt, h2, h3, .title').first().text() ||
				$img.attr('alt') ||
				$a.attr('title') ||
				$a.text() ||
				'';
			title = this.normalizeTitle(title)
				.replace(/Chapter\s*\d+.*$/i, '')
				.replace(/\d+\.\d+\s*$/, '')
				.trim();
			if (!title || title.length < 2) {
				const slug = id.split('/').filter(Boolean).pop() || '';
				title = slug
					.split('-')
					.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
					.join(' ');
			}
			if (!title) return;

			let cover =
				$img.attr('data-src') ||
				$img.attr('data-lazy-src') ||
				$img.attr('src') ||
				'';
			cover = this.absUrl((cover || '').split('?')[0]);

			const cardText = $card.text();
			let type: 'manga' | 'manhwa' | 'manhua' = 'manhwa';
			if (/\bmanhua\b/i.test(cardText)) type = 'manhua';
			else if (/\bmanga\b/i.test(cardText) && !/\bmanhwa\b/i.test(cardText)) type = 'manga';

			let status = 'Ongoing';
			if (/\b(completed|tamat|selesai|end)\b/i.test(cardText)) status = 'Completed';
			else if (/\bhiatus\b/i.test(cardText)) status = 'Hiatus';

			let latestChapter: number | undefined;
			const chMatch = cardText.match(/(?:Chapter|Ch\.?)\s*(\d+(?:\.\d+)?)/i);
			if (chMatch) latestChapter = parseFloat(chMatch[1]);

			mangas.push({
				id,
				title,
				cover,
				sourceId: this.id,
				status,
				type,
				latestChapter,
				lang: this.DEFAULT_LANG
			});
		});

		return mangas;
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

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

		for (let sp = siteStart; sp <= siteStart + 2 && merged.length < offsetInFirst + this.PER_PAGE; sp++) {
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
				console.error('[mangasusu] catalog page', sp, e);
				break;
			}
		}

		return merged.slice(offsetInFirst, offsetInFirst + this.PER_PAGE);
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const list = await this.fetchCatalogPages((sitePage) => {
				const params = new URLSearchParams({ order: 'update' });
				if (sitePage > 1) params.set('page', String(sitePage));
				return `/komik/?${params.toString()}`;
			}, page);

			console.log(`[mangasusu] latest appPage=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[mangasusu] getLatestManga', e);
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
				if (sitePage > 1) params.set('page', String(sitePage));
				return `/?${params.toString()}`;
			}, page);

			console.log(`[mangasusu] search "${q}" appPage=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[mangasusu] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);

		// chapter id → manga slug
		if (/chapter/i.test(path) && !path.startsWith('/komik/')) {
			const slug = path
				.replace(/^\//, '')
				.replace(/-chapter-[\d.]+.*$/i, '')
				.replace(/\/$/, '');
			path = `/komik/${slug}`;
		}
		if (!path.startsWith('/komik/')) {
			path = `/komik/${path.replace(/^\//, '')}`;
		}
		path = path.replace(/\/+$/, '');

		const html = await this.fetchHtml(path + '/');
		const $ = cheerio.load(html);

		let title =
			$('h1.entry-title, h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content') ||
			path;
		title = this.normalizeTitle(title);

		let cover =
			$('.thumbook img, .thumb img, .sertothumb img, img.wp-post-image')
				.first()
				.attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			$('img').first().attr('src') ||
			'';
		cover = this.absUrl((cover || '').split('?')[0]);

		let description =
			$('.entry-content[itemprop="description"], .entry-content, .desc, .summary')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('meta[name="description"]').attr('content') ||
			'';

		const info: Record<string, string> = {};
		$('.infotable tr, table tr').each((_, tr) => {
			const $tds = $(tr).find('td');
			if ($tds.length >= 2) {
				const key = $tds.eq(0).text().trim().toLowerCase();
				const val = $tds.eq(1).text().trim();
				if (key && val) info[key] = val;
			}
		});

		const status = this.mapStatus(info['status']);
		const type = this.mapType(info['type'] || '');
		const year = (info['released'] || '').match(/\b(19|20)\d{2}\b/)?.[0] || '';
		const authors = (info['author'] || '')
			.split(/[,&/]/)
			.map((s) => s.trim())
			.filter((s) => s && s !== '-');
		const artists = (info['artist'] || '')
			.split(/[,&/]/)
			.map((s) => s.trim())
			.filter((s) => s && s !== '-');

		const genres: string[] = [];
		$('.mgen a[href*="/genres/"], a[href*="/genres/"], .genre-info a').each((_, a) => {
			const t = $(a).text().trim();
			if (t && t.length < 30 && !genres.includes(t)) genres.push(t);
		});
		// dedupe type keywords from genres for display
		const cleanGenres = genres.filter((g) => !/^(manhwa|manhua|manga)$/i.test(g));

		const rating =
			$('.rating .num, [itemprop="ratingValue"]').first().text().trim() ||
			$('[itemprop="ratingValue"]').attr('content') ||
			'';

		const alt =
			$('.alternative, .wd-full span.alter, .seriestualt').first().text().trim() || '';

		// Chapters
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('#chapterlist a, .eplister a, .chbox a').each((_, a) => {
			const $a = $(a);
			const href = $a.attr('href') || '';
			const id = this.cleanId(href);
			if (seen.has(id) || !/chapter/i.test(id)) return;
			seen.add(id);

			let rawText = $a.text().replace(/\s+/g, ' ').trim();
			const date =
				$a.find('.chapterdate, .dt, time').last().text().trim() ||
				rawText.match(
					/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s*\d{4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d+\s*(?:hours?|hrs?|days?|weeks?|months?|years?|jam|hari|minggu|bulan|tahun)\s*(?:ago|lalu)/i
				)?.[0] ||
				'';

			rawText = rawText
				.replace(date, '')
				.replace(
					/\s*\d+\s*(hours?|hrs?|days?|weeks?|months?|years?|jam|hari|minggu|bulan|tahun)\s*(ago|lalu).*$/i,
					''
				)
				.replace(/\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s*\d{4}.*$/i, '')
				.trim();

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
				date: date.trim()
			});
		});

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const latestChapter =
			chapters.length && chapters[0].number != null
				? String(chapters[0].number)
				: undefined;

		const allCreators = [...authors];
		for (const a of artists) {
			if (!allCreators.includes(a)) allCreators.push(a);
		}

		const metaLines = [
			alt && `Alternative: ${alt}`,
			rating && `Rating: ${rating}/10`,
			authors.length && `Author: ${authors.join(' · ')}`,
			artists.length && `Artist: ${artists.join(' · ')}`,
			year && `Publication: ${year}`,
			info['serialization'] && `Serialization: ${info['serialization']}`,
			chapters[0]?.date && `Updated: ${chapters[0].date}`,
			`Language: Indonesian`,
			`Type: ${type}`
		].filter(Boolean);

		const fullDescription = [...metaLines, description]
			.filter(Boolean)
			.join('\n');

		console.log(
			`[mangasusu] details ${path} → ch=${chapters.length} status=${status} year=${year}`
		);

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			description: fullDescription,
			authors: allCreators,
			genres: cleanGenres,
			status,
			chapters,
			type,
			latestChapter
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(
			chapterId.startsWith('/') ? chapterId : `/${chapterId}`
		);

		const maxAttempts = 3;
		let lastErr: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const html = await this.fetchHtml(path.endsWith('/') ? path : path + '/');
				const lower = html.toLowerCase();
				if (
					lower.includes('cf-browser-verification') ||
					lower.includes('just a moment') ||
					(lower.includes('challenge-platform') && html.length < 5000)
				) {
					console.warn(`[mangasusu] chapter blocked/CF attempt=${attempt}`, path);
					lastErr = new Error('Mangasusu chapter blocked by CF');
					await new Promise((r) => setTimeout(r, 500 * attempt));
					continue;
				}

				const $ = cheerio.load(html);
				const images: string[] = [];
				const seen = new Set<string>();

				const push = (src: string) => {
					src = this.absUrl((src || '').trim().split('?')[0]);
					if (
						!src ||
						seen.has(src) ||
						!/^https?:\/\//i.test(src) ||
						/logo|icon|avatar|spinner|ads|banner|placeholder|gravatar|gtag|wp-content\/uploads\/.*logo/i.test(
							src
						) ||
						/\.gif(\?|$)/i.test(src)
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

				if (images.length === 0) {
					$('img').each((_, img) => {
						const src =
							$(img).attr('data-src') ||
							$(img).attr('data-lazy-src') ||
							$(img).attr('src') ||
							'';
						if (
							/cdn\.uqni\.net|\/users\/|cdnfgo/i.test(src) ||
							/\.(jpg|jpeg|png|webp|avif)(\?|$)/i.test(src)
						) {
							push(src);
						}
					});
				}

				if (images.length === 0) {
					const re = /https?:\/\/(?:cdn\.uqni\.net|cdnfgo\.xyz)\/[^"'\\\s<>]+/gi;
					const found = html.match(re) || [];
					for (const u of found) push(u);
				}

				if (images.length === 0) {
					console.warn(
						`[mangasusu] 0 pages attempt=${attempt}`,
						path,
						'htmlLen=',
						html.length
					);
					lastErr = new Error('Mangasusu chapter has 0 images');
					await new Promise((r) => setTimeout(r, 400 * attempt));
					continue;
				}

				console.log(`[mangasusu] ${images.length} pages → ${path}`);
				return images;
			} catch (e) {
				lastErr = e;
				console.error(`[mangasusu] getChapterPages attempt=${attempt}`, path, e);
				if (attempt < maxAttempts) {
					await new Promise((r) => setTimeout(r, 500 * attempt));
				}
			}
		}

		console.error('[mangasusu] getChapterPages failed', path, lastErr);
		return [];
	}
}
