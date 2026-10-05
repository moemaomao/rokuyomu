/**
 * CrimsonScrolls (crimsonscrolls.net) — Worker adapter
 * Path: frontend/src/lib/server/workerSources/impl/CrimsonScrolls.ts
 *
 * NOTE: Site memakai SiteGround Bot Protect (403 dari datacenter/edge).
 * Worker Cloudflare sering tetap 403. Untuk hasil stabil, jalankan via
 * scraper service dengan BYPARR_URL. Adapter ini tetap valid untuk lokal
 * / IP yang tidak diblokir.
 *
 * - Homepage: section "Recently Updated"
 * - List: /novels/recently-updated/ + /novels/
 * - Novel: /novel/{slug}/
 * - Chapter: /novel/{slug}/chapter-{n}/ or chapter-{n}-{slug}/
 * - Chapter title: "Chapter N"
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types-manga';

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

function isBlockedHtml(status: number, html: string): boolean {
	if (status === 403 || status === 503 || status === 429) return true;
	const lower = (html || '').slice(0, 8000).toLowerCase();
	return (
		lower.includes('sgcaptcha') ||
		lower.includes('just a moment') ||
		lower.includes('cf-browser-verification') ||
		lower.includes('challenge-platform')
	);
}

export class CrimsonScrollsSource extends BaseSource {
	id = 'crimsonscrolls';
	name = 'CrimsonScrolls';
	baseUrl = BASE;

	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const res = await fetch(url, {
			headers: {
				...this.headers,
				Referer: this.baseUrl,
				Accept:
					'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'Accept-Language': 'en-US,en;q=0.9'
			},
			redirect: 'follow'
		});
		const html = await res.text();
		if (isBlockedHtml(res.status, html) || !res.ok) {
			throw new Error(
				`crimsonscrolls blocked ${res.status} (SiteGround/sgcaptcha). Worker edge IP often denied — use scraper + BYPARR_URL.`
			);
		}
		return html;
	}

	async getLatestManga(page = 1): Promise<Manga[]> {
		const p = Math.max(1, page);
		try {
			if (p === 1) {
				const seen = new Set<string>();
				const list: Manga[] = [];

				try {
					const home = await this.fetchHtml('/');
					for (const m of this.parseRecentlyUpdatedSection(home)) {
						if (seen.has(m.id)) continue;
						seen.add(m.id);
						list.push(m);
						if (list.length >= PER_PAGE) break;
					}
				} catch (e) {
					console.warn('[crimsonscrolls] homepage', String(e).slice(0, 100));
				}

				if (list.length < PER_PAGE) {
					try {
						const html = await this.fetchHtml('/novels/recently-updated/');
						for (const m of this.parseNovelCards(html)) {
							if (seen.has(m.id)) continue;
							seen.add(m.id);
							list.push(m);
							if (list.length >= PER_PAGE) break;
						}
					} catch (e) {
						console.warn('[crimsonscrolls] RU', String(e).slice(0, 100));
					}
				}

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

			const html = await this.fetchHtml('/novels/');
			const all = this.parseNovelCards(html);
			return all.slice((p - 1) * PER_PAGE, p * PER_PAGE);
		} catch (e) {
			console.error('[crimsonscrolls] latest', e);
			return [];
		}
	}

	private parseRecentlyUpdatedSection(html: string): Manga[] {
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		let section: ReturnType<typeof $> | null = null;
		$('h1, h2, h3, .heading, .section-title').each((_, el) => {
			if (/recently\s*updated/i.test(cleanText($(el).text()))) {
				const grand = $(el).closest(
					'section, .cs-section, .container, main, .content'
				);
				section = grand.length ? grand : $(el).parent();
			}
		});
		const scope = section && (section as ReturnType<typeof $>).length
			? (section as ReturnType<typeof $>)
			: $.root();

		scope.find('a[href*="/novel/"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const id = novelIdFromHref(href);
			if (!id || seen.has(id)) return;
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
			const id = novelIdFromHref(a.attr('href') || '');
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

		if (list.length < 5) {
			$('a[href*="/novel/"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const id = novelIdFromHref(href);
				if (!id || /\/chapter-/i.test(pathOnly(href))) return;
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

			if (list.length < 1) {
				const allHtml = await this.fetchHtml('/novels/');
				const all = this.parseNovelCards(allHtml);
				const ql = q.toLowerCase();
				list = all.filter((m) => m.title.toLowerCase().includes(ql));
			}

			return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[crimsonscrolls] search', e);
			return [];
		}
	}

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
			$('img[alt*="cover" i], .novel-cover img, .cover img')
				.first()
				.attr('data-src') ||
			$('img[alt*="cover" i], .novel-cover img, .cover img')
				.first()
				.attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		$('img').each((_, img) => {
			const src = $(img).attr('data-src') || $(img).attr('src') || '';
			const alt = ($(img).attr('alt') || '').toLowerCase();
			if (
				src &&
				(alt.includes('cover') || /\/uploads\//.test(src)) &&
				!/logo|icon|avatar|banner/i.test(src + alt)
			) {
				if (
					!cover ||
					cover.includes('200x300') ||
					cover.includes('225x300')
				) {
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

		let description = '';
		$('h2, h3, .heading').each((_, el) => {
			if (/synopsis|summary|description/i.test(cleanText($(el).text()))) {
				const parts: string[] = [];
				let sib = $(el).next();
				for (let i = 0; i < 15 && sib.length; i++) {
					const tag = ((sib.prop('tagName') as string) || '').toLowerCase();
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
				cleanText(
					$('meta[property="og:description"]').attr('content') || ''
				) ||
				cleanText($('.synopsis, .summary, .description').first().text());
		}
		if (description.length > 4000)
			description = description.slice(0, 4000) + '…';

		const authors: string[] = [];
		$('a[href*="/author/"], .author a').each((_, a) => {
			const n = cleanText($(a).text());
			if (n && !authors.includes(n)) authors.push(n);
		});

		const chapters = this.parseChapterList($, path.replace(/\/$/, ''));

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
			if (!p.startsWith(seriesId)) return;
			if (!/\/chapter-/i.test(p)) return;

			const raw = cleanText($(a).text());
			const number = parseChapterNumber(raw + ' ' + p, 0);
			if (number <= 0 && !/prologue/i.test(raw)) return;

			if (seen.has(p)) return;
			seen.add(p);

			const parentText = cleanText($(a).parent().text());
			const rowText = raw + ' ' + parentText;
			const dateMatch = rowText.match(
				/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/i
			);

			// Worker Chapter type has no isLocked — skip locked flag
			const isLocked =
				/\btier\s*[1-4]\b/i.test(rowText) ||
				(/\blocked\b/i.test(rowText) && !/\bfree\b/i.test(rowText));

			if (isLocked) {
				// still list chapter (reader will fail on content if gated)
			}

			chapters.push({
				id: p,
				title: shortChapterTitle(number, raw),
				number,
				date: dateMatch ? dateMatch[0] : undefined
			});
		});

		chapters.sort((a, b) => b.number - a.number);
		return chapters;
	}

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	/** Optional novel reader — not on IMangaSource but used by novel routes */
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
			$('article p, .entry-content p, .chapter-content p').length < 3
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

		const contentEl = $(
			'article .entry-content, .chapter-content, .cs-chapter-content, .reading-content, article, main'
		).first();
		contentEl
			.find(
				'script, style, noscript, iframe, nav, form, .comments, #comments, header, footer'
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
		if (parts.length < 3) {
			cleanText(contentEl.text())
				.split(/\n+/)
				.forEach((line) => pushP(line.trim()));
		}

		const content =
			parts.length > 0
				? parts.join('\n')
				: '<p><em>Empty content — locked or selector changed.</em></p>';

		$('a').each((_, a) => {
			const t = cleanText($(a).text()).toLowerCase();
			const full = pathOnly($(a).attr('href') || '');
			if (!/\/chapter-/i.test(full)) return;
			if (/^prev(ious)?(\s|$)/i.test(t) || t === '←') prevChapterId = full;
			if (/^next(\s|$)/i.test(t) || t === '→') nextChapterId = full;
		});
		const relPrev = $('a[rel="prev"]').attr('href');
		const relNext = $('a[rel="next"]').attr('href');
		if (relPrev) prevChapterId = pathOnly(relPrev);
		if (relNext) nextChapterId = pathOnly(relNext);

		return { title, content, prevChapterId, nextChapterId };
	}
}

export default CrimsonScrollsSource;
