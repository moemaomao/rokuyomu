export const NOVEL_SOURCE_IDS = new Set<string>([
	'sakuranovel',
	'noveltoon',
	'meionovel',
	'bacalightnovel',
	'lovelyblossoms',
	'botitranslation',
	'goldennovel',
	'shanghaifantasy',
	'yumeneijiworks',
	'brightnovels',
	'tinytranslation',
	'dragonholic',
	'flenser',
	'skydemonorder',
	'cherrymist',
	'karistudio',
	'storyseedling',
	'azurechronicles',
	'novelshaven',
	'nulltranslation',
	'novelspyramid',
	'fenrirealm',
	'marinetl',
	'rubynovels',
	'krakenbites',
	'lazygirltranslations',
	'curspe',
	'foxaholic',
	'redpandatranslations',
	'skynovelvault',
	'mochistar',
	'dobytranslations',
	'raysvault',
	'harishtranslation',
	'nomadtranslations',
	'wetriedtls',
	'kaystls',
	'stabbingwithasyringe',
	'zeustranslations',
	'drowsic',
	'machineslicedbread',
	'transweaver',
	'dasuitl',
	'melreads',
	'mainichitl',
	'toasteful'
]);

export function isNovelSource(sourceId: string | null | undefined): boolean {
	if (!sourceId) return false;
	return NOVEL_SOURCE_IDS.has(sourceId.toLowerCase());
}

export function chapterReadBase(sourceId: string): '/novel-reader' | '/reader' {
	return isNovelSource(sourceId) ? '/novel-reader' : '/reader';
}

export function chapterHref(sourceId: string, chapterId: string): string {
	const base = chapterReadBase(sourceId);
	const id = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
	return `${base}/${sourceId}${id}`;
}
