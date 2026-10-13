/**
 * Family base: Next.js sites using /_next/data/{buildId}/...
 * (FlameComics-style)
 */
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails } from '../types-manga';

export abstract class NextDataSource extends BaseSource {
	protected buildId = '';

	protected reqHeaders(): Record<string, string> {
		return {
			...this.headers,
			Accept: 'application/json, text/plain, */*',
			'Accept-Language': 'en-US,en;q=0.9',
			Origin: this.baseUrl,
			Referer: `${this.baseUrl}/`,
			'Cache-Control': 'no-cache'
		};
	}

	protected async ensureBuildId(): Promise<string> {
		if (this.buildId) return this.buildId;
		const res = await fetch(this.baseUrl + '/', { headers: this.reqHeaders() });
		const html = await res.text();
		const m =
			html.match(/"buildId"\s*:\s*"([^"]+)"/) ||
			html.match(/\/_next\/static\/([A-Za-z0-9_-]+)\/_buildManifest\.js/);
		if (!m?.[1]) throw new Error(`${this.name}: failed to resolve buildId`);
		this.buildId = m[1];
		return this.buildId;
	}

	protected async dataGet<T = unknown>(
		dataPath: string,
		params?: Record<string, string | number | undefined | null>
	): Promise<T> {
		const buildId = await this.ensureBuildId();
		const url = new URL(
			`${this.baseUrl}/_next/data/${buildId}/${dataPath.replace(/^\//, '')}`
		);
		if (params) {
			for (const [k, v] of Object.entries(params)) {
				if (v === undefined || v === null || v === '') continue;
				url.searchParams.set(k, String(v));
			}
		}

		const maxAttempts = 3;
		let lastErr: unknown;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const res = await fetch(url.toString(), { headers: this.reqHeaders() });
				const text = await res.text();
				if (!res.ok) throw new Error(`NextData ${res.status}: ${text.slice(0, 120)}`);
				if (text.includes('NEXT_NOT_FOUND') || res.status === 404) {
					this.buildId = '';
					if (attempt < maxAttempts) continue;
				}
				return JSON.parse(text) as T;
			} catch (e) {
				lastErr = e;
				if (attempt < maxAttempts) {
					this.buildId = '';
					await new Promise((r) => setTimeout(r, 250 * attempt));
				}
			}
		}
		throw lastErr;
	}

	protected pageProps<T = Record<string, unknown>>(raw: unknown): T {
		const o = raw as { pageProps?: T };
		return (o?.pageProps ?? raw) as T;
	}

	abstract getLatestManga(page: number): Promise<Manga[]>;
	abstract searchManga(query: string, opts?: { page?: number }): Promise<Manga[]>;
	abstract getMangaDetails(mangaId: string): Promise<MangaDetails>;
	abstract getChapterPages(chapterId: string): Promise<string[]>;
}
