/**
 * Comic Gardo (comic-gardo.com) — GigaViewer manga
 * Path: scraper/src/sources/impl/ComicGardo.ts
 *
 * Platform: GigaViewer (sama seperti Comic Days / Jump+)
 *
 * Cookie (pribadi):
 *   Env: COMIC_GARDO_COOKIE="glsc=NILAI; _unv_id=...; _unv_aid=..."
 *   Atau isi PRIVATE_COOKIE di bawah (JANGAN commit ke git publik).
 *
 * Format Cookie = salin utuh dari Network → Request Headers → Cookie
 * (jangan tambah "glsc=" di depan seluruh string).
 */
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types';

const PAGE_SIZE = 30;

/**
 * Tempel Cookie header utuh dari DevTools di sini, contoh:
 *   'glsc=abc123; _unv_id=...; _unv_aid=...'
 * Atau set env COMIC_GARDO_COOKIE.
 *
 * Kosongkan dulu kalau list kosong (cookie expired sering bikin fetch aneh).
 */
const PRIVATE_COOKIE = process.env.COMIC_GARDO_COOKIE || 'glsc=ryN1tzJM9vm88ZLlvF9JkPOvJ8ivHA0oSanmYdEQUH1JJnX5E2k6dYmpKj4usecd';

function decodeEntities(s: string): string {
	return (s || '')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#34;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&nbsp;/g, ' ');
}

