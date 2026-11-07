/**
 * Flame Comics — Next.js `_next/data` → NextDataSource
 * ID: /series/{id} | /series/{id}/chapter/{token}
 */
import { NextDataSource } from '../family/NextDataSource';
import type { Chapter, Manga, MangaDetails } from '../types-manga';

export class FlameComicsSource extends NextDataSource {
	id = 'flamecomics';
	name = 'Flame Comics';
	baseUrl = 'https://flamecomics.xyz';
	private readonly cdn = 'https://cdn.flamecomics.xyz';

	private sid(id: string) {
		const p = this.cleanId(id).split('/').filter(Boolean);
		return p[0] === 'series' ? p[1] || '' : p[0] || '';
	}

	private cover(s: any) {
		if (!s?.series_id || !s?.cover) return '';
		const u = `${this.cdn}/uploads/images/series/${s.series_id}/${s.cover}`;
		return s.last_edit != null ? `${u}?${s.last_edit}` : u;
	}

	private item(s: any): Manga | null {
		if (s?.series_id == null || !s?.title) return null;
		const ch = s.chapters?.[0]?.chapter ?? s.chapters?.[0]?.name ?? s.latest_chapter;
		const n = this.parseChapterNumber(ch);
		return {
			id: `/series/${s.series_id}`,
			sourceId: this.id,
			title: String(s.title).trim(),
			cover: this.cover(s),
			type: this.mapType(s.type, s.country),
			status: this.mapStatus(s.status),
			latestChapter: n ? String(n) : ch != null ? String(ch) : undefined,
			lang: this.defaultLang
		};
	}

	async getLatestManga(page: number): Promise<Manga[]> {
		const [idx, br] = await Promise.all([
			this.dataGet<any>('index.json'),
			this.dataGet<any>('browse.json')
		]);
		const latest: any[] = (this.props<any>(idx)?.latestEntries?.blocks || []).flatMap(
			(b: any) => b?.series || []
		);
		const chMap = new Map(latest.map((x) => [x.series_id, x]));
		const browse = [...(this.props<any>(br)?.series || [])].sort(
			(a, b) => Number(b?.last_edit ?? 0) - Number(a?.last_edit ?? 0)
		);
		const seen = new Set<string | number>();
		const ordered: any[] = [];
		for (const it of [...latest, ...browse]) {
			if (it?.series_id == null || seen.has(it.series_id)) continue;
			seen.add(it.series_id);
			const hit = chMap.get(it.series_id);
			ordered.push(hit ? { ...it, chapters: hit.chapters } : it);
		}
		return this.paginate(
			this.dedupeManga(ordered.map((x) => this.item(x))),
			page
		);
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = query.trim().toLowerCase();
		const page = opts?.page || 1;
		if (!q) return this.getLatestManga(page);
		const br = await this.dataGet<any>('browse.json');
		const rows = (this.props<any>(br)?.series || []).filter((it: any) => {
			const t = String(it?.title || '').toLowerCase();
			const a = String(it?.alt_title || it?.alternative || '').toLowerCase();
			return t.includes(q) || a.includes(q);
		});
		return this.paginate(
			this.dedupeManga(rows.map((x: any) => this.item(x))),
			page
		);
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const id = this.sid(mangaId);
		const raw = await this.dataGet<any>(`series/${encodeURIComponent(id)}.json`, { id });
		const pp = this.props<any>(raw);
		const s = pp?.series || {};
		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		for (const ch of pp?.chapters || s.chapters || []) {
			const token = String(ch?.token || ch?.id || '').trim();
			if (!token || seen.has(token)) continue;
			seen.add(token);
			const number = this.parseChapterNumber(ch?.chapter ?? ch?.name) || chapters.length + 1;
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
			type: this.mapType(s.type, s.country),
			status: this.mapStatus(s.status),
			description: [alt && `Alternative: ${alt}`, synopsis].filter(Boolean).join('\n'),
			authors: this.collectNames([s.author, s.authors, s.artist, s.artists]),
			genres: this.collectNames(s.genres || s.tags),
			chapters,
			latestChapter: chapters[0]?.number != null ? String(chapters[0].number) : undefined,
			lang: this.defaultLang
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const m = this.cleanId(chapterId).match(/^\/series\/([^/]+)\/chapter\/(.+)$/i);
		if (!m) return [];
		const [, seriesId, token] = m;
		const raw = await this.dataGet<any>(
			`series/${encodeURIComponent(seriesId)}/${encodeURIComponent(token)}.json`,
			{ id: seriesId, token }
		);
		const ch = this.props<any>(raw)?.chapter;
		if (!ch) return [];
		const img = ch.images;
		const pages: any[] = Array.isArray(img)
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
	}
}
