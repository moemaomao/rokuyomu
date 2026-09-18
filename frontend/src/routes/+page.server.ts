import { getSourceList } from '$lib/server/sources';
import { remoteLatest } from '$lib/server/scraperClient';
import { parsePreferredFromCookie } from '$lib/stores/preferredSources';
import { parseUpdatedAt, syntheticUpdatedAt } from '$lib/server/parseUpdatedAt';
import { getCached } from '$lib/server/cache';
import type { PageServerLoad } from './$types';
import type { Manga } from '$lib/server/sources/types';

const LOAD_TIMEOUT_MS = 4500;
const MAX_MANGAS = 24;
const MAX_PREFERRED = 4;
const CONCURRENCY = 2;

const LIST_CACHE_TTL = 60 * 30;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error('load_timeout')), ms);
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

function ensureUpdatedAt(m: Manga, page: number, index: number): Manga {
	const fromField = parseUpdatedAt(m.updatedAt);
	if (fromField > 0) return { ...m, updatedAt: fromField };

	const any = m as Manga & { date?: string; updated?: string; upload_date?: number };
	const fromAlt =
		parseUpdatedAt(any.date) ||
		parseUpdatedAt(any.updated) ||
		parseUpdatedAt(any.upload_date);

	if (fromAlt > 0) return { ...m, updatedAt: fromAlt };

	return { ...m, updatedAt: syntheticUpdatedAt(page, index) };
}

function mergeByTime(lists: Manga[][], preferredOrder: string[]): Manga[] {
	const orderMap = new Map(preferredOrder.map((id, i) => [id, i]));

	const flat = lists.flat();
	flat.sort((a, b) => {
		const ta = a.updatedAt || 0;
		const tb = b.updatedAt || 0;
		if (tb !== ta) return tb - ta;
		const oa = orderMap.get(a.sourceId) ?? 999;
		const ob = orderMap.get(b.sourceId) ?? 999;
		return oa - ob;
	});
	return flat;
}

async function fetchSourceList(
	id: string,
	pageNum: number,
	query: string,
	lang: string,
	type: string,
	kv?: KVNamespace | null,
	limit: number = 6
): Promise<Manga[]> {
	const q = (query || '').trim();
	const l = (lang || 'all').toLowerCase();
	const t = (type || 'all').toLowerCase();

	const cacheKey = `browse:${id}:p${pageNum}:q${q}:l${l}:t${t}:lim${limit}`;

	try {
		return await getCached(
			cacheKey,
			async () => {
				const result = await withTimeout(
					remoteLatest(id, pageNum, { lang: l, type: t, q }),
					LOAD_TIMEOUT_MS
				);
				const list = Array.isArray(result) ? result : [];
				return list.slice(0, limit).map((m, index) =>
					ensureUpdatedAt({ ...m, sourceId: m.sourceId || id }, pageNum, index)
				);
			},
			LIST_CACHE_TTL,
			kv
		);
	} catch (e) {
		console.error(`[Browse] ${id} failed:`, e);
		return [];
	}
}

export const load: PageServerLoad = async ({ url, request, setHeaders, depends, locals }) => {
	const sourceParam = url.searchParams.get('source');
	const pageNum = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
	const query = (url.searchParams.get('q') || '').trim();
	const lang = (url.searchParams.get('lang') || 'all').toLowerCase();
	const type = (url.searchParams.get('type') || 'all').toLowerCase();

	const sources = getSourceList();
	let mangas: Manga[] = [];
	let currentSource: string | null = sourceParam;
	let isMulti = false;
	let preferredSources: string[] = [];

	// ── Multi mode ───────────────────────────────────────────────────────────
if (!sourceParam) {
	preferredSources = parsePreferredFromCookie(request.headers.get('cookie'));
	const validIds = new Set(sources.map((s) => s.id));
	preferredSources = preferredSources
		.filter((id) => validIds.has(id))
		.slice(0, MAX_PREFERRED);

	isMulti = true;
	depends('browse:multi');

	if (preferredSources.length === 0) {
		mangas = [];
	} else {

		const perSourceLimit = Math.ceil(MAX_MANGAS / preferredSources.length);

		const sortedSources = [...preferredSources].sort().join(',');
		const cacheKey = `browse:multi:${sortedSources}:p${pageNum}:q${query}:l${lang}:t${type}:ps${perSourceLimit}`;

		mangas = await getCached(
			cacheKey,
			async () => {
				const lists: Manga[][] = [];
				const conc = pageNum <= 1 ? CONCURRENCY : 1;

				for (let i = 0; i < preferredSources.length; i += conc) {
					const batch = preferredSources.slice(i, i + conc);
					const batchResults = await Promise.all(
						batch.map((id) =>
							fetchSourceList(id, pageNum, query, lang, type, locals.kv, perSourceLimit)
						)
					);
					lists.push(...batchResults);
				}

				return mergeByTime(lists, preferredSources).slice(0, MAX_MANGAS);
			},
			LIST_CACHE_TTL,
			locals.kv
		);
	}
}
	// ── Single source mode ───────────────────────────────────────────────────
else {
	depends(`browse:${sourceParam}`);
	try {
		const q = (query || '').trim();
		const l = (lang || 'all').toLowerCase();
		const t = (type || 'all').toLowerCase();

		const cacheKey = `browse:${sourceParam}:p${pageNum}:q${q}:l${l}:t${t}:lim${MAX_MANGAS}`;

		mangas = await getCached(
			cacheKey,
			async () => {
				const result = await withTimeout(
					remoteLatest(sourceParam, pageNum, { lang: l, type: t, q }),
					LOAD_TIMEOUT_MS
				);
				const list = Array.isArray(result) ? result : [];

				return list.slice(0, MAX_MANGAS).map((m, index) =>
					ensureUpdatedAt(
						{ ...m, sourceId: m.sourceId || sourceParam },
						pageNum,
						index
					)
				);
			},
			LIST_CACHE_TTL,
			locals.kv
		);
	} catch (e) {
		console.error('[Browse] load failed:', e);
		mangas = [];
	}
}


if (isMulti) {
  setHeaders({
    'Cache-Control': 'private, no-store'
  });
} else {
  setHeaders({
    'Cache-Control': 'public, s-maxage=180, stale-while-revalidate=900'
  });
}

return {
  mangas,
  sources,
  currentSource,
  currentPage: pageNum,
  searchQuery: query,
  selectedLang: lang,
  selectedType: type,
  needsSource: false,
  isMulti,
  preferredSources
 };
};