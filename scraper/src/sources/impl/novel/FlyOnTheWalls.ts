/**
 * Fly on the Walls (flyonthewalls.blog) — Fictioneer theme
 * Path: scraper/src/sources/impl/novel/FlyOnTheWalls.ts
 *
 * - Homepage: Latest Unlocked Chapters + Newly Added / Trending
 * - Story: /story/{slug}/
 * - Chapter: /story/{slug}/{chapter-slug}/  (e.g. cbr-1, vol-1-ch-6)
 * - Content: .chapter__content
 * - List all: /?s=&post_type=fcn_story  (paginated /page/N/)
 * - Search: /?s={q}
 * - Locked: Scheduled / Advanced / password chapters → isLocked
 * - fetchWithCf
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://flyonthewalls.blog';
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
	const m =
		t.match(/(?:chapter|ch\.?|c)\s*[.\-:]?\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\b(?:cbr|agent|ep\.?|episode)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\/(?:cbr|ch|chapter|vol-\d+-ch)-(\d+)/i) ||
		t.match(/(\d+(?:\.\d+)?)\s*$/) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function shortChapterTitle(number: number, raw?: string): string {
	if (number > 0) return `Chapter ${number}`;
	const n = parseChapterNumber(raw || '', 0);
	return n > 0 ? `Chapter ${n}` : cleanText(raw || 'Chapter').slice(0, 80) || 'Chapter';
}

function storyIdFromHref(href: string): string | null {
	const p = pathOnly(href);
	const m = p.match(/^\/story\/([a-z0-9-]+)(?:\/|$)/i);
	if (!m) return null;
	return `/story/${m[1]}`;
}

export class FlyOnTheWallsSource extends BaseSource {
	id = 'flyonthewalls';
	name = 'Fly on the Walls';
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
				'[flyonthewalls] fetchWithCf fail',
				String(e).slice(0, 100)
			);
			const res = await fetch(url, { headers: this.headers });
			if (!res.ok) {
				const t = await res.text().catch(() => '');
				throw new Error(`fetchHtml ${res.status}: ${t.slice(0, 100)}`);
			}
			return await res.text();
		}
	}

	// ─── Latest ──────────────────────────────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		const p = Math.max(1, page);
		try {
			if (p === 1) {
				const seen = new Set<string>();
				const list: Manga[] = [];

				try {
					const home = await this.fetchHtml('/');
					for (const m of this.parseStoryCards(home)) {
						if (seen.has(m.id)) continue;
						seen.add(m.id);
						list.push(m);
						if (list.length >= PER_PAGE) break;
					}
				} catch (e) {
					console.warn(
						'[flyonthewalls] homepage',
						String(e).slice(0, 80)
					);
				}

				for (const archivePath of [
					'/?s=&post_type=fcn_story',
					'/page/2/?s=&post_type=fcn_story'
				]) {
					if (list.length >= PER_PAGE) break;
					try {
						const html = await this.fetchHtml(archivePath);
						for (const m of this.parseStoryCards(html)) {
							if (seen.has(m.id)) continue;
							seen.add(m.id);
							list.push(m);
							if (list.length >= PER_PAGE) break;
						}
					} catch (e) {
						console.warn(
							'[flyonthewalls] archive',
							String(e).slice(0, 80)
						);
					}
				}

				console.log(`[flyonthewalls] latest page=1 n=${list.length}`);
				return list.slice(0, PER_PAGE);
			}

			const path =
				p <= 1
					? '/?s=&post_type=fcn_story'
					: `/page/${p}/?s=&post_type=fcn_story`;
			const html = await this.fetchHtml(path);
			const list = this.parseStoryCards(html);
			console.log(`[flyonthewalls] latest page=${p} n=${list.length}`);
			return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[flyonthewalls] latest', e);
			return [];
		}
	}

	private parseStoryCards(html: string): Manga[] {
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
			if (seen.has(id) || !title || title.length < 2) return;
			if (!/^\/story\/[a-z0-9-]+$/i.test(id)) return;
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

		$(
			'article, .card, .post, .story-card, .item, li, .search-result, .grid-item'
		).each((_, el) => {
			const root = $(el);
			const a = root
				.find('a[href*="/story/"]')
				.filter((_, x) => {
					const p = pathOnly($(x).attr('href') || '');
					return /^\/story\/[a-z0-9-]+$/i.test(p);
				})
				.first();
			if (!a.length) return;
			const id = storyIdFromHref(a.attr('href') || '');
			if (!id) return;

			const title =
				cleanText(
					root.find('h2, h3, h4, .title, .story-title').first().text()
				) ||
				cleanText(a.attr('title') || '') ||
				cleanText(a.find('img').attr('alt') || '') ||
				cleanText(a.text());

			if (!title || /^(read|story|chapter)$/i.test(title)) return;

			const img = root.find('img').first();
			const cover =
				img.attr('data-src') ||
				img.attr('data-lazy-src') ||
				img.attr('src') ||
				'';

			const body = cleanText(root.text());
			let latest = 0;
			const chMatch = body.match(/\b(\d+)\s+(?:\d[\d.]*\s*[kK])?\s/);
			const headNums = body.match(/^.*?(\d+)\s+[\d.]+\s*[kK]/);
			if (headNums) latest = parseInt(headNums[1], 10) || 0;
			root.find('a[href*="/story/"]').each((_, ca) => {
				const href = $(ca).attr('href') || '';
				if (!/\/story\/[^/]+\/[^/]+/.test(pathOnly(href))) return;
				const n = parseChapterNumber($(ca).text() + ' ' + href, 0);
				if (n > latest) latest = n;
			});

			let status = 'Ongoing';
			if (/\bcompleted\b/i.test(body)) status = 'Completed';
			else if (/\bhiatus\b/i.test(body)) status = 'Hiatus';

			push(id, title, cover, latest || undefined, status);
		});

		if (list.length < 5) {
			$('a[href*="/story/"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const id = storyIdFromHref(href);
				if (!id) return;
				if (!/^\/story\/[a-z0-9-]+$/i.test(pathOnly(href))) return;
				const title =
					cleanText($(a).attr('title') || '') ||
					cleanText($(a).find('img').attr('alt') || '') ||
					cleanText($(a).text());
				if (!title || title.length < 2) return;
				if (/^(read|story|chapter|start)$/i.test(title)) return;
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
			const list = this.parseStoryCards(html);
			console.log(
				`[flyonthewalls] search "${q}" page=${page} n=${list.length}`
			);
			return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[flyonthewalls] search', e);
			return [];
		}
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = pathOnly(mangaId);
		const chStrip = path.match(/^(\/story\/[a-z0-9-]+)\/.+/i);
		if (chStrip) path = chStrip[1];
		if (!path.startsWith('/story/')) {
			path = `/story/${path.replace(/^\//, '')}`;
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
		title = title.replace(/\s*[–—-]\s*Fly on the wall.*$/i, '').trim();

		let cover =
			$('.story__thumbnail img, .story-cover img, .thumbnail img, img.wp-post-image')
				.first()
				.attr('data-src') ||
			$('.story__thumbnail img, .story-cover img, .thumbnail img, img.wp-post-image')
				.first()
				.attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = absUrl((cover || '').split('?')[0]);

		const authors: string[] = [];
		$('a[href*="/author/"], .story__author a, .author a').each((_, a) => {
			const n = cleanText($(a).text());
			if (n && !authors.includes(n) && !/^by\s*$/i.test(n)) authors.push(n);
		});

		const genres: string[] = [];
		const ALLOWED_GENRE = new Set(
			[
				'bl',
				'gl',
				'yaoi',
				'yuri',
				'romance',
				'drama',
				'comedy',
				'action',
				'fantasy',
				'modern',
				'school',
				'campus',
				'omegaverse',
				'historical',
				'supernatural',
				'horror',
				'mystery',
				'thriller',
				'slice of life',
				'adult',
				'mature',
				'smut',
				'tragedy',
				'adventure',
				'sci-fi',
				'science fiction',
				'martial arts',
				'wuxia',
				'xianxia',
				'reincarnation',
				'transmigration',
				'isekai',
				'crime',
				'psychological',
				'military',
				'sports'
			].map((s) => s.toLowerCase())
		);
		const isJunkGenre = (g: string) => {
			if (!g || g.length < 2 || g.length > 28) return true;
			if (/[{}()\[\]\\/;=<>]|wp-|php|https?:|fictioneer|flyonthewalls/i.test(g))
				return true;
			if (/^\d+$/.test(g)) return true;
			if (/\b(words?|oct|nov|dec|jan|feb|mar|apr|may|jun|jul|aug|sep|cbr|scheduled|show)\b/i.test(g))
				return true;
			if (/\b(top|bottom|s\.?|sadist)\b/i.test(g) && !ALLOWED_GENRE.has(g.toLowerCase()))
				return true;
			return false;
		};

		$('a[href*="/tag/"], a[href*="/genre/"], a[href*="/story_tag/"]').each(
			(_, a) => {
				const g = cleanText($(a).text());
				if (isJunkGenre(g) || genres.includes(g)) return;
				if (ALLOWED_GENRE.has(g.toLowerCase()) || g.length <= 20) {
					genres.push(g);
				}
			}
		);

		const bodyRaw = $('body').html() || '';
		const genreLine =
			bodyRaw.match(/Setting\s*\/\s*Genre:\s*<\/?\w*[^>]*>?\s*([^<\n]+)/i) ||
			cleanText($('body').text()).match(/Setting\/Genre:\s*([^\n*]+)/i);
		if (genreLine) {
			genreLine[1].split(/[,/|]/).forEach((part) => {
				const t = cleanText(part);
				if (!isJunkGenre(t) && !genres.includes(t)) genres.push(t);
			});
		}

		$('.story__status, .badge, .rating, .age-rating').each((_, el) => {
			const t = cleanText($(el).text());
			if (/^(adult|mature|everyone|teen)$/i.test(t) && !genres.includes(t)) {
				genres.push(t);
			}
		});

		const bodyText = cleanText($('body').text());
		let status = 'Ongoing';
		if (/\bcompleted\b/i.test(bodyText.slice(0, 4000))) status = 'Completed';
		else if (/\bhiatus\b/i.test(bodyText.slice(0, 4000))) status = 'Hiatus';

		let description =
			cleanText(
				$('.story__content, .story-content, .entry-content, .summary')
					.first()
					.text()
			) ||
			cleanText($('meta[property="og:description"]').attr('content') || '');
		description = description
			.replace(/Keywords:[\s\S]{0,2000}$/i, '')
			.replace(/Bottom:[\s\S]*$/i, '')
			.replace(/Top:[\s\S]*$/i, '')
			.trim();
		if (description.length > 4000)
			description = description.slice(0, 4000) + '…';

		const chapters = this.parseChapterList($, path.replace(/\/$/, ''));

		console.log(
			`[flyonthewalls] details ${path} → ${chapters.length} ch genres=${genres.length}`
		);

		return {
			id: path.replace(/\/$/, ''),
			title,
			cover,
			sourceId: this.id,
			description,
			authors,
			status,
			genres: genres.slice(0, 12),
			chapters,
			type: 'novel',
			lang: 'en',
			...(chapters.length
				? {
						latestChapter:
							chapters.find((c) => !(c as any).isLocked)?.number ??
							chapters[0]?.number
					}
				: {})
		};
	}

	private parseChapterList(
		$: cheerio.CheerioAPI,
		storyId: string
	): Chapter[] {
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		const scope = $(
			'.chapter-group, .chapter-list, .story__chapters, .chapters'
		);
		const linkSel = 'a[href*="/story/"]';
		const links = scope.length > 0 ? scope.find(linkSel) : $(linkSel);

		links.each((_, a) => {
			const href = $(a).attr('href') || '';
			if (/post_type=fcn_chapter/i.test(href)) return; // scheduled query URL

			const p = pathOnly(href);
			const m = p.match(/^(\/story\/[a-z0-9-]+)\/([a-z0-9-]+)$/i);
			if (!m) return;
			if (m[1] !== storyId) return;

			const chapterSlug = m[2];
			if (/^(feed|amp|page)$/i.test(chapterSlug)) return;

			let raw = cleanText($(a).text());
			raw = raw.replace(/^scheduled:\s*/i, '').trim();
			if (!raw || /show\s+\d+\s+more/i.test(raw)) return;
			if (/^\d+\s*words?$/i.test(raw)) return;
			if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(raw) && raw.length < 20)
				return;

			if (seen.has(p)) return;
			seen.add(p);

			const number = parseChapterNumber(raw + ' ' + chapterSlug, 0);
			const parent = cleanText($(a).closest('li, .chapter-item, div').text());
			const row = raw + ' ' + parent;
			const isLocked =
				/\bscheduled\b/i.test(row) ||
				/\badvanced\b/i.test(row) ||
				/\blocked\b/i.test(row) ||
				/\bpassword\b/i.test(row);

			const dateMatch = row.match(
				/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+(?:\d{2,4})\b/i
			);

			chapters.push({
				id: p,
				title: shortChapterTitle(number, raw),
				number: number > 0 ? number : 0,
				date: dateMatch ? dateMatch[0] : undefined,
				...(isLocked ? { isLocked: true } : {})
			});
		});

		chapters.sort((a, b) => {
			if (a.number && b.number) return a.number - b.number;
			return a.id.localeCompare(b.id);
		});
		let seq = 1;
		for (const ch of chapters) {
			if (!ch.number) ch.number = seq;
			seq = Math.max(seq, ch.number) + 1;
		}

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
		if (!path.startsWith('/story/')) {
			path = `/story/${path.replace(/^\//, '')}`;
		}
		const fetchPath = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(fetchPath);
		const $ = cheerio.load(html);

		const bodyLower = $('body').text().toLowerCase();
		if (
			(/password|scheduled|members only|login to read|advanced chapter/i.test(
				bodyLower
			) &&
				$('.chapter__content p, .content-section p').length < 2) ||
			$('.password-form, .chapter-password').length > 0
		) {
			throw new Error('Chapter is locked / scheduled on Fly on the Walls');
		}

		const rawTitle =
			cleanText($('.chapter__title, h1').first().text()) ||
			cleanText(
				$('meta[property="og:title"]')
					.attr('content')
					?.split(/\s*[|\-–]\s*/)[0] || ''
			);
		const number = parseChapterNumber(path + ' ' + rawTitle, 0);
		const title = shortChapterTitle(number > 0 ? number : 0, rawTitle);

		const contentEl = $(
			'.chapter__content, .content-section, .chapter-content, article .entry-content'
		).first();
		contentEl
			.find(
				'script, style, noscript, iframe, nav, form, .comments, #comments, .chapter__actions, .chapter-index, header, footer'
			)
			.remove();

		const parts: string[] = [];
		const pushP = (t: string) => {
			if (!t || t.length < 2) return;
			if (
				/^(support|patreon|discord|prev|next|bookmark|commenting is disabled)/i.test(
					t
				)
			)
				return;
			if (/flyonthewalls\.blog/i.test(t) && t.length < 80) return;
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

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		$('a').each((_, a) => {
			const t = cleanText($(a).text()).toLowerCase();
			const full = pathOnly($(a).attr('href') || '');
			if (!/^\/story\/[^/]+\/[^/]+$/i.test(full)) return;
			if (/^prev(ious)?(\s|$)/i.test(t) || t === '←') prevChapterId = full;
			if (/^next(\s|$)/i.test(t) || t === '→') nextChapterId = full;
		});
		const relPrev = $('a[rel="prev"]').attr('href');
		const relNext = $('a[rel="next"]').attr('href');
		if (relPrev) prevChapterId = pathOnly(relPrev);
		if (relNext) nextChapterId = pathOnly(relNext);

		console.log(
			`[flyonthewalls] chapter ${path} → ${parts.length}p prev=${prevChapterId} next=${nextChapterId}`
		);

		return { title, content, prevChapterId, nextChapterId };
	}
}

export default FlyOnTheWallsSource;
