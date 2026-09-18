import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

/**
 * ManhwaDesu adapter (manhwadesu.wiki)
 *
 * Theme: Themesia / WordPress manga
 * Latest   : /komik/?order=update&page={n}
 * Search   : /?s=&page={n}
 * Detail   : /komik/{slug}/
 * Chapter  : /{slug}-chapter-{num}/
 * Pages    : ts_reader.run / #readerarea img
 *
 * ID format:
 *   manga   : /komik/{slug}
 *   chapter : /{slug}-chapter-{num}
 *
 * Catatan: domain .wiki dilindungi Cloudflare Turnstile.
 * Proxy image: set Referer https://manhwadesu.wiki/
 */
export class ManhwaDesuSource extends BaseSource {
	id = 'manhwadesu';
	name = 'ManhwaDesu';
	baseUrl = 'https://manhwadesu.wiki';

	private readonly PER_PAGE = 24;
	private readonly SITE_PER_PAGE = 20;
	private readonly DEFAULT_LANG = 'id';

	private absUrl(url: string): string {
		if (!url) return '';
		url = url.trim();
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
			.replace(/\s*[-|]\s*ManhwaDesu.*$/i, '')
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

	private isBlocked(html: string): boolean {
		const lower = html.toLowerCase();
		return (
			lower.includes('just a moment') ||
			lower.includes('cf-browser-verification') ||
			lower.includes('verify you are human') ||
			(lower.includes('challenge-platform') && html.length < 8000)
		);
	}

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const mangas: Manga[] = [];
		const seen = new Set<string>();

		$('.listupd .bs, .bs').each((_, card) => {
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
				$a.attr('title') ||
				$img.attr('alt') ||
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
			cover = this.absUrl((cover || '').trim().split('?')[0]);

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
				if (this.isBlocked(html)) {
					console.warn('[manhwadesu] CF block on catalog page', sp);
					break;
				}
				const list = this.parseCards(cheerio.load(html));
				for (const m of list) {
					if (seen.has(m.id)) continue;
					seen.add(m.id);
					merged.push(m);
				}
				if (list.length === 0) break;
			} catch (e) {
				console.error('[manhwadesu] catalog page', sp, e);
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

			console.log(`[manhwadesu] latest appPage=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[manhwadesu] getLatestManga', e);
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

			console.log(`[manhwadesu] search "${q}" appPage=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[manhwadesu] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);

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
		if (this.isBlocked(html)) {
			throw new Error('ManhwaDesu blocked by Cloudflare — buka situs di browser dulu');
		}
		const $ = cheerio.load(html);

		let title =
			$('h1.entry-title, h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content') ||
			path;
		title = this.normalizeTitle(title);

		let cover =
			$('.thumbook img, .thumb img, .sertothumb img, img.wp-post-image')
				.first()
				.attr('data-src') ||
			$('.thumbook img, .thumb img, img.wp-post-image').first().attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = this.absUrl((cover || '').trim().split('?')[0]);

		let description =
			$('.entry-content[itemprop="description"], .entry-content, .desc, .summary')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('meta[name="description"]').attr('content') ||
			'';
		description = description.replace(/^Sinopsis\s*/i, '').trim();

		const info: Record<string, string> = {};
		$('.infotable tr, table tr').each((_, tr) => {
			const $tds = $(tr).find('td');
			if ($tds.length >= 2) {
				const key = $tds.eq(0).text().trim().toLowerCase();
				const val = $tds.eq(1).text().trim();
				if (key && val) info[key] = val;
			}
		});
		$('.imptdt').each((_, el) => {
			const $el = $(el);
			const text = $el.text().replace(/\s+/g, ' ').trim();
			const m = text.match(
				/^(Status|Type|Released|Author|Artist|Posted By|Posted On|Updated On)\s*(.*)$/i
			);
			if (m) {
				const k = m[1].toLowerCase();
				if (!info[k]) info[k] = (m[2] || $el.find('i, a').text() || '').trim();
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
		$('.mgen a[href*="/genres/"], .wd-full a[href*="/genres/"]').each((_, a) => {
			const t = $(a).text().trim();
			if (t && t.length < 30 && !genres.includes(t)) genres.push(t);
		});
		const cleanGenres = genres
			.filter((g) => !/^(manhwa|manhua|manga)$/i.test(g))
			.slice(0, 12);

		const rating =
			$('.rating .num, [itemprop="ratingValue"]').first().text().trim() ||
			$('[itemprop="ratingValue"]').attr('content') ||
			'';

		const alt =
			$('.alternative, .wd-full span.alter, .seriestualt').first().text().trim() || '';

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
					/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)[a-z]*\.?\s+\d{1,2},?\s*\d{4}|\d{1,2}\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+\d{4}|\d+\s*(?:hours?|hrs?|days?|weeks?|months?|years?|jam|hari|minggu|bulan|tahun)\s*(?:ago|lalu)/i
				)?.[0] ||
				'';

			rawText = rawText
				.replace(date, '')
				.replace(
					/\s*\d+\s*(hours?|hrs?|days?|weeks?|months?|years?|jam|hari|minggu|bulan|tahun)\s*(ago|lalu).*$/i,
					''
				)
				.replace(
					/\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)[a-z]*\.?\s+\d{1,2},?\s*\d{4}.*$/i,
					''
				)
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
			chapters[0]?.date && `Updated: ${chapters[0].date}`,
			`Language: Indonesian`,
			`Type: ${type}`
		].filter(Boolean);

		const fullDescription = [...metaLines, description]
			.filter(Boolean)
			.join('\n');

		console.log(
			`[manhwadesu] details ${path} → ch=${chapters.length} status=${status} year=${year}`
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

	private parseTsReaderImages(html: string): string[] {
		const images: string[] = [];
		const seen = new Set<string>();
		const push = (src: string) => {
			src = this.absUrl(
				(src || '').replace(/\\\//g, '/').trim().split('?')[0]
			);
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
		if (!m) return images;

		const raw = m[1];
		const sourcesMatch = raw.match(
			/"sources"\s*:\s*\[\s*\{[\s\S]*?"images"\s*:\s*\[([\s\S]*?)\]/
		);
		const imagesMatch =
			sourcesMatch || raw.match(/"images"\s*:\s*\[([\s\S]*?)\]/);
		if (imagesMatch) {
			const urls = imagesMatch[1].match(/"(https?:[^"]+)"/g) || [];
			for (const u of urls) {
				push(u.replace(/^"|"$/g, ''));
			}
		}

		if (images.length === 0) {
			const fallback =
				raw.match(/"(https?:\\\/\\\/[^"]+)"/g) ||
				raw.match(/"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi) ||
				[];
			for (const u of fallback) {
				push(u.replace(/^"|"$/g, ''));
			}
		}

		return images;
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		let path = this.cleanId(
			chapterId.startsWith('/') ? chapterId : `/${chapterId}`
		);
		if (/^\/komik\//i.test(path) && /chapter/i.test(path)) {
			path = path.replace(/^\/komik\//i, '/');
		}

		const maxAttempts = 3;
		let lastErr: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const html = await this.fetchHtml(path.endsWith('/') ? path : path + '/');
				if (this.isBlocked(html)) {
					console.warn(`[manhwadesu] chapter blocked/CF attempt=${attempt}`, path);
					lastErr = new Error('ManhwaDesu chapter blocked by CF');
					await new Promise((r) => setTimeout(r, 500 * attempt));
					continue;
				}

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
							/logo|icon|avatar|spinner|ads|banner|placeholder/i.test(src)
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
						/https?:\/\/(?:cdn\.uqni\.net|upload\.gmbr\.pro|kacu\.gmbr\.pro)\/[^"'\\\s<>]+/gi;
					const found = html.match(re) || [];
					const seen = new Set<string>();
					for (const u of found) {
						const src = this.absUrl(u.trim().split('?')[0]);
						if (src && !seen.has(src)) {
							seen.add(src);
							images.push(src);
						}
					}
				}

				if (images.length === 0) {
					console.warn(
						`[manhwadesu] 0 pages attempt=${attempt}`,
						path,
						'htmlLen=',
						html.length,
						'hasTsReader=',
						html.includes('ts_reader')
					);
					lastErr = new Error('ManhwaDesu chapter has 0 images');
					await new Promise((r) => setTimeout(r, 400 * attempt));
					continue;
				}

				console.log(`[manhwadesu] ${images.length} pages → ${path}`);
				return images;
			} catch (e) {
				lastErr = e;
				console.error(`[manhwadesu] getChapterPages attempt=${attempt}`, path, e);
				if (attempt < maxAttempts) {
					await new Promise((r) => setTimeout(r, 500 * attempt));
				}
			}
		}

		console.error('[manhwadesu] getChapterPages failed', path, lastErr);
		return [];
	}
}
