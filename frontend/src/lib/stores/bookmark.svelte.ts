import { browser } from '$app/environment';
import {
	collection,
	doc,
	setDoc,
	deleteDoc,
	getDocs,
	writeBatch
} from 'firebase/firestore';
import { db } from '$lib/firebase';
import { getUser } from '$lib/stores/auth.svelte';
import {
	idbGetBookmarks,
	idbDeleteBookmark,
	idbSetAllBookmarks,
	idbClearBookmarks,
	type BookmarkEntry
} from '$lib/db';

export type { BookmarkEntry };

const MAX = 60;
const TOMBSTONE_KEY = 'mikoroku_bookmark_tombstones';

export function normalizeMangaId(id: string): string {
	let s = String(id || '').trim();
	if (!s) return '';
	if (!s.startsWith('/')) s = '/' + s;
	s = s.replace(/\/+$/, '');
	return s || '/';
}

function bookmarkDocId(mangaId: string): string {
	return encodeURIComponent(normalizeMangaId(mangaId)).replace(/%/g, '_');
}

function readTombstones(): Set<string> {
	if (!browser) return new Set();
	try {
		const raw = localStorage.getItem(TOMBSTONE_KEY);
		if (!raw) return new Set();
		const arr = JSON.parse(raw) as string[];
		return new Set((arr || []).map(normalizeMangaId).filter(Boolean));
	} catch {
		return new Set();
	}
}

function writeTombstones(set: Set<string>) {
	if (!browser) return;
	localStorage.setItem(TOMBSTONE_KEY, JSON.stringify([...set]));
}

function addTombstone(mangaId: string) {
	const n = normalizeMangaId(mangaId);
	if (!n) return;
	const set = readTombstones();
	set.add(n);
	writeTombstones(set);
}

function removeTombstone(mangaId: string) {
	const n = normalizeMangaId(mangaId);
	const set = readTombstones();
	set.delete(n);
	writeTombstones(set);
}

let bookmarks = $state<BookmarkEntry[]>([]);
let ready = $state(false);

if (browser) {
	(async () => {
		try {
			const old = localStorage.getItem('mikoroku_bookmarks');
			if (old) {
				try {
					const parsed = JSON.parse(old) as BookmarkEntry[];
					if (Array.isArray(parsed) && parsed.length > 0) {
						const cleaned = parsed.map(lightEntry).slice(0, MAX);
						await idbSetAllBookmarks(cleaned);
					}
				} catch {
					// ignore
				}
				localStorage.removeItem('mikoroku_bookmarks');
			}

			bookmarks = await idbGetBookmarks();
		} catch (e) {
			console.error('[bookmarks] failed to load from IndexedDB', e);
			bookmarks = [];
		} finally {
			ready = true;
		}

		window.addEventListener('bookmarks-changed', async () => {
			bookmarks = await idbGetBookmarks();
		});
	})();
}

function lightCover(url: string | undefined | null): string {
	if (!url) return '';
	let u = String(url).trim();
	if (!u) return '';
	if (u.startsWith('//')) u = 'https:' + u;

	const keepQuery =
		/cvr\.voratoon\.id|X-Amz-Signature|X-Amz-Algorithm/i.test(u);

	try {
		const parsed = new URL(u);
		if (!parsed.hostname || !parsed.hostname.includes('.')) return '';
		if (!keepQuery) {
			parsed.search = '';
			parsed.hash = '';
		}
		u = parsed.toString();
	} catch {
		return '';
	}

	const max = keepQuery ? 1200 : 800;
	return u.length > max ? u.slice(0, max) : u;
}

function lightEntry(entry: BookmarkEntry): BookmarkEntry {
	return {
		mangaId: normalizeMangaId(entry.mangaId) || entry.mangaId,
		mangaSlug: entry.mangaSlug || '',
		mangaTitle: (entry.mangaTitle || '').slice(0, 120),
		cover: lightCover(entry.cover),
		sourceId: entry.sourceId,
		timestamp: entry.timestamp
	};
}

export function getBookmarks(): BookmarkEntry[] {
	return bookmarks;
}

export function isBookmarksReady(): boolean {
	return ready;
}

export function isBookmarked(mangaId: string, sourceId?: string): boolean {
	const n = normalizeMangaId(mangaId);
	return bookmarks.some(
		(b) =>
			normalizeMangaId(b.mangaId) === n &&
			(!sourceId || b.sourceId === sourceId)
	);
}

