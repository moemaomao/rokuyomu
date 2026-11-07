/**
 * BacaMi (v1.bacami.site) adapter
 *
 * List   : /  |  /page/{n}/   → #komik-list (utama) + #project-list (rekomendasi)
 * Search : /?s=QUERY          → article.genre-card
 * Detail : /komik/{slug}/
 * Chapter: /{slug}-chapter-{n}/
 * Pages  : configReader.imageUrls di .entry-content
 *
 * ID format:
 *   manga   : "/komik/{slug}"
 *   chapter : "/{slug}-chapter-{n}"
 *
 * Bahasa default: Indonesian
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types-manga';
import * as cheerio from 'cheerio';

export class BacamiSource extends BaseSource {
	id = 'bacami';
	name = 'BacaMi';
	baseUrl = 'https://v1.bacami.site';

	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'id';

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
		Accept:
			'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
		'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
		'Accept-Encoding': 'gzip, deflate, br',
		'Cache-Control': 'no-cache',
		Pragma: 'no-cache',
		'Sec-Ch-Ua': '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
		'Sec-Ch-Ua-Mobile': '?0',
		'Sec-Ch-Ua-Platform': '"Windows"',
		'Sec-Fetch-Dest': 'document',
		'Sec-Fetch-Mode': 'navigate',
		'Sec-Fetch-Site': 'none',
		'Sec-Fetch-User': '?1',
		'Upgrade-Insecure-Requests': '1'
	};

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
		return (raw || '')
			.replace(/\s+/g, ' ')
			.replace(/\s*[-–|].*BacaMi.*$/i, '')
			.replace(/\s*Bahasa Indonesia.*$/i, '')
			.replace(/^Baca\s+(Komik|Manga)\s+/i, '')
			.trim();
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath = path.match(/-chapter-(\d+)(?:[.-](\d+))?/i);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null) return parseFloat(`${major}.${fromPath[2]}`);
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

	private detectType($el: cheerio.Cheerio<any>): string {
		const flag =
			$el.find('.flag').attr('class') ||
			$el.find('[class*="flag"]').attr('class') ||
			'';
		const t = flag.toLowerCase();
		if (/\bmanhwa\b/.test(t)) return 'manhwa';
		if (/\bmanhua\b/.test(t)) return 'manhua';
		return 'manga';
	}

	private isBadCover(src: string): boolean {
		return /api\d+-?\d*\.png|hot-tag|themes\/bacami\/img|logo|placeholder|loaders/i.test(
			src || ''
		);
	}

	private pickCover($el: cheerio.Cheerio<any>): string {
		const candidates = [
			$el.find('.manga-cover a img, .genre-cover a img').attr('data-src'),
			$el.find('.manga-cover a img, .genre-cover a img').attr('src'),
			$el.find('a[href*="/komik/"] img').attr('data-src'),
			$el.find('a[href*="/komik/"] img').attr('src')
		].filter(Boolean) as string[];

		for (const c of candidates) {
			if (c && !this.isBadCover(c)) return this.absUrl(c.split('?')[0]);
		}

		let found = '';
		$el.find('img').each((_, img) => {
			if (found) return;
			const s =
				(img as any).attribs?.['data-src'] ||
				(img as any).attribs?.src ||
				'';
			if (s && /bmcdn\.my\.id|cdn\.bmcdn/i.test(s) && !this.isBadCover(s)) {
				found = s;
			}
		});
		return found ? this.absUrl(found.split('?')[0]) : '';
	}

	// ── List cards (homepage / page-n) ───────────────────────────────────────

	private parseMangaCards($: cheerio.CheerioAPI, root?: cheerio.Cheerio<any>): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();
		const scope = root && root.length ? root : $.root();

		scope.find('article.manga-card, .manga-card').each((_, el) => {
			const $el = $(el);

			const a =
				$el.find('a.manga-title[href*="/komik/"]').first().length
					? $el.find('a.manga-title[href*="/komik/"]').first()
					: $el.find('.manga-cover a[href*="/komik/"]').first().length
						? $el.find('.manga-cover a[href*="/komik/"]').first()
						: $el.find('a[href*="/komik/"]').first();

			const href = a.attr('href') || '';
			const id = this.cleanId(href);
			if (!/^\/komik\/[^/]+$/i.test(id) || seen.has(id)) return;
			seen.add(id);

			const title = this.normalizeTitle(
				$el.find('a.manga-title').text() ||
					a.attr('title') ||
					$el.find('.manga-cover a img').attr('alt') ||
					''
			);
			if (!title) return;

			let latestChapter: number | undefined;
			const chLink = $el
				.find('.chapter-details .chapter-link a, .chapter-link a, a[href*="-chapter-"]')
				.first();
			if (chLink.length) {
				const n = this.parseChapterNumber(
					chLink.text(),
					this.cleanId(chLink.attr('href') || '')
				);
				if (n > 0) latestChapter = n;
			}

			out.push({
				id,
				sourceId: this.id,
				title,
				cover: this.pickCover($el),
				type: this.detectType($el),
				status: 'Ongoing',
				latestChapter,
				lang: this.DEFAULT_LANG
			} as Manga & { lang?: string });
		});

		return out;
	}

	// ── Search cards (genre-card) ────────────────────────────────────────────

	private parseSearchCards($: cheerio.CheerioAPI): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		$('article.genre-card, .genre-card').each((_, el) => {
			const $el = $(el);

			const a =
				$el.find('a.genre-title[href*="/komik/"]').first().length
					? $el.find('a.genre-title[href*="/komik/"]').first()
					: $el.find('.genre-cover a[href*="/komik/"]').first().length
						? $el.find('.genre-cover a[href*="/komik/"]').first()
						: $el.find('a[href*="/komik/"]').first();

			const href = a.attr('href') || '';
			const id = this.cleanId(href);
			if (!/^\/komik\/[^/]+$/i.test(id) || seen.has(id)) return;
			seen.add(id);

			const title = this.normalizeTitle(
				$el.find('a.genre-title').text() ||
					a.attr('title') ||
					$el.find('img').attr('alt') ||
					''
			);
			if (!title) return;

			let latestChapter: number | undefined;
			const chLink = $el
				.find('.genre-chapter-link a, a[href*="-chapter-"]')
				.first();
			if (chLink.length) {
				const n = this.parseChapterNumber(
					chLink.text(),
					this.cleanId(chLink.attr('href') || '')
				);
				if (n > 0) latestChapter = n;
			}

			out.push({
				id,
				sourceId: this.id,
				title,
				cover: this.pickCover($el),
				type: this.detectType($el),
				status: 'Ongoing',
				latestChapter,
				lang: this.DEFAULT_LANG
			} as Manga & { lang?: string });
		});

		return out;
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const path = p <= 1 ? '/' : `/page/${p}/`;

			const html = await this.fetchHtml(path);
			if (!html || html.length < 500) {
				console.warn(`[bacami] empty html: ${path}`);
				return [];
			}

			const $ = cheerio.load(html);

			const komikList = $('#komik-list');
			let list = this.parseMangaCards(
				$,
				komikList.length ? komikList : undefined
			);

			if (list.length < 8) {
				const projectList = $('#project-list');
				const extra = this.parseMangaCards(
					$,
					projectList.length ? projectList : undefined
				);
				const seen = new Set(list.map((m) => m.id));
				for (const m of extra) {
					if (seen.has(m.id)) continue;
					seen.add(m.id);
					list.push(m);
				}
			}

			// Fallback terakhir: scan semua .manga-card di halaman
			if (list.length < 4) {
				const all = this.parseMangaCards($);
				const seen = new Set(list.map((m) => m.id));
				for (const m of all) {
					if (seen.has(m.id)) continue;
					seen.add(m.id);
					list.push(m);
				}
			}

			console.log(`[bacami] latest page=${p} → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[bacami] getLatestManga', e);
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
			const path =
				page <= 1
					? `/?s=${encodeURIComponent(q)}`
					: `/page/${page}/?s=${encodeURIComponent(q)}`;

			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);

			// Search pakai .genre-card
			let list = this.parseSearchCards($);

			// Fallback: manga-card
			if (!list.length) {
				list = this.parseMangaCards($);
			}

			// Fallback terakhir: scan semua link /komik/
			if (!list.length) {
				const seen = new Set<string>();
				$('a[href*="/komik/"]').each((_, el) => {
					const href = $(el).attr('href') || '';
					const id = this.cleanId(href);
					if (!/^\/komik\/[^/]+$/i.test(id) || seen.has(id)) return;
					seen.add(id);
					const title = this.normalizeTitle(
						$(el).attr('title') || $(el).text() || ''
					);
					if (!title || title.length < 2) return;
					list.push({
						id,
						sourceId: this.id,
						title,
						cover: '',
						type: 'manga',
						status: 'Ongoing',
						lang: this.DEFAULT_LANG
					} as Manga & { lang?: string });
				});
			}

			console.log(`[bacami] search "${q}" → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[bacami] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);

		if (/-chapter-/i.test(path) && !path.startsWith('/komik/')) {
			const slug = path.replace(/^\//, '').replace(/-chapter-[\d.]+.*$/i, '');
			if (slug) path = `/komik/${slug}`;
		}

		if (!path.startsWith('/komik/')) {
			path = `/komik/${path.replace(/^\//, '')}`;
		}

		const html = await this.fetchHtml(path + '/');
		const $ = cheerio.load(html);

		let title =
			$('h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content') ||
			path;
		title = this.normalizeTitle(title);

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('.manga-cover img, .series-thumb img, img.thumb').attr('data-src') ||
			$('.manga-cover img, .series-thumb img, img.thumb').attr('src') ||
			'';
		cover = this.absUrl((cover || '').split('?')[0]);

		let description = '';
		$('p').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (
				t.length > 80 &&
				!description &&
				!/genre|author|status|type|bookmark|released/i.test(t)
			) {
				description = t;
			}
		});

		const authors: string[] = [];
		let status = 'Ongoing';
		let type = 'manga';

		$('.manga-info-grid .info-item, .manga-info-grid > div').each((_, el) => {
			const label = $(el).find('.info-label').text().toLowerCase();
			const val = $(el)
				.clone()
				.children('.info-label')
				.remove()
				.end()
				.text()
				.replace(/\s+/g, ' ')
				.trim();

			if (label.includes('author') || label.includes('pengarang')) {
				val.split(/,|\//).forEach((a) => {
					const n = a.trim();
					if (n && n.length < 60 && !authors.includes(n)) authors.push(n);
				});
			}
			if (label.includes('status')) {
				if (/complete|tamat|end|finish/i.test(val)) status = 'Completed';
				else if (/hiatus/i.test(val)) status = 'Hiatus';
				else status = 'Ongoing';
			}
			if (label.includes('type') || label.includes('tipe')) {
				if (/manhwa/i.test(val)) type = 'manhwa';
				else if (/manhua/i.test(val)) type = 'manhua';
				else type = 'manga';
			}
		});

		const genres: string[] = [];
		$('.manga-genres .genre a, nav.manga-genres a, a[href*="/genre/"]').each(
			(_, a) => {
				const g = $(a).text().replace(/\s+/g, ' ').trim();
				if (g && g.length < 40 && !/^genre$/i.test(g) && !genres.includes(g)) {
					genres.push(g);
				}
			}
		);

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('li.chapter-item, .chapter-item, .chapter-list li').each((_, el) => {
			const $a = $(el).find('a.ch-link, a[href*="-chapter-"]').first();
			const href = $a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (seen.has(id) || !/-chapter-/i.test(id)) return;
			seen.add(id);

			const chapterTitle =
				$a.text().replace(/\s+/g, ' ').trim() ||
				$a.attr('title') ||
				`Chapter ${chapters.length + 1}`;

			const number =
				this.parseChapterNumber(chapterTitle, id) || chapters.length + 1;

			const date =
				$(el).find('.ch-date, .update-time, time').text().replace(/\s+/g, ' ').trim() ||
				'';

			chapters.push({ id, title: chapterTitle, number, date });
		});

		if (!chapters.length) {
			$('a[href*="-chapter-"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const id = this.cleanId(href);
				if (seen.has(id) || !/-chapter-/i.test(id)) return;
				seen.add(id);
				const chapterTitle =
					$(a).text().replace(/\s+/g, ' ').trim() ||
					$(a).attr('title') ||
					'Chapter';
				const number =
					this.parseChapterNumber(chapterTitle, id) || chapters.length + 1;
				chapters.push({ id, title: chapterTitle, number, date: '' });
			});
		}

		chapters.sort((a, b) => a.number - b.number);

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			description,
			authors,
			genres,
			status,
			type,
			chapters,
			latestChapter: chapters.length
				? chapters[chapters.length - 1].number
				: undefined
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(
			chapterId.startsWith('/') ? chapterId : `/${chapterId}`
		);
		const html = await this.fetchHtml(path);
		const images: string[] = [];
		const seen = new Set<string>();

		const m = html.match(/imageUrls\s*:\s*(\[[\s\S]*?\])/);
		if (m) {
			try {
				const arr = JSON.parse(m[1].replace(/\\"/g, '"')) as string[];
				for (const u of arr) {
					const src = this.absUrl(String(u).replace(/\\\//g, '/'));
					if (src && !seen.has(src)) {
						seen.add(src);
						images.push(src);
					}
				}
			} catch {
				const re = /"(https?:\\\/\\\/[^"]+\.(?:jpg|jpeg|png|webp))"/gi;
				let x: RegExpExecArray | null;
				while ((x = re.exec(m[1])) !== null) {
					const src = x[1].replace(/\\\//g, '/');
					if (!seen.has(src)) {
						seen.add(src);
						images.push(src);
					}
				}
			}
		}

		if (!images.length) {
			const $ = cheerio.load(html);
			$(
				'.entry-content img, .article-post-content img, #article-content img, .memp-reader-container img'
			).each((_, img) => {
				let src =
					$(img).attr('data-src') ||
					$(img).attr('data-lazy-src') ||
					$(img).attr('src') ||
					'';
				src = this.absUrl(src);
				if (
					src &&
					!seen.has(src) &&
					/\.(jpg|jpeg|png|webp)/i.test(src) &&
					!/logo|icon|avatar|spinner|ads|404_image|loader|placeholder|theme\/bacami/i.test(
						src
					)
				) {
					seen.add(src);
					images.push(src);
				}
			});
		}

		console.log(`[bacami] ${images.length} pages → ${path}`);
		return images;
	}
}