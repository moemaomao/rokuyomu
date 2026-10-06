/**
 * Eastern Wordsmith (easternwordsmith.com) — custom novel site + Cloudflare
 * Path: scraper/src/sources/impl/novel/EasternWordsmith.ts
 *
 * URLs:
 *   Home / Latest : /  (section "Latest Updates")
 *   All novels    : /novels
 *   Updates feed  : /updates
 *   Novel detail  : /novel/{Title With Spaces}
 *   Chapter       : /chapter/{numericId}
 *   Cover         : /novel-image/{id}
 *
 * Notes:
 *   - Homepage "Latest Updates" ≈ 10 series; we merge with /novels + /updates
 *     and always return up to PAGE_SIZE (24) unique titles per page.
 *   - Chapter list titles are cleaned to "Chapter {n}" (no subtitle).
 *   - Paywalled chapters: fa-lock / lock icon near the chapter link → isLocked.
 *   - Uses fetchWithCf (Byparr) because the site is behind Cloudflare.
 */
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { BaseSource } from '../BaseSource';
import { fetchWithCf } from '../../fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../types-manga';

const PAGE_SIZE = 24;
const BASE = 'https://easternwordsmith.com';

function absUrl(href: string | undefined): string {
	if (!href) return '';
	let h = href.trim();
	// strip wayback prefixes if any leak in
	h = h.replace(/^https?:\/\/web\.archive\.org\/web\/\d+(?:id_|im_)?\//i, '');
	if (h.startsWith('//')) return `https:${h}`;
	if (h.startsWith('http')) return h;
	try {
		return new URL(h, BASE).href;
	} catch {
		return h.startsWith('/') ? `${BASE}${h}` : `${BASE}/${h}`;
	}
}

/** Path only, keep encoded spaces; drop trailing slash (except root). */
function pathOnly(href: string): string {
	try {
		const u = new URL(absUrl(href));
		let p = u.pathname || '/';
		if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
		return p || '/';
	} catch {
		const p = href.startsWith('/') ? href : `/${href}`;
		return p.replace(/\/$/, '') || '/';
	}
}

function decodeEntities(s: string): string {
	return (s || '')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#039;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function stripHtml(html: string): string {
	return decodeEntities(
		html
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/p>/gi, '\n\n')
			.replace(/<[^>]+>/g, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function parseChapterNumber(text: string, fallback = 0): number {
	const t = (text || '').replace(/\s+/g, ' ').trim();
	// "Chapter 38: Judy (4)" / "Chapter v1 c1-4" / "Ch. 12"
	const patterns = [
		/(?:chapter|ch\.?)\s*v?\d*\s*c?(\d+(?:\.\d+)?)/i,
		/(?:chapter|ch\.?)\s*[.\-_]?\s*(\d+(?:\.\d+)?)/i,
		/\/chapter\/(\d+)(?:\/|$)/i,
		/\b(\d+(?:\.\d+)?)\b/
	];
	for (const re of patterns) {
		const m = t.match(re);
		if (m) {
			const n = parseFloat(m[1]);
			if (!Number.isNaN(n) && n > 0) return n;
		}
	}
	return fallback;
}

/** Clean chapter label — number only, no subtitle. */
function shortChapterTitle(number: number, raw?: string): string {
	if (number > 0) {
		return Number.isInteger(number) ? `Chapter ${number}` : `Chapter ${number}`;
	}
	const n = parseChapterNumber(raw || '', 0);
	return n > 0 ? `Chapter ${n}` : 'Chapter';
}

function isNovelPath(path: string): boolean {
	return /^\/novel\/.+/i.test(path) && !/\/chapter\//i.test(path);
}

function isChapterPath(path: string): boolean {
	return /^\/chapter\/\d+/i.test(path);
}

function normalizeCover(src: string | undefined): string {
	if (!src) return '';
	let s = absUrl(src);
	// prefer live host
	s = s.replace(
		/^https?:\/\/web\.archive\.org\/web\/\d+im_\//i,
		''
	);
	if (s.includes('No-Image') || s.includes('No_image') || s.includes('no-image')) {
		return '';
	}
	return s;
}

export class EasternWordsmithSource extends BaseSource {
	id = 'easternwordsmith';
	name = 'Eastern Wordsmith';
	baseUrl = BASE;
	kind = 'novel' as const;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: BASE + '/'
	};

	/** Override: always go through fetchWithCf (CF challenge). */
	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
		return fetchWithCf(url, {
			headers: {
				...this.headers,
				Referer: this.baseUrl + '/'
			}
		});
	}

	// ─── List parsers ────────────────────────────────────────────────────

	/** Parse series cards from homepage Latest Updates / updates / novels. */
	private parseSeriesCards($: cheerio.CheerioAPI): Manga[] {
		const list: Manga[] = [];
		const seen = new Set<string>();

		const push = (path: string, title: string, cover: string, latest?: number) => {
			if (!isNovelPath(path)) return;
			const key = decodeURIComponent(path).toLowerCase();
			if (seen.has(key)) return;
			seen.add(key);
			const t = decodeEntities(title).slice(0, 200);
			if (!t) return;
			list.push({
				id: path,
				title: t,
				cover: cover || '',
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				...(latest && latest > 0 ? { latestChapter: latest } : {})
			});
		};

		// Primary: h6.stm.oneliner > a[href*="novel/"] (Latest Updates cards)
		$('h6.stm.oneliner a[href*="novel/"], h6 a[href*="novel/"]').each((_, el) => {
			const a = $(el);
			const href = a.attr('href') || '';
			const path = pathOnly(href);
			if (!isNovelPath(path)) return;

			const title = a.text().replace(/\s+/g, ' ').trim();
			let cover = '';
			let latest = 0;

			const row = a.closest('.row');
			if (row.length) {
				const img =
					row.find('img').first().attr('src') ||
					row.find('img').first().attr('data-src') ||
					'';
				cover = normalizeCover(img);
				const chText =
					row.find('a[href*="chapter/"]').first().text().replace(/\s+/g, ' ').trim() ||
					'';
				latest = parseChapterNumber(chText, 0);
			}
			push(path, title, cover, latest);
		});

		// Fallback: any a[href*="novel/"] with visible title + nearby img
		$('a[href*="novel/"]').each((_, el) => {
			const a = $(el);
			const href = a.attr('href') || '';
			const path = pathOnly(href);
			if (!isNovelPath(path)) return;
			const key = decodeURIComponent(path).toLowerCase();
			if (seen.has(key)) return;

			let title = a.text().replace(/\s+/g, ' ').trim();
			if (!title || title.length < 2) {
				title = a.find('img').attr('alt') || '';
			}
			if (!title || title.length < 2) return;

			let cover = '';
			const img =
				a.find('img').attr('src') ||
				a.find('img').attr('data-src') ||
				a.closest('.row, .col-12, .col-6, .card').find('img').first().attr('src') ||
				'';
			cover = normalizeCover(img);

			let latest = 0;
			const parent = a.closest('.row, .col-12, .col-lg-6');
			const chText =
				parent.find('a[href*="chapter/"]').first().text().replace(/\s+/g, ' ').trim() ||
				'';
			latest = parseChapterNumber(chText, 0);

			push(path, title, cover, latest);
		});

		return list;
	}

	private async collectLatestPool(): Promise<Manga[]> {
		const merged: Manga[] = [];
		const seen = new Set<string>();

		const addAll = (items: Manga[]) => {
			for (const m of items) {
				const key = decodeURIComponent(m.id).toLowerCase();
				if (seen.has(key)) {
					// upgrade cover / latest if missing
					const existing = merged.find(
						(x) => decodeURIComponent(x.id).toLowerCase() === key
					);
					if (existing) {
						if (!existing.cover && m.cover) existing.cover = m.cover;
						if (
							(!existing.latestChapter || existing.latestChapter === 0) &&
							m.latestChapter
						) {
							existing.latestChapter = m.latestChapter;
						}
					}
					continue;
				}
				seen.add(key);
				merged.push(m);
			}
		};

		// 1) Homepage — Latest Updates (priority order)
		try {
			const homeHtml = await this.fetchHtml('/');
			const $home = cheerio.load(homeHtml);
			addAll(this.parseSeriesCards($home));
		} catch (e) {
			console.warn('[easternwordsmith] home failed', e);
		}

		// 2) /updates
		try {
			const upHtml = await this.fetchHtml('/updates');
			const $up = cheerio.load(upHtml);
			addAll(this.parseSeriesCards($up));
		} catch (e) {
			console.warn('[easternwordsmith] updates failed', e);
		}

		// 3) /novels — full catalog
		try {
			const novHtml = await this.fetchHtml('/novels');
			const $nov = cheerio.load(novHtml);
			addAll(this.parseSeriesCards($nov));
		} catch (e) {
			console.warn('[easternwordsmith] novels failed', e);
		}

		return merged;
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		const p = Math.max(1, page || 1);
		const pool = await this.collectLatestPool();
		const start = (p - 1) * PAGE_SIZE;
		const slice = pool.slice(start, start + PAGE_SIZE);

		console.log(
			`[easternwordsmith] latest page=${p} pool=${pool.length} → ${slice.length}`
		);
		return slice;
	}

	async searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page ?? 1);
		if (!q) return this.getLatestManga(page, opts);

		const qLower = q.toLowerCase();
		const pool = await this.collectLatestPool();

		// Client-side filter (site has no reliable public search API in archives)
		let matched = pool.filter((m) => m.title.toLowerCase().includes(qLower));

		// Optional: try server search endpoints
		if (matched.length === 0) {
			const tryUrls = [
				`/?s=${encodeURIComponent(q)}`,
				`/novels?search=${encodeURIComponent(q)}`,
				`/search?q=${encodeURIComponent(q)}`
			];
			for (const path of tryUrls) {
				try {
					const html = await this.fetchHtml(path);
					const $ = cheerio.load(html);
					const found = this.parseSeriesCards($).filter((m) =>
						m.title.toLowerCase().includes(qLower)
					);
					if (found.length) {
						matched = found;
						break;
					}
					// if page returned any novel cards, take them as search results
					const any = this.parseSeriesCards($);
					if (any.length && any.length < pool.length) {
						matched = any;
						break;
					}
				} catch {
					// ignore
				}
			}
		}

		const start = (page - 1) * PAGE_SIZE;
		const slice = matched.slice(start, start + PAGE_SIZE);
		console.log(
			`[easternwordsmith] search "${q}" page=${page} hits=${matched.length} → ${slice.length}`
		);
		return slice;
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		if (!path.startsWith('/novel/')) {
			path = `/novel/${mangaId.replace(/^\/+/, '')}`;
		}
		path = path.replace(/\/$/, '');

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			$('title')
				.first()
				.text()
				.replace(/\s*[|\-–].*$/, '')
				.replace(/\s+/g, ' ')
				.trim() ||
			$('h1, h2, h3').first().text().replace(/\s+/g, ' ').trim() ||
			decodeURIComponent(path.split('/').pop() || 'Unknown');

		let cover = '';
		$('img').each((_, img) => {
			if (cover) return;
			const src = $(img).attr('src') || $(img).attr('data-src') || '';
			if (/novel-image/i.test(src)) {
				cover = normalizeCover(src);
			}
		});
		if (!cover) {
			cover = normalizeCover($('img').first().attr('src'));
		}

		const authors: string[] = [];
		const genres: string[] = [];
		let status = 'Unknown';
		let description = '';
		const altTitles: string[] = [];

		// Metadata rows: col-4 label + col-8 value
		$('.row').each((_, row) => {
			const $row = $(row);
			const label = $row
				.find('.col-4, .col-sm-4, .col-md-4')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.replace(/:/g, '')
				.trim()
				.toLowerCase();
			const value = $row
				.find('.col-8, .col-sm-8, .col-md-8')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			if (!label || !value) return;

			if (label.includes('author') || label.includes('artist') || label.includes('writer')) {
				value.split(/,|\/|&/).forEach((a) => {
					const t = a.trim();
					if (t && !authors.includes(t)) authors.push(t);
				});
			} else if (label.includes('genre') || label.includes('tag')) {
				value.split(/,|\//).forEach((g) => {
					const t = g.trim();
					if (t && !genres.includes(t)) genres.push(t);
				});
			} else if (label.includes('status')) {
				status = value;
			} else if (
				label.includes('alternate') ||
				label.includes('alt') ||
				label.includes('other name')
			) {
				value.split(/,/).forEach((a) => {
					const t = a.trim();
					if (t && t.toLowerCase() !== title.toLowerCase()) altTitles.push(t);
				});
			} else if (label.includes('release') || label.includes('year')) {
				// keep as genre-ish tag if useful
				if (value && !genres.includes(value)) {
					/* skip putting year into genres */
				}
			} else if (label.includes('description') || label.includes('synopsis')) {
				description = value;
			}
		});

		// Description block fallback
		if (!description) {
			const descLabel = $('a, span, div, strong, b')
				.filter((_, el) => /^description|synopsis$/i.test($(el).text().replace(/:/g, '').trim()))
				.first();
			if (descLabel.length) {
				const parent = descLabel.closest('.row');
				if (parent.length) {
					description = parent.find('.col-8, .col-12').last().text().replace(/\s+/g, ' ').trim();
				}
			}
		}
		if (!description) {
			description =
				$('meta[name="description"]').attr('content')?.trim() ||
				$('meta[property="og:description"]').attr('content')?.trim() ||
				'';
		}
		if (description.length > 4000) description = description.slice(0, 4000) + '…';

		// Chapters — prefer scrollable list (.Dscroll) then any chapter links
		const chapters: Chapter[] = [];
		const seenCh = new Set<string>();

		const ingestChapter = (
			href: string,
			rawTitle: string,
			date: string,
			locked: boolean
		) => {
			const id = pathOnly(href);
			if (!isChapterPath(id)) return;
			if (seenCh.has(id)) return;
			seenCh.add(id);

			let number = parseChapterNumber(rawTitle, 0);
			if (number <= 0) number = parseChapterNumber(id, 0);
			if (number <= 0) number = chapters.length + 1;

			chapters.push({
				id,
				title: shortChapterTitle(number, rawTitle),
				number,
				date: date || undefined,
				...(locked ? { isLocked: true } : {})
			});
		};

		const scanChapterAnchors = (root: cheerio.Cheerio<AnyNode>) => {
			root.find('a[href*="chapter/"]').each((_, el) => {
				const a = $(el);
				const href = a.attr('href') || '';
				const rawTitle = a.text().replace(/\s+/g, ' ').trim();
				if (!rawTitle) return;

				// date often in sibling col-4
				let date = '';
				const row = a.closest('.row');
				if (row.length) {
					date =
						row.find('.col-4, .right').last().text().replace(/\s+/g, ' ').trim() ||
						'';
					if (/chapter/i.test(date)) date = '';
				}

				const locked =
					a.find('.fa-lock, .fa-solid.fa-lock, i.fa-lock').length > 0 ||
					row.find('.fa-lock, .fa-solid.fa-lock').length > 0 ||
					/\b(lock|premium|paywall|vip)\b/i.test(a.attr('class') || '') ||
					/\b(lock|premium|paywall|vip)\b/i.test(row.attr('class') || '');

				ingestChapter(href, rawTitle, date, locked);
			});
		};

		const scroll = $('.Dscroll');
		if (scroll.length) scanChapterAnchors(scroll);
		else scanChapterAnchors($.root());

		// Newest first
		chapters.sort((a, b) => b.number - a.number);

		console.log(
			`[easternwordsmith] details ${path} → ${chapters.length} ch (${chapters.filter((c) => c.isLocked).length} locked)`
		);

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
			...(altTitles.length ? { altTitles } : {}),
			...(chapters[0]?.number != null ? { latestChapter: chapters[0].number } : {})
		} as MangaDetails;
	}

	async getChapterPages(_chapterId: string): Promise<string[]> {
		// Novel source — text content via getChapterContent
		return [];
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		let path = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
		if (!path.startsWith('/chapter/')) {
			path = `/chapter/${chapterId.replace(/^\/+/, '')}`;
		}
		path = path.replace(/\/$/, '');

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const pageTitle =
			$('title').first().text().replace(/\s+/g, ' ').trim() || 'Chapter';
		const number = parseChapterNumber(pageTitle, parseChapterNumber(path, 0));
		const title = shortChapterTitle(number, pageTitle);

		// Locked / paywall detection
		const bodyText = $('body').text().toLowerCase();
		const lockedUi =
			$('.fa-lock, .premium-block, .c-blocked-content').length > 0 ||
			/you need to (buy|unlock|login|subscribe)|premium chapter|patreon|not enough coin|members only/i.test(
				bodyText
			);
		if (lockedUi && $('p').length < 3) {
			throw new Error('Chapter is locked / paywalled on Eastern Wordsmith');
		}

		// Remove chrome
		$(
			'script, style, nav, header, footer, iframe, noscript, .navbar, .nav, .ads, .advertisement, #disqus_thread, .disclaimer'
		).remove();

		// Build content from paragraph blocks
		const paragraphs: string[] = [];
		$('p').each((_, p) => {
			const t = $(p).text().replace(/\s+/g, ' ').trim();
			if (!t) return;
			if (/please (enable|disable|turn off)|ad-blocker|ads are our only|disqus|cloudflare/i.test(t))
				return;
			if (t.length < 2) return;
			paragraphs.push(t);
		});

		let content = '';
		if (paragraphs.length >= 2) {
			content = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
		} else {
			// fallback: largest texty div
			let best = '';
			$('div, article, section').each((_, el) => {
				const t = stripHtml($.html(el) || '');
				if (t.length > best.length) best = t;
			});
			content = best
				.split(/\n+/)
				.map((l) => l.trim())
				.filter((l) => l.length > 1)
				.map((l) => `<p>${escapeHtml(l)}</p>`)
				.join('\n');
		}

		if (!content || content.replace(/<[^>]+>/g, '').trim().length < 40) {
			throw new Error('Chapter content empty or locked on Eastern Wordsmith');
		}

		// Prev / Next from on-page links if present
		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		$('a[href*="chapter/"]').each((_, el) => {
			const a = $(el);
			const t = a.text().replace(/\s+/g, ' ').trim().toLowerCase();
			const href = a.attr('href') || '';
			const id = pathOnly(href);
			if (!isChapterPath(id) || id === path) return;
			if (
				t.includes('prev') ||
				t.includes('previous') ||
				t === '«' ||
				t === '‹'
			) {
				prevChapterId = id;
			}
			if (t.includes('next') || t === '»' || t === '›') {
				nextChapterId = id;
			}
		});

		// Numeric neighbor fallback from chapter id sequence (best-effort)
		const curNum = parseInt(path.split('/').pop() || '', 10);
		if (!Number.isNaN(curNum) && curNum > 0) {
			if (!prevChapterId) prevChapterId = `/chapter/${curNum - 1}`;
			if (!nextChapterId) nextChapterId = `/chapter/${curNum + 1}`;
		}

		return {
			title,
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default EasternWordsmithSource;