export async function addBookmark(entry: Omit<BookmarkEntry, 'timestamp'>) {
	if (!browser) return;

	const full = lightEntry({
		...entry,
		mangaId: normalizeMangaId(entry.mangaId) || entry.mangaId,
		timestamp: Date.now()
	});

	removeTombstone(full.mangaId);

	const list = (await idbGetBookmarks()).filter(
		(b) => normalizeMangaId(b.mangaId) !== normalizeMangaId(full.mangaId)
	);
	list.unshift(full);
	const trimmed = list.slice(0, MAX);
	await idbSetAllBookmarks(trimmed);

	bookmarks = trimmed;
	window.dispatchEvent(new CustomEvent('bookmarks-changed'));

	const user = getUser();
	if (user && db) {
		try {
			await setDoc(
				doc(db, 'users', user.uid, 'bookmarks', bookmarkDocId(full.mangaId)),
				full
			);
		} catch (e) {
			console.error('Failed to sync bookmark to cloud', e);
		}
	}
}

export async function removeBookmark(mangaId: string) {
	if (!browser) return;

	const n = normalizeMangaId(mangaId);
	addTombstone(n || mangaId);

	const list = await idbGetBookmarks();
	const next = list.filter((b) => normalizeMangaId(b.mangaId) !== n);
	await idbSetAllBookmarks(next);
	
	try {
		await idbDeleteBookmark(mangaId);
		if (n && n !== mangaId) await idbDeleteBookmark(n);
	} catch {
		// ignore
	}

	bookmarks = next;
	window.dispatchEvent(new CustomEvent('bookmarks-changed'));

	const user = getUser();
	if (user && db) {
		try {
			await deleteDoc(doc(db, 'users', user.uid, 'bookmarks', bookmarkDocId(n || mangaId)));
		
			if (mangaId !== n) {
				try {
					await deleteDoc(
						doc(
							db,
							'users',
							user.uid,
							'bookmarks',
							encodeURIComponent(String(mangaId || '')).replace(/%/g, '_')
						)
					);
				} catch {
					// ignore
				}
			}
		} catch (e) {
			console.error('Failed to remove bookmark from cloud', e);
		}
	}
}

export async function toggleBookmark(entry: Omit<BookmarkEntry, 'timestamp'>): Promise<boolean> {
	if (isBookmarked(entry.mangaId, entry.sourceId)) {
		await removeBookmark(entry.mangaId);
		return false;
	}
	await addBookmark(entry);
	return true;
}

export async function clearBookmarks() {
	if (!browser) return;

	const list = await idbGetBookmarks();
	for (const b of list) addTombstone(b.mangaId);

	await idbClearBookmarks();
	bookmarks = [];
	window.dispatchEvent(new CustomEvent('bookmarks-changed'));

	const user = getUser();
	if (user && db && list.length) {
		try {
			const batch = writeBatch(db);
			for (const b of list) {
				batch.delete(doc(db, 'users', user.uid, 'bookmarks', bookmarkDocId(b.mangaId)));
			}
			await batch.commit();
		} catch (e) {
			console.error('Failed to clear cloud bookmarks', e);
		}
	}
}

export async function syncBookmarksOnLogin() {
	if (!browser || !db) return;

	const user = getUser();
	if (!user) return;

	const firestore = db;

	try {
		const local = await idbGetBookmarks();
		const snap = await getDocs(collection(firestore, 'users', user.uid, 'bookmarks'));
		const cloud: BookmarkEntry[] = [];
		snap.forEach((d) => cloud.push(d.data() as BookmarkEntry));

		const tombstones = readTombstones();

		const map = new Map<string, BookmarkEntry>();
		for (const b of [...cloud, ...local]) {
			const light = lightEntry(b);
			const key = normalizeMangaId(light.mangaId);
			if (!key) continue;
			if (tombstones.has(key)) continue;
			const existing = map.get(key);
			if (!existing || light.timestamp > existing.timestamp) {
				map.set(key, { ...light, mangaId: key });
			}
		}

		const merged = Array.from(map.values())
			.sort((a, b) => b.timestamp - a.timestamp)
			.slice(0, MAX);

		await idbSetAllBookmarks(merged);
		bookmarks = merged;
		window.dispatchEvent(new CustomEvent('bookmarks-changed'));

		const batch = writeBatch(firestore);
	
		merged.forEach((b) => {
			batch.set(doc(firestore, 'users', user.uid, 'bookmarks', bookmarkDocId(b.mangaId)), b);
		});

		for (const id of tombstones) {
			batch.delete(doc(firestore, 'users', user.uid, 'bookmarks', bookmarkDocId(id)));
		}
		await batch.commit();

		writeTombstones(new Set());
	} catch (e) {
		console.error('Failed to sync bookmarks on login', e);
	}
}
