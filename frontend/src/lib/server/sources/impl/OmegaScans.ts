import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';

/**
 * Omega Scans adapter (api.omegascans.org + HTML chapter pages)
 *
 * List/Search : GET https://api.omegascans.org/query?...
 * Detail      : GET https://api.omegascans.org/series/{slug}
 * Chapters    : GET https://api.omegascans.org/chapter/query?series_id=&perPage=&page=
 * Pages       : scrape /series/{slug}/{chapter_slug}  → media.omegascans.org image URLs
 */

export class OmegaScansSource extends BaseSource {
	id = 'omegascans';
	name = 'Omega Scans';
	baseUrl = 'https://omegascans.org';
	private readonly apiBase = 'https://api.omegascans.org';
	private readonly PER_PAGE = 24;
	private readonly LIST_LANG = 'en';

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
			throw new Error(`OmegaScans HTTP ${res.status} → ${url}`);
		}
		return (await res.json()) as T;
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private toMangaId(slug: string): string {
		return `/${String(slug).replace(/^\/+|\/+$/g, '')}`;
	}

	private extractSlug(id: string): string {
		const parts = String(id)
			.replace(/^\/+/, '')
			.split('/')
			.filter(Boolean);
		return parts[0] || '';
	}

	private toChapterId(seriesSlug: string, chapterSlug: string): string {
		const s = String(seriesSlug).replace(/^\/+|\/+$/g, '');
		const c = String(chapterSlug).replace(/^\/+|\/+$/g, '');
		return `/${s}/${c}`;
	}

	private extractChapterSlug(chapterId: string): string {
		const parts = String(chapterId)
			.replace(/^\/+/, '')
			.split('/')
			.filter(Boolean);
		return parts.length >= 2 ? parts.slice(1).join('/') : parts[0] || '';
	}

	private formatDate(iso?: string | null): string {
		if (!iso) return '';
		try {
			return new Date(iso).toISOString().slice(0, 10);
		} catch {
			return String(iso).slice(0, 10);
		}
	}

	private parseChapterNumber(name: string, index?: string | number): number {
		if (index != null && index !== '') {
			const n = parseFloat(String(index));
			if (!Number.isNaN(n)) return n;
		}
		const m = String(name || '').match(/(\d+(?:\.\d+)?)/);
		return m ? parseFloat(m[1]) : 0;
	}

	private toShortChapter(name?: string | null, index?: string | number): string {
		if (index != null && index !== '') {
			const n = parseFloat(String(index));
			if (!Number.isNaN(n)) return String(n);
		}
		if (!name) return '';
		const cleaned = String(name).replace(/^ch\.?\s*/i, '').trim();
		const m = cleaned.match(/(\d+(?:\.\d+)?)/);
		return m ? m[1] : cleaned;
	}

	private mapListItem(item: any): Manga | null {
		const slug = item?.series_slug;
		if (!slug) return null;

		const free = item?.free_chapters?.[0];
		const paid = item?.paid_chapters?.[0];
		const latestSrc = free || paid;

		const latestChapter = this.toShortChapter(
			latestSrc?.chapter_name || item?.latest_chapter,
			latestSrc?.index
		);

		return {
			id: this.toMangaId(slug),
			sourceId: this.id,
			title: String(item.title || slug).trim(),
			cover: item.thumbnail || '',
			type:
				String(item.series_type || 'Comic').toLowerCase() === 'novel'
					? 'novel'
					: 'manhwa',
			status: item.status || 'Ongoing',
			latestChapter: latestChapter || undefined,
			lang: this.LIST_LANG
		};
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const apiPage1 = (p - 1) * 2 + 1;
			const apiPage2 = apiPage1 + 1;

			const [res1, res2] = await Promise.all([
				this.apiGet<{ data?: any[] }>(
					`/query?page_size=12&page=${apiPage1}&query_comics=true&order=desc&orderBy=latest`
				),
				this.apiGet<{ data?: any[] }>(
					`/query?page_size=12&page=${apiPage2}&query_comics=true&order=desc&orderBy=latest`
				)
			]);

			const list = [...(res1?.data || []), ...(res2?.data || [])]
				.map((it) => this.mapListItem(it))
				.filter(Boolean) as Manga[];

			console.log(`[omegascans] latest page=${p} → ${list.length} items`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[omegascans] getLatestManga', e);
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
			const apiPage1 = (page - 1) * 2 + 1;
			const apiPage2 = apiPage1 + 1;

			const [res1, res2] = await Promise.all([
				this.apiGet<{ data?: any[] }>(
					`/query?query_string=${encodeURIComponent(q)}&page=${apiPage1}&page_size=12&query_comics=true`
				),
				this.apiGet<{ data?: any[] }>(
					`/query?query_string=${encodeURIComponent(q)}&page=${apiPage2}&page_size=12&query_comics=true`
				)
			]);

			const list = [...(res1?.data || []), ...(res2?.data || [])]
				.map((it) => this.mapListItem(it))
				.filter(Boolean) as Manga[];

			console.log(`[omegascans] search "${q}" → ${list.length} items`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[omegascans] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) throw new Error(`Invalid omegascans id: ${mangaId}`);

		const data = await this.apiGet<any>(`/series/${encodeURIComponent(slug)}`);
		if (!data?.series_slug && !data?.title) {
			throw new Error(`Manga not found: ${slug}`);
		}

		const finalSlug = String(data.series_slug || slug);
		const seriesId = data.id;
		const title = String(data.title || finalSlug).trim();
		const altRaw = String(data.alternative_names || '').trim();
		const altTitles = altRaw
			? altRaw
					.split(/[,;|]/)
					.map((s: string) => s.trim())
					.filter(Boolean)
			: [];

		const genres = (data.tags || [])
			.map((t: any) => String(t?.name || '').trim())
			.filter(Boolean);

		const authors: string[] = [];
		if (data.author) {
			authors.push(
				...String(data.author)
					.split(/[,&]/)
					.map((s: string) => s.trim())
					.filter(Boolean)
			);
		}
		if (data.studio) authors.push(String(data.studio).trim());
		const uniqueAuthors = [...new Set(authors)];

		const rating5 = data.rating != null ? Number(data.rating) : null;
		const rating10 =
			rating5 != null && !Number.isNaN(rating5)
				? (rating5 * 2).toFixed(1)
				: null;

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		if (seriesId) {
			let page = 1;
			const perPage = 100;
			let lastPage = 1;
			do {
				const chRes = await this.apiGet<{
					meta?: { last_page?: number };
					data?: any[];
				}>(
					`/chapter/query?page=${page}&perPage=${perPage}&series_id=${seriesId}`
				);
				lastPage = Number(chRes?.meta?.last_page) || 1;
				for (const ch of chRes?.data || []) {
					const cslug = String(ch.chapter_slug || '');
					if (!cslug || seen.has(cslug)) continue;
					seen.add(cslug);

					const num = this.parseChapterNumber(ch.chapter_name, ch.index);
					const price = Number(ch.price) || 0;
					const isPaid = price > 0;
					const name = ch.chapter_name
						? String(ch.chapter_name)
						: `Chapter ${num || cslug}`;

					chapters.push({
						id: this.toChapterId(finalSlug, cslug),
						title: isPaid ? `${name} 🔒` : name,
						number: num || chapters.length + 1,
						date: this.formatDate(ch.created_at || ch.free_at),
						cover: ch.chapter_thumbnail || undefined
					});
				}
				page++;
			} while (page <= lastPage && page <= 20);
		}

		chapters.sort((a, b) => (a.number || 0) - (b.number || 0));

		const synopsis = data.description
			? String(data.description).replace(/\s+/g, ' ').trim()
			: '';

		const metaLines = [
			altTitles.length && `Alternative: ${altTitles.join(' · ')}`,
			rating10 && `Rating: ${rating10}`,
			uniqueAuthors[0] && `Author: ${uniqueAuthors[0]}`,
			data.series_type && `Type: ${data.series_type}`,
			data.release_year && `Publication: ${data.release_year}`
		].filter(Boolean);

		const description = [...metaLines, synopsis].filter(Boolean).join('\n');

		const latestCh =
			chapters.length > 0
				? this.toShortChapter(
						chapters[chapters.length - 1]?.title,
						chapters[chapters.length - 1]?.number
					)
				: data.meta?.chapters_count;

		return {
			id: this.toMangaId(finalSlug),
			sourceId: this.id,
			title,
			cover: data.thumbnail || '',
			type:
				String(data.series_type || 'Comic').toLowerCase() === 'novel'
					? 'novel'
					: 'manhwa',
			status: data.status || 'Ongoing',
			description,
			authors: uniqueAuthors,
			genres,
			chapters,
			latestChapter: latestCh
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const seriesSlug = this.extractSlug(chapterId);
		const chapterSlug = this.extractChapterSlug(chapterId);
		if (!seriesSlug || !chapterSlug) {
			console.error('[omegascans] getChapterPages → bad id:', chapterId);
			return [];
		}

		const path = `/series/${encodeURIComponent(seriesSlug)}/${encodeURIComponent(chapterSlug)}`;
		try {
			const html = await this.fetchHtml(path);
			const re =
				/https:\/\/media\.omegascans\.org\/[^"'\s>]+\.(?:jpg|jpeg|png|webp)/gi;
			const found = html.match(re) || [];

			const urls: string[] = [];
			const seen = new Set<string>();
			for (const u of found) {
				if (!u.includes('/uploads/series/')) continue;
				if (seen.has(u)) continue;
				seen.add(u);
				urls.push(u);
			}

			urls.sort((a, b) => {
				const na = a.match(/\/(\d{2,4})[-_]/)?.[1] || '0';
				const nb = b.match(/\/(\d{2,4})[-_]/)?.[1] || '0';
				return parseInt(na, 10) - parseInt(nb, 10);
			});

			console.log(
				`[omegascans] ${urls.length} pages → ${seriesSlug}/${chapterSlug}`
			);
			return urls;
		} catch (e) {
			console.error('[omegascans] getChapterPages failed', chapterId, e);
			return [];
		}
	}
}
