import type { IMangaSource } from '../types-manga';
import Noveltoon from '../impl/novel/Noveltoon';
import SakuranovelSource from '../impl/novel/Sakuranovel';
import { MeionovelSource } from '../impl/novel/Meionovel';
import { BacaLightNovelSource } from '../impl/novel/BacaLightNovel';
import { LovelyBlossomsSource } from '../impl/novel/LovelyBlossoms';
import { BotiTranslationSource } from '../impl/novel/BotiTranslation';
import { GoldenNovelSource } from '../impl/novel/GoldenNovel';
import { ShanghaiFantasySource } from '../impl/novel/ShanghaiFantasy';
import { YumeNeijiWorksSource } from '../impl/novel/YumeNeijiWorks';
import { BrightNovelsSource } from '../impl/novel/BrightNovels';
import { TinyTranslationSource } from '../impl/novel/TinyTranslation';
import { DragonholicSource } from '../impl/novel/Dragonholic';
import { FlenserSource } from '../impl/novel/Flenser';
import { SkyDemonOrderSource } from '../impl/novel/SkyDemonOrder';
import { CherryMistSource } from '../impl/novel/CherryMist';
import { KariStudioSource } from '../impl/novel/KariStudio';
import { StorySeedlingSource } from '../impl/novel/StorySeedling';
import { AzureChroniclesSource } from '../impl/novel/AzureChronicles';
import { NovelsHavenSource } from '../impl/novel/NovelsHaven';
import { NullTranslationSource } from '../impl/novel/NullTranslation';
import { NovelsPyramidSource } from '../impl/novel/NovelsPyramid';
import { FenrirRealmSource } from '../impl/novel/FenrirRealm';
import { MarineTLSource } from '../impl/novel/MarineTL';
import { RubyNovelsSource } from '../impl/novel/RubyNovels';
import { KrakenBitesSource } from '../impl/novel/KrakenBItes';
import { LazyGirlTranslationsSource } from '../impl/novel/lazygirltranslations';
import { CurspeSource } from '../impl/novel/Curspe';
import { FoxaholicSource } from '../impl/novel/Foxaholic';
import { RedPandaTranslationsSource } from '../impl/novel/RedPandaTranslations';
import { SkyNovelVaultSource } from '../impl/novel/SkyNovelVault';
import { MochiStarSource } from '../impl/novel/MochiStar';
import { DobyTranslationsSource } from '../impl/novel/DobyTranslations';
import { RaysVaultSource } from '../impl/novel/RaysVault';
import { HarishTranslationSource } from '../impl/novel/HarishTranslation';
import { NomadTranslationsSource } from '../impl/novel/NomadTranslations';
import { WeTriedTLsSource } from '../impl/novel/WeTriedTLs';
import { KaysTLsSource } from '../impl/novel/KaysTLs';
import { StabbingWithASyringeSource } from '../impl/novel/StabbingWithASyringe';
import { ZeusTranslationsSource } from '../impl/novel/ZeusTranslations';
import { DrowsicSource } from '../impl/novel/Drowsic';
import { MachineSlicedBreadSource } from '../impl/novel/MachineSlicedBread';
import { TransweaverSource } from '../impl/novel/Transweaver';
import { DasuiTLSource } from '../impl/novel/DasuiTL';
import { MelreadsSource } from '../impl/novel/Melreads';
import { MainichiTLSource } from '../impl/novel/MainichiTL';
import { ToastefulSource } from '../impl/novel/Toasteful';
import { NovelibSource } from '../impl/novel/Novelib';
import { HostedNovelSource } from '../impl/novel/HostedNovel';
import { BcatranslationSource } from '../impl/novel/Bcatranslation';
import { DuskBlossomsSource } from '../impl/novel/DuskBlossoms';
import { WordExcerptSource } from '../impl/novel/WordExcerpt';
import { SaiHirotoSource } from '../impl/novel/SaiHiroto';
import { AkkNovelSource } from '../impl/novel/AkkNovel';
import { NhvNovelsSource } from '../impl/novel/NhvNovels';
import { ZkyTLSource } from '../impl/novel/ZkyTL';
import { OssanTLSource } from '../impl/novel/OssanTL';
import { StarlitTalesSource } from '../impl/novel/StarlitTales';
import { SekaiTranslationsSource } from '../impl/novel/SekaiTranslations';
import { NoBadNovelSource } from '../impl/novel/NoBadNovel';
import { NoiceTranslationsSource } from '../impl/novel/NoiceTranslations';

