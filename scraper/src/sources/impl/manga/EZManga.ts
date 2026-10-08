/**
 * EZManga adapter (ezmanga.org)
 *
 * Theme     : EZManhwa custom API
 * API base  : https://vapi.ezmanga.org/api/v1
 * Latest    : GET /series?page=&perPage=24&sort=latest
 * Popular   : GET /series?page=&perPage=24&sort=popular
 * Search    : GET /series/search?page=&perPage=24&q=
 * Detail    : GET /series/{slug}
 * Chapters  : GET /series/{slug}/chapters?page=&perPage=100&sort=desc
 * Pages     : GET /series/{slug}/chapters/{chapterSlug} → images[].url
 *
 * Site HTML is Cloudflare-blocked; API works with Origin/Referer.
 *
 * ID format:
 *   manga   : /series/{slug}
 *   chapter : /series/{slug}/{chapterSlug}
 */

import { BaseSource } from '../../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';

export class EZMangaSource extends BaseSource {
	id = 'ezmanga';
	name = 'EZManga';
	baseUrl = 'https://ezmanga.org';
	private readonly apiBase = 'https://vapi.ezmanga.org/api/v1';
	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'en';

	// ── HTTP ─────────────────────────────────────────────────────────────────

	private async apiGet<T = any>(path: string): Promise<T> {
		const url = path.startsWith('http') ? path : `${this.apiBase}${path}`;
		const res = await fetch(url, {
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
				Accept: 'application/json, text/plain, */*',
				'Accept-Language': 'en-US,en;q=0.9',
				Referer: `${this.baseUrl}/`,
				Origin: this.baseUrl
			}
		});
		if (!res.ok) {
			throw new Error(`EZManga HTTP ${res.status} → ${url}`);
		}
		return (await res.json()) as T;
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private toMangaId(slug: string): string {
		return `/series/${String(slug).replace(/^\/+|\/+$/g, '')}`;
	}

	private extractSlug(id: string): string {
		const parts = String(id)
			.replace(/^\/+/, '')
			.split('/')
			.filter(Boolean);
		if (parts[0] === 'series' && parts[1]) return parts[1];
		return parts[0] || '';
	}

	private toChapterId(seriesSlug: string, chapterSlug: string): string {
		const s = String(seriesSlug).replace(/^\/+|\/+$/g, '');
		const c = String(chapterSlug).replace(/^\/+|\/+$/g, '');
		return `/series/${s}/${c}`;
	}

	private parseChapterParts(chapterId: string): {
		seriesSlug: string;
		chapterSlug: string;
	} {
		const parts = String(chapterId)
			.replace(/^\/+/, '')
			.split('/')
			.filter(Boolean);
		if (parts[0] === 'series' && parts.length >= 3) {
			if (parts[2] === 'chapters' && parts[3]) {
				return { seriesSlug: parts[1], chapterSlug: parts[3] };
			}
			return { seriesSlug: parts[1], chapterSlug: parts.slice(2).join('/') };
		}
		return { seriesSlug: parts[0] || '', chapterSlug: parts[1] || '' };
	}

	private formatDate(iso?: string | null): string {
		if (!iso) return '';
		try {
			return new Date(iso).toISOString().slice(0, 10);
		} catch {
			return String(iso).slice(0, 10);
		}
	}

	private stripHtml(html: string): string {
		return String(html || '')
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/p>/gi, '\n')
			.replace(/<[^>]+>/g, '')
			.replace(/&nbsp;/g, ' ')
			.replace(/&amp;/g, '&')
			.replace(/&quot;/g, '"')
			.replace(/&#039;/g, "'")
			.replace(/\n{3,}/g, '\n\n')
			.replace(/\s+/g, ' ')
			.trim();
	}

	private mapType(t?: string | null): string {
		const s = String(t || '').toUpperCase();
		if (s === 'MANHUA') return 'manhua';
		if (s === 'MANGA') return 'manga';
		if (s === 'NOVEL') return 'novel';
		return 'manhwa';
	}

	private mapStatus(t?: string | null): string {
		const s = String(t || '').toUpperCase();
		if (s === 'COMPLETED') return 'Completed';
		if (s === 'HIATUS') return 'Hiatus';
		if (s === 'DROPPED') return 'Dropped';
		return 'Ongoing';
	}

	private mapListItem(item: any): Manga | null {
		const slug = item?.slug;
		if (!slug) return null;
		if (String(item?.type || '').toUpperCase() === 'NOVEL') return null;

		return {
			id: this.toMangaId(slug),
			sourceId: this.id,
			title: String(item.title || slug).trim(),
			cover: item.cover || '',
			type: this.mapType(item.type),
			status: this.mapStatus(item.status),
			lang: this.DEFAULT_LANG
		};
	}

