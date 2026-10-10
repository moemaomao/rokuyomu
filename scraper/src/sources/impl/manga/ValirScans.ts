/**
 * valirscans.org adapter (JSON API)
 *
 * List   : GET /api/series?sort=newest&page={n}&limit=24
 * Search : GET /api/search?q=QUERY
 * Detail : GET /api/series?slug={slug}  + chapters via /api/chapters/next
 * Pages  : GET /api/chapters/page-urls?chapterId={id}
 *
 * URL site:
 *   series  : /series/comic/{slug}
 *   chapter : /series/comic/{slug}/chapter/{n}
 *
 * ID format:
 *   manga   : "/series/comic/{slug}"
 *   chapter : "/series/comic/{slug}/chapter/{n}"  (chapterId API di-resolve dari list)
 */

import { BaseSource } from '../../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';
import { fetchWithCf } from '../../../lib/fetchWithCf';

export class ValirScansSource extends BaseSource {
	id = 'valirscans';
	name = 'ValirScans';
	baseUrl = 'https://valirscans.org';

	private readonly PER_PAGE = 24;
	private readonly LIST_LANG = 'en';

	private async getJson<T>(path: string): Promise<T> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const body = await fetchWithCf(url, {
			headers: {
				...this.headers,
				Accept: 'application/json',
				Referer: `${this.baseUrl}/`,
				Origin: this.baseUrl
			}
		});
		try {
			return JSON.parse(body) as T;
		} catch {
			throw new Error(`[valirscans] invalid JSON ${url} (len=${body?.length ?? 0})`);
		}
	}

	private absUrl(u: string): string {
		if (!u) return '';
		if (u.startsWith('http')) return u;
		if (u.startsWith('//')) return `https:${u}`;
		return `${this.baseUrl}${u.startsWith('/') ? '' : '/'}${u}`;
	}

	private mapType(t?: string): string {
		const s = (t || '').toUpperCase();
		if (s.includes('MANHWA')) return 'manhwa';
		if (s.includes('MANHUA')) return 'manhua';
		return 'manga';
	}

	private mapStatus(s?: string): string {
		const u = (s || '').toUpperCase();
		if (u.includes('COMPLETE') || u === 'ENDED' || u === 'FINISHED') return 'Completed';
		if (u.includes('HIATUS')) return 'Hiatus';
		return 'Ongoing';
	}

	private genreNames(genres: any): string[] {
		const out: string[] = [];
		if (!Array.isArray(genres)) return out;
		for (const g of genres) {
			const slug = g?.genre?.slug || g?.slug || g?.name || '';
			if (!slug || typeof slug !== 'string') continue;
			const name = slug
				.replace(/-/g, ' ')
				.replace(/\b\w/g, (c: string) => c.toUpperCase());
			if (name && !out.includes(name)) out.push(name);
		}
		return out;
	}

	private seriesPath(slug: string): string {
		return `/series/comic/${slug}`;
	}

	private chapterPath(slug: string, num: number | string): string {
		return `/series/comic/${slug}/chapter/${num}`;
	}

	private parseSlug(mangaId: string): string {
		const s = String(mangaId).replace(/\/+$/, '');
		const m =
			s.match(/\/series\/(?:comic|novel)\/([^/]+)/i) ||
			s.match(/^\/?([^/]+)$/);
		return decodeURIComponent(m?.[1] || s.replace(/^\//, ''));
	}

	private mapListItem(item: any): Manga | null {
		const slug = item?.urlSlug || item?.slug;
		if (!slug) return null;
		const title = (item.title || slug).replace(/\s+/g, ' ').trim();
		const cover = this.absUrl(item.coverImage || '');
		const chs = item.chapters || [];
		const latest =
			item.imageChapterCount ||
			item.chapterCount ||
			(chs[0]?.number ?? undefined);

		return {
			id: this.seriesPath(slug),
			sourceId: this.id,
			title,
			cover,
			type: this.mapType(item.type),
			status: this.mapStatus(item.status),
			latestChapter: latest,
			lang: this.LIST_LANG
		};
	}

	// ── List ─────────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const res = await this.getJson<{ data?: any[]; meta?: any }>(
				`/api/series?sort=newest&page=${p}&limit=${this.PER_PAGE}`
			);
			const list = (res.data || [])
				.map((x) => this.mapListItem(x))
				.filter(Boolean) as Manga[];
			console.log(
				`[valirscans] latest page=${p} → ${list.length} hasMore=${res.meta?.hasMore}`
			);
			return list;
		} catch (e) {
			console.error('[valirscans] getLatestManga', e);
			return [];
		}
	}

	async searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page || 1);
		if (!q) return this.getLatestManga(page, opts);

		try {
			const res = await this.getJson<{ series?: any[] }>(
				`/api/search?q=${encodeURIComponent(q)}`
			);
			const all = (res.series || [])
				.map((x) => this.mapListItem(x))
				.filter(Boolean) as Manga[];
			const start = (page - 1) * this.PER_PAGE;
			if (start >= all.length) return [];
			const sliced = all.slice(start, start + this.PER_PAGE);
			console.log(`[valirscans] search "${q}" page=${page} → ${sliced.length}`);
			return sliced;
		} catch (e) {
			console.error('[valirscans] searchManga', e);
			return [];
		}
	}

	// ── Chapters (paginated) ─────────────────────────────────────────────────

	private async fetchAllChapters(seriesId: string, slug: string): Promise<Chapter[]> {
		const byNum = new Map<number, Chapter>();
		let after = 0;
		let guard = 0;

		while (guard < 50) {
			guard++;
			const res = await this.getJson<{
				chapters?: any[];
				hasMore?: boolean;
			}>(
				`/api/chapters/next?seriesId=${encodeURIComponent(seriesId)}&afterNumber=${after}&limit=100`
			);
			const batch = res.chapters || [];
			if (!batch.length) break;

			for (const ch of batch) {
				const num = Number(ch.number) || 0;
				if (!num && !ch.id) continue;
				const locked = ch.isLocked === true || ch.hasAccess === false;
				byNum.set(num, {
					id: this.chapterPath(slug, num),
					title: (ch.title || `Chapter ${num}`).replace(/\s+/g, ' ').trim(),
					number: num,
					date: ch.publishedAt || ch.createdAt || undefined,
					isLocked: locked
				});
			}

			const maxNum = Math.max(...batch.map((c: any) => Number(c.number) || 0));
			if (!res.hasMore || maxNum <= after) break;
			after = maxNum;
		}

		return [...byNum.values()].sort((a, b) => b.number - a.number);
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = this.parseSlug(mangaId);
		if (!slug) throw new Error(`Invalid valirscans id: ${mangaId}`);

		const res = await this.getJson<{ data?: any[] }>(
			`/api/series?slug=${encodeURIComponent(slug)}`
		);
		const item = (res.data || [])[0];
		if (!item) throw new Error(`[valirscans] series not found: ${slug}`);

		const title = (item.title || slug).replace(/\s+/g, ' ').trim();
		const cover = this.absUrl(item.coverImage || '');
		const genres = this.genreNames(item.genres);
		const seriesId = item.id;

		const chapters = seriesId
			? await this.fetchAllChapters(seriesId, slug)
			: (item.chapters || []).map((ch: any) => {
					const num = Number(ch.number) || 0;
					return {
						id: this.chapterPath(slug, num),
						title: ch.title || `Chapter ${num}`,
						number: num,
						date: ch.publishedAt || ch.createdAt,
						isLocked: ch.isLocked === true
					} as Chapter;
				});

		const latestChapter = chapters.length
			? Math.max(...chapters.map((c) => c.number))
			: item.imageChapterCount || undefined;

		console.log(
			`[valirscans] details ${slug} → chapters=${chapters.length} genres=${genres.length}`
		);

		return {
			id: this.seriesPath(slug),
			sourceId: this.id,
			title,
			cover,
			type: this.mapType(item.type),
			status: this.mapStatus(item.status),
			description: '',
			authors: [],
			genres,
			chapters,
			latestChapter,
			lang: this.LIST_LANG
		};
	}

	async resolveMangaIdFromChapter(chapterId: string): Promise<string | null> {
		const s = String(chapterId);
		const m = s.match(/\/series\/(?:comic|novel)\/([^/]+)/i);
		if (m) return this.seriesPath(m[1]);
		return null;
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	private async resolveChapterApiId(
		slug: string,
		chapterNum: number
	): Promise<string | null> {
	
		const res = await this.getJson<{ data?: any[] }>(
			`/api/series?slug=${encodeURIComponent(slug)}`
		);
		const item = (res.data || [])[0];
		if (!item?.id) return null;

		for (const ch of item.chapters || []) {
			if (Number(ch.number) === chapterNum && ch.id) return ch.id;
		}

		const after = Math.max(0, chapterNum - 5);
		const next = await this.getJson<{ chapters?: any[] }>(
			`/api/chapters/next?seriesId=${encodeURIComponent(item.id)}&afterNumber=${after}&limit=20`
		);
		for (const ch of next.chapters || []) {
			if (Number(ch.number) === chapterNum && ch.id) return ch.id;
		}
		return null;
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const s = String(chapterId);
		const m = s.match(
			/\/series\/(?:comic|novel)\/([^/]+)\/chapter\/(\d+)/i
		);
		if (!m) {
			console.error('[valirscans] invalid chapter id', chapterId);
			return [];
		}
		const slug = decodeURIComponent(m[1]);
		const num = parseInt(m[2], 10);

		try {
			const apiId = await this.resolveChapterApiId(slug, num);
			if (!apiId) {
				console.warn('[valirscans] chapter api id not found', slug, num);
				return [];
			}

			const res = await this.getJson<{ pages?: any[] }>(
				`/api/chapters/page-urls?chapterId=${encodeURIComponent(apiId)}`
			);
			const pages = (res.pages || [])
				.filter((p) => p && p.isRedacted !== true)
				.sort(
					(a, b) => (Number(a.pageNumber) || 0) - (Number(b.pageNumber) || 0)
				)
				.map((p) => p.imageUrl || p.url || '')
				.filter((u: string) => u && /^https?:\/\//i.test(u));

			console.log(`[valirscans] ${slug} ch${num} → ${pages.length} pages`);
			return pages;
		} catch (e) {
			console.error('[valirscans] getChapterPages', chapterId, e);
			return [];
		}
	}
}
