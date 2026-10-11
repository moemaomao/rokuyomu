import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { normalizeMangaId } from '$lib/stores/bookmark.svelte';

const DB_NAME = 'rokuyomu-offline-chapters';
const DB_VERSION = 1;

export type OfflineMangaPage = { blob: Blob; ext: string };

export type OfflineMangaChapter = {
	key: string;
	sourceId: string;
	mangaId: string;
	chapterId: string;
	mangaTitle: string;
	chapterTitle: string;
	pages: OfflineMangaPage[];
	savedAt: number;
};

export type OfflineNovelChapter = {
	key: string;
	sourceId: string;
	mangaId: string;
	chapterId: string;
	novelTitle: string;
	chapterTitle: string;
	content: string;
	pdfBlob?: Blob;
	savedAt: number;
};

interface OfflineDB extends DBSchema {
	mangaChapters: {
		key: string;
		value: OfflineMangaChapter;
		indexes: { 'by-manga': string; 'by-savedAt': number };
	};
	novelChapters: {
		key: string;
		value: OfflineNovelChapter;
		indexes: { 'by-manga': string; 'by-savedAt': number };
	};
}

function chapterKey(sourceId: string, chapterId: string): string {
	return `${String(sourceId)}::${normalizeMangaId(chapterId)}`;
}

function mangaIndexKey(sourceId: string, mangaId: string): string {
	return `${String(sourceId)}::${normalizeMangaId(mangaId)}`;
}

let dbp: Promise<IDBPDatabase<OfflineDB>> | null = null;

function getDB() {
	if (!dbp) {
		dbp = openDB<OfflineDB>(DB_NAME, DB_VERSION, {
			upgrade(db) {
				if (!db.objectStoreNames.contains('mangaChapters')) {
					const s = db.createObjectStore('mangaChapters', { keyPath: 'key' });
					s.createIndex('by-manga', 'mangaId');
					s.createIndex('by-savedAt', 'savedAt');
				}
				if (!db.objectStoreNames.contains('novelChapters')) {
					const s = db.createObjectStore('novelChapters', { keyPath: 'key' });
					s.createIndex('by-manga', 'mangaId');
					s.createIndex('by-savedAt', 'savedAt');
				}
			}
		});
	}
	return dbp;
}

export async function saveOfflineMangaChapter(opts: {
	sourceId: string;
	mangaId: string;
	chapterId: string;
	mangaTitle: string;
	chapterTitle: string;
	pages: OfflineMangaPage[];
}): Promise<string> {
	const key = chapterKey(opts.sourceId, opts.chapterId);
	const pages = opts.pages
		.filter((p) => p?.blob && p.blob.size > 0)
		.map((p) => ({
			blob: p.blob,
			ext: p.ext || 'jpg'
		}));
	if (!pages.length) throw new Error('No pages to save offline');

	const db = await getDB();
	const entry: OfflineMangaChapter = {
		key,
		sourceId: opts.sourceId,
		mangaId: normalizeMangaId(opts.mangaId || opts.chapterId),
		chapterId: normalizeMangaId(opts.chapterId),
		mangaTitle: opts.mangaTitle || 'Manga',
		chapterTitle: opts.chapterTitle || 'Chapter',
		pages,
		savedAt: Date.now()
	};
	await db.put('mangaChapters', entry);
	return key;
}

export async function getOfflineMangaChapter(
	sourceId: string,
	chapterId: string
): Promise<OfflineMangaChapter | null> {
	const db = await getDB();
	const key = chapterKey(sourceId, chapterId);
	let row = await db.get('mangaChapters', key);
	if (row) return row;
	const alt = chapterId.startsWith('/') ? chapterId.slice(1) : `/${chapterId}`;
	row = await db.get('mangaChapters', chapterKey(sourceId, alt));
	return row || null;
}

export async function hasOfflineMangaChapter(
	sourceId: string,
	chapterId: string
): Promise<boolean> {
	const row = await getOfflineMangaChapter(sourceId, chapterId);
	return Boolean(row?.pages?.length);
}

export async function saveOfflineNovelChapter(opts: {
	sourceId: string;
	mangaId: string;
	chapterId: string;
	novelTitle: string;
	chapterTitle: string;
	content: string;
	pdfBlob?: Blob;
}): Promise<string> {
	const key = chapterKey(opts.sourceId, opts.chapterId);
	const content = String(opts.content || '').trim();
	if (!content) throw new Error('No novel content to save offline');

	const db = await getDB();
	const entry: OfflineNovelChapter = {
		key,
		sourceId: opts.sourceId,
		mangaId: normalizeMangaId(opts.mangaId || opts.chapterId),
		chapterId: normalizeMangaId(opts.chapterId),
		novelTitle: opts.novelTitle || 'Novel',
		chapterTitle: opts.chapterTitle || 'Chapter',
		content,
		pdfBlob: opts.pdfBlob,
		savedAt: Date.now()
	};
	await db.put('novelChapters', entry);
	return key;
}

export async function getOfflineNovelChapter(
	sourceId: string,
	chapterId: string
): Promise<OfflineNovelChapter | null> {
	const db = await getDB();
	const key = chapterKey(sourceId, chapterId);
	let row = await db.get('novelChapters', key);
	if (row) return row;
	const alt = chapterId.startsWith('/') ? chapterId.slice(1) : `/${chapterId}`;
	row = await db.get('novelChapters', chapterKey(sourceId, alt));
	return row || null;
}

export async function hasOfflineNovelChapter(
	sourceId: string,
	chapterId: string
): Promise<boolean> {
	const row = await getOfflineNovelChapter(sourceId, chapterId);
	return Boolean(row?.content);
}

export async function deleteOfflineChapter(
	sourceId: string,
	chapterId: string,
	isNovel?: boolean
): Promise<void> {
	const db = await getDB();
	const key = chapterKey(sourceId, chapterId);
	if (isNovel) await db.delete('novelChapters', key);
	else await db.delete('mangaChapters', key);
}

export function mangaPagesToObjectUrls(chapter: OfflineMangaChapter): string[] {
	return chapter.pages.map((p) => URL.createObjectURL(p.blob));
}

export function offlineMangaReaderHref(
	sourceId: string,
	chapterId: string
): string {
	const id = chapterId.startsWith('/') ? chapterId.slice(1) : chapterId;
	return `/offline/reader/${encodeURIComponent(sourceId)}/${id
		.split('/')
		.map(encodeURIComponent)
		.join('/')}`;
}

export function offlineNovelReaderHref(
	sourceId: string,
	chapterId: string
): string {
	const id = chapterId.startsWith('/') ? chapterId.slice(1) : chapterId;
	return `/offline/novel/${encodeURIComponent(sourceId)}/${id
		.split('/')
		.map(encodeURIComponent)
		.join('/')}`;
}
