/**
 * CrimsonScrolls (crimsonscrolls.net) — custom WP novel site
 * Path: scraper/src/sources/impl/novel/CrimsonScrolls.ts
 *
 * - Homepage: section "Recently Updated" (priority)
 * - List fill: /novels/recently-updated/ + /novels/
 * - Novel: /novel/{slug}/
 * - Chapter: /novel/{slug}/chapter-{n}/ or /chapter-{n}-{title-slug}/
 * - Locked: Tier 1–4 / “locked” / no free badge → isLocked
 * - Search: /?s=query  or /novels/?s=
 * - Chapter title: "Chapter N" (bersih)
 * - Prev/Next: adjacent chapter path + page links
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://crimsonscrolls.net';
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
		const u = new URL(
			href.startsWith('http')
				? href
				: `${BASE}${href.startsWith('/') ? '' : '/'}${href}`
		);
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		return href.startsWith('/') ? href.replace(/\/$/, '') || '/' : `/${href}`;
	}
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function cleanText(s: string): string {
	return (s || '')
		.replace(/&#8217;/g, "'")
		.replace(/&#8216;/g, "'")
		.replace(/&#8220;/g, '"')
		.replace(/&#8221;/g, '"')
		.replace(/&#8230;/g, '…')
		.replace(/&amp;/g, '&')
		.replace(/&nbsp;/g, ' ')
		.replace(/<[^>]+>/g, '')
		.replace(/\u00a0/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function parseChapterNumber(text: string, fallback = 0): number {
	const t = (text || '').replace(/\s+/g, ' ').trim();
	if (/prologue/i.test(t) && !/\d/.test(t)) return 0;
	const m =
		t.match(/(?:chapter|ch\.?|c)\s*[.\-:]?\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\/chapter-(\d+(?:\.\d+)?)(?:[/-]|$)/i) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function shortChapterTitle(number: number, raw?: string): string {
	if (number > 0) return `Chapter ${number}`;
	if (/prologue/i.test(raw || '')) return 'Prologue';
	const n = parseChapterNumber(raw || '', 0);
	return n > 0 ? `Chapter ${n}` : 'Chapter';
}

function novelIdFromHref(href: string): string | null {
	const p = pathOnly(href);
	const m = p.match(/^\/novel\/([a-z0-9-]+)(?:\/|$)/i);
	if (!m) return null;
	return `/novel/${m[1]}`;
}

function adjacentChapterPaths(path: string): {
	prev: string | null;
	next: string | null;
} {
	const p = path.replace(/\/$/, '');
	// /novel/slug/chapter-176-one-kick  →  chapter-175 / chapter-177
	const m = p.match(/^(.*\/chapter-)(\d+)(?:-.*)?$/i);
	if (m) {
		const n = parseInt(m[2], 10);
		return {
			prev: n > 1 ? `${m[1]}${n - 1}` : null,
			next: `${m[1]}${n + 1}`
		};
	}
	return { prev: null, next: null };
}

export class CrimsonScrollsSource extends BaseSource {
	id = 'crimsonscrolls';
	name = 'CrimsonScrolls';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept:
			'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		try {
			return await fetchWithCf(url, {
				headers: { ...this.headers, Referer: this.baseUrl }
			});
		} catch (e) {
			console.warn(
				'[crimsonscrolls] fetchWithCf fail, plain',
				String(e).slice(0, 80)
			);
			const res = await fetch(url, { headers: this.headers });
			if (!res.ok) {
				const t = await res.text().catch(() => '');
				throw new Error(`fetchHtml ${res.status}: ${t.slice(0, 100)}`);
			}
			return await res.text();
		}
	}

	// ─── Latest (Recently Updated) ───────────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		const p = Math.max(1, page);
		try {
			if (p === 1) {
				const seen = new Set<string>();
				const list: Manga[] = [];

				// 1) Homepage "Recently Updated" section (priority)
				try {
					const home = await this.fetchHtml('/');
					for (const m of this.parseRecentlyUpdatedSection(home)) {
						if (seen.has(m.id)) continue;
						seen.add(m.id);
						list.push(m);
						if (list.length >= PER_PAGE) break;
					}
				} catch (e) {
					console.warn(
						'[crimsonscrolls] homepage RU fail',
						String(e).slice(0, 80)
					);
				}

				// 2) /novels/recently-updated/
				if (list.length < PER_PAGE) {
					try {
						const html = await this.fetchHtml(
							'/novels/recently-updated/'
						);
						for (const m of this.parseNovelCards(html)) {
							if (seen.has(m.id)) continue;
							seen.add(m.id);
							list.push(m);
							if (list.length >= PER_PAGE) break;
						}
					} catch (e) {
						console.warn(
							'[crimsonscrolls] RU page fail',
							String(e).slice(0, 80)
						);
					}
				}

				// 3) /novels/ fill
				if (list.length < PER_PAGE) {
					try {
						const html = await this.fetchHtml('/novels/');
						for (const m of this.parseNovelCards(html)) {
							if (seen.has(m.id)) continue;
							seen.add(m.id);
							list.push(m);
							if (list.length >= PER_PAGE) break;
						}
					} catch {
						/* ignore */
					}
				}

				console.log(`[crimsonscrolls] latest page=1 n=${list.length}`);
				return list.slice(0, PER_PAGE);
			}

			// page 2+: novels list (site has ~40 titles, simple offset)
			const html = await this.fetchHtml('/novels/');
			const all = this.parseNovelCards(html);
			const slice = all.slice((p - 1) * PER_PAGE, p * PER_PAGE);
			console.log(`[crimsonscrolls] latest page=${p} n=${slice.length}`);
			return slice;
		} catch (e) {
			console.error('[crimsonscrolls] latest', e);
			return [];
		}
	}

	/** Parse homepage block under heading "Recently Updated" */
	private parseRecentlyUpdatedSection(html: string): Manga[] {
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		// Find heading then walk following siblings / container
		let sectionRoot: cheerio.Cheerio<any> | null = null;
		$('h1, h2, h3, .heading, .section-title').each((_, el) => {
			const t = cleanText($(el).text());
			if (/recently\s*updated/i.test(t)) {
				sectionRoot = $(el).parent();
				// prefer larger container
				const grand = $(el).closest('section, .cs-section, .container, main, .content');
				if (grand.length) sectionRoot = grand;
			}
		});

		const scope = sectionRoot && sectionRoot.length ? sectionRoot : $.root();

		scope.find('a[href*="/novel/"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const id = novelIdFromHref(href);
			if (!id || seen.has(id)) return;
			// skip pure chapter links as primary card
			if (/\/chapter-/i.test(pathOnly(href))) return;

			const root = $(a).closest('article, .card, .item, .cs-card, li, div');
			const title =
				cleanText(
					root.find('h2, h3, h4, .title, .novel-title').first().text()
				) ||
				cleanText($(a).attr('title') || '') ||
				cleanText($(a).find('img').attr('alt') || '') ||
				cleanText($(a).text());

			if (!title || title.length < 3) return;
			if (/^(free|new|browse more|start reading)$/i.test(title)) return;

			const img = root.find('img').first().length
				? root.find('img').first()
				: $(a).find('img').first();
			const cover =
				img.attr('data-src') ||
				img.attr('data-lazy-src') ||
				img.attr('src') ||
				'';

			let latest = 0;
			root.find('a[href*="/chapter-"]').each((_, ca) => {
				const n = parseChapterNumber(
					$(ca).text() + ' ' + ($(ca).attr('href') || ''),
					0
				);
				if (n > latest) latest = n;
			});
			// also text near card
			const nearby = cleanText(root.text());
			const n2 = parseChapterNumber(nearby, 0);
			if (n2 > latest) latest = n2;

			seen.add(id);
			list.push({
				id,
				title: title.slice(0, 200),
				cover: cover ? absUrl(cover.split('?')[0]) : '',
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: /completed/i.test(nearby) ? 'Completed' : 'Ongoing',
				...(latest > 0 ? { latestChapter: Math.floor(latest) } : {})
			});
		});

		return list;
	}

	private parseNovelCards(html: string): Manga[] {
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		const push = (
			id: string,
			title: string,
			cover: string,
			latest?: number,
			status?: string
		) => {
			if (seen.has(id) || !title || title.length < 3) return;
			if (!/^\/novel\/[a-z0-9-]+$/i.test(id)) return;
			seen.add(id);
			list.push({
				id,
				title: title.slice(0, 200),
				cover: cover ? absUrl(cover.split('?')[0]) : '',
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: status || 'Ongoing',
				...(latest != null && latest > 0
					? { latestChapter: Math.floor(latest) }
					: {})
			});
		};

		// Cards: article / .cs-* / list items linking to /novel/slug/
		$('article, .cs-card, .novel-card, .card, li, .item').each((_, el) => {
			const root = $(el);
			const a = root
				.find('a[href*="/novel/"]')
				.filter((_, x) => {
					const p = pathOnly($(x).attr('href') || '');
					return /^\/novel\/[a-z0-9-]+$/i.test(p);
				})
				.first();
			if (!a.length) return;
			const href = a.attr('href') || '';
			const id = novelIdFromHref(href);
			if (!id) return;

			const title =
				cleanText(
					root.find('h2, h3, h4, .title, .novel-title').first().text()
				) ||
				cleanText(a.attr('title') || '') ||
				cleanText(a.find('img').attr('alt') || '') ||
				cleanText(a.text());

			const img = root.find('img').first();
			const cover =
				img.attr('data-src') ||
				img.attr('data-lazy-src') ||
				img.attr('src') ||
				'';

			const body = cleanText(root.text());
			let latest = 0;
			const chMatch = body.match(/(\d+)\s*chapters?/i);
			if (chMatch) latest = parseInt(chMatch[1], 10) || 0;
			root.find('a[href*="/chapter-"]').each((_, ca) => {
				const n = parseChapterNumber(
					$(ca).text() + ' ' + ($(ca).attr('href') || ''),
					0
				);
				if (n > latest) latest = n;
			});

			let status = 'Ongoing';
			if (/completed/i.test(body)) status = 'Completed';
			else if (/hiatus/i.test(body)) status = 'Hiatus';

			push(id, title, cover, latest || undefined, status);
		});

		// Fallback: all pure novel links
		if (list.length < 5) {
			$('a[href*="/novel/"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const id = novelIdFromHref(href);
				if (!id) return;
				if (/\/chapter-/i.test(pathOnly(href))) return;
				const title =
					cleanText($(a).attr('title') || '') ||
					cleanText($(a).find('img').attr('alt') || '') ||
					cleanText($(a).text());
				if (!title || title.length < 3) return;
				if (/^(start reading|browse|free|new)$/i.test(title)) return;
				const cover =
					$(a).find('img').attr('data-src') ||
					$(a).find('img').attr('src') ||
					'';
				push(id, title, cover);
			});
		}

		return list;
	}

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(
		query: string,
		opts?: { page?: number }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page ?? 1);
		if (!q) return this.getLatestManga(page);

		try {
			const path =
				page <= 1
					? `/?s=${encodeURIComponent(q)}`
					: `/page/${page}/?s=${encodeURIComponent(q)}`;
			const html = await this.fetchHtml(path);
			let list = this.parseNovelCards(html);

			// fallback: filter full library
			if (list.length < 1) {
				const allHtml = await this.fetchHtml('/novels/');
				const all = this.parseNovelCards(allHtml);
				const ql = q.toLowerCase();
				list = all.filter((m) => m.title.toLowerCase().includes(ql));
			}

			console.log(
				`[crimsonscrolls] search "${q}" page=${page} n=${list.length}`
			);
			return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[crimsonscrolls] search', e);
			return [];
		}
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = pathOnly(mangaId);
		const chStrip = path.match(/^(\/novel\/[a-z0-9-]+)\/chapter-/i);
		if (chStrip) path = chStrip[1];
		if (!path.startsWith('/novel/')) {
			path = `/novel/${path.replace(/^\//, '')}`;
		}
		const seriesPath = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(seriesPath);
		const $ = cheerio.load(html);

		let title =
			cleanText($('h1').first().text()) ||
			cleanText(
				$('meta[property="og:title"]')
					.attr('content')
					?.split(/\s*[|\-–]\s*/)[0] || ''
			) ||
			path.split('/').pop()?.replace(/-/g, ' ') ||
			'';
		title = title.replace(/\s*Novel\s*$/i, '').trim();

		let cover =
			$('img[alt*="cover" i], .novel-cover img, .cover img, article img')
				.first()
				.attr('data-src') ||
			$('img[alt*="cover" i], .novel-cover img, .cover img, article img')
				.first()
				.attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		// prefer larger cover from page
		$('img').each((_, img) => {
			const src = $(img).attr('data-src') || $(img).attr('src') || '';
			const alt = ($(img).attr('alt') || '').toLowerCase();
			if (
				src &&
				(alt.includes('cover') || /\/uploads\//.test(src)) &&
				!/logo|icon|avatar|banner/i.test(src + alt)
			) {
				if (!cover || cover.includes('200x300') || cover.includes('225x300')) {
					cover = src;
				}
			}
		});
		cover = absUrl((cover || '').split('?')[0]);

		const genres: string[] = [];
		$('a[href*="/genre/"], a[href*="/novels/genre/"]').each((_, a) => {
			const g = cleanText($(a).text());
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		let status = 'Ongoing';
		const bodyText = cleanText($('body').text());
		if (/\bcompleted\b/i.test(bodyText.slice(0, 2000))) status = 'Completed';
		else if (/\bhiatus\b/i.test(bodyText.slice(0, 2000))) status = 'Hiatus';

		// synopsis
		let description = '';
		$('h2, h3, .heading').each((_, el) => {
			if (/synopsis|summary|description/i.test(cleanText($(el).text()))) {
				const parts: string[] = [];
				let sib = $(el).next();
				for (let i = 0; i < 15 && sib.length; i++) {
					const tag = (sib.prop('tagName') || '').toLowerCase();
					if (['h1', 'h2', 'h3'].includes(tag)) break;
					const t = cleanText(sib.text());
					if (t) parts.push(t);
					sib = sib.next();
				}
				if (parts.length) description = parts.join('\n\n');
			}
		});
		if (!description) {
			description =
				cleanText($('meta[property="og:description"]').attr('content') || '') ||
				cleanText($('.synopsis, .summary, .description').first().text());
		}
		if (description.length > 4000)
			description = description.slice(0, 4000) + '…';

		const authors: string[] = [];
		// site rarely shows author; leave empty if not found
		$('a[href*="/author/"], .author a').each((_, a) => {
			const n = cleanText($(a).text());
			if (n && !authors.includes(n)) authors.push(n);
		});

		const chapters = this.parseChapterList($, path.replace(/\/$/, ''));

		console.log(
			`[crimsonscrolls] details ${path} → ${chapters.length} ch (${chapters.filter((c) => c.isLocked).length} locked)`
		);

		return {
			id: path.replace(/\/$/, ''),
			title,
			cover,
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters,
			type: 'novel',
			lang: 'en',
			...(chapters.length ? { latestChapter: chapters[0]?.number } : {})
		};
	}

	private parseChapterList(
		$: cheerio.CheerioAPI,
		seriesId: string
	): Chapter[] {
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('a[href*="/chapter-"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const p = pathOnly(href);
			if (!p.includes(seriesId.replace(/^\//, '')) && !p.startsWith(seriesId)) {
				// must belong to this novel
				if (!p.startsWith(seriesId)) return;
			}
			if (!/\/chapter-/i.test(p)) return;

			const raw = cleanText($(a).text());
			const number = parseChapterNumber(raw + ' ' + p, 0);
			if (number <= 0 && !/prologue/i.test(raw)) return;

			const id = p; // keep full path incl. title slug
			if (seen.has(id)) return;
			seen.add(id);

			const parentText = cleanText($(a).parent().text());
			const rowText = raw + ' ' + parentText;
			const isLocked =
				/\btier\s*[1-4]\b/i.test(rowText) ||
				(/\blocked\b/i.test(rowText) && !/\bfree\b/i.test(rowText)) ||
				($(a).find('.fa-lock, .lock').length > 0 &&
					!/\bfree\b/i.test(rowText));

			// date: e.g. April 26, 2026
			const dateMatch = rowText.match(
				/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/i
			);

			chapters.push({
				id,
				title: shortChapterTitle(number, raw),
				number,
				date: dateMatch ? dateMatch[0] : undefined,
				...(isLocked ? { isLocked: true } : {})
			});
		});

		chapters.sort((a, b) => b.number - a.number);
		return chapters;
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
		let path = pathOnly(chapterId);
		if (!path.startsWith('/novel/')) {
			path = `/novel/${path.replace(/^\//, '')}`;
		}
		const fetchPath = path.endsWith('/') ? path : `${path}/`;

		const adj = adjacentChapterPaths(path.replace(/\/$/, ''));
		let prevChapterId: string | null = adj.prev;
		let nextChapterId: string | null = adj.next;

		const html = await this.fetchHtml(fetchPath);
		const $ = cheerio.load(html);

		const bodyLower = $('body').text().toLowerCase();
		if (
			/tier\s*[1-4]\s*required|unlock the next chapter|you need a tier|purchase a tier|chapter is locked/i.test(
				bodyLower
			) &&
			$('article p, .entry-content p, .chapter-content p, .cs-chapter p').length < 3
		) {
			throw new Error('Chapter is locked / tier-gated on CrimsonScrolls');
		}

		const rawTitle =
			cleanText($('h1').first().text()) ||
			cleanText(
				$('meta[property="og:title"]')
					.attr('content')
					?.split(/\s*[|\-–]\s*/)[0] || ''
			);
		const number = parseChapterNumber(path + ' ' + rawTitle, 0);
		const title = shortChapterTitle(number > 0 ? number : 0, rawTitle);

		// Content selectors (custom theme)
		const contentEl = $(
			'article .entry-content, .chapter-content, .cs-chapter-content, .reading-content, article, main'
		).first();

		contentEl
			.find(
				'script, style, noscript, iframe, nav, form, .comments, #comments, .sharedaddy, .ads, .ad, .cs-nav, header, footer, .cs-footer'
			)
			.remove();

		const parts: string[] = [];
		const pushP = (t: string) => {
			if (!t || t.length < 2) return;
			if (
				/^(support|patreon|discord|prev|next|advertisement|buy tier|tier \d|read this on|chapter discussion|reading settings)/i.test(
					t
				)
			)
				return;
			if (/crimsonscrolls\.net/i.test(t) && t.length < 80) return;
			parts.push(`<p>${escapeHtml(t)}</p>`);
		};

		contentEl.find('p').each((_, p) => {
			pushP(cleanText($(p).text()));
		});

		// fallback: split by br / text nodes if few paragraphs
		if (parts.length < 3) {
			const raw = cleanText(contentEl.text());
			raw.split(/\n+/).forEach((line) => pushP(line.trim()));
		}

		const content =
			parts.length > 0
				? parts.join('\n')
				: '<p><em>Empty content — locked or selector changed.</em></p>';

		// Nav links
		$('a').each((_, a) => {
			const t = cleanText($(a).text()).toLowerCase();
			const href = $(a).attr('href') || '';
			const full = pathOnly(href);
			if (!/\/chapter-/i.test(full)) return;
			if (/^prev(ious)?(\s|$)/i.test(t) || t === '←' || /prev_page|prev-chapter/i.test($(a).attr('class') || '')) {
				prevChapterId = full;
			}
			if (/^next(\s|$)/i.test(t) || t === '→' || /next_page|next-chapter/i.test($(a).attr('class') || '')) {
				nextChapterId = full;
			}
		});
		const relPrev = $('a[rel="prev"]').attr('href');
		const relNext = $('a[rel="next"]').attr('href');
		if (relPrev) prevChapterId = pathOnly(relPrev);
		if (relNext) nextChapterId = pathOnly(relNext);

		console.log(
			`[crimsonscrolls] chapter ${path} → ${parts.length}p prev=${prevChapterId} next=${nextChapterId}`
		);

		return { title, content, prevChapterId, nextChapterId };
	}
}

export default CrimsonScrollsSource;
