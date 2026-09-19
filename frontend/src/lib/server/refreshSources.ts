import { getAllSourceIds } from '$lib/server/sources';
import { remoteLatest } from '$lib/server/scraperClient';
import { parseUpdatedAt, syntheticUpdatedAt } from '$lib/server/parseUpdatedAt';
import type { Manga } from '$lib/server/sources/types';

export const BROWSE_LIMIT = 24;
export const LIST_CACHE_TTL = 60 * 45; // 45 min

const TIMEOUT_MS = 8000;
const DELAY_MS = 300;
const PAGES = [1] as const;

const POPULAR_SOURCES = [
	// Tier A – high traffic
	'hitomi',
	'mangadex',
	'asura',
	'komiku',
	'mangakakalot',
	'nhentai',
	'asmhentai',
	'westmanga',
	'madarascans',
	'hentaiera',
	'imhentai',
	// Tier B – Worker-local / hybrid
	'flamecomics',
	'weebcentral',
	'klz9',
	'rawkuma',
	'athreascans',
	'hentairead',
	'kingcomix',
	'manhuarmtl',
	'onemanga',
	'simplyhentai',
	'ainzscans',
	'bacakomik',
	'bacami',
	'crotpedia',
	'doujinku',
	'holodek',
	'ikiru',
	'kiryuu',
	'komikindo',
	'komikstation',
	'lumos',
	'luvyaa',
	'manhwadesu',
	'manhwaindo',
	'ngomik',
	'pixhentai',
	'sasangeyou',
	'siikomik'
] as const;

export type RefreshResult = {
	sourceId: string;
	page: number;
	ok: boolean;
	count: number;
	skipped?: boolean;
	error?: string;
};

export type RefreshOptions = {
	force?: boolean;
};

export function browseListCacheKey(
	sourceId: string,
	page = 1,
	limit = BROWSE_LIMIT
): string {
	return `browse:${sourceId}:p${page}:q:lall:tall:lim${limit}`;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error('refresh_timeout')), ms);
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

async function fetchList(sourceId: string, page: number): Promise<Manga[]> {
	const result = await withTimeout(
		remoteLatest(sourceId, page, { lang: 'all', type: 'all' }),
		TIMEOUT_MS
	);
	return (Array.isArray(result) ? result : [])
		.slice(0, BROWSE_LIMIT)
		.map((m, index) =>
			ensureUpdatedAt({ ...m, sourceId: m.sourceId || sourceId }, page, index)
		);
}

async function refreshOneForce(
	sourceId: string,
	page: number,
	kv: KVNamespace
): Promise<RefreshResult> {
	const cacheKey = browseListCacheKey(sourceId, page);

	try {
		const list = await fetchList(sourceId, page);
		await kv.put(cacheKey, JSON.stringify(list), {
			expirationTtl: LIST_CACHE_TTL
		});
		return { sourceId, page, ok: true, count: list.length };
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : String(e);
		console.error(`[Refresh] ${sourceId} p${page} failed:`, message);
		return { sourceId, page, ok: false, count: 0, error: message };
	}
}

async function refreshOneCacheAside(
	sourceId: string,
	page: number,
	kv: KVNamespace
): Promise<RefreshResult> {
	const cacheKey = browseListCacheKey(sourceId, page);

	try {
		const existing = await kv.get(cacheKey, 'json');
		if (existing !== null) {
			const count = Array.isArray(existing) ? existing.length : 0;
			return { sourceId, page, ok: true, count, skipped: true };
		}

		const list = await fetchList(sourceId, page);
		await kv.put(cacheKey, JSON.stringify(list), {
			expirationTtl: LIST_CACHE_TTL
		});
		return { sourceId, page, ok: true, count: list.length, skipped: false };
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : String(e);
		console.error(`[Refresh] ${sourceId} p${page} failed:`, message);
		return { sourceId, page, ok: false, count: 0, error: message };
	}
}

/**
 * Refresh popular browse caches.
 * @param force
 */
export async function refreshPopularSources(
	kv: KVNamespace,
	options: RefreshOptions = {}
) {
	const force = options.force !== false;
	const available = new Set(getAllSourceIds());
	const targets = POPULAR_SOURCES.filter((id) => available.has(id));

	console.log(
		`[Refresh] start force=${force} targets=${targets.length}/${POPULAR_SOURCES.length}`
	);

	const results: RefreshResult[] = [];

	for (const sourceId of targets) {
		for (const page of PAGES) {
			const res = force
				? await refreshOneForce(sourceId, page, kv)
				: await refreshOneCacheAside(sourceId, page, kv);
			results.push(res);
			await new Promise((r) => setTimeout(r, DELAY_MS));
		}
	}

	const success = results.filter((r) => r.ok).length;
	const skipped = results.filter((r) => r.skipped).length;
	const failed = results.filter((r) => !r.ok).length;

	console.log(
		`[Refresh] done success=${success} skipped=${skipped} failed=${failed}`
	);

	return {
		syncedAt: new Date().toISOString(),
		force,
		total: results.length,
		success,
		skipped,
		failed,
		results
	};
}

export function getPopularSourceIds(): string[] {
	return [...POPULAR_SOURCES];
}