/**
 * Genesis Studio (genesistudio.com) — Next.js + Directus API
 * Path: scraper/src/sources/impl/novel/GenesisStudio.ts
 *
 * - Homepage: /api/chapters/recent (Recently Updated) — unik per novel, max 24
 * - Detail: /api/directus/novels (cache by slug) + /api/directus/novels/by-id/{id}
 * - Chapters: /api/novels-chapter/{novelId}
 * - Content: /api/chapters/{chapterId}/content
 * - Cover: api.genesistudio.com/storage/.../directus/{fileId}.{ext}
 */
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://genesistudio.com';
const API = `${BASE}/api`;
const STORAGE =
	'https://api.genesistudio.com/storage/v1/object/public/directus';
const PER_PAGE = 24;

function coverUrl(fileId: string | null | undefined, filename?: string | null): string {
	if (!fileId) return '';
	const name = filename || `${fileId}.jpg`;
	const file = name.includes('.') ? name : `${fileId}.jpg`;
	return `${STORAGE}/${file}`;
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

function textToHtml(text: string): string {
	const t = (text || '').trim();
	if (!t) return '';
	if (/<p|<br|<div/i.test(t)) return t;
	return t
		.split(/\n{2,}/)
		.map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br/>')}</p>`)
		.join('');
}

export class GenesisStudioSource extends BaseSource {
	id = 'genesistudio';
	name = 'GenesisStudio';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'application/json, text/plain, */*',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`,
		Origin: BASE
	};

	private novelsCache: any[] | null = null;
	private novelsBySlug = new Map<string, any>();
	private novelsById = new Map<string, any>();

	private async apiGet(apiPath: string): Promise<any> {
		const path = apiPath.startsWith('/api') ? apiPath : `/api${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`;
		try {
			const text = await this.fetchHtml(path);
			return JSON.parse(text);
		} catch (e) {
			console.error('[genesistudio] apiGet', path, e);
			throw e;
		}
	}

	private async loadAllNovels(): Promise<any[]> {
		if (this.novelsCache) return this.novelsCache;
		const fields = encodeURIComponent(
			JSON.stringify([
				'id',
				'slug',
				'novel_title',
				'cover',
				'author',
				'synopsis',
				'status',
				'free_up_to_chapter',
				'premium_chapter_count',
				'chapter_numbers',
				'genres',
				'serialization'
			])
		);
		const data = await this.apiGet(
			`/api/directus/novels?fields=${fields}&limit=-1`
		);
		const list = Array.isArray(data) ? data : [];
		this.novelsCache = list;
		this.novelsBySlug.clear();
		this.novelsById.clear();
		for (const n of list) {
			if (n.slug) this.novelsBySlug.set(String(n.slug), n);
			if (n.id) this.novelsById.set(String(n.id), n);
		}
		return list;
	}

	private mapNovelCard(n: any, latestChapter?: number): Manga {
		const slug = String(n.slug || n.id || '');
		const coverId = n.coverFile?.filename_disk
			? null
			: n.cover;
		const cover = n.coverFile?.filename_disk
			? coverUrl(n.coverFile.id, n.coverFile.filename_disk)
			: coverUrl(n.cover);
		const statusRaw = String(n.status || n.serialization || '').toLowerCase();
		let status: string | undefined;
		if (/complet|finish|end/.test(statusRaw)) status = 'Completed';
		else if (/hiatus|hold/.test(statusRaw)) status = 'Hiatus';
		else if (/publish|ongoing|serial/.test(statusRaw)) status = 'Ongoing';

		const ch =
			latestChapter ??
			(typeof n.chapter_numbers === 'number' ? n.chapter_numbers : undefined);

		return {
			id: `/novels/${slug}`,
			title: cleanText(n.novel_title || n.title || slug),
			cover,
			sourceId: this.id,
			type: 'novel',
			status,
			lang: 'en',
			...(ch != null ? { latestChapter: ch } : {})
		};
	}

	// ─── Latest = Recently Updated ───────────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		const pageNum = Math.max(1, page);
		const limit = PER_PAGE;
		const offset = (pageNum - 1) * limit;
		const fetchLimit = pageNum === 1 ? PER_PAGE : Math.min(100, offset + limit);

		try {
			const data = await this.apiGet(
				`/api/chapters/recent?limit=${fetchLimit}&type=all`
			);
			const list: any[] = Array.isArray(data) ? data : [];

			const ordered: Manga[] = [];
			const seen = new Set<string>();

			for (const item of list) {
				const novel = item.novel || {};
				const slug = String(novel.slug || '');
				if (!slug || seen.has(slug)) continue;
				seen.add(slug);

				const cover = novel.coverFile?.filename_disk
					? coverUrl(novel.coverFile.id, novel.coverFile.filename_disk)
					: coverUrl(novel.cover);

				const latestChapter =
					typeof item.chapter_number === 'number'
						? item.chapter_number
						: undefined;

				ordered.push({
					id: `/novels/${slug}`,
					title: cleanText(novel.novel_title || slug),
					cover,
					sourceId: this.id,
					type: 'novel',
					lang: 'en',
					...(latestChapter != null ? { latestChapter } : {})
				});
			}

			if (pageNum === 1) return ordered.slice(0, PER_PAGE);
			if (ordered.length <= offset) {
				const all = await this.loadAllNovels();
				return all
					.slice(offset, offset + limit)
					.map((n) => this.mapNovelCard(n));
			}
			return ordered.slice(offset, offset + limit);
		} catch (e) {
			console.error('[genesistudio] getLatestManga', e);
			try {
				const all = await this.loadAllNovels();
				const offset2 = (pageNum - 1) * PER_PAGE;
				return all.slice(offset2, offset2 + PER_PAGE).map((n) => this.mapNovelCard(n));
			} catch {
				return [];
			}
		}
	}

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim().toLowerCase();
		const page = Math.max(1, opts?.page ?? 1);
		if (!q) return this.getLatestManga(page);

		const all = await this.loadAllNovels();
		const matched = all.filter((n) => {
			const title = String(n.novel_title || '').toLowerCase();
			const slug = String(n.slug || '').toLowerCase();
			const author = String(n.author || '').toLowerCase();
			return title.includes(q) || slug.includes(q) || author.includes(q);
		});
		const offset = (page - 1) * PER_PAGE;
		return matched.slice(offset, offset + PER_PAGE).map((n) => this.mapNovelCard(n));
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) throw new Error(`Invalid novel id: ${mangaId}`);

		await this.loadAllNovels();
		let novel = this.novelsBySlug.get(slug);

		if (novel?.id) {
			try {
				const fields = encodeURIComponent(
					JSON.stringify([
						'id',
						'slug',
						'novel_title',
						'cover',
						'author',
						'synopsis',
						'status',
						'free_up_to_chapter',
						'premium_chapter_count',
						'chapter_numbers',
						'serialization',
						'content_rating',
						'one_liner'
					])
				);
				const detail = await this.apiGet(
					`/api/directus/novels/by-id/${novel.id}?fields=${fields}`
				);
				if (detail && (detail.id || detail.novel_title)) {
					novel = { ...novel, ...detail };
				}
			} catch {
			}
		}

		if (!novel) {
			const all = await this.loadAllNovels();
			novel = all.find((n) => n.slug === slug);
		}
		if (!novel) throw new Error(`Novel not found: ${slug}`);

		const cover = novel.coverFile?.filename_disk
			? coverUrl(novel.coverFile.id, novel.coverFile.filename_disk)
			: coverUrl(novel.cover);

		const authors: string[] = [];
		if (novel.author && cleanText(novel.author)) {
			authors.push(cleanText(novel.author));
		}

		let status = 'Ongoing';
		const st = String(novel.status || novel.serialization || '').toLowerCase();
		if (/complet|finish|end/.test(st)) status = 'Completed';
		else if (/hiatus/.test(st)) status = 'Hiatus';

		const description = cleanText(
			novel.synopsis || novel.one_liner || ''
		).slice(0, 4000);

		const chapters = await this.fetchChapters(String(novel.id), slug, novel);

		return {
			id: `/novels/${slug}`,
			title: cleanText(novel.novel_title || slug),
			cover,
			sourceId: this.id,
			description,
			authors,
			status,
			genres: [],
			chapters,
			type: 'novel',
			lang: 'en',
			...(chapters.length ? { latestChapter: chapters[0]?.number } : {})
		};
	}

	private extractSlug(mangaId: string): string {
		const id = String(mangaId || '').replace(/\/$/, '');
		const m = id.match(/\/novels\/([^/]+)/i) || id.match(/^([^/]+)$/);
		return m ? decodeURIComponent(m[1]) : '';
	}

	private async fetchChapters(
		novelId: string,
		slug: string,
		novel?: any
	): Promise<Chapter[]> {
		const freeUpTo =
			typeof novel?.free_up_to_chapter === 'number'
				? novel.free_up_to_chapter
				: 0;

		try {
			const res = await this.apiGet(`/api/novels-chapter/${novelId}`);
			const chapters: any[] = res?.data?.chapters || res?.chapters || [];
			const out: Chapter[] = [];

			for (const ch of chapters) {
				const num = Number(ch.chapter_number);
				if (!num && num !== 0) continue;
				const isLocked =
					ch.isPaid === true ||
					ch.tier === 'premium' ||
					(ch.isUnlocked === false && ch.tier !== 'free') ||
					(freeUpTo > 0 && num > freeUpTo && ch.tier === 'premium');

				out.push({
					id: `/novels/${slug}/chapter-${num}`,
					title: `Chapter ${num}`,
					number: num,
					date: ch.date_published || undefined,
					isLocked: !!isLocked
				});
			}

			out.sort((a, b) => b.number - a.number);
			return out;
		} catch (e) {
			console.error('[genesistudio] fetchChapters', novelId, e);
			const total =
				typeof novel?.chapter_numbers === 'number' ? novel.chapter_numbers : 0;
			const out: Chapter[] = [];
			for (let i = total; i >= 1; i--) {
				out.push({
					id: `/novels/${slug}/chapter-${i}`,
					title: `Chapter ${i}`,
					number: i,
					isLocked: freeUpTo > 0 ? i > freeUpTo : false
				});
			}
			return out;
		}
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
		const m = String(chapterId).match(/\/novels\/([^/]+)\/chapter-(\d+)/i);
		if (!m) throw new Error(`Invalid chapter id: ${chapterId}`);
		const slug = decodeURIComponent(m[1]);
		const number = parseInt(m[2], 10);

		await this.loadAllNovels();
		const novel = this.novelsBySlug.get(slug);
		if (!novel?.id) throw new Error(`Novel not found for chapter: ${slug}`);

		const res = await this.apiGet(`/api/novels-chapter/${novel.id}`);
		const chapters: any[] = res?.data?.chapters || [];
		const ch = chapters.find((c) => Number(c.chapter_number) === number);
		if (!ch) throw new Error(`Chapter ${number} not found`);

		if (
			(ch.isPaid && ch.isUnlocked === false) ||
			(ch.tier === 'premium' && ch.isUnlocked === false)
		) {
			throw new Error('Chapter is locked / premium on Genesis Studio');
		}

		const contentRes = await this.apiGet(`/api/chapters/${ch.id}/content`);
		const data = contentRes?.data || contentRes || {};
		if (data.isPaid && data.isUnlocked === false) {
			throw new Error('Chapter is locked / premium on Genesis Studio');
		}

		const raw = data.chapter_content || data.content || '';
		const content = textToHtml(String(raw));
		if (!content || content.length < 20) {
			throw new Error(`Chapter ${number} has empty content`);
		}

		const prev = chapters.find((c) => Number(c.chapter_number) === number - 1);
		const next = chapters.find((c) => Number(c.chapter_number) === number + 1);

		return {
			title: `Chapter ${number}`,
			content,
			prevChapterId: prev ? `/novels/${slug}/chapter-${number - 1}` : null,
			nextChapterId: next ? `/novels/${slug}/chapter-${number + 1}` : null
		};
	}
}

export default GenesisStudioSource;
