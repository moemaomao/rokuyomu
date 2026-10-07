/**
 * MZ Novels (www.mznovels.com) — custom Django site
 * Path: scraper/src/sources/impl/novel/MzNovels.ts
 *
 * - Latest: homepage "Latest Update" (chapter rows → novel)
 * - Novel: /novel/{id}/
 * - Chapter: /novel/{id}/chapter/{n}/
 * - Search: /search/?q=
 * - Cover: /media/novel_images/... or og:image
 * - Chapter title: "Chapter N"
 * - fetchWithCf
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://www.mznovels.com';
const PER_PAGE = 24;

function absUrl(href: string | undefined | null): string {
	if (!href) return '';
	const h = String(href).trim().replace(/\n/g, '');
	if (!h || h === '#') return '';
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
		return (href.startsWith('/') ? href : `/${href}`).replace(/\/$/, '') || '/';
	}
}

function cleanText(s: string): string {
	return (s || '')
		.replace(/\u00a0/g, ' ')
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

function parseChapterNumber(text: string, fallback = 0): number {
	const t = (text || '').replace(/\s+/g, ' ').trim();
	const m =
		t.match(/(?:chapter|ch\.?|c)\s*[.\-:]?\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\/chapter\/(\d+)/i) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function novelIdFromPath(p: string): string | null {
	const m = p.match(/^\/novel\/(\d+)(?:\/|$)/i);
	return m ? `/novel/${m[1]}` : null;
}

function parseRelativeDate(text: string): number | undefined {
	const t = text.toLowerCase();
	const m = t.match(
		/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/
	);
	if (!m) {
		const abs = Date.parse(text);
		return Number.isNaN(abs) ? undefined : abs;
	}
	const n = parseInt(m[1], 10);
	const unit = m[2];
	const mult: Record<string, number> = {
		second: 1e3,
		minute: 6e4,
		hour: 36e5,
		day: 864e5,
		week: 6048e5,
		month: 2592e6,
		year: 31536e6
	};
	return Date.now() - n * (mult[unit] || 0);
}

export class MzNovelsSource extends BaseSource {
	id = 'mznovels';
	name = 'MZ Novels';
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
			console.warn('[mznovels] fetchWithCf fail', String(e).slice(0, 100));
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
			const html = await this.fetchHtml('/');
			const list = this.parseHomeNovels(html);
			console.log(`[mznovels] latest page=${p} n=${list.length}`);
			const start = (p - 1) * PER_PAGE;
			return list.slice(start, start + PER_PAGE);
		} catch (e) {
			console.error('[mznovels] latest', e);
			return [];
		}
	}

	private parseHomeNovels(html: string): Manga[] {
		const $ = cheerio.load(html);
		const ordered: Manga[] = [];
		const seen = new Set<string>();

		const push = (
			id: string,
			title: string,
			cover: string,
			latest?: number,
			updatedAt?: number,
			status?: string
		) => {
			if (seen.has(id) || !title || title.length < 2) return;
			if (/^(see more|start reading|chapter\s*\d+)$/i.test(title)) return;
			seen.add(id);
			ordered.push({
				id,
				title: title.slice(0, 200),
				cover: cover && !/default\.|avatar/i.test(cover) ? cover : '',
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: status || 'Ongoing',
				...(latest != null && latest > 0
					? { latestChapter: Math.floor(latest) }
					: {}),
				...(updatedAt ? { updatedAt } : {})
			});
		};

		$('.novel-update-card-v2, .novel-update-card').each((_, el) => {
			const $card = $(el);
			const $story = $card
				.find('a[href*="/novel/"]')
				.filter((__, a) => {
					const p = pathOnly($(a).attr('href') || '');
					return /^\/novel\/\d+$/i.test(p) && !!cleanText($(a).text());
				})
				.first();
			const href = $story.attr('href') || '';
			const id = novelIdFromPath(pathOnly(href));
			if (!id) return;

			const title = cleanText($story.text());
			if (!title || title.length < 2) return;

			const img = $card.find('img').first();
			const cover = absUrl(
				(
					img.attr('src') ||
					img.attr('data-src') ||
					''
				).split('?')[0]
			);

			let latest = 0;
			let updatedAt: number | undefined;
			$card.find('a[href*="/chapter/"]').each((__, ca) => {
				const n = parseChapterNumber(
					pathOnly($(ca).attr('href') || '') + ' ' + $(ca).text(),
					0
				);
				if (n > latest) latest = n;
			});
			const body = cleanText($card.text());
			const rel = body.match(
				/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/i
			);
			if (rel) updatedAt = parseRelativeDate(rel[0]);

			push(id, title, cover, latest || undefined, updatedAt);
		});

		$('.popular-card, .novel-card, .title-card').each((_, el) => {
			const $card = $(el);
			const $a = $card
				.find('a[href*="/novel/"]')
				.filter((__, a) =>
					/^\/novel\/\d+$/i.test(pathOnly($(a).attr('href') || ''))
				)
				.first();
			const id = novelIdFromPath(pathOnly($a.attr('href') || ''));
			if (!id) return;
			const title =
				cleanText($card.find('h2, h3, h4').first().text()) ||
				cleanText($a.text());
			const img = $card.find('img').first();
			const cover = absUrl(
				(img.attr('src') || img.attr('data-src') || '').split('?')[0]
			);
			push(id, title, cover);
		});

		if (ordered.length < 10) {
			$('a[href*="/novel/"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const p = pathOnly(href);
				const id = novelIdFromPath(p);
				if (!id || /\/chapter\//i.test(p)) return;
				const title = cleanText($(a).text() || $(a).attr('title') || '');
				if (!title || title.length < 3) return;
				if (/^(see more|start reading|chapter\s*\d+)$/i.test(title))
					return;
				const root = $(a).closest('div, article, li, section');
				const cover = absUrl(
					(
						root.find('img').attr('src') ||
						root.find('img').attr('data-src') ||
						$(a).find('img').attr('src') ||
						''
					).split('?')[0]
				);
				push(id, title, cover);
			});
		}

		console.log(`[mznovels] parseHome n=${ordered.length}`);
		return ordered;
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
			const path = `/search/?q=${encodeURIComponent(q)}`;
			const html = await this.fetchHtml(path);
			const list = this.parseSearchResults(html);
			console.log(`[mznovels] search "${q}" n=${list.length}`);
			return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[mznovels] search', e);
			return [];
		}
	}

	private parseSearchResults(html: string): Manga[] {
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('a[href*="/novel/"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const p = pathOnly(href);
			const id = novelIdFromPath(p);
			if (!id || /\/chapter\//i.test(p) || seen.has(id)) return;

			const title = cleanText($(a).text());
			if (!title || title.length < 2 || /^(»|see more)$/i.test(title))
				return;

			const root = $(a).closest('div, article, li, section');
			const cover =
				absUrl(
					(
						root.find('img').attr('src') ||
						root.find('img').attr('data-src') ||
						''
					).split('?')[0]
				) || '';

			let latest: number | undefined;
			root.find('a[href*="/chapter/"]').each((__, ca) => {
				const n = parseChapterNumber(
					pathOnly($(ca).attr('href') || '') +
						' ' +
						$(ca).text(),
					0
				);
				if (n > (latest || 0)) latest = n;
			});

			seen.add(id);
			list.push({
				id,
				title: title.slice(0, 200),
				cover: /default\.|avatar/i.test(cover) ? '' : cover,
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				...(latest ? { latestChapter: latest } : {})
			});
		});

		return list;
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = pathOnly(mangaId);
		const m = path.match(/^\/novel\/(\d+)/i);
		if (!m) throw new Error('Invalid novel id');
		path = `/novel/${m[1]}`;
		const fetchPath = `${path}/`;

		const html = await this.fetchHtml(fetchPath);
		const $ = cheerio.load(html);

		let title =
			cleanText($('h1').first().text()) ||
			cleanText(
				$('meta[property="og:title"]')
					.attr('content')
					?.split(/\s*[|\-–]\s*/)[0] || ''
			);
		title = title.replace(/\s*[|]\s*MZ Novels.*$/i, '').trim();
		if (!title) throw new Error('Novel not found');

		let cover =
			$('img[src*="novel_images"], img[src*="/media/"]').attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = absUrl(String(cover).replace(/\n/g, '').trim().split('?')[0]);
		if (/default\.|avatar/i.test(cover)) cover = '';

		const authors: string[] = [];
		$('a[href*="/profile/"]').each((_, a) => {
			const n = cleanText($(a).text());
			if (n && n.length < 80 && !authors.includes(n)) authors.push(n);
		});
		const origAuthor = cleanText(
			$('body')
				.text()
				.match(/Original Author:\s*([^\n]+)/i)?.[1] || ''
		);
		if (origAuthor && !authors.includes(origAuthor))
			authors.unshift(origAuthor);

		const genres: string[] = [];
		$('a[href*="/genre/"]').each((_, a) => {
			const g = cleanText($(a).text());
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		const bodyText = cleanText($('body').text());
		let status = 'Ongoing';
		if (/\bCompleted\b|\bEnd\b/i.test(bodyText.slice(0, 3000)))
			status = 'Completed';
		else if (/\bOngoing\b/i.test(bodyText.slice(0, 3000))) status = 'Ongoing';
		else if (/\bHiatus\b/i.test(bodyText.slice(0, 3000))) status = 'Hiatus';

		let description = '';
		const sumIdx = bodyText.search(/Summary:\s*/i);
		if (sumIdx >= 0) {
			description = bodyText
				.slice(sumIdx)
				.replace(/^Summary:\s*/i, '')
				.split(/Chapters Reviews|See more|Download/)[0]
				.trim()
				.slice(0, 4000);
		}
		if (description.length < 40) {
			description = cleanText(
				$('meta[property="og:description"]').attr('content') || ''
			);
		}

		const chapters = this.parseChapterList($, path);

		console.log(
			`[mznovels] details ${path} → ${chapters.length} ch`
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
			...(chapters.length
				? { latestChapter: chapters[0]?.number }
				: {})
		};
	}

	private parseChapterList(
		$: cheerio.CheerioAPI,
		novelPath: string
	): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		$(`a[href*="${novelPath}/chapter/"], a[href*="/chapter/"]`).each(
			(_, a) => {
				const href = $(a).attr('href') || '';
				const p = pathOnly(href);
				const m = p.match(/^(\/novel\/\d+)\/chapter\/(\d+)/i);
				if (!m) return;
				if (m[1] !== novelPath) return;
				if (seen.has(p)) return;

				const label = cleanText($(a).text());
				if (/^start reading$/i.test(label)) return;

				const number = parseFloat(m[2]);
				const root = $(a).closest('li, div, tr');
				const row = cleanText(root.text());
				const rel = row.match(
					/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/i
				);
				let date: string | undefined;
				if (rel) {
					const ts = parseRelativeDate(rel[0]);
					if (ts) date = new Date(ts).toISOString();
				}

				seen.add(p);
				out.push({
					id: p,
					title: `Chapter ${number}`,
					number,
					...(date ? { date } : {})
				});
			}
		);

		out.sort((a, b) => b.number - a.number);
		return out;
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
		const m = path.match(/^(\/novel\/\d+)\/chapter\/(\d+)/i);
		if (!m) throw new Error('Invalid chapter id');
		const novelPath = m[1];
		const number = parseFloat(m[2]);
		const fetchPath = path.endsWith('/') ? path : `${path}/`;
		const html = await this.fetchHtml(fetchPath);
		const $ = cheerio.load(html);
		const rawTitle =
			cleanText($('h1').first().text()) ||
			cleanText(
				$('meta[property="og:title"]')
					.attr('content')
					?.split(/\s*[|\-–]\s*/)[0] || ''
			);
		const title = `Chapter ${number}`;

		$(
			'nav, header, footer, script, style, noscript, form, .comments, #comments, aside'
		).remove();

		const parts: string[] = [];
		const pushP = (t: string) => {
			if (!t || t.length < 2) return;
			if (
				/^(author support|share|follow|comments|prev|next|report|download)/i.test(
					t
				)
			)
				return;
			if (/mznovels\.com/i.test(t) && t.length < 60) return;
			if (/^author'?s?\s*note/i.test(t)) return;
			parts.push(`<p>${escapeHtml(t)}</p>`);
		};

		const $main = $('article, .chapter-content, .content, main').first();
		const scope = $main.length ? $main : $('body');
		scope.find('p').each((_, el) => {
			pushP(cleanText($(el).text()));
		});

		if (parts.length < 3) {
			const bodyText = cleanText($('body').text());
			const start = bodyText.indexOf(rawTitle) >= 0
				? bodyText.indexOf(rawTitle) + rawTitle.length
				: 0;
			const chunk = bodyText
				.slice(start)
				.split(/Comments|Author Support|Share Chapter|Author's Note/i)[0];
			chunk.split(/\n+/).forEach((line) => pushP(line.trim()));
		}

		const content =
			parts.length > 0
				? parts.join('\n')
				: '<p><em>Empty content — selector may have changed.</em></p>';

		let prevChapterId: string | null =
			number > 1 ? `${novelPath}/chapter/${number - 1}` : null;
		let nextChapterId: string | null = `${novelPath}/chapter/${number + 1}`;

		$('a[href*="/chapter/"]').each((_, a) => {
			const t = cleanText($(a).text()).toLowerCase();
			const full = pathOnly($(a).attr('href') || '');
			if (!full.includes(novelPath)) return;
			if (/^prev/i.test(t) || t === '←' || t === '<') prevChapterId = full;
			if (/^next/i.test(t) || t === '→' || t === '>') nextChapterId = full;
		});

		console.log(
			`[mznovels] chapter ${path} → ${parts.length}p`
		);

		return { title, content, prevChapterId, nextChapterId };
	}
}

export default MzNovelsSource;
