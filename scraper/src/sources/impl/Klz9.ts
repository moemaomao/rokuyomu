import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';

/**
 * klz9.com adapter (official JSON API + signed headers)
 *
 * List   : GET /api/manga?page=&limit=24
 * Search : GET /api/search?q=
 * Detail : GET /api/manga/slug/{slug}
 * Pages  : GET /api/chapter/{chapterId}  → content = image URLs
 *
 * ID format:
 *   manga   : "/{slug}"
 *   chapter : "/{slug}/c/{numericChapterId}"
 *
 */
export class Klz9Source extends BaseSource {
	id = 'klz9';
	name = 'KLZ9';
	baseUrl = 'https://klz9.com';

	private readonly PER_PAGE = 24;
	private readonly SECRET = 'KL9K40zaSyC9K40vOMLLbEcepIFBhUKXwELqxlwTEF';
	private readonly DEFAULT_LANG = 'ja';

	// ── Signed API ───────────────────────────────────────────────────────────

	private async signHeaders(): Promise<Record<string, string>> {
		const ts = Math.floor(Date.now() / 1000).toString();
		const msg = `${ts}.${this.SECRET}`;
		const data = new TextEncoder().encode(msg);
		const hash = await crypto.subtle.digest('SHA-256', data);
		const sig = Array.from(new Uint8Array(hash))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');

		return {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
			Accept: 'application/json',
			'Content-Type': 'application/json',
			'x-client-ts': ts,
			'x-client-sig': sig,
			'x-app-lang': 'en',
			Referer: `${this.baseUrl}/`,
			Origin: this.baseUrl
		};
	}

	private async apiGet<T = any>(path: string): Promise<T> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const headers = await this.signHeaders();
		const res = await fetch(url, { headers });
		if (!res.ok) {
			throw new Error(`KLZ9 HTTP ${res.status} → ${url}`);
		}
		return (await res.json()) as T;
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private toMangaId(slug: string): string {
		return `/${String(slug).replace(/^\/+|\/+$/g, '').replace(/\.html$/i, '')}`;
	}

	private extractSlug(id: string): string {
		const parts = String(id)
			.replace(/^\/+/, '')
			.replace(/\.html$/i, '')
			.split('/')
			.filter(Boolean);
	
		if (parts.length >= 3 && parts[1] === 'c') return parts[0];
	
		if (parts[0] === 'c') return '';
		return parts[0] || '';
	}

	private toChapterId(slug: string, numericId: string | number): string {
		const s = String(slug).replace(/^\/+|\/+$/g, '');
		return `/${s}/c/${numericId}`;
	}

	private extractChapterNumericId(chapterId: string): string {
		const s = String(chapterId).replace(/^\/+/, '');
		const m = s.match(/(?:(?:^|\/)c\/)(\d+)(?:\/)?$/) || s.match(/^(\d+)$/);
		return m?.[1] || '';
	}

	private mapStatus(mStatus: number | string | undefined): string {
		const n = Number(mStatus);
		if (n === 1) return 'Completed';
		return 'Ongoing';
	}

	private formatDate(iso?: string | null): string {
		if (!iso) return '';
		try {
			return new Date(iso).toISOString().slice(0, 10);
		} catch {
			return String(iso).slice(0, 10);
		}
	}

