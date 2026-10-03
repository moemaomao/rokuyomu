/**
 * Worker-local sources — HANYA source yang diblokir outbound IP Vercel.
 *
 * File ini DIGENERATE otomatis oleh scripts/sync-worker-sources.mjs
 * Jangan edit manual. Edit daftar ID di scripts/worker-sources.json lalu jalankan:
 *
 *   pnpm sync-worker-sources
 *
 * Lazy load: module adapter hanya di-import saat source tersebut benar-benar dipakai.
 *
 * Alur:
 *   UI → CF Worker → (worker source?) → dynamic import + parse lokal (Cheerio)
 *                  → (else)           → fetch JSON ke scraper Vercel/Render
 */

import type { IMangaSource } from './types-manga';

export const WORKER_SOURCE_IDS = new Set([
	'ainzscans',
	'areakomik',
	'athreascans',
	'bacakomik',
	'botitranslation',
	'brightnovels',
	'crotpedia',
	'dobytranslations',
	'doujinku',
	'dragonholic',
	'drowsic',
	'fenrirealm',
	'flamecomics',
	'foxaholic',
	'hentairead',
	'holodek',
	'ikiru',
	'kingcomix',
	'kiryuu',
	'klz9',
	'komikindo',
	'komikstation',
	'lovelyblossoms',
	'lumos',
	'luvyaa',
	'manhuarmtl',
	'manhwadesu',
	'manhwaindo',
	'meionovel',
	'ngomik',
	'nomadtranslations',
	'novelib',
	'novelshaven',
	'noveltoon',
	'onemanga',
	'pixhentai',
	'rawkuma',
	'sakuranovel',
	'sasangeyou',
	'setsuscans',
	'shanghaifantasy',
	'siikomik',
	'silentquill',
	'simplyhentai',
	'skydemonorder',
	'softkomik',
	'storyseedling',
	'tinytranslation',
	'toasteful',
	'voratoon',
	'weebcentral',
	'yumeneijiworks'
]);

const instanceCache = new Map<string, IMangaSource>();

const loaders: Record<string, () => Promise<IMangaSource>> = {
	ainzscans: async () => new (await import('./impl/AinzScans')).AinzScansSource(),
	areakomik: async () => new (await import('./impl/Areakomik')).AreakomikSource(),
	athreascans: async () => new (await import('./impl/AthreaScans')).AthreaScansSource(),
	bacakomik: async () => new (await import('./impl/Bacakomik')).BacaKomikSource(),
	botitranslation: async () => new (await import('./impl/BotiTranslation')).BotiTranslationSource(),
	brightnovels: async () => new (await import('./impl/BrightNovels')).BrightNovelsSource(),
	crotpedia: async () => new (await import('./impl/Crotpedia')).CrotpediaSource(),
	dobytranslations: async () => new (await import('./impl/DobyTranslations')).DobyTranslationsSource(),
	doujinku: async () => new (await import('./impl/Doujinku')).DoujinkuSource(),
	dragonholic: async () => new (await import('./impl/Dragonholic')).DragonholicSource(),
	drowsic: async () => new (await import('./impl/Drowsic')).DrowsicSource(),
	fenrirealm: async () => new (await import('./impl/FenrirRealm')).FenrirRealmSource(),
	flamecomics: async () => new (await import('./impl/FlameComics')).FlameComicsSource(),
	foxaholic: async () => new (await import('./impl/Foxaholic')).FoxaholicSource(),
	hentairead: async () => new (await import('./impl/Hentairead')).HentaireadSource(),
	holodek: async () => new (await import('./impl/Holodek')).HolodekSource(),
	ikiru: async () => new (await import('./impl/Ikiru')).IkiruSource(),
	kingcomix: async () => new (await import('./impl/Kingkomix')).KingcomixSource(),
	kiryuu: async () => new (await import('./impl/Kiryuu')).KiryuuSource(),
	klz9: async () => new (await import('./impl/Klz9')).Klz9Source(),
	komikindo: async () => new (await import('./impl/Komikindo')).KomikindoSource(),
	komikstation: async () => new (await import('./impl/KomikStation')).KomikStationSource(),
	lovelyblossoms: async () => new (await import('./impl/LovelyBlossoms')).LovelyBlossomsSource(),
	lumos: async () => new (await import('./impl/Lumos')).LumosSource(),
	luvyaa: async () => new (await import('./impl/Luvyaa')).LuvyaaSource(),
	manhuarmtl: async () => new (await import('./impl/Manhuarmtl')).ManhuarmtlSource(),
	manhwadesu: async () => new (await import('./impl/ManhwaDesu')).ManhwaDesuSource(),
	manhwaindo: async () => new (await import('./impl/ManhwaIndo')).ManhwaIndoSource(),
	meionovel: async () => new (await import('./impl/Meionovel')).MeionovelSource(),
	ngomik: async () => new (await import('./impl/Ngomik')).NgomikSource(),
	nomadtranslations: async () => new (await import('./impl/NomadTranslations')).NomadTranslationsSource(),
	novelib: async () => new (await import('./impl/Novelib')).NovelibSource(),
	novelshaven: async () => new (await import('./impl/NovelsHaven')).NovelsHavenSource(),
	noveltoon: async () => new (await import('./impl/Noveltoon')).Noveltoon(),
	onemanga: async () => new (await import('./impl/OneManga')).OneMangaSource(),
	pixhentai: async () => new (await import('./impl/PixHentai')).PixHentaiSource(),
	rawkuma: async () => new (await import('./impl/Rawkuma')).RawkumaSource(),
	sakuranovel: async () => new (await import('./impl/Sakuranovel')).SakuranovelSource(),
	sasangeyou: async () => new (await import('./impl/Sasangeyou')).SasangeyouSource(),
	setsuscans: async () => new (await import('./impl/SetsuScans')).SetsuScansSource(),
	shanghaifantasy: async () => new (await import('./impl/ShanghaiFantasy')).ShanghaiFantasySource(),
	siikomik: async () => new (await import('./impl/Siikomik')).SiikomikSource(),
	silentquill: async () => new (await import('./impl/SilentQuill')).SilentQuillSource(),
	simplyhentai: async () => new (await import('./impl/Simplyhentai')).SimplyHentaiSource(),
	skydemonorder: async () => new (await import('./impl/SkyDemonOrder')).SkyDemonOrderSource(),
	softkomik: async () => new (await import('./impl/Softkomik')).SoftkomikSource(),
	storyseedling: async () => new (await import('./impl/StorySeedling')).StorySeedlingSource(),
	tinytranslation: async () => new (await import('./impl/TinyTranslation')).TinyTranslationSource(),
	toasteful: async () => new (await import('./impl/Toasteful')).ToastefulSource(),
	voratoon: async () => new (await import('./impl/Voratoon')).VoratoonSource(),
	weebcentral: async () => new (await import('./impl/WeebCentral')).WeebCentralSource(),
	yumeneijiworks: async () => new (await import('./impl/YumeNeijiWorks')).YumeNeijiWorksSource(),
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
