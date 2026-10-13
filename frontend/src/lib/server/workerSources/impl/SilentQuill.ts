/**
 * SilentQuill adapter (silentquill.net)
 * → extends NextDataSource
 *
 * Site   : Next.js (bukan Themesia lagi)
 * Domain : https://silentquill.net
 *
 * Data routes (Pages Router style — sesuaikan setelah cek Network tab):
 *   Latest  : GET /_next/data/{buildId}/index.json
 *             GET /_next/data/{buildId}/manga.json?page=N
 *   Search  : GET /_next/data/{buildId}/search.json?q=
 *   Detail  : GET /_next/data/{buildId}/{slug}.json
 *             GET /_next/data/{buildId}/manga/{slug}.json?slug=
 *   Chapter : GET /_next/data/{buildId}/{slug}-chapter-{n}.json
 *
 * URL publik (dari site):
 *   manga   : /{slug}
 *   chapter : /{slug}-chapter-{n}  |  /{slug}-ch-{n}
 *
 * Bahasa default: English
 *
 * Catatan:
 * - Kalau App Router (RSC) tanpa /_next/data, adapter ini akan gagal di ensureBuildId /
 *   dataGet → cek Network tab browser & sesuaikan dataPath / field pageProps.
 * - Field pageProps di-map secara toleran (series / mangas / comics / data / ...).
 */

import { NextDataSource } from '../family/NextDataSource';
import type { Chapter, Manga, MangaDetails } from '../types-manga';

type AnyRec = Record<string, unknown>;

export class SilentQuillSource extends NextDataSource {
	id = 'silentquill';
	name = 'SilentQuill';
	baseUrl = 'https://silentquill.net';

	protected defaultLang = 'en';
	protected perPage = 30;

	// ── Helpers ──────────────────────────────────────────────────────────────

	private asArr(v: unknown): AnyRec[] {
		if (Array.isArray(v)) return v as AnyRec[];
		return [];
	}

	private str(v: unknown): string {
		return v == null ? '' : String(v).trim();
	}

