/**
 * Ainz Scans (v3 JSON API) — ApiJsonSource
 * manga: /comic/{slug} | chapter: /comic/{slug}/chapter/{chSlug}
 */
import { ApiJsonSource } from '../../family/ApiJsonSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';

export class AinzScansSource extends ApiJsonSource {
	id = 'ainzscans';
	name = 'Ainz Scans';
	baseUrl = 'https://v3.ainzscans01.com';
	protected apiBase = 'https://v3.ainzscans01.com';
	protected perPage = 24;

	private slug(id: string): string {
		const p = id.replace(/^\/+/, '').split('/').filter(Boolean);
		return p[0] === 'comic' ? p[1] || '' : p[0] || '';
	}

	private chParts(id: string): { series: string; chapter: string } {
		const m = id.replace(/^\/+/, '').match(/^comic\/([^/]+)\/chapter\/(.+)$/i);
		if (m) return { series: m[1], chapter: m[2] };
		const p = id.replace(/^\/+/, '').split('/').filter(Boolean);
		return { series: p[0] === 'comic' ? p[1] || '' : p[0] || '', chapter: p.at(-1) || '' };
	}

	private status(s?: string | null): string {
		const u = String(s || '').toUpperCase();
		if (/COMPLETE|SELESAI/.test(u)) return 'Completed';
		if (u === 'HIATUS') return 'Hiatus';
		return 'Ongoing';
	}

	private type(s?: string | null): string {
		const u = String(s || '').toUpperCase();
		if (u === 'MANHWA') return 'manhwa';
		if (u === 'MANGA') return 'manga';
		return 'manhua';
	}

	protected mapListItem(raw: unknown): Manga | null {
		const it = raw as any;
		if (it?.series_slug) {
			const title = String(it.series_title || '').trim();
			if (!title) return null;
			const n = this.parseChapterNumber(it.chapters?.[0]?.number);
			return {
				id: `/comic/${it.series_slug}`,
				sourceId: this.id,
				title,
				cover: it.poster_image_url || '',
				type: this.type(it.series_comic_type),
				status: 'Ongoing',
				latestChapter: Number.isFinite(n) ? String(n) : undefined,
				lang: 'id'
			};
		}
	
		const slug = it?.slug;
		const title = String(it?.title || '').trim();
		if (!slug || !title) return null;
		return {
			id: `/comic/${slug}`,
			sourceId: this.id,
			title,
			cover: it.poster_image_url || '',
			type: this.type(it.comic_subtype),
			status: this.status(it.comic_status || it.series_status),
			lang: 'id'
		};
	}

	protected mapDetails(raw: unknown, mangaId: string): MangaDetails {
		const d = raw as any;
		const slug = this.slug(mangaId) || d.slug || '';
		const authors: string[] = [d.author_name, d.artist_name]
			.map((x) => String(x || '').trim())
			.filter((n): n is string => Boolean(n) && n !== '-');
		const genres: string[] = (d.genres || [])
			.map((g: any) => String(g?.name || '').trim())
			.filter((n: string): n is string => Boolean(n) && n.length < 40);
		return {
			id: `/comic/${slug}`,
			sourceId: this.id,
			title: String(d.title || slug).trim(),
			cover: d.poster_image_url || '',
			type: this.type(d.comic_subtype),
			status: this.status(d.comic_status || d.series_status),
			description: String(d.synopsis || '').replace(/\s+/g, ' ').trim(),
			authors: [...new Set(authors)],
			genres: [...new Set(genres)],
			chapters: [],
			lang: 'id'
		};
	}

	protected mapChapters(raw: unknown, mangaId: string): Chapter[] {
		const units = this.extractList(raw);
		const slug = this.slug(mangaId);
		const out: Chapter[] = [];
		const seen = new Set<string>();
		for (const u of units as any[]) {
			const chSlug = String(u?.slug || u?.chapter_slug || '').trim();
			if (!chSlug || seen.has(chSlug)) continue;
			seen.add(chSlug);
			const number = this.parseChapterNumber(u?.number ?? u?.sort_number);
			out.push({
				id: `/comic/${slug}/chapter/${chSlug}`,
				title: String(u?.title || '').trim() || `Chapter ${number || ''}`,
				number: number || out.length + 1,
				date: u?.created_at ? String(u.created_at).slice(0, 10) : undefined
			});
		}
		return out;
	}

	protected mapPages(raw: unknown, _chapterId?: string): string[] {
		const pages = Array.isArray((raw as any)?.chapter?.pages)
			? (raw as any).chapter.pages
			: [];
		return pages
			.slice()
			.sort((a: any, b: any) => (Number(a.page_number) || 0) - (Number(b.page_number) || 0))
			.map((p: any) => String(p.image_url || '').trim())
			.filter((u: string) => /^https?:\/\//i.test(u));
	}

	protected latestEndpoint(page: number) {
		return {
			path: '/api/comic/latest-updates',
			params: { limit: Math.min(200, page * this.perPage + this.perPage), chapterLimit: 1 }
		};
	}

	protected sliceLatest(list: Manga[], page: number): Manga[] {
		const start = (page - 1) * this.perPage;
		return list.slice(start, start + this.perPage);
	}

	protected searchEndpoint(query: string, page: number) {
		return { path: '/api/search', params: { q: query, page, limit: this.perPage } };
	}

	protected detailEndpoint(mangaId: string) {
		return `/api/series/comic/${encodeURIComponent(this.slug(mangaId))}`;
	}

	protected pagesEndpoint(chapterId: string) {
		const { series, chapter } = this.chParts(chapterId);
		return `/api/series/comic/${encodeURIComponent(series)}/chapter/${encodeURIComponent(chapter)}`;
	}

	protected async fetchAllChapters(mangaId: string): Promise<Chapter[]> {
		const slug = this.slug(mangaId);
		const out: Chapter[] = [];
		const seen = new Set<string>();
		let page = 1;
		const limit = 100;
		while (page <= 30) {
			const raw = await this.apiGet(`/api/series/comic/${encodeURIComponent(slug)}/chapters`, {
				page,
				limit
			});
			const batch = this.mapChapters(raw, mangaId);
			if (!batch.length) break;
			for (const ch of batch) {
				if (seen.has(ch.id)) continue;
				seen.add(ch.id);
				out.push(ch);
			}
			if (batch.length < limit) break;
			page++;
		}
		return out;
	}
}