	private mapListItem(item: any): Manga | null {
		const slug = item?.slug;
		if (!slug) return null;
		return {
			id: this.toMangaId(slug),
			sourceId: this.id,
			title: String(item.name || slug).trim(),
			cover: item.cover || '',
			type: 'manga',
			status: this.mapStatus(item.m_status),
			latestChapter: item.last_chapter ?? undefined,
			lang: this.DEFAULT_LANG // flag Jepang di homepage
		};
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const data = await this.apiGet<{ items?: any[] }>(
				`/api/manga?page=${p}&limit=${this.PER_PAGE}`
			);
			const list = (data?.items || [])
				.map((it) => this.mapListItem(it))
				.filter(Boolean) as Manga[];
			console.log(`[klz9] latest page=${p} → ${list.length} items`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[klz9] getLatestManga', e);
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
			const data = await this.apiGet<any[]>(
				`/api/search?q=${encodeURIComponent(q)}`
			);
			const arr = Array.isArray(data) ? data : [];
			const list = arr
				.map((it) => this.mapListItem(it))
				.filter(Boolean) as Manga[];

			const start = (page - 1) * this.PER_PAGE;
			const pageItems = list.slice(start, start + this.PER_PAGE);
			console.log(`[klz9] search "${q}" → ${pageItems.length} items`);
			return pageItems;
		} catch (e) {
			console.error('[klz9] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) throw new Error(`Invalid klz9 id: ${mangaId}`);

		const data = await this.apiGet<any>(
			`/api/manga/slug/${encodeURIComponent(slug)}`
		);
		if (!data?.slug && !data?.name) {
			throw new Error(`Manga not found: ${slug}`);
		}

		const finalSlug = String(data.slug || slug);
		const title = String(data.name || finalSlug).trim();
		const altRaw = String(data.other_name || '').trim();
		const altTitles = altRaw
			? altRaw
					.split(',')
					.map((s: string) => s.trim())
					.filter(Boolean)
			: [];

		const lastUpdate = this.formatDate(data.last_update);
		const lastChapter = data.last_chapter;

		const genres = String(data.genres || '')
			.split(',')
			.map((s: string) => s.trim())
			.filter(Boolean);

		const authors = [data.authors, data.artists]
			.filter(Boolean)
			.flatMap((s: string) =>
				String(s)
					.split(',')
					.map((x) => x.trim())
					.filter(Boolean)
			);
		const uniqueAuthors = [...new Set(authors)];

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		for (const ch of data.chapters || []) {
			const cid = String(ch.id);
			if (!cid || seen.has(cid)) continue;
			seen.add(cid);
			const num = Number(ch.chapter) || 0;
			chapters.push({
				id: this.toChapterId(finalSlug, cid),
				title: ch.name ? String(ch.name) : `Chapter ${num || cid}`,
				number: num || chapters.length + 1,
				date: this.formatDate(ch.last_update),
				lang: this.DEFAULT_LANG
			});
		}

		chapters.sort((a, b) => (a.number || 0) - (b.number || 0));

		const description = [
			altTitles.length && `Alternative: ${altTitles.join(' · ')}`,
			lastUpdate && `Latest update: ${lastUpdate}`,
			lastChapter != null && `Latest chapter: ${lastChapter}`,
			data.description && String(data.description).replace(/\s+/g, ' ').trim()
		]
			.filter(Boolean)
			.join('\n\n');

		return {
			id: this.toMangaId(finalSlug),
			sourceId: this.id,
			title,
			cover: data.cover || '',
			type: 'manga',
			status: this.mapStatus(data.m_status),
			description,
			authors: uniqueAuthors,
			genres,
			chapters,
			lang: this.DEFAULT_LANG,
			latestChapter: lastChapter ?? chapters[chapters.length - 1]?.number
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const numericId = this.extractChapterNumericId(chapterId);
		if (!numericId) {
			console.error('[klz9] getChapterPages → empty id:', chapterId);
			return [];
		}

		try {
			const data = await this.apiGet<{ content?: string }>(
				`/api/chapter/${numericId}`
			);
			const raw = String(data?.content || '');
			if (!raw) return [];

			const urls = raw
				.split(/\r?\n/)
				.map((u) => u.trim())
				.filter((u) => /^https?:\/\//i.test(u));

			console.log(`[klz9] ${urls.length} pages → chapter ${numericId}`);
			return urls;
		} catch (e) {
			console.error('[klz9] getChapterPages failed', numericId, e);
			return [];
		}
	}
}
