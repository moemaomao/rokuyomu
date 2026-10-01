/**
 * Cherrymist Cafe (cherrymist.cafe) — SPA + JSON API novel site
 * Path: scraper/src/sources/impl/CherryMist.ts
 *
 * API:
 *   GET  /api/series                              → semua series (array)
 *   GET  /api/series/{slug|id}                    → detail series
 *   GET  /api/chapters?series_id={id}             → daftar chapter
 *   GET  /api/chapters?limit=&order=recent&published=1 → latest updates
 *   GET  /api/chapters/{id}                       → body chapter (HTML / cipher)
 *   POST /api/chapters/{id}/reveal                → unlock body when bodyWithheld
 *        body: { ticket, frames, elapsedMs, visible, focused }
 *
 * Anti-scrape: GET chapter sering mengembalikan content="" + bodyWithheld=true
 * + revealTicket. Unlock via POST /reveal dengan ticket + presence proof
 * (frames >= 24, elapsedMs >= 600, visible/focused true) — sama seperti
 * browser site (requestAnimationFrame check).
 *
 * Chapter content memakai font-cipher (PUA + /fonts/cipher/*-{seed}.woff2).
 * inject @font-face + class cm-ciphered agar WebView/reader browser
 * menampilkan teks dengan benar. Plain-text offline tanpa font = tidak terbaca.
 *
 */
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types';

const PAGE_SIZE = 30;

const REVEAL_MIN_FRAMES = 28;
const REVEAL_MIN_ELAPSED_MS = 650;

type CmSeries = {
	id: number;
	title?: string;
	slug?: string;
	synopsis?: string | null;
	short_synopsis?: string | null;
	cover_image_url?: string | null;
	cover_thumb_url?: string | null;
	author_name?: string | null;
	original_author?: string | null;
	translator_name?: string | null;
	story_status?: string | null;
	status?: string | null;
	total_chapters?: number | null;
	last_release_at?: string | null;
	updated_at?: string | null;
	created_at?: string | null;
	genres?: string[] | null;
	tags?: string[] | null;
	age_rating?: string | null;
	translator?: { name?: string; username?: string } | null;
};

type CmChapterListItem = {
	id: number;
	title?: string;
	series_id?: number;
	series_title?: string;
	slug?: string;
	chapter_number?: number | null;
	price_type?: string | null;
	coin_price?: number | null;
	published_at?: string | null;
	created_at?: string | null;
	status?: string | null;
	is_locked?: number | boolean;
	word_count?: number | null;
};

type CmChapterDetail = CmChapterListItem & {
	content?: string | null;
	foreword?: string | null;
	afterword?: string | null;
	cipher?: { seed?: number } | null;
	is_unlocked?: boolean;
	series_title?: string;
	bodyWithheld?: boolean;
	revealTicket?: string | null;
};

type CmRevealResponse = {
	content?: string | null;
	foreword?: string | null;
	afterword?: string | null;
	cipher?: { seed?: number } | null;
	title?: string;
	chapter_number?: number | null;
};

function stripHtml(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>/gi, '\n\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function mapStatus(s?: string | null): string {
	const v = (s || '').toLowerCase();
	if (v === 'completed' || v === 'complete') return 'Completed';
	if (v === 'hiatus') return 'Hiatus';
	if (v === 'dropped') return 'Dropped';
	return 'Ongoing';
}

function seriesIdPath(s: CmSeries): string {
	const slug = (s.slug || '').trim();
	return `/story/${slug || s.id}`;
}

function isChapterLocked(c: CmChapterListItem): boolean {
	if (c.price_type === 'locked') return true;
	if (typeof c.coin_price === 'number' && c.coin_price > 0) return true;
	return false;
}

function cipherFontCss(seed: number): string {
	const families = ['opensans'] as const;
	const faces = families.flatMap((fam) =>
		(['regular', 'bold', 'italic'] as const).map((style) => {
			const weight = style === 'bold' ? 700 : 400;
			const fontStyle = style === 'italic' ? 'italic' : 'normal';
			return `@font-face{font-family:"cmc-${fam}-${seed}";src:url("https://cherrymist.cafe/fonts/cipher/${fam}-${style}-${seed}.woff2") format("woff2");font-weight:${weight};font-style:${fontStyle};font-display:block;}`;
		})
	);
	return (
		faces.join('') +
		`.cm-ciphered,.cm-ciphered *{font-family:"cmc-opensans-${seed}","Open Sans",system-ui,sans-serif !important;}`
	);
}

