/**
 * Azure Chronicles (azurechronicles.com)
 * Path: scraper/src/sources/impl/AzureChronicles.ts
 *
 * Stack: WordPress + custom REST azurechronicles/v2
 *
 * ID format (sama seperti script lama yang jalan):
 *   Novel:   /novel/{slug}
 *   Chapter: /novel/{slug}/chapter-{n}
 *
 * API:
 *   GET /wp-json/azurechronicles/v2/novels?page=&per_page=&sort=latest|popular
 *   GET /wp-json/azurechronicles/v2/search?q=&page=&per_page=
 *   GET /wp-json/azurechronicles/v2/novels/{id}
 *   GET /wp-json/azurechronicles/v2/novels/{id}/chapters?page=&per_page=&order=
 *   GET /wp-json/azurechronicles/v2/chapters/{id} → text_content
 *   GET /wp-json/wp/v2/ac_novel?slug={slug}
 */
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types';

const PAGE_SIZE = 20;
const API = '/wp-json/azurechronicles/v2';
const WP = '/wp-json/wp/v2';

type AcApiMeta = {
	page?: number;
	per_page?: number;
	total?: number;
	total_pages?: number;
};

type AcNovelCard = {
	id: number;
	title?: string;
	cover_url?: string;
	latest_chapter?: string;
	status?: string;
	chapter_count?: number;
	genres?: string[];
	tags?: string[];
	description?: string;
	author?: string;
	url?: string;
};

type AcChapterCard = {
	id: number;
	chapter_number?: string | number;
	title?: string;
	created_at?: string;
	public_at?: string;
	coin_cost?: number;
	coin_price?: number;
	is_paid?: boolean;
	is_free?: boolean;
	has_access?: boolean;
	access_reason?: string;
	is_unlocked?: boolean;
	novel_id?: number;
	text_content?: string;
};

type AcListResponse<T> = {
	success?: boolean;
	data?: { items?: T[]; meta?: AcApiMeta };
	code?: string;
	message?: string;
};

type AcSingleResponse<T> = {
	success?: boolean;
	data?: T;
	code?: string;
	message?: string;
};

type WpAcNovel = {
	id: number;
	slug: string;
	link?: string;
	title?: { rendered?: string };
};