const novelSources: Record<string, IMangaSource> = {
	noicetranslations: new NoiceTranslationsSource(),
	nobadnovel: new NoBadNovelSource(),
	sekaitranslations: new SekaiTranslationsSource(),
	starlittales: new StarlitTalesSource(),
	ossantl: new OssanTLSource(),
	zkytl: new ZkyTLSource(),
	akknovel: new AkkNovelSource(),
	nhvnovels: new NhvNovelsSource(),
	saihiroto: new SaiHirotoSource(),
	wordexcerpt: new WordExcerptSource(),
	duskblossoms: new DuskBlossomsSource(),
	bcatranslation: new BcatranslationSource(),
	hostednovel: new HostedNovelSource(),
	novelib: new NovelibSource(),
	toasteful: new ToastefulSource(),
	mainichitl: new MainichiTLSource(),
	melreads: new MelreadsSource(),
	dasuitl: new DasuiTLSource(),
	transweaver: new TransweaverSource(),
	machineslicedbread: new MachineSlicedBreadSource(),
	drowsic: new DrowsicSource(),
	zeustranslations: new ZeusTranslationsSource(),
	stabbingwithasyringe: new StabbingWithASyringeSource(),
	kaystls: new KaysTLsSource(),
	wetriedtls: new WeTriedTLsSource(),
	nomadtranslations: new NomadTranslationsSource(),
	dobytranslations: new DobyTranslationsSource(),
	harishtranslation: new HarishTranslationSource(),
	mochistar: new MochiStarSource(),
	raysvault: new RaysVaultSource(),
	skynovelvault: new SkyNovelVaultSource(),
	redpandatranslations: new RedPandaTranslationsSource(),
	foxaholic: new FoxaholicSource(),
	curspe: new CurspeSource(),
	rubynovels: new RubyNovelsSource(),
	marinetl: new MarineTLSource(),
	fenrirealm: new FenrirRealmSource(),
	novelspyramid: new NovelsPyramidSource(),
	nulltranslation: new NullTranslationSource(),
	novelshaven: new NovelsHavenSource(),
	azurechronicles: new AzureChroniclesSource(),
	storyseedling: new StorySeedlingSource(),
	karistudio: new KariStudioSource(),
	cherrymist: new CherryMistSource(),
	skydemonorder: new SkyDemonOrderSource(),
	flenser: new FlenserSource(),
	dragonholic: new DragonholicSource(),
	tinytranslation: new TinyTranslationSource(),
	brightnovels: new BrightNovelsSource(),
	yumeneijiworks: new YumeNeijiWorksSource(),
	shanghaifantasy: new ShanghaiFantasySource(),
	goldennovel: new GoldenNovelSource(),
	botitranslation: new BotiTranslationSource(),
	lovelyblossoms: new LovelyBlossomsSource(),
	bacalightnovel: new BacaLightNovelSource(),
	meionovel: new MeionovelSource(),
	sakuranovel: new SakuranovelSource(),
	noveltoon: new Noveltoon(),
    krakenbites: new KrakenBitesSource(),
    lazygirltranslations: new LazyGirlTranslationsSource()
};

export function getNovelSource(sourceId: string): IMangaSource {
	const source = novelSources[sourceId];
	if (!source) {
		throw new Error(
			`Novel source "${sourceId}" not found. Available: ${Object.keys(novelSources).join(', ')}`
		);
	}
	return source;
}

export function getAllNovelSources(): IMangaSource[] {
	return Object.values(novelSources);
}

export function getNovelSourceList(): Array<{ id: string; name: string }> {
	return Object.values(novelSources).map((s) => ({
		id: s.id,
		name: s.name
	}));
}

export function hasNovelSource(sourceId: string): boolean {
	return sourceId in novelSources;
}

export const NOVEL_SOURCE_IDS = new Set(Object.keys(novelSources));

export { novelSources };