	private absUrl(url: string): string {
		if (!url) return '';
		if (url.startsWith('http')) return url;
		if (url.startsWith('//')) return `https:${url}`;
		if (url.startsWith('/_next/image')) {
			try {
				const u = new URL(url, this.baseUrl);
				const real = u.searchParams.get('url');
				if (real) return decodeURIComponent(real);
			} catch {
				/* ignore */
			}
		}
		return `${this.baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
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
		return id.replace(/\/+$/, '').split('?')[0] || '/';
	}

	private normalizeTitle(raw: string): string {
		return this.str(raw)
			.replace(/\s+/g, ' ')
			.replace(/\s*[-|]\s*(Silent\s*Quill|KDT\s*Scans|Armageddon).*$/i, '')
			.trim();
	}

	private parseChapterNumber(text: string, path = ''): number {
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
		const m = String(text).match(/(?:chapter|chap|ch\.?)\s*(\d+)(?:[.,](\d+))?/i);
		if (m) {
			if (m[2] != null) return parseFloat(`${m[1]}.${m[2]}`);
			return parseInt(m[1], 10);
		}
		const n = String(text).match(/\b(\d+(?:\.\d+)?)\b/);
		return n ? parseFloat(n[1]) : 0;
	}

	private mapStatus(raw?: string | null): string {
		const s = String(raw || '').toLowerCase();
		if (/complet|finish|end|tamat/.test(s)) return 'Completed';
		if (/hiatus/.test(s)) return 'Hiatus';
		if (/drop|cancel/.test(s)) return 'Dropped';
		return 'Ongoing';
	}

	private mapType(raw?: string | null): string {
		const t = String(raw || '').toLowerCase();
		if (t.includes('manhwa')) return 'manhwa';
		if (t.includes('manhua')) return 'manhua';
		if (t.includes('novel')) return 'novel';
		return 'manga';
	}

	/** Ambil array list dari pageProps dengan key yang umum di Next manga sites */
	private extractList(pp: AnyRec): AnyRec[] {
		const candidates = [
			pp.series,
			pp.mangas,
			pp.comics,
			pp.entries,
			pp.items,
			pp.list,
			pp.latest,
			pp.posts,
			(pp.data as AnyRec)?.series,
			(pp.data as AnyRec)?.mangas,
			(pp.data as AnyRec)?.list,
			(pp.latestEntries as AnyRec)?.blocks
		];
		for (const c of candidates) {
			if (Array.isArray(c) && c.length) {
				// Flame-style blocks: [{ series: [...] }]
				if ((c[0] as AnyRec)?.series && Array.isArray((c[0] as AnyRec).series)) {
					const flat: AnyRec[] = [];
					for (const b of c) {
						flat.push(...this.asArr((b as AnyRec).series));
					}
					return flat;
				}
				return c as AnyRec[];
			}
		}
		return [];
	}

	private itemSlug(it: AnyRec): string {
		const s =
			this.str(it.slug) ||
			this.str(it.title_slug) ||
			this.str(it.series_slug) ||
			this.str(it.path) ||
			this.str(it.id);
		return s.replace(/^\/+/, '').split('/')[0] || '';
	}

	private itemTitle(it: AnyRec): string {
		return this.normalizeTitle(
			this.str(it.title) || this.str(it.name) || this.str(it.series_name) || this.itemSlug(it)
		);
	}

	private itemCover(it: AnyRec): string {
		const raw =
			this.str(it.cover) ||
			this.str(it.thumbnail) ||
			this.str(it.image) ||
			this.str(it.poster) ||
			this.str(it.gambar) ||
			this.str((it.coverImage as AnyRec)?.url);
		return this.absUrl(raw);
	}

	private itemLatestChapter(it: AnyRec): string | undefined {
		const ch =
			it.latestChapter ??
			it.latest_chapter ??
			it.lastChapter ??
			it.last_chapter ??
			it.chapter ??
			it.chapters;
		if (Array.isArray(ch) && ch.length) {
			const first = ch[0] as AnyRec;
			const n = this.parseChapterNumber(
				this.str(first.number ?? first.chapter ?? first.title ?? first.name)
			);
			return n > 0 ? String(n) : undefined;
		}
		if (typeof ch === 'number') return String(ch);
		if (typeof ch === 'string') {
			const n = this.parseChapterNumber(ch);
			return n > 0 ? String(n) : ch || undefined;
		}
		return undefined;
	}

	private mapListItem(it: AnyRec): Manga | null {
		const slug = this.itemSlug(it);
		if (!slug || /^(page|manga|comics|series|search|api)$/i.test(slug)) return null;
		const title = this.itemTitle(it);
		if (!title) return null;
		return {
			id: `/${slug}`,
			title,
			cover: this.itemCover(it),
			sourceId: this.id,
			type: this.mapType(this.str(it.type ?? it.format ?? it.genre)),
			status: this.mapStatus(this.str(it.status)),
			latestChapter: this.itemLatestChapter(it),
			lang: this.defaultLang
		};
	}

	private mapChapters(raw: unknown, mangaSlug: string): Chapter[] {
		const list = this.asArr(raw);
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		for (const ch of list) {
			const numRaw =
				this.str(ch.number) ||
				this.str(ch.chapter) ||
				this.str(ch.chapter_number) ||
				this.str(ch.name) ||
				this.str(ch.title);
			const number = this.parseChapterNumber(numRaw);
			const slugPart =
				this.str(ch.slug) ||
				this.str(ch.path) ||
				(number > 0
					? `${mangaSlug}-chapter-${number}`
					: this.str(ch.id));
			if (!slugPart) continue;

			let id = this.cleanId(slugPart);
			if (!id.includes(mangaSlug) && number > 0) {
				id = `/${mangaSlug}-chapter-${number}`;
			}
			if (seen.has(id)) continue;
			seen.add(id);

			const isLocked = Boolean(
				ch.locked || ch.isLocked || ch.premium || ch.is_premium || ch.coin
			);
			const titleBase =
				number > 0 ? `Chapter ${number}` : this.normalizeTitle(numRaw) || id;

			chapters.push({
				id,
				title: isLocked ? `${titleBase} 🔒` : titleBase,
				number: number || chapters.length + 1,
				date: this.str(ch.date || ch.released || ch.created_at) || undefined,
				lang: this.defaultLang
			});
		}

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));
		return chapters;
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(page: number): Promise<Manga[]> {
		const p = Math.max(1, Number(page) || 1);
		try {
			// Coba beberapa path umum Next manga
			const attempts: Array<() => Promise<unknown>> = [
				() => this.dataGet('index.json'),
				() => this.dataGet('manga.json', { page: p, order: 'update' }),
				() => this.dataGet('comics.json', { page: p }),
				() => this.dataGet(`manga/page/${p}.json`)
			];

			let rows: AnyRec[] = [];
			for (const tryFetch of attempts) {
				try {
					const raw = await tryFetch();
					const pp = this.pageProps<AnyRec>(raw);
					rows = this.extractList(pp);
					if (rows.length) break;
				} catch {
					/* coba path berikutnya */
				}
			}

			const seen = new Set<string>();
			const list: Manga[] = [];
			for (const it of rows) {
				const m = this.mapListItem(it);
				if (!m || seen.has(m.id)) continue;
				seen.add(m.id);
				list.push(m);
			}

			const start = (p - 1) * this.perPage;
			const pageList =
				list.length > this.perPage
					? list.slice(start, start + this.perPage)
					: list.slice(0, this.perPage);

			console.log(
				`[silentquill] latest page=${p} → ${pageList.length} (pool=${list.length})`
			);
			return pageList;
		} catch (e) {
			console.error('[silentquill] getLatestManga', e);
			return [];
		}
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page || 1);
		if (!q) return this.getLatestManga(page);

		try {
			const attempts: Array<() => Promise<unknown>> = [
				() => this.dataGet('search.json', { q, page }),
				() => this.dataGet('index.json', { q, page }),
				() => this.dataGet('manga.json', { s: q, page })
			];

			let rows: AnyRec[] = [];
			for (const tryFetch of attempts) {
				try {
					const raw = await tryFetch();
					const pp = this.pageProps<AnyRec>(raw);
					rows = this.extractList(pp);
					if (rows.length) break;
				} catch {
					/* next */
				}
			}

			const nq = q.toLowerCase();
			const filtered = rows.filter((it) =>
				this.itemTitle(it).toLowerCase().includes(nq)
			);
			const use = filtered.length ? filtered : rows;

			const seen = new Set<string>();
			const list: Manga[] = [];
			for (const it of use) {
				const m = this.mapListItem(it);
				if (!m || seen.has(m.id)) continue;
				seen.add(m.id);
				list.push(m);
			}

			const start = (page - 1) * this.perPage;
			return list.slice(start, start + this.perPage);
		} catch (e) {
			console.error('[silentquill] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const id = this.cleanId(mangaId);
		const slug = id.replace(/^\//, '').split('/')[0];

		try {
			const attempts: Array<() => Promise<unknown>> = [
				() => this.dataGet(`${slug}.json`, { slug }),
				() => this.dataGet(`manga/${slug}.json`, { slug }),
				() => this.dataGet(`comics/${slug}.json`, { slug }),
				() => this.dataGet(`series/${slug}.json`, { slug })
			];

			let pp: AnyRec = {};
			for (const tryFetch of attempts) {
				try {
					const raw = await tryFetch();
					pp = this.pageProps<AnyRec>(raw);
					if (pp && Object.keys(pp).length) break;
				} catch {
					/* next */
				}
			}

			const series =
				(pp.series as AnyRec) ||
				(pp.manga as AnyRec) ||
				(pp.comic as AnyRec) ||
				(pp.data as AnyRec) ||
				pp;

			const title = this.normalizeTitle(
				this.str(series.title) || this.str(series.name) || slug
			);
			const cover = this.itemCover(series);
			const description = this.str(
				series.description || series.synopsis || series.summary || series.deskripsi
			);
			const status = this.mapStatus(this.str(series.status));
			const type = this.mapType(this.str(series.type || series.format));

			const authors = this.asArr(series.authors || series.author)
				.map((a) => this.str(typeof a === 'string' ? a : (a as AnyRec).name))
				.filter(Boolean);
			if (!authors.length && series.author) {
				authors.push(...this.str(series.author).split(/[,&/]/).map((s) => s.trim()));
			}

			const genres = this.asArr(series.genres || series.genre)
				.map((g) => this.str(typeof g === 'string' ? g : (g as AnyRec).name))
				.filter(Boolean);

			const chapters = this.mapChapters(
				series.chapters || series.chapterList || pp.chapters,
				slug
			);

			const latestChapter =
				chapters.length > 0 ? String(chapters[0].number) : this.itemLatestChapter(series);

			console.log(
				`[silentquill] details ${id} → ch=${chapters.length} status=${status}`
			);

			return {
				id: `/${slug}`,
				sourceId: this.id,
				title,
				cover,
				type,
				status,
				latestChapter,
				lang: this.defaultLang,
				description,
				authors: [...new Set(authors.filter(Boolean))],
				genres,
				chapters
			};
		} catch (e) {
			console.error('[silentquill] getMangaDetails', e);
			return {
				id: `/${slug}`,
				sourceId: this.id,
				title: slug,
				cover: '',
				type: 'manga',
				status: 'Ongoing',
				lang: this.defaultLang,
				description: '',
				authors: [],
				genres: [],
				chapters: []
			};
		}
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		const dataPath = path.replace(/^\//, '') + '.json';

		try {
			const attempts: Array<() => Promise<unknown>> = [
				() => this.dataGet(dataPath),
				() => this.dataGet(path.replace(/^\//, '') + '/index.json')
			];

			let pp: AnyRec = {};
			for (const tryFetch of attempts) {
				try {
					const raw = await tryFetch();
					pp = this.pageProps<AnyRec>(raw);
					if (pp && Object.keys(pp).length) break;
				} catch {
					/* next */
				}
			}

			const pages: string[] = [];
			const seen = new Set<string>();
			const push = (src?: string | null) => {
				if (!src) return;
				if (src.startsWith('data:')) return;
				const url = this.absUrl(String(src).split(/\s+/)[0]);
				if (!url || seen.has(url)) return;
				if (/logo|icon|avatar|emoji|spinner|loading|placeholder/i.test(url)) return;
				seen.add(url);
				pages.push(url);
			};

			const candidates = [
				pp.pages,
				pp.images,
				pp.chapterPages,
				(pp.chapter as AnyRec)?.pages,
				(pp.chapter as AnyRec)?.images,
				(pp.data as AnyRec)?.pages,
				(pp.data as AnyRec)?.images
			];

			for (const c of candidates) {
				if (!Array.isArray(c)) continue;
				for (const item of c) {
					if (typeof item === 'string') push(item);
					else if (item && typeof item === 'object') {
						const o = item as AnyRec;
						push(
							this.str(o.url || o.src || o.image || o.path || o.link)
						);
					}
				}
				if (pages.length) break;
			}

			console.log(`[silentquill] getChapterPages ${path} → ${pages.length}`);
			return pages;
		} catch (e) {
			console.error('[silentquill] getChapterPages', e);
			return [];
		}
	}
}

export default SilentQuillSource;