function decodeEntities(s: string): string {
	return (s || '')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#8217;/g, "'")
		.replace(/&#8216;/g, "'")
		.replace(/&#8220;/g, '"')
		.replace(/&#8221;/g, '"')
		.replace(/&#8230;/g, '…')
		.replace(/&nbsp;/g, ' ');
}

function stripHtml(html: string): string {
	return decodeEntities(
		html
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/p>/gi, '\n\n')
			.replace(/<[^>]+>/g, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
}

function cleanTitle(raw: string): string {
	return decodeEntities(raw || '')
		.replace(/\s+/g, ' ')
		.replace(/\s*(?:[–—|]|-)\s*Azure Chronicles\s*$/i, '')
		.trim();
}

function normalizeStatus(s?: string): string {
	const v = (s || '').toLowerCase();
	if (v.includes('complete') || v.includes('finished') || v.includes('ended')) return 'Completed';
	if (v.includes('hiatus') || v.includes('on hold')) return 'Hiatus';
	return 'Ongoing';
}

function parseChapterNumber(title: string, chapterNumber?: string | number): number {
	if (chapterNumber != null && chapterNumber !== '') {
		const n = parseFloat(String(chapterNumber).replace(/[^\d.]/g, ''));
		if (!Number.isNaN(n)) return n;
	}
	const m = (title || '').match(
		/(?:chapter|chap|ch\.?|episode|ep\.?)\s*[:.]?\s*(\d+)(?:[.,](\d+))?/i
	);
	if (m) {
		if (m[2]) return parseFloat(`${m[1]}.${m[2]}`);
		return parseInt(m[1], 10);
	}
	if (/prologue/i.test(title || '')) return 0;
	const n = (title || '').match(/\b(\d+(?:\.\d+)?)\b/);
	return n ? parseFloat(n[1]) : 0;
}

function slugFromUrlOrPath(urlOrPath?: string): string | null {
	if (!urlOrPath) return null;
	const m = urlOrPath.match(/\/novel\/([^/]+)/i);
	if (m) return m[1];
	const clean = urlOrPath.replace(/^\/+|\/+$/g, '');
	if (clean && !/^\d+$/.test(clean) && !clean.includes('/')) return clean;
	return null;
}

function novelIdFromSlug(slug: string): string {
	return `/novel/${slug}`;
}

function chapterIdFromSlug(slug: string, chapterNumber: string | number): string {
	const n = String(chapterNumber).replace(/[^\d.]/g, '') || '0';
	// site URL style: /novel/{slug}/chapter-{n}/
	const whole = n.includes('.') ? n.replace('.', '-') : n;
	return `/novel/${slug}/chapter-${whole}`;
}

function isChapterLocked(ch: AcChapterCard): boolean {
	if (ch.is_free === true || ch.has_access === true) return false;
	if (ch.is_unlocked === true) return false;
	if (ch.is_paid === true) return true;
	if ((ch.coin_cost ?? 0) > 0 || (ch.coin_price ?? 0) > 0) return true;
	if (ch.access_reason === 'login_required' || ch.access_reason === 'paid') return true;
	return false;
}

export class AzureChroniclesSource extends BaseSource {
	id = 'azurechronicles';
	name = 'Azure Chronicles';
	baseUrl = 'https://azurechronicles.com';

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'application/json, text/plain, */*',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: 'https://azurechronicles.com/',
		Origin: 'https://azurechronicles.com'
	};

	/** numeric novel id → slug cache */
	private slugByNovelId = new Map<number, string>();
	/** slug → numeric novel id cache */
	private idBySlug = new Map<string, number>();

	private async fetchApi<T>(path: string): Promise<T> {
		return this.fetchJson<T>(path.startsWith('http') ? path : path);
	}

	private cacheSlug(novelId: number, slug: string) {
		if (!novelId || !slug) return;
		this.slugByNovelId.set(novelId, slug);
		this.idBySlug.set(slug, novelId);
	}

	private async resolveNovel(
		mangaId: string
	): Promise<{ numericId: number; slug: string }> {
		const raw = mangaId.replace(/^\/+/, '').replace(/\/+$/, '');
		const parts = raw.split('/').filter(Boolean);
		const slug =
			parts[0] === 'novel' ? parts[1] : /^\d+$/.test(parts[0]) ? null : parts[0];

		// numeric id only
		if (/^\d+$/.test(raw) || (parts.length === 1 && /^\d+$/.test(parts[0]))) {
			const numericId = parseInt(parts[0] || raw, 10);
			const cached = this.slugByNovelId.get(numericId);
			if (cached) return { numericId, slug: cached };

			const res = await this.fetchApi<AcSingleResponse<AcNovelCard>>(
				`${API}/novels/${numericId}`
			);
			const n = res?.data;
			if (!n?.id) throw new Error(`Series not found: ${mangaId}`);
			const s =
				slugFromUrlOrPath(n.url) ||
				(n.title || '')
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, '-')
					.replace(/^-|-$/g, '');
			if (!s) throw new Error(`No slug for novel ${numericId}`);
			this.cacheSlug(numericId, s);
			return { numericId, slug: s };
		}

		if (!slug) throw new Error(`Invalid manga id: ${mangaId}`);

		const cachedId = this.idBySlug.get(slug);
		if (cachedId) return { numericId: cachedId, slug };

		// WP CPT by slug
		const posts = await this.fetchApi<WpAcNovel[]>(
			`${WP}/ac_novel?slug=${encodeURIComponent(slug)}&per_page=1`
		);
		if (Array.isArray(posts) && posts[0]?.id) {
			this.cacheSlug(posts[0].id, posts[0].slug || slug);
			return { numericId: posts[0].id, slug: posts[0].slug || slug };
		}

		// fallback search
		const search = await this.fetchApi<AcListResponse<AcNovelCard>>(
			`${API}/search?q=${encodeURIComponent(slug.replace(/-/g, ' '))}&per_page=10`
		);
		const hit = (search?.data?.items || []).find((n) => {
			const s = slugFromUrlOrPath(n.url);
			return s === slug || n.id;
		});
		if (hit?.id) {
			const s = slugFromUrlOrPath(hit.url) || slug;
			this.cacheSlug(hit.id, s);
			return { numericId: hit.id, slug: s };
		}

		throw new Error(`Series not found: ${slug}`);
	}

	private mapNovelCard(n: AcNovelCard): Manga | null {
	if (!n?.id) return null;

	let slug = slugFromUrlOrPath(n.url);
	if (!slug && n.title) {
		slug = cleanTitle(n.title)
			.toLowerCase()
			.replace(/['']/g, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '');
	}

	const latestNum = parseChapterNumber(n.latest_chapter || '', n.chapter_count);
	const id = slug ? novelIdFromSlug(slug) : `/${n.id}`;
	if (slug) this.cacheSlug(n.id, slug);

	return {
		id,
		title: cleanTitle(n.title || slug || String(n.id)),
		cover: n.cover_url || '',
		sourceId: this.id,
		type: 'novel',
		lang: 'en',
		status: normalizeStatus(n.status),
		...(latestNum > 0 ? { latestChapter: latestNum } : {})
	};
}

	async getLatestManga(page = 1): Promise<Manga[]> {
		const pageNum = Math.max(1, page);
		try {
			const res = await this.fetchApi<AcListResponse<AcNovelCard>>(
				`${API}/novels?page=${pageNum}&per_page=${PAGE_SIZE}&sort=latest`
			);
			const items = res?.data?.items;
			if (!Array.isArray(items)) return [];
			return items.map((n) => this.mapNovelCard(n)).filter((m): m is Manga => !!m);
		} catch (e) {
			console.error('[AzureChronicles] getLatestManga failed', e);
			return [];
		}
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = Math.max(1, opts?.page ?? 1);
		const q = query.trim();
		if (!q) return [];
		try {
			const res = await this.fetchApi<AcListResponse<AcNovelCard>>(
				`${API}/search?q=${encodeURIComponent(q)}&page=${page}&per_page=${PAGE_SIZE}`
			);
			const items = res?.data?.items;
			if (!Array.isArray(items)) return [];
			return items.map((n) => this.mapNovelCard(n)).filter((m): m is Manga => !!m);
		} catch (e) {
			console.error('[AzureChronicles] searchManga failed', e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const { numericId, slug } = await this.resolveNovel(mangaId);

		const res = await this.fetchApi<AcSingleResponse<AcNovelCard>>(
			`${API}/novels/${numericId}`
		);
		const n = res?.data;
		if (!n?.id) throw new Error(`Series not found: ${mangaId}`);

		const finalSlug = slugFromUrlOrPath(n.url) || slug;
		this.cacheSlug(n.id, finalSlug);

		const chapters = await this.fetchAllChapters(numericId, finalSlug);
		const genres = Array.isArray(n.genres) ? n.genres.map(cleanTitle).filter(Boolean) : [];
		const authors = n.author ? [cleanTitle(n.author)].filter(Boolean) : [];

		return {
			id: novelIdFromSlug(finalSlug),
			title: cleanTitle(n.title || finalSlug),
			cover: n.cover_url || '',
			sourceId: this.id,
			description: stripHtml(n.description || ''),
			authors,
			status: normalizeStatus(n.status),
			genres,
			chapters,
			type: 'novel',
			lang: 'en',
			...(chapters.length ? { latestChapter: chapters[0]?.number } : {})
		};
	}

	private async fetchAllChapters(
		novelId: number,
		slug: string
	): Promise<Chapter[]> {
		const out: Chapter[] = [];
		const seen = new Set<string>();
		let page = 1;
		const perPage = 100;

		while (page <= 50) {
			const res = await this.fetchApi<AcListResponse<AcChapterCard>>(
				`${API}/novels/${novelId}/chapters?page=${page}&per_page=${perPage}&order=desc`
			);
			const items = res?.data?.items;
			if (!Array.isArray(items) || items.length === 0) break;

			for (const ch of items) {
				if (!ch?.id) continue;
				const num = parseChapterNumber(ch.title || '', ch.chapter_number);
				const chapNumStr =
					ch.chapter_number != null && String(ch.chapter_number).trim() !== ''
						? String(ch.chapter_number).replace(/[^\d.]/g, '')
						: String(num);
				const id = chapterIdFromSlug(slug, chapNumStr || num);
				if (seen.has(id)) continue;
				seen.add(id);

				out.push({
					id,
					title: cleanTitle(ch.title || `Chapter ${chapNumStr}`),
					number: num,
					date: ch.public_at || ch.created_at || undefined,
					isLocked: isChapterLocked(ch)
				});
			}

			const totalPages = res?.data?.meta?.total_pages ?? page;
			if (page >= totalPages || items.length < perPage) break;
			page++;
		}

		out.sort((a, b) => {
			if (b.number !== a.number) return b.number - a.number;
			return (b.date || '').localeCompare(a.date || '');
		});
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
		// /novel/{slug}/chapter-{n}  OR  plain numeric
		const path = chapterId.replace(/^\/+/, '').replace(/\/+$/, '');
		const m = path.match(/^novel\/([^/]+)\/chapter-([\d.-]+)/i);
		let slug: string;
		let chapNumStr: string;
		let numericChapterId: number | null = null;

		if (m) {
			slug = m[1];
			chapNumStr = m[2].replace('-', '.');
		} else if (/^\d+$/.test(path.split('/').pop() || '')) {
			// fallback numeric chapter id
			numericChapterId = parseInt(path.split('/').pop()!, 10);
			slug = '';
			chapNumStr = '';
		} else {
			throw new Error(`Invalid chapter id: ${chapterId}`);
		}

		// Resolve numeric chapter id via novel chapter list if we only have path
		let novelNumericId: number | null = null;
		if (m) {
			const resolved = await this.resolveNovel(`/novel/${slug}`);
			novelNumericId = resolved.numericId;
			slug = resolved.slug;

			// find chapter id from list
			const chaptersMeta = await this.fetchChapterMeta(novelNumericId);
			const targetNum = parseFloat(chapNumStr);
			const found = chaptersMeta.find(
				(c) =>
					c.number === targetNum ||
					String(c.chapter_number) === chapNumStr ||
					String(c.chapter_number) === String(targetNum)
			);
			if (!found) throw new Error(`Chapter not found: ${chapterId}`);
			numericChapterId = found.id;
		}

		if (!numericChapterId) throw new Error(`Chapter not found: ${chapterId}`);

		// Fetch content
		const url = `${this.baseUrl}${API}/chapters/${numericChapterId}`;
		const response = await fetch(url, {
			headers: { ...this.headers, Accept: 'application/json' }
		});
		const json = (await response.json().catch(() => null)) as any;

		if (response.status === 403 || json?.code === 'ac_api_chapter_locked') {
			const access = json?.data?.access;
			const price =
				access?.chapter?.coin_price ?? access?.chapter?.coin_cost ?? '?';
			throw new Error(
				`Chapter is locked / paid on Azure Chronicles (${access?.reason || 'locked'}, coins: ${price})`
			);
		}
		if (!response.ok) {
			throw new Error(
				`Failed to fetch chapter ${numericChapterId}: ${response.status}`
			);
		}

		const ch = (json as AcSingleResponse<AcChapterCard>)?.data;
		if (!ch?.id) throw new Error(`Chapter not found: ${chapterId}`);

		const raw = ch.text_content || '';
		if (!raw.trim()) {
			throw new Error('Chapter body is empty (may require login or unlock)');
		}

		const title = cleanTitle(ch.title || `Chapter ${ch.chapter_number ?? ''}`);
		const content = `<div class="ac-chapter">${raw}</div>`;

		// Resolve slug if still missing
		if (!slug && ch.novel_id) {
			novelNumericId = ch.novel_id;
			const cached = this.slugByNovelId.get(ch.novel_id);
			if (cached) {
				slug = cached;
			} else {
				try {
					const det = await this.fetchApi<AcSingleResponse<AcNovelCard>>(
						`${API}/novels/${ch.novel_id}`
					);
					slug = slugFromUrlOrPath(det?.data?.url) || '';
					if (slug) this.cacheSlug(ch.novel_id, slug);
				} catch {
					/* ignore */
				}
			}
		}
		if (!novelNumericId && ch.novel_id) novelNumericId = ch.novel_id;

		// prev / next — path-based, newest-first list
		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		if (novelNumericId && slug) {
			try {
				const list = await this.fetchAllChapters(novelNumericId, slug);
				const currentPath = chapterIdFromSlug(
					slug,
					ch.chapter_number ?? chapNumStr
				);
				const idx = list.findIndex(
					(c) =>
						c.id === currentPath ||
						c.id === chapterId ||
						c.number === parseChapterNumber(title, ch.chapter_number)
				);
				if (idx >= 0) {
					prevChapterId = list[idx + 1]?.id ?? null; // older
					nextChapterId = list[idx - 1]?.id ?? null; // newer
				}
			} catch (e) {
				console.warn('[AzureChronicles] prev/next failed', e);
			}
		}

		return { title, content, prevChapterId, nextChapterId };
	}

	private async fetchChapterMeta(
		novelId: number
	): Promise<Array<{ id: number; number: number; chapter_number?: string | number }>> {
		const out: Array<{
			id: number;
			number: number;
			chapter_number?: string | number;
		}> = [];
		let page = 1;
		const perPage = 100;
		while (page <= 50) {
			const res = await this.fetchApi<AcListResponse<AcChapterCard>>(
				`${API}/novels/${novelId}/chapters?page=${page}&per_page=${perPage}&order=asc`
			);
			const items = res?.data?.items;
			if (!Array.isArray(items) || !items.length) break;
			for (const c of items) {
				if (!c?.id) continue;
				out.push({
					id: c.id,
					number: parseChapterNumber(c.title || '', c.chapter_number),
					chapter_number: c.chapter_number
				});
			}
			const totalPages = res?.data?.meta?.total_pages ?? page;
			if (page >= totalPages || items.length < perPage) break;
			page++;
		}
		return out;
	}
}

export default AzureChroniclesSource;