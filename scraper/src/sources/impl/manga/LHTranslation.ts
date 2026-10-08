/**
 * LHTranslation adapter (lhtranslation.net)
 *
 * Theme     : Madara (WordPress)
 * Latest    : /home/  |  /home/page/{n}/
 * Catalog   : /manga/?m_orderby=latest  |  /manga/page/{n}/?m_orderby=latest
 * Search    : /?s={q}&post_type=wp-manga
 * Detail    : /manga/{slug}/
 * Chapters  : POST /manga/{slug}/ajax/chapters/
 * Pages     : .reading-content img.wp-manga-chapter-img (data-src|src)
 *
 * ID format:
 *   manga   : /manga/{slug}
 *   chapter : /manga/{slug}/chapter-{n}
 */

import { BaseSource } from '../../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';
import * as cheerio from 'cheerio';

export class LHTranslationSource extends BaseSource {
	id = 'lhtranslation';
	name = 'LHTranslation';
	baseUrl = 'https://lhtranslation.net';

	private readonly PER_PAGE = 20;
	private readonly DEFAULT_LANG = 'en';

	// ── Helpers ──────────────────────────────────────────────────────────────

	private absUrl(href: string): string {
		if (!href) return '';
		href = href.trim();
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
			.replace(/&#039;/g, "'")
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&nbsp;/g, ' ')
			.trim();
	}

	private parseChapterNumber(text: string): number {
		const m = String(text || '').match(
			/(?:chapter|chap|ch\.?)\s*(\d+(?:\.\d+)?)/i
		);
		if (m) return parseFloat(m[1]);
		const n = String(text).match(/\b(\d+(?:\.\d+)?)\b/);
		return n ? parseFloat(n[1]) : 0;
	}

