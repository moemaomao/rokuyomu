/**
 * Ophelia Scans (opheliascans.com) — Next.js novel site
 * Path: scraper/src/sources/impl/novel/OpheliaScans.ts
 *
 * - Latest: /api/manga-list sorted by latestUpdatedAtTimestamp
 * - Detail: manga-list item + /novel/{slug} chapter links
 * - Locked: /api/locked-chapters?mangaId= + "50c" on page
 * - Content: RSC document.blocks paragraphs /novel/{slug}/{n}
 * - Cover: /api/cover/{slug}/cover
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://opheliascans.com';
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

function decodeFlightString(s: string): string {
	try {
		return JSON.parse(`"${s.replace(/"/g, '\\"')}"`);
	} catch {
		try {
			return s
				.replace(/\\n/g, '\n')
				.replace(/\\r/g, '')
				.replace(/\\t/g, '\t')
				.replace(/\\"/g, '"')
				.replace(/\\\\/g, '\\')
				.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
					String.fromCharCode(parseInt(h, 16))
				);
		} catch {
			return s;
		}
	}
}

export class OpheliaScansSource extends BaseSource {
	id = 'opheliascans';
	name = 'OpheliaScans';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'application/json, text/html, */*',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	private listCache: any[] | null = null;

	private async apiGet(path: string): Promise<any> {
		const p = path.startsWith('/') ? path : `/${path}`;
		const text = await this.fetchHtml(p);
		return JSON.parse(text);
	}

	private async loadMangaList(): Promise<any[]> {
		if (this.listCache) return this.listCache;
		const data = await this.apiGet('/api/manga-list?limit=2000');
		const list = Array.isArray(data) ? data : [];
		this.listCache = list.filter(
			(x) =>
				!x.type ||
				String(x.type).toLowerCase() === 'novel' ||
				String(x.contentKind).toLowerCase() === 'novel'
		);
		return this.listCache;
	}

	private mapCard(item: any): Manga {
		const slug = String(item.id || '');
		const cover = absUrl(item.cover || `/api/cover/${slug}/cover`);
		const latestChapter =
			typeof item.chapters === 'number' ? item.chapters : undefined;
		const st = String(item.status || '').toLowerCase();
		let status: string | undefined;
		if (/complet|finish|end/.test(st)) status = 'Completed';
		else if (/hiatus/.test(st)) status = 'Hiatus';
		else if (/hot|ongoing|new/.test(st)) status = 'Ongoing';

		return {
			id: `/novel/${slug}`,
			title: cleanText(item.title || slug),
			cover,
			sourceId: this.id,
			type: 'novel',
			status,
			lang: 'en',
			...(latestChapter != null ? { latestChapter } : {})
		};
	}

	// ─── Latest (sorted by latestUpdatedAtTimestamp) ─────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		const pageNum = Math.max(1, page);
		try {
			const list = await this.loadMangaList();
			const sorted = [...list].sort(
				(a, b) =>
					(b.latestUpdatedAtTimestamp || 0) -
					(a.latestUpdatedAtTimestamp || 0)
			);
			const offset = (pageNum - 1) * PER_PAGE;
			return sorted.slice(offset, offset + PER_PAGE).map((x) => this.mapCard(x));
		} catch (e) {
			console.error('[opheliascans] getLatestManga', e);
			return [];
		}
	}

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim().toLowerCase();
		const page = Math.max(1, opts?.page ?? 1);
		if (!q) return this.getLatestManga(page);

		const list = await this.loadMangaList();
		const matched = list.filter((x) => {
			const title = String(x.title || '').toLowerCase();
			const id = String(x.id || '').toLowerCase();
			const author = String(x.author || '').toLowerCase();
			return title.includes(q) || id.includes(q) || author.includes(q);
		});
		const offset = (page - 1) * PER_PAGE;
		return matched.slice(offset, offset + PER_PAGE).map((x) => this.mapCard(x));
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) throw new Error(`Invalid novel id: ${mangaId}`);

		const list = await this.loadMangaList();
		const item = list.find((x) => String(x.id) === slug);
		if (!item) throw new Error(`Novel not found: ${slug}`);

		const cover = absUrl(item.cover || `/api/cover/${slug}/cover`);
		const authors: string[] = [];
		if (item.author && cleanText(item.author)) authors.push(cleanText(item.author));

		const genres: string[] = Array.isArray(item.genres)
			? item.genres.map((g: any) => cleanText(String(g))).filter(Boolean)
			: [];

		let status = 'Ongoing';
		const st = String(item.status || '').toLowerCase();
		if (/complet|finish|end/.test(st)) status = 'Completed';
		else if (/hiatus/.test(st)) status = 'Hiatus';

		const description = cleanText(item.description || '').slice(0, 4000);

		let lockedSet = new Set<number>();
		try {
			const locked = await this.apiGet(
				`/api/locked-chapters?mangaId=${encodeURIComponent(slug)}`
			);
			const chs = locked?.chapters;
			if (chs && typeof chs === 'object') {
				for (const k of Object.keys(chs)) {
					const n = parseInt(k, 10);
					if (!Number.isNaN(n)) lockedSet.add(n);
					// also values may be chapter numbers
					const v = chs[k];
					if (typeof v === 'number') lockedSet.add(v);
					if (typeof v === 'string' && /^\d+$/.test(v)) lockedSet.add(parseInt(v, 10));
				}
			}
		} catch {
		}

		const chapters = await this.parseChapterList(slug, item, lockedSet);

		return {
			id: `/novel/${slug}`,
			title: cleanText(item.title || slug),
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

	private extractSlug(mangaId: string): string {
		const id = String(mangaId || '').replace(/\/$/, '');
		const m = id.match(/\/novel\/([^/]+)/i) || id.match(/^([^/]+)$/);
		return m ? decodeURIComponent(m[1]) : '';
	}

	private async parseChapterList(
		slug: string,
		item: any,
		lockedSet: Set<number>
	): Promise<Chapter[]> {
		const out: Chapter[] = [];
		const seen = new Set<number>();

		try {
			const html = await this.fetchHtml(`/novel/${slug}`);
			const $ = cheerio.load(html);
			const nums: number[] = [];
			$(`a[href*="/novel/${slug}/"]`).each((_, el) => {
				const href = $(el).attr('href') || '';
				const m = href.match(new RegExp(`/novel/${slug}/(\\d+)`, 'i'));
				if (!m) return;
				const n = parseInt(m[1], 10);
				if (Number.isNaN(n)) return;
				nums.push(n);
				// Detect coin/lock near link
				const rowText = cleanText($(el).parent().text() + ' ' + $(el).text());
				if (/\d+\s*c\b|coin|locked|premium|paid/i.test(rowText)) {
					lockedSet.add(n);
				}
			});

			const re = new RegExp(`/novel/${slug}/(\\d+)[^"]*"[^>]*>[^<]*(?:\\d+c|NEW)?`, 'gi');
			let mm: RegExpExecArray | null;
			const htmlLower = html;
			while ((mm = re.exec(htmlLower))) {
				const n = parseInt(mm[1], 10);
				if (!Number.isNaN(n)) nums.push(n);
			}
	
			const paidRe = new RegExp(
				`/novel/${slug}/(\\d+)[\\s\\S]{0,80}?(\\d+)\\s*c\\b`,
				'gi'
			);
			while ((mm = paidRe.exec(html))) {
				const n = parseInt(mm[1], 10);
				if (!Number.isNaN(n)) lockedSet.add(n);
			}

			for (const n of nums) {
				if (seen.has(n)) continue;
				seen.add(n);
				out.push({
					id: `/novel/${slug}/${n}`,
					title: `Chapter ${n}`,
					number: n,
					isLocked: lockedSet.has(n)
				});
			}
		} catch (e) {
			console.error('[opheliascans] parseChapterList html', e);
		}

		if (out.length < 1) {
			const total = typeof item.chapters === 'number' ? item.chapters : 0;
			for (let i = total; i >= 1; i--) {
				out.push({
					id: `/novel/${slug}/${i}`,
					title: `Chapter ${i}`,
					number: i,
					isLocked: lockedSet.has(i)
				});
			}
		}

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
		const m = String(chapterId).match(/\/novel\/([^/]+)\/(\d+)/i);
		if (!m) throw new Error(`Invalid chapter id: ${chapterId}`);
		const slug = decodeURIComponent(m[1]);
		const number = parseInt(m[2], 10);
		const html = await this.fetchHtml(`/novel/${slug}/${number}`);

		if (
			/unlock this chapter|purchase|not enough coins|login to (read|unlock)/i.test(
				html
			) &&
			!/document"\s*:\s*\{\s*"blocks"/i.test(html)
		) {
		}

		const paragraphs = this.extractParagraphs(html);
		if (paragraphs.length < 1) {
			throw new Error(
				`Chapter ${number} empty or locked on Ophelia Scans`
			);
		}

		const content = paragraphs
			.map((p) => `<p>${escapeHtml(p)}</p>`)
			.join('');

		return {
			title: `Chapter ${number}`,
			content,
			prevChapterId: number > 1 ? `/novel/${slug}/${number - 1}` : null,
			nextChapterId: `/novel/${slug}/${number + 1}`
		};
	}

	private extractParagraphs(html: string): string[] {
		const out: string[] = [];

		const blockRe =
			/"kind"\s*:\s*"paragraph"\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
		let mm: RegExpExecArray | null;
		while ((mm = blockRe.exec(html))) {
			const raw = mm[1];
			let text = raw;
			try {
				text = JSON.parse(`"${raw}"`);
			} catch {
				text = decodeFlightString(raw);
			}
			text = cleanText(text);
			if (text.length > 0) out.push(text);
		}
		if (out.length >= 2) return out;

		const $ = cheerio.load(html);
		$('script, style, noscript, nav, header, footer').remove();
		const candidates: string[] = [];
		$('article p, main p, .prose p, [class*="chapter"] p, [class*="content"] p').each(
			(_, el) => {
				const t = cleanText($(el).text());
				if (t.length > 20) candidates.push(t);
			}
		);
		if (candidates.length >= 2) return candidates;

		$('p').each((_, el) => {
			const t = cleanText($(el).text());
			if (t.length > 40) candidates.push(t);
		});
		return candidates;
	}
}

export default OpheliaScansSource;
