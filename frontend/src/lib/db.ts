import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface BookmarkEntry {
	mangaId: string;
	mangaSlug: string;
	mangaTitle: string;
	cover: string;
	sourceId: string;
	timestamp: number;
}

export interface ReadingEntry {
	mangaId: string;
	mangaSlug: string;
	mangaTitle: string;
	cover: string;
	chapterId: string;
	chapterTitle: string;
	chapterNumber: number;
	sourceId: string;
	timestamp: number;
}

export interface NotificationEntry {
	mangaId: string;
	mangaSlug: string;
	mangaTitle: string;
	cover: string;
	sourceId: string;
	lastChapterId: string;
	lastChapterTitle: string;
	lastChapterNumber: number;
	hasNew: boolean;
	newChapterId: string;
	newChapterTitle: string;
	newChapterNumber: number;
	lastChecked: number;
	timestamp: number;
}

export interface ActivityLogEntry {
	id?: number;
	mangaId: string;
	sourceId: string;
	timestamp: number;
}

export interface PermanentTitleMeta {
	maxChapter: number;
	isNovel: boolean;
	sourceId: string;
	title: string;
	lastRead: number;
}

export interface PermanentStatsDoc {
	titles: Record<string, PermanentTitleMeta>;
	sources: Record<string, { count: number; isNovel: boolean }>;
	comicTitles: number;
	novelTitles: number;
	totalProgress: number;
	chaptersReadEver: number;
	updatedAt: number;
}

export interface LibraryChapterRef {
	chapterId: string;
	chapterTitle: string;
	savedAt: number;
	pageCount?: number;
}

export interface LibraryEntry {
	key: string;
	mangaId: string;
	mangaTitle: string;
	cover: string;
	sourceId: string;
	isNovel: boolean;
	localPath: string;
	chapters: LibraryChapterRef[];
	timestamp: number;
}

interface MikorokuDB extends DBSchema {
	bookmarks: {
		key: string;
		value: BookmarkEntry;
		indexes: { 'by-timestamp': number };
	};
	history: {
		key: string;
		value: ReadingEntry;
		indexes: { 'by-timestamp': number };
	};
	notifications: {
		key: string;
		value: NotificationEntry & { key: string };
		indexes: { 'by-timestamp': number };
	};
	activityLog: {
		key: number;
		value: ActivityLogEntry;
		indexes: { 'by-timestamp': number };
	};
	permanentStats: {
		key: string;
		value: PermanentStatsDoc & { key: string };
	};
	library: {
		key: string;
		value: LibraryEntry;
		indexes: { 'by-timestamp': number };
	};
}

const DB_NAME = 'mikoroku-db';
const DB_VERSION = 5;

export const ACTIVITY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

let dbPromise: Promise<IDBPDatabase<MikorokuDB>> | null = null;

export function getDB() {
	if (!dbPromise) {
		dbPromise = openDB<MikorokuDB>(DB_NAME, DB_VERSION, {
			upgrade(db, oldVersion) {
				if (!db.objectStoreNames.contains('bookmarks')) {
					const store = db.createObjectStore('bookmarks', { keyPath: 'mangaId' });
					store.createIndex('by-timestamp', 'timestamp');
				}
				if (!db.objectStoreNames.contains('history')) {
					const store = db.createObjectStore('history', { keyPath: 'mangaId' });
					store.createIndex('by-timestamp', 'timestamp');
				}
				if (!db.objectStoreNames.contains('notifications')) {
					const store = db.createObjectStore('notifications', { keyPath: 'key' });
					store.createIndex('by-timestamp', 'timestamp');
				}
				if (oldVersion < 3 && !db.objectStoreNames.contains('activityLog')) {
					const store = db.createObjectStore('activityLog', {
						keyPath: 'id',
						autoIncrement: true
					});
					store.createIndex('by-timestamp', 'timestamp');
				}
				if (oldVersion < 4 && !db.objectStoreNames.contains('permanentStats')) {
					db.createObjectStore('permanentStats', { keyPath: 'key' });
				}
				if (!db.objectStoreNames.contains('library')) {
					const store = db.createObjectStore('library', { keyPath: 'key' });
					store.createIndex('by-timestamp', 'timestamp');
				}
			}
		});
	}
	return dbPromise;
}

