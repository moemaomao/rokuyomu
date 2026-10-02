/**
 * Curspe — https://curspe.com/
 * Novel translations (WordPress custom theme)
 *
 * List   : /novels/  |  /novels/?pg={n}     → article.jarc-card (24/page)
 * Search : /?s=QUERY                        → dedupe link /novels/{slug}/
 * Detail : /novels/{slug}/
 * Chapter: /novels/{slug}/chapter-…/  (also prologue-…)
 * Content: .chapter-content / .prose
 * Nav    : a.jrb-nav-link / "Previous Chapter" / "Next Chapter"
 *
 * ID format:
 *   novel   : /novels/{slug}
 *   chapter : /novels/{slug}/{chapter-slug}
 *
 * Bahasa default: English
 *
 * Path target:
 *   scraper/src/sources/impl/novel/Curspe.ts
 */

import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../../types';

const BASE = 'https://curspe.com';
const PER_PAGE = 24;

function absUrl(href: string | undefined): string {
	if (!href) return '';
	if (href.startsWith('//')) return `https:${href}`;
	if (href.startsWith('http')) return href;
	try {
		return new URL(href, BASE).href;
	} catch {
		return href;
	}
}

function pathOnly(href: string): string {
	try {
		const u = new URL(href.startsWith('http') ? href : absUrl(href));
		return u.pathname.replace(/\/+$/, '') || '/';
	} catch {
		return href.startsWith('/') ? href.replace(/\/+$/, '') || '/' : `/${href}`;
	}
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function parseChapterNumber(text: string, path = '', fallback = 0): number {
	const fromPath =
		path.match(/\/chapter-(\d+)(?:[.-](\d+))?/i) ||
		path.match(/\/ch-?(\d+)(?:[.-](\d+))?/i) ||
		path.match(/-chapter-(\d+)(?:[.-](\d+))?/i);
	if (fromPath) {
		const major = parseInt(fromPath[1], 10);
		if (fromPath[2] != null) return parseFloat(`${major}.${fromPath[2]}`);
		return major;
	}

	const m =
		String(text).match(/(?:chapter|ch\.?)\s*(\d+)(?:[.,](\d+))?/i) ||
		String(text).match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		if (m[2] != null) return parseFloat(`${m[1]}.${m[2]}`);
		return parseFloat(m[1]);
	}

	if (/prologue/i.test(path + text)) return 0;
	if (/epilogue/i.test(path + text)) return 99999;
	return fallback;
}

function isNovelSeriesPath(path: string): boolean {
	return /^\/novels\/[^/]+$/i.test(path);
}

function isChapterPath(path: string): boolean {
	return (
		/^\/novels\/[^/]+\/.+/i.test(path) &&
		(/chapter|prologue|epilogue|extra|side/i.test(path) || path.split('/').length >= 4)
	);
}

