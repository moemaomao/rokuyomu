import {
	supportsFileSystemAccess,
	ensureLibraryRoot,
	saveCoverToDisk
} from '$lib/utils/localFs';
import { idbPutLibraryCover } from '$lib/db';
import { normalizeMangaId } from '$lib/stores/bookmark.svelte';

function libKey(mangaId: string, sourceId: string): string {
	return `${sourceId}::${normalizeMangaId(mangaId)}`;
}

async function fetchCoverBlob(coverUrl: string, source: string): Promise<Blob | null> {
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
			const root = await ensureLibraryRoot();
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

export async function getOfflineCoverObjectUrl(
	mangaId: string,
	sourceId: string
): Promise<string | null> {
	try {
		const { idbGetLibraryCover } = await import('$lib/db');
		const blob = await idbGetLibraryCover(libKey(mangaId, sourceId));
		if (!blob) return null;
		return URL.createObjectURL(blob);
	} catch {
		return null;
	}
}
