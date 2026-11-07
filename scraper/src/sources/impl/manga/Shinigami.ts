/**
 * Shinigami — ApiJsonSource (api.shngm.io)
 * manga: /series/{id} | chapter: /chapter/{id}
 */
import { ApiJsonSource } from '../../family/ApiJsonSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';

export class ShinigamiSource extends ApiJsonSource {
	id = 'shinigami';
	name = 'Shinigami';
	baseUrl = 'https://app.shinigami.asia';
	protected apiBase = 'https://api.shngm.io';
	protected perPage = 24;

	private mid(id: string): string {
		return id.replace(/^\/series\//, '').replace(/^\//, '').split('/')[0] || '';
	}

	private cid(id: string): string {
		return id.replace(/^\/chapter\//, '').replace(/^\//, '').split('/')[0] || '';
	}

	private status(code: unknown): string {
		const n = Number(code);
		if (n === 2) return 'Completed';
		if (n === 1) return 'Ongoing';
		const s = String(code || '').toLowerCase();
		if (/complete|selesai|end/.test(s)) return 'Completed';
		if (/hiatus/.test(s)) return 'Hiatus';
		return 'Ongoing';
	}

	private type(item: any): 'manga' | 'manhwa' | 'manhua' {
		const formats = item?.taxonomy?.Format || item?.taxonomy?.format || [];
		const names = (Array.isArray(formats) ? formats : [])
			.map((f: any) => String(f?.name || f?.slug || '').toLowerCase())
			.join(' ');
		const country = String(item?.country_id || '').toUpperCase();
		if (names.includes('manhwa') || country === 'KR') return 'manhwa';
		if (names.includes('manhua') || country === 'CN') return 'manhua';
		if (names.includes('manga') || country === 'JP') return 'manga';
		return 'manhwa';
	}

	protected mapListItem(raw: unknown): Manga | null {
		const item = raw as any;
		const mid = String(item?.manga_id || item?.id || '').trim();
		const title = String(item?.title || item?.name || '').trim();
		if (!mid || !title) return null;
		const latest =
			item?.latest_chapter_number ??
			item?.chapter_number ??
			item?.latest_chapter?.chapter_number;
		return {
			id: `/series/${mid}`,
			sourceId: this.id,
			title,
			cover: String(item?.cover_image_url || item?.thumbnail || item?.cover || ''),
			type: this.type(item),
			status: this.status(item?.status),
			latestChapter: latest != null ? String(latest) : undefined,
			lang: 'id'
		};
	}

	protected mapDetails(raw: unknown, mangaId: string): MangaDetails {
		const data = (raw as any)?.data || raw || {};
		const mid = String(data.manga_id || data.id || this.mid(mangaId)).trim();
		const genres = (data.taxonomy?.Genre || data.taxonomy?.genre || data.genres || [])
			.map((g: any) => String(g?.name || g || '').trim())
			.filter(Boolean);
		const authors = (data.taxonomy?.Author || data.authors || [])
			.map((a: any) => String(a?.name || a || '').trim())
			.filter(Boolean);
		return {
			id: `/series/${mid}`,
			sourceId: this.id,
			title: String(data.title || mid).trim(),
			cover: String(data.cover_image_url || data.thumbnail || ''),
			type: this.type(data),
			status: this.status(data.status),
			description: String(data.description || data.synopsis || '')
				.replace(/\s+/g, ' ')
				.trim(),
			authors,
			genres,
			chapters: [],
			lang: 'id'
		};
	}

	protected mapChapters(raw: unknown): Chapter[] {
		const rows = this.extractList(raw);
		const out: Chapter[] = [];
		const seen = new Set<string>();
		for (const row of rows as any[]) {
			const id = String(row.chapter_id || row.id || '').trim();
			if (!id || seen.has(id)) continue;
			seen.add(id);
			const number =
				Number(row.chapter_number) || this.parseChapterNumber(row.chapter_title) || 0;
			out.push({
				id: `/chapter/${id}`,
				title: String(row.chapter_title || '').trim() || `Chapter ${number}`,
				number: number || out.length + 1,
				date: row.release_date ? String(row.release_date).slice(0, 10) : undefined
			});
		}
		return out;
	}

	protected mapPages(raw: unknown): string[] {
		const data = (raw as any)?.data || raw || {};
		let base = String(data.base_url || 'https://assets.shngm.id').replace(/\/+$/, '');
		if (!base.startsWith('http')) base = 'https://assets.shngm.id';
		let chPath = String(data.chapter?.path || '').trim();
		if (chPath && !chPath.startsWith('/')) chPath = '/' + chPath;
		chPath = chPath.replace(/\/+$/, '');
		const files: string[] = Array.isArray(data.chapter?.data) ? data.chapter.data : [];
		return files
			.map((f) => {
				const name = String(f || '').trim();
				if (!name) return '';
				if (/^https?:\/\//i.test(name)) return name;
				return `${base}${chPath}/${name.replace(/^\/+/, '')}`;
			})
			.filter(Boolean);
	}

	protected latestEndpoint(page: number) {
		return {
			path: '/v1/manga/list',
			params: { page: Math.max(1, page || 1), page_size: this.perPage, is_update: 1 }
		};
	}

	protected searchEndpoint(query: string, page: number) {
		return {
			path: '/v1/search',
			params: { q: query, page: Math.max(1, page || 1), page_size: this.perPage }
		};
	}

	protected detailEndpoint(mangaId: string) {
		return `/v1/manga/detail/${encodeURIComponent(this.mid(mangaId))}`;
	}

	protected pagesEndpoint(chapterId: string) {
		return `/v1/chapter/detail/${encodeURIComponent(this.cid(chapterId))}`;
	}

	protected async fetchAllChapters(mangaId: string): Promise<Chapter[]> {
		const mid = this.mid(mangaId);
		const out: Chapter[] = [];
		const seen = new Set<string>();
		let page = 1;
		while (page <= 50) {
			const raw = await this.apiGet(`/v1/chapter/${encodeURIComponent(mid)}/list`, {
				page,
				page_size: 100
			});
			const batch = this.mapChapters(raw);
			if (!batch.length) break;
			for (const ch of batch) {
				if (seen.has(ch.id)) continue;
				seen.add(ch.id);
				out.push(ch);
			}
			const total = Number((raw as any)?.meta?.total_page) || page;
			if (page >= total) break;
			page++;
		}
		return out;
	}
}
