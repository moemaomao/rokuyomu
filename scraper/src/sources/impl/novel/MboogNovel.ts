/**
 * MboogNovel (mboognovel.com) — Laravel + Inertia.js novel site
 * Path: scraper/src/sources/impl/novel/MboogNovel.ts
 *
 * - Homepage: props.latestUpdatedBooks + props.books (Inertia data-page)
 * - Series: GET /series/{URL-encoded title} → props.book + props.chapitres (full text)
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://mboognovel.com';
const PER_PAGE = 24;

type MbBook = {
	id: string;
	image?: string;
	title?: string;
	statut?: string;
	description?: string;
	created_at?: string;
	updated_at?: string;
	chapitres?: MbChapter[];
};

type MbChapter = {
	id: number | string;
	title?: string;
	chapter_number?: number;
	text?: string;
	book_id?: string;
	created_at?: string;
	updated_at?: string;
};

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

function normalizeStatus(raw: string | undefined): string {
	const v = (raw || '').toLowerCase();
	if (/finish|complet|end|tamat|done/i.test(v)) return 'Completed';
	if (/hiatus|hold/i.test(v)) return 'Hiatus';
	if (/drop|cancel/i.test(v)) return 'Dropped';
	if (/ongoing|updating|active/i.test(v)) return 'Ongoing';
	return raw ? cleanText(raw) : 'Ongoing';
}

/** Series path memakai judul (bukan UUID): /series/{encodeURIComponent(title)} */
function seriesPathFromTitle(title: string): string {
	return `/series/${encodeURIComponent(cleanText(title))}`;
}

function titleFromSeriesPath(path: string): string {
	const m = path.match(/^\/series\/(.+?)(?:\/c\/\d+)?\/?$/);
	if (!m) return '';
	try {
		return decodeURIComponent(m[1]);
	} catch {
		return m[1];
	}
}

function makeChapterId(title: string, number: number): string {
	return `${seriesPathFromTitle(title)}/c/${number}`;
}

function parseChapterId(chapterId: string): { title: string; number: number } | null {
	const m = chapterId.match(/^\/series\/(.+)\/c\/(\d+(?:\.\d+)?)$/);
	if (!m) return null;
	let title = m[1];
	try {
		title = decodeURIComponent(title);
	} catch {
		/* keep */
	}
	return { title, number: parseFloat(m[2]) };
}

/** Parse Inertia data-page JSON dari HTML */
function parseInertia(html: string): any | null {
	const m =
		html.match(/data-page="([^"]+)"/) ||
		html.match(/data-page='([^']+)'/);
	if (!m) return null;
	try {
		const raw = m[1]
			.replace(/&quot;/g, '"')
			.replace(/&#039;/g, "'")
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>');
		return JSON.parse(raw);
	} catch {
		try {
			return JSON.parse(decodeURIComponent(m[1].replace(/\+/g, ' ')));
		} catch {
			return null;
		}
	}
}

function mapBook(b: MbBook, sourceId: string): Manga | null {
	const title = cleanText(b.title || '');
	if (!title) return null;
	const status = normalizeStatus(b.statut);
	return {
		id: seriesPathFromTitle(title),
		title,
		cover: absUrl(b.image || ''),
		sourceId,
		type: 'novel',
		status,
		lang: 'en',
		...(b.updated_at
			? { updatedAt: Math.floor(new Date(b.updated_at).getTime() / 1000) }
			: {})
	};
}

function textToHtml(text: string): string {
	const t = (text || '').replace(/\r\n/g, '\n').trim();
	if (!t) return '';
	// Sudah HTML?
	if (/<p[\s>]|<br\s*\/?>|<div[\s>]/i.test(t)) return t;
	return t
		.split(/\n{2,}/)
		.map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
		.join('');
}

export class MboogNovelSource extends BaseSource {
	id = 'mboognovel';
	name = 'MboogNovel';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	// ─── Latest ──────────────────────────────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		const pageNum = Math.max(1, page);
		// Semua buku ada di homepage /series — tidak ada pagination server
		if (pageNum > 1) return [];

		const html = await this.fetchHtml('/');
		const inertia = parseInertia(html);
		const props = inertia?.props || {};

		const list: Manga[] = [];
		const seen = new Set<string>();

		// Prioritas: latestUpdatedBooks
		const latest: MbBook[] = Array.isArray(props.latestUpdatedBooks)
			? props.latestUpdatedBooks
			: [];
		const books: MbBook[] = Array.isArray(props.books) ? props.books : [];

		for (const b of [...latest, ...books]) {
			const item = mapBook(b, this.id);
			if (!item || seen.has(item.id)) continue;
			seen.add(item.id);
			list.push(item);
		}

