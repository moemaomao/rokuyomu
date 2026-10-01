import {
	getMangaSource,
	getAllMangaSources,
	getMangaSourceList,
	hasMangaSource
} from './manga';
import {
	getNovelSource,
	getAllNovelSources,
	getNovelSourceList,
	hasNovelSource,
	NOVEL_SOURCE_IDS
} from './novel';
import type { IMangaSource } from './types';

/**
 * @throws Error if source not found
 */
export function getSource(sourceId: string): IMangaSource {
	const id = sourceId.toLowerCase();
	if (hasMangaSource(id)) return getMangaSource(id);
	if (hasNovelSource(id)) return getNovelSource(id);
	throw new Error(
		`Source "${sourceId}" not found. ` +
			`Manga: ${getMangaSourceList().map((s) => s.id).join(', ')}. ` +
			`Novel: ${getNovelSourceList().map((s) => s.id).join(', ')}`
	);
}


export function getAllSources(): IMangaSource[] {
	return [...getAllMangaSources(), ...getAllNovelSources()];
}

export function getSourceList(): Array<{ id: string; name: string }> {
	return [...getMangaSourceList(), ...getNovelSourceList()];
}

export function isNovelSource(sourceId: string | null | undefined): boolean {
	if (!sourceId) return false;
	return NOVEL_SOURCE_IDS.has(sourceId.toLowerCase());
}

export {
	getMangaSource,
	getAllMangaSources,
	getMangaSourceList,
	hasMangaSource
} from './manga';

export {
	getNovelSource,
	getAllNovelSources,
	getNovelSourceList,
	hasNovelSource,
	NOVEL_SOURCE_IDS
} from './novel';