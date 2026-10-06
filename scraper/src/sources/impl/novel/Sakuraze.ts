/**
 * Sakuraze (sakuraze.vercel.app) — Supabase-backed novel site
 * Path: scraper/src/sources/impl/novel/Sakuraze.ts
 *
 * Data: public Supabase REST (anon key embedded in frontend bundle)
 *   GET /rest/v1/novels
 *   GET /rest/v1/chapters
 *   GET /rest/v1/novel_genres?select=...,genres(name)
 *
 * URLs (site):
 *   Novel   : /novel/{slug}
 *   Chapter : /novel/{slug}/chapter/{n}
 */
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const PAGE_SIZE = 24;

const SUPABASE_URL = 'https://hlzjslwrhabsxdskinwd.supabase.co';
const SUPABASE_ANON_KEY =
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsempzbHdyaGFic3hkc2tpbndkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE0ODYyNTEsImV4cCI6MjA3NzA2MjI1MX0._xpIADB4jDsXIGp92-sFTQW8KAbli-Lr99ggJ8DRyX8';

type SbNovel = {
	id: string;
	slug: string;
	title: string;
	cover_image?: string | null;
	description?: string | null;
	status?: string | null;
	translation_status?: string | null;
	original_author?: string | null;
	alternative_title?: string | null;
	year_of_release?: number | null;
	country_of_origin?: string | null;
	novel_type?: string | null;
	type?: string | null;
	updated_at?: string | null;
	is_visible?: boolean;
	approval_status?: string | null;
	is_locked?: boolean;
	is_nsfw?: boolean;
	chapters?: Array<{ chapter_number: number }> | null;
};