function wrapCipherContent(html: string, seed?: number | null): string {
	const body = (html || '').trim();
	if (!body) return '';
	if (seed == null || Number.isNaN(Number(seed))) {
		return `<div class="cm-ciphered">${body}</div>`;
	}
	const css = cipherFontCss(Number(seed));
	return `<style>${css}</style><div class="cm-ciphered" data-cm-ciphered data-cipher-seed="${seed}">${body}</div>`;
}

function hasUsableBody(data: {
	content?: string | null;
	foreword?: string | null;
	afterword?: string | null;
}): boolean {
	return !!(
		(data.content && data.content.trim()) ||
		(data.foreword && String(data.foreword).trim()) ||
		(data.afterword && String(data.afterword).trim())
	);
}

function makeRevealProof(): {
	frames: number;
	elapsedMs: number;
	visible: boolean;
	focused: boolean;
} {
	
	const frames = REVEAL_MIN_FRAMES + Math.floor(Math.random() * 12);
	const elapsedMs = REVEAL_MIN_ELAPSED_MS + Math.floor(Math.random() * 200);
	return { frames, elapsedMs, visible: true, focused: true };
}

export class CherryMistSource extends BaseSource {
	id = 'cherrymist';
	name = 'Cherrymist Cafe';
	baseUrl = 'https://cherrymist.cafe';

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'application/json, text/plain, */*',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: 'https://cherrymist.cafe/',
		Origin: 'https://cherrymist.cafe',
	
