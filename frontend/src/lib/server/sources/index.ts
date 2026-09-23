/**
 * Source Registry (LIGHT) — metadata only.
 * Scraping dilakukan di external scraper (Vercel).
 * Jangan import ./impl atau cheerio di sini.
 */

export interface SourceMeta {
	id: string;
	name: string;
}

const SOURCES: SourceMeta[] = [
	{ id: 'madarascans', name: 'Madara Scans' },
	{ id: 'manhuagui', name: 'Manhuagui' },
	{ id: 'jmcomic', name: 'Jmcomic' },
	{ id: 'rawuwu', name: 'RawUwU' },
	{ id: 'gdscans', name: 'GDScans' },
	{ id: 'mangamura', name: 'MangaMura' },
	{ id: 'ksgroupscans', name: 'KS Group Scans' },
	{ id: 'vortexscans', name: 'Vortex Scans' },
	{ id: 'kumopoi', name: 'Kumopoi' },
	{ id: 'doujins', name: 'Doujins' },
	{ id: 'mangataro', name: 'MangaTaro' },
	{ id: 'mangasushi', name: 'MangaSushi' },
	{ id: 'mangaread', name: 'MangaRead' },
	{ id: 'mangakakalot', name: 'MangaKakalot' },
	{ id: 'cucumbermanga', name: 'Cucumber Manga' },
	{ id: 'weebcentral', name: 'Weeb Central' },
	{ id: 'athreascans', name: 'Athrea Scans' },
	{ id: 'onemanga', name: 'One Manga' },
	{ id: 'kaynscans', name: 'Kayn Scans' },
	{ id: 'asmhentai', name: 'AsmHentai' },
	{ id: 'mangafire', name: 'MangaFire' },
	{ id: 'westmanga', name: 'West Manga' },
	{ id: 'flamecomics', name: 'Flame Comics' },
	{ id: 'soulscans', name: 'Soul Scans' },
	{ id: 'asura', name: 'Asura Scans' },
	{ id: 'weloma', name: 'Weloma' },
	{ id: 'hitomi', name: 'Hitomi' },
	{ id: 'nhentai', name: 'Nhentai' },
	{ id: 'hentaifox', name: 'Hentaifox' },
	{ id: 'pornhwa', name: 'Pornhwa' },
	{ id: 'kingcomix', name: 'Kingcomix' },
	{ id: 'ehentai', name: 'E-Hentai' },
	{ id: 'klmanga', name: 'KLManga' },
	{ id: 'komiku', name: 'Komiku' },
	{ id: 'imhentai', name: 'Imhentai' },
	{ id: 'hentai2read', name: 'Hentai2read' },
	{ id: 'hentaiera', name: 'Hentaiera' },
	{ id: 'hentairead', name: 'Hentairead' },
	{ id: 'simplyhentai', name: 'Simply Hentai' },
	{ id: 'klz9', name: 'Klz9' },
	{ id: 'love4u', name: 'Love4u' },
	{ id: 'rawkuma', name: 'Rawkuma' },
	{ id: 'mangakatana', name: 'MangaKatana' },
	{ id: 'mangabats', name: 'MangaBats' },
	{ id: 'mangabatscom', name: 'MangaBats.com' },
	{ id: 'doujindesu', name: 'DoujinDesu' },
	{ id: 'crotpedia', name: 'Crotpedia' },
	{ id: 'bacakomik', name: 'BacaKomik' },
	{ id: 'pixhentai', name: 'PixHentai' },
	{ id: 'mgkomik', name: 'Mgkomik' },
	{ id: 'komikindo', name: 'Komikindo' },
	{ id: 'mangaindo', name: 'Mangaindo' },
	{ id: 'voratoon', name: 'Voratoon' },
	{ id: 'zonatmo', name: 'ZonaTmo' },
	{ id: 'lectortmo', name: 'LectorTmo' },
	{ id: 'mangacopy', name: 'MangaCopy' },
	{ id: 'omegascans', name: 'OmegaScans' },
	{ id: 'mangadex', name: 'MangaDex' },
	{ id: 'luvyaa', name: 'Luvyaa' },
	{ id: 'softkomik', name: 'Softkomik' },
	{ id: 'kiryuu', name: 'Kiryuu' },
	{ id: 'komikstation', name: 'KomikStation' },
	{ id: 'shinigami', name: 'Shinigami' },
	{ id: 'ainzscans', name: 'Ainz Scans' },
	{ id: 'bacami', name: 'Bacami' },
	{ id: 'comicaso', name: 'Comicaso' },
	{ id: 'dojing', name: 'Dojing' },
	{ id: 'doujinku', name: 'Doujinku' },
	{ id: 'holodek', name: 'Holodek' },
	{ id: 'ikiru', name: 'Ikiru' },
	{ id: 'isekaikomik', name: 'Isekai Komik' },
	{ id: 'maid', name: 'Maid' },
	{ id: 'mangakuri', name: 'Mangakuri' },
	{ id: 'lumos', name: 'Lumos' },
	{ id: 'lunarx', name: 'Lunarx' },
	{ id: 'mangasusu', name: 'Mangasusu' },
	{ id: 'manhuarmtl', name: 'Manhuarmtl' },
	{ id: 'manhwaindo', name: 'ManhwaIndo' },
	{ id: 'manhwadesu', name: 'ManhwaDesu' },
	{ id: 'natsu', name: 'Natsu' },
	{ id: 'ngomik', name: 'Ngomik' },
	{ id: 'noromax', name: 'Noromax' },
	{ id: 'pornhwa18', name: 'Pornhwa18' },
	{ id: 'ryukomik', name: 'Ryukomik' },
	{ id: 'sasangeyou', name: 'Sasangeyou' },
	{ id: 'sektedoujin', name: 'Sekte Doujin' },
	{ id: 'siikomik', name: 'Siikomik' },
	{ id: 'ravenscans', name: 'Raven Scans' },
	{ id: 'demonicscans', name: 'Demonic Scans' },
	{ id: 'renascans', name: 'Rena Scans' },
	{ id: 'hentailoop', name: 'HentaiLoop' },
	{ id: 'silentquill', name: 'SilentQuill' },
	{ id: 'areakomik', name: 'Areakomik' },
	{ id: 'genztoons', name: 'Genz Toons' },
	{ id: 'setsuscans', name: 'Setsu Scans' },
	{ id: 'noveltoon', name: 'Noveltoon' },
	{ id: 'sakuranovel', name: 'Sakuranovel' },
];

export function getSourceList(): SourceMeta[] {
	return SOURCES;
}

export function isValidSource(sourceId: string): boolean {
	return SOURCES.some((s) => s.id === sourceId);
}

export function getSourceName(sourceId: string): string {
	return SOURCES.find((s) => s.id === sourceId)?.name ?? sourceId;
}

export function getAllSourceIds(): string[] {
	return SOURCES.map((s) => s.id);
}