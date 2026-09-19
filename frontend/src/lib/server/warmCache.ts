import { remoteLatest } from '$lib/server/scraperClient';
import { getCached } from '$lib/server/cache';
import type { Manga } from '$lib/server/sources/types';

const WARM_SOURCES = [
	'asura',
	'madarascans',
	'komiku',
	'westmanga',
	'mangadex',
	'nhentai',
    'hentaiera',
    'hitomi',
    'imhentai',
    'asmhentai',
	// diblokir Vercel → hybrid Worker
	'klz9',
	'rawkuma',
	'athreascans',
	'flamecomics',
	'hentairead',
	'kingcomix',
	'manhuarmtl',
	'onemanga',
	'simplyhentai',
	'weebcentral',
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

const LIST_CACHE_TTL = 60 * 45;
const PER_SOURCE_LIMIT = 12;


async function warmOneSource(
	sourceId: string,
	kv: KVNamespace
): Promise<{ id: string; ok: boolean; count: number }> {
	const cacheKey = `browse:${sourceId}:p1:q:lall:tall:lim${PER_SOURCE_LIMIT}`;

	try {
		const data = await getCached(
			cacheKey,
			async () => {
				const result = await remoteLatest(sourceId, 1, { lang: 'all', type: 'all' });
				const list = Array.isArray(result) ? result : [];
				return list.slice(0, PER_SOURCE_LIMIT).map((m: Manga, index: number) => ({
					...m,
					sourceId: m.sourceId || sourceId,
					updatedAt: m.updatedAt || Date.now() - index * 1000
				}));
			},
			LIST_CACHE_TTL,
			kv
		);

		return { id: sourceId, ok: true, count: data.length };
	} catch (err) {
		console.error(`[Warm] ${sourceId} failed:`, err);
		return { id: sourceId, ok: false, count: 0 }; 
	}
}

export async function warmPopularSources(kv: KVNamespace) {
	console.log('[Warm] Starting cache warm...');

	const results = [];

	for (const id of WARM_SOURCES) {
		const result = await warmOneSource(id, kv);
		results.push(result);

		await new Promise((r) => setTimeout(r, 300));
	}

	const success = results.filter((r) => r.ok).length;
	console.log(`[Warm] Done. ${success}/${WARM_SOURCES.length} sources warmed`);

	return results;
}