		'X-CM-Reader': '1'
	};

	private seriesCache: { at: number; data: CmSeries[] } | null = null;
	private static CACHE_TTL = 5 * 60 * 1000;

	private async getAllSeries(): Promise<CmSeries[]> {
		const now = Date.now();
		if (this.seriesCache && now - this.seriesCache.at < CherryMistSource.CACHE_TTL) {
			return this.seriesCache.data;
		}
		const data = await this.fetchJson<CmSeries[]>('/api/series');
		const list = Array.isArray(data) ? data : [];
		this.seriesCache = { at: now, data: list };
		return list;
	}

	private async postJson<T>(path: string, body: unknown): Promise<T> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				...this.headers,
				Referer: this.baseUrl + '/',
				Origin: this.baseUrl,
				Accept: 'application/json',
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(body)
		});
		if (!response.ok) {
			const text = await response.text().catch(() => '');
			throw new Error(
				`Failed to POST ${url}: ${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 200)}` : ''}`
			);
		}
		return (await response.json()) as T;
	}

	private async fetchChapterDetail(chapId: string): Promise<CmChapterDetail> {
		const path = `/api/chapters/${chapId}`;
		let last: CmChapterDetail | null = null;
		const maxAttempts = 3;

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			const data = await this.fetchJson<CmChapterDetail>(path);
			last = data;

			if (!data?.id) {
				throw new Error('Chapter not found');
			}

			if (hasUsableBody(data) && !data.bodyWithheld) {
				return data;
			}

			if (data.bodyWithheld && data.revealTicket) {
				try {
					const proof = makeRevealProof();
					const revealed = await this.postJson<CmRevealResponse>(
						`/api/chapters/${chapId}/reveal`,
						{ ticket: data.revealTicket, ...proof }
					);
					const merged: CmChapterDetail = {
						...data,
						content: revealed.content ?? data.content,
						foreword: revealed.foreword ?? data.foreword,
						afterword: revealed.afterword ?? data.afterword,
						cipher: revealed.cipher ?? data.cipher,
						bodyWithheld: false,
						revealTicket: null
					};
					if (hasUsableBody(merged)) {
						return merged;
					}
				} catch (e) {
					console.error('[CherryMist] reveal failed', chapId, e);
				}
			}

			if (attempt < maxAttempts - 1) {
				await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
			}
		}

		if (last && !last.id) {
			throw new Error('Chapter not found');
		}
		return last!;
	}

	private mapSeries(s: CmSeries): Manga | null {
		if (!s?.id && !s?.slug) return null;
		const title = (s.title || '').replace(/\s+/g, ' ').trim();
		if (!title) return null;
		const cover = s.cover_image_url || s.cover_thumb_url || '';
		const latest =
			typeof s.total_chapters === 'number' && s.total_chapters > 0
				? s.total_chapters
				: undefined;
		return {
			id: seriesIdPath(s),
			title,
			cover,
			sourceId: this.id,
			type: 'novel',
			status: mapStatus(s.story_status || s.status),
			lang: 'en',
			...(latest != null ? { latestChapter: latest } : {}),
			...(s.last_release_at
				? { updatedAt: Date.parse(s.last_release_at) || undefined }
				: {})
		};
	}

	async getLatestManga(page = 1): Promise<Manga[]> {
		try {
			const recent = await this.fetchJson<CmChapterListItem[]>(
				`/api/chapters?limit=300&order=recent&published=1`
			);
			if (Array.isArray(recent) && recent.length) {
				const all = await this.getAllSeries();
				const byId = new Map(all.map((s) => [s.id, s]));
				const seen = new Set<number>();
				const out: Manga[] = [];
				for (const ch of recent) {
					const sid = ch.series_id;
					if (sid == null || seen.has(sid)) continue;
					seen.add(sid);
					const s = byId.get(sid);
					if (s) {
						const m = this.mapSeries(s);
						if (m) out.push(m);
					} else if (ch.series_title) {
						out.push({
							id: `/story/${sid}`,
							title: ch.series_title,
							cover: '',
							sourceId: this.id,
							type: 'novel',
							lang: 'en',
							latestChapter: ch.chapter_number ?? undefined
						});
					}
				}
				const start = (Math.max(1, page) - 1) * PAGE_SIZE;
				return out.slice(start, start + PAGE_SIZE);
			}
		} catch (e) {
			console.error('[CherryMist] recent chapters failed', e);
		}

		const all = await this.getAllSeries();
		const sorted = [...all].sort((a, b) => {
			const ta = Date.parse(a.last_release_at || a.updated_at || '') || 0;
			const tb = Date.parse(b.last_release_at || b.updated_at || '') || 0;
			return tb - ta;
		});
		const start = (Math.max(1, page) - 1) * PAGE_SIZE;
		return sorted
			.slice(start, start + PAGE_SIZE)
			.map((s) => this.mapSeries(s))
			.filter((m): m is Manga => !!m);
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = query.trim().toLowerCase();
		if (!q) return [];
		const all = await this.getAllSeries();
		const hits = all.filter((s) => {
			const title = (s.title || '').toLowerCase();
			const alt = (s as any).alternative_title
				? String((s as any).alternative_title).toLowerCase()
				: '';
			const author = (s.author_name || s.original_author || '').toLowerCase();
			const tags = [...(s.genres || []), ...(s.tags || [])].join(' ').toLowerCase();
			return (
				title.includes(q) ||
				alt.includes(q) ||
				author.includes(q) ||
				tags.includes(q) ||
				(s.slug || '').toLowerCase().includes(q)
			);
		});
		const start = (Math.max(1, page) - 1) * PAGE_SIZE;
		return hits
			.slice(start, start + PAGE_SIZE)
			.map((s) => this.mapSeries(s))
			.filter((m): m is Manga => !!m);
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let key = mangaId.replace(/^\/story\//, '').replace(/^\//, '').replace(/\/$/, '');
		if (!key) throw new Error('Invalid manga id');

		const series = await this.fetchJson<CmSeries>(`/api/series/${encodeURIComponent(key)}`);
		if (!series?.id && !series?.title) {
			throw new Error('Series not found');
		}

		const title = (series.title || '').replace(/\s+/g, ' ').trim();
		const cover = series.cover_image_url || series.cover_thumb_url || '';
		let description = '';
		if (series.synopsis) {
			description = /</.test(series.synopsis)
				? stripHtml(series.synopsis)
				: String(series.synopsis).trim();
		} else if (series.short_synopsis) {
			description = String(series.short_synopsis).trim();
		}

		const authors: string[] = [];
		if (series.original_author) authors.push(series.original_author);
		if (series.author_name && !authors.includes(series.author_name)) {
			authors.push(series.author_name);
		}
		const translator =
			series.translator?.name || series.translator_name || undefined;
		if (translator && !authors.includes(translator)) {
			authors.push(`TL: ${translator}`);
		}

		const genres = [
			...(Array.isArray(series.genres) ? series.genres : []),
			...(Array.isArray(series.tags) ? series.tags : [])
		].filter((g, i, arr) => g && arr.indexOf(g) === i);

		const chapters = await this.fetchChapters(series.id, series.slug || key);

		return {
			id: seriesIdPath(series),
			title,
			cover,
			sourceId: this.id,
			description,
			authors,
			status: mapStatus(series.story_status || series.status),
			genres,
			chapters,
			type: 'novel',
			lang: 'en',
			...(typeof series.total_chapters === 'number'
				? { latestChapter: series.total_chapters }
				: {})
		};
	}

	private async fetchChapters(seriesId: number, seriesSlug: string): Promise<Chapter[]> {
		const raw = await this.fetchJson<CmChapterListItem[]>(
			`/api/chapters?series_id=${seriesId}`
		);
		const list = Array.isArray(raw) ? raw : [];
		const out: Chapter[] = [];
		const seen = new Set<string>();

		for (const c of list) {
			if (c.status && c.status !== 'published') continue;
			const num =
				typeof c.chapter_number === 'number'
					? c.chapter_number
					: out.length + 1;

			const id = `/story/${seriesSlug}/chapter/${c.id}`;
			if (seen.has(id)) continue;
			seen.add(id);

			out.push({
				id,
				title: (c.title || `Chapter ${num}`).replace(/\s+/g, ' ').trim(),
				number: num,
				date: c.published_at || c.created_at || undefined,
				isLocked: isChapterLocked(c)
			});
		}

		out.sort((a, b) => b.number - a.number);
		return out;
	}

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {

		const m =
			chapterId.match(/\/chapter\/(\d+)/) ||
			chapterId.match(/(?:^|\/)(\d+)$/);
		const chapId = m?.[1];
		if (!chapId) {
			throw new Error(`Invalid chapter id: ${chapterId}`);
		}

		const data = await this.fetchChapterDetail(chapId);
		if (!data?.id) throw new Error('Chapter not found');

		if (isChapterLocked(data) && !data.is_unlocked) {
			throw new Error('Chapter is locked / premium on Cherrymist Cafe');
		}

		const title = (data.title || `Chapter ${data.chapter_number || ''}`)
			.replace(/\s+/g, ' ')
			.trim();

		const parts: string[] = [];
		if (data.foreword) parts.push(String(data.foreword));
		if (data.content) parts.push(String(data.content));
		if (data.afterword) parts.push(String(data.afterword));

		const seed = data.cipher?.seed;
		const content = wrapCipherContent(parts.join('\n'), seed);

		if (!content.trim()) {
			throw new Error(
				'Chapter body is empty (withheld or unavailable). Try again later or open on cherrymist.cafe.'
			);
		}

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		try {
			const seriesId = data.series_id;
			if (seriesId != null) {
				let seriesSlug = '';
				const seriesPath = chapterId.match(/^\/story\/([^/]+)\//);
				seriesSlug = seriesPath?.[1] || '';
				if (!seriesSlug) {
					const s = await this.fetchJson<CmSeries>(`/api/series/${seriesId}`);
					seriesSlug = s.slug || String(seriesId);
				}
				const chs = await this.fetchChapters(seriesId, seriesSlug);
				const idx = chs.findIndex((c) => c.id.endsWith(`/chapter/${chapId}`));
				if (idx >= 0) {
					prevChapterId = chs[idx + 1]?.id ?? null;
					nextChapterId = chs[idx - 1]?.id ?? null;
				}
			}
		} catch {
			/* optional */
		}

		return {
			title,
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default CherryMistSource;
