/**
 * Flame Comics (flamecomics.xyz) — Next.js `_next/data`
 * → extends NextDataSource
 *
 * ID: /series/{id} | /series/{id}/chapter/{token}
 */
import { NextDataSource } from '../../family/NextDataSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';

export class FlameComicsSource extends NextDataSource {
	id = 'flamecomics';
	name = 'Flame Comics';
	baseUrl = 'https://flamecomics.xyz';

	private readonly cdn = 'https://cdn.flamecomics.xyz';
	private readonly perPage = 24;

	private sid(id: string): string {
		const p = id.replace(/^\/+/, '').split('/').filter(Boolean);
		return p[0] === 'series' ? p[1] || '' : p[0] || '';
	}

	private chParts(id: string): [string, string] {
		const m = id.replace(/^\/+/, '').match(/^series\/([^/]+)\/chapter\/(.+)$/i);
		if (m) return [m[1], m[2]];
		const p = id.replace(/^\/+/, '').split('/').filter(Boolean);
		return [p[0] === 'series' ? p[1] || '' : p[0] || '', p.at(-1) || ''];
	}

	private cover(s: any): string {
		if (!s?.series_id || !s?.cover) return '';
		const u = `${this.cdn}/uploads/images/series/${s.series_id}/${s.cover}`;
		return s.last_edit != null ? `${u}?${s.last_edit}` : u;
	}

	private type(s: any): string {
		const t = String(s?.type || '').toLowerCase();
		if (t === 'manhwa' || t === 'manhua' || t === 'manga') return t;
		const c = String(s?.country || '').toUpperCase();
		return c === 'JP' ? 'manga' : c === 'CN' ? 'manhua' : 'manhwa';
	}

	private status(s: any): string {
		const v = String(s?.status || '').toLowerCase();
		if (/complet/.test(v)) return 'Completed';
		if (v === 'hiatus') return 'Hiatus';
		if (/drop|cancel/.test(v)) return 'Cancelled';
		return 'Ongoing';
	}

	private mapItem(s: any): Manga | null {
		if (s?.series_id == null || !s?.title) return null;
		const ch = s.chapters?.[0]?.chapter ?? s.chapters?.[0]?.name ?? s.latest_chapter;
		const n = parseFloat(String(ch ?? ''));
		return {
			id: `/series/${s.series_id}`,
			sourceId: this.id,
			title: String(s.title).trim(),
			cover: this.cover(s),
			type: this.type(s),
			status: this.status(s),
			latestChapter: Number.isFinite(n) ? String(n) : ch != null ? String(ch) : undefined,
			lang: 'en'
		};
	}

