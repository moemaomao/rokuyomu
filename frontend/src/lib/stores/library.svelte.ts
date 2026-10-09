import { browser } from '$app/environment';
import {
	idbGetLibrary,
	idbPutLibraryEntry,
	idbDeleteLibraryEntry,
	idbClearLibrary,
	idbSetAllLibrary,
	type LibraryEntry,
	type LibraryChapterRef
} from '$lib/db';
import { getBookmarks } from '$lib/stores/bookmark.svelte';
import { normalizeMangaId } from '$lib/stores/bookmark.svelte';
import { getLibraryRoot, supportsFileSystemAccess, pickLibraryRoot } from '$lib/utils/localFs';
import { isNovelSource } from '$lib/utils/novelSources';

export type { LibraryEntry, LibraryChapterRef };

let entries = $state<LibraryEntry[]>([]);
let ready = $state(false);
let hasRoot = $state(false);
let loadError = $state<string | null>(null);

function libKey(mangaId: string, sourceId: string): string {
	return `${sourceId}::${normalizeMangaId(mangaId)}`;
}

async function reloadFromIdb() {
	const list = await idbGetLibrary();
	entries = list;
	return list;
}

if (browser) {
	(async () => {
		try {
			await reloadFromIdb();
			const root = await getLibraryRoot().catch(() => null);
			hasRoot = !!root || supportsFileSystemAccess();
			loadError = null;
		} catch (e: any) {
			console.error('[library] load failed', e);
			entries = [];
			loadError = e?.message || 'Failed to load library';
		} finally {
			ready = true;
			window.dispatchEvent(new CustomEvent('library-changed'));
		}
		window.addEventListener('library-changed', async () => {
			try {
				await reloadFromIdb();
			} catch (e) {
				console.warn('[library] refresh failed', e);
			}
		});
	})();
}

export function getLibrary(): LibraryEntry[] {
	return entries;
}

export function getOfflineChapterIds(sourceId: string, mangaId: string): Set<string> {
	const key = libKey(mangaId, sourceId);
	const entry = entries.find((e) => e.key === key);
	if (!entry?.chapters?.length) return new Set();
	return new Set(entry.chapters.map((c) => String(c.chapterId)));
}

export function isChapterInLibrary(
	sourceId: string,
	mangaId: string,
	chapterId: string
): boolean {
	const n = String(chapterId || '');
	const set = getOfflineChapterIds(sourceId, mangaId);
	if (set.has(n)) return true;
	const alt = n.startsWith('/') ? n.slice(1) : `/${n}`;
	return set.has(alt);
}

export async function removeChapterFromLibrary(
	sourceId: string,
	mangaId: string,
	chapterId: string
): Promise<void> {
	if (!browser) return;
	const key = libKey(mangaId, sourceId);
	const existing = entries.find((e) => e.key === key);
	if (!existing) return;
	const n = String(chapterId || '');
	const alt = n.startsWith('/') ? n.slice(1) : `/${n}`;
	const chapters = (existing.chapters || []).filter(
		(c) => c.chapterId !== n && c.chapterId !== alt
	);
	const next = { ...existing, chapters, timestamp: Date.now() };
	await idbPutLibraryEntry(next);
	await reloadFromIdb();
	window.dispatchEvent(new CustomEvent('library-changed'));
}

export function isLibraryReady(): boolean {
	return ready;
}

export function getLibraryLoadError(): string | null {
	return loadError;
}

export function librarySupportsDisk(): boolean {
	return supportsFileSystemAccess();
}

export async function chooseLibraryFolder(): Promise<boolean> {
	try {
		const h = await pickLibraryRoot();
		hasRoot = !!h;
		return !!h;
	} catch (e) {
		console.warn('[library] chooseLibraryFolder', e);
		return false;
	}
}

export async function upsertLibraryEntry(partial: {
	mangaId: string;
	mangaTitle: string;
	cover: string;
	sourceId: string;
	isNovel: boolean;
	localPath?: string;
	chapters?: LibraryChapterRef[];
}): Promise<void> {
	if (!browser) return;
	const key = libKey(partial.mangaId, partial.sourceId);
	const existing = entries.find((e) => e.key === key);
	const chapterMap = new Map<string, LibraryChapterRef>();
	for (const c of existing?.chapters || []) {
		chapterMap.set(c.chapterId, c);
	}
	for (const c of partial.chapters || []) {
		chapterMap.set(c.chapterId, c);
	}
	const next: LibraryEntry = {
		key,
		mangaId: normalizeMangaId(partial.mangaId) || partial.mangaId,
		mangaTitle: (partial.mangaTitle || '').slice(0, 160),
		cover: partial.cover || existing?.cover || '',
		sourceId: partial.sourceId,
		isNovel: partial.isNovel,
		localPath: partial.localPath || existing?.localPath || '',
		chapters: Array.from(chapterMap.values()).sort((a, b) => b.savedAt - a.savedAt),
		timestamp: Date.now()
	};
	await idbPutLibraryEntry(next);
	await reloadFromIdb();
	window.dispatchEvent(new CustomEvent('library-changed'));
}

export async function removeLibraryEntry(mangaId: string, sourceId: string) {
	if (!browser) return;
	const key = libKey(mangaId, sourceId);
	await idbDeleteLibraryEntry(key);
	await reloadFromIdb();
	window.dispatchEvent(new CustomEvent('library-changed'));
}

export async function clearLibrary() {
	if (!browser) return;
	await idbClearLibrary();
	entries = [];
	window.dispatchEvent(new CustomEvent('library-changed'));
}

export async function syncLibraryFromBookmarks(): Promise<number> {
	if (!browser) return 0;
	const bms = getBookmarks();
	let added = 0;
	const map = new Map(entries.map((e) => [e.key, e]));
	for (const b of bms) {
		const key = libKey(b.mangaId, b.sourceId);
		if (!map.has(key)) {
			const entry: LibraryEntry = {
				key,
				mangaId: normalizeMangaId(b.mangaId) || b.mangaId,
				mangaTitle: b.mangaTitle,
				cover: b.cover || '',
				sourceId: b.sourceId,
				isNovel: isNovelSource(b.sourceId),
				localPath: '',
				chapters: [],
				timestamp: Date.now()
			};
			map.set(key, entry);
			added++;
		}
	}
	const list = Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
	await idbSetAllLibrary(list);
	entries = list;
	window.dispatchEvent(new CustomEvent('library-changed'));
	return added;
}

export async function ensureLibraryLoaded(): Promise<LibraryEntry[]> {
	if (!browser) return [];
	try {
		const list = await reloadFromIdb();
		ready = true;
		return list;
	} catch (e: any) {
		loadError = e?.message || 'load failed';
		return entries;
	}
}
