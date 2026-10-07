/**
 * Xianhua Tales (www.xianhuatales.com)
 * Path: scraper/src/sources/impl/novel/XianhuaTales.ts
 *
 * - Latest: /novels?sort=updated[&page=N]
 * - Novel: /novels/{slug}
 * - Chapter: /novels/{slug}/chapters/{n}
 * - Content: .chapter-content (whitespace-pre-line)
 * - Cover: /storage/novel-covers/...
 * - Paywall: Premium / Coin / Locked near chapter → isLocked
 * - Search: /novels?q=
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://www.xianhuatales.com';
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
	return (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function isNovelPath(id: string): boolean {
	return /^\/novels\/[a-z0-9\-]+$/i.test(id);
}

function isChapterPath(id: string): boolean {
	return /^\/novels\/[a-z0-9\-]+\/chapters\/\d+$/i.test(id);
}

function extractImg($el: any): string {
	if (!$el || !$el.find) return '';
	let best = '';
	$el.find('img').each((_: number, el: any) => {
		const attribs = (el as any).attribs || {};
		for (const key of ['data-src', 'data-lazy-src', 'src']) {
			const v = attribs[key];
			if (
				v &&
				!String(v).startsWith('data:') &&
				!/logo|icon|sprite|avatar|placeholder/i.test(String(v))
			) {
				const url = absUrl(String(v).split('?')[0]);
				if (/novel-covers|storage\//i.test(url)) {
					best = url;
					return false;
				}
				if (!best) best = url;
			}
		}
	});
	return best;
}

function parseChapterNumber(text: string): number {
	const t = cleanText(text);
	const m =
		t.match(/\/chapters\/(\d+)/i) ||
		t.match(/(?:chapter|ch\.?)\s*[.:\-]?\s*(\d+)/i) ||
		t.match(/\b(\d+)\b/);
	if (m) {
		const n = parseInt(m[1], 10);
		if (!Number.isNaN(n)) return n;
	}
	return 0;
}

export class XianhuaTalesSource extends BaseSource {
	id = 'xianhuatales';
	name = 'XianhuaTales';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	// ─── Latest Updates ──────────────────────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		const pageNum = Math.max(1, page);
		try {
			if (pageNum <= 1) {
				const html1 = await this.fetchHtml('/novels?sort=updated');
				const list = this.parseNovelCards(html1);
				if (list.length < PER_PAGE) {
					try {
						const html2 = await this.fetchHtml('/novels?sort=updated&page=2');
						const more = this.parseNovelCards(html2);
						const seen = new Set(list.map((m) => m.id));
						for (const m of more) {
							if (seen.has(m.id)) continue;
							seen.add(m.id);
							list.push(m);
							if (list.length >= PER_PAGE) break;
						}
					} catch {
					}
				}
				return list.slice(0, PER_PAGE);
			}
			const html = await this.fetchHtml(
				`/novels?sort=updated&page=${pageNum}`
			);
			return this.parseNovelCards(html).slice(0, PER_PAGE);
		} catch (e) {
			console.error('[xianhuatales] getLatestManga', e);
			return [];
		}
	}

	private parseNovelCards(html: string): Manga[] {
		const $ = cheerio.load(html);
		$('script, style, noscript').remove();
		const ordered: Manga[] = [];
		const byId = new Map<string, Manga>();

		$('img[src*="novel-covers"], img[src*="storage/"]').each((_, img) => {
			const src = absUrl(
				String(
					$(img).attr('src') ||
						$(img).attr('data-src') ||
						''
				).split('?')[0]
			);
			if (!src || /logo|icon|brand/i.test(src)) return;

			let $p = $(img).parent();
			let href = '';
			for (let i = 0; i < 8 && $p.length; i++) {
				const a = $p.is('a[href*="/novels/"]')
					? $p
					: $p.find('a[href*="/novels/"]').filter((_, el) => {
							const h = $(el).attr('href') || '';
							return isNovelPath(pathOnly(h));
						}).first();
				if (a.length) {
					const h = a.attr('href') || '';
					if (isNovelPath(pathOnly(h))) {
						href = h;
						break;
					}
				}
				$p = $p.parent();
			}
			if (!href) return;
			const id = pathOnly(href);
			if (!isNovelPath(id)) return;

			const $card = $(img).closest('a, article, li, .group, div');
			let title =
				cleanText($card.find('h2, h3, h4').first().text()) ||
				cleanText($card.attr('title') || '') ||
				cleanText(
					$card
						.find('a[href*="/novels/"]')
						.filter((_, el) => isNovelPath(pathOnly($(el).attr('href') || '')))
						.first()
						.text()
				);
			if (!title || title.length < 3) return;
			if (
				/^(view all|free|mixed|open|sign in|join|apply)/i.test(title)
			) {
				return;
			}
			if (title.length > 180) title = title.slice(0, 180);

			let latestChapter: number | undefined;
			const cm = cleanText($card.text()).match(/(\d+)\s*Chapters?/i);
			if (cm) latestChapter = parseInt(cm[1], 10);

			const existing = byId.get(id);
			if (existing) {
				if (!existing.cover) existing.cover = src;
				if (existing.latestChapter == null && latestChapter != null) {
					existing.latestChapter = latestChapter;
				}
				return;
			}
			const manga: Manga = {
				id,
				title: title.slice(0, 200),
				cover: src,
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				...(latestChapter != null ? { latestChapter } : {})
			};
			byId.set(id, manga);
			ordered.push(manga);
		});

		$('a[href*="/novels/"]').each((_, el) => {
			const href = $(el).attr('href') || '';
			const id = pathOnly(href);
			if (!isNovelPath(id) || byId.has(id)) return;
			if (/\/chapters\//i.test(href)) return;

			const $el = $(el);
	
			let $card = $el.closest('.group, article, li');
			if (!$card.length) $card = $el.parent().parent();
			let title =
				cleanText($el.find('h2, h3, h4').first().text()) ||
				cleanText($card.find('h2, h3, h4').first().text()) ||
				cleanText($el.attr('title') || '') ||
				cleanText($el.text());
			if (!title || title.length < 3) return;
			if (
				/^(view all|free|mixed|open|sign in|join|apply|latest|most popular)/i.test(
					title
				)
			) {
				return;
			}
			if (title.length > 180) title = title.slice(0, 180);

			let latestChapter: number | undefined;
			const cm = cleanText($card.text()).match(/(\d+)\s*Chapters?/i);
			if (cm) latestChapter = parseInt(cm[1], 10);

			const cover = extractImg($card) || extractImg($el.parent()) || extractImg($el);
			const manga: Manga = {
				id,
				title: title.slice(0, 200),
				cover,
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				...(latestChapter != null ? { latestChapter } : {})
			};
			byId.set(id, manga);
			ordered.push(manga);
		});

		return ordered;
	}

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page ?? 1);
		if (!q) return this.getLatestManga(page);

		const path =
			page <= 1
				? `/novels?q=${encodeURIComponent(q)}`
				: `/novels?q=${encodeURIComponent(q)}&page=${page}`;
		try {
			const html = await this.fetchHtml(path);
			return this.parseNovelCards(html).slice(0, PER_PAGE);
		} catch (e) {
			console.error('[xianhuatales] search', e);
			return [];
		}
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = pathOnly(mangaId);
		if (!path.startsWith('/novels/')) {
			path = `/novels/${path.replace(/^\//, '')}`;
		}
		path = path.replace(/\/$/, '');

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			cleanText($('h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '') ||
			'';
		if (!title || title.length < 2) {
			throw new Error('Novel not found (empty title)');
		}

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('img[src*="novel-covers"]').first().attr('src') ||
			$('img[src*="storage/"]').first().attr('src') ||
			'';
		cover = absUrl(String(cover).split('?')[0]);

		let description = '';
		const $syn = $('h2, h3')
			.filter((_, el) => /synopsis/i.test($(el).text()))
			.first()
			.nextAll()
			.slice(0, 8);
		if ($syn.length) {
			description = cleanText($syn.text()).slice(0, 4000);
		}
		if (!description || description.length < 40) {
			$('p').each((_, el) => {
				const t = cleanText($(el).text());
				if (t.length > 80 && !description) description = t.slice(0, 4000);
			});
		}

		const authors: string[] = [];
		const genres: string[] = [];
		let status = 'Ongoing';
		let altTitles: string[] = [];

		const bodyText = cleanText($('body').text());
		const authorM = bodyText.match(/Author\s+([^\n]+?)(?:\s+Translator|\s+Editor|\s+Status)/i);
		if (authorM) {
			const a = cleanText(authorM[1]);
			if (a && a.length < 80) authors.push(a);
		}
	
		const $h1 = $('h1').first();
		const afterH1 = cleanText($h1.next().text());
		if (afterH1 && afterH1.length < 80 && /[\u4e00-\u9fff]/.test(afterH1)) {
			altTitles.push(afterH1);
		}

		if (/\bStatus\s+Completed\b/i.test(bodyText) || /\bCompleted\b/i.test(bodyText)) {
			const stM = bodyText.match(/Status\s+(Completed|Ongoing|Hiatus)/i);
			if (stM) {
				status =
					/complet/i.test(stM[1])
						? 'Completed'
						: /hiatus/i.test(stM[1])
							? 'Hiatus'
							: 'Ongoing';
			}
		}

		$('a[href*="genres"]').each((_, a) => {
			const n = cleanText($(a).text());
			if (n && n.length < 40 && !genres.includes(n) && !/genre/i.test(n)) {
				genres.push(n);
			}
		});

		if (!authors.length) {
			$('a[href*="/authors/"], a[href*="/author/"]').each((_, a) => {
				const n = cleanText($(a).text());
				if (n && n.length < 80 && !authors.includes(n)) authors.push(n);
			});
		}

		const chapters = this.parseChapterList($, path);

		return {
			id: path,
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

	private parseChapterList($: any, novelPath: string): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		$(`a[href*="${novelPath}/chapters/"]`).each((_: number, el: any) => {
			const href = $(el).attr('href') || '';
			const id = pathOnly(href);
			if (!isChapterPath(id) || seen.has(id)) return;

			const number = parseChapterNumber(id);
			if (number <= 0) return;

			const $row = $(el).closest('.group, li, tr, article');
			const rowText = cleanText(
				($row.length ? $row.text() : '') + ' ' + $(el).parent().parent().text()
			);

			const isLocked = /\bPremium\b|\bLocked\b|\bCoins?\b|🔒|🪙/i.test(rowText);

			let date: string | undefined;
			const dm = rowText.match(
				/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/i
			);
			if (dm) {
				const parsed = Date.parse(dm[1]);
				if (!Number.isNaN(parsed)) date = new Date(parsed).toISOString();
			}

			seen.add(id);
			out.push({
				id,
				title: `Chapter ${number}`,
				number,
				date,
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
		if (!isChapterPath(path)) {
			throw new Error(`Invalid chapter id: ${chapterId}`);
		}

		const number = parseChapterNumber(path);
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const bodySnippet = cleanText($('body').text()).slice(0, 2000);
		if (
			/unlock this chapter|login to read|not enough coins|purchase this chapter/i.test(
				bodySnippet
			)
		) {
			const $chk = $('.chapter-content');
			if (!$chk.length || cleanText($chk.text()).length < 80) {
				throw new Error(`Chapter ${number} is locked on Xianhua Tales`);
			}
		}

		let $content = $('.chapter-content').first();
		if (!$content.length) {
			$content = $('article .prose, article, main').first();
		}
		$content.find('script, style, noscript, nav').remove();

		let raw = $content.text() || '';
		raw = raw.replace(/^\s*Chapter\s+\d+\s*/i, '').trim();

		let content = '';
		if (raw.length > 40) {
			content = raw
				.split(/\n{2,}/)
				.map((p) => cleanText(p))
				.filter((p) => p.length > 0)
				.map((p) => `<p>${escapeHtml(p)}</p>`)
				.join('');
		}

		if (!content || content.length < 40) {
			const parts: string[] = [];
			$content.find('p').each((_: number, el: any) => {
				const t = cleanText($(el).text());
				if (t) parts.push(`<p>${escapeHtml(t)}</p>`);
			});
			content = parts.join('');
		}

		if (!content || content.length < 40) {
			throw new Error(`Chapter ${number} has empty content`);
		}

		// Prev / Next
		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		$('a[href*="/chapters/"]').each((_: number, el: any) => {
			const href = $(el).attr('href') || '';
			const id = pathOnly(href);
			if (!isChapterPath(id)) return;
			const label = cleanText($(el).text());
			if (!prevChapterId && /prev/i.test(label)) prevChapterId = id;
			if (!nextChapterId && /next/i.test(label)) nextChapterId = id;
		});

		if (number > 0) {
			const base = path.replace(/\/chapters\/\d+$/i, '');
			if (!prevChapterId && number > 1) {
				prevChapterId = `${base}/chapters/${number - 1}`;
			}
			if (!nextChapterId) {
				nextChapterId = `${base}/chapters/${number + 1}`;
			}
		}

		return {
			title: `Chapter ${number}`,
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default XianhuaTalesSource;
