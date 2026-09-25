/**
 * Source Registry - Central factory for all manga source adapters.
 *
 * To add a new source:
 * 1. Create a new adapter in ./impl/ that extends BaseSource
 * 2. Import and register it in the `sources` record below
 */

import { AsuraSource } from './impl/Asura';
import { WelomaSource } from './impl/weloma';
import { HitomiSource } from './impl/Hitomi';
import { NhentaiSource } from './impl/Nhentai';
import { HentaifoxSource } from './impl/Hentaifox';
import { PornhwaSource } from './impl/pornhwa';
import { KingcomixSource } from './impl/Kingkomix';
import { EhentaiSource } from './impl/Ehentai';
import { KlmangaSource } from './impl/klmanga';
import { KomikuSource } from './impl/komiku';
import { ImhentaiSource } from './impl/imhentai';
import { Hentai2readSource } from './impl/hentai2read';
import { HentaieraSource } from './impl/Hentaiera';
import { HentaireadSource } from './impl/Hentairead';
import { SimplyHentaiSource } from './impl/Simplyhentai';
import { Klz9Source } from './impl/Klz9';
import { Love4uSource } from './impl/Love4u';
import { RawkumaSource } from './impl/Rawkuma';
import { MangaKatanaSource } from './impl/Mangakatana';
import { MangaBatsSource } from './impl/MangaBats';
import { MangaBatsComSource } from './impl/MangaBatsCom';
import { DoujinDesuSource } from './impl/DoujinDesu';
import { CrotpediaSource } from './impl/Crotpedia';
import { BacaKomikSource } from './impl/Bacakomik';
import { PixHentaiSource } from './impl/PixHentai';
import { MgkomikSource } from './impl/Mgkomik';
import { KomikindoSource } from './impl/Komikindo';
import { MangaindoSource } from './impl/Mangaindo';
import { VoratoonSource } from './impl/Voratoon';
import { ZonaTmoSource } from './impl/ZonaTmo';
import { LectorTmoSource } from './impl/LectorTmo';
import { MangaCopySource } from './impl/MangaCopy';
import { OmegaScansSource } from './impl/OmegaScans';
import { MangaDexSource } from './impl/MangaDex';
import { LuvyaaSource } from './impl/Luvyaa';
import { SoftkomikSource } from './impl/Softkomik';
import { KiryuuSource } from './impl/Kiryuu';
import { KomikStationSource } from './impl/KomikStation';
import { ShinigamiSource } from './impl/Shinigami';
import { AinzScansSource } from './impl/AinzScans';
import { BacamiSource } from './impl/Bacami';
import { ComicasoSource } from './impl/Comicaso';
import { DojingSource } from './impl/Dojing';
import { DoujinkuSource } from './impl/Doujinku';
import { HolodekSource } from './impl/Holodek';
import { IkiruSource } from './impl/Ikiru';
import { IsekaiKomikSource } from './impl/IsekaiKomik';
import { MaidSource } from './impl/Maid';
import { MangakuriSource } from './impl/Mangakuri';
import { LumosSource } from './impl/Lumos';
import { LunarxSource } from './impl/Lunarx';
import { MangasusuSource } from './impl/Mangasusu';
import { ManhuarmtlSource } from './impl/Manhuarmtl';
import { ManhwaIndoSource } from './impl/ManhwaIndo';
import { ManhwaDesuSource } from './impl/ManhwaDesu';
import { NatsuSource } from './impl/Natsu';
import { NgomikSource } from './impl/Ngomik';
import { NoromaxSource } from './impl/Noromax';
import { Pornhwa18Source } from './impl/Pornhwa18';
import { RyukomikSource } from './impl/Ryukomik';
import { SasangeyouSource } from './impl/Sasangeyou';
import { SektedoujinSource } from './impl/Sektedoujin';
import { SiikomikSource } from './impl/Siikomik';
import { SoulScansSource } from './impl/SoulScans';
import { WestMangaSource } from './impl/WestManga';
import { FlameComicsSource } from './impl/FlameComics';
import { MangaFireSource } from './impl/MangaFire';
import { AsmHentaiSource } from './impl/AsmHentai';
import { OneMangaSource } from './impl/OneManga';
import { KaynScansSource } from './impl/KaynScans';
import { AthreaScansSource } from './impl/AthreaScans';
import { WeebCentralSource } from './impl/WeebCentral';
import { CucumberMangaSource } from './impl/CucumberManga';
import { DoujinsSource } from './impl/Doujins';
import { MangaKakalotSource } from './impl/MangaKakalot';
import { MangaReadSource } from './impl/MangaRead';
import { MangaSushiSource } from './impl/MangaSushi';
import { MangaTaroSource } from './impl/MangaTaro';
import { KumopoiSource } from './impl/Kumopoi';
import { MadaraScansSource } from './impl/MadaraScans';
import { ManhuaguiSource } from './impl/Manhuagui';
import { JmcomicSource } from './impl/Jmcomic';
import { GDScansSource } from './impl/GDScans';
import { KSGroupScansSource } from './impl/KSGroupScans';
import { VortexScansSource } from './impl/VortexScans';
import { MangaMuraSource } from './impl/MangaMura';
import { RawUwUSource } from './impl/RawUwU';
import { RavenScansSource } from './impl/RavenScans';
import { DemonicScansSource } from './impl/DemonicScans';
import { RenaScansSource } from './impl/RenaScans';
import { HentailoopSource } from './impl/Hentailoop';
import { SilentQuillSource } from './impl/SilentQuill';
import { AreakomikSource } from './impl/Areakomik';
import { GenzToonsSource } from './impl/GenzToons';
import { SetsuScansSource } from './impl/SetsuScans';
import Noveltoon from './impl/Noveltoon';
import SakuranovelSource from './impl/Sakuranovel';
import { MeionovelSource } from './impl/Meionovel';
import { BacaLightNovelSource } from './impl/BacaLightNovel';
import { LovelyBlossomsSource } from './impl/LovelyBlossoms';
import { BotiTranslationSource } from './impl/BotiTranslation';
import { GoldenNovelSource } from './impl/GoldenNovel';
import { ShanghaiFantasySource } from './impl/ShanghaiFantasy';
import { YumeNeijiWorksSource } from './impl/YumeNeijiWorks';
import type { IMangaSource } from './types';

const sources: Record<string, IMangaSource> = {
    yumeneijiworks: new YumeNeijiWorksSource(),
    shanghaifantasy: new ShanghaiFantasySource(),
    goldennovel: new GoldenNovelSource(),
    botitranslation: new BotiTranslationSource(),
    lovelyblossoms: new LovelyBlossomsSource(),
    bacalightnovel: new BacaLightNovelSource(),
    meionovel: new MeionovelSource(),
    sakuranovel: new SakuranovelSource(),
    noveltoon: new Noveltoon(),
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
    siikomik: new SiikomikSource(),
};

/**
 * Get a specific source adapter by ID.
 * @throws Error if source not found
 */
export function getSource(sourceId: string): IMangaSource {
    const source = sources[sourceId];
    if (!source) {
        throw new Error(
            `Source "${sourceId}" not found. Available sources: ${Object.keys(sources).join(', ')}`
        );
    }
    return source;
}

/**
 * Get all available source adapters.
 */
export function getAllSources(): IMangaSource[] {
    return Object.values(sources);
}

/**
 * Get source metadata for display.
 */
export function getSourceList(): Array<{ id: string; name: string }> {
    return Object.values(sources).map((s) => ({
        id: s.id,
        name: s.name
    }));
}
