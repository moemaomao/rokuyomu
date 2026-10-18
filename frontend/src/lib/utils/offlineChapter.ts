import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { normalizeMangaId } from '$lib/stores/bookmark.svelte';
import { chapterHref } from '$lib/utils/novelSources';

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

const mangaChapterCache = new Map<string, OfflineMangaChapter | null>();
const novelChapterCache = new Map<string, OfflineNovelChapter | null>();
const CACHE_MAX = 40;

function cachePutManga(key: string, row: OfflineMangaChapter | null) {
	if (mangaChapterCache.size >= CACHE_MAX) {
		const first = mangaChapterCache.keys().next().value;
		if (first !== undefined) mangaChapterCache.delete(first);
	}
	mangaChapterCache.set(key, row);
}

function cachePutNovel(key: string, row: OfflineNovelChapter | null) {
	if (novelChapterCache.size >= CACHE_MAX) {
		const first = novelChapterCache.keys().next().value;
		if (first !== undefined) novelChapterCache.delete(first);
	}
	novelChapterCache.set(key, row);
}

export function clearOfflineChapterMemoryCache() {
	mangaChapterCache.clear();
	novelChapterCache.clear();
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

function sameManga(a: string, b: string): boolean {
	return normalizeMangaId(a) === normalizeMangaId(b);
}

function chapterSortKey(title: string, chapterId: string): number {
	const m =
		String(title || '').match(/(\d+(?:\.\d+)?)/) ||
		String(chapterId || '').match(/(\d+(?:\.\d+)?)/);
	return m ? parseFloat(m[1]) : 0;
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
		.map((p) => ({ blob: p.blob, ext: p.ext || 'jpg' }));
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
	cachePutManga(key, entry);
	return key;
}

export async function getOfflineMangaChapter(
	sourceId: string,
	chapterId: string,
	opts?: { mangaTitle?: string; chapterTitle?: string; allowDisk?: boolean }
): Promise<OfflineMangaChapter | null> {
	const raw = String(chapterId || '').trim();
	if (!raw) return null;

	const primaryKey = chapterKey(sourceId, raw);
	if (mangaChapterCache.has(primaryKey)) {
		const hit = mangaChapterCache.get(primaryKey);
		if (hit?.pages?.length) return hit;
		if (!opts?.allowDisk) return null;
	}

	if (opts?.allowDisk && opts.mangaTitle && opts.chapterTitle) {
		try {
			const { readMangaChapterFromDisk } = await import('$lib/utils/localFs');
			const disk = await readMangaChapterFromDisk({
				sourceId,
				chapterId: raw,
				mangaTitle: opts.mangaTitle,
				chapterTitle: opts.chapterTitle
			});
			if (disk?.pages.length) {
				const entry: OfflineMangaChapter = {
					key: primaryKey,
					sourceId: disk.sourceId,
					mangaId: disk.mangaId,
					chapterId: disk.chapterId,
					mangaTitle: disk.mangaTitle,
					chapterTitle: disk.chapterTitle,
					pages: disk.pages,
					savedAt: Date.now()
				};
				cachePutManga(primaryKey, entry);
				return entry;
			}
		} catch (e) {
			console.warn('[offline] read manga chapter from disk', e);
		}
	}

	const db = await getDB();

	const candidates: string[] = [];
	const seen = new Set<string>();
	const add = (s: string) => {
		const t = String(s || '').trim();
		if (!t || seen.has(t)) return;
		seen.add(t);
		candidates.push(t);
		const n = normalizeMangaId(t);
		if (n && !seen.has(n)) {
			seen.add(n);
			candidates.push(n);
		}
	};
	add(raw);
	const seg = raw.split('/').filter(Boolean).pop();
	if (seg) add(seg);
	const noSlash = raw.replace(/^\/+/, '').replace(/\/+$/, '');
	if (noSlash) {
		add(noSlash);
		add('/' + noSlash);
	}

	for (const c of candidates) {
		const k = chapterKey(sourceId, c);
		try {
			const row = await db.get('mangaChapters', k);
			if (row?.pages?.length) {
				cachePutManga(k, row);
				cachePutManga(primaryKey, row);
				return row;
			}
		} catch {
		}
	}

	cachePutManga(primaryKey, null);
	return null;
}


export async function hasOfflineMangaChapter(
	sourceId: string,
	chapterId: string
): Promise<boolean> {
	const row = await getOfflineMangaChapter(sourceId, chapterId);
	return Boolean(row?.pages?.length);
}

export async function listOfflineMangaChapters(
	sourceId: string,
	mangaId: string
): Promise<OfflineMangaChapter[]> {
	const db = await getDB();
	const all = await db.getAll('mangaChapters');
	const mid = normalizeMangaId(mangaId);
	return all
		.filter((c) => c.sourceId === sourceId && sameManga(c.mangaId, mid))
		.sort(
			(a, b) =>
				chapterSortKey(a.chapterTitle, a.chapterId) -
				chapterSortKey(b.chapterTitle, b.chapterId)
		);
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
	cachePutNovel(key, entry);
	return key;
}

export async function getOfflineNovelChapter(
	sourceId: string,
	chapterId: string,
	opts?: { novelTitle?: string; chapterTitle?: string; allowDisk?: boolean }
): Promise<OfflineNovelChapter | null> {
	const raw = String(chapterId || '').trim();
	if (!raw) return null;

	const primaryKey = chapterKey(sourceId, raw);
	if (novelChapterCache.has(primaryKey)) {
		const hit = novelChapterCache.get(primaryKey);
		if (hit && String(hit.content || '').trim()) return hit;
		if (!opts?.allowDisk) return null;
	}

	if (opts?.allowDisk && opts.novelTitle) {
		try {
			const { readNovelChapterFromDisk } = await import('$lib/utils/localFs');
			const disk = await readNovelChapterFromDisk({
				sourceId,
				chapterId: raw,
				novelTitle: opts.novelTitle,
				chapterTitle: opts.chapterTitle
			});
			if (disk?.content.trim()) {
				const entry: OfflineNovelChapter = {
					key: primaryKey,
					sourceId: disk.sourceId,
					mangaId: disk.mangaId,
					chapterId: disk.chapterId,
					novelTitle: disk.novelTitle,
					chapterTitle: disk.chapterTitle,
					content: disk.content,
					savedAt: Date.now()
				};
				cachePutNovel(primaryKey, entry);
				return entry;
			}
		} catch (e) {
			console.warn('[offline] read novel chapter from disk', e);
		}
	}

	const db = await getDB();

	const candidates = new Set<string>();
	const add = (s: string) => {
		const t = String(s || '').trim();
		if (!t) return;
		candidates.add(t);
		candidates.add(normalizeMangaId(t));
		const noSlash = t.replace(/^\/+/, '').replace(/\/+$/, '');
		if (noSlash) {
			candidates.add(noSlash);
			candidates.add('/' + noSlash);
		}
	};
	add(raw);
	const seg = raw.split('/').filter(Boolean).pop();
	if (seg) add(seg);

	for (const c of candidates) {
		const k = chapterKey(sourceId, c);
		const row = await db.get('novelChapters', k);
		if (row && String(row.content || '').trim()) {
			cachePutNovel(k, row);
			cachePutNovel(primaryKey, row);
			return row;
		}
	}

	try {
		const all = await db.getAll('novelChapters');
		const src = String(sourceId);
		const needle = normalizeMangaId(raw).toLowerCase();
		const needleSeg = (seg || '').toLowerCase();
		for (const row of all) {
			if (row.sourceId !== src || !String(row.content || '').trim()) continue;
			const id = normalizeMangaId(row.chapterId).toLowerCase();
			if (id === needle || (needleSeg && (id.endsWith('/' + needleSeg) || id.endsWith(needleSeg))) || (needle && (id.endsWith(needle) || needle.endsWith(id)))) {
				cachePutNovel(primaryKey, row);
				return row;
			}
		}
	} catch {
		/* ignore */
	}
	cachePutNovel(primaryKey, null);
	return null;
}


export async function hasOfflineNovelChapter(
	sourceId: string,
	chapterId: string
): Promise<boolean> {
	const row = await getOfflineNovelChapter(sourceId, chapterId);
	return Boolean(row?.content);
}

export async function listOfflineNovelChapters(
	sourceId: string,
	mangaId: string
): Promise<OfflineNovelChapter[]> {
	const db = await getDB();
	const all = await db.getAll('novelChapters');
	const mid = normalizeMangaId(mangaId);
	return all
		.filter((c) => c.sourceId === sourceId && sameManga(c.mangaId, mid))
		.sort(
			(a, b) =>
				chapterSortKey(a.chapterTitle, a.chapterId) -
				chapterSortKey(b.chapterTitle, b.chapterId)
		);
}

export async function deleteOfflineChapter(
	sourceId: string,
	chapterId: string,
	isNovel?: boolean
): Promise<void> {
	const db = await getDB();
	const key = chapterKey(sourceId, chapterId);
	if (isNovel) {
		await db.delete('novelChapters', key);
		novelChapterCache.delete(key);
	} else {
		await db.delete('mangaChapters', key);
		mangaChapterCache.delete(key);
	}
}

export function mangaPagesToObjectUrls(chapter: OfflineMangaChapter): string[] {
	return chapter.pages.map((p) => URL.createObjectURL(p.blob));
}

export async function getFirstOfflineChapterHref(
	sourceId: string,
	mangaId: string,
	isNovel: boolean
): Promise<string | null> {
	if (isNovel) {
		const list = await listOfflineNovelChapters(sourceId, mangaId);
		if (!list.length) return null;
		return chapterHref(sourceId, list[0].chapterId);
	}
	const list = await listOfflineMangaChapters(sourceId, mangaId);
	if (!list.length) return null;
	return chapterHref(sourceId, list[0].chapterId);
}

export async function countOfflineChapters(
	sourceId: string,
	mangaId: string,
	isNovel: boolean
): Promise<number> {
	if (isNovel) return (await listOfflineNovelChapters(sourceId, mangaId)).length;
	return (await listOfflineMangaChapters(sourceId, mangaId)).length;
}