/**
 * Razure.org — WordPress novel site (bot-protected; use fetchWithCf / Byparr)
 * Path: scraper/src/sources/impl/novel/Razure.ts
 *
 * - Homepage Latest updates → judul + latestChapter
 * - Series list: /series/ + /series/page/{n}/
 * - Series: /series/{slug}/
 * - Chapter: /{slug}-chapter-{n}/
 * - Search: /?s={q}
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://razure.org';
const PER_PAGE = 24;

function absUrl(href: string | undefined | null): string {
	if (!href) return '';
	const h = String(href).trim();
	if (!h) return '';
	if (h.startsWith('//')) return `https:${h}`;
	if (/^https?:\/\//i.test(h)) return h;
	try {
		return new URL(h.startsWith('/') ? h : `/${h}`, BASE).href;
	} catch {
		return h;
	}
}

function pathOnly(href: string): string {
	try {
		const u = new URL(href.startsWith('http') ? href : absUrl(href));
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		const p = href.startsWith('/') ? href : `/${href}`;
		return p.replace(/\/$/, '') || '/';
	}
}

function cleanText(s: string): string {
	return (s || '')
		.replace(/\u00a0/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function decodeHtml(s: string): string {
	return (s || '')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#8217;|&rsquo;|&#39;/g, "'")
		.replace(/&#8220;|&ldquo;/g, '"')
		.replace(/&#8221;|&rdquo;/g, '"')
		.replace(/&#8211;|&ndash;/g, '–')
		.replace(/&#8212;|&mdash;/g, '—')
		.replace(/&nbsp;/g, ' ');
}

function stripHtml(html: string): string {
	return decodeHtml(
		(html || '')
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/p>/gi, '\n\n')
			.replace(/<\/div>/gi, '\n')
			.replace(/<[^>]+>/g, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
}

function parseChapterNumber(text: string, fallback = 0): number {
	const t = cleanText(text);
	if (!t) return fallback;
	const m =
		t.match(/(?:chapter|ch\.?|c)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	if (/prologue/i.test(t)) return 0;
	return fallback;
}

function normalizeStatus(raw: string): string {
	const v = (raw || '').toLowerCase();
	if (/complet|finish|end|tamat/i.test(v)) return 'Completed';
	if (/hiatus|on[\s-]?hold/i.test(v)) return 'Hiatus';
	if (/drop|cancel/i.test(v)) return 'Dropped';
	if (/ongoing|updating|active/i.test(v)) return 'Ongoing';
	return raw ? cleanText(raw) : 'Ongoing';
}

function isSeriesPath(id: string): boolean {
	return /^\/series\/[^/]+\/?$/.test(id) && !/\/series\/page\//i.test(id);
}

function isChapterPath(id: string): boolean {
	return /^\/[^/]+-chapter-\d+/i.test(id) || /chapter-\d+/i.test(id);
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export class RazureSource extends BaseSource {
	id = 'razure';
	name = 'Razure';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	async getLatestManga(page = 1): Promise<Manga[]> {
		const pageNum = Math.max(1, page);
		if (pageNum > 1) return this.fetchSeriesList(pageNum);

		const fromHome = await this.parseLatestHome().catch(() => [] as Manga[]);
		return fromHome.slice(0, PER_PAGE);
	}

	private pickCover(a?: string, b?: string): string {
		const ok = (u?: string) =>
			!!u &&
			/^https?:\/\//i.test(u) &&
			!/placeholder|no[-_]?cover|default\.(jpg|png)/i.test(u);
		if (ok(a)) return a!;
		if (ok(b)) return b!;
		return a || b || '';
	}

	private extractImg($el: any, $: any): string {
		const img = $el.find('img').first();
		const candidates = [
			img.attr('data-src'),
			img.attr('data-lazy-src'),
			img.attr('data-original'),
			img.attr('src'),
	
			(img.attr('srcset') || '').split(',').pop()?.trim().split(/\s+/)[0],
			$el.find('[style*="background"]').attr('style')?.match(
				/url\(['"]?([^'")\s]+)/
			)?.[1]
		];
		for (const c of candidates) {
			if (c && !c.startsWith('data:') && !/svg|sprite|icon|logo/i.test(c)) {
				return absUrl(c.split('?')[0]);
			}
		}
		return '';
	}

	private async parseLatestHome(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		const $ = cheerio.load(html);
		$('script, style, noscript, iframe').remove();

		let $scope: any = null;
		$('h1, h2, h3, h4, .section-title, [class*="heading"]').each((_, el) => {
			if (/latest\s*updates?/i.test(cleanText($(el).text()))) {
				const $sec = $(el).closest('section, .section, main, div');
				$scope = $sec.length ? $sec : $(el).parent();
				return false;
			}
		});

		const $root = $scope && $scope.length ? $scope : $('body');

		const ordered: Manga[] = [];
		const byId = new Map<string, Manga>();

		$root.find('a[href*="/series/"]').each((_, el) => {
			const href = $(el).attr('href') || '';
			const id = pathOnly(href);
			if (!isSeriesPath(id)) return;

			const $parent = $(el).closest(
				'article, .card, li, .series-item, .update-item, .update, section, div'
			);
			const title =
				cleanText($(el).attr('title') || '') ||
				cleanText($(el).find('img').attr('alt') || '') ||
				cleanText($(el).text());
			if (!title || title.length < 2) return;
			if (
				/^(explore|all series|view all|bookmark|read|series details|dropping)/i.test(
					title
				)
			)
				return;

			let latestChapter: number | undefined;
			$parent.find('a[href*="-chapter-"]').each((__, a) => {
				const n = parseChapterNumber(cleanText($(a).text()));
				if (n > 0 && (latestChapter == null || n > latestChapter)) {
					latestChapter = n;
				}
			});

			const cover = this.extractImg($parent, $) || this.extractImg($(el), $);

			const prev = byId.get(id);
			if (prev) {
				byId.set(id, {
					...prev,
					cover: this.pickCover(prev.cover, cover),
					latestChapter:
						prev.latestChapter != null && latestChapter != null
							? Math.max(Number(prev.latestChapter), latestChapter)
							: (prev.latestChapter ?? latestChapter)
				});
				return;
			}

			const item: Manga = {
				id,
				title: title.slice(0, 200),
				cover,
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				...(latestChapter != null ? { latestChapter } : {})
			};
			byId.set(id, item);
			ordered.push(item);
		});

		return ordered.map((m) => byId.get(m.id)!).slice(0, PER_PAGE);
	}

	private async fetchSeriesList(page: number): Promise<Manga[]> {
		const path = page <= 1 ? '/series/' : `/series/page/${page}/`;
		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			$('script, style, noscript').remove();

			const byId = new Map<string, Manga>();

			$('article, .series-card, .card, li, section, .post').each((_, el) => {
				const $el = $(el);
				const a = $el
					.find('a[href*="/series/"]')
					.filter((_, link) => isSeriesPath(pathOnly($(link).attr('href') || '')))
					.first();
				const href = a.attr('href') || '';
				const id = pathOnly(href);
				if (!isSeriesPath(id) || byId.has(id)) return;

				const title =
					cleanText(a.attr('title') || '') ||
					cleanText($el.find('h2, h3, h4, .title').first().text()) ||
					cleanText(a.text());
				if (!title || title.length < 2) return;
				if (/^(all series|view all|filters?)/i.test(title)) return;

				const cover = this.extractImg($el, $);

				let latestChapter: number | undefined;
				const chMatch = cleanText($el.text()).match(
					/(?:CHAPTERS?|📖)\s*(\d+)/i
				);
				if (chMatch) latestChapter = parseInt(chMatch[1], 10);

				let status: string | undefined;
				const st = cleanText($el.text());
				if (/\bSTATUS\s+Completed\b/i.test(st) || /\bCompleted\b/i.test(st))
					status = 'Completed';
				else if (/\bSTATUS\s+Ongoing\b/i.test(st) || /\bOngoing\b/i.test(st))
					status = 'Ongoing';

				byId.set(id, {
					id,
					title: title.slice(0, 200),
					cover,
					sourceId: this.id,
					type: 'novel',
					status,
					lang: 'en',
					...(latestChapter != null ? { latestChapter } : {})
				});
			});

			if (byId.size < 4) {
				$('a[href*="/series/"]').each((_, el) => {
					const href = $(el).attr('href') || '';
					const id = pathOnly(href);
					if (!isSeriesPath(id) || byId.has(id)) return;
					const title = cleanText($(el).attr('title') || $(el).text());
					if (!title || title.length < 2) return;
					const cover = this.extractImg($(el), $) || this.extractImg($(el).parent(), $);
					byId.set(id, {
						id,
						title: title.slice(0, 200),
						cover,
						sourceId: this.id,
						type: 'novel',
						lang: 'en'
					});
				});
			}

			return Array.from(byId.values()).slice(0, PER_PAGE);
		} catch (e) {
			console.error('[razure] fetchSeriesList', page, e);
			return [];
		}
	}

	private dedupeById(items: Manga[]): Manga[] {
		const seen = new Set<string>();
		const out: Manga[] = [];
		for (const m of items) {
			if (seen.has(m.id)) continue;
			seen.add(m.id);
			out.push(m);
		}
		return out;
	}

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page ?? 1);
		if (!q) return this.getLatestManga(page);

		const path =
			page <= 1
				? `/?s=${encodeURIComponent(q)}`
				: `/page/${page}/?s=${encodeURIComponent(q)}`;

		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list: Manga[] = [];
			const seen = new Set<string>();

			$('article, .result, li, .card, h2, h3').each((_, el) => {
				const $el = $(el);
				const a =
					$el.find('a[href*="/series/"]').first().length
						? $el.find('a[href*="/series/"]').first()
						: $el.is('a')
							? $el
							: $el.find('a').first();
				const href = a.attr('href') || '';
				let id = pathOnly(href);
				if (!isSeriesPath(id)) {
			
					const sa = $el
						.closest('article, li, div')
						.find('a[href*="/series/"]')
						.first();
					id = pathOnly(sa.attr('href') || '');
					if (!isSeriesPath(id)) return;
				}
				if (seen.has(id)) return;

				const title =
					cleanText(a.attr('title') || '') ||
					cleanText($el.find('h2, h3, .title').first().text()) ||
					cleanText(a.text());
				if (!title || title.length < 2) return;

				const cover =
					this.extractImg($el, $) ||
					this.extractImg($el.closest('article, li, div'), $);

				seen.add(id);
				list.push({
					id,
					title: title.slice(0, 200),
					cover,
					sourceId: this.id,
					type: 'novel',
					lang: 'en'
				});
			});

			if (list.length < 2) {
				$('a[href*="/series/"]').each((_, el) => {
					const href = $(el).attr('href') || '';
					const id = pathOnly(href);
					if (!isSeriesPath(id) || seen.has(id)) return;
					const title = cleanText($(el).attr('title') || $(el).text());
					if (!title || title.length < 2) return;
					seen.add(id);
					list.push({
						id,
						title: title.slice(0, 200),
						cover: this.extractImg($(el), $) || this.extractImg($(el).parent(), $),
						sourceId: this.id,
						type: 'novel',
						lang: 'en'
					});
				});
			}

			return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[razure] search', e);
			return [];
		}
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = pathOnly(mangaId);
		if (!path.startsWith('/series/')) {
			path = `/series/${path.replace(/^\//, '')}`;
		}
		path = path.replace(/\/$/, '') + '/';

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			cleanText($('h1').first().text()).replace(/\s*Novel\s*$/i, '').trim() ||
			cleanText($('meta[property="og:title"]').attr('content') || '')
				.split(/\s*[|\-–]\s*Razure/i)[0]
				.trim() ||
			'';

		if (!title || title.length < 2) {
			throw new Error('Novel not found (empty title)');
		}

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('.series-cover img, .wp-post-image, img.cover').first().attr('src') ||
			$('article img, main img').first().attr('src') ||
			'';
		cover = absUrl((cover || '').split('?')[0]);

		let description = '';
		const descCandidates = [
			$('.series-description, .description, .entry-content, .summary').first(),
			$('main p').first()
		];
		for (const el of descCandidates) {
			if (el.length) {
				description = stripHtml(el.html() || el.text()).slice(0, 4000);
				if (description.length > 40) break;
			}
		}
		if (!description) {
			description = cleanText(
				$('meta[name="description"]').attr('content') ||
					$('meta[property="og:description"]').attr('content') ||
					''
			);
		}

		const authors: string[] = [];
		$('a[href*="author="], a[href*="/author/"], .author a, [class*="author"] a').each(
			(_, a) => {
				const n = cleanText($(a).text());
				if (n && n.length < 80 && !authors.includes(n)) authors.push(n);
			}
		);
	
		if (!authors.length) {
			const body = cleanText($('body').text());
			const am = body.match(/Author:\s*([^\n|]+)/i);
			if (am) {
				const names = am[1].split(/[,&]/).map((s) => cleanText(s)).filter(Boolean);
				authors.push(...names.slice(0, 3));
			}
		}

		const genres: string[] = [];
		$('a[href*="genre"], a[href*="tag"], .genre a, .tags a').each((_, a) => {
			const n = cleanText($(a).text());
			if (n && n.length < 40 && !genres.includes(n)) genres.push(n);
		});
		
		if (!genres.length) {
			const headerLine = cleanText($('h1').parent().text() || $('main').text().slice(0, 500));
			const gm = headerLine.match(
				/(Action|Adventure|Comedy|Drama|Fantasy|Horror|Mystery|Romance|Sci-?Fi|Supernatural|Tragedy|Martial Arts)(?:\s*[·|,]\s*(Action|Adventure|Comedy|Drama|Fantasy|Horror|Mystery|Romance|Sci-?Fi|Supernatural|Tragedy|Martial Arts))*/i
			);
			if (gm) {
				gm[0].split(/[·|,]/).forEach((g) => {
					const n = cleanText(g);
					if (n && !genres.includes(n)) genres.push(n);
				});
			}
		}

		let status = 'Ongoing';
		const bodyText = cleanText($('body').text());
		if (/\bSTATUS\s+Completed\b/i.test(bodyText) || /\bCompleted\b/i.test(bodyText))
			status = 'Completed';
		else if (/\bHiatus\b/i.test(bodyText)) status = 'Hiatus';

		const chapters = this.parseChapterList($);

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

	private parseChapterList($: cheerio.CheerioAPI): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		$('a[href*="-chapter-"]').each((_, el) => {
			const href = $(el).attr('href') || '';
			const id = pathOnly(href);
			if (!id || seen.has(id)) return;
			if (!/-chapter-\d+/i.test(id)) return;

			const $row = $(el).closest('li, tr, .chapter-item, article, div');
			const rawTitle = cleanText($(el).text() || $(el).attr('title') || '');
			const number = parseChapterNumber(rawTitle || id);
			if (number <= 0 && !/prologue/i.test(rawTitle)) return;

			const linkText = $(el).text() || '';
			const linkHtml = $(el).html() || '';
			const isLocked =
				/🔒/.test(linkText + linkHtml) ||
				/free\s+on\s+\d/i.test(linkText) ||
				$(el).find('.lock, [class*="lock-icon"], .fa-lock, svg[class*="lock"]').length > 0;

			const date =
				cleanText($row.find('time').attr('datetime') || '') ||
				cleanText($row.find('time, .date, .chapter-date').first().text()) ||
				undefined;

			seen.add(id);
			out.push({
				id,
				title: number > 0 ? `Chapter ${number}` : 'Prologue',
				number: number || 0,
				date: date || undefined,
				isLocked
			});
		});

		out.sort((a, b) => b.number - a.number);
		return out;
	}

	// ─── Chapter content ─────────────────────────────────────────────────

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		const path = pathOnly(chapterId);
		if (!path) throw new Error(`Invalid chapter id: ${chapterId}`);

		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const bodyText = $('body').text().toLowerCase();
		if (
			(/premium|unlock|purchase|subscribe|members only|locked/i.test(bodyText) &&
				!$('.entry-content, .chapter-content, article .content, .post-content').length) ||
			$('.paywall, .premium-gate, [class*="paywall"]').length
		) {
			throw new Error('Chapter is locked / premium on Razure');
		}

		const number = parseChapterNumber(path);
		const h1 = cleanText($('h1').first().text());
		const title =
			number > 0
				? `Chapter ${number}`
				: h1.replace(/\s*[|\-–]\s*Razure.*$/i, '').trim() || 'Chapter';

		let contentHtml = '';
		const selectors = [
			'.entry-content',
			'.chapter-content',
			'.post-content',
			'article .content',
			'main article',
			'[class*="chapter-content"]',
			'.content-area'
		];
		for (const sel of selectors) {
			const el = $(sel).first();
			if (el.length) {
				el.find(
					'script, style, noscript, iframe, nav, .ads, .ad, .sharedaddy, .jp-relatedposts, .comments'
				).remove();
				contentHtml = el.html() || '';
				if (contentHtml && contentHtml.length > 100) break;
			}
		}

		if (!contentHtml || contentHtml.length < 80) {
			const main = $('main, article').first();
			main.find('script, style, nav, header, footer, .ads').remove();
			contentHtml = main.html() || '';
		}

		let content = (contentHtml || '').trim();
		if (content && !/<p|<br|<div/i.test(content)) {
			content = content
				.split(/\n{2,}/)
				.map((p) => `<p>${escapeHtml(p.trim())}</p>`)
				.join('');
		}

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		$('a[href*="-chapter-"], a[rel="prev"], a[rel="next"]').each((_, el) => {
			const href = $(el).attr('href') || '';
			const id = pathOnly(href);
			if (!id || !/-chapter-\d+/i.test(id)) return;
			const label = cleanText($(el).text()) + ' ' + ($(el).attr('rel') || '');
			const cls = $(el).attr('class') || '';
			if (!prevChapterId && /prev|«|previous/i.test(label + cls)) prevChapterId = id;
			if (!nextChapterId && /next|»/i.test(label + cls) && !/prev/i.test(label))
				nextChapterId = id;
		});

		if ((!prevChapterId || !nextChapterId) && number > 0) {
			const slugMatch = path.match(/^\/(.+)-chapter-\d+/i);
			const slug = slugMatch?.[1];
			if (slug) {
				if (!prevChapterId && number > 1) {
					prevChapterId = `/${slug}-chapter-${number - 1}`;
				}
				if (!nextChapterId) {
					nextChapterId = `/${slug}-chapter-${number + 1}`;
				}
			}
		}

		return {
			title,
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default RazureSource;