	private async attachLatestChapter(manga: Manga): Promise<Manga> {
		const slug = this.extractSlug(manga.id);
		if (!slug) return manga;
		try {
			const chRes = await this.apiGet<{ data?: { number?: number }[] }>(
				`/series/${encodeURIComponent(slug)}/chapters?page=1&perPage=1&sort=desc`
			);
			const n = chRes?.data?.[0]?.number;
			if (n != null && !Number.isNaN(Number(n))) {
				manga.latestChapter = String(n);
			}
		} catch {
		}
		return manga;
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const data = await this.apiGet<{ data?: any[] }>(
				`/series?page=${p}&perPage=${this.PER_PAGE}&sort=latest`
			);
			const base = (data?.data || [])
				.map((it) => this.mapListItem(it))
				.filter(Boolean) as Manga[];
			const list = await Promise.all(
				base.map((m) => this.attachLatestChapter(m))
			);
			console.log(`[ezmanga] latest page=${p} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[ezmanga] getLatestManga', e);
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
			const data = await this.apiGet<{ data?: any[] }>(
				`/series/search?page=${page}&perPage=${this.PER_PAGE}&q=${encodeURIComponent(q)}`
			);
			const base = (data?.data || [])
				.map((it) => this.mapListItem(it))
				.filter(Boolean) as Manga[];
			const list = await Promise.all(
				base.map((m) => this.attachLatestChapter(m))
			);
			console.log(`[ezmanga] search "${q}" page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[ezmanga] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) throw new Error(`Invalid ezmanga id: ${mangaId}`);

		const data = await this.apiGet<any>(`/series/${encodeURIComponent(slug)}`);
		if (!data?.slug && !data?.title) {
			throw new Error(`Manga not found: ${slug}`);
		}

		const finalSlug = String(data.slug || slug);
		const title = String(data.title || finalSlug).trim();
		const altRaw = String(data.alternativeTitles || '').trim();
		const altTitles = altRaw
			? altRaw
					.split(/[,;]/)
					.map((s: string) => s.trim())
					.filter(Boolean)
			: [];

		const genres = (data.genres || [])
			.map((g: any) => String(g?.name || '').trim())
			.filter(Boolean);

		const authors: string[] = [];
		for (const key of ['author', 'artist']) {
			const v = data[key];
			if (v && String(v).trim()) {
				for (const part of String(v).split(/[,&]/)) {
					const a = part.trim();
					if (a && !authors.includes(a)) authors.push(a);
				}
			}
		}

		const rating =
			data.avgRating != null && !Number.isNaN(Number(data.avgRating))
				? Number(data.avgRating).toFixed(1)
				: data.stats?.avgRating != null
					? Number(data.stats.avgRating).toFixed(1)
					: null;

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		let page = 1;
		let totalPages = 1;
		do {
			const chRes = await this.apiGet<{
				data?: any[];
				totalPages?: number;
				current?: number;
			}>(
				`/series/${encodeURIComponent(finalSlug)}/chapters?page=${page}&perPage=100&sort=asc`
			);
			totalPages = Number(chRes?.totalPages) || 1;
			for (const ch of chRes?.data || []) {
				const cslug = String(ch.slug || '');
				if (!cslug || seen.has(cslug)) continue;
				seen.add(cslug);

				const number = ch.number != null ? Number(ch.number) : 0;
				const locked = ch.requiresPurchase === true;
				const cleanTitle = locked
					? `Chapter ${number || cslug} `
					: `Chapter ${number || cslug}`;

				chapters.push({
					id: this.toChapterId(finalSlug, cslug),
					title: cleanTitle,
					number: number || chapters.length + 1,
					date: this.formatDate(ch.createdAt),
					isLocked: locked || undefined
				});
			}
			page++;
		} while (page <= totalPages && page <= 30);

		chapters.sort((a, b) => (a.number || 0) - (b.number || 0));

		const synopsis = this.stripHtml(data.description || '');
		const metaLines = [
			altTitles.length && `Alternative: ${altTitles.join(' · ')}`,
			rating && `Rating: ${rating}`,
			authors[0] && `Author: ${authors[0]}`,
			data.artist &&
				data.artist !== authors[0] &&
				`Artist: ${data.artist}`,
			data.type && `Type: ${data.type}`,
			data.releaseDate && `Release: ${String(data.releaseDate).slice(0, 10)}`
		].filter(Boolean);

		const description = [...metaLines, synopsis].filter(Boolean).join('\n');

		return {
			id: this.toMangaId(finalSlug),
			sourceId: this.id,
			title,
			cover: data.cover || '',
			type: this.mapType(data.type),
			status: this.mapStatus(data.status),
			description,
			authors,
			genres,
			chapters,
			latestChapter:
				chapters.length > 0
					? String(chapters[chapters.length - 1].number)
					: undefined
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const { seriesSlug, chapterSlug } = this.parseChapterParts(chapterId);
		if (!seriesSlug || !chapterSlug) {
			console.error('[ezmanga] getChapterPages → bad id:', chapterId);
			return [];
		}

		try {
			const data = await this.apiGet<{
				images?: { url: string; order?: number }[];
				requiresPurchase?: boolean;
			}>(
				`/series/${encodeURIComponent(seriesSlug)}/chapters/${encodeURIComponent(chapterSlug)}`
			);

			if (data?.requiresPurchase === true) {
				console.warn('[ezmanga] chapter locked:', chapterId);
				return [];
			}

			const images = data?.images || [];
			const urls = [...images]
				.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
				.map((img) => String(img.url || '').trim())
				.filter((u) => /^https?:\/\//i.test(u));

			console.log(
				`[ezmanga] ${urls.length} pages → ${seriesSlug}/${chapterSlug}`
			);
			return urls;
		} catch (e) {
			console.error('[ezmanga] getChapterPages failed', chapterId, e);
			return [];
		}
	}
}
