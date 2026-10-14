/**
 * SilentQuill (silentquill.net) — Next.js `_next/data` → NextDataSource
 * ID: /{slug} | /{slug}-chapter-{n}
 *
 * Path data dicoba bergiliran (site layout berubah-ubah).
 */
import { NextDataSource } from '../../family/NextDataSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';

type R = Record<string, unknown>;

export class SilentQuillSource extends NextDataSource {
	id = 'silentquill';
	name = 'SilentQuill';
	baseUrl = 'https://silentquill.net';
	protected perPage = 30;

	private str(v: unknown): string {
		return v == null ? '' : String(v).trim();
	}

	private async firstData(
		attempts: Array<() => Promise<unknown>>
	): Promise<R> {
		for (const fn of attempts) {
			try {
				const pp = this.props<R>(await fn());
				if (pp && Object.keys(pp).length) return pp;
			} catch {
				/* next path */
			}
		}
		return {};
	}

	private extractList(pp: R): R[] {
		const candidates = [
			pp.series,
			pp.mangas,
			pp.comics,
			pp.entries,
			pp.items,
			pp.list,
			pp.latest,
			pp.posts,
			(pp.data as R)?.series,
			(pp.data as R)?.mangas,
			(pp.data as R)?.list,
			(pp.latestEntries as R)?.blocks
		];
		for (const c of candidates) {
			if (!Array.isArray(c) || !c.length) continue;
			const first = c[0] as R;
			if (first?.series && Array.isArray(first.series)) {
				return c.flatMap((b) => (Array.isArray((b as R).series) ? ((b as R).series as R[]) : []));
			}
			return c as R[];
		}
		return [];
	}

	private slugOf(it: R): string {
		const s =
			this.str(it.slug) ||
			this.str(it.title_slug) ||
			this.str(it.series_slug) ||
			this.str(it.path) ||
			this.str(it.id);
		return s.replace(/^\/+/, '').split('/')[0] || '';
	}

	private titleOf(it: R): string {
		return (
			this.str(it.title) ||
			this.str(it.name) ||
			this.str(it.series_name) ||
			this.slugOf(it)
		)
			.replace(/\s+/g, ' ')
			.replace(/\s*[-|]\s*(Silent\s*Quill|KDT\s*Scans|Armageddon).*$/i, '')
			.trim();
	}

	private coverOf(it: R): string {
		const raw =
			this.str(it.cover) ||
			this.str(it.thumbnail) ||
			this.str(it.image) ||
			this.str(it.poster) ||
			this.str((it.coverImage as R)?.url);
		return this.absUrl(raw);
	}

	private latestOf(it: R): string | undefined {
		const ch = it.latestChapter ?? it.latest_chapter ?? it.lastChapter ?? it.last_chapter ?? it.chapter ?? it.chapters;
		if (Array.isArray(ch) && ch.length) {
			const f = ch[0] as R;
			const n = this.parseChapterNumber(f.number ?? f.chapter ?? f.title ?? f.name);
			return n > 0 ? String(n) : undefined;
		}
		if (typeof ch === 'number') return String(ch);
		if (typeof ch === 'string') {
			const n = this.parseChapterNumber(ch);
			return n > 0 ? String(n) : ch || undefined;
		}
		return undefined;
	}

	private mapItem(it: R): Manga | null {
		const slug = this.slugOf(it);
		if (!slug || /^(page|manga|comics|series|search|api)$/i.test(slug)) return null;
		const title = this.titleOf(it);
		if (!title) return null;
		return {
			id: `/${slug}`,
			title,
			cover: this.coverOf(it),
			sourceId: this.id,
			type: this.mapType(this.str(it.type ?? it.format ?? it.genre)),
			status: this.mapStatus(this.str(it.status)),
			latestChapter: this.latestOf(it),
			lang: this.defaultLang
		};
	}

