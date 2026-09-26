/**
 * Lunarx / Lunar Manga adapter (lunarx.to)
 *
 * API base: https://api.lunarx.to
 *
 * Latest          : GET /api/manga/recently-updated?limit=&page=
 *                   GET /api/manga/recent?page=&limit=
 * Search          : GET /api/manga/search?q=&page=&limit=
 * Detail (meta)   : GET /api/manga/title/{slug}
 * Chapters        : GET /api/manga/{slug}
 * Pages           : GET /api/manga/{slug}/{chapter}
 *
 * Site URLs:
 *   manga   : https://lunarx.to/manga/{slug}
 *   chapter : https://lunarx.to/manga/{slug}/{chapter}
 *
 * ID format:
 *   manga   : /manga/{slug}
 *   chapter : /manga/{slug}/{chapter}
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';

export class LunarxSource extends BaseSource {
	id = 'lunarx';
	name = 'Lunarx';
	baseUrl = 'https://lunarx.to';

	private readonly apiBase = 'https://api.lunarx.to';
	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'en';

	// ── Helpers ──────────────────────────────────────────────────────────────

	private absUrl(url: string): string {
		if (!url) return '';
		if (url.startsWith('http')) return url;
		if (url.startsWith('//')) return `https:${url}`;
		return `${this.baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
	}

	private cleanId(link: string): string {
		let id = (link || '').trim();
		if (id.startsWith('http')) {
			try {
				id = new URL(id).pathname;
			} catch {
				/* ignore */
			}
		}
		if (!id.startsWith('/')) id = `/${id}`;
		// normalize /manga/slug/...
		id = id.replace(/\/+$/, '').split('?')[0] || '/';
		if (!id.startsWith('/manga/') && id !== '/') {
			id = `/manga${id.startsWith('/') ? '' : '/'}${id.replace(/^\//, '')}`;
		}
		return id;
	}

	private slugFromId(mangaId: string): string {
		const id = this.cleanId(mangaId);
		const parts = id.replace(/^\/manga\//, '').split('/').filter(Boolean);
		return parts[0] || '';
	}

	private chapterKeyFromId(chapterId: string): { slug: string; chapter: string } {
		const id = this.cleanId(chapterId);
		const parts = id.replace(/^\/manga\//, '').split('/').filter(Boolean);
		return {
			slug: parts[0] || '',
			chapter: parts.slice(1).join('/') || ''
		};
	}

	private parseGenres(raw: unknown): string[] {
		if (Array.isArray(raw)) {
			return raw.map((g) => String(g).trim()).filter(Boolean);
		}
		if (typeof raw === 'string') {
			const s = raw.trim();
			if (s.startsWith('[')) {
				try {
					const arr = JSON.parse(s);
					if (Array.isArray(arr)) {
						return arr.map((g) => String(g).trim()).filter(Boolean);
					}
				} catch {
					/* ignore */
				}
			}
			return s
				.split(/[,;|]/)
				.map((g) => g.trim())
				.filter(Boolean);
		}
		return [];
	}

	private parseAltTitles(raw: unknown): string {
		if (!raw) return '';
		if (Array.isArray(raw)) return raw.filter(Boolean).join(' · ');
		if (typeof raw === 'string') {
			const s = raw.trim();
			if (s.startsWith('[')) {
				try {
					const arr = JSON.parse(s);
					if (Array.isArray(arr)) return arr.filter(Boolean).join(' · ');
				} catch {
					/* ignore */
				}
			}
			return s;
		}
		return String(raw);
	}

	private mapStatus(raw?: string | null): string {
		const s = String(raw || '').toLowerCase();
		if (/\b(completed|complete|tamat|selesai|end|finish)\b/.test(s)) return 'Completed';
		if (/\bhiatus\b/.test(s)) return 'Hiatus';
		if (/\b(cancelled|dropped|canceled)\b/.test(s)) return 'Cancelled';
		if (/\b(ongoing|publishing)\b/.test(s)) return 'Ongoing';
		return 'Ongoing';
	}

	private mapType(genres: string[], demographic?: string): string {
		const all = [...genres, demographic || ''].join(' ').toLowerCase();
		if (/\bmanhwa\b/.test(all)) return 'manhwa';
		if (/\bmanhua\b/.test(all)) return 'manhua';
		if (/\bmanga\b/.test(all)) return 'manga';
		return 'manga';
	}

	private parseChapterNumber(ch: string | number | null | undefined): number {
		if (ch == null || ch === '') return NaN;
		if (typeof ch === 'number') return ch;
		const m = String(ch).match(/(\d+(?:\.\d+)?)/);
		return m ? parseFloat(m[1]) : NaN;
	}

	private formatDate(iso?: string | null): string {
		if (!iso) return '';
		const d = new Date(iso);
		if (isNaN(d.getTime())) return String(iso).slice(0, 10);
		const y = d.getFullYear();
		const mo = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${y}-${mo}-${day}`;
	}

	private async apiGet<T = any>(path: string): Promise<T> {
		const url = path.startsWith('http') ? path : `${this.apiBase}${path.startsWith('/') ? '' : '/'}${path}`;
		const res = await fetch(url, {
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				Accept: 'application/json',
				Origin: this.baseUrl,
				Referer: `${this.baseUrl}/`
			}
		});
		if (!res.ok) {
			throw new Error(`Lunarx API ${res.status}: ${url}`);
		}
		return (await res.json()) as T;
	}

	private mapListItem(item: any): Manga | null {
		const slug = String(item?.slug || '').trim();
		if (!slug) return null;

		const title = String(item?.title || slug).trim();
		const cover = this.absUrl(item?.cover_url || item?.poster_url || '');
		const genres = this.parseGenres(item?.genres);
		const type = this.mapType(genres, item?.demographic);
		const status = this.mapStatus(item?.publication_status);

		let latestChapter: number | undefined;
		if (item?.chapter_count != null) {
			const n = Number(item.chapter_count);
			if (!Number.isNaN(n) && n > 0) latestChapter = n;
		} else if (Array.isArray(item?.chapters) && item.chapters.length) {
			const n = this.parseChapterNumber(item.chapters[0]?.chapter);
			if (Number.isFinite(n)) latestChapter = n;
		}

		return {
			id: `/manga/${slug}`,
			sourceId: this.id,
			title,
			cover,
			type,
			status,
			latestChapter,
			lang: this.DEFAULT_LANG
		};
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			// recently-updated: bagus untuk "latest", support page via offset-style
			// API also has /api/manga/recent?page=&limit=
			const data = await this.apiGet<any>(
				`/api/manga/recent?page=${p}&limit=${this.PER_PAGE}`
			);

			const list: any[] =
				data?.our_mangas ||
				data?.manga ||
				data?.data ||
				(Array.isArray(data) ? data : []);

			const out: Manga[] = [];
			const seen = new Set<string>();
			for (const item of list) {
				const m = this.mapListItem(item);
				if (!m || seen.has(m.id)) continue;
				seen.add(m.id);
				out.push(m);
			}

			console.log(`[lunarx] latest page=${p} → ${out.length}`);
			return out.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[lunarx] getLatestManga', e);
			// fallback recently-updated (no page param reliability)
			try {
				const data = await this.apiGet<any>(
					`/api/manga/recently-updated?limit=${this.PER_PAGE}`
				);
				const list: any[] = data?.data || [];
				return list
					.map((item) => this.mapListItem(item))
					.filter((m): m is Manga => !!m)
					.slice(0, this.PER_PAGE);
			} catch (e2) {
				console.error('[lunarx] getLatestManga fallback', e2);
				return [];
			}
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
			const params = new URLSearchParams({
				q,
				page: String(page),
				limit: String(this.PER_PAGE)
			});
			const data = await this.apiGet<any>(`/api/manga/search?${params}`);
			const list: any[] = data?.manga || data?.data || [];

			const out: Manga[] = [];
			const seen = new Set<string>();
			for (const item of list) {
				const m = this.mapListItem(item);
				if (!m || seen.has(m.id)) continue;
				seen.add(m.id);
				out.push(m);
			}

			console.log(`[lunarx] search "${q}" page=${page} → ${out.length}`);
			return out.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[lunarx] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const slug = this.slugFromId(mangaId);
		if (!slug) throw new Error(`Invalid lunarx id: ${mangaId}`);

		const [titleRes, chaptersRes] = await Promise.all([
			this.apiGet<any>(`/api/manga/title/${encodeURIComponent(slug)}`),
			this.apiGet<any>(`/api/manga/${encodeURIComponent(slug)}`)
		]);

		const meta = titleRes?.manga || titleRes?.data || titleRes || {};
		const title = String(meta.title || slug).trim();
		const cover = this.absUrl(meta.cover_url || meta.banner_url || '');
		const description = String(meta.description || '')
			.replace(/\r\n/g, '\n')
			.replace(/\s+\n/g, '\n')
			.trim();

		const genres = this.parseGenres(meta.genres);
		const type = this.mapType(genres, meta.demographic);
		const status = this.mapStatus(meta.publication_status);

		const authors: string[] = [];
		if (meta.author) {
			String(meta.author)
				.split(/[,&/]/)
				.map((s: string) => s.trim())
				.filter(Boolean)
				.forEach((a: string) => {
					if (!authors.includes(a)) authors.push(a);
				});
		}
		const artists: string[] = [];
		if (meta.artist) {
			String(meta.artist)
				.split(/[,&/]/)
				.map((s: string) => s.trim())
				.filter(Boolean)
				.forEach((a: string) => {
					if (!artists.includes(a)) artists.push(a);
				});
		}

		const year =
			meta.publication_year != null ? String(meta.publication_year) : '';
		const alt = this.parseAltTitles(meta.alternative_titles);
		const rating =
			meta.rating && !/^(PG|R|G|NC)/i.test(String(meta.rating))
				? String(meta.rating)
				: '';

		// Chapters
		const rawChapters: any[] = chaptersRes?.data || [];
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		for (const ch of rawChapters) {
			if (ch?.is_coming_soon) continue;
			const chKey = String(ch.chapter ?? ch.chapter_number ?? '').trim();
			if (!chKey) continue;

			const id = `/manga/${slug}/${chKey}`;
			if (seen.has(id)) continue;
			seen.add(id);

			const number =
				ch.chapter_number != null
					? Number(ch.chapter_number) +
						(ch.chapter_subnumber != null
							? Number(`0.${ch.chapter_subnumber}`)
							: 0)
					: this.parseChapterNumber(chKey);

			const num = Number.isFinite(number) ? number : chapters.length + 1;
			const extraTitle = String(ch.chapter_title || '').trim();
			const chapterTitle = extraTitle
				? `Chapter ${chKey}: ${extraTitle}`
				: `Chapter ${chKey}`;

			chapters.push({
				id,
				title: chapterTitle,
				number: num,
				date: this.formatDate(ch.uploaded_at),
				lang: ch.language || this.DEFAULT_LANG
			});
		}

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const latestChapter =
			chapters.length && chapters[0].number != null
				? String(chapters[0].number)
				: undefined;

		const allCreators = [...authors];
		for (const a of artists) {
			if (!allCreators.includes(a)) allCreators.push(a);
		}

		// UI parseMeta: Publication / Author / Artist / Type / Language / Alternative
		const metaLines = [
			alt && `Alternative: ${alt}`,
			rating && `Rating: ${rating}`,
			authors.length && `Author: ${authors.join(' · ')}`,
			artists.length && `Artist: ${artists.join(' · ')}`,
			year && `Publication: ${year}`,
			meta.publisher && `Publisher: ${meta.publisher}`,
			meta.serialization && `Serialization: ${meta.serialization}`,
			meta.demographic && `Demographic: ${meta.demographic}`,
			chapters[0]?.date && `Updated: ${chapters[0].date}`,
			`Language: ${this.DEFAULT_LANG}`,
			`Type: ${type}`
		].filter(Boolean);

		const fullDescription = [...metaLines, description]
			.filter(Boolean)
			.join('\n');

		// genres tanpa type keyword
		const cleanGenres = genres.filter(
			(g) => !/^(manhwa|manhua|manga)$/i.test(g)
		);

		console.log(
			`[lunarx] details ${slug} → ch=${chapters.length} status=${status} year=${year}`
		);

		return {
			id: `/manga/${slug}`,
			sourceId: this.id,
			title,
			cover,
			description: fullDescription,
			authors: allCreators,
			genres: cleanGenres,
			status,
			chapters,
			type,
			latestChapter
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const { slug, chapter } = this.chapterKeyFromId(chapterId);
		if (!slug || !chapter) {
			console.warn('[lunarx] invalid chapter id', chapterId);
			return [];
		}

		try {
			const data = await this.apiGet<any>(
				`/api/manga/${encodeURIComponent(slug)}/${encodeURIComponent(chapter)}`
			);
			const images: string[] = data?.data?.images || data?.images || [];

			const out: string[] = [];
			const seen = new Set<string>();
			for (const src of images) {
				const u = this.absUrl(String(src || '').trim());
				if (!u || seen.has(u) || !/^https?:\/\//i.test(u)) continue;
				if (/logo|icon|avatar|banner|placeholder/i.test(u)) continue;
				seen.add(u);
				out.push(u);
			}

			console.log(`[lunarx] ${out.length} pages → ${slug}/${chapter}`);
			return out;
		} catch (e) {
			console.error('[lunarx] getChapterPages', slug, chapter, e);
			return [];
		}
	}
}
