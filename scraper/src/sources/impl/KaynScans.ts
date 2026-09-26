/**
 * KaynScans adapter (public AI API)
 *
 * Domain : https://kaynscans.com
 * Latest : GET /api/ai/series?type=comic&sort=latest&page=&limit=
 * Search : GET /api/ai/search?q=
 * Detail : GET /api/ai/series/{slug}  (includes chapters list)
 * Pages  : not available via public API (premium / account gated)
 *
 * ID format:
 *   manga   : "/comic/{slug}"
 *   chapter : "/comic/{slug}/chapter/{number}"
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';

export class KaynScansSource extends BaseSource {
	id = 'kaynscans';
	name = 'Kayn Scans';
	baseUrl = 'https://kaynscans.com';

	private readonly apiBase = 'https://kaynscans.com/api/ai';
	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'en';

	// ── HTTP ─────────────────────────────────────────────────────────────────

	private async apiGet<T = any>(path: string): Promise<T> {
		const url = path.startsWith('http') ? path : `${this.apiBase}${path}`;
		const res = await fetch(url, {
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
				Accept: 'application/json',
				Referer: `${this.baseUrl}/`,
				Origin: this.baseUrl
			}
		});
		if (!res.ok) {
			throw new Error(`KaynScans HTTP ${res.status} → ${url}`);
		}
		return (await res.json()) as T;
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private toMangaId(slug: string): string {
		return `/comic/${String(slug).replace(/^\/+|\/+$/g, '')}`;
	}

	private extractSlug(id: string): string {
		const parts = String(id)
			.replace(/^\/+/, '')
			.split('/')
			.filter(Boolean);

		if (parts[0] === 'comic' && parts[1]) return parts[1];
		return parts[0] || '';
	}

	private toChapterId(slug: string, number: number | string): string {
		const s = String(slug).replace(/^\/+|\/+$/g, '');
		return `/comic/${s}/chapter/${number}`;
	}

	private extractChapterParts(chapterId: string): { slug: string; number: string } {
		const parts = String(chapterId)
			.replace(/^\/+/, '')
			.split('/')
			.filter(Boolean);

		if (parts[0] === 'comic' && parts[2] === 'chapter' && parts[3]) {
			return { slug: parts[1], number: parts[3] };
		}
	
		return { slug: parts[0] || '', number: parts[parts.length - 1] || '' };
	}

	private formatDate(iso?: string | null): string {
		if (!iso) return '';
		try {
			return new Date(iso).toISOString().slice(0, 10);
		} catch {
			return String(iso).slice(0, 10);
		}
	}

	private mapType(raw?: string | null): string {
		const t = String(raw || '').toUpperCase();
		if (t === 'MANHWA') return 'manhwa';
		if (t === 'MANHUA') return 'manhua';
		if (t === 'MANGA') return 'manga';
		if (t === 'WEBTOON') return 'webtoon';
		return 'comic';
	}

	private mapStatus(raw?: string | null): string {
		const s = String(raw || 'ONGOING').toUpperCase();
		const map: Record<string, string> = {
			ONGOING: 'Ongoing',
			COMPLETED: 'Completed',
			HIATUS: 'Hiatus',
			DROPPED: 'Dropped',
			DISCONTINUED: 'Dropped',
			UPCOMING: 'Upcoming'
		};
		return map[s] || 'Ongoing';
	}

	private mapListItem(item: any): Manga | null {
		const slug = item?.slug;
		if (!slug) return null;

		const latestChapter =
			item?.chapter_count != null ? String(item.chapter_count) : undefined;

		return {
			id: this.toMangaId(slug),
			sourceId: this.id,
			title: String(item.title || slug).trim(),
			cover: item.cover_image || '',
			type: this.mapType(item.type),
			status: this.mapStatus(item.status),
			latestChapter,
			lang: this.DEFAULT_LANG,
			updatedAt: item.updated_at ? Date.parse(item.updated_at) || undefined : undefined
		};
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const res = await this.apiGet<{
				data?: any[];
				pagination?: { has_more?: boolean };
			}>(
				`/series?type=comic&sort=latest&page=${p}&limit=${this.PER_PAGE}`
			);

			const list = (res?.data || [])
				.map((it) => this.mapListItem(it))
				.filter(Boolean) as Manga[];

			console.log(`[kaynscans] latest page=${p} → ${list.length} items`);
			return list;
		} catch (e) {
			console.error('[kaynscans] getLatestManga', e);
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
	
			const res = await this.apiGet<{ data?: any[] }>(
				`/search?q=${encodeURIComponent(q)}&limit=20`
			);

			const list = (res?.data || [])
				.filter((it) => {
					const t = String(it?.type || '').toUpperCase();
					return t !== 'NOVEL' && t !== 'WEBNOVEL';
				})
				.map((it) => this.mapListItem(it))
				.filter(Boolean) as Manga[];

			console.log(`[kaynscans] search "${q}" → ${list.length} items`);
			return list;
		} catch (e) {
			console.error('[kaynscans] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) throw new Error('KaynScans: invalid mangaId');

		const data = await this.apiGet<any>(`/series/${encodeURIComponent(slug)}`);
		if (!data?.slug) throw new Error(`KaynScans: series not found → ${slug}`);

		const authors: string[] = [];
		if (data.author) {
			authors.push(
				...String(data.author)
					.split(/[,&]/)
					.map((s: string) => s.trim())
					.filter(Boolean)
			);
		}
		if (data.artist && String(data.artist) !== String(data.author)) {
			authors.push(
				...String(data.artist)
					.split(/[,&]/)
					.map((s: string) => s.trim())
					.filter(Boolean)
			);
		}
		const uniqueAuthors = [...new Set(authors)];

		const genres: string[] = Array.isArray(data.genres)
			? data.genres.map((g: any) => String(g).trim()).filter(Boolean)
			: [];

		const chapters: Chapter[] = [];
		const rawChapters = Array.isArray(data.chapters) ? data.chapters : [];
		for (const ch of rawChapters) {
			const num = Number(ch.number);
			if (Number.isNaN(num)) continue;
			const isPremium = !!ch.is_premium;
			const title =
				ch.title && String(ch.title).trim()
					? String(ch.title).trim()
					: `Chapter ${num}`;

			chapters.push({
				id: this.toChapterId(slug, num),
				title: isPremium ? `${title} 🔒` : title,
				number: num,
				date: this.formatDate(ch.published_at)
			});
		}

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const description = data.description
			? String(data.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
			: '';

		const latestChapter =
			chapters.length > 0
				? String(chapters[0].number)
				: data.chapter_count != null
					? String(data.chapter_count)
					: undefined;

		return {
			id: this.toMangaId(data.slug || slug),
			sourceId: this.id,
			title: String(data.title || slug).trim(),
			cover: data.cover_image || data.banner_image || '',
			type: this.mapType(data.type),
			status: this.mapStatus(data.status),
			latestChapter,
			lang: this.DEFAULT_LANG,
			description,
			authors: uniqueAuthors,
			genres,
			chapters
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		try {
			const { slug, number } = this.extractChapterParts(chapterId);
			if (!slug || !number) {
				console.warn('[kaynscans] getChapterPages: bad chapterId', chapterId);
				return [];
			}

			const path = `/series/comic/${encodeURIComponent(slug)}/chapter/${encodeURIComponent(number)}`;
			const html = await this.fetchHtml(path);

			const re =
				/uploads\/series\/[^"'\\\s]+\/(?:p-[\w-]+|p\d+)\.(?:webp|jpg|jpeg|png|avif)/gi;
			const seen = new Set<string>();
			const pages: string[] = [];

			let m: RegExpExecArray | null;
			while ((m = re.exec(html)) !== null) {
				const rel = m[0].replace(/\\/g, '');
				if (seen.has(rel)) continue;
				seen.add(rel);
				pages.push(`${this.baseUrl}/${rel}`);
			}

			console.log(
				`[kaynscans] getChapterPages ${slug} ch${number} → ${pages.length} pages`
			);
			return pages;
		} catch (e) {
			console.error('[kaynscans] getChapterPages', e);
			return [];
		}
	}
}

