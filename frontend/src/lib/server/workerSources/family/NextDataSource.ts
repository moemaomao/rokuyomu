/**
 * Family base: Next.js sites using /_next/data/{buildId}/...
 * (FlameComics, SilentQuill, …)
 *
 * Path: scraper/src/sources/family/NextDataSource.ts
 *
 * Subclass hanya isi mapping + dataPath site-specific.
 * HTTP / buildId / helpers umum ada di sini.
 */
import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types-manga';

export abstract class NextDataSource extends BaseSource {
	protected buildId = '';
	protected perPage = 24;
	protected defaultLang = 'en';

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

		let lastErr: unknown;
		for (let attempt = 1; attempt <= 3; attempt++) {
			try {
				const res = await fetch(url.toString(), { headers: this.reqHeaders() });
				const text = await res.text();
				if (!res.ok) throw new Error(`NextData ${res.status}: ${text.slice(0, 120)}`);
				if (text.includes('NEXT_NOT_FOUND') || res.status === 404) {
					this.buildId = '';
					if (attempt < 3) continue;
				}
				return JSON.parse(text) as T;
			} catch (e) {
				lastErr = e;
				this.buildId = '';
				if (attempt < 3) await new Promise((r) => setTimeout(r, 250 * attempt));
			}
		}
		throw lastErr;
	}

	protected props<T = Record<string, unknown>>(raw: unknown): T {
		const o = raw as { pageProps?: T };
		return (o?.pageProps ?? raw) as T;
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

	protected parseChapterNumber(value: unknown, path = ''): number {
		if (typeof value === 'number' && Number.isFinite(value)) return value;
		const fromPath =
			path.match(/(?:ch|chapter)[_-]?(\d+)(?:[.-](\d+))?/i) ||
			path.match(/-(\d+)(?:[.-](\d+))?\/?$/i);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null && fromPath[2].length <= 2) {
				return parseFloat(`${major}.${fromPath[2]}`);
			}
			return major;
		}
		const s = String(value ?? '').trim();
		if (!s) return 0;
		const m =
			s.match(/(?:chapter|ch\.?)\s*[.\-_:]?\s*(\d+(?:\.\d+)?)/i) ||
			s.match(/^(\d+(?:\.\d+)?)/);
		return m ? parseFloat(m[1]) : 0;
	}

	protected mapStatus(raw?: string | null): string {
		const s = String(raw || '').toLowerCase();
		if (/complet|finish|end|tamat/.test(s)) return 'Completed';
		if (/hiatus/.test(s)) return 'Hiatus';
		if (/drop|cancel/.test(s)) return 'Cancelled';
		return 'Ongoing';
	}

	protected mapType(raw?: string | null, country?: string | null): string {
		const t = String(raw || '').toLowerCase();
		if (t.includes('manhwa')) return 'manhwa';
		if (t.includes('manhua')) return 'manhua';
		if (t.includes('manga')) return 'manga';
		const c = String(country || '').toUpperCase();
		if (c === 'KR') return 'manhwa';
		if (c === 'CN') return 'manhua';
		if (c === 'JP') return 'manga';
		return 'manhwa';
	}

	protected dedupeManga(items: (Manga | null | undefined)[]): Manga[] {
		const seen = new Set<string>();
		const out: Manga[] = [];
		for (const m of items) {
			if (!m?.id || seen.has(m.id)) continue;
			seen.add(m.id);
			out.push(m);
		}
		return out;
	}

	protected paginate<T>(items: T[], page: number): T[] {
		const p = Math.max(1, page || 1);
		const start = (p - 1) * this.perPage;
		return items.slice(start, start + this.perPage);
	}

	protected collectNames(raw: unknown, maxLen = 40): string[] {
		const out: string[] = [];
		const push = (v: unknown) => {
			if (v == null) return;
			if (Array.isArray(v)) {
				for (const x of v) push(x);
				return;
			}
			if (typeof v === 'object') {
				push((v as any).name ?? (v as any).title);
				return;
			}
			const n = String(v).trim();
			if (n && n.length < maxLen && !out.includes(n)) out.push(n);
		};
		push(raw);
		return out;
	}

	abstract getLatestManga(page: number): Promise<Manga[]>;
	abstract searchManga(query: string, opts?: { page?: number }): Promise<Manga[]>;
	abstract getMangaDetails(mangaId: string): Promise<MangaDetails>;
	abstract getChapterPages(chapterId: string): Promise<string[]>;
}
