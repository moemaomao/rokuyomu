/**
 * Deep Search API
 * - Vercel sources  → live search via scraperClient (remoteLatest + q)
 * - Worker sources  → KV cache ONLY (readCache), never scrape di Worker
 *   agar CPU free tier tidak jebol.
 *
 * Query params:
 *   q        : judul / keyword (wajib, min 2 char)
 *   tags     : comma-separated genre/tag (opsional, digabung ke q)
 *   sources  : comma-separated source ids (opsional; default subset aman)
 *   limit    : max hasil total (default 40, max 80)
 *   per      : max per source (default 6, max 12)
 *
 * PENTING: file ini harus bernama +server.ts di folder
 * frontend/src/routes/api/deep-search/
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Manga } from '$lib/server/sources/types';
import { getSourceList } from '$lib/server/sources';
import { remoteLatest, isWorkerSource } from '$lib/server/scraperClient';
import { readCache } from '$lib/server/cache';

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 80;
const DEFAULT_PER = 6;
const MAX_PER = 12;
const CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 4000;

const DEFAULT_VERCEL_SOURCES = [
	'asura',
	'mangadex',
	'mangafire',
	'mangakakalot',
	'flamecomics',
	'westmanga',
	'nhentai',
	'hitomi',
	'mangabats',
	'komiku',
	'madarascans',
	'omegascans',
	'soulscans',
	'vortexscans',
	'gdscans',
	'ksgroupscans',
	'mangataro',
	'mangasushi',
	'mangaread'
];

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error('timeout')), ms);
		promise
			.then((v) => {
				clearTimeout(t);
				resolve(v);
			})
			.catch((e) => {
				clearTimeout(t);
				reject(e);
			});
	});
}

function browseCacheKey(
	sourceId: string,
	page: number,
	q: string,
	lang: string,
	type: string,
	limit: number
): string {
	return `browse:${sourceId}:p${page}:q${q}:l${lang}:t${type}:lim${limit}`;
}

async function searchOneSource(
	sourceId: string,
	query: string,
	per: number,
	kv: KVNamespace | null | undefined
): Promise<Manga[]> {
	const q = query.trim();
	const lang = 'all';
	const type = 'all';

	// Worker source: KV only — JANGAN scrape
	if (isWorkerSource(sourceId)) {
		if (!kv) return [];

		const candidateKeys = [
			browseCacheKey(sourceId, 1, q, lang, type, per),
			browseCacheKey(sourceId, 1, q, lang, type, 6),
			browseCacheKey(sourceId, 1, q, lang, type, 24),
			browseCacheKey(sourceId, 1, q, lang, type, Math.ceil(24 / 4))
		];

		for (const key of candidateKeys) {
			const cached = await readCache<Manga[]>(key, kv);
			if (Array.isArray(cached) && cached.length > 0) {
				return cached.slice(0, per).map((m) => ({
					...m,
					sourceId: m.sourceId || sourceId
				}));
			}
		}
		return [];
	}

	// Vercel / remote scraper
	try {
		const result = await withTimeout(
			remoteLatest(sourceId, 1, { q, lang, type }),
			FETCH_TIMEOUT_MS
		);
		const list = Array.isArray(result) ? result : [];
		return list.slice(0, per).map((m) => ({
			...m,
			sourceId: m.sourceId || sourceId
		}));
	} catch (e) {
		console.warn(`[deep-search] ${sourceId}:`, e instanceof Error ? e.message : e);
		return [];
	}
}

export const GET: RequestHandler = async ({ url, locals, platform }) => {
	const qRaw = (url.searchParams.get('q') || '').trim();
	const tagsRaw = (url.searchParams.get('tags') || '').trim();
	const sourcesParam = (url.searchParams.get('sources') || '').trim();
	const limit = Math.min(
		MAX_LIMIT,
		Math.max(1, parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
	);
	const per = Math.min(
		MAX_PER,
		Math.max(1, parseInt(url.searchParams.get('per') || String(DEFAULT_PER), 10) || DEFAULT_PER)
	);

	if (qRaw.length < 2 && !tagsRaw) {
		return json({ results: [], meta: { error: 'q or tags required (min 2 chars)' } }, { status: 400 });
	}

	const tagParts = tagsRaw
		? tagsRaw
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean)
		: [];
	const query = [qRaw, ...tagParts].filter(Boolean).join(' ').trim();

	const allIds = new Set(getSourceList().map((s) => s.id));
	let sourceIds: string[];

	if (sourcesParam) {
		sourceIds = sourcesParam
			.split(',')
			.map((s) => s.trim())
			.filter((id) => allIds.has(id));
	} else {
		const workerIds = [...allIds].filter((id) => isWorkerSource(id));
		const vercelPreferred = DEFAULT_VERCEL_SOURCES.filter((id) => allIds.has(id));
		sourceIds = [...new Set([...vercelPreferred, ...workerIds.slice(0, 12)])];
	}

	if (sourceIds.length === 0) {
		return json({ results: [], meta: { query, sources: 0 } });
	}

	const kv =
		(locals as { kv?: KVNamespace | null })?.kv ??
		(platform?.env as { MIKOROKU_CACHE?: KVNamespace } | undefined)?.MIKOROKU_CACHE ??
		null;

	const lists: Manga[][] = [];
	for (let i = 0; i < sourceIds.length; i += CONCURRENCY) {
		const batch = sourceIds.slice(i, i + CONCURRENCY);
		const batchResults = await Promise.all(
			batch.map((id) => searchOneSource(id, query, per, kv))
		);
		lists.push(...batchResults);
	}

	const seen = new Set<string>();
	const results: Manga[] = [];
	for (const list of lists) {
		for (const m of list) {
			const key = `${m.sourceId ?? ''}:${m.id}`;
			if (seen.has(key)) continue;
			seen.add(key);
			results.push(m);
			if (results.length >= limit) break;
		}
		if (results.length >= limit) break;
	}

	return json(
		{
			results,
			meta: {
				query,
				tags: tagParts,
				sourcesTried: sourceIds.length,
				returned: results.length,
				workerKvOnly: true
			}
		},
		{
			headers: {
				'Cache-Control': 'private, max-age=30'
			}
		}
	);
};
