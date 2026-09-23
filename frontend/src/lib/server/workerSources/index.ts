/**
 * Worker-local sources — HANYA source yang diblokir outbound IP Vercel.
 *
 * Lazy load: module adapter hanya di-import saat source tersebut benar-benar dipakai.
 * Ini menjaga CPU free tier CF Workers (< ~10ms) karena tidak load semua Cheerio adapter di cold start.
 *
 * Alur:
 *   UI → CF Worker → (worker source?) → dynamic import + parse lokal (Cheerio)
 *                  → (else)           → fetch JSON ke scraper Vercel/Render
 *
 * Cara menambah source yang diblokir Vercel:
 * 1. Copy file adapter dari scraper/src/sources/impl/Xxx.ts
 *    ke frontend/src/lib/server/workerSources/impl/Xxx.ts
 * 2. Ubah import path: '../BaseSource' & '../types' (sudah relatif sama)
 * 3. Tambah id ke WORKER_SOURCE_IDS + entry di loaders di bawah
 * 4. Pastikan `cheerio` ada di frontend/package.json dependencies
 *
 * Jangan daftar SEMUA source di sini — target hanya yang benar-benar butuh IP Cloudflare.
 */

import type { IMangaSource } from './types';

export const WORKER_SOURCE_IDS = new Set([
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
	'siikomik',
	'sakuranovel'
]);

const instanceCache = new Map<string, IMangaSource>();

const loaders: Record<string, () => Promise<IMangaSource>> = {
	sakuranovel: async () => new (await import('./impl/Sakuranovel')).SakuranovelSource(),
	klz9: async () => new (await import('./impl/Klz9')).Klz9Source(),
	rawkuma: async () => new (await import('./impl/Rawkuma')).RawkumaSource(),
	athreascans: async () => new (await import('./impl/AthreaScans')).AthreaScansSource(),
	flamecomics: async () => new (await import('./impl/FlameComics')).FlameComicsSource(),
	hentairead: async () => new (await import('./impl/Hentairead')).HentaireadSource(),
	kingcomix: async () => new (await import('./impl/Kingkomix')).KingcomixSource(),
	manhuarmtl: async () => new (await import('./impl/Manhuarmtl')).ManhuarmtlSource(),
	onemanga: async () => new (await import('./impl/OneManga')).OneMangaSource(),
	simplyhentai: async () => new (await import('./impl/Simplyhentai')).SimplyHentaiSource(),
	weebcentral: async () => new (await import('./impl/WeebCentral')).WeebCentralSource(),
	ainzscans: async () => new (await import('./impl/AinzScans')).AinzScansSource(),
	bacakomik: async () => new (await import('./impl/Bacakomik')).BacaKomikSource(),
	bacami: async () => new (await import('./impl/Bacami')).BacamiSource(),
	crotpedia: async () => new (await import('./impl/Crotpedia')).CrotpediaSource(),
	doujinku: async () => new (await import('./impl/Doujinku')).DoujinkuSource(),
	holodek: async () => new (await import('./impl/Holodek')).HolodekSource(),
	ikiru: async () => new (await import('./impl/Ikiru')).IkiruSource(),
	kiryuu: async () => new (await import('./impl/Kiryuu')).KiryuuSource(),
	komikindo: async () => new (await import('./impl/Komikindo')).KomikindoSource(),
	komikstation: async () => new (await import('./impl/KomikStation')).KomikStationSource(),
	lumos: async () => new (await import('./impl/Lumos')).LumosSource(),
	luvyaa: async () => new (await import('./impl/Luvyaa')).LuvyaaSource(),
	manhwadesu: async () => new (await import('./impl/ManhwaDesu')).ManhwaDesuSource(),
	manhwaindo: async () => new (await import('./impl/ManhwaIndo')).ManhwaIndoSource(),
	ngomik: async () => new (await import('./impl/Ngomik')).NgomikSource(),
	pixhentai: async () => new (await import('./impl/PixHentai')).PixHentaiSource(),
	sasangeyou: async () => new (await import('./impl/Sasangeyou')).SasangeyouSource(),
	siikomik: async () => new (await import('./impl/Siikomik')).SiikomikSource()
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