type SbChapter = {
	id: string;
	novel_id: string;
	title?: string | null;
	chapter_number: number;
	content?: string | null;
	is_premium?: boolean | null;
	coin_cost?: number | null;
	created_at?: string | null;
	updated_at?: string | null;
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

function mapStatus(raw?: string | null, translation?: string | null): string {
	const s = (raw || '').toLowerCase();
	if (s === 'completed' || s === 'complete') return 'Completed';
	if (s === 'hiatus') return 'Hiatus';
	if (s === 'dropped' || s === 'cancelled') return 'Dropped';
	if (s === 'ongoing') return 'Ongoing';
	const t = (translation || '').toLowerCase();
	if (t === 'completed' || t === 'fully translated') return 'Completed';
	if (t === 'in_progress' || t === 'translating') return 'Ongoing';
	return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Ongoing';
}

function formatAuthors(raw?: string | null): string[] {
	if (!raw) return [];
	return raw
		.split(/[,;/|]+/)
		.map((a) => a.trim())
		.filter(Boolean);
}

function isChapterLocked(c: SbChapter): boolean {
	return !!(c.is_premium || (c.coin_cost != null && c.coin_cost > 0));
}

export class SakurazeSource extends BaseSource {
	id = 'sakuraze';
	name = 'Sakuraze';
	baseUrl = 'https://sakuraze.vercel.app';

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'application/json',
		'Accept-Language': 'en-US,en;q=0.9',
		apikey: SUPABASE_ANON_KEY,
		Authorization: `Bearer ${SUPABASE_ANON_KEY}`
	};

	private async sbFetch<T>(pathAndQuery: string, extraHeaders?: Record<string, string>): Promise<T> {
		const url = `${SUPABASE_URL}/rest/v1/${pathAndQuery}`;
		const htmlOrJson = await fetchWithCf(url, {
			headers: {
				...this.headers,
				...extraHeaders,
				Referer: this.baseUrl + '/'
			}
		});
		try {
			return JSON.parse(htmlOrJson) as T;
		} catch {
			throw new Error(`[sakuraze] invalid JSON from ${pathAndQuery}`);
		}
	}

	private mapCard(n: SbNovel): Manga | null {
		if (!n?.slug || !n.title) return null;
		const id = novelPath(n.slug);
		const latest =
			Array.isArray(n.chapters) && n.chapters.length > 0
				? Number(n.chapters[0].chapter_number)
				: undefined;
		const card: Manga = {
			id,
			title: n.title.trim(),
			cover: n.cover_image || '',
			sourceId: this.id,
			type: 'novel',
			status: mapStatus(n.status, n.translation_status),
			lang: 'en',
			updatedAt: n.updated_at ? Date.parse(n.updated_at) : undefined
		};
		if (latest != null && !Number.isNaN(latest)) {
			card.latestChapter = latest;
		}
		return card;
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		const p = Math.max(1, page | 0);
		const from = (p - 1) * PAGE_SIZE;
		const to = from + PAGE_SIZE - 1;
		const rows = await this.sbFetch<SbNovel[]>(
			`novels?select=id,slug,title,cover_image,status,translation_status,updated_at,original_author,chapters(chapter_number)` +
				`&is_visible=eq.true&approval_status=eq.approved` +
				`&order=updated_at.desc` +
				`&chapters.order=chapter_number.desc&chapters.limit=1` +
				`&offset=${from}&limit=${PAGE_SIZE}`,
			{ Range: `${from}-${to}`, Prefer: 'count=exact' }
		);

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
		const from = (p - 1) * PAGE_SIZE;
		const pattern = `*${q.replace(/[%_,]/g, ' ')}*`;

		const rows = await this.sbFetch<SbNovel[]>(
			`novels?select=id,slug,title,cover_image,status,translation_status,updated_at,original_author,alternative_title,chapters(chapter_number)` +
				`&is_visible=eq.true&approval_status=eq.approved` +
				`&or=(title.ilike.${esc(pattern)},alternative_title.ilike.${esc(pattern)},original_author.ilike.${esc(pattern)})` +
				`&order=updated_at.desc` +
				`&chapters.order=chapter_number.desc&chapters.limit=1` +
				`&offset=${from}&limit=${PAGE_SIZE}`
		);

		if (!Array.isArray(rows)) return [];
		const out: Manga[] = [];
		for (const n of rows) {
			const m = this.mapCard(n);
			if (m) out.push(m);
		}
		return out;
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const slug = parseNovelPath(mangaId);

		const novels = await this.sbFetch<SbNovel[]>(
			`novels?select=*` +
				`&slug=eq.${esc(slug)}` +
				`&is_visible=eq.true` +
				`&limit=1`
		);
		const n = Array.isArray(novels) ? novels[0] : null;
		if (!n) throw new Error(`[sakuraze] novel not found: ${slug}`);

		const genresRows = await this.sbFetch<
			Array<{ genre_id: string; genres: { name: string } | null }>
		>(
			`novel_genres?select=genre_id,genres(name)&novel_id=eq.${esc(n.id)}`
		);
		const genres: string[] = [];
		if (Array.isArray(genresRows)) {
			for (const g of genresRows) {
				const name = g?.genres?.name?.trim();
				if (name && !genres.includes(name)) genres.push(name);
			}
		}

		const metaLines: string[] = [];
		if (n.alternative_title?.trim()) {
			metaLines.push(`Alt title: ${n.alternative_title.trim()}`);
		}
		if (n.novel_type || n.type) {
			const t = String(n.novel_type || n.type).replace(/_/g, ' ');
			metaLines.push(`Type: ${t}`);
		}
		if (n.year_of_release) {
			metaLines.push(`Published: ${n.year_of_release}`);
		}
	
		if (n.country_of_origin?.trim()) {
			metaLines.push(`Language: ${n.country_of_origin.trim()}`);
		}

		let description = (n.description || '').trim();
		if (metaLines.length) {
			description = description
				? `${description}\n\n${metaLines.join('\n')}`
				: metaLines.join('\n');
		}

		const chaptersRaw = await this.sbFetch<SbChapter[]>(
			`chapters?select=id,novel_id,title,chapter_number,is_premium,coin_cost,created_at` +
				`&novel_id=eq.${esc(n.id)}` +
				`&order=chapter_number.desc`
		);

		const chapters: Chapter[] = [];
		if (Array.isArray(chaptersRaw)) {
			for (const c of chaptersRaw) {
				const num = Number(c.chapter_number);
				if (Number.isNaN(num)) continue;
				const ch: Chapter = {
					id: chapterPath(n.slug, num),
					title: `Chapter ${num}`,
					number: num,
					date: c.created_at || undefined
				};
				if (isChapterLocked(c)) ch.isLocked = true;
				chapters.push(ch);
			}
		}

		const authors = formatAuthors(n.original_author);

		return {
			id: novelPath(n.slug),
			title: (n.title || slug).trim(),
			cover: n.cover_image || '',
			sourceId: this.id,
			description,
			authors,
			status: mapStatus(n.status, n.translation_status),
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
		if (!parsed) {
			throw new Error(`[sakuraze] invalid chapter id: ${chapterId}`);
		}
		const { slug, num } = parsed;

		const novels = await this.sbFetch<SbNovel[]>(
			`novels?select=id,slug&slug=eq.${esc(slug)}&limit=1`
		);
		const novel = Array.isArray(novels) ? novels[0] : null;
		if (!novel) throw new Error(`[sakuraze] novel not found for chapter: ${slug}`);

		const rows = await this.sbFetch<SbChapter[]>(
			`chapters?select=id,title,chapter_number,content,is_premium,coin_cost,novel_id` +
				`&novel_id=eq.${esc(novel.id)}` +
				`&chapter_number=eq.${num}` +
				`&limit=1`
		);
		const ch = Array.isArray(rows) ? rows[0] : null;
		if (!ch) throw new Error(`[sakuraze] chapter not found: ${slug} #${num}`);

		if (isChapterLocked(ch)) {
			const body = (ch.content || '').replace(/<[^>]+>/g, '').trim();
			if (body.length < 80) {
				throw new Error('Chapter is locked / premium on Sakuraze');
			}
		}

		let content = (ch.content || '').trim();
		if (!content || content.replace(/<[^>]+>/g, '').trim().length < 40) {
			throw new Error('Chapter content empty or locked on Sakuraze');
		}

		const neighbors = await this.sbFetch<
			Array<{ chapter_number: number }>
		>(
			`chapters?select=chapter_number` +
				`&novel_id=eq.${esc(novel.id)}` +
				`&or=(chapter_number.eq.${num - 1},chapter_number.eq.${num + 1})` +
				`&order=chapter_number.asc`
		);
		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		if (Array.isArray(neighbors)) {
			for (const x of neighbors) {
				const n = Number(x.chapter_number);
				if (n === num - 1) prevChapterId = chapterPath(slug, n);
				if (n === num + 1) nextChapterId = chapterPath(slug, n);
			}
		}

		const title = `Chapter ${num}`;

		return {
			title,
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default SakurazeSource;
