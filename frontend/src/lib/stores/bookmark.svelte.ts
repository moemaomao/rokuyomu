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

let bookmarks = $state<BookmarkEntry[]>([]);
let ready = $state(false);

if (browser) {
	(async () => {
		try {
			// Migrasi dari localStorage lama
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
		if (!keepQuery) {
			parsed.search = '';
			parsed.hash = '';
		}
		u = parsed.toString();
	} catch {
		// ignore
	}

	const max = keepQuery ? 600 : 180;
	return u.length > max ? u.slice(0, max) : u;
}

function lightEntry(entry: BookmarkEntry): BookmarkEntry {
	return {
		mangaId: entry.mangaId,
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
	return bookmarks.some(
		(b) => b.mangaId === mangaId && (!sourceId || b.sourceId === sourceId)
	);
}

export async function addBookmark(entry: Omit<BookmarkEntry, 'timestamp'>) {
	if (!browser) return;

	const full = lightEntry({
		...entry,
		timestamp: Date.now()
	});

	const list = (await idbGetBookmarks()).filter((b) => b.mangaId !== entry.mangaId);
	list.unshift(full);
	const trimmed = list.slice(0, MAX);
	await idbSetAllBookmarks(trimmed);

	bookmarks = trimmed;
	window.dispatchEvent(new CustomEvent('bookmarks-changed'));

	const user = getUser();
	if (user && db) {
		try {
			await setDoc(doc(db, 'users', user.uid, 'bookmarks', entry.mangaId), full);
		} catch (e) {
			console.error('Failed to sync bookmark to cloud', e);
		}
	}
}

export async function removeBookmark(mangaId: string) {
	if (!browser) return;

	await idbDeleteBookmark(mangaId);

	bookmarks = await idbGetBookmarks();
	window.dispatchEvent(new CustomEvent('bookmarks-changed'));

	const user = getUser();
	if (user && db) {
		try {
			await deleteDoc(doc(db, 'users', user.uid, 'bookmarks', mangaId));
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

	await idbClearBookmarks();
	bookmarks = [];
	window.dispatchEvent(new CustomEvent('bookmarks-changed'));
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

		const map = new Map<string, BookmarkEntry>();
		[...cloud, ...local].forEach((b) => {
			const light = lightEntry(b);
			const existing = map.get(light.mangaId);
			if (!existing || light.timestamp > existing.timestamp) {
				map.set(light.mangaId, light);
			}
		});

		const merged = Array.from(map.values())
			.sort((a, b) => b.timestamp - a.timestamp)
			.slice(0, MAX);

		await idbSetAllBookmarks(merged);
		bookmarks = merged;
		window.dispatchEvent(new CustomEvent('bookmarks-changed'));

		const batch = writeBatch(firestore);
		merged.forEach((b) => {
			batch.set(doc(firestore, 'users', user.uid, 'bookmarks', b.mangaId), b);
		});
		await batch.commit();
	} catch (e) {
		console.error('Failed to sync bookmarks on login', e);
	}
}