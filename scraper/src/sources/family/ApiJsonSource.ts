/**
 * Family base: sources that talk to a JSON API (AinzScans, Shinigami, …)
 *
 * Subclasses implement map* methods and set apiBase + endpoints.
 * HTML cheerio not required.
 */
import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types-manga';

export abstract class ApiJsonSource extends BaseSource {

	protected apiBase = '';
	protected get apiRoot(): string {
		return (this.apiBase || this.baseUrl).replace(/\/+$/, '');
	}

	protected async apiGet<T = unknown>(
		path: string,
		params?: Record<string, string | number | boolean | undefined | null>
	): Promise<T> {
		const url = new URL(
			path.startsWith('http') ? path : `${this.apiRoot}${path.startsWith('/') ? '' : '/'}${path}`
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

		const maxAttempts = 3;
		let lastErr: unknown;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const res = await fetch(url.toString(), { headers });
				if (!res.ok) {
					throw new Error(`API ${res.status} ${res.statusText} — ${url}`);
				}
				return (await res.json()) as T;
			} catch (e) {
				lastErr = e;
				if (attempt < maxAttempts) {
					await new Promise((r) => setTimeout(r, 300 * attempt));
				}
			}
		}
		throw lastErr;
	}

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
	protected chaptersEndpoint?(mangaId: string): {
		path: string;
		params?: Record<string, string | number>;
	};
	
	protected abstract pagesEndpoint(chapterId: string): string;
	protected extractList(raw: unknown): unknown[] {
		if (Array.isArray(raw)) return raw;
		if (raw && typeof raw === 'object') {
			const o = raw as Record<string, unknown>;
			for (const k of ['data', 'results', 'items', 'comics', 'series', 'list']) {
				if (Array.isArray(o[k])) return o[k] as unknown[];
				if (o[k] && typeof o[k] === 'object') {
					const inner = o[k] as Record<string, unknown>;
					for (const k2 of ['data', 'items', 'results']) {
						if (Array.isArray(inner[k2])) return inner[k2] as unknown[];
					}
				}
			}
		}
		return [];
	}

	async getLatestManga(page: number): Promise<Manga[]> {
		const { path, params } = this.latestEndpoint(Math.max(1, page || 1));
		const raw = await this.apiGet(path, params);
		return this.extractList(raw)
			.map((item) => this.mapListItem(item))
			.filter((m): m is Manga => m != null);
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = Math.max(1, opts?.page || 1);
		const { path, params } = this.searchEndpoint(query, page);
		const raw = await this.apiGet(path, params);
		return this.extractList(raw)
			.map((item) => this.mapListItem(item))
			.filter((m): m is Manga => m != null);
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const id = this.cleanId(mangaId);
		const raw = await this.apiGet(this.detailEndpoint(id));
		const details = this.mapDetails(raw, id);
		if ((!details.chapters || details.chapters.length === 0) && this.chaptersEndpoint) {
			const ep = this.chaptersEndpoint(id);
			const chRaw = await this.apiGet(ep.path, ep.params);
			details.chapters = this.mapChapters(chRaw, id);
		}
		return details;
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const id = this.cleanId(chapterId);
		const raw = await this.apiGet(this.pagesEndpoint(id));
		return this.mapPages(raw, id);
	}
}
