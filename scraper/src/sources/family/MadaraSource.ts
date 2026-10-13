/**
 * Family base: WordPress Madara / WP-Manga
 *
 * Override only what differs per site:
 *   seriesPath, listPath, searchPath, cardSelector, defaultLang, perPage, …
 *
 * Existing Madara-like sources can keep extending BaseSource;
 * new ones (or gradual refactors) should extend MadaraSource.
 *
 * Fix (2026-10): fetchChaptersAjax uses POST + X-Requested-With
 * so sites like Setsu Scans return chapter list instead of empty.
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types-manga';

export abstract class MadaraSource extends BaseSource {
	protected perPage = 24;
	protected defaultLang = 'en';

	protected absUrl(url: string): string {
		if (!url) return '';
		if (url.startsWith('http')) return url;
		if (url.startsWith('//')) return `https:${url}`;
		return `${this.baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
	}

	protected cleanId(link: string): string {
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

	protected normalizeTitle(raw: string, siteName?: string): string {
		if (!raw) return '';
		let t = raw.trim().replace(/\s+/g, ' ');
		if (siteName) {
			const re = new RegExp(`\\s*[-|–]\\s*${siteName}.*$`, 'i');
			t = t.replace(re, '');
		}
		return t.trim();
	}

	protected parseChapterNumber(text: string, path = ''): number {
		const fromPath = path.match(
			/(?:chapter|chap|ch)[-_.\s]*(\d+)(?:[.-](\d+))?/i
		);
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

	protected mapStatus(raw: string): string {
		const s = String(raw || '').toLowerCase();
		if (/complete|end|finished|tamat|selesai/.test(s)) return 'Completed';
		if (/hiatus/.test(s)) return 'Hiatus';
		if (/drop|cancel/.test(s)) return 'Dropped';
		return 'Ongoing';
	}

	protected mapType(raw: string): string {
		const t = String(raw || '').toLowerCase();
		if (t.includes('manhwa')) return 'manhwa';
		if (t.includes('manhua')) return 'manhua';
		if (t.includes('comic') || t.includes('western')) return 'comic';
		return 'manga';
	}

	protected preferFullCover(url: string): string {
		if (!url) return '';
		return url.replace(/-\d+x\d+(\.\w+)(\?.*)?$/, '$1$2');
	}

	protected seriesPath = '/manga';
	protected listPath(page: number): string {
		const p = page <= 1 ? '' : `page/${page}/`;
		return `${this.seriesPath}/${p}?m_orderby=latest`;
	}
	protected searchPath(query: string, page: number): string {
		const q = encodeURIComponent(query);
		const base = `/?s=${q}&post_type=wp-manga`;
		return page <= 1 ? base : `/page/${page}/${base.replace(/^\//, '')}`;
	}

	protected cardSelector =
		'.page-item-detail, .manga, .c-tabs-item__content, .badge-pos-1';
	protected chapterListSelector =
		'li.wp-manga-chapter a, .listing-chapters_wrap a, .version-chap a, .main.version-chap li a';
	protected pageImageSelector =
		'.reading-content img, .page-break img, .wp-manga-chapter-img';
	protected useAjaxChapters = true;

	protected parseCards($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();
		const seriesRe = new RegExp(
			`${this.seriesPath.replace(/\//g, '\\/')}\\/[^/]+\\/?$`
		);

		$(this.cardSelector).each((_, card) => {
			const $card = $(card);
			const $a = $card
				.find(`a[href*="${this.seriesPath}/"]`)
				.filter((_, el) => {
					const h = ($(el).attr('href') || '').split('?')[0];
					return seriesRe.test(h.replace(this.baseUrl, ''));
				})
				.first();

			const href = $a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (seen.has(id) || /\/(page|genre|tag|author)\//i.test(id)) return;
			seen.add(id);

			const title = this.normalizeTitle(
				$a.attr('title') || $a.text() || $card.find('img').attr('alt') || '',
				this.name
			);
			if (!title) return;

			const $img = $card.find('img').first();
			let cover =
				$img.attr('data-src') ||
				$img.attr('data-lazy-src') ||
				$img.attr('src') ||
				'';
			if (cover.startsWith('data:')) cover = '';
			cover = this.preferFullCover(this.absUrl(cover));

			let latestChapter: string | undefined;
			const chText = $card
				.find('.chapter-item a, .list-chapter a, .font-meta.chapter a, .chapter a')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			if (chText) {
				const n = this.parseChapterNumber(chText);
				if (n > 0) latestChapter = String(n);
			}

			res.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type: this.mapType($card.text()),
				status: 'Ongoing',
				latestChapter,
				lang: this.defaultLang
			});
		});

		return res;
	}

	async getLatestManga(page: number): Promise<Manga[]> {
		const html = await this.fetchHtml(this.listPath(Math.max(1, page || 1)));
		const $ = cheerio.load(html);
		return this.parseCards($);
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = Math.max(1, opts?.page || 1);
		const html = await this.fetchHtml(this.searchPath(query, page));
		const $ = cheerio.load(html);
		return this.parseCards($);
	}

	protected async fetchChaptersAjax(mangaPath: string): Promise<Chapter[]> {
		if (!this.useAjaxChapters) return [];
		const base = mangaPath.endsWith('/') ? mangaPath : `${mangaPath}/`;
		const url = `${this.baseUrl}${base}ajax/chapters/`;

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'User-Agent':
						this.headers?.['User-Agent'] ||
						'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
					Accept: '*/*',
					'Accept-Language': 'en-US,en;q=0.9',
					'X-Requested-With': 'XMLHttpRequest',
					'Content-Type': 'application/x-www-form-urlencoded',
					Origin: this.baseUrl,
					Referer: `${this.baseUrl}${base}`,
					'Sec-Fetch-Dest': 'empty',
					'Sec-Fetch-Mode': 'cors',
					'Sec-Fetch-Site': 'same-origin'
				},
				body: '',
				redirect: 'follow'
			});

			const html = await response.text();
			const lower = html.toLowerCase();
			const isChallenge =
				response.status === 403 ||
				response.status === 503 ||
				/just a moment|verify you are human|cf-browser-verification|challenge-platform|cf-turnstile|checking your browser/i.test(
					lower
				);

			if (isChallenge || !response.ok) {
				console.warn(`[${this.id}] ajax/chapters blocked`, {
					url,
					status: response.status
				});
				return [];
			}

			return this.parseChapterList(cheerio.load(html));
		} catch (e) {
			console.warn(`[${this.id}] fetchChaptersAjax failed`, e);
			return [];
		}
	}

	protected isChapterLocked(
		$a: cheerio.Cheerio<any>,
		$li: cheerio.Cheerio<any>
	): boolean {
		const cls = `${$li.attr('class') || ''} ${$a.attr('class') || ''}`.toLowerCase();
		if (/premium|locked|vip|paywall|coin|paid/.test(cls)) return true;
		if ($li.find('.premium, .lock, .locked, .coin, .c-icon-lock, [data-coin], .premium-star').length)
			return true;
		const target = ($a.attr('data-bs-target') || $a.attr('data-target') || '').toLowerCase();
		if (target.includes('lock') || target.includes('premium') || target.includes('coin')) return true;
		if ($a.attr('data-coin') || $li.attr('data-coin')) return true;
		return false;
	}

	protected parseChapterList($: cheerio.CheerioAPI): Chapter[] {
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$(this.chapterListSelector).each((_, a) => {
			const $a = $(a);
			const href = $a.attr('href') || '';
			if (!href) return;
			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			const $li = $a.closest('li');
			const rawText = $a.text().replace(/\s+/g, ' ').trim();
			const number = this.parseChapterNumber(rawText || id, id);
			const title = number > 0 ? `Chapter ${number}` : rawText || id;
			const date =
				$li
					.find('.chapter-release-date, .chapterdate, .chapter-date, .dt, time, .date')
					.first()
					.text()
					.replace(/\s+/g, ' ')
					.trim() ||
				$li.find('time').attr('datetime') ||
				undefined;
			const isLocked = this.isChapterLocked($a, $li);

			chapters.push({
				id,
				title,
				number,
				date: date || undefined,
				lang: this.defaultLang,
				...(isLocked ? { isLocked: true } : {})
			});
		});

		return chapters;
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const path = this.cleanId(mangaId);
		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const title = this.normalizeTitle(
			$('h1').first().text() ||
				$('.post-title h1, .manga-title').first().text() ||
				'',
			this.name
		);

		const $img = $(
			[
				'.summary_image img',
				'.thumb img',
				'.manga-thumb img',
				'.manga-poster img',
				'img.wp-post-image',
				'.post-thumbnail img',
				'.thumbook img'
			].join(', ')
		).first();
		let cover =
			$img.attr('data-src') ||
			$img.attr('data-lazy-src') ||
			$img.attr('data-srcset')?.split(/\s*,\s*/)[0]?.split(/\s+/)[0] ||
			$img.attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			$('meta[name="twitter:image"]').attr('content') ||
			'';
		if (cover.startsWith('data:')) cover = '';
		cover = this.preferFullCover(this.absUrl(cover));

		const description = $(
			'.description-summary .summary__content, .manga-excerpt, .summary_content'
		)
			.first()
			.text()
			.replace(/\s+/g, ' ')
			.trim();

		const genres: string[] = [];
		$('.genres-content a, .manga-genres a').each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		const authors: string[] = [];
		$('.author-content a, .artist-content a').each((_, a) => {
			const t = $(a).text().replace(/\s+/g, ' ').trim();
			if (t && !authors.includes(t)) authors.push(t);
		});

		let status = 'Ongoing';
		$('.post-status, .manga-status').each((_, el) => {
			const t = $(el).text();
			if (/status/i.test(t)) status = this.mapStatus(t);
		});

		let chapters = await this.fetchChaptersAjax(path);
		if (chapters.length === 0) chapters = this.parseChapterList($);

		return {
			id: path,
			sourceId: this.id,
			title: title || path.split('/').filter(Boolean).pop() || path,
			cover,
			type: this.mapType($('.post-content_item, .summary-content').text()),
			status,
			description,
			authors,
			genres,
			chapters,
			latestChapter: chapters[0] ? String(chapters[0].number) : undefined,
			lang: this.defaultLang
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		try {
			const path = this.cleanId(chapterId);
			const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
			const $ = cheerio.load(html);
			const pages: string[] = [];
			const seen = new Set<string>();

			const push = (src?: string | null) => {
				if (!src || src.startsWith('data:')) return;
				const url = this.absUrl(src.split(/\s+/)[0].split('?')[0]);
				if (!url || seen.has(url)) return;
				if (/logo|icon|avatar|emoji|spinner|loading/i.test(url)) return;
				seen.add(url);
				pages.push(url);
			};

			$(this.pageImageSelector).each((_, img) => {
				const $img = $(img);
				push(
					$img.attr('data-src') ||
						$img.attr('data-lazy-src') ||
						$img.attr('data-srcset')?.split(/\s+/)[0] ||
						$img.attr('src')
				);
			});

			if (pages.length === 0) {
				const re =
					/(https?:\/\/[^"'\\\s]+\/wp-content\/uploads\/[^"'\\\s]+\.(?:webp|jpg|jpeg|png|avif))/gi;
				let m: RegExpExecArray | null;
				while ((m = re.exec(html)) !== null) push(m[1]);
			}

			return pages;
		} catch (e) {
			console.error(`[${this.id}] getChapterPages`, e);
			return [];
		}
	}
}
