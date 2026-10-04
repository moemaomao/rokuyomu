/**
 * WordExcerpt.com — SPA + Supabase API (novel)
 * Path: scraper/src/sources/impl/novel/WordExcerpt.ts
 *
 * Site is no longer Madara; data comes from Supabase REST:
 *   RPC  POST /rest/v1/rpc/get_latest_chapters_per_novel  { max_novels }
 *   GET  /rest/v1/novels?slug=eq.{slug}&select=*
 *   GET  /rest/v1/chapters?novel_id=eq.{id}&status=eq.published
 *   GET  /rest/v1/chapters?novel_id=eq.{id}&number=eq.{n}&select=...,content
 */

import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const SUPABASE_URL = 'https://debebcxopcfhukeqweco.supabase.co';
const SUPABASE_ANON_KEY =
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlYmViY3hvcGNmaHVrZXF3ZWNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2OTY4NjQsImV4cCI6MjA4NjI3Mjg2NH0._DMgqDOhgT2Z9l4gd0aeCV4dXBARZWRabYDd8__BgEM';

const PAGE_SIZE = 24;

type WeLatestRow = {
	chapter_id?: string;
	chapter_number?: number;
	chapter_title?: string;
	published_at?: string;
	is_free?: boolean;
	novel_id?: string;
	novel_title?: string;
	novel_cover_url?: string;
	novel_author_name?: string;
	novel_genres?: string[];
	novel_slug?: string;
};

type WeNovel = {
	id: string;
	slug: string;
	title: string;
	synopsis?: string | null;
	cover_url?: string | null;
	genres?: string[] | null;
	tags?: string[] | null;
	status?: string | null;
	author_name?: string | null;
	translator?: string | null;
	editor?: string | null;
	publisher?: string | null;
	country_of_origin?: string | null;
	release_year?: number | null;
	content_rating?: string | null;
	chapter_count?: number | null;
	avg_rating?: number | null;
	updated_at?: string | null;
	created_at?: string | null;
};

type WeChapter = {
	id: string;
	novel_id: string;
	number: number;
	title?: string | null;
	content?: string | null;
	is_free?: boolean | null;
	is_nsfw?: boolean | null;
	published_at?: string | null;
	status?: string | null;
	word_count?: number | null;
};

function mapStatus(s?: string | null): string {
	const v = (s || '').toLowerCase();
	if (v === 'completed' || v === 'complete') return 'Completed';
	if (v === 'hiatus') return 'Hiatus';
	if (v === 'dropped') return 'Dropped';
	return 'Ongoing';
}

function novelPath(slug: string): string {
	return `/novel/${slug}`;
}

function chapterPath(slug: string, num: number): string {
	return `/novel/${slug}/chapter/${num}`;
}

function parseNovelId(mangaId: string): { slug?: string; uuid?: string } {
	const raw = mangaId.replace(/^\/+/, '').replace(/\/+$/, '');
	const m = raw.match(/^(?:novel\/)?([^/]+)$/);
	const key = m ? m[1] : raw;
	if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
		return { uuid: key };
	}
	return { slug: key };
}

function parseChapterId(chapterId: string): { slug: string; number: number } | null {
	const raw = chapterId.replace(/^\/+/, '').replace(/\/+$/, '');
	const m = raw.match(/^(?:novel\/)?([^/]+)\/chapter\/(\d+(?:\.\d+)?)$/i);
	if (!m) return null;
	return { slug: m[1], number: parseFloat(m[2]) };
}

