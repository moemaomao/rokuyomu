import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

/**
 * ManhwaIndo adapter (www.manhwaindo.my)
 *
 * Theme: Themesia / WordPress manga (mangareader)
 * Latest (Project Update) : /project-updates/  &  /project-updates/page/{n}/
 * Series list             : /series/?order=update
 * Search                  : /?s=
 * Detail                  : /series/{slug}/
 * Chapter                 : /{slug}-chapter-{num}/
 * Pages                   : #readerarea img / .rdminimal img  →  upload.gmbr.pro
 *
 * ID format:
 *   manga   : /series/{slug}
 *   chapter : /{slug}-chapter-{num}
 *
 * Catalog utama = section "Project Update" sesuai request.
 */
export class ManhwaIndoSource extends BaseSource {
	id = 'manhwaindo';
	name = 'ManhwaIndo';
	baseUrl = 'https://www.manhwaindo.my';

	private readonly PER_PAGE = 24;
	private readonly SITE_PER_PAGE = 20;
	private readonly DEFAULT_LANG = 'id';

	// ── Helpers ──────────────────────────────────────────────────────────────

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
			.replace(/\s*[-|]\s*ManhwaIndo.*$/i, '')
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

		$('.listupd .bs, .bs').each((_, card) => {
			const $card = $(card);
			const $a = $card
				.find('a[href*="/series/"]')
				.filter((_, el) => {
					const h = ($(el).attr('href') || '').split('?')[0];
					return /\/series\/[^/]+\/?$/.test(h);
				})
				.first();

			const href = $a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (!/^\/series\/[^/]+$/i.test(id) || seen.has(id)) return;
			if (/\/series\/(page|list-mode|feed)/i.test(id)) return;
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
			const typeSpan = $card.find('.typename').first().text();
			if (typeSpan) type = this.mapType(typeSpan);
			else if (/\bmanhua\b/i.test(cardText)) type = 'manhua';
			else if (/\bmanga\b/i.test(cardText) && !/\bmanhwa\b/i.test(cardText))
				type = 'manga';

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

	// ── Catalog (Project Update) ─────────────────────────────────────────────

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
				console.error('[manhwaindo] catalog page', sp, e);
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
			// Section "Project Update" — /project-updates/
			const list = await this.fetchCatalogPages((sitePage) => {
				if (sitePage <= 1) return `/project-updates/`;
				return `/project-updates/page/${sitePage}/`;
			}, page);

			console.log(`[manhwaindo] project-updates appPage=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[manhwaindo] getLatestManga', e);
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
					return `/page/${sitePage}/?${params.toString()}`;
				}
				return `/?${params.toString()}`;
			}, page);

			console.log(`[manhwaindo] search "${q}" appPage=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[manhwaindo] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);

		// chapter id → series slug
		if (/chapter/i.test(path) && !path.startsWith('/series/')) {
			const slug = path
				.replace(/^\//, '')
				.replace(/-chapter-[\d.]+.*$/i, '')
				.replace(/\/$/, '');
			path = `/series/${slug}`;
		}
		if (!path.startsWith('/series/')) {
			path = `/series/${path.replace(/^\//, '')}`;
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
		// strip "Synopsis" prefix if present
		description = description.replace(/^Synopsis\s*/i, '').trim();

		// .imptdt: Status / Type / Released / Author / Artist
		const info: Record<string, string> = {};
		$('.imptdt').each((_, el) => {
			const $el = $(el);
			const text = $el.text().replace(/\s+/g, ' ').trim();
			const m = text.match(
				/^(Status|Type|Released|Author|Artist|Posted By|Posted On|Updated On)\s*(.*)$/i
			);
			if (m) {
				info[m[1].toLowerCase()] = (m[2] || $el.find('i, a').text() || '').trim();
			}
		});
		// fallback table
		$('.infotable tr, table tr').each((_, tr) => {
			const $tds = $(tr).find('td');
			if ($tds.length >= 2) {
				const key = $tds.eq(0).text().trim().toLowerCase();
				const val = $tds.eq(1).text().trim();
				if (key && val && !info[key]) info[key] = val;
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
		$('.mgen a[href*="/genres/"], .wd-full a[href*="/genres/"], a[href*="/genres/"]').each(
			(_, a) => {
				const t = $(a).text().trim();
				// skip site-wide genre nav (usually many); keep short unique
				if (t && t.length < 30 && !genres.includes(t)) genres.push(t);
			}
		);
		// limit noise: only first unique set from series detail (typically < 15)
		const cleanGenres = genres
			.filter((g) => !/^(manhwa|manhua|manga)$/i.test(g))
			.slice(0, 12);

		const rating =
			$('.rating .num, [itemprop="ratingValue"]').first().text().trim() ||
			$('[itemprop="ratingValue"]').attr('content') ||
			'';

		const alt =
			$('.alternative, .wd-full span.alter, .seriestualt').first().text().trim() || '';

		const updatedOn = info['updated on'] || info['posted on'] || '';

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
					/\d{1,2}\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|\d+\s*(?:hours?|hrs?|days?|weeks?|months?|years?|jam|hari|minggu|bulan|tahun)\s*(?:ago|lalu)/i
				)?.[0] ||
				'';

			rawText = rawText
				.replace(date, '')
				.replace(
					/\s*\d+\s*(hours?|hrs?|days?|weeks?|months?|years?|jam|hari|minggu|bulan|tahun)\s*(ago|lalu).*$/i,
					''
				)
				.replace(
					/\s*\d{1,2}\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}.*$/i,
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
			(chapters[0]?.date || updatedOn) &&
				`Updated: ${chapters[0]?.date || updatedOn}`,
			`Language: Indonesian`,
			`Type: ${type}`
		].filter(Boolean);

		const fullDescription = [...metaLines, description]
			.filter(Boolean)
			.join('\n');

		console.log(
			`[manhwaindo] details ${path} → ch=${chapters.length} status=${status} year=${year}`
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

	/** Parse ts_reader.run({...}) — sumber utama gambar di Themesia. */
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
		// Prefer sources[0].images
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
				raw.match(/"(https?:\\\/\\\/upload[^"]+)"/g) ||
				raw.match(/"(https?:\/\/upload[^"]+)"/g) ||
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
		// strip accidental /series/ prefix on chapter ids
		if (/^\/series\//i.test(path) && /chapter/i.test(path)) {
			path = path.replace(/^\/series\//i, '/');
		}

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
					console.warn(`[manhwaindo] chapter blocked/CF attempt=${attempt}`, path);
					lastErr = new Error('ManhwaIndo chapter blocked by CF');
					await new Promise((r) => setTimeout(r, 500 * attempt));
					continue;
				}

				// 1) ts_reader (utama — DOM sering kosong saat di-scrape server-side)
				let images = this.parseTsReaderImages(html);

				// 2) DOM fallback
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

				// 3) regex CDN
				if (images.length === 0) {
					const re = /https?:\/\/(?:upload\.)?gmbr\.pro\/[^"'\\\s<>]+/gi;
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
						`[manhwaindo] 0 pages attempt=${attempt}`,
						path,
						'htmlLen=',
						html.length,
						'hasTsReader=',
						html.includes('ts_reader')
					);
					lastErr = new Error('ManhwaIndo chapter has 0 images');
					await new Promise((r) => setTimeout(r, 400 * attempt));
					continue;
				}

				console.log(`[manhwaindo] ${images.length} pages → ${path}`);
				return images;
			} catch (e) {
				lastErr = e;
				console.error(`[manhwaindo] getChapterPages attempt=${attempt}`, path, e);
				if (attempt < maxAttempts) {
					await new Promise((r) => setTimeout(r, 500 * attempt));
				}
			}
		}

		console.error('[manhwaindo] getChapterPages failed', path, lastErr);
		return [];
	}
}
