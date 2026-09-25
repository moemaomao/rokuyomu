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
	'brightnovels'
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