	private mapChapters(raw: unknown, mangaSlug: string): Chapter[] {
		const arr = Array.isArray(raw)
			? raw
			: Array.isArray((raw as R)?.chapters)
				? ((raw as R).chapters as unknown[])
				: Array.isArray((raw as R)?.list)
					? ((raw as R).list as unknown[])
					: [];
		const out: Chapter[] = [];
		const seen = new Set<string>();
		for (const c of arr) {
			const it = (c || {}) as R;
			const href = this.str(it.url || it.path || it.slug || it.id);
			const path = href
				? this.cleanId(href.startsWith('http') || href.startsWith('/') ? href : `/${mangaSlug}/${href}`)
				: '';
			const title = this.str(it.title || it.name || it.chapter || path);
			const number = this.parseChapterNumber(it.number ?? it.chapter ?? title, path);
			const id =
				path && path !== '/'
					? path
					: number
						? `/${mangaSlug}-chapter-${number}`
						: '';
			if (!id || seen.has(id)) continue;
			seen.add(id);
			out.push({
				id,
				title: title || `Chapter ${number || out.length + 1}`,
				number: number || out.length + 1,
				date: this.str(it.date || it.createdAt || it.release_date) || undefined
			});
		}
		out.sort((a, b) => (b.number || 0) - (a.number || 0));
		return out;
	}

	async getLatestManga(page: number): Promise<Manga[]> {
		const p = Math.max(1, page || 1);
		const pp = await this.firstData([
			() => this.dataGet('index.json'),
			() => this.dataGet('manga.json', { page: p, order: 'update' }),
			() => this.dataGet('comics.json', { page: p }),
			() => this.dataGet(`manga/page/${p}.json`)
		]);
		const list = this.dedupeManga(this.extractList(pp).map((it) => this.mapItem(it)));
		return list.length > this.perPage ? this.paginate(list, p) : list.slice(0, this.perPage);
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = query.trim();
		const page = Math.max(1, opts?.page || 1);
		if (!q) return this.getLatestManga(page);
		const pp = await this.firstData([
			() => this.dataGet('search.json', { q, page }),
			() => this.dataGet('index.json', { q, page }),
			() => this.dataGet('manga.json', { s: q, page })
		]);
		const rows = this.extractList(pp);
		const nq = q.toLowerCase();
		const filtered = rows.filter((it) => this.titleOf(it).toLowerCase().includes(nq));
		const use = filtered.length ? filtered : rows;
		return this.paginate(
			this.dedupeManga(use.map((it) => this.mapItem(it))),
			page
		);
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = this.cleanId(mangaId).replace(/^\//, '').split('/')[0];
		const pp = await this.firstData([
			() => this.dataGet(`${slug}.json`, { slug }),
			() => this.dataGet(`manga/${slug}.json`, { slug }),
			() => this.dataGet(`comics/${slug}.json`, { slug }),
			() => this.dataGet(`series/${slug}.json`, { slug })
		]);
		const series = (pp.series || pp.manga || pp.comic || pp.data || pp) as R;
		const title = this.titleOf(series) || slug;
		const cover = this.coverOf(series);
		const chapters = this.mapChapters(
			pp.chapters || series.chapters || pp.chapterList || (pp.data as R)?.chapters,
			slug
		);
		return {
			id: `/${slug}`,
			sourceId: this.id,
			title,
			cover,
			type: this.mapType(this.str(series.type || series.format)),
			status: this.mapStatus(this.str(series.status)),
			latestChapter:
				chapters[0]?.number != null ? String(chapters[0].number) : this.latestOf(series),
			lang: this.defaultLang,
			description: this.str(series.description || series.synopsis || series.summary),
			authors: this.collectNames(series.authors || series.author || series.artist),
			genres: this.collectNames(series.genres || series.tags || series.genre),
			chapters
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		const dataPath = path.replace(/^\//, '') + '.json';
		const pp = await this.firstData([
			() => this.dataGet(dataPath),
			() => this.dataGet(path.replace(/^\//, '') + '/index.json')
		]);
		const candidates = [
			pp.pages,
			pp.images,
			pp.chapterPages,
			(pp.chapter as R)?.pages,
			(pp.chapter as R)?.images,
			(pp.data as R)?.pages,
			(pp.data as R)?.images
		];
		const pages: string[] = [];
		const seen = new Set<string>();
		for (const c of candidates) {
			if (!Array.isArray(c)) continue;
			for (const item of c) {
				const src =
					typeof item === 'string'
						? item
						: this.str((item as R)?.url || (item as R)?.src || (item as R)?.image || (item as R)?.path);
				if (!src || src.startsWith('data:')) continue;
				const url = this.absUrl(src.split(/\s+/)[0]);
				if (!url || seen.has(url) || /logo|icon|avatar|spinner|placeholder/i.test(url))
					continue;
				seen.add(url);
				pages.push(url);
			}
			if (pages.length) break;
		}
		return pages;
	}
}

export default SilentQuillSource;
