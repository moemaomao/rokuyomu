/**
 * Hybrid scraper client
 *
 * - Source di WORKER_SOURCE_IDS  → parse lokal di CF Worker (Cheerio)
 * - Source lainnya               → HTTP ke external Node scraper (Vercel/Render)
 *
 * Worker tetap ringan: mayoritas request hanya `fetch()` JSON + KV.
 */

import { env } from '$env/dynamic/private';
import type { Manga, MangaDetails } from '$lib/server/sources/types';
import { isWorkerSource, getWorkerSource } from '$lib/server/workerSources';

function baseUrl(): string {
	const u =
		env.SCRAPER_BASE_URL ||
		(typeof process !== 'undefined' ? process.env?.SCRAPER_BASE_URL : '') ||
		'http://localhost:3000';
	return String(u).replace(/\/$/, '');
}

function apiKey(): string {
	return (
		env.SCRAPER_API_KEY ||
		(typeof process !== 'undefined' ? process.env?.SCRAPER_API_KEY : '') ||
		''
	);
}

async function scraperFetch<T>(path: string): Promise<T> {
	const url = `${baseUrl()}${path.startsWith('/') ? path : '/' + path}`;
	const headers: Record<string, string> = { Accept: 'application/json' };
	const key = apiKey();
	if (key) headers['x-api-key'] = key;
	const res = await fetch(url, { headers });
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`Scraper ${res.status} ${url}: ${text || res.statusText}`);
	}
	return (await res.json()) as T;
}

// ── Public API (dipakai +page.server / api / warmCache) ────────────────────

export async function remoteSourceList(): Promise<Array<{ id: string; name: string }>> {
	return scraperFetch('/sources');
}

export async function remoteLatest(
	sourceId: string,
	page: number,
	opts: { lang?: string; type?: string; q?: string } = {}
): Promise<Manga[]> {
	// Hybrid: blocked-on-Vercel sources → Worker lokal
	if (isWorkerSource(sourceId)) {
		const adapter = getWorkerSource(sourceId);
		const q = opts.q?.trim();
		const data = q
			? await adapter.searchManga(q, {
					page,
					lang: opts.lang,
					type: opts.type
				})
			: await adapter.getLatestManga(page, {
					lang: opts.lang,
					type: opts.type
				});
		return (Array.isArray(data) ? data : []).map((m) => ({
			...m,
			sourceId: m.sourceId || sourceId
		}));
	}

	const params = new URLSearchParams({
		page: String(page),
		lang: opts.lang || 'all',
		type: opts.type || 'all'
	});
	if (opts.q?.trim()) params.set('q', opts.q.trim());
	return scraperFetch(`/${encodeURIComponent(sourceId)}/latest?${params}`);
}

export async function remoteMangaDetails(
	sourceId: string,
	mangaId: string,
	lang = 'all'
): Promise<MangaDetails> {
	if (isWorkerSource(sourceId)) {
		const adapter = getWorkerSource(sourceId);
		const id = mangaId.startsWith('/') ? mangaId : `/${mangaId.replace(/^\/+/, '')}`;
		return adapter.getMangaDetails(id, { lang });
	}

	const id = mangaId.replace(/^\/+/, '');
	return scraperFetch(
		`/${encodeURIComponent(sourceId)}/manga/${id}?lang=${encodeURIComponent(lang)}`
	);
}

export async function remoteChapterPages(sourceId: string, chapterId: string): Promise<string[]> {
	if (isWorkerSource(sourceId)) {
		const adapter = getWorkerSource(sourceId);
		const id = chapterId.startsWith('/') ? chapterId : `/${chapterId.replace(/^\/+/, '')}`;
		const pages = await adapter.getChapterPages(id);
		return Array.isArray(pages) ? pages : [];
	}

	const id = chapterId.replace(/^\/+/, '');
	return scraperFetch(`/${encodeURIComponent(sourceId)}/chapter/${id}`);
}

/** Helper: cek apakah source ini dijalankan di Worker */
export { isWorkerSource, WORKER_SOURCE_IDS } from '$lib/server/workerSources';