	private mapStatus(text: string): string {
		const t = (text || '').toLowerCase();
		if (/complet/.test(t)) return 'Completed';
		if (/hiatus|paused/.test(t)) return 'Hiatus';
		if (/drop|cancel/.test(t)) return 'Dropped';
		return 'Ongoing';
	}

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		$(
			'.page-item-detail, .c-tabs-item__content, .page-listing-item .page-item-detail'
		).each((_, el) => {
			const $card = $(el);
			const $a = $card
				.find('a[href*="/manga/"]')
				.filter((_, a) => {
					const h = ($(a).attr('href') || '').replace(/\/+$/, '');
					return /\/manga\/[^/]+$/.test(h);
				})
				.first();
			if (!$a.length) return;

			const href = ($a.attr('href') || '').trim();
			const id = this.cleanId(href);
			if (!id.includes('/manga/') || seen.has(id)) return;
			seen.add(id);

			let title =
				$a.attr('title') ||
				$card.find('.post-title a, .h5 a, h3 a').first().text() ||
				$a.text();
			title = this.decodeHtml(title).replace(/\s+/g, ' ').trim();
			if (!title || title.length < 2) return;

			const $img = $card.find('img').first();
			let cover =
				$img.attr('data-src') ||
				$img.attr('data-lazy-src') ||
				$img.attr('src') ||
				'';
			if (cover.includes('dflazy') || cover.includes('data:')) {
				const srcset = $img.attr('data-srcset') || $img.attr('srcset') || '';
				const best = srcset
					.split(',')
					.map((s) => s.trim().split(/\s+/)[0])
					.filter(Boolean)
					.pop();
				if (best) cover = best;
			}
			cover = this.absUrl(cover);

			let latestChapter: string | undefined;
			const chText = $card
				.find('.chapter-item .chapter a, .list-chapter .chapter a, .chapter a')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			const chM = chText.match(/(\d+(?:\.\d+)?)/);
			if (chM) latestChapter = chM[1];

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

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const path =
				p <= 1 ? '/home/' : `/home/page/${p}/`;

			const html = await this.fetchHtml(path);
			let list = this.parseCards(cheerio.load(html));

			if (list.length === 0) {
				const alt =
					p <= 1
						? '/manga/?m_orderby=latest'
						: `/manga/page/${p}/?m_orderby=latest`;
				list = this.parseCards(cheerio.load(await this.fetchHtml(alt)));
			}

			const pageList = list.slice(0, this.PER_PAGE);
			console.log(`[lhtranslation] latest page=${p} → ${pageList.length}`);
			return pageList;
		} catch (e) {
			console.error('[lhtranslation] getLatestManga', e);
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
			const list = this.parseCards(cheerio.load(html)).slice(
				0,
				this.PER_PAGE
			);
			console.log(
				`[lhtranslation] search "${q}" page=${page} → ${list.length}`
			);
			return list;
		} catch (e) {
			console.error('[lhtranslation] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const id = this.cleanId(mangaId);
		const path = id.endsWith('/') ? id : `${id}/`;
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title = this.decodeHtml(
			$('.post-title h1, .post-title, h1').first().text() ||
				$('meta[property="og:title"]').attr('content') ||
				''
		)
			.replace(/\s+/g, ' ')
			.trim();

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('.summary_image img, .tab-summary img')
				.first()
				.attr('data-src') ||
			$('.summary_image img').first().attr('src') ||
			'';
		cover = this.absUrl(cover);

		const synopsis = this.decodeHtml(
			$('.description-summary .summary__content, .summary__content, .manga-excerpt')
				.first()
				.text() ||
				$('meta[name="description"]').attr('content') ||
				''
		)
			.replace(/\s+/g, ' ')
			.trim();

		const authors: string[] = [];
		$('.author-content a, .artist-content a').each((_, el) => {
			const a = $(el).text().replace(/\s+/g, ' ').trim();
			if (a && !authors.includes(a)) authors.push(a);
		});

		const genres: string[] = [];
		$('.genres-content a, .wp-manga-genres a').each((_, el) => {
			const g = $(el).text().replace(/\s+/g, ' ').trim();
			if (g && g.length >= 2 && g.length <= 40 && !genres.includes(g)) {
				genres.push(g);
			}
		});

		let status = 'Ongoing';
		$('.post-content_item').each((_, el) => {
			const label = $(el).find('.summary-heading').text().toLowerCase();
			const val = $(el).find('.summary-content').text().replace(/\s+/g, ' ').trim();
			if (/status/.test(label)) status = this.mapStatus(val);
		});

		const altTitles: string[] = [];
		$('.post-content_item').each((_, el) => {
			const label = $(el).find('.summary-heading').text().toLowerCase();
			if (/alternative|alt/.test(label)) {
				const val = $(el)
					.find('.summary-content')
					.text()
					.replace(/\s+/g, ' ')
					.trim();
				for (const part of val.split(/[,;]/)) {
					const t = part.trim();
					if (t && t !== title) altTitles.push(t);
				}
			}
		});

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		try {
			const ajaxUrl = `${this.baseUrl}${path}ajax/chapters/`;
			const res = await fetch(ajaxUrl, {
				method: 'POST',
				headers: {
					'User-Agent': this.headers['User-Agent'],
					'X-Requested-With': 'XMLHttpRequest',
					Referer: `${this.baseUrl}${path}`,
					Origin: this.baseUrl
				}
			});
			const chapHtml = await res.text();
			const $c = cheerio.load(chapHtml);
			$c('li.wp-manga-chapter a, .wp-manga-chapter > a').each((_, el) => {
				const href = ($c(el).attr('href') || '').trim();
				if (!href) return;
				const chId = this.cleanId(href);
				if (seen.has(chId)) return;
				seen.add(chId);

				const name = $c(el).text().replace(/\s+/g, ' ').trim();
				const number = this.parseChapterNumber(name);
				const $date = $c(el)
					.closest('li')
					.find('.chapter-release-date i, .chapter-release-date')
					.first();
				const date = $date
					.text()
					.replace(/\s+/g, ' ')
					.trim();

				chapters.push({
					id: chId,
					title: number ? `Chapter ${number}` : name,
					number: number || chapters.length + 1,
					date: date || undefined
				});
			});
		} catch (e) {
			console.warn('[lhtranslation] ajax chapters failed', e);
		}

		if (chapters.length === 0) {
			$('a[href*="/chapter"]').each((_, el) => {
				const href = ($(el).attr('href') || '').trim();
				const chId = this.cleanId(href);
				if (!/\/manga\/[^/]+\/.+/i.test(chId) || seen.has(chId)) return;
				seen.add(chId);
				const name = $(el).text().replace(/\s+/g, ' ').trim();
				const number = this.parseChapterNumber(name);
				chapters.push({
					id: chId,
					title: number ? `Chapter ${number}` : name,
					number: number || chapters.length + 1
				});
			});
		}

		chapters.sort((a, b) => (a.number || 0) - (b.number || 0));

		const metaLines = [
			altTitles.length && `Alternative: ${altTitles.join(' · ')}`,
			authors[0] && `Author: ${authors[0]}`,
			status && `Status: ${status}`
		].filter(Boolean);

		const description = [...metaLines, synopsis].filter(Boolean).join('\n');

		return {
			id,
			sourceId: this.id,
			title: title || id.split('/').pop() || id,
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
					: undefined
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		if (!path || !/\/manga\//.test(path)) {
			console.warn('[lhtranslation] invalid chapter id:', chapterId);
			return [];
		}

		try {
			const html = await this.fetchHtml(
				path.endsWith('/') ? path : `${path}/`
			);
			const $ = cheerio.load(html);
			const urls: string[] = [];
			const seen = new Set<string>();

			$(
				'.reading-content img.wp-manga-chapter-img, .reading-content img, .entry-content img.wp-manga-chapter-img'
			).each((_, el) => {
				let src =
					$(el).attr('data-src') ||
					$(el).attr('data-lazy-src') ||
					$(el).attr('src') ||
					'';
				src = src.trim();
				if (!src || src.startsWith('data:') || /dflazy|lazyload|pixel/i.test(src))
					return;
				const abs = this.absUrl(src);
				if (seen.has(abs)) return;
				seen.add(abs);
				urls.push(abs);
			});

			console.log(`[lhtranslation] ${urls.length} pages → ${path}`);
			return urls;
		} catch (e) {
			console.error('[lhtranslation] getChapterPages failed', chapterId, e);
			return [];
		}
	}
}