function formatDate(iso?: string | null): string | undefined {
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

export class WordExcerptSource extends BaseSource {
	id = 'wordexcerpt';
	name = 'WordExcerpt';
	baseUrl = 'https://wordexcerpt.com';

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'application/json',
		'Accept-Language': 'en-US,en;q=0.9',
		apikey: SUPABASE_ANON_KEY,
		Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
		Referer: 'https://wordexcerpt.com/',
		Origin: 'https://wordexcerpt.com'
	};

	private async sbGet<T>(path: string): Promise<T> {
		const url = path.startsWith('http') ? path : `${SUPABASE_URL}${path}`;
		const res = await fetch(url, {
			headers: { ...this.headers }
		});
		if (!res.ok) {
			const t = await res.text().catch(() => '');
			throw new Error(`WordExcerpt API ${res.status}: ${t.slice(0, 200)}`);
		}
		return (await res.json()) as T;
	}

	private async sbRpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
		const url = `${SUPABASE_URL}/rest/v1/rpc/${fn}`;
		const res = await fetch(url, {
			method: 'POST',
			headers: {
				...this.headers,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(body)
		});
		if (!res.ok) {
			const t = await res.text().catch(() => '');
			throw new Error(`WordExcerpt RPC ${fn} ${res.status}: ${t.slice(0, 200)}`);
		}
		return (await res.json()) as T;
	}

	private async attachSlugs(rows: WeLatestRow[]): Promise<WeLatestRow[]> {
		const missing = rows.filter((r) => r.novel_id && !r.novel_slug).map((r) => r.novel_id!);
		if (!missing.length) return rows;
		const ids = [...new Set(missing)];
		const q = ids.map(encodeURIComponent).join(',');
		try {
			const novels = await this.sbGet<WeNovel[]>(
				`/rest/v1/novels?select=id,slug&id=in.(${q})`
			);
			const map = new Map(novels.map((n) => [n.id, n.slug]));
			return rows.map((r) => ({
				...r,
				novel_slug: r.novel_slug || (r.novel_id ? map.get(r.novel_id) : undefined)
			}));
		} catch {
			return rows;
		}
	}

	private mapLatestRow(r: WeLatestRow): Manga | null {
		const slug = r.novel_slug;
		const title = (r.novel_title || '').replace(/\s+/g, ' ').trim();
		if (!slug || !title) return null;
		return {
			id: novelPath(slug),
			title,
			cover: r.novel_cover_url || '',
			sourceId: this.id,
			type: 'novel',
			lang: 'en',
			status: 'Ongoing',
			...(r.chapter_number != null ? { latestChapter: r.chapter_number } : {}),
			...(r.published_at ? { updatedAt: Date.parse(r.published_at) || undefined } : {})
		};
	}

	async getLatestManga(page = 1): Promise<Manga[]> {
		const p = Math.max(1, page);
		const maxNovels = Math.max(PAGE_SIZE * p, 50);
		let rows = await this.sbRpc<WeLatestRow[]>('get_latest_chapters_per_novel', {
			max_novels: maxNovels
		});
		if (!Array.isArray(rows)) rows = [];
		rows = await this.attachSlugs(rows);

		if (!rows.some((r) => r.novel_slug)) {
			return this.latestFromNovelsTable(p);
		}

		const seen = new Set<string>();
		const list: Manga[] = [];
		for (const r of rows) {
			const m = this.mapLatestRow(r);
			if (!m || seen.has(m.id)) continue;
			seen.add(m.id);
			list.push(m);
		}
		const start = (p - 1) * PAGE_SIZE;
		return list.slice(start, start + PAGE_SIZE);
	}

	private async latestFromNovelsTable(page: number): Promise<Manga[]> {
		const start = (page - 1) * PAGE_SIZE;
		const end = start + PAGE_SIZE - 1;
		const novels = await this.sbGet<WeNovel[]>(
			`/rest/v1/novels?select=id,slug,title,cover_url,status,chapter_count,updated_at&status=neq.draft&order=updated_at.desc&offset=${start}&limit=${PAGE_SIZE}`
		);
		return (novels || [])
			.map((n) => {
				if (!n.slug || !n.title) return null;
				return {
					id: novelPath(n.slug),
					title: n.title.replace(/\s+/g, ' ').trim(),
					cover: n.cover_url || '',
					sourceId: this.id,
					type: 'novel',
					lang: 'en',
					status: mapStatus(n.status),
					...(n.chapter_count != null ? { latestChapter: n.chapter_count } : {}),
					...(n.updated_at ? { updatedAt: Date.parse(n.updated_at) || undefined } : {})
				} as Manga;
			})
			.filter((m): m is Manga => !!m);
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = query.trim();
		if (!q) return [];
		const start = (Math.max(1, page) - 1) * PAGE_SIZE;
		const encoded = encodeURIComponent(`*${q}*`);
		const novels = await this.sbGet<WeNovel[]>(
			`/rest/v1/novels?select=id,slug,title,cover_url,status,chapter_count,updated_at&status=neq.draft&or=(title.ilike.${encoded},slug.ilike.${encoded})&order=updated_at.desc&offset=${start}&limit=${PAGE_SIZE}`
		);
		return (novels || [])
			.map((n) => {
				if (!n.slug || !n.title) return null;
				return {
					id: novelPath(n.slug),
					title: n.title.replace(/\s+/g, ' ').trim(),
					cover: n.cover_url || '',
					sourceId: this.id,
					type: 'novel',
					lang: 'en',
					status: mapStatus(n.status),
					...(n.chapter_count != null ? { latestChapter: n.chapter_count } : {})
				} as Manga;
			})
			.filter((m): m is Manga => !!m);
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const { slug, uuid } = parseNovelId(mangaId);
		let novel: WeNovel | null = null;

		if (uuid) {
			const rows = await this.sbGet<WeNovel[]>(
				`/rest/v1/novels?id=eq.${encodeURIComponent(uuid)}&select=*&limit=1`
			);
			novel = rows?.[0] || null;
		} else if (slug) {
			const rows = await this.sbGet<WeNovel[]>(
				`/rest/v1/novels?slug=eq.${encodeURIComponent(slug)}&select=*&limit=1`
			);
			novel = rows?.[0] || null;
		}

		if (!novel?.id || !novel.slug) {
			throw new Error('Novel not found');
		}

		const title = (novel.title || '').replace(/\s+/g, ' ').trim();
		const description = (novel.synopsis || '').trim();
		const authors: string[] = [];
		if (novel.author_name) authors.push(novel.author_name);

		const genres = [...(novel.genres || []), ...(novel.tags || [])].filter(
			(g, i, arr) => g && arr.indexOf(g) === i
		);

		const chaptersRaw = await this.sbGet<WeChapter[]>(
			`/rest/v1/chapters?novel_id=eq.${encodeURIComponent(novel.id)}&status=eq.published&select=id,number,title,is_free,published_at,status&order=number.desc`
		);

		const chapters: Chapter[] = (chaptersRaw || []).map((c) => {
			const num = Number(c.number);
			const ch: Chapter = {
				id: chapterPath(novel!.slug, num),
				title: `Chapter ${num}`,
				number: num,
				date: formatDate(c.published_at)
			};
			if (c.is_free === false) ch.isLocked = true;
			return ch;
		});

		const details: MangaDetails = {
			id: novelPath(novel.slug),
			title,
			cover: novel.cover_url || '',
			sourceId: this.id,
			description,
			authors,
			status: mapStatus(novel.status),
			genres,
			chapters,
			type: 'novel',
			lang: 'en'
		};

		const extra = details as MangaDetails & {
			artists?: string[];
			altTitles?: string[];
			rating?: string;
			published?: string;
			translator?: string;
		};
		if (novel.translator) extra.translator = novel.translator;
		if (novel.avg_rating && novel.avg_rating > 0) {
			extra.rating = String(novel.avg_rating);
		}
		if (novel.release_year) extra.published = String(novel.release_year);
		else if (novel.created_at) {
			const y = new Date(novel.created_at).getFullYear();
			if (y > 1990) extra.published = String(y);
		}

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
		if (!parsed) {
			throw new Error('Invalid chapter id');
		}

		const novels = await this.sbGet<WeNovel[]>(
			`/rest/v1/novels?slug=eq.${encodeURIComponent(parsed.slug)}&select=id,slug&limit=1`
		);
		const novel = novels?.[0];
		if (!novel?.id) throw new Error('Novel not found for chapter');

		const rows = await this.sbGet<WeChapter[]>(
			`/rest/v1/chapters?novel_id=eq.${encodeURIComponent(novel.id)}&number=eq.${parsed.number}&select=id,number,title,content,is_free,status,published_at&limit=1`
		);
		const ch = rows?.[0];
		if (!ch) throw new Error('Chapter not found');

		const title =
			ch.title && ch.title.trim()
				? `Chapter ${ch.number}: ${ch.title.trim()}`
				: `Chapter ${ch.number}`;

		let content = (ch.content || '').trim();
		if (!content || ch.is_free === false) {
			content =
				content ||
				'<p><em>Chapter locked / content unavailable (VIP or coins required on WordExcerpt).</em></p>';
		}

		const neighbors = await this.sbGet<WeChapter[]>(
			`/rest/v1/chapters?novel_id=eq.${encodeURIComponent(novel.id)}&status=eq.published&select=number&order=number.asc`
		);
		const nums = (neighbors || []).map((c) => Number(c.number)).filter((n) => !Number.isNaN(n));
		const idx = nums.indexOf(parsed.number);
		const prevNum = idx > 0 ? nums[idx - 1] : null;
		const nextNum = idx >= 0 && idx < nums.length - 1 ? nums[idx + 1] : null;

		return {
			title,
			content,
			prevChapterId: prevNum != null ? chapterPath(parsed.slug, prevNum) : null,
			nextChapterId: nextNum != null ? chapterPath(parsed.slug, nextNum) : null
		};
	}
}

export default WordExcerptSource;
