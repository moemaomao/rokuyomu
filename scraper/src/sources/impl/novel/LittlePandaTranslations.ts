/**
 * Little Panda Translations (littlepandatranslations.com) — Fictioneer
 * Path: scraper/src/sources/impl/novel/LittlePandaTranslations.ts
 *
 * - Homepage: "Latest Updates" (chapter cards → story)
 * - Story: /story/{slug}/
 * - Chapter: /chapter/{chapter-slug}/
 * - Content: .chapter__content
 * - List: /?s=&post_type=fcn_story  (10/page, paginated /page/N/)
 * - Search: /?s={q}
 * - Chapter title: "Chapter N"
 * - Locked: Scheduled / Advanced / password
 * - fetchWithCf
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://littlepandatranslations.com';
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
		t.match(/-chapter-(\d+)/i) ||
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
	return n > 0 ? `Chapter ${n}` : 'Chapter';
}

function storyIdFromHref(href: string): string | null {
	const p = pathOnly(href);
	const m = p.match(/^\/story\/([a-z0-9-]+)(?:\/|$)/i);
	if (!m) return null;
	return `/story/${m[1]}`;
}

export class LittlePandaTranslationsSource extends BaseSource {
	id = 'littlepandatranslations';
	name = 'Little Panda Translations';
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
				'[littlepanda] fetchWithCf fail',
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
			const seen = new Set<string>();
			const list: Manga[] = [];

			const absorb = (html: string) => {
				for (const m of this.parseStoryCards(html)) {
					if (seen.has(m.id)) continue;
					seen.add(m.id);
					list.push(m);
				}
			};

			if (p === 1) {
				try {
					absorb(await this.fetchHtml('/'));
				} catch (e) {
					console.warn(
						'[littlepanda] homepage',
						String(e).slice(0, 80)
					);
				}
		
				for (let sp = 1; list.length < PER_PAGE && sp <= 4; sp++) {
					const path =
						sp === 1
							? '/?s=&post_type=fcn_story'
							: `/page/${sp}/?s=&post_type=fcn_story`;
					try {
						absorb(await this.fetchHtml(path));
					} catch (e) {
						console.warn(
							'[littlepanda] archive p' + sp,
							String(e).slice(0, 60)
						);
						break;
					}
				}
			} else {
				const startSite = (p - 1) * 3 + 1;
				for (
					let sp = startSite;
					list.length < PER_PAGE && sp < startSite + 4;
					sp++
				) {
					const path =
						sp === 1
							? '/?s=&post_type=fcn_story'
							: `/page/${sp}/?s=&post_type=fcn_story`;
					try {
						const before = list.length;
						absorb(await this.fetchHtml(path));
						if (list.length === before) break;
					} catch {
						break;
					}
				}
			}

			console.log(`[littlepanda] latest page=${p} n=${list.length}`);
			return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[littlepanda] latest', e);
			return [];
		}
	}

	private parseStoryCards(html: string): Manga[] {
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();
		const covers = new Map<string, string>();
		const titles = new Map<string, string>();
		const latests = new Map<string, number>();
		const statuses = new Map<string, string>();
		const updatedAts = new Map<string, number>();

		const skipTitle = (t: string) =>
			!t ||
			t.length < 2 ||
			/^(poll|suggestion box|read|story|chapter|home|bookmarks?|follows?|account|search)$/i.test(
				t
			);

		const norm = (s: string) =>
			s
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, ' ')
				.trim();

		$('img.wp-post-image, img[alt*="Cover" i], img[src*="uploads"]').each(
			(_, img) => {
				const alt = cleanText($(img).attr('alt') || '');
				const src =
					$(img).attr('data-src') ||
					$(img).attr('data-lazy-src') ||
					$(img).attr('src') ||
					'';
				if (!src || /logo|icon|avatar|emoji|header|wallpaper|cropped-wallpaper/i.test(src + alt))
					return;
				if (!/uploads/i.test(src)) return;
				let key = alt
					.replace(/\s*[–—-]\s*Chapter\s*\d+.*$/i, '')
					.replace(/\s*Cover\s*$/i, '')
					.trim();
				if (key.length < 3) return;
				const full = absUrl(src.split('?')[0]);
				const prev = covers.get(norm(key));
				if (!prev || /-(\d+)x(\d+)\./.test(prev)) {
					covers.set(norm(key), full.replace(/-\d+x\d+(\.\w+)$/, '$1'));
				}
			}
		);

		$('a[href*="/story/"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const id = storyIdFromHref(href);
			if (!id) return;

			let title =
				cleanText($(a).attr('title') || '') ||
				cleanText($(a).text());
			title = title
				.replace(/\s*[–—-]\s*Chapter\s*\d+.*$/i, '')
				.replace(/\s*Cover\s*$/i, '')
				.trim();
			if (!skipTitle(title) && !titles.has(id)) titles.set(id, title);

			const root = $(a).closest(
				'article, .card, .post, li, .search-result, .item, div'
			);
			if (root.length) {
				const body = cleanText(root.text());
				if (/\bcompleted\b/i.test(body)) statuses.set(id, 'Completed');
				else if (/\bhiatus\b/i.test(body)) statuses.set(id, 'Hiatus');
				else if (/\bongoing\b/i.test(body)) statuses.set(id, 'Ongoing');
				const cm = body.match(/\b(\d{1,3})\s+[\d.]+\s*[kK]\b/);
				if (cm) {
					const n = parseInt(cm[1], 10);
					if (n > (latests.get(id) || 0)) latests.set(id, n);
				}
		
				const dm = body.match(
					/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+'?\d{2,4}\b/i
				);
				if (dm) {
					let ds = dm[0].replace(/'(\d{2})\b/, '20$1');
					const ts = Date.parse(ds);
					if (!Number.isNaN(ts)) {
						const prev = updatedAts.get(id) || 0;
						if (ts > prev) updatedAts.set(id, ts);
					}
				}
			}
		});

		$('a[href*="/chapter/"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const p = pathOnly(href);
			if (!/^\/chapter\//i.test(p) || /poll|suggestion/i.test(p)) return;

			const raw = cleanText($(a).text());
			const n = parseChapterNumber(raw + ' ' + p, 0);
			const root = $(a).closest('article, .card, li, div, section');
			const storyA = root
				.find('a[href*="/story/"]')
				.filter((__, x) => !!storyIdFromHref($(x).attr('href') || ''))
				.first();
			let id = storyIdFromHref(storyA.attr('href') || '');
			const fromCh = raw
				.replace(/\s*[–—-]\s*Chapter\s*\d+.*$/i, '')
				.trim();

			if (!id && fromCh) {
				for (const [sid, st] of titles) {
					if (
						norm(st) === norm(fromCh) ||
						norm(fromCh).startsWith(norm(st)) ||
						norm(st).startsWith(norm(fromCh))
					) {
						id = sid;
						break;
					}
				}
			}
			if (!id) {
				const m = p.match(/^\/chapter\/(.+)-chapter-(\d+)$/i);
				if (m) {
					id = `/story/${m[1]}`;
					if (!titles.has(id) && !skipTitle(fromCh))
						titles.set(id, fromCh || m[1].replace(/-/g, ' '));
					const nn = parseFloat(m[2]);
					if (nn > (latests.get(id) || 0)) latests.set(id, nn);
				}
			}
			if (!id) return;

			if (n > (latests.get(id) || 0)) latests.set(id, n);
			if (!titles.has(id) && !skipTitle(fromCh)) titles.set(id, fromCh);

			const body = cleanText(root.text());
			const dm = body.match(
				/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+'?\d{2,4}\b/i
			);
			if (dm) {
				let ds = dm[0].replace(/'(\d{2})\b/, '20$1');
				const ts = Date.parse(ds);
				if (!Number.isNaN(ts)) {
					const prev = updatedAts.get(id) || 0;
					if (ts > prev) updatedAts.set(id, ts);
				}
			}
			if (/\bongoing\b/i.test(body)) statuses.set(id, 'Ongoing');
			if (/\bcompleted\b/i.test(body)) statuses.set(id, 'Completed');
		});

		const re =
			/https?:\/\/littlepandatranslations\.com\/story\/([a-z0-9-]+)\/?/gi;
		let m: RegExpExecArray | null;
		while ((m = re.exec(html)) !== null) {
			const id = `/story/${m[1]}`;
			if (!titles.has(id)) {
				const slug = m[1]
					.replace(/-/g, ' ')
					.replace(/\b\w/g, (c) => c.toUpperCase());
				titles.set(id, slug);
			}
		}

		for (const [id, title] of titles) {
			if (seen.has(id) || skipTitle(title)) continue;
			seen.add(id);
			const latest = latests.get(id) || 0;
			let cover = '';
			const nt = norm(title);
			if (covers.has(nt)) cover = covers.get(nt)!;
			else {
				for (const [k, v] of covers) {
					if (k.includes(nt) || nt.includes(k)) {
						cover = v;
						break;
					}
				}
			}
			const updatedAt = updatedAts.get(id);
			list.push({
				id,
				title: title.slice(0, 200),
				cover,
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: statuses.get(id) || 'Ongoing',
				...(latest > 0 ? { latestChapter: Math.floor(latest) } : {}),
				...(updatedAt ? { updatedAt } : {})
			});
		}

		console.log(
			`[littlepanda] parseStoryCards n=${list.length} covers=${[...covers.keys()].length}`
		);
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
				`[littlepanda] search "${q}" page=${page} n=${list.length}`
			);
			return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[littlepanda] search', e);
			return [];
		}
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = pathOnly(mangaId);
		if (path.startsWith('/chapter/')) {
			const chHtml = await this.fetchHtml(
				path.endsWith('/') ? path : `${path}/`
			);
			const $ch = cheerio.load(chHtml);
			const back = $ch(
				'a[href*="/story/"], .chapter__story-link, a:contains("Back to Story")'
			)
				.filter((_, a) => !!storyIdFromHref($ch(a).attr('href') || ''))
				.first()
				.attr('href');
			if (back) path = pathOnly(back);
		}
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
		title = title
			.replace(/\s*[»|–—-]\s*Little Panda.*$/i, '')
			.trim();

		let cover =
			$(
				'.story__thumbnail img, .story-cover img, .thumbnail img, img.wp-post-image'
			)
				.first()
				.attr('data-src') ||
			$(
				'.story__thumbnail img, .story-cover img, .thumbnail img, img.wp-post-image'
			)
				.first()
				.attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = absUrl((cover || '').split('?')[0]);

		const authors: string[] = [];
		const bodyText = cleanText($('body').text());
		const authorLine = bodyText.match(/Author:\s*([^\n]+)/i);
		if (authorLine) {
			const n = cleanText(authorLine[1]).replace(/\s*Source:.*$/i, '');
			if (n && n.length < 80) authors.push(n);
		}
		$('a[href*="/author/"], .story__author a').each((_, a) => {
			const n = cleanText($(a).text());
			if (n && !authors.includes(n) && !/^by\s*$/i.test(n)) authors.push(n);
		});

		const genres: string[] = [];
		const isJunkGenre = (g: string) => {
			if (!g || g.length < 2 || g.length > 40) return true;
			if (/[{}()\[\]\\/;=<>]|wp-|php|https?:|fictioneer|littlepanda/i.test(g))
				return true;
			if (/^\d+$/.test(g)) return true;
			return false;
		};
		$('a[href*="/tag/"], a[href*="/genre/"], a[href*="/story_tag/"]').each(
			(_, a) => {
				const g = cleanText($(a).text());
				if (!isJunkGenre(g) && !genres.includes(g)) genres.push(g);
			}
		);

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
		const descMatch = bodyText.match(
			/Description\s*:?\s*([\s\S]{40,2500}?)(?:Original Title|Author|Source|Footnotes|Read Later|$)/i
		);
		if (descMatch) description = cleanText(descMatch[1]);
		if (description.length > 4000)
			description = description.slice(0, 4000) + '…';

		const chapters = this.parseChapterList($, path.replace(/\/$/, ''));

		console.log(
			`[littlepanda] details ${path} → ${chapters.length} ch`
		);

		return {
			id: path.replace(/\/$/, ''),
			title,
			cover,
			sourceId: this.id,
			description,
			authors,
			status,
			genres: genres.slice(0, 15),
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
		_storyId: string
	): Chapter[] {
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		const scope = $(
			'.chapter-group, .chapter-list, .story__chapters, .chapters'
		);
		const linkSel = 'a[href*="/chapter/"]';
		const links = scope.length > 0 ? scope.find(linkSel) : $(linkSel);

		links.each((_, a) => {
			const href = $(a).attr('href') || '';
			if (/post_type=fcn_chapter/i.test(href)) return;

			const p = pathOnly(href);
			if (!/^\/chapter\/[a-z0-9-]+$/i.test(p)) return;
			if (/poll|suggestion/i.test(p)) return;

			let raw = cleanText($(a).text());
			raw = raw.replace(/^scheduled:\s*/i, '').trim();
			if (!raw || /show\s+\d+\s+more/i.test(raw)) return;
			if (/^\d+\s*words?$/i.test(raw)) return;

			if (seen.has(p)) return;
			seen.add(p);

			const number = parseChapterNumber(raw + ' ' + p, 0);
			const parent = cleanText(
				$(a).closest('li, .chapter-item, div').text()
			);
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
			} as Chapter);
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
		if (!path.startsWith('/chapter/')) {
			path = `/chapter/${path.replace(/^\//, '')}`;
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
			throw new Error(
				'Chapter is locked / scheduled on Little Panda Translations'
			);
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
				'script, style, noscript, iframe, nav, form, .comments, #comments, .chapter__actions, .chapter-index, header, footer, .footnotes'
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
			if (/littlepandatranslations\.com/i.test(t) && t.length < 80) return;
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
			if (!/^\/chapter\//i.test(full)) return;
			if (/^prev(ious)?(\s|$)/i.test(t) || t === '←') prevChapterId = full;
			if (/^next(\s|$)/i.test(t) || t === '→') nextChapterId = full;
		});
		const relPrev = $('a[rel="prev"]').attr('href');
		const relNext = $('a[rel="next"]').attr('href');
		if (relPrev) prevChapterId = pathOnly(relPrev);
		if (relNext) nextChapterId = pathOnly(relNext);

		console.log(
			`[littlepanda] chapter ${path} → ${parts.length}p prev=${prevChapterId} next=${nextChapterId}`
		);

		return { title, content, prevChapterId, nextChapterId };
	}
}

export default LittlePandaTranslationsSource;