// ===== Bookmarks =====
export async function idbGetBookmarks(): Promise<BookmarkEntry[]> {
	const db = await getDB();
	const all = await db.getAllFromIndex('bookmarks', 'by-timestamp');
	return all.reverse();
}

export async function idbPutBookmark(entry: BookmarkEntry) {
	const db = await getDB();
	await db.put('bookmarks', entry);
}

export async function idbDeleteBookmark(mangaId: string) {
	const db = await getDB();
	await db.delete('bookmarks', mangaId);
}

export async function idbClearBookmarks() {
	const db = await getDB();
	await db.clear('bookmarks');
}

export async function idbSetAllBookmarks(list: BookmarkEntry[]) {
	const db = await getDB();
	const tx = db.transaction('bookmarks', 'readwrite');
	await tx.store.clear();
	await Promise.all(list.map((b) => tx.store.put(b)));
	await tx.done;
}

// ===== History =====
export async function idbGetHistory(): Promise<ReadingEntry[]> {
	const db = await getDB();
	const all = await db.getAllFromIndex('history', 'by-timestamp');
	return all.reverse();
}

export async function idbPutHistory(entry: ReadingEntry) {
	const db = await getDB();
	await db.put('history', entry);
}

export async function idbDeleteHistory(mangaId: string) {
	const db = await getDB();
	await db.delete('history', mangaId);
}

export async function idbClearHistory() {
	const db = await getDB();
	await db.clear('history');
}

export async function idbSetAllHistory(list: ReadingEntry[]) {
	const db = await getDB();
	const tx = db.transaction('history', 'readwrite');
	await tx.store.clear();
	await Promise.all(list.map((h) => tx.store.put(h)));
	await tx.done;
}

// ===== Activity log (for stats graph — keeps 30 days of events) =====
export async function idbAddActivity(entry: Omit<ActivityLogEntry, 'id'>): Promise<void> {
	const db = await getDB();
	const ts = entry.timestamp || Date.now();
	await db.add('activityLog', {
		mangaId: entry.mangaId,
		sourceId: entry.sourceId || '',
		timestamp: ts
	});
	// Trim old entries outside retention window
	const cutoff = Date.now() - ACTIVITY_RETENTION_MS;
	const tx = db.transaction('activityLog', 'readwrite');
	const idx = tx.store.index('by-timestamp');
	let cursor = await idx.openCursor(IDBKeyRange.upperBound(cutoff));
	while (cursor) {
		await cursor.delete();
		cursor = await cursor.continue();
	}
	await tx.done;
}

export async function idbGetActivityLog(sinceMs?: number): Promise<ActivityLogEntry[]> {
	const db = await getDB();
	const cutoff = sinceMs ?? Date.now() - ACTIVITY_RETENTION_MS;
	const all = await db.getAllFromIndex(
		'activityLog',
		'by-timestamp',
		IDBKeyRange.lowerBound(cutoff)
	);
	return all;
}

export async function idbClearActivityLog() {
	const db = await getDB();
	await db.clear('activityLog');
}

// ===== Notifications =====
function notifStorageKey(mangaId: string, sourceId: string): string {
	return `${sourceId}::${mangaId}`;
}

type NotificationRow = NotificationEntry & { key: string };

export async function idbGetNotifications(): Promise<NotificationEntry[]> {
	const db = await getDB();
	const all = await db.getAllFromIndex('notifications', 'by-timestamp');
	return (all as NotificationRow[])
		.map(({ key: _k, ...rest }) => rest as NotificationEntry)
		.reverse();
}

export async function idbPutNotification(entry: NotificationEntry) {
	const db = await getDB();
	const row: NotificationRow = {
		...entry,
		key: notifStorageKey(entry.mangaId, entry.sourceId)
	};
	await db.put('notifications', row);
}

