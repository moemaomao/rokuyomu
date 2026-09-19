import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

/**
 * RawUwU adapter (rawuwu.net)
 *
 * Domain  : https://rawuwu.net
 * Latest  : /spa/latest-manga?page=N
 * Search  : /spa/search?q={query}&page=N
 * Detail  : /spa/manga/{id}
 * Chapter : /read/{id}/chapter-{n}   (Cookie: read=1)
 *
 * ID format:
 *   manga   : "/raw/{id}"
 *   chapter : "/read/{id}/chapter-{n}"
 *
 * Bahasa default: ja (raw JP)
 * Alt titles dari field manga_others_name (dipisah koma).
 */
export class RawUwUSource extends BaseSource {
	id = 'rawuwu';
	name = 'RawUwU';
	baseUrl = 'https://rawuwu.net';

	private readonly DEFAULT_LANG = 'ja';
	private readonly IMG_SERVER = 'https://s1.rawuwu.net/';

	// ── HTTP ─────────────────────────────────────────────────────────────────

	private spaHeaders(extra: Record<string, string> = {}): Record<string, string> {
		return {
			...this.headers,
			Accept: 'application/json, text/html, */*',
			Referer: `${this.baseUrl}/`,
			Origin: this.baseUrl,
			'X-Requested-With': 'XMLHttpRequest',
			...extra
		};
	}

