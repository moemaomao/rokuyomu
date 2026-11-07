/**
 * Family base: JSON API manga sources.
 * Subclass only fills endpoints + map* — keep adapters short.
 *
 * Path: scraper/src/sources/family/ApiJsonSource.ts
 */
import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types-manga';

export abstract class ApiJsonSource extends BaseSource {
	protected apiBase = '';
	protected perPage = 24;

	protected get apiRoot(): string {
		return (this.apiBase || this.baseUrl).replace(/\/+$/, '');
	}

	protected cleanId(link: string): string {
		let id = (link || '').trim();
		if (id.startsWith('http')) {
			try {
				id = new URL(id).pathname;
			} catch {
				/* ignore */
			}
		}
		if (!id.startsWith('/')) id = `/${id}`;
		return id.replace(/\/+$/, '').split('?')[0] || '/';
	}

	protected absUrl(url: string): string {
		if (!url) return '';
		if (url.startsWith('http')) return url;
		if (url.startsWith('//')) return `https:${url}`;
		return `${this.baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
	}

	protected parseChapterNumber(value: unknown): number {
		if (typeof value === 'number' && Number.isFinite(value)) return value;
		const s = String(value ?? '').trim();
		if (!s) return 0;
		const m =
			s.match(/(?:chapter|ch\.?|episode|ep\.?)\s*[.\-_:]?\s*(\d+(?:\.\d+)?)/i) ||
			s.match(/^(\d+(?:\.\d+)?)/);
		return m ? parseFloat(m[1]) : 0;
	}

	protected async apiGet<T = unknown>(
		path: string,
		params?: Record<string, string | number | boolean | undefined | null>
	): Promise<T> {
		const url = new URL(
			path.startsWith('http')
				? path
				: `${this.apiRoot}${path.startsWith('/') ? '' : '/'}${path}`
		);
		if (params) {
			for (const [k, v] of Object.entries(params)) {
				if (v === undefined || v === null || v === '') continue;
				url.searchParams.set(k, String(v));
			}
		}

		const headers: Record<string, string> = {
			...this.headers,
			Accept: 'application/json, text/plain, */*',
			Origin: this.baseUrl,
			Referer: `${this.baseUrl}/`
		};

		let lastErr: unknown;
		for (let attempt = 1; attempt <= 3; attempt++) {
			try {
				const res = await fetch(url.toString(), { headers });
				const text = await res.text();
				const trimmed = text.trim();
				if (trimmed.startsWith('<') || trimmed.toLowerCase().startsWith('<!doctype')) {
					lastErr = new Error(`API HTML block — ${url.pathname}`);
					if (attempt < 3) {
						await new Promise((r) => setTimeout(r, 400 * attempt));
						continue;
					}
					throw lastErr;
				}
				if (!res.ok) {
					if ((res.status === 429 || res.status === 503) && attempt < 3) {
						await new Promise((r) => setTimeout(r, 600 * attempt));
						continue;
					}
					throw new Error(`API ${res.status} — ${url}`);
				}
				return JSON.parse(trimmed) as T;
			} catch (e) {
				lastErr = e;
				if (attempt < 3) await new Promise((r) => setTimeout(r, 300 * attempt));
			}
		}
		throw lastErr;
	}

	protected extractList(raw: unknown): unknown[] {
		if (Array.isArray(raw)) return raw;
		if (raw && typeof raw === 'object') {
			const o = raw as Record<string, unknown>;
			for (const k of ['data', 'results', 'items', 'comics', 'series', 'list', 'units']) {
				if (Array.isArray(o[k])) return o[k] as unknown[];
				if (o[k] && typeof o[k] === 'object') {
					const inner = o[k] as Record<string, unknown>;
					for (const k2 of ['data', 'items', 'results', 'units']) {
						if (Array.isArray(inner[k2])) return inner[k2] as unknown[];
					}
				}
			}
		}
		return [];
	}

	// ── hooks subclasses MUST implement ────────────────────────────────────

	protected abstract mapListItem(raw: unknown): Manga | null;
	protected abstract mapDetails(raw: unknown, mangaId: string): MangaDetails;
	protected abstract mapChapters(raw: unknown, mangaId: string): Chapter[];
	protected abstract mapPages(raw: unknown, chapterId: string): string[];

	protected abstract latestEndpoint(page: number): {
		path: string;
		params?: Record<string, string | number>;
	};
	protected abstract searchEndpoint(
		query: string,
		page: number
	): { path: string; params?: Record<string, string | number> };
	protected abstract detailEndpoint(mangaId: string): string;
	protected abstract pagesEndpoint(chapterId: string): string;

	protected chaptersEndpoint?(mangaId: string): {
		path: string;
		params?: Record<string, string | number>;
	};

	protected async fetchAllChapters(mangaId: string): Promise<Chapter[]> {
		if (!this.chaptersEndpoint) return [];
		const ep = this.chaptersEndpoint(mangaId);
		const raw = await this.apiGet(ep.path, ep.params);
		return this.mapChapters(raw, mangaId);
	}

	protected sliceLatest(list: Manga[], _page: number): Manga[] {
		return list.slice(0, this.perPage);
	}

	// ── default flows ──────────────────────────────────────────────────────

	async getLatestManga(page: number): Promise<Manga[]> {
		const p = Math.max(1, page || 1);
		const { path, params } = this.latestEndpoint(p);
		const raw = await this.apiGet(path, params);
		const seen = new Set<string>();
		const list: Manga[] = [];
		for (const item of this.extractList(raw)) {
			const m = this.mapListItem(item);
			if (!m || seen.has(m.id)) continue;
			seen.add(m.id);
			list.push(m);
		}
		return this.sliceLatest(list, p);
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = Math.max(1, opts?.page || 1);
		const q = (query || '').trim();
		if (!q) return this.getLatestManga(page);
		const { path, params } = this.searchEndpoint(q, page);
		const raw = await this.apiGet(path, params);
		const seen = new Set<string>();
		const list: Manga[] = [];
		for (const item of this.extractList(raw)) {
			const m = this.mapListItem(item);
			if (!m || seen.has(m.id)) continue;
			seen.add(m.id);
			list.push(m);
		}
		return list.slice(0, this.perPage);
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const id = this.cleanId(mangaId);
		const raw = await this.apiGet(this.detailEndpoint(id));
		const details = this.mapDetails(raw, id);
		if (!details.chapters?.length) {
			const ch = await this.fetchAllChapters(id);
			if (ch.length) details.chapters = ch;
		}
		if (details.chapters?.length) {
			details.chapters.sort((a, b) => (b.number || 0) - (a.number || 0));
			if (details.latestChapter == null && details.chapters[0]?.number != null) {
				details.latestChapter = String(details.chapters[0].number);
			}
		}
		return details;
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const id = this.cleanId(chapterId);
		const raw = await this.apiGet(this.pagesEndpoint(id));
		return this.mapPages(raw, id);
	}
}
