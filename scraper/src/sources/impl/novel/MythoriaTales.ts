/**
 * MythoriaTales.com — Next.js SPA + REST API
 * Path: scraper/src/sources/impl/novel/MythoriaTales.ts
 *
 * API (endpoint.mythoriatales.com):
 *   List/Latest : GET /series/public/all?page=1&limit=24&sort=updated
 *   Detail+Chaps: GET /series/public/{slug}?page=1&limit=500
 *
 * Chapter content (server action on frontend):
 *   POST https://www.mythoriatales.com/series/{slug}/chapter/{n}
 *   Header: Next-Action: 6057a758574533cff84d58cadf9a12e5f15a75e6d8
 *   Body:   ["slug", n]
 */
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://www.mythoriatales.com';
const API = 'https://endpoint.mythoriatales.com';
const PER_PAGE = 24;

const CHAPTER_ACTION_ID = '6057a758574533cff84d58cadf9a12e5f15a75e6d8';

type ApiChapter = {
	id: string;
	title?: string;
	chapterNumber: number;
	isPremium?: boolean;
	publishDate?: string;
	priceInCoins?: number;
	content?: string | null;
};

type ApiSeriesBrief = {
	id: string;
	title: string;
	slug: string;
	featuredImage?: string;
	status?: string;
	novelType?: string;
	categories?: string[];
	averageRating?: number;
	recentChapters?: ApiChapter[];
};

type ApiSeriesFull = {
	id: string;
	title: string;
	slug: string;
	author?: string;
	translatorName?: string;
	description?: string;
	featuredImage?: string;
	status?: string;
	novelType?: string;
	originalLanguage?: string;
	categories?: string[];
	averageRating?: number;
	totalChapters?: number;
};

function pathOnly(href: string): string {
	try {
		const u = new URL(
			href.startsWith('http') ? href : `${BASE}${href.startsWith('/') ? '' : '/'}${href}`
		);
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		return href.startsWith('/') ? href.replace(/\/$/, '') || '/' : `/${href}`;
	}
}

