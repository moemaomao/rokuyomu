export interface Novel {
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

export interface NovelChapter {
	id: string;
	title: string;
	number: number;
	date?: string;
	lang?: string;
}

export interface NovelDetails extends Novel {
	description: string;
	authors: string[];
	status: string;
	genres: string[];
	chapters: NovelChapter[];
}

export interface NovelChapterContent {
	title: string;
	content: string;
	prevChapterId?: string | null;
	nextChapterId?: string | null;
}

export interface INovelSource {
	id: string;
	name: string;
	baseUrl: string;
	kind: 'novel';

	getLatestNovels(
		page: number,
		opts?: { lang?: string; type?: string }
	): Promise<Novel[]>;

	searchNovels(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Novel[]>;

	getNovelDetails(
		novelId: string,
		opts?: { lang?: string }
	): Promise<NovelDetails>;

	getChapterContent(chapterId: string): Promise<NovelChapterContent>;
}