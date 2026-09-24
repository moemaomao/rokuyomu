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

let historyCache: ReadingEntry[] = [];
let ready = false;

function historyDocId(mangaId: string): string {
	return encodeURIComponent(String(mangaId || '')).replace(/%/g, '_');
}

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

	// Reject clearly broken hosts (e.g. truncated "sakuranov.wp-content")
	if (/^https?:\/\/[^/]*wp-content/i.test(u) && !/\.[a-z]{2,}\//i.test(u.split('/').slice(0, 3).join('/'))) {
		return '';
	}

	const keepQuery =
		/cvr\.voratoon\.id|X-Amz-Signature|X-Amz-Algorithm/i.test(u);

	try {
		const parsed = new URL(u);
		// Must have a real hostname with a dot (not "sakuranov.wp-content" alone as path-like host)
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

	// Cover URLs can be long — do NOT truncate to 180 (that broke sakuranovel covers)
	const max = keepQuery ? 1200 : 800;
	return u.length > max ? u.slice(0, max) : u;
}

function lightEntry(entry: ReadingEntry): ReadingEntry {
	return {
		mangaId: entry.mangaId,
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
		timestamp: Date.now()
	});

	const list = (await idbGetHistory()).filter((h) => h.mangaId !== entry.mangaId);
	list.unshift(full);
	const trimmed = list.slice(0, MAX_HISTORY);
	await idbSetAllHistory(trimmed);

	historyCache = trimmed;
	window.dispatchEvent(new CustomEvent('history-changed'));

	const user = getUser();
	if (user && db) {
		try {
			await setDoc(
				doc(db, 'users', user.uid, 'history', historyDocId(entry.mangaId)),
				full
			);
		} catch (e) {
			console.error('Failed to sync history to cloud', e);
		}
	}
}

export function getLastRead(mangaId: string): ReadingEntry | null {
	return historyCache.find((h) => h.mangaId === mangaId) || null;
}

export async function removeFromHistory(mangaId: string) {
	if (!browser) return;

	await idbDeleteHistory(mangaId);

	historyCache = await idbGetHistory();
	window.dispatchEvent(new CustomEvent('history-changed'));

	const user = getUser();
	if (user && db) {
		try {
			await deleteDoc(
				doc(db, 'users', user.uid, 'history', historyDocId(mangaId))
			);
		} catch (e) {
			console.error('Failed to remove history from cloud', e);
		}
	}
}

export async function clearHistory() {
	if (!browser) return;

	await idbClearHistory();
	historyCache = [];
	window.dispatchEvent(new CustomEvent('history-changed'));
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

		const map = new Map<string, ReadingEntry>();
		[...cloud, ...local].forEach((h) => {
			const light = lightEntry(h);
			const existing = map.get(light.mangaId);
			if (!existing || light.timestamp > existing.timestamp) {
				map.set(light.mangaId, light);
			}
		});

		const merged = Array.from(map.values())
			.sort((a, b) => b.timestamp - a.timestamp)
			.slice(0, MAX_HISTORY);

		await idbSetAllHistory(merged);
		historyCache = merged;
		window.dispatchEvent(new CustomEvent('history-changed'));

		const batch = writeBatch(firestore);
		merged.forEach((h) => {
			batch.set(
				doc(firestore, 'users', user.uid, 'history', historyDocId(h.mangaId)),
				h
			);
		});
		await batch.commit();
	} catch (e) {
		console.error('Failed to sync history on login', e);
	}
}
