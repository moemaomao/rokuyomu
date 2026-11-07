/**
 * klz9.com — ApiJsonSource (signed JSON API)
 * manga: /{slug} | chapter: /{slug}/c/{numericId}
 */
import { ApiJsonSource } from '../../family/ApiJsonSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';

export class Klz9Source extends ApiJsonSource {
	id = 'klz9';
	name = 'KLZ9';
	baseUrl = 'https://klz9.com';
	protected perPage = 24;
	private readonly SECRET = 'KL9K40zaSyC9K40vOMLLbEcepIFBhUKXwELqxlwTEF';

	private slug(id: string): string {
		const p = id.replace(/^\/+/, '').replace(/\.html$/i, '').split('/').filter(Boolean);
		if (p.length >= 3 && p[1] === 'c') return p[0];
		return p[0] === 'c' ? '' : p[0] || '';
	}

	private chapterNumId(id: string): string {
		const p = id.replace(/^\/+/, '').split('/').filter(Boolean);
		if (p.length >= 3 && p[1] === 'c') return p[2];
		if (p[0] === 'c') return p[1] || '';
		return p.at(-1) || '';
	}

	private status(code: unknown): string {
		const n = Number(code);
		if (n === 1) return 'Completed';
		if (n === 2) return 'Ongoing';
		const s = String(code || '').toLowerCase();
		if (/complete|end/.test(s)) return 'Completed';
		return 'Ongoing';
	}

	protected async apiGet<T = unknown>(
		path: string,
		params?: Record<string, string | number | boolean | undefined | null>
	): Promise<T> {
		const url = new URL(
			path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`
		);
		if (params) {
			for (const [k, v] of Object.entries(params)) {
				if (v === undefined || v === null || v === '') continue;
				url.searchParams.set(k, String(v));
			}
		}
		const ts = Math.floor(Date.now() / 1000).toString();
		const msg = `${ts}.${this.SECRET}`;
		const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
		const sig = Array.from(new Uint8Array(hash))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');

		const res = await fetch(url.toString(), {
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
				Accept: 'application/json',
				'Content-Type': 'application/json',
				'x-client-ts': ts,
				'x-client-sig': sig,
				'x-app-lang': 'en',
				Referer: `${this.baseUrl}/`,
				Origin: this.baseUrl
			}
		});
		if (!res.ok) throw new Error(`KLZ9 HTTP ${res.status} → ${url}`);
		return (await res.json()) as T;
	}

	protected mapListItem(raw: unknown): Manga | null {
		const it = raw as any;
		const slug = String(it?.slug || '')
			.replace(/\.html$/i, '')
			.trim();
		const title = String(it?.name || it?.title || '').trim();
		if (!slug || !title) return null;
		return {
			id: `/${slug}`,
			sourceId: this.id,
			title,
			cover: it.cover || '',
			type: 'manga',
			status: this.status(it.m_status),
			latestChapter: it.last_chapter ?? undefined,
			lang: 'ja'
		};
	}

	protected mapDetails(raw: unknown, mangaId: string): MangaDetails {
		const d = raw as any;
		const finalSlug = String(d.slug || this.slug(mangaId));
		const alt = String(d.other_name || '')
			.split(',')
			.map((s: string) => s.trim())
			.filter(Boolean);
		const genres: string[] = String(d.genres || '')
			.split(',')
			.map((s: string) => s.trim())
			.filter(Boolean);
		const authors: string[] = [d.authors, d.artists]
			.filter(Boolean)
			.flatMap((s: string) =>
				String(s)
					.split(',')
					.map((x) => x.trim())
					.filter(Boolean)
			);
		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		for (const ch of d.chapters || []) {
			const cid = String(ch.id);
			if (!cid || seen.has(cid)) continue;
			seen.add(cid);
			const num = Number(ch.chapter) || 0;
			chapters.push({
				id: `/${finalSlug}/c/${cid}`,
				title: ch.name ? String(ch.name) : `Chapter ${num || cid}`,
				number: num || chapters.length + 1,
				date: ch.last_update ? String(ch.last_update).slice(0, 10) : undefined,
				lang: 'ja'
			});
		}
		return {
			id: `/${finalSlug}`,
			sourceId: this.id,
			title: String(d.name || finalSlug).trim(),
			cover: d.cover || '',
			type: 'manga',
			status: this.status(d.m_status),
			description: [
				alt.length && `Alternative: ${alt.join(' · ')}`,
				d.description && String(d.description).replace(/\s+/g, ' ').trim()
			]
				.filter(Boolean)
				.join('\n\n'),
			authors: [...new Set(authors)],
			genres,
			chapters,
			lang: 'ja',
			latestChapter: d.last_chapter ?? chapters.at(-1)?.number
		};
	}

	protected mapChapters(raw: unknown, mangaId: string): Chapter[] {
		return this.mapDetails(raw, mangaId).chapters || [];
	}

	protected mapPages(raw: unknown, _chapterId?: string): string[] {
		const content = String((raw as any)?.content || '');
		if (!content) return [];
		return content
			.split(/\r?\n/)
			.map((u) => u.trim())
			.filter((u) => /^https?:\/\//i.test(u));
	}

	protected latestEndpoint(page: number) {
		return { path: '/api/manga', params: { page: Math.max(1, page || 1), limit: this.perPage } };
	}

	protected searchEndpoint(query: string) {
		return { path: '/api/search', params: { q: query } };
	}

	protected detailEndpoint(mangaId: string) {
		return `/api/manga/slug/${encodeURIComponent(this.slug(mangaId))}`;
	}

	protected pagesEndpoint(chapterId: string) {
		return `/api/chapter/${this.chapterNumId(chapterId)}`;
	}
}
