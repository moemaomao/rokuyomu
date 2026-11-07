/**
 * NovelsOcean (novelsocean.com) — Next.js novel site (JSON API)
 * Path: scraper/src/sources/impl/novel/NovelsOcean.ts
 *
 * Endpoints:
 *   GET /api/novels?page=&limit=&search=     → list / search (latest by updatedAt)
 *   GET /api/novels/{slug}                  → detail + chapters (content included)
 *   GET /api/chapters?slug=&page=           → chapter TOC (isLocked, price)
 *
 * URLs:
 *   Novel   : /novel/{slug}
 *   Chapter : /novel/{slug}/chapter/{n}
 */
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const PAGE_SIZE = 24;

type NoNovel = {
	id: string;
	title: string;
	slug: string;
	author?: string | null;
	summary?: string | null;
	coverImage?: string | null;
	language?: string | null;
	totalChapters?: number | null;
	status?: string | null;
	releaseYear?: number | null;
	updatedAt?: string | null;
	createdAt?: string | null;
	genres?: string[] | null;
	rating?: number | null;
	views?: number | null;
	isCompletelyFree?: boolean | null;
	fullPrice?: number | null;
};

type NoChapterMeta = {
	id: string;
	number: number;
	title?: string | null;
	price?: number | null;
	isLocked?: boolean | null;
	createdAt?: string | null;
};

type NoChapterFull = NoChapterMeta & {
	content?: string | null;
};

function esc(s: string): string {
	return encodeURIComponent(s);
}

function novelPath(slug: string): string {
	return `/novel/${slug}`;
}

function chapterPath(slug: string, num: number): string {
	return `/novel/${slug}/chapter/${num}`;
}

function parseNovelPath(mangaId: string): string {
	const m = mangaId.match(/\/novel\/([^/]+)/i);
	if (m) return m[1];
	return mangaId.replace(/^\/+/, '').replace(/\/+$/, '');
}

function parseChapterPath(chapterId: string): { slug: string; num: number } | null {
	const m = chapterId.match(/\/novel\/([^/]+)\/chapter\/(\d+(?:\.\d+)?)/i);
	if (m) return { slug: m[1], num: parseFloat(m[2]) };
	return null;
}

