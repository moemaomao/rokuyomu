export interface Manga {
	id: string;
	title: string;
	cover: string;
	sourceId: string;
	type?: string;
	status?: string;
	latestChapter?: string | number;
	lang?: string;
	updatedAt?: number;
}

export interface Chapter {
	id: string;
	title: string;
	number: number;
	date?: string;
	cover?: string;
	lang?: string;
	isLocked?: boolean;
}

export interface MangaDetails extends Manga {
	description: string;
	authors: string[];
	status: string;
	genres: string[];
	chapters: Chapter[];
}

export interface IMangaSource {
	id: string;
	name: string;
	baseUrl: string;

	getLatestManga(
		page: number,
		opts?: { lang?: string; type?: string }
	): Promise<Manga[]>;

	searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]>;

	getMangaDetails(
		mangaId: string,
		opts?: { lang?: string }
	): Promise<MangaDetails>;

	getChapterPages(chapterId: string): Promise<string[]>;
}