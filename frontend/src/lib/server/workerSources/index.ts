/**
 * Worker-local sources — HANYA source yang diblokir outbound IP Vercel.
 *
 * File ini DIGENERATE otomatis oleh scripts/sync-worker-sources.mjs
 * Jangan edit manual. Edit daftar ID di scripts/worker-sources.json lalu jalankan:
 *
 *   pnpm sync-worker-sources
 *
 * Lazy load: module adapter hanya di-import saat source tersebut benar-benar dipakai.
 * Ini menjaga CPU free tier CF Workers (< ~10ms) karena tidak load semua Cheerio adapter di cold start.
 *
 * Alur:
 *   UI → CF Worker → (worker source?) → dynamic import + parse lokal (Cheerio)
 *                  → (else)           → fetch JSON ke scraper Vercel/Render
 */

import type { IMangaSource } from './types';

export const WORKER_SOURCE_IDS = new Set([
	'ainzscans',
	'athreascans',
	'bacakomik',
	'bacami',
	'crotpedia',
	'doujinku',
	'flamecomics',
	'hentairead',
	'holodek',
	'ikiru',
	'kingcomix',
	'kiryuu',
	'klz9',
	'komikindo',
	'komikstation',
	'lumos',
	'luvyaa',
	'manhuarmtl',
	'manhwadesu',
	'manhwaindo',
	'meionovel',
	'ngomik',
	'noveltoon',
	'onemanga',
	'pixhentai',
	'rawkuma',
	'sakuranovel',
	'sasangeyou',
	'setsuscans',
	'siikomik',
	'silentquill',
	'simplyhentai',
	'weebcentral'
]);

const instanceCache = new Map<string, IMangaSource>();

const loaders: Record<string, () => Promise<IMangaSource>> = {
	ainzscans: async () => new (await import('./impl/AinzScans')).AinzScansSource(),
	athreascans: async () => new (await import('./impl/AthreaScans')).AthreaScansSource(),
	bacakomik: async () => new (await import('./impl/Bacakomik')).BacaKomikSource(),
	bacami: async () => new (await import('./impl/Bacami')).BacamiSource(),
	crotpedia: async () => new (await import('./impl/Crotpedia')).CrotpediaSource(),
	doujinku: async () => new (await import('./impl/Doujinku')).DoujinkuSource(),
	flamecomics: async () => new (await import('./impl/FlameComics')).FlameComicsSource(),
	hentairead: async () => new (await import('./impl/Hentairead')).HentaireadSource(),
	holodek: async () => new (await import('./impl/Holodek')).HolodekSource(),
	ikiru: async () => new (await import('./impl/Ikiru')).IkiruSource(),
	kingcomix: async () => new (await import('./impl/Kingkomix')).KingcomixSource(),
	kiryuu: async () => new (await import('./impl/Kiryuu')).KiryuuSource(),
	klz9: async () => new (await import('./impl/Klz9')).Klz9Source(),
	komikindo: async () => new (await import('./impl/Komikindo')).KomikindoSource(),
	komikstation: async () => new (await import('./impl/KomikStation')).KomikStationSource(),
	lumos: async () => new (await import('./impl/Lumos')).LumosSource(),
	luvyaa: async () => new (await import('./impl/Luvyaa')).LuvyaaSource(),
	manhuarmtl: async () => new (await import('./impl/Manhuarmtl')).ManhuarmtlSource(),
	manhwadesu: async () => new (await import('./impl/ManhwaDesu')).ManhwaDesuSource(),
	manhwaindo: async () => new (await import('./impl/ManhwaIndo')).ManhwaIndoSource(),
	meionovel: async () => new (await import('./impl/Meionovel')).MeionovelSource(),
	ngomik: async () => new (await import('./impl/Ngomik')).NgomikSource(),
	noveltoon: async () => new (await import('./impl/Noveltoon')).Noveltoon(),
	onemanga: async () => new (await import('./impl/OneManga')).OneMangaSource(),
	pixhentai: async () => new (await import('./impl/PixHentai')).PixHentaiSource(),
	rawkuma: async () => new (await import('./impl/Rawkuma')).RawkumaSource(),
	sakuranovel: async () => new (await import('./impl/Sakuranovel')).SakuranovelSource(),
	sasangeyou: async () => new (await import('./impl/Sasangeyou')).SasangeyouSource(),
	setsuscans: async () => new (await import('./impl/SetsuScans')).SetsuScansSource(),
	siikomik: async () => new (await import('./impl/Siikomik')).SiikomikSource(),
	silentquill: async () => new (await import('./impl/SilentQuill')).SilentQuillSource(),
	simplyhentai: async () => new (await import('./impl/Simplyhentai')).SimplyHentaiSource(),
	weebcentral: async () => new (await import('./impl/WeebCentral')).WeebCentralSource(),
};

export function isWorkerSource(sourceId: string): boolean {
	return WORKER_SOURCE_IDS.has(sourceId);
}

export async function getWorkerSource(sourceId: string): Promise<IMangaSource> {
	const cached = instanceCache.get(sourceId);
	if (cached) return cached;

	const loader = loaders[sourceId];
	if (!loader) {
		throw new Error(`Worker source "${sourceId}" not registered`);
	}

	const src = await loader();
	instanceCache.set(sourceId, src);
	return src;
}
