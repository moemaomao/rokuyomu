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

function plainChapter(c: LibraryChapterRef | Record<string, unknown>): LibraryChapterRef {
	const o = c as LibraryChapterRef;
	return {
		chapterId: String(o.chapterId ?? ''),
		chapterTitle: String(o.chapterTitle ?? ''),
		savedAt: Number(o.savedAt) || Date.now(),
		pageCount: typeof o.pageCount === 'number' ? o.pageCount : undefined
	};
}

function plainEntry(e: LibraryEntry): LibraryEntry {
	return {
		key: String(e.key),
		mangaId: String(e.mangaId ?? ''),
		mangaTitle: String(e.mangaTitle ?? '').slice(0, 160),
		cover: String(e.cover ?? ''),
		sourceId: String(e.sourceId ?? ''),
		isNovel: !!e.isNovel,
		localPath: String(e.localPath ?? ''),
		chapters: (e.chapters || []).map(plainChapter),
		latestChapter:
			e.latestChapter != null && String(e.latestChapter) !== ''
				? String(e.latestChapter)
				: undefined,
		lang: e.lang != null && String(e.lang) !== '' ? String(e.lang) : undefined,
		timestamp: Number(e.timestamp) || Date.now()
	};
}

async function reloadFromIdb() {
	const list = await idbGetLibrary();
	entries = list.map(plainEntry);
	return entries;
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
	let entry = entries.find((e) => e.key === key);
	if (!entry) {
		const norm = normalizeMangaId(mangaId);
		entry = entries.find(
			(e) =>
				e.sourceId === sourceId &&
				(normalizeMangaId(e.mangaId) === norm || e.mangaId === mangaId)
		);
	}
	if (!entry?.chapters?.length) return new Set();
	const set = new Set<string>();
	for (const c of entry.chapters) {
		const id = String(c.chapterId || '');
		if (!id) continue;
		set.add(id);
		set.add(id.startsWith('/') ? id.slice(1) : `/${id}`);
		const seg = id.split('/').filter(Boolean).pop();
		if (seg) set.add(seg);
	}
	return set;
}

export function isChapterInLibrary(
	sourceId: string,
	mangaId: string,
	chapterId: string
): boolean {
	const n = String(chapterId || '');
	if (!n) return false;
	const set = getOfflineChapterIds(sourceId, mangaId);
	if (set.has(n)) return true;
	const alt = n.startsWith('/') ? n.slice(1) : `/${n}`;
	if (set.has(alt)) return true;
	const seg = n.split('/').filter(Boolean).pop();
	return !!(seg && set.has(seg));
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
	const chapters = (existing.chapters || [])
		.filter((c) => c.chapterId !== n && c.chapterId !== alt)
		.map(plainChapter);
	const next = plainEntry({ ...existing, chapters, timestamp: Date.now() });
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
	latestChapter?: string;
	lang?: string;
}): Promise<void> {
	if (!browser) return;
	const key = libKey(partial.mangaId, partial.sourceId);
	const existing = entries.find((e) => e.key === key);
	const chapterMap = new Map<string, LibraryChapterRef>();
	for (const c of existing?.chapters || []) {
		const pc = plainChapter(c);
		if (pc.chapterId) chapterMap.set(pc.chapterId, pc);
	}
	for (const c of partial.chapters || []) {
		const pc = plainChapter(c);
		if (pc.chapterId) chapterMap.set(pc.chapterId, pc);
	}
	const next = plainEntry({
		key,
		mangaId: normalizeMangaId(partial.mangaId) || partial.mangaId,
		mangaTitle: (partial.mangaTitle || '').slice(0, 160),
		cover: partial.cover || existing?.cover || '',
		sourceId: partial.sourceId,
		isNovel: partial.isNovel,
		localPath: partial.localPath || existing?.localPath || '',
		chapters: Array.from(chapterMap.values()).sort((a, b) => b.savedAt - a.savedAt),
		latestChapter:
			partial.latestChapter || existing?.latestChapter || undefined,
		lang: partial.lang || existing?.lang || undefined,
		timestamp: Date.now()
	});
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
	const map = new Map(entries.map((e) => [e.key, plainEntry(e)]));
	for (const b of bms) {
		const key = libKey(b.mangaId, b.sourceId);
		if (!map.has(key)) {
			const entry = plainEntry({
				key,
				mangaId: normalizeMangaId(b.mangaId) || b.mangaId,
				mangaTitle: b.mangaTitle,
				cover: b.cover || '',
				sourceId: b.sourceId,
				isNovel: isNovelSource(b.sourceId),
				localPath: '',
				chapters: [],
				timestamp: Date.now()
			});
			map.set(key, entry);
			added++;
		}
	}
	const list = Array.from(map.values())
		.map(plainEntry)
		.sort((a, b) => b.timestamp - a.timestamp);
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
