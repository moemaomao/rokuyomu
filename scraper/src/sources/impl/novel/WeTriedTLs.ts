/**
 * We Tried TLs — https://wetriedtls.com/
 * API: https://api.wetriedtls.com/
 *
 * Path: scraper/src/sources/impl/novel/WeTriedTLs.ts
 *
 *   Latest / list : GET /query?series_type=Novel&orderBy=latest&page=
 *   Series detail : GET /series/{slug}
 *   Chapters      : GET /chapters/{slug}?page=
 *   Chapter body  : GET /chapter/{slug}/{chapter_slug}
 *   Site URL      : /series/{slug}/chapter-{n}
 *
 * Paywall: chapter.price > 0 or public === false → isLocked
 */
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';
import { fetchWithCf } from '../../../lib/fetchWithCf';

const SITE = 'https://wetriedtls.com';
const API = 'https://api.wetriedtls.com';
const PER_PAGE = 24;

function cleanText(s: string): string {
	return (s || '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
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
	const t = (text || '').trim();
	const m =
		t.match(/chapter\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/^(\d+(?:\.\d+)?)$/) ||
		t.match(/(\d+(?:\.\d+)?)/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function htmlToParagraphs(html: string): string {
	if (!html) return '';
	const chunks = html
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|h[1-6]|li)>/gi, '\n\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.split(/\n+/)
		.map((s) => s.replace(/\s+/g, ' ').trim())
		.filter((s) => s.length > 0);

	if (!chunks.length) return '';
	return chunks.map((s) => `<p>${escapeHtml(s)}</p>`).join('\n');
}

type ApiSeriesListItem = {
	id: number;
	title: string;
	series_slug: string;
	thumbnail?: string;
	description?: string;
	status?: string;
	alternative_names?: string;
	series_type?: string;
	rating?: number;
	latest?: string;
	tags?: Array<{ name?: string }>;
	author?: string;
	latest_chapters?: Array<{
		chapter_name?: string;
		chapter_slug?: string;
		index?: string;
		is_paid?: boolean;
	}>;
	free_chapters?: Array<{
		chapter_name?: string;
		chapter_slug?: string;
		index?: string;
	}>;
	paid_chapters?: Array<{
		chapter_name?: string;
		chapter_slug?: string;
		index?: string;
	}>;
};

type ApiChapterRow = {
	id: number;
	chapter_slug: string;
	chapter_name?: string;
	chapter_title?: string;
	index?: string;
	price?: number;
	public?: boolean;
	created_at?: string;
	updated_at?: string;
};

export class WeTriedTLsSource extends BaseSource {
	id = 'wetriedtls';
	name = 'We Tried TLs';
	baseUrl = SITE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'application/json, text/plain, */*',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${SITE}/`,
		Origin: SITE
	};

	private async fetchApi<T>(path: string): Promise<T> {
		const url = path.startsWith('http') ? path : `${API}${path}`;
		const htmlOrJson = await fetchWithCf(url, {
			headers: {
				...this.headers,
				Accept: 'application/json, text/plain, */*',
				Referer: SITE
			}
		});
		try {
			return JSON.parse(htmlOrJson) as T;
		} catch {
			throw new Error(`WeTriedTLs API non-JSON: ${url}`);
		}
	}

	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		return fetchWithCf(url, {
			headers: {
				...this.headers,
				Accept: 'text/html,application/xhtml+xml',
				Referer: this.baseUrl
			}
		});
	}

	async getLatestManga(page = 1): Promise<Manga[]> {
		const p = Math.max(1, page | 0);
		const apiPages = p === 1 ? [1, 2] : [p + 1];
		const all: Manga[] = [];
		const seen = new Set<string>();

		if (p === 1) {
			for (const ap of [1, 2]) {
				const batch = await this.fetchQueryPage(ap);
				for (const m of batch) {
					if (seen.has(m.id)) continue;
					seen.add(m.id);
					all.push(m);
				}
			}
			return all.slice(0, PER_PAGE);
		}

		const batch = await this.fetchQueryPage(p + 1);
		return batch;
	}

	private async fetchQueryPage(apiPage: number): Promise<Manga[]> {
		const path =
			`/query?page_size=12&order=desc&orderBy=latest&series_type=Novel&page=${apiPage}`;
		const res = await this.fetchApi<{ data?: ApiSeriesListItem[] }>(path);
		const rows = res.data || [];
		return rows.map((r) => this.mapListItem(r)).filter(Boolean) as Manga[];
	}

	private mapListItem(r: ApiSeriesListItem): Manga | null {
		if (!r?.series_slug || !r.title) return null;
		const id = `/series/${r.series_slug}`;
		const status = r.status || 'Ongoing';

		let latestChapter: number | undefined;
		const candidates = [
			...(r.latest_chapters || []),
			...(r.paid_chapters || []),
			...(r.free_chapters || [])
		];
		for (const c of candidates) {
			const n =
				parseChapterNumber(c.index || '', 0) ||
				parseChapterNumber(c.chapter_name || c.chapter_slug || '', 0);
			if (n > 0 && (latestChapter == null || n > latestChapter)) latestChapter = n;
		}

		return {
			id,
			title: r.title.slice(0, 200),
			cover: r.thumbnail || '',
			sourceId: this.id,
			type: 'novel',
			lang: 'en',
			status,
			...(latestChapter != null ? { latestChapter } : {})
		};
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page ?? 1);
		if (!q) return this.getLatestManga(page);

		const path =
			`/query?page_size=24&order=desc&orderBy=latest&series_type=Novel&page=${page}&search=${encodeURIComponent(q)}`;
		const res = await this.fetchApi<{ data?: ApiSeriesListItem[] }>(path);
		return (res.data || []).map((r) => this.mapListItem(r)).filter(Boolean) as Manga[];
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		const data = await this.fetchApi<{
			title?: string;
			series_slug?: string;
			thumbnail?: string;
			description?: string;
			status?: string;
			author?: string;
			alternative_names?: string;
			tags?: Array<{ name?: string }>;
			rating?: number;
			first_chapter?: { chapter_slug?: string };
			last_chapter?: { chapter_slug?: string };
		}>(`/series/${encodeURIComponent(slug)}`);

		const title = (data.title || slug).slice(0, 200);
		const cover = data.thumbnail || '';
		const description = cleanText(data.description || '').slice(0, 4000);
		const authors = data.author ? [data.author] : [];
		const genres = (data.tags || [])
			.map((t) => t.name || '')
			.filter((g) => g && g.length < 40);
		const status = data.status || 'Ongoing';

		const altTitles = (data.alternative_names || '')
			.split(/[|,]/)
			.map((s) => s.trim())
			.filter((s) => s && s.length < 120);

		const chapters = await this.collectChapters(slug);

		const details: MangaDetails & {
			altTitles?: string[];
			rating?: string;
		} = {
			id: `/series/${slug}`,
			title,
			cover,
			description,
			authors,
			genres,
			status,
			type: 'novel',
			sourceId: this.id,
			lang: 'en',
			chapters,
			...(chapters.length
				? { latestChapter: chapters[chapters.length - 1].number }
				: {})
		};
		if (altTitles.length) details.altTitles = altTitles;
		if (data.rating != null) details.rating = String(data.rating);
		return details;
	}

	private extractSlug(mangaId: string): string {
		const id = mangaId.replace(/\/$/, '');
		const m = id.match(/\/series\/([^/]+)/);
		if (m) return m[1];
		return id.replace(/^\//, '').replace(/^series\//, '');
	}

	private async collectChapters(slug: string): Promise<Chapter[]> {
		const out: Chapter[] = [];
		const seen = new Set<string>();
		const byNumber = new Map<number, Chapter>();
		let page = 1;
		let lastPage = 1;

		while (page <= lastPage && page <= 80) {
			const res = await this.fetchApi<{
				meta?: { last_page?: number; total?: number };
				data?: ApiChapterRow[];
			}>(`/chapters/${encodeURIComponent(slug)}?page=${page}`);

			lastPage = res.meta?.last_page || 1;
			const rows = res.data || [];
			if (!rows.length) break;

			for (const row of rows) {
				const chSlug = row.chapter_slug || '';
				if (!chSlug) continue;
				const id = `/series/${slug}/${chSlug}`;
				if (seen.has(id)) continue;
				seen.add(id);

				const number =
					parseChapterNumber(row.index || '', 0) ||
					parseChapterNumber(row.chapter_name || chSlug, 0) ||
					0;
				if (!number) continue;

				const isLocked =
					(typeof row.price === 'number' && row.price > 0) ||
					row.public === false;

				const ch: Chapter = {
					id,
					title: `Chapter ${number}`,
					number,
					date: row.created_at || row.updated_at,
					...(isLocked ? { isLocked: false } : {})
				};
				out.push(ch);
				byNumber.set(number, ch);
			}
			page++;
		}

		try {
			const detail = await this.fetchApi<{
				first_chapter?: { chapter_slug?: string };
				last_chapter?: { chapter_slug?: string };
			}>(`/series/${encodeURIComponent(slug)}`);

			const firstN = parseChapterNumber(
				detail.first_chapter?.chapter_slug || '',
				0
			);
			const lastN = parseChapterNumber(
				detail.last_chapter?.chapter_slug || '',
				0
			);

			if (lastN > 0) {
				const start = firstN > 0 ? firstN : 1;
				for (let n = start; n <= lastN; n++) {
					if (byNumber.has(n)) continue;
					const chSlug = `chapter-${n}`;
					const id = `/series/${slug}/${chSlug}`;
					if (seen.has(id)) continue;
					seen.add(id);
					const ch: Chapter = {
						id,
						title: `Chapter ${n}`,
						number: n,
						isLocked: true
					};
					out.push(ch);
					byNumber.set(n, ch);
				}
			}
		} catch (e) {
			console.error('[wetriedtls] fill paid chapters failed', e);
		}

		out.sort((a, b) => (a.number || 0) - (b.number || 0));
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
		const parts = chapterId.replace(/\/$/, '').split('/').filter(Boolean);
		let seriesSlug = '';
		let chapterSlug = '';
		if (parts[0] === 'series' && parts.length >= 3) {
			seriesSlug = parts[1];
			chapterSlug = parts.slice(2).join('/');
		} else if (parts.length >= 2) {
			seriesSlug = parts[0];
			chapterSlug = parts.slice(1).join('/');
		} else {
			throw new Error('Invalid chapter id');
		}

		const data = await this.fetchApi<{
			chapter?: {
				chapter_name?: string;
				chapter_title?: string;
				chapter_content?: string;
				chapter_slug?: string;
				price?: number;
				public?: boolean;
				index?: string;
			};
			previous_chapter?: { chapter_slug?: string; index?: string } | null;
			next_chapter?: { chapter_slug?: string; index?: string } | null;
			previous?: { chapter_slug?: string } | null;
			next?: { chapter_slug?: string } | null;
		}>(
			`/chapter/${encodeURIComponent(seriesSlug)}/${encodeURIComponent(chapterSlug)}`
		);

		const ch = data.chapter;
		if (!ch) throw new Error('Chapter not found');

		if ((typeof ch.price === 'number' && ch.price > 0) || ch.public === false) {
			if (!ch.chapter_content || ch.chapter_content.length < 40) {
				throw new Error('Chapter is locked / paywalled');
			}
		}

		const num = parseChapterNumber(ch.index || ch.chapter_name || chapterSlug, 0);
		const title =
			(num > 0 ? `Chapter ${num}` : ch.chapter_name || 'Chapter') +
			(ch.chapter_title ? ` — ${ch.chapter_title}` : '');

		const content = htmlToParagraphs(ch.chapter_content || '');

		const prevSlug =
			data.previous_chapter?.chapter_slug || data.previous?.chapter_slug || null;
		const nextSlug =
			data.next_chapter?.chapter_slug || data.next?.chapter_slug || null;

		const prevChapterId = prevSlug
			? `/series/${seriesSlug}/${prevSlug}`
			: null;
		const nextChapterId = nextSlug
			? `/series/${seriesSlug}/${nextSlug}`
			: null;

		return {
			title,
			content:
				content ||
				'<p><em>Empty content — chapter may be locked.</em></p>',
			prevChapterId,
			nextChapterId
		};
	}
}

export default WeTriedTLsSource;
