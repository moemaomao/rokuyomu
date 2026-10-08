import type { IMangaSource } from '../types-manga';
import { AsuraSource } from '../impl/manga/Asura';
import { WelomaSource } from '../impl/manga/weloma';
import { HitomiSource } from '../impl/manga/Hitomi';
import { NhentaiSource } from '../impl/manga/Nhentai';
import { HentaifoxSource } from '../impl/manga/Hentaifox';
import { PornhwaSource } from '../impl/manga/pornhwa';
import { KingcomixSource } from '../impl/manga/Kingkomix';
import { EhentaiSource } from '../impl/manga/Ehentai';
import { KlmangaSource } from '../impl/manga/klmanga';
import { KomikuSource } from '../impl/manga/komiku';
import { ImhentaiSource } from '../impl/manga/imhentai';
import { Hentai2readSource } from '../impl/manga/hentai2read';
import { HentaieraSource } from '../impl/manga/Hentaiera';
import { HentaireadSource } from '../impl/manga/Hentairead';
import { SimplyHentaiSource } from '../impl/manga/Simplyhentai';
import { Klz9Source } from '../impl/manga/Klz9';
import { Love4uSource } from '../impl/manga/Love4u';
import { RawkumaSource } from '../impl/manga/Rawkuma';
import { MangaKatanaSource } from '../impl/manga/Mangakatana';
import { MangaBatsSource } from '../impl/manga/MangaBats';
import { MangaBatsComSource } from '../impl/manga/MangaBatsCom';
import { DoujinDesuSource } from '../impl/manga/DoujinDesu';
import { CrotpediaSource } from '../impl/manga/Crotpedia';
import { BacaKomikSource } from '../impl/manga/Bacakomik';
import { PixHentaiSource } from '../impl/manga/PixHentai';
import { MgkomikSource } from '../impl/manga/Mgkomik';
import { KomikindoSource } from '../impl/manga/Komikindo';
import { MangaindoSource } from '../impl/manga/Mangaindo';
import { VoratoonSource } from '../impl/manga/Voratoon';
import { ZonaTmoSource } from '../impl/manga/ZonaTmo';
import { LectorTmoSource } from '../impl/manga/LectorTmo';
import { MangaCopySource } from '../impl/manga/MangaCopy';
import { OmegaScansSource } from '../impl/manga/OmegaScans';
import { MangaDexSource } from '../impl/manga/MangaDex';
import { LuvyaaSource } from '../impl/manga/Luvyaa';
import { SoftkomikSource } from '../impl/manga/Softkomik';
import { KiryuuSource } from '../impl/manga/Kiryuu';
import { KomikStationSource } from '../impl/manga/KomikStation';
import { ShinigamiSource } from '../impl/manga/Shinigami';
import { AinzScansSource } from '../impl/manga/AinzScans';
import { BacamiSource } from '../impl/manga/Bacami';
import { ComicasoSource } from '../impl/manga/Comicaso';
import { DojingSource } from '../impl/manga/Dojing';
import { DoujinkuSource } from '../impl/manga/Doujinku';
import { HolodekSource } from '../impl/manga/Holodek';
import { IkiruSource } from '../impl/manga/Ikiru';
import { IsekaiKomikSource } from '../impl/manga/IsekaiKomik';
import { MaidSource } from '../impl/manga/Maid';
import { MangakuriSource } from '../impl/manga/Mangakuri';
import { LumosSource } from '../impl/manga/Lumos';
import { LunarxSource } from '../impl/manga/Lunarx';
import { MangasusuSource } from '../impl/manga/Mangasusu';
import { ManhuarmtlSource } from '../impl/manga/Manhuarmtl';
import { ManhwaIndoSource } from '../impl/manga/ManhwaIndo';
import { ManhwaDesuSource } from '../impl/manga/ManhwaDesu';
import { NatsuSource } from '../impl/manga/Natsu';
import { NgomikSource } from '../impl/manga/Ngomik';
import { NoromaxSource } from '../impl/manga/Noromax';
import { Pornhwa18Source } from '../impl/manga/Pornhwa18';
import { RyukomikSource } from '../impl/manga/Ryukomik';
import { SasangeyouSource } from '../impl/manga/Sasangeyou';
import { SektedoujinSource } from '../impl/manga/Sektedoujin';
import { SiikomikSource } from '../impl/manga/Siikomik';
import { SoulScansSource } from '../impl/manga/SoulScans';
import { WestMangaSource } from '../impl/manga/WestManga';
import { FlameComicsSource } from '../impl/manga/FlameComics';
import { MangaFireSource } from '../impl/manga/MangaFire';
import { AsmHentaiSource } from '../impl/manga/AsmHentai';
import { OneMangaSource } from '../impl/manga/OneManga';
import { KaynScansSource } from '../impl/manga/KaynScans';
import { AthreaScansSource } from '../impl/manga/AthreaScans';
import { WeebCentralSource } from '../impl/manga/WeebCentral';
import { CucumberMangaSource } from '../impl/manga/CucumberManga';
import { DoujinsSource } from '../impl/manga/Doujins';
import { MangaKakalotSource } from '../impl/manga/MangaKakalot';
import { MangaReadSource } from '../impl/manga/MangaRead';
import { MangaSushiSource } from '../impl/manga/MangaSushi';
import { MangaTaroSource } from '../impl/manga/MangaTaro';
import { KumopoiSource } from '../impl/manga/Kumopoi';
import { MadaraScansSource } from '../impl/manga/MadaraScans';
import { ManhuaguiSource } from '../impl/manga/Manhuagui';
import { JmcomicSource } from '../impl/manga/Jmcomic';
import { GDScansSource } from '../impl/manga/GDScans';
import { KSGroupScansSource } from '../impl/manga/KSGroupScans';
import { VortexScansSource } from '../impl/manga/VortexScans';
import { MangaMuraSource } from '../impl/manga/MangaMura';
import { RawUwUSource } from '../impl/manga/RawUwU';
import { RavenScansSource } from '../impl/manga/RavenScans';
import { DemonicScansSource } from '../impl/manga/DemonicScans';
import { RenaScansSource } from '../impl/manga/RenaScans';
import { HentailoopSource } from '../impl/manga/Hentailoop';
import { SilentQuillSource } from '../impl/manga/SilentQuill';
import { AreakomikSource } from '../impl/manga/Areakomik';
import { GenzToonsSource } from '../impl/manga/GenzToons';
import { SetsuScansSource } from '../impl/manga/SetsuScans';
import { VioletMangaSource } from '../impl/manga/VioletManga';
import { KappaBeastSource } from '../impl/manga/KappaBeast';
import { HiveToonsSource } from '../impl/manga/HiveToons';
import { ThunderScansSource } from '../impl/manga/ThunderScans';
import { AsmoToonSource } from '../impl/manga/AsmoToon';
import { OrionScansSource } from '../impl/manga/OrionScans';
import { LHTranslationSource } from '../impl/manga/LHTranslation';

