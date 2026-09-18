import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';

export class ShinigamiSource extends BaseSource {
	id = 'shinigami';
	name = 'Shinigami';
	baseUrl = 'https://app.shinigami.asia';

	private readonly API = 'https://api.shngm.io';
	private readonly PER_PAGE = 24;
	private readonly LIST_LANG = 'id';

	private async apiGet<T = unknown>(
		path: string,
		params?: Record<string, string | number>
	): Promise<T> {
		const qs = params
			? '?' +
				Object.entries(params)
					.map(
						([k, v]) =>
							`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`
					)
					.join('&')
			: '';
		const url = path.startsWith('http') ? path + qs : `${this.API}${path}${qs}`;
		const res = await fetch(url, {
			headers: {
				Accept: 'application/json',
				Origin: this.baseUrl,
				Referer: this.baseUrl + '/',
				'User-Agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
			}
		});
		const text = await res.text();
		if (text.trimStart().startsWith('<!')) {
			throw new Error('Shinigami API returned HTML (blocked?)');
		}
		if (!res.ok) throw new Error(`API ${res.status} ${path}`);
		return JSON.parse(text) as T;
	}

	private cleanId(link: string): string {
		let id = (link || '').trim();
		if (id.startsWith('http')) {
			try {
				id = new URL(id).pathname;
			} catch {
				/* ignore */
			}
		}
		if (!id.startsWith('/')) id = `/${id}`;
		return id.replace(/\/+$/, '') || '/';
	}

	private statusFromCode(code: unknown): string {
		const n = Number(code);
		if (n === 2) return 'Completed';
		if (n === 1) return 'Ongoing';
		const s = String(code || '').toLowerCase();
		if (/complete|selesai|end/.test(s)) return 'Completed';
		if (/hiatus/.test(s)) return 'Hiatus';
		return 'Ongoing';
	}

