import { getAllSourceIds } from '$lib/server/sources';
import { remoteLatest } from '$lib/server/scraperClient';
import { parseUpdatedAt, syntheticUpdatedAt } from '$lib/server/parseUpdatedAt';
import type { Manga } from '$lib/server/sources/types';

const SYNC_TTL = 60 * 45;
const PAGES_TO_SYNC = [1];
const LIMIT_PER_SOURCE = 24;
const TIMEOUT_MS = 8000;

const PRIORITY_SOURCES = [
	'hitomi',
	'mangadex',
	'asura',
	'komiku',
	'mangakakalot',
	'flamecomics',
	'weebcentral',
	'asmhentai',
	'ehentai',
	'nhentai',
	// diblokir Vercel → hybrid Worker
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
];

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error('sync_timeout')), ms);
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

async function syncOneSource(
	sourceId: string,
	page: number,
	kv: KVNamespace
): Promise<{ sourceId: string; page: number; ok: boolean; count: number; error?: string }> {
	const cacheKey = `browse:${sourceId}:p${page}:q:lall:tall:lim${LIMIT_PER_SOURCE}`;

	try {
		const result = await withTimeout(
			remoteLatest(sourceId, page, { lang: 'all', type: 'all' }),
			TIMEOUT_MS
		);

		const list = (Array.isArray(result) ? result : [])
			.slice(0, LIMIT_PER_SOURCE)
			.map((m, index) =>
				ensureUpdatedAt({ ...m, sourceId: m.sourceId || sourceId }, page, index)
			);

		await kv.put(cacheKey, JSON.stringify(list), {
			expirationTtl: SYNC_TTL
		});

		return { sourceId, page, ok: true, count: list.length };
	} catch (e: any) {
		return {
			sourceId,
			page,
			ok: false,
			count: 0,
			error: e?.message || String(e)
		};
	}
}

export async function syncPopularSources(kv: KVNamespace) {
	const available = new Set(getAllSourceIds());
	const targets = PRIORITY_SOURCES.filter((id) => available.has(id));

	const results = [];

	for (const sourceId of targets) {
		for (const page of PAGES_TO_SYNC) {
			const res = await syncOneSource(sourceId, page, kv);
			results.push(res);

			await new Promise((r) => setTimeout(r, 300));
		}
	}

	return {
		syncedAt: new Date().toISOString(),
		total: results.length,
		success: results.filter((r) => r.ok).length,
		failed: results.filter((r) => !r.ok).length,
		results
	};
}