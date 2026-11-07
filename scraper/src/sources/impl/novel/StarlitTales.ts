/**
 * Starlit Tales (starlit-tales.com) — SPA + REST API novel source
 * Path: scraper/src/sources/impl/novel/StarlitTales.ts
 *
 * API base: https://api.starlit-tales.com
 *
 *   Latest  : GET /api/novels/recently-updated?count=24  (Latest Updates section)
 *   List    : GET /api/novels?page=N&pageSize=24&sortBy=updatedAt&sortDir=desc
 *   Search  : GET /api/novels?page=N&pageSize=24&search={q}
 *   Detail  : GET /api/novels/{slug}
 *   Chapter : GET /api/chapters/{chapterId}
 *             (403 = paywall / locked)
 *
 * Frontend URLs:
 *   Novel   : https://starlit-tales.com/novel/{slug}
 *   Chapter : https://starlit-tales.com/novel/{slug}/{chapterNumber}
 *
 */
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const SITE = 'https://starlit-tales.com';
const API = 'https://api.starlit-tales.com';
const PAGE_SIZE = 24;

function absCover(path: string | undefined | null): string {
	if (!path) return '';
	const p = String(path).trim();
	if (!p) return '';
	if (p.startsWith('//')) return `https:${p}`;
	if (/^https?:\/\//i.test(p)) return p.split('?')[0];
	return `${API}${p.startsWith('/') ? p : `/${p}`}`.split('?')[0];
}

function stripHtml(html: string): string {
	return (html || '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>/gi, '\n\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function statusLabel(raw: string | undefined): string {
	const s = (raw || '').toLowerCase();
	if (s.includes('complete')) return 'Completed';
	if (s.includes('hiatus')) return 'Hiatus';
	if (s.includes('drop')) return 'Dropped';
	if (s.includes('ongoing') || s.includes('on-going')) return 'Ongoing';
	return raw || 'Ongoing';
}

function mapNovelCard(n: any, sourceId: string): Manga | null {
	if (!n?.slug && !n?.id) return null;
	const slug = n.slug || String(n.id);
	const title = String(n.title || '').replace(/\s+/g, ' ').trim();
	if (!title) return null;

	let latestChapter: number | undefined;
	if (Array.isArray(n.recentChapters) && n.recentChapters.length) {
		const num = Number(n.recentChapters[0].chapterNumber);
		if (!Number.isNaN(num)) latestChapter = num;
	} else if (n.chapterCount != null) {
		latestChapter = Number(n.chapterCount) || undefined;
	} else if (n.latestChapterNumber != null) {
		latestChapter = Number(n.latestChapterNumber) || undefined;
	}

	return {
		id: `/novel/${slug}`,
		title,
		cover: absCover(n.coverImage),
		sourceId,
		type: 'novel',
		status: statusLabel(n.status),
		lang: 'en',
		...(latestChapter != null ? { latestChapter } : {})
	};
}

export class StarlitTalesSource extends BaseSource {
	id = 'starlittales';
	name = 'Starlit Tales';
	baseUrl = SITE;

	kind = 'novel' as const;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
		Accept: 'application/json, text/plain, */*',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: SITE + '/',
		Origin: SITE
	};

	private async apiGet<T = any>(path: string): Promise<T> {
		const url = path.startsWith('http') ? path : `${API}${path.startsWith('/') ? path : `/${path}`}`;
		const text = await fetchWithCf(url, {
			headers: {
				...this.headers,
				Accept: 'application/json'
			}
		});
		if (!text || text.length < 2) {
			throw new Error(`Empty response from ${url}`);
		}
		const low = text.slice(0, 500).toLowerCase();
		if (low.includes('just a moment') || low.includes('cf-browser-verification')) {
			throw new Error('Cloudflare blocked API request (set BYPARR_URL)');
		}
		try {
			return JSON.parse(text) as T;
		} catch {
			throw new Error(`Invalid JSON from ${url}`);
		}
	}

	// ─── Latest Updates (homepage section) ────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		if (page <= 1) {
			try {
				const data = await this.apiGet<any[]>(
					`/api/novels/recently-updated?count=${PAGE_SIZE}`
				);
				const list = Array.isArray(data) ? data : [];
				const out: Manga[] = [];
				const seen = new Set<string>();
				for (const n of list) {
					const item = mapNovelCard(n, this.id);
					if (item && !seen.has(item.id)) {
						seen.add(item.id);
						out.push(item);
					}
				}
				if (out.length) return out.slice(0, PAGE_SIZE);
			} catch {
			}
		}
		return this.fetchNovelsPage(page, { sortBy: 'updatedAt', sortDir: 'desc' });
	}

	private async fetchNovelsPage(
		page: number,
		opts: { sortBy?: string; sortDir?: string; search?: string } = {}
	): Promise<Manga[]> {
		const params = new URLSearchParams({
			page: String(Math.max(1, page)),
			pageSize: String(PAGE_SIZE),
			sortBy: opts.sortBy || 'updatedAt',
			sortDir: opts.sortDir || 'desc'
		});
		if (opts.search?.trim()) {
			params.set('search', opts.search.trim());
		}

		try {
			const data = await this.apiGet<{ items?: any[] } | any[]>(
				`/api/novels?${params.toString()}`
			);
			const items = Array.isArray(data)
				? data
				: Array.isArray((data as any)?.items)
					? (data as any).items
					: [];
			const out: Manga[] = [];
			const seen = new Set<string>();
			for (const n of items) {
				const item = mapNovelCard(n, this.id);
				if (item && !seen.has(item.id)) {
					seen.add(item.id);
					out.push(item);
				}
			}
			return out;
		} catch {
			return [];
		}
	}

	// ─── Search ───────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = query.trim();
		if (!q) return [];
		const page = opts?.page ?? 1;
		return this.fetchNovelsPage(page, { search: q, sortBy: 'updatedAt', sortDir: 'desc' });
	}

	// ─── Detail ───────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) throw new Error('Invalid novel id');

		const n = await this.apiGet<any>(`/api/novels/${encodeURIComponent(slug)}`);
		if (!n?.title && !n?.slug) {
			throw new Error('Novel not found');
		}

		const title = String(n.title || '').replace(/\s+/g, ' ').trim();
		const cover = absCover(n.coverImage);
		const description = stripHtml(String(n.synopsis || n.description || ''));

		const authors: string[] = [];
		if (n.author) {
			const a = String(n.author).trim();
			if (a) authors.push(a);
		}
		const artists: string[] = [];
		if (Array.isArray(n.translators)) {
			for (const t of n.translators) {
				const name =
					typeof t === 'string'
						? t
						: t?.username || t?.firstName || t?.name || '';
				const clean = String(name).trim();
				if (clean && !artists.includes(clean)) artists.push(clean);
			}
		}
		if (!authors.length && artists.length) {
			authors.push(...artists);
		}

		const genres: string[] = [];
		if (Array.isArray(n.genres)) {
			for (const g of n.genres) {
				const name = typeof g === 'string' ? g : g?.name;
				if (name && !genres.includes(name)) genres.push(String(name));
			}
		}
		if (Array.isArray(n.tags)) {
			for (const t of n.tags) {
				const name = typeof t === 'string' ? t : t?.name;
				if (name && name.length < 40 && !genres.includes(name)) {
					// tags go to genres list if short; optional
				}
			}
		}

		const status = statusLabel(n.status);
		const altTitle = n.rawTitle ? String(n.rawTitle).trim() : '';

		const chapters = this.mapChapters(n.chapters, slug);
		chapters.sort((a, b) => b.number - a.number);

		const details: MangaDetails = {
			id: `/novel/${n.slug || slug}`,
			title,
			cover,
			sourceId: this.id,
			description,
			authors,
			status,
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
		};
		if (artists.length) extra.artists = artists;
		if (altTitle) extra.altTitles = [altTitle];
		if (n.averageRating != null && Number(n.averageRating) > 0) {
			extra.rating = String(n.averageRating);
		}
		if (n.originalLanguage) {
		}

		return details;
	}

	private extractSlug(mangaId: string): string {
		const clean = mangaId.replace(/^\/+/, '').replace(/\/+$/, '');
		const m = clean.match(/(?:novel\/)?([^/]+)$/i);
		return m ? m[1] : clean;
	}

	private mapChapters(raw: any[] | undefined, slug: string): Chapter[] {
		if (!Array.isArray(raw)) return [];
		const out: Chapter[] = [];
		const seen = new Set<string>();

		for (const c of raw) {
			const num = Number(c.chapterNumber ?? c.number ?? c.index);
			if (Number.isNaN(num)) continue;

			const chapterId = c.id != null ? String(c.id) : '';
			const id = chapterId
				? `/novel/${slug}/chapter/${chapterId}`
				: `/novel/${slug}/${num}`;

			if (seen.has(id)) continue;
			seen.add(id);

			const isLocked =
				c.isFree === false ||
				(typeof c.heartsCost === 'number' && c.heartsCost > 0);

			const ch: Chapter = {
				id,
				title: `Chapter ${num}`,
				number: num,
				date: c.createdAt || c.freeAt || c.publishAt || undefined
			};
			if (isLocked) ch.isLocked = true;
			out.push(ch);
		}

		return out;
	}

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	// ─── Chapter content ──────────────────────────────────────────────────

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		const parsed = this.parseChapterId(chapterId);
		if (!parsed.chapterDbId && parsed.chapterNumber == null) {
			throw new Error('Invalid chapter id');
		}

		let data: any;
		try {
			if (parsed.chapterDbId) {
				data = await this.apiGet(`/api/chapters/${parsed.chapterDbId}`);
			} else {
				const novel = await this.apiGet<any>(
					`/api/novels/${encodeURIComponent(parsed.slug || '')}`
				);
				const match = (novel?.chapters || []).find(
					(c: any) => Number(c.chapterNumber) === parsed.chapterNumber
				);
				if (!match?.id) {
					throw new Error('Chapter not found');
				}
				if (match.isFree === false || (match.heartsCost > 0 && !match.isFree)) {
					return this.lockedResponse(
						match.chapterNumber,
						parsed.slug || novel?.slug,
						novel?.chapters
					);
				}
				data = await this.apiGet(`/api/chapters/${match.id}`);
			}
		} catch (e: any) {
			const msg = String(e?.message || e || '');
			if (/403|401|forbidden|unauthorized/i.test(msg)) {
				return this.lockedResponse(parsed.chapterNumber, parsed.slug);
			}
			throw e;
		}

		if (data?.isUnlocked === false || (!data?.content && data?.isFree === false)) {
			return this.lockedResponse(
				data?.chapterNumber ?? parsed.chapterNumber,
				data?.novelSlug ?? parsed.slug,
				undefined,
				data
			);
		}

		const num = Number(data.chapterNumber ?? parsed.chapterNumber ?? 0);
		const title =
			num > 0
				? `Chapter ${num}`
				: String(data.title || 'Chapter').replace(/\s+/g, ' ').trim();

		let contentHtml = String(data.content || '');
		if (contentHtml && !/<[a-z][\s\S]*>/i.test(contentHtml)) {
			contentHtml = contentHtml
				.split(/\n{2,}/)
				.map((p) => p.trim())
				.filter(Boolean)
				.map((p) => `<p>${escapeHtml(p)}</p>`)
				.join('\n');
		}

		const slug = data.novelSlug || parsed.slug || '';
		const prevNum =
			data.prevChapterNumber != null ? Number(data.prevChapterNumber) : null;
		const nextNum =
			data.nextChapterNumber != null ? Number(data.nextChapterNumber) : null;

		let prevId: string | null = null;
		let nextId: string | null = null;

		if (slug && (prevNum != null || nextNum != null)) {
			try {
				const novel = await this.apiGet<any>(
					`/api/novels/${encodeURIComponent(slug)}`
				);
				const chs: any[] = novel?.chapters || [];
				if (prevNum != null) {
					const p = chs.find((c) => Number(c.chapterNumber) === prevNum);
					prevId = p?.id
						? `/novel/${slug}/chapter/${p.id}`
						: `/novel/${slug}/${prevNum}`;
				}
				if (nextNum != null) {
					const n = chs.find((c) => Number(c.chapterNumber) === nextNum);
					nextId = n?.id
						? `/novel/${slug}/chapter/${n.id}`
						: `/novel/${slug}/${nextNum}`;
				}
			} catch {
				if (prevNum != null) prevId = `/novel/${slug}/${prevNum}`;
				if (nextNum != null) nextId = `/novel/${slug}/${nextNum}`;
			}
		}

		return {
			title,
			content:
				contentHtml ||
				'<p><em>Konten kosong — chapter mungkin locked atau selector berubah.</em></p>',
			prevChapterId: prevId,
			nextChapterId: nextId
		};
	}

	private lockedResponse(
		chapterNumber?: number | null,
		slug?: string | null,
		allChapters?: any[],
		data?: any
	): {
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	} {
		const num = chapterNumber != null ? Number(chapterNumber) : 0;
		const title = num > 0 ? `Chapter ${num}` : 'Locked Chapter';

		let prevId: string | null = null;
		let nextId: string | null = null;
		const s = slug || data?.novelSlug || '';

		if (s && allChapters?.length && num > 0) {
			const sorted = [...allChapters].sort(
				(a, b) => Number(a.chapterNumber) - Number(b.chapterNumber)
			);
			const idx = sorted.findIndex((c) => Number(c.chapterNumber) === num);
			if (idx > 0) {
				const p = sorted[idx - 1];
				prevId = p?.id
					? `/novel/${s}/chapter/${p.id}`
					: `/novel/${s}/${p.chapterNumber}`;
			}
			if (idx >= 0 && idx < sorted.length - 1) {
				const n = sorted[idx + 1];
				nextId = n?.id
					? `/novel/${s}/chapter/${n.id}`
					: `/novel/${s}/${n.chapterNumber}`;
			}
		} else if (data) {
			const prevNum =
				data.prevChapterNumber != null ? Number(data.prevChapterNumber) : null;
			const nextNum =
				data.nextChapterNumber != null ? Number(data.nextChapterNumber) : null;
			if (s && prevNum != null) prevId = `/novel/${s}/${prevNum}`;
			if (s && nextNum != null) nextId = `/novel/${s}/${nextNum}`;
		}

		return {
			title,
			content:
				'<p><em>This chapter is locked (hearts / paywall). Unlock it on Starlit Tales.</em></p>',
			prevChapterId: prevId,
			nextChapterId: nextId
		};
	}

	private parseChapterId(chapterId: string): {
		slug?: string;
		chapterDbId?: string;
		chapterNumber?: number;
	} {
		const clean = chapterId.replace(/^\/+/, '').replace(/\/+$/, '');
		let m = clean.match(/^novel\/([^/]+)\/chapter\/(\d+)$/i);
		if (m) return { slug: m[1], chapterDbId: m[2] };
		m = clean.match(/^novel\/([^/]+)\/(\d+(?:\.\d+)?)$/i);
		if (m) return { slug: m[1], chapterNumber: parseFloat(m[2]) };
		if (/^\d+$/.test(clean)) return { chapterDbId: clean };
		return {};
	}
}

export default StarlitTalesSource;
