/**
 * NHV Novels (nhvnovels.com) — custom WP theme (novel)
 * Path: scraper/src/sources/impl/novel/NhvNovels.ts
 *
 * URLs:
 *   Novel   : /novels/{slug}/
 *   Chapter : /chapters/{chapter-slug}/
 *   List    : /  (Recently Updated) · /novels/ · ?s=
 *
 * API helper:
 *   GET /wp-json/custom/v1/latest-novels
 *
 * Chapter lock: data-type="premium" on .chapter-item · mycred paywall in .chapter-text
 * Nav: .chapter-nav button[onclick*="location.href"]
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const PAGE_SIZE = 24;

function absUrl(base: string, href: string | undefined): string {
	if (!href) return '';
	if (href.startsWith('//')) return `https:${href}`;
	if (href.startsWith('http')) return href;
	try {
		return new URL(href, base).href;
	} catch {
		return href;
	}
}

function pathOnly(href: string): string {
	try {
		const u = new URL(
			href.startsWith('http') ? href : `https://nhvnovels.com${href.startsWith('/') ? '' : '/'}${href}`
		);
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		return href.startsWith('/') ? href.replace(/\/$/, '') : `/${href}`;
	}
}

function decodeEntities(s: string): string {
	return s
		.replace(/&#8217;/g, "'")
		.replace(/&#8216;/g, "'")
		.replace(/&#8220;/g, '"')
		.replace(/&#8221;/g, '"')
		.replace(/&#8211;/g, '–')
		.replace(/&#8230;/g, '…')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#039;/g, "'")
		.replace(/\s+/g, ' ')
		.trim();
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function parseChapterNumber(text: string, fallback: number): number {
	const m =
		text.match(/chapter\s*(\d+(?:\.\d+)?)/i) ||
		text.match(/\bch\.?\s*(\d+(?:\.\d+)?)/i) ||
		text.match(/(\d+(?:\.\d+)?)/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function extractOnclickHref(onclick: string | undefined): string {
	if (!onclick) return '';
	const m = onclick.match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
	return m?.[1] || '';
}

function isValidChapterPath(href: string | undefined): boolean {
	if (!href) return false;
	const h = href.trim();
	if (!h || h === '#' || h.startsWith('javascript')) return false;
	return /\/chapters\//i.test(h);
}

function largerCover(url: string): string {
	if (!url) return '';
	return url.replace(/-\d+x\d+(\.\w+)$/i, '$1');
}

export class NhvNovelsSource extends BaseSource {
	id = 'nhvnovels';
	name = 'NHV Novels';
	baseUrl = 'https://nhvnovels.com';

	/** JSON via fetchWithCf (Cloudflare-aware) — not named fetchJson to avoid BaseSource clash */
	private async fetchNhvJson<T>(path: string): Promise<T> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const text = await fetchWithCf(url, {
			headers: {
				...this.headers,
				Accept: 'application/json, text/plain, */*',
				Referer: `${this.baseUrl}/`
			}
		});
		return JSON.parse(text) as T;
	}

	/**
	 * Homepage Recently Updated section (+ page 2 from /novels/ if needed)
	 */
	async getLatestManga(page = 1): Promise<Manga[]> {
		const p = Math.max(1, page);
		if (p <= 1) {
			const fromHome = await this.parseRecentlyUpdatedHome().catch(() => [] as Manga[]);
			if (fromHome.length >= 12) {
				return fromHome.slice(0, PAGE_SIZE);
			}
			// top up from API / novels list
			const extra = await this.parseNovelsList(1).catch(() => [] as Manga[]);
			return this.dedupe([...fromHome, ...extra]).slice(0, PAGE_SIZE);
		}
		return this.parseNovelsList(p);
	}

	private dedupe(items: Manga[]): Manga[] {
		const seen = new Set<string>();
		const out: Manga[] = [];
		for (const m of items) {
			if (seen.has(m.id)) continue;
			seen.add(m.id);
			out.push(m);
		}
		return out;
	}

	private async parseRecentlyUpdatedHome(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		const $ = cheerio.load(html);
		const list: Manga[] = [];

		// Section: .rec-upd-card under Recently Updated
		$('.rec-upd-card').each((_, el) => {
			const a =
				$(el).find('a[href*="/novels/"]').first().length
					? $(el).find('a[href*="/novels/"]').first()
					: $(el).find('a').first();
			let href = a.attr('href') || '';
			// some cards put link only on Continue button
			if (!href || !/\/novels\//.test(href)) {
				href =
					$(el).find('a[href*="/novels/"]').last().attr('href') ||
					'';
			}
			if (!href || !/\/novels\//.test(href)) return;

			const title = decodeEntities(
				$(el).find('h1, h2, h3, .rec-upd-left-content h1').first().text() ||
					a.attr('title') ||
					''
			);
			if (!title || title.length < 2) return;

			const img =
				$(el).find('img').attr('data-src') ||
				$(el).find('img').attr('src') ||
				'';
			const infoText = $(el).find('.rec-upd-info, .rec-upd-left-content p, p').text();
			const chMatch = infoText.match(/(\d+)\s*Ch/i);
			const latestChapter = chMatch ? parseInt(chMatch[1], 10) : undefined;

			list.push({
				id: pathOnly(href),
				title,
				cover: largerCover(absUrl(this.baseUrl, img)),
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				...(latestChapter != null && !Number.isNaN(latestChapter)
					? { latestChapter }
					: {})
			});
		});

		if (list.length) return this.dedupe(list);

		// Fallback API
		try {
			const data = await this.fetchNhvJson<
				Array<{ title?: string; cover?: string; link?: string; tags?: string[] }>
			>('/wp-json/custom/v1/latest-novels');
			if (Array.isArray(data)) {
				for (const n of data) {
					if (!n.link || !n.title) continue;
					list.push({
						id: pathOnly(n.link),
						title: decodeEntities(n.title),
						cover: largerCover(n.cover || ''),
						sourceId: this.id,
						type: 'novel',
						lang: 'en'
					});
				}
			}
		} catch {
			/* ignore */
		}

		return this.dedupe(list);
	}

	private async parseNovelsList(page: number): Promise<Manga[]> {
		// /novels/ dumps many novels; we slice client-side by page
		const html = await this.fetchHtml('/novels/');
		const $ = cheerio.load(html);
		const all: Manga[] = [];
		const seen = new Set<string>();

		$('a[href*="/novels/"]').each((_, el) => {
			const href = $(el).attr('href') || '';
			if (!/\/novels\/[^/]+\/?$/.test(href.replace(this.baseUrl, ''))) return;
			if (/\/novels\/feed/.test(href)) return;
			const id = pathOnly(href);
			if (seen.has(id)) return;
			const title = decodeEntities(
				$(el).attr('title') || $(el).find('h1, h2, h3, h4').first().text() || $(el).text()
			);
			if (!title || title.length < 2) return;
			if (/^view all|read now|continue|novels$/i.test(title)) return;
			seen.add(id);
			const parent = $(el).closest('div, article, li, a');
			const cover =
				parent.find('img').attr('data-src') ||
				parent.find('img').attr('src') ||
				$(el).find('img').attr('src') ||
				'';
			all.push({
				id,
				title,
				cover: largerCover(absUrl(this.baseUrl, cover)),
				sourceId: this.id,
				type: 'novel',
				lang: 'en'
			});
		});

		const start = (Math.max(1, page) - 1) * PAGE_SIZE;
		return all.slice(start, start + PAGE_SIZE);
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = query.trim();
		if (!q) return [];
		const html = await this.fetchHtml(`/?s=${encodeURIComponent(q)}`);
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('a[href*="/novels/"]').each((_, el) => {
			const href = $(el).attr('href') || '';
			if (!/\/novels\/[^/]+\/?$/.test(href.replace(this.baseUrl, ''))) return;
			const id = pathOnly(href);
			if (seen.has(id)) return;
			const title = decodeEntities(
				$(el).attr('title') || $(el).find('h1, h2, h3').first().text() || $(el).text()
			);
			if (!title || title.length < 2) return;
			seen.add(id);
			const parent = $(el).closest('div, article, li');
			const cover =
				parent.find('img').attr('data-src') ||
				parent.find('img').attr('src') ||
				$(el).find('img').attr('src') ||
				'';
			list.push({
				id,
				title,
				cover: largerCover(absUrl(this.baseUrl, cover)),
				sourceId: this.id,
				type: 'novel',
				lang: 'en'
			});
		});

		const start = (Math.max(1, page) - 1) * PAGE_SIZE;
		return list.slice(start, start + PAGE_SIZE);
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		if (!path.includes('/novels/')) {
			path = `/novels${path.startsWith('/') ? path : `/${path}`}`;
		}
		const novelPath = path.endsWith('/') ? path : `${path}/`;
		const html = await this.fetchHtml(novelPath);
		const $ = cheerio.load(html);

		const title = decodeEntities(
			$('.novel-title, h1.novel-title, .novel-header h1, h1').first().text() ||
				$('meta[property="og:title"]').attr('content') ||
				$('title').text().split(/[|\-–]/)[0]
		);
		if (!title || title.length < 2) throw new Error('Novel not found');

		let cover =
			$('.novel-image img, .novel-header img').attr('data-src') ||
			$('.novel-image img, .novel-header img').attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = largerCover(cover);

		let description = '';
		const desc = $('.novel-description, .novel-description-wrapper').first();
		if (desc.length) {
			description = desc
				.find('p')
				.map((_, p) => $(p).text().trim())
				.get()
				.filter(Boolean)
				.join('\n\n');
			if (!description) description = desc.text().replace(/\s+/g, ' ').trim();
		}
		description = decodeEntities(description);

		const authors: string[] = [];
		$('.badge-author, a.badge-author, .badges a[href*="/author/"]').each((_, a) => {
			const t = decodeEntities($(a).text());
			if (t && !authors.includes(t)) authors.push(t);
		});

		const genres: string[] = [];
		$('.badge.genre, .badges a[href*="genre"], .badges .badge').each((_, el) => {
			const t = decodeEntities($(el).text());
			if (!t || t.length > 40) return;
			if (/ongoing|completed|views|★|release|translator|author/i.test(t)) return;
			if (!genres.includes(t)) genres.push(t);
		});

		let status = 'Ongoing';
		$('.badges .badge, .novel-details .badge').each((_, el) => {
			const t = $(el).text().trim();
			if (/ongoing|completed|hiatus|dropped/i.test(t)) {
				status = /complete/i.test(t) ? 'Completed' : /hiatus/i.test(t) ? 'Hiatus' : /drop/i.test(t) ? 'Dropped' : 'Ongoing';
			}
		});

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		$('.chapter-item, .chapters-container .chapter-item, a.chapter-title-link').each(
			(i, el) => {
				const $el = $(el);
				const isItem = $el.hasClass('chapter-item') || $el.is('div, li');
				const a = isItem
					? $el.find('a.chapter-title-link, a[href*="/chapters/"]').first()
					: $el;
				let href =
					$el.attr('data-url') ||
					a.attr('href') ||
					$el.find('a').first().attr('href') ||
					'';
				if (!href || !/\/chapters\//.test(href)) return;
				const id = pathOnly(href);
				if (seen.has(id)) return;
				seen.add(id);

				const rawTitle = decodeEntities(
					$el.find('.chapter-title, .chapter-number').first().text() ||
						a.text() ||
						$el.text()
				);
				const num =
					parseInt($el.attr('data-chapter-number') || '', 10) ||
					parseChapterNumber(rawTitle, i + 1);

				const dataType = ($el.attr('data-type') || '').toLowerCase();
				const locked =
					dataType === 'premium' ||
					dataType === 'paid' ||
					$el.find('.premium, .lock, .fa-lock').length > 0;

				const ch: Chapter = {
					id,
					title: `Chapter ${num}`,
					number: num
				};
				if (locked) ch.isLocked = true;
				chapters.push(ch);
			}
		);

		chapters.sort((a, b) => b.number - a.number);

		return {
			id: pathOnly(novelPath),
			title,
			cover: absUrl(this.baseUrl, cover),
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters,
			type: 'novel',
			lang: 'en'
		};
	}

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		const path = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const title = decodeEntities(
			$('.chapter-title, h1').first().text() ||
				$('title').text().split(/[|\-–]/)[0].trim() ||
				'Chapter'
		);

		const container = $('.chapter-text, .chapter-container .chapter-text').first();
		let contentHtml = '';

		if (container.length) {
			// Premium gate
			if (
				container.find('.mycred-sell-this-wrapper, .mycred-sell-entire-content').length ||
				/Premium Content/i.test(container.text())
			) {
				contentHtml =
					'<p><em>Chapter premium — login / gems required on NHV Novels.</em></p>';
			} else {
				const clone = container.clone();
				clone
					.find(
						'script, style, iframe, .ads, .ad, .mycred-sell-this-wrapper, noscript'
					)
					.remove();
				const paras = clone.find('p');
				if (paras.length) {
					const parts: string[] = [];
					paras.each((_, p) => {
						const t = $(p).text().trim();
						if (!t) return;
						if (/nhvnovels|premium content|login to access/i.test(t)) return;
						parts.push(`<p>${escapeHtml(t)}</p>`);
					});
					contentHtml = parts.join('\n');
				}
				if (!contentHtml) contentHtml = clone.html()?.trim() || '';
			}
		}

		if (!contentHtml || contentHtml.length < 40) {
			contentHtml =
				contentHtml ||
				'<p><em>Konten kosong atau chapter terkunci.</em></p>';
		}

		// Prev / next from chapter-nav buttons
		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		$('.chapter-nav button[onclick], .chapter-nav a').each((_, el) => {
			const label = (($(el).attr('aria-label') || $(el).text()) + '').toLowerCase();
			const href =
				extractOnclickHref($(el).attr('onclick')) || $(el).attr('href') || '';
			if (!isValidChapterPath(href)) return;
			const id = pathOnly(href);
			if (/prev/i.test(label) && !prevChapterId) prevChapterId = id;
			if (/next/i.test(label) && !nextChapterId) nextChapterId = id;
		});

		return {
			title,
			content: contentHtml,
			prevChapterId,
			nextChapterId
		};
	}
}

export default NhvNovelsSource;
