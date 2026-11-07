/**
 * WeLoMa (weloma.net) — manga raw
 * Path: scraper/src/sources/impl/manga/Weloma.ts
 *
 * Fix:
 *  - Search: /app/manga/controllers/search.single.php?q=  (bukan /search?s=)
 *  - Alt title: li "Other names" → altTitles[]
 */
import { BaseSource } from '../../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';
import * as cheerio from 'cheerio';

export class WelomaSource extends BaseSource {
	id = 'weloma';
	name = 'WeLoMa';
	baseUrl = 'https://weloma.net';

	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'ja';

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
		return id.replace(/\/+$/, '');
	}

	private decodeBase64(b64: string): string {
		if (!b64) return '';
		try {
			const decoded =
				typeof atob !== 'undefined'
					? atob(b64)
					: Buffer.from(b64, 'base64').toString('utf8');
			return decoded.trim();
		} catch {
			return '';
		}
	}

	private decodeDataImg(b64: string): string {
		return this.decodeBase64(b64);
	}

	private normalizeTitle(raw: string): string {
		if (!raw) return '';
		let t = raw.trim().replace(/\s+/g, ' ');

		const letters = t.replace(/[^a-zA-Z]/g, '');
		const upperRatio =
			letters.length === 0
				? 0
				: letters.replace(/[^A-Z]/g, '').length / letters.length;

		if (upperRatio > 0.6) {
			t = t
				.toLowerCase()
				.replace(/(^|[\s\-_/(:\[])([a-z])/g, (_, p, c) => p + c.toUpperCase());
		}

		return t.replace(/\s*[-|]\s*Weloma.*$/i, '').trim();
	}

	private extractCover($el: cheerio.Cheerio<any>): string {
		const dataBg = $el.find('[data-bg]').attr('data-bg');
		if (dataBg) return this.absUrl(dataBg);

		const style =
			$el.find('.img-in-ratio, .content').attr('style') ||
			$el.find('[style*="background-image"]').attr('style') ||
			'';
		const m = style.match(/background-image:\s*url\(['"]?([^'")\s]+)['"]?\)/i);
		if (m?.[1]) return this.absUrl(m[1]);

		const img =
			$el.find('img').attr('src') || $el.find('img').attr('data-src') || '';
		return this.absUrl(img);
	}

	private extractDate($el: cheerio.Cheerio<any>): string {
		const $t = $el.find('.timeago, .chapter-time, time, .time').first();
		if (!$t.length) return '';
		return (
			$t.attr('datetime') ||
			$t.attr('title') ||
			$t.attr('data-time') ||
			$t.attr('data-timestamp') ||
			$t.text().trim() ||
			''
		);
	}

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const mangas: Manga[] = [];
		const seen = new Set<string>();

		$('.thumb-item-flow').each((_, el) => {
			const $el = $(el);
			const a = $el.find('a[href*="/m/"]').first();
			const href = a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			const rawTitle =
				$el.find('.thumb_attr.series-title a').attr('title') ||
				$el.find('.thumb_attr.series-title a').text() ||
				$el.find('.series-title').text() ||
				a.attr('title') ||
				'';
			const title = this.normalizeTitle(rawTitle);
			if (!title) return;

			const chText =
				$el.find('.chapter-title a').attr('title') ||
				$el.find('.chapter-title a').text() ||
				$el.find('.thumb_attr.chapter-title').attr('title') ||
				$el.find('.thumb_attr.chapter-title').text() ||
				'';
			const chMatch =
				chText.match(
					/(?:last\s*chapter|chap(?:ter)?|ch\.?)[:\s]*(\d+(?:\.\d+)?)/i
				) || chText.match(/(\d+(?:\.\d+)?)/);
			const latestChapter = chMatch?.[1] ? parseFloat(chMatch[1]) : undefined;

			mangas.push({
				id,
				title,
				cover: this.extractCover($el as any),
				sourceId: this.id,
				status: 'Ongoing',
				type: 'manga',
				latestChapter,
				lang: this.DEFAULT_LANG
			});
		});

		if (mangas.length === 0) {
			$('a[href*="/m/"]').each((_, el) => {
				const href = $(el).attr('href') || '';
				const id = this.cleanId(href);
				if (!/\/m\/[A-Za-z0-9]+/.test(id) || seen.has(id)) return;
				seen.add(id);

				const title = this.normalizeTitle(
					(($(el).attr('title') || $(el).text()) as string).trim()
				);
				if (title) {
					mangas.push({
						id,
						title,
						cover: '',
						sourceId: this.id,
						status: 'Ongoing',
						type: 'manga',
						lang: this.DEFAULT_LANG
					});
				}
			});
		}

		return mangas;
	}

	// ── List / Search ────────────────────────────────────────────────────────

	async getLatestManga(page: number): Promise<Manga[]> {
		const p = Math.max(1, page | 0);
		const SITE_PER_PAGE = 20;
		const need = this.PER_PAGE;
		const start = (p - 1) * need;
		const end = start + need;

		const firstSitePage = Math.floor(start / SITE_PER_PAGE) + 1;
		const lastSitePage = Math.floor((end - 1) / SITE_PER_PAGE) + 1;

		const all: Manga[] = [];
		const seen = new Set<string>();

		for (let sp = firstSitePage; sp <= lastSitePage; sp++) {
			const path =
				sp <= 1
					? '/l/0OYCn?&sort=last_update'
					: `/l/0OYCn?&sort=last_update&page=${sp}`;

			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const batch = this.parseCards($);

			for (const m of batch) {
				if (seen.has(m.id)) continue;
				seen.add(m.id);
				all.push(m);
			}
		}

		const offsetInWindow = start - (firstSitePage - 1) * SITE_PER_PAGE;
		return all.slice(offsetInWindow, offsetInWindow + need);
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim();
		if (!q) return [];
		const page = Math.max(1, opts?.page ?? 1);

		try {
			const apiPath = `/app/manga/controllers/search.single.php?q=${encodeURIComponent(q)}`;
			const raw = await this.fetchHtml(apiPath);
			const json = JSON.parse(raw) as Array<{
				data?: Array<{
					primary?: string;
					secondary?: string;
					image?: string;
					url?: string;
				}>;
			}>;

			const list: Manga[] = [];
			const seen = new Set<string>();
			const rows = json?.[0]?.data || [];

			for (const row of rows) {
				const href = row.url || '';
				if (!href) continue;
				const id = this.cleanId(href);
				if (!/\/m\/[A-Za-z0-9]+/.test(id) || seen.has(id)) continue;
				seen.add(id);

				const title = this.normalizeTitle(row.primary || '');
				if (!title) continue;

				const chMatch = (row.secondary || '').match(/(\d+(?:\.\d+)?)/);
				const latestChapter = chMatch ? parseFloat(chMatch[1]) : undefined;

				list.push({
					id,
					title,
					cover: this.absUrl(row.image || ''),
					sourceId: this.id,
					status: 'Ongoing',
					type: 'manga',
					lang: this.DEFAULT_LANG,
					...(latestChapter != null && !Number.isNaN(latestChapter)
						? { latestChapter }
						: {})
				});
			}

			if (list.length) {
				if (page <= 1) return list.slice(0, this.PER_PAGE);
			}
		} catch (e) {
			console.error('[weloma] search ajax failed', e);
		}

		try {
			const path =
				page <= 1
					? `/l/0OYCn?name=${encodeURIComponent(q)}`
					: `/l/0OYCn?name=${encodeURIComponent(q)}&page=${page}`;
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			let mangas = this.parseCards($);
			const qLower = q.toLowerCase();
			const filtered = mangas.filter((m) => m.title.toLowerCase().includes(qLower));
			if (filtered.length) mangas = filtered;

			return mangas.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[weloma] search html failed', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const path = this.cleanId(
			mangaId.startsWith('/m/') ? mangaId : `/m/${mangaId.replace(/^\//, '')}`
		);
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		// ── TITLE ────────────────────────────────────────────────────────────
		let title = '';

		const enc =
			$('ul.manga-info h3[data-enc], .manga-info h3[data-enc], h3[data-enc]')
				.first()
				.attr('data-enc') || '';
		if (enc) title = this.decodeBase64(enc);

		if (!title) {
			title =
				$('.info-cover img.thumbnail, .info-cover img').first().attr('title') ||
				'';
		}

		if (!title) {
			const slug = $('.h0rating').attr('slug') || '';
			if (slug) title = slug.replace(/-/g, ' ');
		}

		if (!title) {
			title =
				$('h1').first().text().trim() ||
				$('meta[property="og:title"]').attr('content') ||
				path;
		}

		title = this.normalizeTitle(title);

		let cover =
			$('.info-cover img.thumbnail, .info-cover img').first().attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = this.absUrl(cover);

		const description =
			$('.summary-content, .series-summary .summary-content, .summary')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() || '';

		const statusRaw =
			$(
				'.manga-info a[href*="manga-on-going"], .manga-info a[href*="manga-completed"], .manga-info a.btn-success, .manga-info a.btn-danger'
			)
				.first()
				.text()
				.toLowerCase() || '';
		const status = /complete|end|finish/.test(statusRaw) ? 'Completed' : 'Ongoing';

		const authors: string[] = [];
		const artists: string[] = [];
		const altTitles: string[] = [];
		const genres: string[] = [];

		$('.manga-info li, ul.manga-info li').each((_, li) => {
			const $li = $(li);
			const label = $li.find('b').first().text().toLowerCase().replace(/\s+/g, ' ').trim();
			const valueText = $li
				.clone()
				.children('b, i, svg')
				.remove()
				.end()
				.text()
				.replace(/^[:\s]+/, '')
				.replace(/\s+/g, ' ')
				.trim();

			const links: string[] = [];
			$li.find('a').each((__, a) => {
				const t = $(a).text().trim();
				if (t) links.push(t);
			});

			if (label.includes('other name') || label.includes('alternative') || label.includes('aka')) {
				const raw = valueText || links.join(', ');
				if (raw) {
					for (const part of raw.split(/[,;|/]/)) {
						const t = part.trim();
						if (t && t.length < 120 && !altTitles.includes(t)) altTitles.push(t);
					}
				}
				return;
			}

			if (label.includes('author')) {
				const names = links.length ? links : valueText ? [valueText] : [];
				for (const n of names) {
					if (n && !authors.includes(n)) authors.push(n);
				}
				return;
			}

			if (label.includes('artist')) {
				const names = links.length ? links : valueText ? [valueText] : [];
				for (const n of names) {
					if (n && !artists.includes(n)) artists.push(n);
				}
				return;
			}

			if (label.includes('genre')) {
				for (const t of links.length ? links : valueText ? valueText.split(/[,]/) : []) {
					const g = t.trim();
					if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
				}
			}
		});

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		const $chapterList = $(
			'.list-chapters, #list-chapters, .chapters-list, .chapter-list'
		).first();
		const $chapterLinks = $chapterList.length
			? $chapterList.find('a[href*="/c/"]')
			: $('a[href*="/c/"]');

		$chapterLinks.each((i, el) => {
			const $a = $(el);
			const href = $a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			const chapterTitle =
				$a.find('.chapter-name').text().trim() ||
				$a.attr('title') ||
				$a.text().replace(/\s+/g, ' ').trim() ||
				`Chapter ${i + 1}`;

			const numMatch = chapterTitle.match(
				/(?:chap(?:ter)?|ch\.?|\b)\s*(\d+(?:\.\d+)?)/i
			);
			const number = numMatch?.[1] ? parseFloat(numMatch[1]) : i + 1;

			chapters.push({
				id,
				title: chapterTitle,
				number,
				date: this.extractDate($a as any),
				lang: this.DEFAULT_LANG
			});
		});

		chapters.sort((a, b) => a.number - b.number);

		const details: MangaDetails & {
			artists?: string[];
			altTitles?: string[];
		} = {
			id: path,
			sourceId: this.id,
			title,
			cover,
			description,
			authors,
			genres,
			status,
			chapters,
			type: 'manga',
			lang: this.DEFAULT_LANG,
			latestChapter: chapters.length
				? chapters[chapters.length - 1].number
				: undefined
		};

		if (artists.length) details.artists = artists;
		if (altTitles.length) details.altTitles = altTitles;

		return details;
	}

	async resolveMangaIdFromChapter(chapterId: string): Promise<string | null> {
		const path = this.cleanId(
			chapterId.startsWith('/c/')
				? chapterId
				: chapterId.startsWith('http')
					? chapterId
					: `/c/${chapterId.replace(/^\//, '')}`
		);
		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const href =
				$('a[href*="/m/"]').first().attr('href') ||
				html.match(/href="(\/m\/[A-Za-z0-9]+)"/i)?.[1] ||
				'';
			if (!href) return null;
			const m = href.match(/\/m\/[A-Za-z0-9]+/i);
			return m ? m[0] : null;
		} catch (e) {
			console.error('[weloma] resolveMangaIdFromChapter failed:', e);
			return null;
		}
	}


	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(
			chapterId.startsWith('/c/')
				? chapterId
				: `/c/${chapterId.replace(/^\//, '')}`
		);
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const images: string[] = [];
		const seen = new Set<string>();

		$('.chapter-content img[data-img], img.lazyload[data-img], img[data-img]').each(
			(_, img) => {
				const url = this.decodeDataImg($(img).attr('data-img') || '');
				if (url && !seen.has(url)) {
					seen.add(url);
					images.push(url);
				}
			}
		);

		if (images.length === 0) {
			$('.chapter-content img, #chapter-content img').each((_, img) => {
				let src =
					$(img).attr('data-src') ||
					$(img).attr('data-original') ||
					$(img).attr('src') ||
					'';
				src = this.absUrl(src);
				if (src && !seen.has(src) && !/avatar|logo|icon|spinner/i.test(src)) {
					seen.add(src);
					images.push(src);
				}
			});
		}

		return images;
	}
}

export default WelomaSource;
