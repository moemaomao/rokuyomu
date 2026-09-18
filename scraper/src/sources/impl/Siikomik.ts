import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

/**
 * Siikomik adapter (siikomik.id)
 *
 * Theme: Madara (wp-manga)
 * Latest  : homepage "Update Terbaru" → pastikan 24 (isi dari /semua-komik/)
 * Page 2+ : POST admin-ajax.php action=madara_load_more
 *           (/semua-komik/page/{n}/ = HTTP 404, tidak dipakai)
 * Search  : /?s={q}&post_type=wp-manga
 * Detail  : /komik/{slug}/
 * Chapters: POST /komik/{slug}/ajax/chapters/
 * Chapter : /komik/{slug}/chapter-{n}/
 * Pages   : .wp-manga-chapter-img[data-src] (CDN ffjackss107.my.id)
 *           catatan: chapter premium (coin) terkunci tanpa login
 *
 * ID format:
 *   manga   : /komik/{slug}
 *   chapter : /komik/{slug}/chapter-{n}
 */
export class SiikomikSource extends BaseSource {
	id = 'siikomik';
	name = 'Siikomik';
	baseUrl = 'https://siikomik.id';

	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'id';

	private absUrl(url: string): string {
		if (!url) return '';
		url = url.trim().replace(/^\s+|\s+$/g, '');
		if (url.includes(' ')) {
			// data-src sering punya newline/spasi
			url = url.replace(/\s+/g, '');
		}
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
			.replace(/&#8217;/g, "'")
			.replace(/&amp;/g, '&')
			.replace(/\s*[-|]\s*Siikomik.*$/i, '')
			.replace(/\s*[-|]\s*Chapter\s*\d+.*$/i, '')
			.trim();
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath = String(path).match(
			/chapter[_-]?(\d+)(?:[.-](\d+))?/i
		);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null && fromPath[2].length <= 2) {
				return parseFloat(`${major}.${fromPath[2]}`);
			}
			return major;
		}
		const m = String(text).match(
			/(?:chapter|chap|ch\.?)\s*(\d+)(?:[.,](\d+))?/i
		);
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
		if (/\b(completed|complete|tamat|selesai|end|finish)\b/.test(s))
			return 'Completed';
		if (/\bhiatus\b/.test(s)) return 'Hiatus';
		if (/\b(cancelled|dropped|canceled)\b/.test(s)) return 'Cancelled';
		return 'Ongoing';
	}

	private mapType(raw: string): 'manga' | 'manhwa' | 'manhua' {
		const t = String(raw || '').toLowerCase();
		if (t.includes('manhwa') || t.includes('webtoon')) return 'manhwa';
		if (t.includes('manhua')) return 'manhua';
		if (t.includes('manga')) return 'manga';
		return 'manhwa';
	}

	private imgSrc($img: cheerio.Cheerio<any>): string {
		const raw =
			$img.attr('data-src') ||
			$img.attr('data-lazy-src') ||
			$img.attr('src') ||
			'';
		return (raw || '').trim();
	}

	/** Kartu Madara: .page-item-detail / .manga */
	private parseMadaraCards($: cheerio.CheerioAPI): Manga[] {
		const mangas: Manga[] = [];
		const seen = new Set<string>();

		$('.page-item-detail, .manga, .page-listing-item .col-12').each(
			(_, el) => {
				const $el = $(el);
				const $a = $el
					.find('a[href*="/komik/"]')
					.filter((__, a) => {
						const h = $(a).attr('href') || '';
						return /\/komik\/[^/]+\/?$/.test(h.split('?')[0]);
					})
					.first();
				if (!$a.length) return;

				const href = ($a.attr('href') || '').split('?')[0];
				const id = this.cleanId(href);
				if (!/^\/komik\/[^/]+$/i.test(id) || seen.has(id)) return;
				const slug = id.split('/').pop() || '';
				if (!slug) return;
				seen.add(id);

				const title = this.normalizeTitle(
					$a.attr('title') ||
						$el.find('.post-title a, h3 a, h5 a').first().text() ||
						$a.find('img').attr('alt') ||
						slug
				);

				const $img = $el.find('img').first();
				let cover = this.imgSrc($img);
				// prefer ukuran lebih besar dari srcset
				const srcset = $img.attr('data-srcset') || $img.attr('srcset') || '';
				if (srcset) {
					const parts = srcset.split(',').map((s) => s.trim());
					const last = parts[parts.length - 1];
					if (last) cover = last.split(/\s+/)[0] || cover;
				}
				cover = this.absUrl(cover);
				if (/dflazy\.jpg/i.test(cover)) {
					cover = this.absUrl(this.imgSrc($img));
				}

				let latestChapter: string | undefined;
				$el.find('a[href*="/chapter-"]').each((__, a) => {
					const n = this.parseChapterNumber(
						$(a).text(),
						$(a).attr('href') || ''
					);
					if (Number.isFinite(n) && n > 0) {
						if (
							!latestChapter ||
							n > parseFloat(latestChapter)
						) {
							latestChapter = String(n);
						}
					}
				});
				// fallback text Chapter N
				if (!latestChapter) {
					const chText = $el.find('.chapter-item, .list-chapter, .chapter').first().text();
					const n = this.parseChapterNumber(chText);
					if (Number.isFinite(n) && n > 0) latestChapter = String(n);
				}

				const badge = $el.find('.manga-title-badges').text().toLowerCase();
				const status = this.mapStatus(
					badge.includes('end') ? 'Completed' : 'Ongoing'
				);

				mangas.push({
					id,
					title,
					cover,
					sourceId: this.id,
					status,
					type: 'manhwa',
					lang: this.DEFAULT_LANG,
					latestChapter
				});
			}
		);

		// fallback: any /komik/slug/ link with image
		if (mangas.length === 0) {
			$('a[href*="/komik/"]').each((_, el) => {
				const href = ($(el).attr('href') || '').split('?')[0];
				const id = this.cleanId(href);
				if (!/^\/komik\/[^/]+$/i.test(id) || seen.has(id)) return;
				if (/\/chapter-/i.test(id)) return;
				seen.add(id);
				const $a = $(el);
				const $img = $a.find('img').first().length
					? $a.find('img').first()
					: $a.closest('div').find('img').first();
				mangas.push({
					id,
					title: this.normalizeTitle(
						$a.attr('title') || $img.attr('alt') || id
					),
					cover: this.absUrl(this.imgSrc($img)),
					sourceId: this.id,
					status: 'Ongoing',
					type: 'manhwa',
					lang: this.DEFAULT_LANG
				});
			});
		}

		return mangas;
	}

	/**
	 * Madara load-more AJAX.
	 * /semua-komik/page/{n}/ mengembalikan HTTP 404 → fetchHtml throw.
	 * Pagination page 2+ lewat admin-ajax.php (madara_load_more).
	 * ajaxPage: 1 = app page 2, 2 = app page 3, dst.
	 */
	private async fetchMadaraPage(ajaxPage: number): Promise<Manga[]> {
		const body = new URLSearchParams({
			action: 'madara_load_more',
			page: String(ajaxPage),
			template: 'madara-core/content/content-archive',
			'vars[post_type]': 'wp-manga',
			'vars[post_status]': 'publish',
			'vars[posts_per_page]': String(this.PER_PAGE),
			'vars[orderby]': 'meta_value_num',
			'vars[meta_key]': '_latest_update',
			'vars[order]': 'desc',
			'vars[paged]': String(ajaxPage)
		});

		const res = await fetch(`${this.baseUrl}/wp-admin/admin-ajax.php`, {
			method: 'POST',
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
				'Content-Type':
					'application/x-www-form-urlencoded; charset=UTF-8',
				'X-Requested-With': 'XMLHttpRequest',
				Referer: `${this.baseUrl}/semua-komik/`
			},
			body: body.toString()
		});
		const html = await res.text();
		if (!html || /no-posts/i.test(html)) return [];
		return this.parseMadaraCards(cheerio.load(html));
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);

			if (p === 1) {
				const homeHtml = await this.fetchHtml('/');
				let list = this.parseMadaraCards(cheerio.load(homeHtml));
				console.log(`[siikomik] homepage → ${list.length}`);

				if (list.length < this.PER_PAGE) {
					const allHtml = await this.fetchHtml('/semua-komik/');
					const fill = this.parseMadaraCards(cheerio.load(allHtml));
					const seen = new Set(list.map((m) => m.id));
					for (const m of fill) {
						if (seen.has(m.id)) continue;
						seen.add(m.id);
						list.push(m);
						if (list.length >= this.PER_PAGE) break;
					}
					console.log(`[siikomik] home+semua → ${list.length}`);
				}

				return list.slice(0, this.PER_PAGE);
			}

			// page 2+ via AJAX (HTML path = HTTP 404)
			const list = await this.fetchMadaraPage(p - 1);
			console.log(`[siikomik] ajax page=${p} → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[siikomik] getLatestManga', e);
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
					? `/?s=${encodeURIComponent(q)}&post_type=wp-manga`
					: `/page/${page}/?s=${encodeURIComponent(q)}&post_type=wp-manga`;
			const html = await this.fetchHtml(path);
			const list = this.parseMadaraCards(cheerio.load(html));
			console.log(`[siikomik] search "${q}" → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[siikomik] searchManga', e);
			return [];
		}
	}

	/** POST /komik/{slug}/ajax/chapters/ */
	private async fetchChapterListAjax(slug: string): Promise<Chapter[]> {
		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		try {
			const url = `${this.baseUrl}/komik/${slug}/ajax/chapters/`;
			const res = await fetch(url, {
				method: 'POST',
				headers: {
					'User-Agent':
						'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
					'Content-Type':
						'application/x-www-form-urlencoded; charset=UTF-8',
					'X-Requested-With': 'XMLHttpRequest',
					Referer: `${this.baseUrl}/komik/${slug}/`
				},
				body: ''
			});
			const html = await res.text();
			const $ = cheerio.load(html);

			$('li.wp-manga-chapter, .wp-manga-chapter, li').each((_, el) => {
				const $li = $(el);
				const $a = $li.find('a').first();
				const href = $a.attr('href') || '';
				if (!href || !/\/chapter-/i.test(href)) return;

				const id = this.cleanId(href);
				if (seen.has(id)) return;

				const number = this.parseChapterNumber($a.text(), id);
				if (!Number.isFinite(number) || number <= 0) return;

				seen.add(id);
				const date =
					$li.find('.chapter-release-date, .font-meta').last().text().trim() ||
					'';

				chapters.push({
					id,
					title: `Chapter ${number}`,
					number,
					date
				});
			});
		} catch (e) {
			console.warn('[siikomik] ajax chapters', e);
		}
		return chapters;
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);

		if (/\/chapter-/i.test(path)) {
			const m = path.match(/^(\/komik\/[^/]+)/i);
			if (m) path = m[1];
		}
		if (!path.startsWith('/komik/')) {
			path = `/komik/${path.replace(/^\//, '')}`;
		}
		path = path.replace(/\/+$/, '');
		const slug = path.split('/').pop() || '';

		const html = await this.fetchHtml(
			path.endsWith('/') ? path : path + '/'
		);
		const $ = cheerio.load(html);

		let title =
			$('.post-title h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content') ||
			$('h1').first().text().trim() ||
			slug;
		title = this.normalizeTitle(title);

		let cover =
			$('.summary_image img').attr('data-src') ||
			$('.summary_image img').attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = this.absUrl((cover || '').trim().split(/\s+/)[0]);

		let description =
			$('.description-summary .summary__content').text().trim() ||
			$('.summary__content').text().trim() ||
			$('.description-summary').text().trim() ||
			$('meta[property="og:description"]').attr('content') ||
			'';
		description = description.replace(/\s+/g, ' ').trim();

		const authors: string[] = [];
		$('.author-content a, .artist-content a').each((_, el) => {
			const name = $(el).text().trim();
			if (name && !authors.includes(name)) authors.push(name);
		});

		const genres: string[] = [];
		$('.genres-content a').each((_, el) => {
			const g = $(el).text().trim();
			if (
				g &&
				!/^(manhwa|manhua|manga|webtoon)$/i.test(g) &&
				!genres.includes(g)
			) {
				genres.push(g);
			}
		});

		const status = this.mapStatus(
			$('.post-status .summary-content').last().text() ||
				$('.post-content_item:contains("Status") .summary-content').text()
		);

		let type: 'manga' | 'manhwa' | 'manhua' = 'manhwa';
		const typeText =
			$('.post-content_item:contains("Type") .summary-content').text() ||
			$('.post-content_item:contains("Tipe") .summary-content').text() ||
			'';
		type = this.mapType(typeText || 'manhwa');

		// chapters: ajax dulu, fallback HTML (sering kosong / spinner)
		let chapters = await this.fetchChapterListAjax(slug);

		if (chapters.length === 0) {
			const seen = new Set<string>();
			$('li.wp-manga-chapter a, .listing-chapters_wrap a').each(
				(_, el) => {
					const href = $(el).attr('href') || '';
					if (!/\/chapter-/i.test(href)) return;
					const id = this.cleanId(href);
					if (seen.has(id)) return;
					const number = this.parseChapterNumber($(el).text(), id);
					if (!Number.isFinite(number) || number <= 0) return;
					seen.add(id);
					chapters.push({
						id,
						title: `Chapter ${number}`,
						number,
						date: ''
					});
				}
			);
		}

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const latestChapter =
			chapters.length && chapters[0].number != null
				? String(chapters[0].number)
				: undefined;

		const metaLines = [
			authors.length && `Author: ${authors.join(' · ')}`,
			chapters[0]?.date && `Latest: ${chapters[0].date}`,
			`Language: Indonesian`,
			`Type: ${type}`,
			chapters.length && `Chapters: ${chapters.length}`
		].filter(Boolean);

		const fullDescription = [...metaLines, description]
			.filter(Boolean)
			.join('\n');

		console.log(
			`[siikomik] details ${path} → ch=${chapters.length} status=${status}`
		);

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			description: fullDescription,
			authors,
			genres,
			status,
			chapters,
			type,
			latestChapter,
			lang: this.DEFAULT_LANG
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(
			chapterId.startsWith('/') ? chapterId : `/${chapterId}`
		);

		const maxAttempts = 3;
		let lastErr: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const html = await this.fetchHtml(
					path.endsWith('/') ? path : path + '/'
				);
				const $ = cheerio.load(html);

				// Cek lock HANYA di dalam .reading-content (bukan CSS/sidebar)
				const $reading = $('.reading-content').first();
				const readingHtml = $reading.html() || '';
				const hasLockMsg =
					/Chapter ini terkunci/i.test(readingHtml) ||
					($reading.find('.content-blocked, .premium-block').length >
						0 &&
						$reading.find(
							'.wp-manga-chapter-img, .page-break img'
						).length === 0);

				const images: string[] = [];
				const seen = new Set<string>();

				const push = (src: string) => {
					src = this.absUrl((src || '').replace(/\s+/g, ''));
					if (
						!src ||
						seen.has(src) ||
						!/^https?:\/\//i.test(src) ||
						src.startsWith('data:') ||
						/logo|icon|avatar|spinner|ads|banner|placeholder|dflazy|75x106|110x150|175x238|350x476/i.test(
							src
						) ||
						/\.gif(\?|$)/i.test(src)
					) {
						return;
					}
					seen.add(src);
					images.push(src);
				};

				// Madara: .wp-manga-chapter-img (data-src sering ada whitespace/newline)
				$(
					'.reading-content .wp-manga-chapter-img, .reading-content .page-break img, .wp-manga-chapter-img'
				).each((_, img) => {
					const $img = $(img);
					const src =
						$img.attr('data-src') ||
						$img.attr('data-lazy-src') ||
						$img.attr('src') ||
						'';
					push(src);
				});

				// regex fallback: CDN chapter images
				if (images.length === 0) {
					const re =
						/https?:\/\/[^\s"'\\]+?(?:ffjackss|\.my\.id\/manga_)[^\s"'\\]*?\.(?:jpg|jpeg|png|webp)/gi;
					const found = html.match(re) || [];
					for (const u of found) push(u);

					// generic numbered pages near manga_
					if (images.length === 0) {
						const re2 =
							/https?:\/\/[^\s"'\\]+\/manga_[a-f0-9]+\/[a-f0-9]+\/\d+\.(?:webp|jpg|png)/gi;
						for (const u of html.match(re2) || []) push(u);
					}
				}

				if (images.length === 0) {
					if (hasLockMsg) {
						console.warn(
							`[siikomik] chapter locked (coin/premium)`,
							path
						);
						return [];
					}
					console.warn(
						`[siikomik] 0 pages attempt=${attempt}`,
						path,
						'htmlLen=',
						html.length
					);
					lastErr = new Error('Siikomik chapter has 0 images');
					await new Promise((r) => setTimeout(r, 400 * attempt));
					continue;
				}

				console.log(`[siikomik] ${images.length} pages → ${path}`);
				return images;
			} catch (e) {
				lastErr = e;
				console.error(
					`[siikomik] getChapterPages attempt=${attempt}`,
					path,
					e
				);
				if (attempt < maxAttempts) {
					await new Promise((r) => setTimeout(r, 500 * attempt));
				}
			}
		}

		console.error('[siikomik] getChapterPages failed', path, lastErr);
		return [];
	}
}