function mapStatus(raw?: string | null): string {
	const s = (raw || '').toUpperCase();
	if (s === 'COMPLETED' || s === 'COMPLETE') return 'Completed';
	if (s === 'HIATUS') return 'Hiatus';
	if (s === 'DROPPED' || s === 'CANCELLED') return 'Dropped';
	if (s === 'ONGOING') return 'Ongoing';
	if (!raw) return 'Ongoing';
	return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function isChapterLocked(c: NoChapterMeta): boolean {
	return !!(c.isLocked || (c.price != null && c.price > 0));
}

export class NovelsOceanSource extends BaseSource {
	id = 'novelsocean';
	name = 'NovelsOcean';
	baseUrl = 'https://novelsocean.com';

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'application/json',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: 'https://novelsocean.com/'
	};

	private async apiFetch<T>(pathAndQuery: string): Promise<T> {
		const path = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
		const url = `${this.baseUrl}${path}`;
		const body = await fetchWithCf(url, {
			headers: {
				...this.headers,
				Referer: this.baseUrl + '/'
			}
		});
		try {
			return JSON.parse(body) as T;
		} catch {
			throw new Error(`[novelsocean] invalid JSON from ${path}`);
		}
	}

	private mapCard(n: NoNovel): Manga | null {
		if (!n?.slug || !n.title) return null;
		const card: Manga = {
			id: novelPath(n.slug),
			title: n.title.trim(),
			cover: n.coverImage || '',
			sourceId: this.id,
			type: 'novel',
			status: mapStatus(n.status),
			lang: 'en',
			updatedAt: n.updatedAt ? Date.parse(n.updatedAt) : undefined
		};
		const latest = Number(n.totalChapters);
		if (!Number.isNaN(latest) && latest > 0) {
			card.latestChapter = latest;
		}
		return card;
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		const p = Math.max(1, page | 0);
		const data = await this.apiFetch<{ novels?: NoNovel[]; total?: number }>(
			`/api/novels?page=${p}&limit=${PAGE_SIZE}`
		);
		const rows = data?.novels;
		if (!Array.isArray(rows)) return [];
		const out: Manga[] = [];
		for (const n of rows) {
			const m = this.mapCard(n);
			if (m) out.push(m);
		}
		return out;
	}

	async searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		if (!q) return this.getLatestManga(opts?.page ?? 1, opts);

		const p = Math.max(1, (opts?.page ?? 1) | 0);
		const data = await this.apiFetch<{ novels?: NoNovel[] }>(
			`/api/novels?page=${p}&limit=${PAGE_SIZE}&search=${esc(q)}`
		);
		const rows = data?.novels;
		if (!Array.isArray(rows)) return [];
		const out: Manga[] = [];
		for (const n of rows) {
			const m = this.mapCard(n);
			if (m) out.push(m);
		}
		return out;
	}

	private async fetchAllChapterMeta(slug: string): Promise<NoChapterMeta[]> {
		const all: NoChapterMeta[] = [];
		let page = 1;
		let totalPages = 1;
		while (page <= totalPages && page <= 50) {
			const data = await this.apiFetch<{
				chapters?: NoChapterMeta[];
				totalPages?: number;
				currentPage?: number;
			}>(`/api/chapters?slug=${esc(slug)}&page=${page}`);
			const chs = data?.chapters;
			if (Array.isArray(chs)) all.push(...chs);
			totalPages = Math.max(1, Number(data?.totalPages) || 1);
			page += 1;
			if (!chs || chs.length === 0) break;
		}
		return all;
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const slug = parseNovelPath(mangaId);

		const detail = await this.apiFetch<{ novel?: NoNovel & { chapters?: NoChapterFull[] } }>(
			`/api/novels/${esc(slug)}`
		);
		const n = detail?.novel;
		if (!n?.slug) throw new Error(`[novelsocean] novel not found: ${slug}`);

		const metaList = await this.fetchAllChapterMeta(slug);
		const lockMap = new Map<number, NoChapterMeta>();
		for (const c of metaList) {
			const num = Number(c.number);
			if (!Number.isNaN(num)) lockMap.set(num, c);
		}

		const chapters: Chapter[] = [];
		const seen = new Set<number>();

		for (const c of metaList) {
			const num = Number(c.number);
			if (Number.isNaN(num) || seen.has(num)) continue;
			seen.add(num);
			const ch: Chapter = {
				id: chapterPath(n.slug, num),
				title: `Chapter ${num}`,
				number: num,
				date: c.createdAt || undefined
			};
			if (isChapterLocked(c)) ch.isLocked = true;
			chapters.push(ch);
		}

		if (chapters.length === 0 && Array.isArray(n.chapters)) {
			for (const c of n.chapters) {
				const num = Number(c.number);
				if (Number.isNaN(num) || seen.has(num)) continue;
				seen.add(num);
				const meta = lockMap.get(num);
				const ch: Chapter = {
					id: chapterPath(n.slug, num),
					title: `Chapter ${num}`,
					number: num,
					date: c.createdAt || meta?.createdAt || undefined
				};
				if (meta && isChapterLocked(meta)) ch.isLocked = true;
				chapters.push(ch);
			}
		}

		chapters.sort((a, b) => b.number - a.number);

		const authors = (n.author || '')
			.split(/[,;/|]+/)
			.map((a) => a.trim())
			.filter(Boolean);

		const genres = Array.isArray(n.genres)
			? n.genres.map((g) => String(g).trim()).filter(Boolean)
			: [];

		const metaLines: string[] = [];
		if (n.language) metaLines.push(`Language: ${n.language}`);
		if (n.releaseYear) metaLines.push(`Published: ${n.releaseYear}`);
		metaLines.push(`Type: novel`);

		let description = (n.summary || '').trim();
		if (metaLines.length) {
			description = description
				? `${description}\n\n${metaLines.join('\n')}`
				: metaLines.join('\n');
		}

		return {
			id: novelPath(n.slug),
			title: (n.title || slug).trim(),
			cover: n.coverImage || '',
			sourceId: this.id,
			description,
			authors,
			status: mapStatus(n.status),
			genres,
			chapters,
			type: 'novel',
			lang: 'en',
			...(chapters[0]?.number != null ? { latestChapter: chapters[0].number } : {})
		};
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
		const parsed = parseChapterPath(chapterId);
		if (!parsed) throw new Error(`[novelsocean] invalid chapter id: ${chapterId}`);
		const { slug, num } = parsed;

		const detail = await this.apiFetch<{ novel?: { slug: string; chapters?: NoChapterFull[] } }>(
			`/api/novels/${esc(slug)}`
		);
		const novel = detail?.novel;
		if (!novel?.chapters?.length) {
			throw new Error(`[novelsocean] novel/chapters not found: ${slug}`);
		}

		const list = novel.chapters;
		const idx = list.findIndex((c) => Number(c.number) === num);
		if (idx < 0) throw new Error(`[novelsocean] chapter not found: ${slug} #${num}`);

		const ch = list[idx];
		const content = (ch.content || '').trim();

		const metaPage = await this.apiFetch<{ chapters?: NoChapterMeta[] }>(
			`/api/chapters?slug=${esc(slug)}&page=1`
		).catch(() => ({ chapters: [] as NoChapterMeta[] }));

		let locked = false;
		const allMeta = await this.fetchAllChapterMeta(slug).catch(() => [] as NoChapterMeta[]);
		const meta = allMeta.find((c) => Number(c.number) === num);
		if (meta && isChapterLocked(meta)) locked = true;

		if (!content || content.replace(/<[^>]+>/g, '').trim().length < 40) {
			if (locked) throw new Error('Chapter is locked / premium on NovelsOcean');
			throw new Error('Chapter content empty or locked on NovelsOcean');
		}

		const prev = list.find((c) => Number(c.number) === num - 1);
		const next = list.find((c) => Number(c.number) === num + 1);

		return {
			title: `Chapter ${num}`,
			content,
			prevChapterId: prev ? chapterPath(slug, Number(prev.number)) : null,
			nextChapterId: next ? chapterPath(slug, Number(next.number)) : null
		};
	}
}

export default NovelsOceanSource;
