/**
 * Setsu Scans (setsuscans.com)
 * Theme: WordPress Madara (wp-content/themes/madara/)
 *
 * Latest  : /manga/?m_orderby=latest  |  /manga/page/{n}/?m_orderby=latest
 * Search  : /?s={q}&post_type=wp-manga
 * Detail  : /manga/{slug}/
 * Chapters: POST /manga/{slug}/ajax/chapters/  (XHR)
 * Pages   : .reading-content img / .wp-manga-chapter-img
 */

import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';

export class SetsuScansSource extends BaseSource {
	id = 'setsuscans';
	name = 'Setsu Scans';
	baseUrl = 'https://setsuscans.com';

	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'en';
	private readonly SERIES = '/manga';

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept:
			'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		'Cache-Control': 'no-cache',
		Pragma: 'no-cache',
		'Sec-Fetch-Dest': 'document',
		'Sec-Fetch-Mode': 'navigate',
		'Sec-Fetch-Site': 'none',
		'Sec-Fetch-User': '?1',
		'Upgrade-Insecure-Requests': '1'
	};

	// ── Helpers ──────────────────────────────────────────────────────────────

	private absUrl(href: string | undefined | null): string {
		if (!href) return '';
		const h = String(href).trim();
		if (!h || h.startsWith('data:')) return '';
		if (h.startsWith('http')) return h.split('?')[0];
		if (h.startsWith('//')) return `https:${h}`.split('?')[0];
		return `${this.baseUrl}${h.startsWith('/') ? '' : '/'}${h}`.split('?')[0];
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

	private decodeHtml(s: string): string {
		return String(s || '')
			.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
			.replace(/&#x([0-9a-f]+);/gi, (_, h) =>
				String.fromCharCode(parseInt(h, 16))
			)
			.replace(/&amp;/g, '&')
			.replace(/&quot;/g, '"')
			.replace(/&#039;|&apos;/g, "'")
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&nbsp;/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	}

	private normalizeTitle(raw: string): string {
		return this.decodeHtml(raw)
			.replace(/\s*[-|–]\s*Setsu\s*Scans.*$/i, '')
			.replace(/\s+/g, ' ')
			.trim();
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath =
			path.match(/\/chapter[-_.]?(\d+)(?:[.-](\d+))?/i) ||
			path.match(/\/ch[-_.]?(\d+)(?:[.-](\d+))?/i);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null && fromPath[2].length <= 2) {
				return parseFloat(`${major}.${fromPath[2]}`);
			}
			return major;
		}
		const m = String(text || '').match(
			/(?:chapter|chap|ch\.?)\s*(\d+)(?:[.,](\d+))?/i
		);
		if (m) {
			if (m[2] != null && m[2].length <= 2) return parseFloat(`${m[1]}.${m[2]}`);
			return parseInt(m[1], 10);
		}
		const n = String(text).match(/\b(\d+(?:\.\d+)?)\b/);
		return n ? parseFloat(n[1]) : 0;
	}

	private mapStatus(raw: string): string {
		const s = String(raw || '').toLowerCase();
		if (/complete|end|finished|tamat|selesai/.test(s)) return 'Completed';
		if (/hiatus|on[\s-]?hold/.test(s)) return 'Hiatus';
		if (/drop|cancel/.test(s)) return 'Dropped';
		return 'Ongoing';
	}

	private isChallenge(status: number, html: string): boolean {
		if (status === 403 || status === 503) return true;
		const lower = html.toLowerCase();
		return /just a moment|verify you are human|cf-browser-verification|challenge-platform|cf-turnstile|checking your browser|attention required/i.test(
			lower
		);
	}

	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const response = await fetch(url, {
			headers: { ...this.headers, Referer: `${this.baseUrl}/` },
			redirect: 'follow'
		});
		const html = await response.text();
		if (this.isChallenge(response.status, html) || !response.ok) {
			console.error('[setsuscans] Cloudflare / blocked', {
				url,
				status: response.status
			});
			throw new Error(
				`Failed to fetch ${url}: ${response.status}` +
					(this.isChallenge(response.status, html)
						? ' (Cloudflare challenge)'
						: '')
			);
		}
		return html;
	}

	private async fetchChaptersAjax(mangaPath: string): Promise<Chapter[]> {
		const base = mangaPath.endsWith('/') ? mangaPath : `${mangaPath}/`;
		const url = `${this.baseUrl}${base}ajax/chapters/`;

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'User-Agent': this.headers['User-Agent'],
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
			if (this.isChallenge(response.status, html) || !response.ok) {
				console.warn('[setsuscans] ajax/chapters blocked', response.status);
				return [];
			}
			return this.parseChapterList(cheerio.load(html));
		} catch (e) {
			console.warn('[setsuscans] fetchChaptersAjax failed', e);
			return [];
		}
	}

	private parseChapterList($: cheerio.CheerioAPI): Chapter[] {
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$(
			'li.wp-manga-chapter a, .listing-chapters_wrap a, .version-chap a, .main.version-chap li a, .wp-manga-chapter > a'
		).each((_, a) => {
			const $a = $(a);
			const href = ($a.attr('href') || '').trim();
			if (!href) return;
			const id = this.cleanId(href);
			if (seen.has(id) || !id.includes('/manga/')) return;
			seen.add(id);

			const rawText = this.decodeHtml($a.text());
			const number = this.parseChapterNumber(rawText || id, id);
			const title = number > 0 ? `Chapter ${number}` : rawText || id;
			const date =
				$a
					.closest('li')
					.find('.chapter-release-date i, .chapter-release-date')
					.first()
					.text()
					.replace(/\s+/g, ' ')
					.trim() || undefined;

			chapters.push({
				id,
				title,
				number: number || chapters.length + 1,
				date,
				lang: this.DEFAULT_LANG
			});
		});

		return chapters;
	}

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();
		const seriesRe = new RegExp(
			`${this.SERIES.replace(/\//g, '\\/')}\\/[^/]+\\/?$`
		);

		$(
			'.page-item-detail, .manga, .c-tabs-item__content, .badge-pos-1, .page-listing-item .page-item-detail'
		).each((_, card) => {
			const $card = $(card);
			const $a = $card
				.find(`a[href*="${this.SERIES}/"]`)
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
				$a.attr('title') ||
					$a.text() ||
					$card.find('.post-title a, h3 a, h5 a').first().text() ||
					$card.find('img').attr('alt') ||
					''
			);
			if (!title || title.length < 2) return;

			const $img = $card.find('img').first();
			let cover =
				$img.attr('data-src') ||
				$img.attr('data-lazy-src') ||
				$img.attr('src') ||
				'';
			if (cover.startsWith('data:') || /dflazy|lazyload|pixel/i.test(cover)) {
				const srcset = $img.attr('data-srcset') || $img.attr('srcset') || '';
				const best = srcset
					.split(',')
					.map((s) => s.trim().split(/\s+/)[0])
					.filter(Boolean)
					.pop();
				if (best) cover = best;
			}
			cover = this.absUrl(cover).replace(/-\d+x\d+(\.\w+)$/, '$1');

			let latestChapter: string | undefined;
			const chText = $card
				.find(
					'.chapter-item a, .list-chapter a, .font-meta.chapter a, .chapter a, .latest-chap a'
				)
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
				type: 'manga',
				status: 'Ongoing',
				latestChapter,
				lang: this.DEFAULT_LANG
			});
		});

		return res;
	}

	// ── Public API ───────────────────────────────────────────────────────────

	async getLatestManga(page: number): Promise<Manga[]> {
		const p = Math.max(1, Number(page) || 1);
		const path =
			p <= 1
				? `${this.SERIES}/?m_orderby=latest`
				: `${this.SERIES}/page/${p}/?m_orderby=latest`;
		try {
			const html = await this.fetchHtml(path);
			const list = this.parseCards(cheerio.load(html)).slice(0, this.PER_PAGE);
			console.log(`[setsuscans] latest page=${p} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[setsuscans] getLatestManga', e);
			return [];
		}
	}

	async searchManga(
		query: string,
		opts?: { page?: number }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page || 1);
		if (!q) return this.getLatestManga(page);

		const path =
			page <= 1
				? `/?s=${encodeURIComponent(q)}&post_type=wp-manga`
				: `/page/${page}/?s=${encodeURIComponent(q)}&post_type=wp-manga`;

		try {
			const html = await this.fetchHtml(path);
			const list = this.parseCards(cheerio.load(html)).slice(0, this.PER_PAGE);
			console.log(`[setsuscans] search "${q}" page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[setsuscans] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const path = this.cleanId(mangaId);
		const detailPath = path.endsWith('/') ? path : `${path}/`;
		const html = await this.fetchHtml(detailPath);
		const $ = cheerio.load(html);

		const title = this.normalizeTitle(
			$('.post-title h1, .post-title, h1').first().text() ||
				$('meta[property="og:title"]').attr('content') ||
				''
		);

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('.summary_image img, .tab-summary img, .manga-thumb img')
				.first()
				.attr('data-src') ||
			$('.summary_image img').first().attr('src') ||
			'';
		cover = this.absUrl(cover).replace(/-\d+x\d+(\.\w+)$/, '$1');

		const description = this.decodeHtml(
			$(
				'.description-summary .summary__content, .summary__content, .manga-excerpt, .summary_content'
			)
				.first()
				.text() ||
				$('meta[name="description"]').attr('content') ||
				''
		);

		const authors: string[] = [];
		$('.author-content a, .artist-content a').each((_, el) => {
			const a = $(el).text().replace(/\s+/g, ' ').trim();
			if (a && !authors.includes(a)) authors.push(a);
		});

		const genres: string[] = [];
		$('.genres-content a, .wp-manga-genres a, .manga-genres a').each((_, el) => {
			const g = $(el).text().replace(/\s+/g, ' ').trim();
			if (g && g.length >= 2 && g.length <= 40 && !genres.includes(g)) {
				genres.push(g);
			}
		});

		let status = 'Ongoing';
		$('.post-content_item, .post-status').each((_, el) => {
			const label = $(el).find('.summary-heading, h5').text().toLowerCase();
			const val = $(el)
				.find('.summary-content')
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			if (/status/.test(label) || /status/i.test($(el).text())) {
				status = this.mapStatus(val || $(el).text());
			}
		});

		let chapters = await this.fetchChaptersAjax(path);

		if (chapters.length === 0) {
			chapters = this.parseChapterList($);
		}

		if (chapters.length === 0) {
			const seen = new Set<string>();
			$('a[href*="/chapter"], a[href*="/ch-"]').each((_, el) => {
				const href = ($(el).attr('href') || '').trim();
				const chId = this.cleanId(href);
				if (!/\/manga\/[^/]+\/.+/i.test(chId) || seen.has(chId)) return;
				seen.add(chId);
				const name = $(el).text().replace(/\s+/g, ' ').trim();
				const number = this.parseChapterNumber(name, chId);
				chapters.push({
					id: chId,
					title: number > 0 ? `Chapter ${number}` : name || chId,
					number: number || chapters.length + 1,
					lang: this.DEFAULT_LANG
				});
			});
		}

		chapters.sort((a, b) => (a.number || 0) - (b.number || 0));

		console.log(
			`[setsuscans] details ${path} → chapters=${chapters.length}`
		);

		return {
			id: path,
			sourceId: this.id,
			title: title || path.split('/').filter(Boolean).pop() || path,
			cover,
			type: 'manga',
			status,
			description,
			authors,
			genres,
			chapters,
			latestChapter:
				chapters.length > 0
					? String(chapters[chapters.length - 1].number)
					: undefined,
			lang: this.DEFAULT_LANG
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		if (!path || !/\/manga\//.test(path)) {
			console.warn('[setsuscans] invalid chapter id:', chapterId);
			return [];
		}

		try {
			const html = await this.fetchHtml(
				path.endsWith('/') ? path : `${path}/`
			);
			const $ = cheerio.load(html);
			const pages: string[] = [];
			const seen = new Set<string>();

			const push = (src?: string | null) => {
				if (!src || src.startsWith('data:')) return;
				let url = this.absUrl(src.split(/\s+/)[0]);
				if (!url || seen.has(url)) return;
				if (/logo|icon|avatar|emoji|spinner|loading|dflazy|pixel/i.test(url))
					return;
				if (url.includes('i0.wp.com') || url.includes('i1.wp.com')) {
					try {
						const u = new URL(url);
						u.searchParams.delete('fit');
						url = u.toString();
					} catch {
						/* ignore */
					}
				}
				seen.add(url);
				pages.push(url);
			};

			$(
				'.reading-content img, .page-break img, .wp-manga-chapter-img, .entry-content img.wp-manga-chapter-img'
			).each((_, img) => {
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

			console.log(`[setsuscans] ${pages.length} pages → ${path}`);
			return pages;
		} catch (e) {
			console.error('[setsuscans] getChapterPages', e);
			return [];
		}
	}
}

export default SetsuScansSource;