const mangaSources: Record<string, IMangaSource> = {
	lhtranslation: new LHTranslationSource(),
	orionscans: new OrionScansSource(),
	asmotoon: new AsmoToonSource(),
	thunderscans: new ThunderScansSource(),
	hivetoons: new HiveToonsSource(),
	kappabeast: new KappaBeastSource(),
	violetmanga: new VioletMangaSource(),
	silentquill: new SilentQuillSource(),
	genztoons: new GenzToonsSource(),
	setsuscans: new SetsuScansSource(),
	areakomik: new AreakomikSource(),
	gdscans: new GDScansSource(),
	hentailoop: new HentailoopSource(),
	renascans: new RenaScansSource(),
	demonicscans: new DemonicScansSource(),
	ravenscans: new RavenScansSource(),
	rawuwu: new RawUwUSource(),
	mangamura: new MangaMuraSource(),
	vortexscans: new VortexScansSource(),
	ksgroupscans: new KSGroupScansSource(),
	madarascans: new MadaraScansSource(),
	manhuagui: new ManhuaguiSource(),
	jmcomic: new JmcomicSource(),
	kumopoi: new KumopoiSource(),
	doujins: new DoujinsSource(),
	mangataro: new MangaTaroSource(),
	mangasushi: new MangaSushiSource(),
	mangaread: new MangaReadSource(),
	mangakakalot: new MangaKakalotSource(),
	cucumbermanga: new CucumberMangaSource(),
	weebcentral: new WeebCentralSource(),
	athreascans: new AthreaScansSource(),
	onemanga: new OneMangaSource(),
	kaynscans: new KaynScansSource(),
	asmhentai: new AsmHentaiSource(),
	mangafire: new MangaFireSource(),
	westmanga: new WestMangaSource(),
	flamecomics: new FlameComicsSource(),
	soulscans: new SoulScansSource(),
	asura: new AsuraSource(),
	weloma: new WelomaSource(),
	hitomi: new HitomiSource(),
	nhentai: new NhentaiSource(),
	hentaifox: new HentaifoxSource(),
	pornhwa: new PornhwaSource(),
	kingcomix: new KingcomixSource(),
	ehentai: new EhentaiSource(),
	klmanga: new KlmangaSource(),
	komiku: new KomikuSource(),
	imhentai: new ImhentaiSource(),
	hentai2read: new Hentai2readSource(),
	hentaiera: new HentaieraSource(),
	hentairead: new HentaireadSource(),
	simplyhentai: new SimplyHentaiSource(),
	klz9: new Klz9Source(),
	love4u: new Love4uSource(),
	rawkuma: new RawkumaSource(),
	mangakatana: new MangaKatanaSource(),
	mangabats: new MangaBatsSource(),
	mangabatscom: new MangaBatsComSource(),
	doujindesu: new DoujinDesuSource(),
	crotpedia: new CrotpediaSource(),
	bacakomik: new BacaKomikSource(),
	pixhentai: new PixHentaiSource(),
	mgkomik: new MgkomikSource(),
	komikindo: new KomikindoSource(),
	mangaindo: new MangaindoSource(),
	voratoon: new VoratoonSource(),
	zonatmo: new ZonaTmoSource(),
	lectortmo: new LectorTmoSource(),
	mangacopy: new MangaCopySource(),
	omegascans: new OmegaScansSource(),
	mangadex: new MangaDexSource(),
	luvyaa: new LuvyaaSource(),
	softkomik: new SoftkomikSource(),
	kiryuu: new KiryuuSource(),
	komikstation: new KomikStationSource(),
	shinigami: new ShinigamiSource(),
	ainzscans: new AinzScansSource(),
	bacami: new BacamiSource(),
	comicaso: new ComicasoSource(),
	dojing: new DojingSource(),
	doujinku: new DoujinkuSource(),
	holodek: new HolodekSource(),
	ikiru: new IkiruSource(),
	isekaikomik: new IsekaiKomikSource(),
	maid: new MaidSource(),
	mangakuri: new MangakuriSource(),
	lumos: new LumosSource(),
	lunarx: new LunarxSource(),
	mangasusu: new MangasusuSource(),
	manhuarmtl: new ManhuarmtlSource(),
	manhwaindo: new ManhwaIndoSource(),
	manhwadesu: new ManhwaDesuSource(),
	natsu: new NatsuSource(),
	ngomik: new NgomikSource(),
	noromax: new NoromaxSource(),
	pornhwa18: new Pornhwa18Source(),
	ryukomik: new RyukomikSource(),
	sasangeyou: new SasangeyouSource(),
	sektedoujin: new SektedoujinSource(),
	siikomik: new SiikomikSource()
};

export function getMangaSource(sourceId: string): IMangaSource {
	const source = mangaSources[sourceId];
	if (!source) {
		throw new Error(
			`Manga source "${sourceId}" not found. Available: ${Object.keys(mangaSources).join(', ')}`
		);
	}
	return source;
}

export function getAllMangaSources(): IMangaSource[] {
	return Object.values(mangaSources);
}

export function getMangaSourceList(): Array<{ id: string; name: string }> {
	return Object.values(mangaSources).map((s) => ({
		id: s.id,
		name: s.name
	}));
}

export function hasMangaSource(sourceId: string): boolean {
	return sourceId in mangaSources;
}

export { mangaSources };