/**
 * Family base: WordPress Madara / WP-Manga — **NOVEL** (text chapters)
 *
 * Extends MadaraSource for cards / chapter list / lock / AJAX chapters.
 * Adds getChapterContent() with prevChapterId / nextChapterId (required by novel reader).
 * getChapterPages() always returns [] (text, not images).
 *
 * Override per site:
 *   seriesPath, listPath, searchPath, listOrderby, defaultLang, perPage,
 *   mergeHomeOnPage1, contentSelector
 */

import * as cheerio from 'cheerio';
import { MadaraSource } from './MadaraSource';
import type { Chapter, Manga, MangaDetails } from '../types-manga';

export abstract class MadaraNovelSource extends MadaraSource {
	protected contentType: 'novel' = 'novel';
	protected mergeHomeOnPage1 = true;
	protected contentSelector =
		'.reading-content .text-left, .reading-content, .text-left, .entry-content, .epcontent, #readerarea';

	protected cardSelector =
		'.page-item-detail, .manga, .c-tabs-item__content, .badge-pos-1, li.mrm-r-item, .mrm-r-item, .bs, .listupd .bs, .slider__item, .page-listing-item .page-item-detail, .lb-library-item';

	protected mapType(_raw?: string): string {
		return this.contentType;
	}

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	protected listPath(page: number): string {
		const p = Math.max(1, page || 1);
		if (p <= 1) return `${this.seriesPath}/?m_orderby=${this.listOrderby}`;
		return `${this.seriesPath}/page/${p}/?m_orderby=${this.listOrderby}`;
	}

	protected searchPath(query: string, page: number): string {
		const q = encodeURIComponent(query);
		const base = `/?s=${q}&post_type=wp-manga`;
		return page <= 1 ? base : `/page/${page}/?s=${q}&post_type=wp-manga`;
	}

	protected parseCards($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();
		const seriesRe = new RegExp(
			`${this.seriesPath.replace(/\//g, '\\/')}\\/[^/]+\\/?$`
		);

		$(this.cardSelector).each((_, card) => {
			const $card = $(card);
			let $a = $card
				.find(`a[href*="${this.seriesPath}/"]`)
				.filter((_, el) => {
					const h = ($(el).attr('href') || '').split('?')[0];
					return seriesRe.test(h.replace(this.baseUrl, ''));
				})
				.first();

			if (!$a.length) {
				$a = $card
					.find(
						'.post-title a, h3 a, h5 a, a.mrm-r-item__link, a.lb-title-link, .lb-title a'
					)
					.filter((_, el) => {
						const h = ($(el).attr('href') || '').split('?')[0];
						return (
							seriesRe.test(h.replace(this.baseUrl, '')) ||
							new RegExp(
								`${this.seriesPath.replace(/\//g, '\\/')}\\/[^/]+`,
								'i'
							).test(h)
						);
					})
					.first();
			}

			const href = $a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (seen.has(id) || /\/(page|genre|tag|author)\//i.test(id)) return;
			seen.add(id);

			const title = this.normalizeTitle(
				$a.attr('title') ||
					$card
						.find(
							'.mrm-r-item__title, .post-title a, .post-title, h3 a, h3, h5 a, h5, .tt, .lb-title a, .lb-title'
						)
						.first()
						.text() ||
					$a.text() ||
					$card.find('img').attr('alt') ||
					'',
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
			const chTexts = $card
				.find(
					[
						'.chapter-item a',
						'.list-chapter a',
						'.font-meta.chapter a',
						'.chapter.font-meta a',
						'span.chapter a',
						'.chapter a',
						'.lb-chapter-list a',
						'a.btn-link',
						'a[href*="/chapter"]',
						'.mrm-r-item__chapter',
						'.epxs',
						'.epx'
					].join(', ')
				)
				.map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
				.get()
				.filter((t) => t.length > 0);

			for (const chText of chTexts) {
				const n = this.parseChapterNumber(chText);
				if (n > 0) {
					latestChapter = String(n);
					break;
				}
			}

			if (!latestChapter) {
				const meta = $card
					.find(
						'.list-chapter, .lb-chapter-list, .chapter-item, .item-summary .list-chapter'
					)
					.first()
					.text()
					.replace(/\s+/g, ' ')
					.trim();
				const n = this.parseChapterNumber(meta);
				if (n > 0) latestChapter = String(n);
			}

			res.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type: this.contentType,
				status: 'Ongoing',
				latestChapter,
				lang: this.defaultLang
			});
		});

		return res;
	}

	protected parseChapterList($: cheerio.CheerioAPI): Chapter[] {
		return super.parseChapterList($).map(({ lang: _lang, ...ch }) => ch);
	}

	async getLatestManga(page: number): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			let list: Manga[] = [];

			try {
				list = await this.fetchCatalogPages((sp) => this.listPath(sp), p);
			} catch (e) {
				console.warn(`[${this.id}] listPath failed page=${p}`, e);
				list = [];
			}

			if (this.mergeHomeOnPage1 && p === 1 && list.length < this.perPage) {
				try {
					const home = this.parseCards(cheerio.load(await this.fetchHtml('/')));
					const seen = new Set(list.map((m) => m.id));
					for (const m of home) {
						if (seen.has(m.id)) continue;
						seen.add(m.id);
						list.push(m);
						if (list.length >= this.perPage) break;
					}
				} catch (e) {
					console.warn(`[${this.id}] homepage merge failed`, e);
				}
			}