	/** index (latest + chapter badge) + browse (full pool), client-side page */
	async getLatestManga(page: number): Promise<Manga[]> {
		const p = Math.max(1, page || 1);
		try {
			const [idx, br] = await Promise.all([
				this.dataGet<any>('index.json'),
				this.dataGet<any>('browse.json')
			]);
			const latest: any[] = [];
			for (const b of idx?.pageProps?.latestEntries?.blocks || []) {
				if (Array.isArray(b?.series)) latest.push(...b.series);
			}
			const chMap = new Map(latest.map((x) => [x.series_id, x]));
			const browse = [...(br?.pageProps?.series || [])].sort(
				(a, b) => Number(b?.last_edit ?? 0) - Number(a?.last_edit ?? 0)
			);

			const seen = new Set<string | number>();
			const ordered: any[] = [];
			for (const it of [...latest, ...browse]) {
				if (it?.series_id == null || seen.has(it.series_id)) continue;
				seen.add(it.series_id);
				const withCh = chMap.get(it.series_id);
				ordered.push(withCh ? { ...it, chapters: withCh.chapters } : it);
			}

			const list = ordered.map((x) => this.mapItem(x)).filter(Boolean) as Manga[];
			const start = (p - 1) * this.perPage;
			return list.slice(start, start + this.perPage);
		} catch (e) {
			console.error('[flamecomics] latest', e);
			return [];
		}
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim().toLowerCase();
		const page = Math.max(1, opts?.page || 1);
		if (!q) return this.getLatestManga(page);
		try {
			const br = await this.dataGet<any>('browse.json');
			const rows = (br?.pageProps?.series || []).filter((it: any) => {
				const t = String(it?.title || '').toLowerCase();
				const a = String(it?.alt_title || it?.alternative || '').toLowerCase();
				return t.includes(q) || a.includes(q);
			});
			const list = rows.map((x: any) => this.mapItem(x)).filter(Boolean) as Manga[];
			const start = (page - 1) * this.perPage;
			return list.slice(start, start + this.perPage);
		} catch (e) {
			console.error('[flamecomics] search', e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const id = this.sid(mangaId);
		if (!id) throw new Error(`Invalid flamecomics id: ${mangaId}`);

		const raw = await this.dataGet<any>(`series/${encodeURIComponent(id)}.json`, { id });
		const s = raw?.pageProps?.series || {};
		const rawCh: any[] = raw?.pageProps?.chapters || s.chapters || [];

		const authors: string[] = [];
		for (const k of ['author', 'authors', 'artist', 'artists']) {
			const v = s[k];
			for (const a of Array.isArray(v) ? v : v ? [v] : []) {
				const n = String(a?.name || a || '').trim();
				if (n && !authors.includes(n)) authors.push(n);
			}
		}
		const genres: string[] = [];
		for (const g of s.genres || s.tags || []) {
			const n = String(g?.name || g || '').trim();
			if (n && n.length < 40 && !genres.includes(n)) genres.push(n);
		}

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		for (const ch of rawCh) {
			const token = String(ch?.token || ch?.id || '').trim();
			if (!token || seen.has(token)) continue;
			seen.add(token);
			const number = parseFloat(String(ch?.chapter ?? ch?.name ?? '')) || chapters.length + 1;
			const ts = ch?.release_date != null ? Number(ch.release_date) : 0;
			chapters.push({
				id: `/series/${id}/chapter/${token}`,
				title: String(ch?.name || ch?.title || '').trim() || `Chapter ${number}`,
				number,
				date: ts
					? new Date(ts < 2e10 ? ts * 1000 : ts).toISOString().slice(0, 10)
					: undefined
			});
		}
		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const alt = String(s.alt_title || s.alternative || '').trim();
		const synopsis = String(s.description || s.synopsis || '').replace(/\s+/g, ' ').trim();

		return {
			id: `/series/${id}`,
			sourceId: this.id,
			title: String(s.title || id).trim(),
			cover: this.cover(s),
			type: this.type(s),
			status: this.status(s),
			description: [alt && `Alternative: ${alt}`, synopsis].filter(Boolean).join('\n'),
			authors,
			genres,
			chapters,
			latestChapter: chapters[0]?.number != null ? String(chapters[0].number) : undefined,
			lang: 'en'
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const [seriesId, token] = this.chParts(chapterId);
		if (!seriesId || !token) return [];
		try {
			const raw = await this.dataGet<any>(
				`series/${encodeURIComponent(seriesId)}/${encodeURIComponent(token)}.json`,
				{ id: seriesId, token }
			);
			const ch = raw?.pageProps?.chapter;
			if (!ch) return [];

			const img = ch.images;
			const pages: Array<{ name?: string }> = Array.isArray(img)
				? img
				: img && typeof img === 'object'
					? Object.keys(img)
							.sort((a, b) => Number(a) - Number(b))
							.map((k) => img[k])
					: [];

			const sid = ch.series_id ?? seriesId;
			const tok = ch.token || token;
			const rel = ch.release_date != null ? String(ch.release_date) : '';

			return pages
				.map((p) => String(p?.name || '').trim())
				.filter(Boolean)
				.map((name) => {
					const u = `${this.cdn}/uploads/images/series/${sid}/${tok}/${name}`;
					return rel ? `${u}?${rel}` : u;
				});
		} catch (e) {
			console.error('[flamecomics] pages', seriesId, token, e);
			return [];
		}
	}
}