function cleanText(s: string): string {
	return (s || '')
		.replace(/\u00a0/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function stripHtml(html: string): string {
	return cleanText(
		(html || '')
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/p>/gi, '\n\n')
			.replace(/<[^>]+>/g, '')
			.replace(/&nbsp;/g, ' ')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
	);
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function mapStatus(s?: string): string {
	const v = (s || '').toLowerCase();
	if (v === 'completed' || v === 'complete') return 'Completed';
	if (v === 'hiatus' || v === 'on_hold' || v === 'on-hold' || v === 'on hold')
		return 'Hiatus';
	if (v === 'dropped') return 'Dropped';
	return 'Ongoing';
}

function formatDate(iso?: string): string | undefined {
	if (!iso) return undefined;
	try {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return undefined;
		return d.toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	} catch {
		return undefined;
	}
}

function seriesId(slug: string): string {
	return `/series/${slug}`;
}

function makeChapterId(slug: string, num: number): string {
	return `/series/${slug}/chapter/${num}`;
}

function parseSeriesId(mangaId: string): string {
	const p = pathOnly(mangaId);
	const m = p.match(/\/series\/([^/]+)/);
	if (m) return m[1];
	return p.replace(/^\//, '').split('/').pop() || p;
}

function parseChapterId(
	chapterId: string
): { slug: string; number: number } | null {
	const p = pathOnly(chapterId);
	const m = p.match(/\/series\/([^/]+)\/chapter\/(\d+(?:\.\d+)?)/i);
	if (!m) return null;
	return { slug: m[1], number: parseFloat(m[2]) };
}

function latestFromRecent(chs?: ApiChapter[]): number | undefined {
	if (!chs?.length) return undefined;
	let max = 0;
	for (const c of chs) {
		const n = Number(c.chapterNumber) || 0;
		if (n > max) max = n;
	}
	return max > 0 ? max : undefined;
}

export class MythoriaTalesSource extends BaseSource {
	id = 'mythoriatales';
	name = 'Mythoria Tales';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'application/json, text/html, */*',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`,
		Origin: BASE
	};

	private async apiGet<T>(path: string): Promise<T> {
		const url = path.startsWith('http') ? path : `${API}${path}`;
		const res = await fetch(url, {
			headers: {
				...this.headers,
				Accept: 'application/json'
			}
		});
		if (!res.ok) {
			const t = await res.text().catch(() => '');
			throw new Error(`Mythoria API ${res.status}: ${t.slice(0, 200)}`);
		}
		return (await res.json()) as T;
	}

	private mapBrief(s: ApiSeriesBrief): Manga {
		const latest = latestFromRecent(s.recentChapters);
		return {
			id: seriesId(s.slug),
			title: cleanText(s.title),
			cover: s.featuredImage || '',
			sourceId: this.id,
			type: 'novel',
			lang: 'en',
			status: mapStatus(s.status),
			...(latest != null ? { latestChapter: latest } : {})
		};
	}

	async getLatestManga(page = 1): Promise<Manga[]> {
		const p = Math.max(1, page);
		try {
			const res = await this.apiGet<{
				success: boolean;
				data: {
					data: ApiSeriesBrief[];
					total?: number;
					page?: number;
					limit?: number;
					totalPages?: number;
				};
			}>(
				`/series/public/all?page=${p}&limit=${PER_PAGE}&sort=updated`
			);

			const items = res.data?.data || [];
			return items
				.filter((s) => s?.slug)
				.map((s) => this.mapBrief(s));
		} catch (e) {
			console.error('[mythoriatales] latest', e);
			return [];
		}
	}

	async searchManga(
		query: string,
		opts?: { page?: number }
	): Promise<Manga[]> {
		const q = (query || '').trim().toLowerCase();
		const page = Math.max(1, opts?.page ?? 1);
		if (!q) return this.getLatestManga(page);

		try {
			const hits: Manga[] = [];
			const seen = new Set<string>();
			for (let p = 1; p <= 5 && hits.length < page * PER_PAGE; p++) {
				const res = await this.apiGet<{
					data: { data: ApiSeriesBrief[]; totalPages?: number };
				}>(`/series/public/all?page=${p}&limit=50&sort=updated`);
				const items = res.data?.data || [];
				if (!items.length) break;
				for (const s of items) {
					if (!s?.slug || seen.has(s.slug)) continue;
					const title = cleanText(s.title).toLowerCase();
					if (
						!title.includes(q) &&
						!s.slug.toLowerCase().includes(q.replace(/\s+/g, '-'))
					)
						continue;
					seen.add(s.slug);
					hits.push(this.mapBrief(s));
				}
				if ((res.data?.totalPages || 1) <= p) break;
			}
			const start = (page - 1) * PER_PAGE;
			return hits.slice(start, start + PER_PAGE);
		} catch (e) {
			console.error('[mythoriatales] search', e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = parseSeriesId(mangaId);
		if (!slug) throw new Error('Invalid series id');

		const res = await this.apiGet<{
			success: boolean;
			data: {
				series: ApiSeriesFull;
				chapters: ApiChapter[];
				totalChapters?: number;
				page?: number;
				limit?: number;
				totalPages?: number;
			};
		}>(`/series/public/${encodeURIComponent(slug)}?page=1&limit=500`);

		const series = res.data?.series;
		if (!series?.slug) throw new Error('Series not found');

		let chaptersRaw = res.data.chapters || [];
		const totalPages = res.data.totalPages || 1;
		if (totalPages > 1) {
			for (let page = 2; page <= totalPages; page++) {
				try {
					const more = await this.apiGet<{
						data: { chapters: ApiChapter[] };
					}>(
						`/series/public/${encodeURIComponent(slug)}?page=${page}&limit=100`
					);
					chaptersRaw = chaptersRaw.concat(more.data?.chapters || []);
				} catch {
					break;
				}
			}
		}

		const seen = new Set<string>();
		const chapters: Chapter[] = [];
		for (const c of chaptersRaw) {
			const num = Number(c.chapterNumber);
			if (!num || Number.isNaN(num)) continue;
			const id = makeChapterId(series.slug, num);
			if (seen.has(id)) continue;
			seen.add(id);
			const ch: Chapter = {
				id,
				title: `Chapter ${num}`,
				number: num,
				date: formatDate(c.publishDate)
			};
			if (c.isPremium) ch.isLocked = true;
			chapters.push(ch);
		}
		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const authors: string[] = [];
		if (series.author) authors.push(cleanText(series.author));

		const genres = (series.categories || []).filter(
			(g, i, arr) => g && arr.indexOf(g) === i
		);

		let description = stripHtml(series.description || '');
		if (description.length > 4000)
			description = description.slice(0, 4000) + '…';

		const details: MangaDetails = {
			id: seriesId(series.slug),
			title: cleanText(series.title),
			cover: series.featuredImage || '',
			sourceId: this.id,
			description,
			authors,
			status: mapStatus(series.status),
			genres,
			chapters,
			type: series.novelType || 'novel',
			lang: 'en'
		};

		const extra = details as MangaDetails & {
			rating?: string;
			translator?: string;
		};
		if (series.averageRating && series.averageRating > 0) {
			extra.rating = String(series.averageRating);
		}
		if (series.translatorName) extra.translator = series.translatorName;

		return details;
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
		const parsed = parseChapterId(chapterId);
		if (!parsed) throw new Error('Invalid chapter id');

		const pageUrl = `${BASE}/series/${parsed.slug}/chapter/${parsed.number}`;
		const body = JSON.stringify([parsed.slug, parsed.number]);

		let raw = '';
		try {
			const res = await fetch(pageUrl, {
				method: 'POST',
				headers: {
					...this.headers,
					'Content-Type': 'text/plain;charset=UTF-8',
					'Next-Action': CHAPTER_ACTION_ID,
					Accept: 'text/x-component',
					Referer: pageUrl
				},
				body
			});
			raw = await res.text();
		} catch (e) {
			console.error('[mythoriatales] chapter action', e);
		}

		let contentText = '';
		let isPremium = false;
		let chapterTitle = `Chapter ${parsed.number}`;
		let prevNum: number | null = null;
		let nextNum: number | null = null;

		const jsonMatch = raw.match(/\d+:(\{"success":true[\s\S]*)$/m);
		if (jsonMatch) {
			try {
				let jsonStr = jsonMatch[1];
				const lastBrace = jsonStr.lastIndexOf('}');
				if (lastBrace > 0) jsonStr = jsonStr.slice(0, lastBrace + 1);
				const obj = JSON.parse(jsonStr) as {
					success: boolean;
					data?: {
						chapter?: ApiChapter & { content?: string };
						prevChapter?: { chapterNumber: number };
						nextChapter?: { chapterNumber: number };
					};
				};
				const ch = obj.data?.chapter;
				if (ch) {
					isPremium = !!ch.isPremium;
					if (ch.chapterNumber != null)
						chapterTitle = `Chapter ${ch.chapterNumber}`;
					if (obj.data?.prevChapter?.chapterNumber != null)
						prevNum = obj.data.prevChapter.chapterNumber;
					if (obj.data?.nextChapter?.chapterNumber != null)
						nextNum = obj.data.nextChapter.chapterNumber;
				}
			} catch {
			}
		}

		const textMatch = raw.match(/\d+:T\d+,([\s\S]*?)(?=\n\d+:\{|\n\d+:T|\Z)/);
		if (textMatch) {
			contentText = textMatch[1].trim();
			const cut = contentText.search(/\d+:\{"success"/);
			if (cut > 0) contentText = contentText.slice(0, cut).trim();
			const cut2 = contentText.search(/1:\{"success"/);
			if (cut2 > 0) contentText = contentText.slice(0, cut2).trim();
		}

		if (isPremium && !contentText) {
			return {
				title: chapterTitle,
				content:
					'<p><em>This chapter is locked (premium / coins). Read it on Mythoria Tales.</em></p>',
				prevChapterId:
					prevNum != null
						? makeChapterId(parsed.slug, prevNum)
						: parsed.number > 1
							? makeChapterId(parsed.slug, parsed.number - 1)
							: null,
				nextChapterId:
					nextNum != null
						? makeChapterId(parsed.slug, nextNum)
						: makeChapterId(parsed.slug, parsed.number + 1)
			};
		}

		if (!contentText) {
			return {
				title: chapterTitle,
				content:
					'<p><em>Empty content — chapter may be locked or selector changed.</em></p>',
				prevChapterId:
					parsed.number > 1
						? makeChapterId(parsed.slug, parsed.number - 1)
						: null,
				nextChapterId: makeChapterId(parsed.slug, parsed.number + 1)
			};
		}

		const paragraphs = contentText
			.split(/\n{2,}/)
			.map((p) => cleanText(p))
			.filter((p) => p.length > 0);

		const html =
			paragraphs.length > 0
				? paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')
				: `<p>${escapeHtml(contentText)}</p>`;

		return {
			title: chapterTitle,
			content: html,
			prevChapterId:
				prevNum != null
					? makeChapterId(parsed.slug, prevNum)
					: parsed.number > 1
						? makeChapterId(parsed.slug, parsed.number - 1)
						: null,
			nextChapterId:
				nextNum != null
					? makeChapterId(parsed.slug, nextNum)
					: makeChapterId(parsed.slug, parsed.number + 1)
		};
	}
}

export default MythoriaTalesSource;