			if (list.length === 0 && p === 1) {
				try {
					list = this.parseCards(
						cheerio.load(await this.fetchHtml(`${this.seriesPath}/`))
					);
				} catch {
					/* ignore */
				}
			}

			console.log(`[${this.id}] latest page=${p} → ${list.length}`);
			return list.slice(0, this.perPage);
		} catch (e) {
			console.error(`[${this.id}] getLatestManga`, e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const details = await super.getMangaDetails(mangaId);
		const chapters = (details.chapters || []).map(({ lang: _lang, ...ch }) => ch);
		return { ...details, type: this.contentType, chapters };
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		const path = this.cleanId(chapterId);
		if (path.includes('/__locked__/')) {
			throw new Error(`Chapter is locked / premium on ${this.name}`);
		}

		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const bodyText = $('body').text().toLowerCase();
		const contentProbe = $(
			'.reading-content p, .text-left p, .entry-content p, .epcontent p'
		).length;
		if (
			contentProbe < 2 &&
			(/you need to (buy|unlock)|premium chapter|login to view|subscribe to read|not enough coin|chapter is locked/i.test(
				bodyText
			) ||
				$('.premium-block, .c-blocked-content, .content-blocked').length > 0)
		) {
			throw new Error(`Chapter is locked / premium on ${this.name}`);
		}

		const rawTitle =
			$('h1#chapter-heading, h1.entry-title, h1, .post-title h1, .chapter-heading')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/\s*[|\-–]\s*/)[0]?.trim() ||
			'';
		const number = this.parseChapterNumber(rawTitle + ' ' + path, path);
		const title = number > 0 ? `Chapter ${number}` : rawTitle || 'Chapter';

		const root = $(this.contentSelector).first();
		root
			.find(
				'script, style, noscript, iframe, .ads, .ad, .adsbygoogle, .code-block, .sharedaddy, .chapter-nav, .chnav, .navi, nav'
			)
			.remove();

		let content = (root.html() || '').trim();
		if (!content || content.replace(/<[^>]+>/g, '').trim().length < 40) {
			const paras = root
				.find('p')
				.map((_, p) => $(p).text().trim())
				.get()
				.filter((t) => t.length > 5);
			if (paras.length) {
				content = paras.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
			}
		}
		if (!content || content.replace(/<[^>]+>/g, '').trim().length < 20) {
			content =
				'<p><em>Empty content — selector may have changed or chapter is locked.</em></p>';
		}

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		const pick = (sels: string[]): string | null => {
			for (const sel of sels) {
				const href = ($(sel).first().attr('href') || '').trim();
				if (!href || href === '#' || href.toLowerCase().startsWith('javascript:')) continue;
				const id = this.cleanId(href);
				if (id && id !== path && id !== '/' && !id.includes('/__locked__/')) return id;
			}
			return null;
		};

		prevChapterId = pick([
			'a.btn.prev_page',
			'a.prev_page',
			'.nav-previous a',
			'a[rel="prev"]',
			'.chnav a.prev',
			'.navi a.prev',
			'a.ch-prev'
		]);
		nextChapterId = pick([
			'a.btn.next_page',
			'a.next_page',
			'.nav-next a',
			'a[rel="next"]',
			'.chnav a.next',
			'.navi a.next',
			'a.ch-next'
		]);

		if (!prevChapterId || !nextChapterId) {
			const adj = this.adjacentChapterIds(path);
			if (!prevChapterId && adj.prev) prevChapterId = adj.prev;
			if (!nextChapterId && adj.next) nextChapterId = adj.next;
		}

		console.log(
			`[${this.id}] chapter ${path} → ${content.length}c prev=${prevChapterId} next=${nextChapterId}`
		);

		return { title, content, prevChapterId, nextChapterId };
	}

	protected adjacentChapterIds(path: string): {
		prev: string | null;
		next: string | null;
	} {
		const m = path.match(/^(.*\/)(?:chapter[-_])?(\d+(?:\.\d+)?)\/?$/i);
		if (!m) return { prev: null, next: null };
		const n = parseFloat(m[2]);
		if (!Number.isFinite(n) || n <= 0) return { prev: null, next: null };
		const prevN = n > 1 ? (Number.isInteger(n) ? n - 1 : Math.floor(n)) : null;
		const nextN = Number.isInteger(n) ? n + 1 : Math.ceil(n);
		const prefix =
			m[1].endsWith('chapter-') || m[1].endsWith('chapter_')
				? m[1]
				: `${m[1]}chapter-`;
		const m2 = path.match(/^(.*?\/)(chapter[-_])(\d+(?:\.\d+)?)\/?$/i);
		if (m2) {
			const pre = m2[1];
			const tag = m2[2];
			return {
				prev: prevN != null && prevN > 0 ? `${pre}${tag}${prevN}` : null,
				next: `${pre}${tag}${nextN}`
			};
		}
		return {
			prev: prevN != null && prevN > 0 ? `${prefix}${prevN}` : null,
			next: `${prefix}${nextN}`
		};
	}
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export default MadaraNovelSource;
