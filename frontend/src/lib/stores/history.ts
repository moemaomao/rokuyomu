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
	idbGetHistory,
	idbDeleteHistory,
	idbSetAllHistory,
	idbClearHistory,
	type ReadingEntry
} from '$lib/db';

export type { ReadingEntry };

const MAX_HISTORY = 30;
const TOMBSTONE_KEY = 'mikoroku_history_tombstones';
const FIRESTORE_BATCH_LIMIT = 450;

function normalizeMangaId(id: string): string {
	let s = String(id || '').trim();
	if (!s) return '';
	if (!s.startsWith('/')) s = '/' + s;
	s = s.replace(/\/+$/, '');
	return s || '/';
}

function historyDocId(mangaId: string): string {
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

let historyCache: ReadingEntry[] = [];
let ready = false;

if (browser) {
	(async () => {
		try {
			const old = localStorage.getItem('mikoroku_history');
			if (old) {
				try {
					const parsed = JSON.parse(old) as ReadingEntry[];
					if (Array.isArray(parsed) && parsed.length > 0) {
						const cleaned = parsed.map(lightEntry).slice(0, MAX_HISTORY);
						await idbSetAllHistory(cleaned);
					}
				} catch {
					// ignore
				}
				localStorage.removeItem('mikoroku_history');
			}

			historyCache = await idbGetHistory();
		} catch (e) {
			console.error('[history] failed to load from IndexedDB', e);
			historyCache = [];
		} finally {
			ready = true;
		}

		window.addEventListener('history-changed', async () => {
			historyCache = await idbGetHistory();
		});
	})();
}

function lightCover(url: string | undefined | null): string {
	if (!url) return '';
	let u = String(url).trim();
	if (!u) return '';
	if (u.startsWith('//')) u = 'https:' + u;

	if (
		/^https?:\/\/[^/]*wp-content/i.test(u) &&
		!/\.[a-z]{2,}\//i.test(u.split('/').slice(0, 3).join('/'))
	) {
		return '';
	}

	const keepQuery =
		/cvr\.voratoon\.id|X-Amz-Signature|X-Amz-Algorithm/i.test(u);

	try {
		const parsed = new URL(u);
		if (!parsed.hostname || !parsed.hostname.includes('.')) {
			return '';
		}
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

function lightEntry(entry: ReadingEntry): ReadingEntry {
	return {
		mangaId: normalizeMangaId(entry.mangaId) || entry.mangaId,
		mangaSlug: entry.mangaSlug || '',
		mangaTitle: (entry.mangaTitle || '').slice(0, 120),
		cover: lightCover(entry.cover),
		chapterId: entry.chapterId,
		chapterTitle: (entry.chapterTitle || '').slice(0, 80),
		chapterNumber: entry.chapterNumber,
		sourceId: entry.sourceId,
		timestamp: entry.timestamp
	};
}

export function getHistory(): ReadingEntry[] {
	return historyCache;
}

export function isHistoryReady(): boolean {
	return ready;
}

export async function saveReading(entry: Omit<ReadingEntry, 'timestamp'>) {
	if (!browser) return;

	const full = lightEntry({
		...entry,
		mangaId: normalizeMangaId(entry.mangaId) || entry.mangaId,
		timestamp: Date.now()
	});

	removeTombstone(full.mangaId);

	const key = normalizeMangaId(full.mangaId);
	const list = (await idbGetHistory()).filter(
		(h) => normalizeMangaId(h.mangaId) !== key
	);
	list.unshift(full);
	const trimmed = list.slice(0, MAX_HISTORY);
	await idbSetAllHistory(trimmed);

	historyCache = trimmed;
	window.dispatchEvent(new CustomEvent('history-changed'));

	const user = getUser();
	if (user && db) {
		try {
			await setDoc(
				doc(db, 'users', user.uid, 'history', historyDocId(full.mangaId)),
				full
			);
		} catch (e) {
			console.error('Failed to sync history to cloud', e);
		}
	}
}

export function getLastRead(mangaId: string): ReadingEntry | null {
	const n = normalizeMangaId(mangaId);
	return historyCache.find((h) => normalizeMangaId(h.mangaId) === n) || null;
}

export async function removeFromHistory(mangaId: string) {
	if (!browser) return;

	const n = normalizeMangaId(mangaId);
	addTombstone(n || mangaId);

	const list = await idbGetHistory();
	const next = list.filter((h) => normalizeMangaId(h.mangaId) !== n);
	await idbSetAllHistory(next);
	try {
		await idbDeleteHistory(mangaId);
		if (n && n !== mangaId) await idbDeleteHistory(n);
	} catch {
		// ignore
	}

	historyCache = next;
	window.dispatchEvent(new CustomEvent('history-changed'));

	const user = getUser();
	if (user && db) {
		try {
			await deleteDoc(doc(db, 'users', user.uid, 'history', historyDocId(n || mangaId)));
			if (mangaId !== n) {
				try {
					await deleteDoc(
						doc(
							db,
							'users',
							user.uid,
							'history',
							encodeURIComponent(String(mangaId || '')).replace(/%/g, '_')
						)
					);
				} catch {
					// ignore
				}
			}
		} catch (e) {
			console.error('Failed to remove history from cloud', e);
		}
	}
}

async function deleteCloudHistoryDocs(
	userId: string,
	mangaIds: string[]
): Promise<boolean> {
	if (!db || mangaIds.length === 0) return true;

	const uniqueIds = [
		...new Set(
			mangaIds
				.map((id) => normalizeMangaId(id))
				.filter(Boolean)
		)
	];

	try {
		for (let i = 0; i < uniqueIds.length; i += FIRESTORE_BATCH_LIMIT) {
			const chunk = uniqueIds.slice(i, i + FIRESTORE_BATCH_LIMIT);
			const batch = writeBatch(db);
			for (const id of chunk) {
				batch.delete(doc(db, 'users', userId, 'history', historyDocId(id)));
			}
			await batch.commit();
		}
		return true;
	} catch (e) {
		console.error('Failed to clear cloud history', e);
		return false;
	}
}

export async function clearHistory() {
	if (!browser) return;

	const list = await idbGetHistory();
	for (const h of list) addTombstone(h.mangaId);

	await idbClearHistory();
	historyCache = [];
	window.dispatchEvent(new CustomEvent('history-changed'));

	const user = getUser();
	if (user && db && list.length) {
		const ok = await deleteCloudHistoryDocs(
			user.uid,
			list.map((h) => h.mangaId)
		);
		
		if (ok) {
			writeTombstones(new Set());
		}
	} else if (!user) {
	
		writeTombstones(new Set());
	}
}

export async function syncHistoryOnLogin() {
	if (!browser || !db) return;

	const user = getUser();
	if (!user) return;

	const firestore = db;

	try {
		const local = await idbGetHistory();
		const snap = await getDocs(collection(firestore, 'users', user.uid, 'history'));
		const cloud: ReadingEntry[] = [];
		snap.forEach((d) => cloud.push(d.data() as ReadingEntry));

		const tombstones = readTombstones();

		const map = new Map<string, ReadingEntry>();
		for (const h of [...cloud, ...local]) {
			const light = lightEntry(h);
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
			.slice(0, MAX_HISTORY);

		await idbSetAllHistory(merged);
		historyCache = merged;
		window.dispatchEvent(new CustomEvent('history-changed'));

		const tombstoneList = [...tombstones];
		if (tombstoneList.length > 0) {
			await deleteCloudHistoryDocs(user.uid, tombstoneList);
		}

		const batch = writeBatch(firestore);
		merged.forEach((h) => {
			batch.set(doc(firestore, 'users', user.uid, 'history', historyDocId(h.mangaId)), h);
		});
		for (const id of tombstoneList) {
			batch.delete(doc(firestore, 'users', user.uid, 'history', historyDocId(id)));
		}
		await batch.commit();

		writeTombstones(new Set());
	} catch (e) {
		console.error('Failed to sync history on login', e);
		
	}
}
