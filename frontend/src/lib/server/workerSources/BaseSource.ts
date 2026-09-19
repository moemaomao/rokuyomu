import type { IMangaSource, Manga, MangaDetails } from './types';

/**
 * Abstract base for Worker-local source adapters.
 * Hanya source yang diblokir Vercel yang di-import di workerSources/index.ts
 * agar bundle Worker tetap kecil + CPU < 10ms untuk source remote.
 */
export abstract class BaseSource implements IMangaSource {
	abstract id: string;
	abstract name: string;
	abstract baseUrl: string;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.5'
	};

	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const response = await fetch(url, {
			headers: { ...this.headers, Referer: this.baseUrl }
		});
		if (!response.ok) {
			throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
		}
		return await response.text();
	}

	protected async fetchJson<T>(path: string): Promise<T> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const response = await fetch(url, {
			headers: {
				...this.headers,
				Referer: this.baseUrl,
				Accept: 'application/json'
			}
		});
		if (!response.ok) {
			throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
		}
		return await response.json();
	}

	abstract getLatestManga(
		page: number,
		opts?: { lang?: string; type?: string }
	): Promise<Manga[]>;

	abstract searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]>;

	abstract getMangaDetails(mangaId: string, opts?: { lang?: string }): Promise<MangaDetails>;

	abstract getChapterPages(chapterId: string): Promise<string[]>;
}