	private detectType(item: any): 'manga' | 'manhwa' | 'manhua' {
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

	private mapManga(item: any): Manga | null {
		const mid = item?.manga_id || item?.id;
		if (!mid) return null;
		const title = String(item.title || '').trim();
		if (!title) return null;

		const latest =
			typeof item.latest_chapter_number === 'number'
				? item.latest_chapter_number
				: undefined;

		return {
			id: `/series/${mid}`,
			sourceId: this.id,
			title,
			cover: item.cover_portrait_url || item.cover_image_url || '',
			type: this.detectType(item),
			status: this.statusFromCode(item.status),
			latestChapter: latest,
			lang: this.LIST_LANG
		};
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			console.log('[shinigami] latest page', p);
			const json = await this.apiGet<{ data?: any[] }>('/v1/manga/list', {
				page: p,
				page_size: this.PER_PAGE,
				sort: 'latest'
			});
			const rows = Array.isArray(json?.data) ? json.data : [];
			const list = rows.map((r) => this.mapManga(r)).filter(Boolean) as Manga[];
			console.log(`[shinigami] latest page=${p} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[shinigami] getLatestManga', e);
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
			const json = await this.apiGet<{ data?: any[] }>('/v1/manga/list', {
				page,
				page_size: this.PER_PAGE,
				q
			});
			const rows = Array.isArray(json?.data) ? json.data : [];
			const list = rows.map((r) => this.mapManga(r)).filter(Boolean) as Manga[];
			console.log(`[shinigami] search "${q}" → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[shinigami] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);
		if (path.startsWith('/chapter/')) {
			throw new Error('Pass manga id, not chapter id');
		}
		const mid =
			path.replace(/^\/series\//, '').replace(/^\//, '').split('/')[0] || '';
		if (!mid) throw new Error(`Invalid shinigami id: ${mangaId}`);

		const json = await this.apiGet<{ data?: any }>(
			`/v1/manga/detail/${encodeURIComponent(mid)}`
		);
		const data = json?.data || {};
		const title = String(data.title || mid).trim();
		const cover = data.cover_portrait_url || data.cover_image_url || '';
		const status = this.statusFromCode(data.status);
		const type = this.detectType(data);

		const authors: string[] = [];
		for (const key of ['Author', 'Artist', 'author', 'artist']) {
			const arr = data?.taxonomy?.[key];
			if (!Array.isArray(arr)) continue;
			for (const a of arr) {
				const n = String(a?.name || '').trim();
				if (n && !authors.includes(n)) authors.push(n);
			}
		}

		const genres: string[] = [];
		for (const key of ['Genre', 'genre']) {
			const arr = data?.taxonomy?.[key];
			if (!Array.isArray(arr)) continue;
			for (const g of arr) {
				const n = String(g?.name || '').trim();
				if (n && n.length < 40 && !genres.includes(n)) genres.push(n);
			}
		}

		const alt = String(data.alternative_title || '').trim();
		const synopsis = String(data.description || '')
			.replace(/\s+/g, ' ')
			.trim();

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		for (let page = 1; page <= 50; page++) {
			const chJson = await this.apiGet<{ data?: any[]; meta?: any }>(
				`/v1/chapter/${encodeURIComponent(mid)}/list`,
				{ page, page_size: 100 }
			);
			const rows = Array.isArray(chJson?.data) ? chJson.data : [];
			if (!rows.length) break;

			for (const row of rows) {
				const cid = row?.chapter_id;
				if (!cid || seen.has(cid)) continue;
				seen.add(cid);
				const number =
					typeof row.chapter_number === 'number'
						? row.chapter_number
						: parseFloat(String(row.chapter_number || 0)) || 0;
				let date = '';
				if (row.release_date) {
					try {
						date = new Date(row.release_date).toISOString().slice(0, 10);
					} catch {
						date = String(row.release_date).slice(0, 10);
					}
				}
				const chTitle =
					String(row.chapter_title || '').trim() || `Chapter ${number}`;
				chapters.push({
					id: `/chapter/${cid}`,
					title: chTitle,
					number,
					date
				});
			}

			const totalPage = chJson?.meta?.total_page || page;
			if (page >= totalPage) break;
		}

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));
		const latestChapter =
			chapters[0]?.number ??
			(typeof data.latest_chapter_number === 'number'
				? data.latest_chapter_number
				: undefined);

		const description = [
			alt && `Alternative: ${alt}`,
			data.user_rate != null && `Rating: ${data.user_rate}`,
			data.release_year && `Year: ${data.release_year}`,
			latestChapter != null && `Latest chapter: ${latestChapter}`,
			synopsis
		]
			.filter(Boolean)
			.join('\n\n');

		console.log(`[shinigami] details ${mid} → ch=${chapters.length}`);

		return {
			id: `/series/${mid}`,
			sourceId: this.id,
			title,
			cover,
			type,
			status,
			description,
			authors,
			genres,
			chapters,
			latestChapter
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		const cid =
			path.replace(/^\/chapter\//, '').replace(/^\//, '').split('/')[0] || '';
		if (!cid) {
			console.error('[shinigami] invalid chapter id', chapterId);
			return [];
		}

		try {
			const json = await this.apiGet<{ data?: any }>(
				`/v1/chapter/detail/${encodeURIComponent(cid)}`
			);
			const data = json?.data || {};
			const base = String(data.base_url || 'https://assets.shngm.id').replace(
				/\/+$/,
				''
			);
			const chPath = String(data.chapter?.path || '');
			const files: string[] = Array.isArray(data.chapter?.data)
				? data.chapter.data
				: [];

			const out = files
				.map((f) => {
					const name = String(f || '').trim();
					if (!name) return '';
					if (/^https?:\/\//i.test(name)) return name;
					return `${base}${chPath}${name}`;
				})
				.filter(Boolean);

			console.log(`[shinigami] ${out.length} pages → ${cid}`);
			return out;
		} catch (e) {
			console.error('[shinigami] getChapterPages', cid, e);
			return [];
		}
	}
}