function stripHtml(html: string): string {
	return decodeEntities(
		html
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/p>/gi, '\n\n')
			.replace(/<[^>]+>/g, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
}

function parseChapterNumber(title: string): number {
	const m = title.match(
		/(?:第)?\s*(\d+)\s*(?:話|话|回|巻|卷)?|(?:chapter|ch\.?|ep\.?)\s*(\d+)/i
	);
	if (m) return parseInt(m[1] || m[2], 10);
	const n = title.match(/\b(\d+)\b/);
	return n ? parseInt(n[1], 10) : 0;
}

/** Normalisasi cookie: ambil glsc=... yang benar jika user salah paste */
function normalizeCookie(raw: string): string {
	const s = (raw || '').trim();
	if (!s) return '';
	// Salah: "glsc=_gcl_au=...; glsc=REAL; ..." → prioritaskan glsc yang value-nya bukan diawali _
	if (/^glsc=_gcl_au=/i.test(s) || /^glsc=_ga=/i.test(s)) {
		const real = s.match(/(?:^|;\s*)glsc=([^=;]{20,})/i);
		if (real && !real[1].startsWith('_')) {
			const rest = s
				.replace(/^glsc=_gcl_au=[^;]*;?\s*/i, '')
				.replace(/(?:^|;\s*)glsc=[^;]*/i, '')
				.trim()
				.replace(/^;|;$/g, '');
			return `glsc=${real[1]}${rest ? '; ' + rest : ''}`;
		}
		// strip prefix glsc= yang menempel di depan whole-header
		return s.replace(/^glsc=/i, '');
	}
	return s;
}

type PaginationItem = {
	readable_product_id: string;
	title: string;
	display_open_at?: string;
	status?: { label?: string; buy_price?: number };
	purchase_info?: { can_read?: boolean; is_free?: boolean; has_purchased?: boolean };
	thumbnail_uri?: string;
};

type EpisodeJson = {
	readableProduct?: {
		pageStructure?: {
			pages?: Array<{ src?: string; type?: string }>;
			choJuGiga?: string;
		};
		series?: { id?: string; title?: string };
		number?: number;
		permalink?: string;
	};
};

export class ComicGardoSource extends BaseSource {
	id = 'comicgardo';
	name = 'Comic Gardo';
	baseUrl = 'https://comic-gardo.com';

	private authCookie = normalizeCookie(
		process.env.COMIC_GARDO_COOKIE || PRIVATE_COOKIE
	);

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/json,*/*',
		'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
		Referer: 'https://comic-gardo.com/',
		Origin: 'https://comic-gardo.com',
		'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
		'sec-ch-ua-mobile': '?0',
		'sec-ch-ua-platform': '"Windows"',
		'Sec-Fetch-Dest': 'document',
		'Sec-Fetch-Mode': 'navigate',
		'Sec-Fetch-Site': 'same-origin',
		'Upgrade-Insecure-Requests': '1'
	};

	constructor() {
		super();
		if (this.authCookie) {
			this.headers.Cookie = this.authCookie;
			console.log(
				'[ComicGardo] cookie loaded, length=',
				this.authCookie.length,
				'has glsc=',
				/glsc=/i.test(this.authCookie)
			);
		} else {
			console.warn('[ComicGardo] no PRIVATE_COOKIE / COMIC_GARDO_COOKIE');
		}
	}

	private parseSeriesCards(html: string): Manga[] {
	const out: Manga[] = [];
	const seen = new Set<string>();

	if (!html || html.length < 500) {
		console.warn('[ComicGardo] html too short', html?.length);
		return out;
	}

	// Cara paling stabil: series-thumbnail + alt + (opsional) date
	const regex =
		/src="(https:\/\/cdn-scissors\.gigaviewer\.com[^"]*series-thumbnail(?:%2F|\/)(\d+)-[^"]*)"[^>]*alt="([^"]*)"/gi;

	for (const t of html.matchAll(regex)) {
		const seriesId = t[2];
		const id = `/series/${seriesId}`;
		if (seen.has(id)) continue;
		seen.add(id);

		const title = decodeEntities(t[3] || seriesId).trim();
		const cover = decodeEntities(t[1]);

		out.push({
			id,
			title,
			cover,
			sourceId: this.id,
			type: 'manga',
			lang: 'ja',
			status: 'Ongoing'
		});
	}

	// Fallback lama kalau masih kosong
	if (!out.length) {
		const blocks = html.split(/(?=class="[^"]*SeriesListItem_link_)/);
		for (const b of blocks) {
			const sidM = b.match(/series-thumbnail(?:%2F|\/)(\d+)-/);
			const titleM = b.match(
				/SeriesListItem_series_title_[^"]*"[^>]*>([^<]+)</
			);
			if (!sidM || !titleM) continue;
			const seriesId = sidM[1];
			const id = `/series/${seriesId}`;
			if (seen.has(id)) continue;
			seen.add(id);
			const imgM = b.match(
				/src="(https:\/\/cdn-scissors\.gigaviewer\.com[^"]+)"/i
			);
			out.push({
				id,
				title: decodeEntities(titleM[1]).trim(),
				cover: imgM ? decodeEntities(imgM[1]) : '',
				sourceId: this.id,
				type: 'manga',
				lang: 'ja',
				status: 'Ongoing'
			});
		}
	}

	console.log('[ComicGardo] parseSeriesCards result=', out.length);
	return out;
}

	async getLatestManga(page = 1): Promise<Manga[]> {
	const pageNum = Math.max(1, page);

	try {
		const html = await this.fetchHtml('/series');
		console.log(
			'[ComicGardo] fetch /series htmlLen=',
			html?.length ?? 0,
			'hasSeriesList=',
			/SeriesListItem/i.test(html || '')
		);

		const all = this.parseSeriesCards(html || '');
		console.log('[ComicGardo] total parsed=', all.length);

		const start = (pageNum - 1) * PAGE_SIZE;
		return all.slice(start, start + PAGE_SIZE);
	} catch (e) {
		console.error('[ComicGardo] latest failed', e);
		return [];
	}
}

	async searchManga(query: string, _opts?: { page?: number }): Promise<Manga[]> {
		const q = query.trim();
		if (!q) return [];
		try {
			const html = await this.fetchHtml(`/search?q=${encodeURIComponent(q)}`);
			return this.parseSeriesCards(html || '').slice(0, PAGE_SIZE);
		} catch (e) {
			console.error('[ComicGardo] search failed', e);
			return [];
		}
	}

	private async fetchPagination(seriesId: string, offset: number): Promise<PaginationItem[]> {
	const path =
		`/api/viewer/pagination_readable_products?type=episode` +
		`&aggregate_id=${encodeURIComponent(seriesId)}` +
		`&sort_order=desc&offset=${offset}`;
	
	console.log('[ComicGardo] fetchPagination', path);
	
	const data = await this.fetchJson<PaginationItem[]>(path);
	return Array.isArray(data) ? data : [];
}

	private async fetchAllChapters(seriesId: string): Promise<Chapter[]> {
		const out: Chapter[] = [];
		const seen = new Set<string>();
		let offset = 0;
		for (let i = 0; i < 40; i++) {
			const batch = await this.fetchPagination(seriesId, offset);
			if (!batch.length) break;
			for (const it of batch) {
				const epId = it.readable_product_id;
				if (!epId || seen.has(epId)) continue;
				seen.add(epId);
				const label = it.status?.label || '';
				const locked =
					label === 'is_purchasable' ||
					label === 'is_rentable' ||
					label === 'is_rentable_and_subscribable' ||
					label === 'unpublished';
				const free =
					label === 'is_free' ||
					it.purchase_info?.is_free === true ||
					it.purchase_info?.can_read === true;
				const prefix = locked && !free ? '💴 ' : '';
				out.push({
					id: `/episode/${epId}`,
					title: prefix + (it.title || epId),
					number: parseChapterNumber(it.title || ''),
					date: it.display_open_at,
					isLocked: locked && !free
				});
			}
			offset += batch.length;
			if (batch.length < 20) break;
		}
		out.sort(
			(a, b) =>
				b.number - a.number || (b.date || '').localeCompare(a.date || '')
		);
		return out;
	}

	private async fetchRssMeta(seriesId: string): Promise<{
		title: string;
		description: string;
		authors: string[];
	}> {
		try {
			const xml = await this.fetchHtml(`/rss/series/${seriesId}`);
			const title =
				xml.match(/<channel>[\s\S]*?<title>([^<]+)<\/title>/i)?.[1] || '';
			const cleanTitle = decodeEntities(title)
				.replace(/^コミックガルド[（(]/, '')
				.replace(/[）)]\s*$/, '')
				.trim();
			const description =
				xml.match(
					/<channel>[\s\S]*?<description>([^<]*)<\/description>/i
				)?.[1] || '';
			const author = xml.match(/<author>([^<]+)<\/author>/i)?.[1] || '';
			return {
				title: cleanTitle,
				description: decodeEntities(description),
				authors: author
					? author
							.split(/[/／、,]/)
							.map((s) => s.trim())
							.filter(Boolean)
					: []
			};
		} catch {
			return { title: '', description: '', authors: [] };
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
	const seriesId =
		mangaId.match(/\/series\/(\d+)/)?.[1] ||
		mangaId.replace(/^\/+/, '').split('/')[0];
	
	console.log('[ComicGardo] getMangaDetails mangaId=', mangaId, 'seriesId=', seriesId);
	
	if (!seriesId) throw new Error(`Invalid manga id: ${mangaId}`);

		const meta = await this.fetchRssMeta(seriesId);
		const chapters = await this.fetchAllChapters(seriesId);

		let cover = '';
		try {
			const xml = await this.fetchHtml(`/rss/series/${seriesId}`);
			const enc = xml.match(/<enclosure[^>]+url="([^"]+)"/i);
			if (enc) cover = enc[1];
		} catch {
			/* ignore */
		}

		return {
			id: `/series/${seriesId}`,
			title: meta.title || seriesId,
			cover,
			sourceId: this.id,
			description: meta.description,
			authors: meta.authors,
			status: 'Ongoing',
			genres: [],
			chapters,
			type: 'manga',
			lang: 'ja',
			...(chapters.length ? { latestChapter: chapters[0]?.number } : {})
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const epId =
			chapterId.match(/\/episode\/(\d+)/)?.[1] ||
			chapterId.replace(/^\/+/, '').split('/').pop();
		if (!epId) throw new Error(`Invalid chapter id: ${chapterId}`);

		const html = await this.fetchHtml(`/episode/${epId}`);
		const m =
			html.match(
				/id=["']episode-json["'][^>]*data-value=["']([^"']+)["']/i
			) ||
			html.match(/data-value=["'](\{[^"']*readableProduct[^"']*)["']/i);

		if (!m) {
			throw new Error(
				'Episode JSON not found — chapter may require login / purchase'
			);
		}

		let raw = decodeEntities(m[1]).replace(/&quot;/g, '"');
		let data: EpisodeJson;
		try {
			data = JSON.parse(raw);
		} catch {
			throw new Error('Failed to parse episode JSON');
		}

		const pages = data.readableProduct?.pageStructure?.pages || [];
		const imgs = pages
			.filter((p) => p.type === 'main' && p.src)
			.map((p) => p.src as string);

		if (!imgs.length) {
			throw new Error(
				this.authCookie
					? 'No pages — cookie expired atau episode belum dibeli'
					: 'No pages — set cookie glsc=... untuk episode berbayar'
			);
		}
		return imgs;
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		const pages = await this.getChapterPages(chapterId);
		const epId = chapterId.match(/\/episode\/(\d+)/)?.[1] || chapterId;
		const imgs = pages
			.map((src) => `<img src="${src}" referrerpolicy="no-referrer" />`)
			.join('\n');
		return {
			title: `Episode ${epId}`,
			content: `<div class="cg-chapter">${imgs}</div>`,
			prevChapterId: null,
			nextChapterId: null
		};
	}
}

export default ComicGardoSource;