export async function idbDeleteNotification(mangaId: string, sourceId?: string) {
	const db = await getDB();
	if (sourceId) {
		await db.delete('notifications', notifStorageKey(mangaId, sourceId));
		return;
	}
	const all = await db.getAll('notifications');
	const tx = db.transaction('notifications', 'readwrite');
	for (const row of all as NotificationRow[]) {
		if (row.mangaId === mangaId) {
			await tx.store.delete(row.key);
		}
	}
	await tx.done;
}

export async function idbClearNotifications() {
	const db = await getDB();
	await db.clear('notifications');
}

export async function idbSetAllNotifications(list: NotificationEntry[]) {
	const db = await getDB();
	const tx = db.transaction('notifications', 'readwrite');
	await tx.store.clear();
	await Promise.all(
		list.map((n) =>
			tx.store.put({
				...n,
				key: notifStorageKey(n.mangaId, n.sourceId)
			} as NotificationRow)
		)
	);
	await tx.done;
}


// ===== Permanent stats (survives history clear) =====
const PERM_KEY = 'main';

export async function idbGetPermanentStats(): Promise<PermanentStatsDoc | null> {
	const db = await getDB();
	const row = await db.get('permanentStats', PERM_KEY);
	if (!row) return null;
	const { key: _k, ...rest } = row;
	return rest as PermanentStatsDoc;
}

export async function idbSetPermanentStats(doc: PermanentStatsDoc): Promise<void> {
	const db = await getDB();
	await db.put('permanentStats', { ...doc, key: PERM_KEY });
}

// ===== Offline Library =====
export async function idbGetLibrary(): Promise<LibraryEntry[]> {
	const db = await getDB();
	try {
		const all = await db.getAllFromIndex('library', 'by-timestamp');
		return all.reverse();
	} catch (e) {
		console.warn('[idb] library index fallback', e);
		const all = await db.getAll('library');
		return all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
	}
}

export async function idbPutLibraryEntry(entry: LibraryEntry) {
	const db = await getDB();
	const plain: LibraryEntry = {
		key: String(entry.key),
		mangaId: String(entry.mangaId ?? ''),
		mangaTitle: String(entry.mangaTitle ?? ''),
		cover: String(entry.cover ?? ''),
		sourceId: String(entry.sourceId ?? ''),
		isNovel: !!entry.isNovel,
		localPath: String(entry.localPath ?? ''),
		chapters: (entry.chapters || []).map((c) => ({
			chapterId: String(c.chapterId ?? ''),
			chapterTitle: String(c.chapterTitle ?? ''),
			savedAt: Number(c.savedAt) || Date.now(),
			pageCount: typeof c.pageCount === 'number' ? c.pageCount : undefined
		})),
		timestamp: Number(entry.timestamp) || Date.now()
	};
	await db.put('library', plain);
}

export async function idbDeleteLibraryEntry(key: string) {
	const db = await getDB();
	await db.delete('library', key);
}

export async function idbClearLibrary() {
	const db = await getDB();
	await db.clear('library');
}

export async function idbSetAllLibrary(list: LibraryEntry[]) {
	const db = await getDB();
	const tx = db.transaction('library', 'readwrite');
	await tx.store.clear();
	await Promise.all(
		list.map((entry) =>
			tx.store.put({
				key: String(entry.key),
				mangaId: String(entry.mangaId ?? ''),
				mangaTitle: String(entry.mangaTitle ?? ''),
				cover: String(entry.cover ?? ''),
				sourceId: String(entry.sourceId ?? ''),
				isNovel: !!entry.isNovel,
				localPath: String(entry.localPath ?? ''),
				chapters: (entry.chapters || []).map((c) => ({
					chapterId: String(c.chapterId ?? ''),
					chapterTitle: String(c.chapterTitle ?? ''),
					savedAt: Number(c.savedAt) || Date.now(),
					pageCount: typeof c.pageCount === 'number' ? c.pageCount : undefined
				})),
				timestamp: Number(entry.timestamp) || Date.now()
			} satisfies LibraryEntry)
		)
	);
	await tx.done;
}