		// Fallback cheerio jika inertia gagal
		if (list.length < 4) {
			const $ = cheerio.load(html);
			$('a[href*="/series/"]').each((_, el) => {
				const href = $(el).attr('href') || '';
				const m = href.match(/\/series\/([^/?#]+)/);
				if (!m) return;
				let title = m[1];
				try {
					title = decodeURIComponent(title);
				} catch {
					/* keep */
				}
				title = cleanText(title);
				if (!title || title.length < 2) return;
				const id = seriesPathFromTitle(title);
				if (seen.has(id)) return;
				const img =
					$(el).find('img').attr('src') ||
					$(el).closest('div').find('img').attr('src') ||
					'';
				seen.add(id);
				list.push({
					id,
					title,
					cover: absUrl(img),
					sourceId: this.id,
					type: 'novel',
					lang: 'en'
				});
			});
		}

		return list.slice(0, PER_PAGE);
	}

	// ─── Search (client-side filter — server tidak support query) ─────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim().toLowerCase();
		const page = Math.max(1, opts?.page ?? 1);
		if (page > 1) return [];
		if (!q) return this.getLatestManga(1);

		// Ambil full list dari /series
		const html = await this.fetchHtml('/series');
		const inertia = parseInertia(html);
		const props = inertia?.props || {};
		const books: MbBook[] = [
			...(Array.isArray(props.latestUpdatedBooks) ? props.latestUpdatedBooks : []),
			...(Array.isArray(props.books) ? props.books : [])
		];

		const seen = new Set<string>();
		const list: Manga[] = [];
		for (const b of books) {
			const title = cleanText(b.title || '');
			const desc = cleanText(b.description || '');
			if (!title) continue;
			if (
				!title.toLowerCase().includes(q) &&
				!desc.toLowerCase().includes(q)
			) {
				continue;
			}
			const item = mapBook(b, this.id);
			if (!item || seen.has(item.id)) continue;
			seen.add(item.id);
			list.push(item);
		}
		return list.slice(0, PER_PAGE);
	}

	// ─── Details + chapters ──────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const titleFromId = titleFromSeriesPath(mangaId);
		if (!titleFromId) {
			throw new Error(`Invalid manga id: ${mangaId}`);
		}

		const path = seriesPathFromTitle(titleFromId);
		const html = await this.fetchHtml(path);
		const inertia = parseInertia(html);
		const props = inertia?.props || {};
		const book: MbBook | undefined = props.book;
		const chapitres: MbChapter[] = Array.isArray(props.chapitres)
			? props.chapitres
			: Array.isArray(book?.chapitres)
				? book!.chapitres!
				: [];

		const title = cleanText(book?.title || titleFromId);
		if (!title) throw new Error('Novel not found (empty title)');

		const cover = absUrl(book?.image || '');
		const description = cleanText(book?.description || '').slice(0, 4000);
		const status = normalizeStatus(book?.statut);

		// Tidak ada author/genre di API situs
		const authors: string[] = [];
		const genres: string[] = [];

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		for (const c of chapitres) {
			const num = Number(c.chapter_number);
			if (Number.isNaN(num)) continue;
			const id = makeChapterId(title, num);
			if (seen.has(id)) continue;
			seen.add(id);

			// Title bersih: "Chapter N" (jangan pakai judul episode panjang)
			const chTitle = `Chapter ${num}`;

			chapters.push({
				id,
				title: chTitle,
				number: num,
				date: c.created_at || c.updated_at || undefined,
				isLocked: false
			});
		}

		// Newest first
		chapters.sort((a, b) => b.number - a.number);

		return {
			id: seriesPathFromTitle(title),
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
		const parsed = parseChapterId(chapterId);
		if (!parsed) {
			throw new Error(`Invalid chapter id: ${chapterId}`);
		}
		const { title: bookTitle, number } = parsed;

		// Ambil series page (semua chapter + text ada di props.chapitres)
		const path = seriesPathFromTitle(bookTitle);
		const html = await this.fetchHtml(path);
		const inertia = parseInertia(html);
		const props = inertia?.props || {};
		const chapitres: MbChapter[] = Array.isArray(props.chapitres)
			? props.chapitres
			: Array.isArray(props.book?.chapitres)
				? props.book.chapitres
				: [];

		if (!chapitres.length) {
			throw new Error('No chapters found on series page');
		}

		// Sort by number ascending untuk prev/next
		const sorted = [...chapitres]
			.map((c) => ({
				num: Number(c.chapter_number),
				title: cleanText(c.title || ''),
				text: c.text || ''
			}))
			.filter((c) => !Number.isNaN(c.num))
			.sort((a, b) => a.num - b.num);

		const idx = sorted.findIndex((c) => c.num === number);
		if (idx < 0) {
			throw new Error(`Chapter ${number} not found`);
		}

		const current = sorted[idx];
		const prev = idx > 0 ? sorted[idx - 1] : null;
		const next = idx < sorted.length - 1 ? sorted[idx + 1] : null;

		const content = textToHtml(current.text);
		if (!content || content.length < 20) {
			throw new Error(`Chapter ${number} has empty content`);
		}

		return {
			title: `Chapter ${number}`,
			content,
			prevChapterId: prev ? makeChapterId(bookTitle, prev.num) : null,
			nextChapterId: next ? makeChapterId(bookTitle, next.num) : null
		};
	}
}

export default MboogNovelSource;
