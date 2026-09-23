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
}

const DB_NAME = 'mikoroku-db';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<MikorokuDB>> | null = null;

export function getDB() {
	if (!dbPromise) {
		dbPromise = openDB<MikorokuDB>(DB_NAME, DB_VERSION, {
			upgrade(db) {
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
