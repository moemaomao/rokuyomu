/**
 * Deep Search API
 * - Vercel sources  → live search via scraperClient (remoteLatest + q)
 * - Worker sources  → KV cache ONLY (readCache), never scrape di Worker
 *
 * Query params:
 *   q        : judul / keyword (min 2 char, atau tags)
 *   tags     : comma-separated genre/tag
 *   sources  : comma-separated source ids (opsional)
 *   limit    : max hasil total (default 48, max 100)
 *   per      : max per source (default 8, max 16)
 *   type     : all | manga | novel (opsional)
 *
 * Path: frontend/src/routes/api/deep-search/+server.ts
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Manga } from '$lib/server/sources/types';
import { getSourceList } from '$lib/server/sources';
import { remoteLatest, isWorkerSource } from '$lib/server/scraperClient';
import { readCache } from '$lib/server/cache';
import { NOVEL_SOURCE_IDS, isNovelSource } from '$lib/utils/novelSources';

const DEFAULT_LIMIT = 48;
const MAX_LIMIT = 100;
const DEFAULT_PER = 8;
const MAX_PER = 16;
const CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 6000;

const DEFAULT_MANGA_SOURCES = [
	'asura',
	'mangadex',
	'mangafire',
	'mangakakalot',
	'flamecomics',
	'westmanga',
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
	'mangaread',
	'komikindo',
	'bacakomik',
	'shinigami'
];

const DEFAULT_NOVEL_SOURCES = [
	'sakuranovel',
	'wetriedtls',
	'dobytranslations',
	'mochistar',
	'raysvault',
	'harishtranslation',
	'nomadtranslations',
	'kaystls',
	'tinytranslation',
	'foxaholic',
	'skydemonorder',
	'storyseedling',
	'novelspyramid',
	'novelshaven',
	'marinetl',
	'rubynovels',
	'lazygirltranslations',
	'redpandatranslations',
	'skynovelvault',
	'fenrirealm',
	'meionovel',
	'noveltoon',
	'bacalightnovel'
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

function scoreTitle(title: string, query: string): number {
	const t = (title || '').toLowerCase().trim();
	const q = (query || '').toLowerCase().trim();
	if (!t || !q) return 0;

	if (t === q) return 1000;
	if (t.startsWith(q)) return 800;
	if (t.includes(q)) return 600;

	const qTokens = q.split(/[\s\-_:·,]+/).filter((x) => x.length > 1);
	if (!qTokens.length) return 0;

	let hit = 0;
	let ordered = 0;
	let lastIdx = -1;
	for (const tok of qTokens) {
		const idx = t.indexOf(tok);
		if (idx >= 0) {
			hit++;
			if (idx >= lastIdx) {
				ordered++;
				lastIdx = idx;
			}
		}
	}
	const ratio = hit / qTokens.length;
	return Math.round(ratio * 400 + ordered * 20);
}

async function searchOneSource(
	sourceId: string,
	query: string,
	per: number,
	kv: KVNamespace | null | undefined
): Promise<Manga[]> {
	const q = query.trim();
	const lang = 'all';
	const type = isNovelSource(sourceId) ? 'novel' : 'all';

	if (isWorkerSource(sourceId)) {
		if (!kv) return [];

		const candidateKeys = [
			browseCacheKey(sourceId, 1, q, lang, type, per),
			browseCacheKey(sourceId, 1, q, lang, type, 6),
			browseCacheKey(sourceId, 1, q, lang, type, 8),
			browseCacheKey(sourceId, 1, q, lang, type, 24),
			browseCacheKey(sourceId, 1, q, 'all', 'all', per),
			browseCacheKey(sourceId, 1, q, 'all', 'all', 24)
		];

		for (const key of candidateKeys) {
			const cached = await readCache<Manga[]>(key, kv);
			if (Array.isArray(cached) && cached.length > 0) {
				return cached.slice(0, per).map((m) => ({
					...m,
					sourceId: m.sourceId || sourceId,
					type: m.type || (isNovelSource(sourceId) ? 'novel' : m.type)
				}));
			}
		}
		return [];
	}

	try {
		const result = await withTimeout(
			remoteLatest(sourceId, 1, { q, lang, type }),
			FETCH_TIMEOUT_MS
		);
		const list = Array.isArray(result) ? result : [];
		return list.slice(0, per).map((m) => ({
			...m,
			sourceId: m.sourceId || sourceId,
			type: m.type || (isNovelSource(sourceId) ? 'novel' : m.type || 'manga')
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
	const typeFilter = (url.searchParams.get('type') || 'all').toLowerCase(); // all|manga|novel
	const limit = Math.min(
		MAX_LIMIT,
		Math.max(1, parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
	);
	const per = Math.min(
		MAX_PER,
		Math.max(1, parseInt(url.searchParams.get('per') || String(DEFAULT_PER), 10) || DEFAULT_PER)
	);

	if (qRaw.length < 2 && !tagsRaw) {
		return json(
			{ results: [], meta: { error: 'q or tags required (min 2 chars)' } },
			{ status: 400 }
		);
	}

	const tagParts = tagsRaw
		? tagsRaw
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean)
		: [];
	const query = [qRaw, ...tagParts].filter(Boolean).join(' ').trim();

	const allIds = new Set(getSourceList().map((s) => s.id));
	for (const id of NOVEL_SOURCE_IDS) allIds.add(id);

	let sourceIds: string[];

	if (sourcesParam) {
		sourceIds = sourcesParam
			.split(',')
			.map((s) => s.trim())
			.filter((id) => allIds.has(id));
	} else {
		const mangaPreferred = DEFAULT_MANGA_SOURCES.filter((id) => allIds.has(id));
		const novelPreferred = DEFAULT_NOVEL_SOURCES.filter((id) => allIds.has(id));
		const workerIds = [...allIds].filter((id) => isWorkerSource(id));

		if (typeFilter === 'novel') {
			sourceIds = [...new Set([...novelPreferred, ...workerIds.filter((id) => isNovelSource(id))])];
		} else if (typeFilter === 'manga') {
			sourceIds = [...new Set([...mangaPreferred, ...workerIds.filter((id) => !isNovelSource(id)).slice(0, 10)])];
		} else {
			sourceIds = [
				...new Set([
					...novelPreferred.slice(0, 16),
					...mangaPreferred.slice(0, 16),
					...workerIds.slice(0, 10)
				])
			];
		}
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
	const scored: Array<Manga & { _score: number }> = [];

	for (const list of lists) {
		for (const m of list) {
			const key = `${m.sourceId ?? ''}:${m.id}`;
			if (seen.has(key)) continue;
			seen.add(key);

			const kind = (m.type || (isNovelSource(m.sourceId) ? 'novel' : 'manga')).toLowerCase();
			if (typeFilter === 'novel' && kind !== 'novel') continue;
			if (typeFilter === 'manga' && kind === 'novel') continue;

			const score = scoreTitle(m.title || '', qRaw || query);
			if (qRaw.length >= 2 && score < 40) continue;

			scored.push({
				...m,
				type: kind === 'novel' ? 'novel' : m.type || 'manga',
				_score: score
			});
		}
	}

	scored.sort((a, b) => b._score - a._score || (a.title || '').localeCompare(b.title || ''));

	const results: Manga[] = scored.slice(0, limit).map(({ _score, ...m }) => m);

	return json(
		{
			results,
			meta: {
				query,
				tags: tagParts,
				type: typeFilter,
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
