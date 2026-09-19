/**
 * Worker-local sources — HANYA source yang diblokir outbound IP Vercel.
 *
 * Alur:
 *   UI → CF Worker → (worker source?) → parse lokal dengan Cheerio
 *                  → (else)           → fetch JSON ke scraper Vercel/Render
 *
 * Cara menambah source yang diblokir Vercel:
 * 1. Copy file adapter dari scraper/src/sources/impl/Xxx.ts
 *    ke frontend/src/lib/server/workerSources/impl/Xxx.ts
 * 2. Ubah import path: '../BaseSource' & '../types' (sudah relatif sama)
 * 3. Import + register di bawah
 * 4. Pastikan `cheerio` ada di frontend/package.json dependencies
 *
 * Jangan daftar SEMUA source di sini — CPU free tier CF < 10ms per request.
 * Target: maksimal ~5–15 source yang benar-benar butuh IP Cloudflare.
 */

/**
 * Worker-local sources — source yang diblokir outbound IP Vercel.
 */
import type { IMangaSource } from './types';

import { Klz9Source } from './impl/Klz9';
import { RawkumaSource } from './impl/Rawkuma';
import { AthreaScansSource } from './impl/AthreaScans';
import { FlameComicsSource } from './impl/FlameComics';
import { HentaireadSource } from './impl/Hentairead';
import { KingcomixSource } from './impl/Kingkomix';
import { ManhuarmtlSource } from './impl/Manhuarmtl';
import { OneMangaSource } from './impl/OneManga';
import { SimplyHentaiSource } from './impl/Simplyhentai';
import { WeebCentralSource } from './impl/WeebCentral';
import { AinzScansSource } from './impl/AinzScans';
import { BacaKomikSource } from './impl/Bacakomik';
import { BacamiSource } from './impl/Bacami';
import { CrotpediaSource } from './impl/Crotpedia';
import { DoujinkuSource } from './impl/Doujinku';
import { HolodekSource } from './impl/Holodek';
import { IkiruSource } from './impl/Ikiru';
import { KiryuuSource } from './impl/Kiryuu';
import { KomikindoSource } from './impl/Komikindo';
import { KomikStationSource } from './impl/KomikStation';
import { LumosSource } from './impl/Lumos';
import { LuvyaaSource } from './impl/Luvyaa';
import { ManhwaDesuSource } from './impl/ManhwaDesu';
import { ManhwaIndoSource } from './impl/ManhwaIndo';
import { NgomikSource } from './impl/Ngomik';
import { PixHentaiSource } from './impl/PixHentai';
import { SasangeyouSource } from './impl/Sasangeyou';
import { SiikomikSource } from './impl/Siikomik';
import { LectorTmoSource } from './impl/LectorTmo';

const workerSources: Record<string, IMangaSource> = {
	klz9: new Klz9Source(),
	lectortmo: new LectorTmoSource(),
	rawkuma: new RawkumaSource(),
	athreascans: new AthreaScansSource(),
	flamecomics: new FlameComicsSource(),
	hentairead: new HentaireadSource(),
	kingcomix: new KingcomixSource(),
	manhuarmtl: new ManhuarmtlSource(),
	onemanga: new OneMangaSource(),
	simplyhentai: new SimplyHentaiSource(),
	weebcentral: new WeebCentralSource(),
	ainzscans: new AinzScansSource(),
	bacakomik: new BacaKomikSource(),
	bacami: new BacamiSource(),
	crotpedia: new CrotpediaSource(),
	doujinku: new DoujinkuSource(),
	holodek: new HolodekSource(),
	ikiru: new IkiruSource(),
	kiryuu: new KiryuuSource(),
	komikindo: new KomikindoSource(),
	komikstation: new KomikStationSource(),
	lumos: new LumosSource(),
	luvyaa: new LuvyaaSource(),
	manhwadesu: new ManhwaDesuSource(),
	manhwaindo: new ManhwaIndoSource(),
	ngomik: new NgomikSource(),
	pixhentai: new PixHentaiSource(),
	sasangeyou: new SasangeyouSource(),
	siikomik: new SiikomikSource()
};

export const WORKER_SOURCE_IDS = new Set(Object.keys(workerSources));

export function isWorkerSource(sourceId: string): boolean {
	return WORKER_SOURCE_IDS.has(sourceId);
}

export function getWorkerSource(sourceId: string): IMangaSource {
	const src = workerSources[sourceId];
	if (!src) {
		throw new Error(`Worker source "${sourceId}" not registered`);
	}
	return src;
}