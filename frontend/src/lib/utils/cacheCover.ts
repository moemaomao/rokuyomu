import {
	supportsFileSystemAccess,
	getLibraryRoot,
	saveCoverToDisk,
	saveBookmarkCoverToDisk,
	saveHistoryCoverToDisk,
	readCoverFromDisk
} from '$lib/utils/localFs';
import { idbPutLibraryCover, idbGetLibraryCover } from '$lib/db';
import { normalizeMangaId } from '$lib/stores/bookmark.svelte';

function libKey(mangaId: string, sourceId: string): string {
	return `${sourceId}::${normalizeMangaId(mangaId)}`;
}

function bmCoverKey(mangaId: string, sourceId: string): string {
	return `bm::${libKey(mangaId, sourceId)}`;
}

async function fetchCoverBlob(
	coverUrl: string,
	source: string
): Promise<Blob | null> {
	if (!coverUrl) return null;
	try {
		const proxy = `/api/proxy?url=${encodeURIComponent(coverUrl)}&source=${encodeURIComponent(source)}`;
		const res = await fetch(proxy);
		if (!res.ok) return null;
		const blob = await res.blob();
		if (!blob.size) return null;
		return blob;
	} catch (e) {
		console.warn('[cacheCover] fetch failed', e);
		return null;
	}
}

export async function cacheLibraryCover(opts: {
	mangaId: string;
	sourceId: string;
	coverUrl: string;
	title: string;
	isNovel: boolean;
}): Promise<void> {
	const { mangaId, sourceId, coverUrl, title, isNovel } = opts;
	if (!coverUrl || !mangaId || !sourceId) return;

	const blob = await fetchCoverBlob(coverUrl, sourceId);
	if (!blob) return;

	const key = libKey(mangaId, sourceId);

	try {
		await idbPutLibraryCover(key, blob);
	} catch (e) {
		console.warn('[cacheCover] IDB put failed', e);
	}

	if (supportsFileSystemAccess()) {
		try {
			const root = await getLibraryRoot();
			if (root) {
				await saveCoverToDisk({
					root,
					kind: isNovel ? 'Novel' : 'Manga',
					title: title || 'Title',
					coverBlob: blob
				});
			}
		} catch (e) {
			console.warn('[cacheCover] disk save failed', e);
		}
	}
}

export async function cacheBookmarkCover(opts: {
	mangaId: string;
	sourceId: string;
	coverUrl: string;
}): Promise<void> {
	const { mangaId, sourceId, coverUrl } = opts;
	if (!coverUrl || !mangaId || !sourceId) return;

	const blob = await fetchCoverBlob(coverUrl, sourceId);
	if (!blob) return;

	const key = bmCoverKey(mangaId, sourceId);

	try {
		await idbPutLibraryCover(key, blob);
	} catch (e) {
		console.warn('[cacheCover] bookmark IDB put failed', e);
	}

	if (supportsFileSystemAccess()) {
		try {
			const root = await getLibraryRoot();
			if (root) {
				await saveBookmarkCoverToDisk({
					root,
					sourceId,
					mangaId,
					coverBlob: blob
				});
			}
		} catch (e) {
			console.warn('[cacheCover] bookmark disk save failed', e);
		}
	}
}

function histCoverKey(mangaId: string, sourceId: string): string {
	return `hist::${libKey(mangaId, sourceId)}`;
}

export async function cacheHistoryCover(opts: {
	mangaId: string;
	sourceId: string;
	coverUrl: string;
}): Promise<void> {
	const { mangaId, sourceId, coverUrl } = opts;
	if (!coverUrl || !mangaId || !sourceId) return;

	const blob = await fetchCoverBlob(coverUrl, sourceId);
	if (!blob) return;

	const key = histCoverKey(mangaId, sourceId);

	try {
		await idbPutLibraryCover(key, blob);
	} catch (e) {
		console.warn('[cacheCover] history IDB put failed', e);
	}

	if (supportsFileSystemAccess()) {
		try {
			const root = await getLibraryRoot();
			if (root) {
				await saveHistoryCoverToDisk({
					root,
					sourceId,
					mangaId,
					coverBlob: blob
				});
			}
		} catch (e) {
			console.warn('[cacheCover] history disk save failed', e);
		}
	}
}

export async function getOfflineHistoryCoverObjectUrl(
	mangaId: string,
	sourceId: string
): Promise<string | null> {
	try {
		const { idbGetLibraryCover } = await import('$lib/db');
		let blob = await idbGetLibraryCover(histCoverKey(mangaId, sourceId));
		if (!blob) blob = await idbGetLibraryCover(libKey(mangaId, sourceId));
		if (!blob) return null;
		return URL.createObjectURL(blob);
	} catch {
		return null;
	}
}

export async function getOfflineCoverObjectUrl(
	mangaId: string,
	sourceId: string,
	opts?: { title?: string; isNovel?: boolean }
): Promise<string | null> {
	const key = libKey(mangaId, sourceId);
	try {
		const blob = await idbGetLibraryCover(key);
		if (blob) return URL.createObjectURL(blob);
	} catch {
		/* fall through */
	}

	if (opts?.title && supportsFileSystemAccess()) {
		try {
			const root = await getLibraryRoot();
			if (root) {
				const file = await readCoverFromDisk({
					root,
					kind: opts.isNovel ? 'Novel' : 'Manga',
					title: opts.title
				});
				if (file && file.size) {
					const blob = file.slice(0, file.size, file.type || 'image/jpeg');
					try {
						await idbPutLibraryCover(key, blob);
					} catch {
						/* ignore */
					}
					return URL.createObjectURL(blob);
				}
			}
		} catch {
			/* ignore */
		}
	}
	return null;
}

export async function getOfflineBookmarkCoverObjectUrl(
	mangaId: string,
	sourceId: string
): Promise<string | null> {
	try {
		let blob = await idbGetLibraryCover(bmCoverKey(mangaId, sourceId));
		if (!blob) blob = await idbGetLibraryCover(libKey(mangaId, sourceId));
		if (!blob) return null;
		return URL.createObjectURL(blob);
	} catch {
		return null;
	}
}
