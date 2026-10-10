/**
 * manta.net adapter (official JSON API)
 *
 * List   : GET /manta/v1/search/series?cat=New&lang=en
 * Search : GET /manta/v1/search/series?q=QUERY&lang=en
 * Detail : GET /front/v1/series/{id}?lang=en
 * Pages  : GET /front/v1/episodes/{episodeId}?lang=en  → data.cutImages[].downloadUrl
 *
 * ID format:
 *   manga   : "/series/{id}"
 *   chapter : "/episodes/{episodeId}"
 *
 * Locked episodes: isLocked=true; page list filters "just-black.jpg" placeholders.
 */

import { BaseSource } from '../../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';
import { fetchWithCf } from '../../../lib/fetchWithCf';

export class MantaSource extends BaseSource {
	id = 'manta';
	name = 'Manta';
	baseUrl = 'https://manta.net';

	private readonly PER_PAGE = 24;
	private readonly LANG = 'en';
	private readonly BLACK_MARKER = 'just-black.jpg';
	private listCache: { at: number; items: Manga[] } | null = null;
	private readonly LIST_TTL_MS = 60_000;

	private async getJson<T>(path: string): Promise<T> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const body = await fetchWithCf(url, {
			headers: {
				...this.headers,
				Accept: 'application/json',
				Origin: this.baseUrl,
				Referer: `${this.baseUrl}/`,
				'Accept-Language': this.LANG
			}
		});
		try {
			return JSON.parse(body) as T;
		} catch {
			throw new Error(`[manta] invalid JSON from ${url} (len=${body?.length ?? 0})`);
		}
	}

	private pickCover(image: any): string {
		if (!image || typeof image !== 'object') return '';
		const order = [
			'1280x1840_720',
			'1280x1840_480',
			'1440x3072',
			'title_450',
			'title',
			'1440x1440_720',
			'1440x1440_480'
		];
		for (const k of order) {
			const v = image[k];
			const url = v?.downloadUrl || (typeof v === 'string' ? v : '');
			if (url) return url;
		}
		// any downloadUrl
		for (const v of Object.values(image)) {
			if (v && typeof v === 'object' && (v as any).downloadUrl) {
				return (v as any).downloadUrl;
			}
		}
		return '';
	}

	private pickName(name: any): string {
		if (!name) return '';
		if (typeof name === 'string') return name;
		return name.en || name.es || name.fr || Object.values(name).find((x) => typeof x === 'string' && x) || '';
	}

	private seriesIdFromPath(id: string): string {
		const m = String(id).match(/\/series\/(\d+)/) || String(id).match(/^(\d+)$/);
		return m?.[1] || String(id).replace(/^\//, '');
	}

	private episodeIdFromPath(id: string): string {
		const m = String(id).match(/\/episodes\/(\d+)/) || String(id).match(/^(\d+)$/);
		return m?.[1] || String(id).replace(/^\//, '');
	}

	private mapSeriesItem(item: any): Manga | null {
		const sid = item?.id;
		if (!sid) return null;
		const data = item.data || {};
		const title = this.pickName(data.title) || `Series ${sid}`;
		const cover = this.pickCover(item.image);
		const isCompleted = data.isCompleted === true;
		const latest =
			item.latestEpisode?.ord ??
			item.episodeCount ??
			undefined;

		return {
			id: `/series/${sid}`,
			sourceId: this.id,
			title,
			cover,
			type: 'manhwa',
			status: isCompleted ? 'Completed' : 'Ongoing',
			latestChapter: latest,
			lang: this.LANG
		};
	}

	// ── List ─────────────────────────────────────────────────────────────────

	private async fetchAllNew(): Promise<Manga[]> {
		const now = Date.now();
		if (this.listCache && now - this.listCache.at < this.LIST_TTL_MS) {
			return this.listCache.items;
		}
		const res = await this.getJson<{ data?: any[] }>(
			`/manta/v1/search/series?cat=New&lang=${this.LANG}`
		);
		const all = (res.data || [])
			.map((x) => this.mapSeriesItem(x))
			.filter(Boolean) as Manga[];
		this.listCache = { at: now, items: all };
		return all;
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const all = await this.fetchAllNew();
			const start = (p - 1) * this.PER_PAGE;
			if (start >= all.length) {
				console.log(`[manta] latest page=${p} → 0 (end, total=${all.length})`);
				return [];
			}
			const sliced = all.slice(start, start + this.PER_PAGE);
			console.log(`[manta] latest page=${p} → ${sliced.length}/${all.length}`);
			return sliced;
		} catch (e) {
			console.error('[manta] getLatestManga', e);
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
			const res = await this.getJson<{ data?: any[] }>(
				`/manta/v1/search/series?lang=${this.LANG}&q=${encodeURIComponent(q)}`
			);
			const all = (res.data || [])
				.map((x) => this.mapSeriesItem(x))
				.filter(Boolean) as Manga[];
			const start = (page - 1) * this.PER_PAGE;
			if (start >= all.length) {
				console.log(`[manta] search "${q}" page=${page} → 0 (end)`);
				return [];
			}
			const sliced = all.slice(start, start + this.PER_PAGE);
			console.log(`[manta] search "${q}" page=${page} → ${sliced.length}/${all.length}`);
			return sliced;
		} catch (e) {
			console.error('[manta] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const sid = this.seriesIdFromPath(mangaId);
		if (!/^\d+$/.test(sid)) {
			throw new Error(`Invalid manta id: ${mangaId}`);
		}

		const res = await this.getJson<{ data?: any }>(
			`/front/v1/series/${sid}?lang=${this.LANG}`
		);
		const series = res.data;
		if (!series) throw new Error(`[manta] series ${sid} not found`);

		const details = series.data || {};
		const title = this.pickName(details.title) || `Series ${sid}`;
		const cover = this.pickCover(series.image);

		const descObj = details.description || {};
		const description = [descObj.short, descObj.long]
			.filter((x) => typeof x === 'string' && x.trim())
			.join('\n\n')
			.trim();

		const creators: any[] = details.creators || [];
		const authors = creators
			.filter((c) => c.role !== 'Illustration')
			.map((c) => c.name)
			.filter(Boolean);
		const artists = creators
			.filter((c) => c.role === 'Illustration')
			.map((c) => c.name)
			.filter(Boolean);
		const allAuthors = [...authors, ...artists.filter((a) => !authors.includes(a))];

		const genres = (details.tags || [])
			.map((t: any) => this.pickName(t.name || t))
			.filter(Boolean);

		const isCompleted = details.isCompleted === true;
		const isEpLocked = (ep: any) => {
			const st = ep?.lockData?.state;
			if (st == null) return false;
			return st !== 110 && st !== 130;
		};

		const episodes: any[] = series.episodes || [];
		const chapters: Chapter[] = episodes
			.map((ep) => {
				const locked = isEpLocked(ep);
				const epTitle =
					ep?.data?.title ||
					`Episode ${ep.ord ?? ''}`.trim();
				return {
					id: `/episodes/${ep.id}`,
					title: locked ? `${epTitle}` : epTitle,
					number: Number(ep.ord) || 0,
					date: ep.openAt || ep.createdAt || undefined,
					isLocked: locked
				} as Chapter;
			})
			.sort((a, b) => b.number - a.number);

		const latestChapter = chapters.length
			? Math.max(...chapters.map((c) => c.number))
			: undefined;

		console.log(
			`[manta] details ${sid} → chapters=${chapters.length} genres=${genres.length}`
		);

		return {
			id: `/series/${sid}`,
			sourceId: this.id,
			title,
			cover,
			type: 'manhwa',
			status: isCompleted ? 'Completed' : 'Ongoing',
			description,
			authors: allAuthors,
			genres,
			chapters,
			latestChapter,
			lang: this.LANG
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const eid = this.episodeIdFromPath(chapterId);
		if (!/^\d+$/.test(eid)) {
			console.error('[manta] invalid chapter id', chapterId);
			return [];
		}

		try {
			const res = await this.getJson<{ data?: any }>(
				`/front/v1/episodes/${eid}?lang=${this.LANG}`
			);
			const images: any[] = res.data?.cutImages || [];
			const urls = images
				.map((img) => img?.downloadUrl || (typeof img === 'string' ? img : ''))
				.filter(
					(u: string) =>
						u &&
						/^https?:\/\//i.test(u) &&
						!u.includes(this.BLACK_MARKER)
				);

			console.log(`[manta] episode ${eid} → ${urls.length} pages`);
			return urls;
		} catch (e) {
			console.error('[manta] getChapterPages', eid, e);
			return [];
		}
	}
}
