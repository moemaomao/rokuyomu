/**
 * DragonholicTranslations.com — WordPress CPT series + chapter (Lumina theme)
 * Path: scraper/src/sources/impl/Dragonholic.ts
 *
 * REST:
 *   GET /wp-json/wp/v2/series?page=&per_page=&orderby=modified&order=desc&search=
 *   GET /wp-json/wp/v2/series/{id}?_embed=1
 *   GET /wp-json/wp/v2/chapter?parent={seriesId}&page=&per_page=&orderby=date&order=desc
 *   GET /wp-json/wp/v2/chapter/{id}
 *
 * Chapter URL: /series/{slug}/chapter-{n}/
 * Novel text → getChapterPages() = []
 */
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types';

const API = 'https://dragonholictranslations.com/wp-json/wp/v2';
const PER_PAGE = 24;
const CH_PER_PAGE = 100;

function absUrl(href: string | undefined): string {
	if (!href) return '';
	if (href.startsWith('//')) return `https:${href}`;
	if (href.startsWith('http')) return href;
	return `https://dragonholictranslations.com${href.startsWith('/') ? '' : '/'}${href}`;
}

function pathOnly(href: string): string {
	try {
		const u = new URL(
			href.startsWith('http')
				? href
				: `https://dragonholictranslations.com${href.startsWith('/') ? '' : '/'}${href}`
		);
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		return href.startsWith('/') ? href : `/${href}`;
	}
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
		.replace(/&nbsp;/g, ' ')
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function stripHtmlKeepP(html: string): string {
	if (!html) return '';
	let s = html
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<style[\s\S]*?<\/style>/gi, '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>/gi, '\n\n')
		.replace(/<\/div>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ');
	s = decodeHtml(s);
	return s
		.split(/\n+/)
		.map((l) => l.trim())
		.filter((l) => l.length > 0)
		.join('\n\n');
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function parseChapterNumber(title: string, fallback: number): number {
	const m =
		title.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i) ||
		title.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function seriesPathFromLink(link: string, slug?: string): string {
	const p = pathOnly(link);
	if (p.includes('/series/')) return p;
	if (slug) return `/series/${slug}`;
	return p;
}

export class DragonholicSource extends BaseSource {
	id = 'dragonholic';
	name = 'Dragonholic';
	baseUrl = 'https://dragonholictranslations.com';

	private async apiGet<T>(path: string): Promise<{ data: T; totalPages: number; total: number }> {
		const url = path.startsWith('http') ? path : `${API}${path.startsWith('/') ? path : `/${path}`}`;
		const res = await fetch(url, {
			headers: {
				...this.headers,
				Accept: 'application/json',
				Referer: this.baseUrl
			}
		});
		if (!res.ok) {
			throw new Error(`API ${url}: ${res.status} ${res.statusText}`);
		}
		const data = (await res.json()) as T;
		const totalPages = parseInt(res.headers.get('X-WP-TotalPages') || '1', 10) || 1;
		const total = parseInt(res.headers.get('X-WP-Total') || '0', 10) || 0;
		return { data, totalPages, total };
	}

	/** Latest chapter number for a series (1 request) */
	private async fetchLatestChapterNum(seriesId: number): Promise<number | undefined> {
		try {
			const { data } = await this.apiGet<any[]>(
				`/chapter?parent=${seriesId}&per_page=1&orderby=date&order=desc&status=publish`
			);
			if (!Array.isArray(data) || !data[0]) return undefined;
			const title = decodeHtml(data[0].title?.rendered || data[0].title || '');
			const n = parseChapterNumber(title, NaN);
			return Number.isNaN(n) ? undefined : n;
		} catch {
			return undefined;
		}
	}

	private mapSeriesItem(item: any, latestChapter?: number | string): Manga | null {
		const title = decodeHtml(item?.title?.rendered || item?.title || '');
		if (!title || title.length < 2) return null;
		const slug = item.slug || '';
		const id = seriesPathFromLink(item.link || '', slug);
		const cover =
			item._embedded?.['wp:featuredmedia']?.[0]?.source_url ||
			item.featured_media_src_url ||
			'';

		let status: string | undefined;
		const terms = item._embedded?.['wp:term'] || [];
		for (const group of terms) {
			if (!Array.isArray(group)) continue;
			for (const t of group) {
				if (t?.taxonomy === 'story-status' && t.name) {
					status = String(t.name);
				}
			}
		}

		const manga: Manga = {
			id,
			title,
			cover: absUrl(cover),
			sourceId: this.id,
			type: 'novel',
			status,
			lang: 'en'
		};
		if (latestChapter != null && latestChapter !== '') {
			manga.latestChapter = latestChapter;
		}
		return manga;
	}

	async getLatestManga(page = 1): Promise<Manga[]> {
		const p = Math.max(1, page);
		const { data } = await this.apiGet<any[]>(
			`/series?page=${p}&per_page=${PER_PAGE}&orderby=modified&order=desc&_embed=1&status=publish`
		);
		if (!Array.isArray(data)) return [];

		const enriched = await Promise.all(
			data.map(async (item) => {
				const latest = item?.id
					? await this.fetchLatestChapterNum(item.id)
					: undefined;
				return this.mapSeriesItem(item, latest);
			})
		);

		const out: Manga[] = [];
		const seen = new Set<string>();
		for (const m of enriched) {
			if (!m || seen.has(m.id)) continue;
			seen.add(m.id);
			out.push(m);
		}
		return out;
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page ?? 1);
		if (!q) return this.getLatestManga(page);

		const { data } = await this.apiGet<any[]>(
			`/series?search=${encodeURIComponent(q)}&page=${page}&per_page=${PER_PAGE}&orderby=relevance&_embed=1&status=publish`
		);
		if (!Array.isArray(data)) return [];

		const enriched = await Promise.all(
			data.map(async (item) => {
				const latest = item?.id
					? await this.fetchLatestChapterNum(item.id)
					: undefined;
				return this.mapSeriesItem(item, latest);
			})
		);

		const out: Manga[] = [];
		const seen = new Set<string>();
		for (const m of enriched) {
			if (!m || seen.has(m.id)) continue;
			seen.add(m.id);
			out.push(m);
		}
		return out;
	}

	private async resolveSeriesId(mangaId: string): Promise<{ id: number; item: any }> {
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		path = path.replace(/\/$/, '');
		const slugMatch = path.match(/\/series\/([^/]+)/);
		const slug = slugMatch ? slugMatch[1] : path.replace(/^\//, '');

		const { data } = await this.apiGet<any[]>(
			`/series?slug=${encodeURIComponent(slug)}&_embed=1&status=publish`
		);
		if (Array.isArray(data) && data[0]?.id) {
			return { id: data[0].id, item: data[0] };
		}

		if (/^\d+$/.test(slug)) {
			const { data: one } = await this.apiGet<any>(`/series/${slug}?_embed=1`);
			if (one?.id) return { id: one.id, item: one };
		}

		throw new Error(`Series not found: ${mangaId}`);
	}

	private async fetchAllChapters(seriesId: number, seriesSlug: string): Promise<Chapter[]> {
		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		let page = 1;
		let totalPages = 1;

		while (page <= totalPages && page <= 50) {
			const { data, totalPages: tp } = await this.apiGet<any[]>(
				`/chapter?parent=${seriesId}&page=${page}&per_page=${CH_PER_PAGE}&orderby=date&order=asc&status=publish`
			);
			totalPages = tp;
			if (!Array.isArray(data) || !data.length) break;

			for (const item of data) {
				const link = item.link || '';
				const id = pathOnly(link) || `/series/${seriesSlug}/${item.slug || ''}`;
				if (seen.has(id)) continue;
				seen.add(id);

				const rawTitle = decodeHtml(item.title?.rendered || item.title || '');
				const num = parseChapterNumber(rawTitle, chapters.length + 1);
				const date =
					typeof item.date === 'string' ? item.date.slice(0, 10) : undefined;

				chapters.push({
					id,
					title: `Chapter ${num}`,
					number: num,
					date
				});
			}
			page++;
		}

		chapters.sort((a, b) => b.number - a.number);
		return chapters;
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const { id: seriesId, item } = await this.resolveSeriesId(mangaId);

		const title = decodeHtml(item.title?.rendered || item.title || '');
		if (!title) throw new Error('Novel not found (empty title)');

		const cover =
			item._embedded?.['wp:featuredmedia']?.[0]?.source_url ||
			item.featured_media_src_url ||
			'';

		let description = stripHtmlKeepP(item.content?.rendered || '');
		if (description.length > 3000) description = description.slice(0, 3000) + '…';

		const authors: string[] = [];
		const genres: string[] = [];
		let status = 'Ongoing';

		const terms = item._embedded?.['wp:term'] || [];
		for (const group of terms) {
			if (!Array.isArray(group)) continue;
			for (const t of group) {
				const tax = t?.taxonomy || '';
				const name = decodeHtml(t?.name || '');
				if (!name) continue;
				if (tax === 'story-status') status = name;
				else if (tax === 'genre' || tax === 'series-tag') {
					if (!genres.includes(name)) genres.push(name);
				} else if (tax === 'series-author' || tax === 'series-artist') {
					if (!authors.includes(name)) authors.push(name);
				}
			}
		}

		const seriesPath = seriesPathFromLink(item.link || '', item.slug);
		const chapters = await this.fetchAllChapters(seriesId, item.slug || '');

		const latestChapter =
			chapters.length > 0 ? chapters[0].number : undefined;

		return {
			id: seriesPath,
			title,
			cover: absUrl(cover),
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters,
			type: 'novel',
			lang: 'en',
			...(latestChapter != null ? { latestChapter } : {})
		};
	}

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	private async resolveChapterItem(chapterId: string): Promise<any> {
		let path = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
		path = path.replace(/\/$/, '');

		const parts = path.split('/').filter(Boolean);
		const chapterSlug = parts[parts.length - 1] || '';
		const seriesSlug = parts.length >= 3 ? parts[1] : '';

		if (chapterSlug) {
			const { data } = await this.apiGet<any[]>(
				`/chapter?slug=${encodeURIComponent(chapterSlug)}&per_page=20&status=publish`
			);
			if (Array.isArray(data) && data.length) {
				const hit =
					data.find((c) => pathOnly(c.link || '') === path) ||
					data.find((c) => seriesSlug && (c.link || '').includes(seriesSlug)) ||
					data[0];
				if (hit?.id) {
					if (!hit.content?.rendered) {
						const { data: full } = await this.apiGet<any>(`/chapter/${hit.id}`);
						return full;
					}
					return hit;
				}
			}
		}

		if (seriesSlug && chapterSlug) {
			const { id: sid } = await this.resolveSeriesId(`/series/${seriesSlug}`);
			const { data } = await this.apiGet<any[]>(
				`/chapter?parent=${sid}&slug=${encodeURIComponent(chapterSlug)}&per_page=5&status=publish`
			);
			if (Array.isArray(data) && data[0]) {
				const hit = data[0];
				if (!hit.content?.rendered) {
					const { data: full } = await this.apiGet<any>(`/chapter/${hit.id}`);
					return full;
				}
				return hit;
			}
		}

		throw new Error(`Chapter not found: ${chapterId}`);
	}

	private async resolveNeighbors(
		parentId: number,
		currentPath: string,
		currentNumber: number
	): Promise<{ prev: string | null; next: string | null }> {
		try {
			
			const list: { path: string; number: number }[] = [];
			let page = 1;
			let totalPages = 1;
			while (page <= totalPages && page <= 50) {
				const { data, totalPages: tp } = await this.apiGet<any[]>(
					`/chapter?parent=${parentId}&page=${page}&per_page=${CH_PER_PAGE}&orderby=date&order=asc&status=publish`
				);
				totalPages = tp;
				if (!Array.isArray(data) || !data.length) break;
				for (const item of data) {
					const p = pathOnly(item.link || '');
					const title = decodeHtml(item.title?.rendered || '');
					const num = parseChapterNumber(title, list.length + 1);
					list.push({ path: p, number: num });
				}
				page++;
			}

			list.sort((a, b) => a.number - b.number);
			let idx = list.findIndex((c) => c.path === currentPath);
			if (idx < 0) {
				idx = list.findIndex((c) => c.number === currentNumber);
			}
			if (idx < 0) return { prev: null, next: null };

			const prev = idx > 0 ? list[idx - 1].path : null;
			const next = idx < list.length - 1 ? list[idx + 1].path : null;
			return { prev, next };
		} catch {
			return { prev: null, next: null };
		}
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		const item = await this.resolveChapterItem(chapterId);
		const title = decodeHtml(item.title?.rendered || item.title || 'Chapter');
		const currentPath = pathOnly(item.link || chapterId);
		const currentNumber = parseChapterNumber(title, 0);

		const plain = stripHtmlKeepP(item.content?.rendered || '');
		const paras = plain
			.split(/\n\n+/)
			.map((p) => p.trim())
			.filter((p) => {
				if (p.length < 10) return false;
				if (/dragonholic|please support|join our discord|table of contents/i.test(p))
					return false;
				return true;
			});

		const contentHtml =
			paras.length > 0
				? paras.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')
				: '<p><em>Konten kosong atau chapter terkunci.</em></p>';

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		const parentId = Number(item.parent);
		if (parentId > 0) {
			const nav = await this.resolveNeighbors(parentId, currentPath, currentNumber);
			prevChapterId = nav.prev;
			nextChapterId = nav.next;
		}

		return {
			title,
			content: contentHtml,
			prevChapterId,
			nextChapterId
		};
	}
}

export default DragonholicSource;