export class CurspeSource extends BaseSource {
	id = 'curspe';
	name = 'Curspe';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
		Accept:
			'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9'
	};

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		const p = Math.max(1, Number(page) || 1);
		const path = p <= 1 ? '/novels/' : `/novels/?pg=${p}`;

		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list = this.parseArchiveCards($);
			console.log(`[curspe] latest page=${p} → ${list.length}`);
			return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[curspe] getLatestManga', e);
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
			const list: Manga[] = [];
			const seen = new Set<string>();

			$('a[href*="/novels/"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const id = pathOnly(href);
				if (!isNovelSeriesPath(id) || seen.has(id)) return;

				let title = ($(a).attr('title') || $(a).text() || '')
					.replace(/\s+/g, ' ')
					.trim();
				if (!title || title.length < 2) return;
				if (/^(from|home|novels?)$/i.test(title)) return;
				if (/^chapter\s+\d+/i.test(title)) {
					return;
				}

				seen.add(id);
				list.push({
					id,
					sourceId: this.id,
					title,
					cover: '',
					type: 'novel',
					status: 'Ongoing',
					lang: 'en'
				});
			});

			if (list.length) {
				$('article').each((_, art) => {
					const $art = $(art);
					const seriesA = $art
						.find('a[href*="/novels/"]')
						.filter((__, el) => isNovelSeriesPath(pathOnly($(el).attr('href') || '')))
						.first();
					if (!seriesA.length) return;
					const id = pathOnly(seriesA.attr('href') || '');
					const item = list.find((m) => m.id === id);
					if (!item || item.cover) return;
					const img =
						$art.find('img').attr('data-src') ||
						$art.find('img').attr('src') ||
						'';
					if (img && !/logo|icon|emoji/i.test(img)) {
						item.cover = absUrl(img.split('?')[0]);
					}
				});
			}

			console.log(`[curspe] search "${q}" page=${page} → ${list.length}`);
			return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[curspe] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = pathOnly(mangaId);

		if (isChapterPath(path)) {
			const m = path.match(/^(\/novels\/[^/]+)/i);
			if (m) path = m[1];
		}
		if (!path.startsWith('/novels/')) {
			path = `/novels/${path.replace(/^\//, '')}`;
		}
		path = path.replace(/\/+$/, '');

		const html = await this.fetchHtml(path + '/');
		const $ = cheerio.load(html);

		let title =
			$('h1.wn-title').first().text().replace(/\s+/g, ' ').trim() ||
			$('.wn-breadcrumb .current').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content') ||
			$('title').text().split(/[-–—|]/)[0] ||
			path;
		title = title.replace(/\s+/g, ' ').trim();

		let cover =
			$('img.attachment-novel-cover-single').attr('src') ||
			$('.wn-cover img').attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			$('img.wp-post-image').attr('src') ||
			'';
		cover = absUrl((cover || '').split('?')[0]);

		let description =
			$('.wn-synopsis').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:description"]').attr('content') ||
			$('meta[name="description"]').attr('content') ||
			'';

		const authors: string[] = [];
		const artists: string[] = [];
		const altTitles: string[] = [];
		let status = 'Ongoing';
		let origin = '';
		let published = '';
		let schedule = '';

		$('.wn-meta-row').each((_, el) => {
			const label = $(el).find('.wn-meta-label').text().replace(/\s+/g, ' ').trim().toLowerCase();
			const val = $(el)
				.find('.wn-meta-value')
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			if (!label && !val) return;

			if (/author|writer|pengarang/i.test(label)) {
				val.split(/,|\//).forEach((a) => {
					const n = a.trim();
					if (n && n.length < 80 && !authors.includes(n)) authors.push(n);
				});
			} else if (/artist|illustrator/i.test(label)) {
				val.split(/,|\//).forEach((a) => {
					const n = a.trim();
					if (n && n.length < 80 && !artists.includes(n)) artists.push(n);
				});
			} else if (/alt|alternative|other\s*name/i.test(label)) {
				val.split(/,|;|\//).forEach((a) => {
					const n = a.trim();
					if (n && n.length < 120 && !altTitles.includes(n)) altTitles.push(n);
				});
			} else if (/status/i.test(label)) {
				if (/complete|completed|tamat|end|finish/i.test(val)) status = 'Completed';
				else if (/hiatus/i.test(val)) status = 'Hiatus';
				else if (/ongoing|active/i.test(val)) status = 'Ongoing';
				else if (val) status = val;
			} else if (/origin|country|language|raw/i.test(label)) {
				origin = val;
			} else if (/publish|release|year/i.test(label)) {
				published = val;
			} else if (/schedule|update/i.test(label)) {
				schedule = val;
			}
		});

		if (status === 'Ongoing') {
			const tagStatus = $('.jarc-tag-status, .wn-status, .jshow-hero-status')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			if (/complete/i.test(tagStatus)) status = 'Completed';
			else if (/hiatus/i.test(tagStatus)) status = 'Hiatus';
		}

		const genres: string[] = [];
		$('a.wn-genre, .wn-genre a, a[href*="/genre/"]').each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (g && g.length < 40 && !/^genre$/i.test(g) && !genres.includes(g)) {
				genres.push(g);
			}
		});

		const metaBits: string[] = [];
		if (altTitles.length) metaBits.push(`Also known as: ${altTitles.join(' · ')}`);
		if (origin) metaBits.push(`Origin: ${origin}`);
		if (published) metaBits.push(`Published: ${published}`);
		if (schedule) metaBits.push(`Schedule: ${schedule}`);
		if (artists.length) metaBits.push(`Artist: ${artists.join(', ')}`);
		if (metaBits.length) {
			description = description
				? `${metaBits.join('\n')}\n\n${description}`
				: metaBits.join('\n');
		}

		const chapters = this.parseChapterList($);
		chapters.sort((a, b) => a.number - b.number);

		const details: MangaDetails & {
			artists?: string[];
			altTitles?: string[];
			published?: string;
			origin?: string;
		} = {
			id: path,
			sourceId: this.id,
			title,
			cover,
			description,
			authors,
			genres,
			status,
			type: 'novel',
			lang: 'en',
			chapters,
			latestChapter: chapters.length ? chapters[chapters.length - 1].number : undefined
		};

		if (artists.length) details.artists = artists;
		if (altTitles.length) details.altTitles = altTitles;
		if (published) details.published = published;
		if (origin) details.origin = origin;

		return details;
	}

	// ── Chapter content ──────────────────────────────────────────────────────

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		const path = pathOnly(chapterId.startsWith('/') ? chapterId : `/${chapterId}`);
		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const rawTitle =
			$('.chapter-content h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('title').text().split(/[-–—|]/)[0].trim() ||
			'Chapter';

		const number = parseChapterNumber(rawTitle, path, 0);
		const title =
			number > 0
				? `Chapter ${Number.isInteger(number) ? number : number}`
				: /prologue/i.test(rawTitle + path)
					? 'Prologue'
					: /epilogue/i.test(rawTitle + path)
						? 'Epilogue'
						: rawTitle.replace(/\s*[-–—]\s*.+$/, '').trim() || rawTitle;

		const container =
			$('.chapter-content').first().length > 0
				? $('.chapter-content').first()
				: $('.prose').first().length > 0
					? $('.prose').first()
					: $('.entry-content').first();

		const parts: string[] = [];
		if (container.length) {
			const clone = container.clone();
			clone
				.find(
					'script, style, iframe, nav, .ads, .ad, .jrb-nav, .chapter-nav, .comments, button, form'
				)
				.remove();

			clone.find('h1, h2').first().remove();

			clone.find('p').each((_, p) => {
				const t = $(p).text().replace(/\s+/g, ' ').trim();
				if (!t) return;
				if (/curspe\.com|login required|buy full novel|cloudflare/i.test(t)) return;
				parts.push(`<p>${escapeHtml(t)}</p>`);
			});

			if (parts.length < 2) {
				const inner = clone.html()?.trim() || '';
				if (inner.length > 80) {
					parts.length = 0;
					parts.push(inner);
				}
			}
		}

		let prevHref =
			$('a.jrb-nav-link')
				.filter((_, el) => /prev/i.test($(el).text()))
				.first()
				.attr('href') ||
			$('a.btn-secondary')
				.filter((_, el) => /previous/i.test($(el).text()))
				.first()
				.attr('href') ||
			$('a')
				.filter((_, el) => /^previous\s*chapter$/i.test($(el).text().trim()))
				.first()
				.attr('href') ||
			'';

		let nextHref =
			$('a.jrb-nav-link')
				.filter((_, el) => /next/i.test($(el).text()))
				.first()
				.attr('href') ||
			$('a.btn-primary')
				.filter((_, el) => /next/i.test($(el).text()))
				.first()
				.attr('href') ||
			$('a')
				.filter((_, el) => /^next\s*chapter$/i.test($(el).text().trim()))
				.first()
				.attr('href') ||
			'';

		const seriesPrefix = path.match(/^(\/novels\/[^/]+)/i)?.[1] || '';
		const sanitizeNav = (href: string): string | null => {
			if (!href) return null;
			const id = pathOnly(href);
			if (seriesPrefix && !id.startsWith(seriesPrefix)) return null;
			if (!isChapterPath(id) && !/\/novels\/[^/]+\/(prologue|epilogue)/i.test(id)) {
				if (!/^\/novels\/[^/]+\//i.test(id)) return null;
			}
			return id;
		};

		return {
			title,
			content:
				parts.join('\n') ||
				'<p><em>Content empty — chapter may be locked or selector changed.</em></p>',
			prevChapterId: sanitizeNav(prevHref),
			nextChapterId: sanitizeNav(nextHref)
		};
	}

	// ── Parsers ──────────────────────────────────────────────────────────────

	private parseArchiveCards($: cheerio.CheerioAPI): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		$('article.jarc-card, .jarc-card').each((_, el) => {
			const $el = $(el);
			const a =
				$el.find('a.jarc-name[href*="/novels/"]').first().length > 0
					? $el.find('a.jarc-name[href*="/novels/"]').first()
					: $el.find('a.jarc-cover[href*="/novels/"]').first().length > 0
						? $el.find('a.jarc-cover[href*="/novels/"]').first()
						: $el.find('a[href*="/novels/"]').first();

			const href = a.attr('href') || '';
			const id = pathOnly(href);
			if (!isNovelSeriesPath(id) || seen.has(id)) return;
			seen.add(id);

			const title = (a.text() || a.attr('aria-label') || a.attr('title') || '')
				.replace(/\s+/g, ' ')
				.trim();
			if (!title) return;

			let cover =
				$el.find('.jarc-cover img').attr('src') ||
				$el.find('img').attr('data-src') ||
				$el.find('img').attr('src') ||
				'';
			cover = absUrl((cover || '').split('?')[0]);

			let status = 'Ongoing';
			const statusTag = $el.find('.jarc-tag-status').text().replace(/\s+/g, ' ').trim();
			if (/complete/i.test(statusTag)) status = 'Completed';
			else if (/hiatus/i.test(statusTag)) status = 'Hiatus';

			let latestChapter: number | undefined;
			$el.find('.jarc-tag').each((__, tag) => {
				const t = $(tag).text();
				const m = t.match(/(\d+)\s*chapters?/i);
				if (m) latestChapter = parseInt(m[1], 10);
			});

			out.push({
				id,
				sourceId: this.id,
				title,
				cover,
				type: 'novel',
				status,
				latestChapter,
				lang: 'en'
			});
		});

		return out;
	}

	private parseChapterList($: cheerio.CheerioAPI): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		$('a.wn-chapter-item, .wn-chapter-item').each((i, el) => {
			const $a = $(el).is('a') ? $(el) : $(el).find('a').first();
			const href = $a.attr('href') || $(el).attr('href') || '';
			if (!href) return;

			const id = pathOnly(href);
			if (seen.has(id)) return;
			if (!/^\/novels\/[^/]+\//i.test(id)) return;
			seen.add(id);

			const rawTitle =
				$(el).attr('data-title') ||
				$(el).find('.wn-chapter-title').text() ||
				$a.attr('title') ||
				$a.text() ||
				'';
			const cleanRaw = rawTitle.replace(/\s+/g, ' ').trim();
			const number = parseChapterNumber(cleanRaw, id, i + 1);

			let title: string;
			if (/prologue/i.test(cleanRaw + id) && number === 0) {
				title = 'Prologue';
			} else if (/epilogue/i.test(cleanRaw + id)) {
				title = 'Epilogue';
			} else if (number > 0) {
				title = `Chapter ${Number.isInteger(number) ? number : number}`;
			} else {
				title = cleanRaw.replace(/\s*[-–—]\s*.+$/, '').trim() || `Chapter ${i + 1}`;
			}

			const date =
				$(el)
					.find('.wn-chapter-meta span')
					.first()
					.text()
					.replace(/\s+/g, ' ')
					.trim() || '';

			const locked =
				$(el).attr('data-locked') === '1' ||
				$(el).hasClass('locked') ||
				$(el).find('.wn-chapter-lock').length > 0;

			const ch: Chapter & { isLocked?: boolean } = {
				id,
				title,
				number,
				date
			};
			if (locked) ch.isLocked = true;
			out.push(ch);
		});

		if (!out.length) {
			$('a[href*="/novels/"][href*="chapter"]').each((i, a) => {
				const href = $(a).attr('href') || '';
				const id = pathOnly(href);
				if (seen.has(id) || !isChapterPath(id)) return;
				seen.add(id);
				const raw = ($(a).text() || '').replace(/\s+/g, ' ').trim();
				const number = parseChapterNumber(raw, id, i + 1);
				out.push({
					id,
					title: number > 0 ? `Chapter ${number}` : raw || `Chapter ${i + 1}`,
					number,
					date: ''
				});
			});
		}

		return out;
	}
}

export default CurspeSource;