	private async spaJson<T = unknown>(path: string): Promise<T> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const res = await fetch(url, { headers: this.spaHeaders() });
		if (!res.ok) throw new Error(`HTTP ${res.status} → ${url}`);
		return res.json() as Promise<T>;
	}

	/** Chapter HTML butuh cookie read=1 (bypass gate "Continue") */
	private async chapterHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const res = await fetch(url, {
			headers: this.spaHeaders({
				Accept: 'text/html,application/xhtml+xml',
				Cookie: 'read=1'
			})
		});
		if (!res.ok) throw new Error(`HTTP ${res.status} → ${url}`);
		return res.text();
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private toMangaId(id: number | string): string {
		return `/raw/${String(id).replace(/\D/g, '')}`;
	}

	private toChapterId(mangaId: number | string, num: number | string): string {
		const mid = String(mangaId).replace(/\D/g, '');
		return `/read/${mid}/chapter-${num}`;
	}

	private extractMangaNumericId(mangaId: string): string {
		const m = String(mangaId).match(/(\d{3,})/);
		return m?.[1] || String(mangaId).replace(/\D/g, '');
	}

	private absImg(path: string): string {
		if (!path) return '';
		if (path.startsWith('http')) return path;
		if (path.startsWith('//')) return `https:${path}`;
		if (path.startsWith('data/')) return `${this.IMG_SERVER}${path}`;
		if (path.startsWith('/')) return `${this.baseUrl}${path}`;
		return `${this.IMG_SERVER}${path}`;
	}

	private preferFullCover(url: string): string {
		if (!url) return '';
		return url
			.replace('/img/thumb/', '/img/')
			.replace(/-\d+x\d+(\.\w+)(\?.*)?$/, '-482x482$1$2');
	}

	/** Parse manga_others_name → daftar alt title bersih */
	private parseAltTitles(raw?: string | null): string[] {
		if (!raw) return [];
		return String(raw)
			.split(/[,，、;|／/]/)
			.map((s) => s.trim())
			.filter((s) => s.length > 0)
			.filter((s, i, arr) => arr.indexOf(s) === i);
	}

	private mapListItem(g: Record<string, unknown>): Manga | null {
		const id = g?.manga_id;
		if (id == null) return null;

		const title = String(g.manga_name || g.ja_manga_name || '').trim();
		if (!title) return null;

		const cover = this.preferFullCover(
			String(g.manga_cover_img || g.manga_cover_img_full || '')
		);

		const chs = Array.isArray(g.manga_chapters) ? g.manga_chapters : [];
		const latest =
			chs.length > 0 && chs[0] && typeof chs[0] === 'object'
				? String((chs[0] as { chapter_number?: unknown }).chapter_number ?? '')
				: undefined;

		return {
			id: this.toMangaId(id as number | string),
			sourceId: this.id,
			title,
			cover,
			type: 'manga',
			status: 'Ongoing',
			latestChapter: latest || undefined,
			lang: this.DEFAULT_LANG
		};
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const data = await this.spaJson<{ manga_list?: Record<string, unknown>[] }>(
				`/spa/latest-manga?page=${p}`
			);
			const list = (data?.manga_list || [])
				.map((g) => this.mapListItem(g))
				.filter(Boolean) as Manga[];
			console.log(`[rawuwu] latest page=${p} → ${list.length} items`);
			return list;
		} catch (e) {
			console.error('[rawuwu] getLatestManga', e);
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
			const data = await this.spaJson<{ manga_list?: Record<string, unknown>[] }>(
				`/spa/search?q=${encodeURIComponent(q)}&page=${page}`
			);
			const list = (data?.manga_list || [])
				.map((g) => this.mapListItem(g))
				.filter(Boolean) as Manga[];
			console.log(`[rawuwu] search "${q}" page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[rawuwu] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const id = this.extractMangaNumericId(mangaId);
		if (!id) throw new Error(`Invalid rawuwu id: ${mangaId}`);

		const data = await this.spaJson<{
			detail?: Record<string, unknown>;
			tags?: { tag_name?: string }[];
			authors?: { author_name?: string; name?: string }[];
			chapters?: {
				chapter_id?: string;
				chapter_title?: string;
				chapter_number?: number;
				chapter_date_published?: string;
			}[];
		}>(`/spa/manga/${id}`);

		const d = data?.detail || {};
		const title = String(d.manga_name || '').trim() || `Manga ${id}`;
		const altTitles = this.parseAltTitles(
			d.manga_others_name as string | undefined
		);

		const cover = this.preferFullCover(
			String(
				d.manga_cover_img_full ||
					d.manga_cover_img_normal ||
					d.manga_cover_img ||
					''
			)
		);

		const genres = (data?.tags || [])
			.map((t) => String(t.tag_name || '').trim())
			.filter(Boolean);

		const authors = (data?.authors || [])
			.map((a) => String(a.author_name || a.name || '').trim())
			.filter(Boolean);

		const status = d.manga_status === true ? 'Completed' : 'Ongoing';

		const synopsis = String(d.manga_description || '').trim();
		const description = [
			...altTitles.map((t) => `AltTitle: ${t}`),
			synopsis
		]
			.filter(Boolean)
			.join('\n');

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		for (const ch of data?.chapters || []) {
			const num = ch.chapter_number;
			if (num == null) continue;

			const chId = this.toChapterId(id, num);
			if (seen.has(chId)) continue;
			seen.add(chId);

			const date = ch.chapter_date_published
				? String(ch.chapter_date_published).slice(0, 10)
				: undefined;

			const titleExtra = String(ch.chapter_title || '').trim();
			chapters.push({
				id: chId,
				title: titleExtra
					? `Chapter ${num} - ${titleExtra}`
					: `Chapter ${num}`,
				number: Number(num) || 0,
				date
			});
		}

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		return {
			id: this.toMangaId(id),
			sourceId: this.id,
			title,
			cover,
			type: 'manga',
			status,
			latestChapter:
				chapters.length > 0 ? String(chapters[0].number) : undefined,
			lang: this.DEFAULT_LANG,
			description,
			authors,
			genres,
			chapters
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		try {
			let path = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
			path = path.replace(/\/+$/, '');

			const html = await this.chapterHtml(path);
			const $ = cheerio.load(html);

			const pages: string[] = [];
			const seen = new Set<string>();

			const push = (src?: string | null) => {
				if (!src || src.startsWith('data:')) return;
				const url = this.absImg(src.split('?')[0]);
				if (!url || seen.has(url)) return;
				if (/logo|icon|avatar|emoji/i.test(url)) return;
				seen.add(url);
				pages.push(url);
			};

			$('.chapter-imgs img, .page-wrapper img, .chapter-img img').each(
				(_, img) => {
					const $img = $(img);
					push(
						$img.attr('data-src') ||
							$img.attr('data-lazy-src') ||
							$img.attr('src')
					);
				}
			);

			if (pages.length === 0) {
				const re =
					/(?:data-src|src)="(data\/[^"]+\.(?:webp|jpg|jpeg|png))"/gi;
				let m: RegExpExecArray | null;
				while ((m = re.exec(html)) !== null) {
					push(m[1]);
				}
			}

			console.log(
				`[rawuwu] getChapterPages ${path} → ${pages.length} pages`
			);
			return pages;
		} catch (e) {
			console.error('[rawuwu] getChapterPages', e);
			return [];
		}
	}
}
