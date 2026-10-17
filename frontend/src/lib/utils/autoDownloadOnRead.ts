import { browser } from '$app/environment';
import { shouldAutoDownloadOnRead } from '$lib/stores/preferences';
import { downloadChapter } from '$lib/utils/downloadChapter';
import {
	hasOfflineMangaChapter,
	hasOfflineNovelChapter,
	saveOfflineNovelChapter
} from '$lib/utils/offlineChapter';
import { upsertLibraryEntry } from '$lib/stores/library.svelte';

const inFlight = new Set<string>();

function key(source: string, chapterId: string) {
	return `${source}::${chapterId}`;
}

export async function autoDownloadMangaChapter(opts: {
	source: string;
	chapterId: string;
	chapterTitle?: string;
	mangaTitle?: string;
	mangaId?: string;
	cover?: string;
	pageUrls?: string[];
}): Promise<void> {
	if (!browser || !shouldAutoDownloadOnRead()) return;
	const { source, chapterId } = opts;
	if (!source || !chapterId) return;

	const k = key(source, chapterId);
	if (inFlight.has(k)) return;
	inFlight.add(k);

	try {
		if (await hasOfflineMangaChapter(source, chapterId)) return;
		await downloadChapter({
			source,
			chapterId,
			chapterTitle: opts.chapterTitle,
			mangaTitle: opts.mangaTitle,
			mangaId: opts.mangaId,
			cover: opts.cover,
			pageUrls: opts.pageUrls,
			offlineOnly: true,
			onProgress: undefined
		});
	} catch (e) {
		console.warn('[auto-download manga]', source, chapterId, e);
	} finally {
		inFlight.delete(k);
	}
}

export async function autoDownloadNovelChapter(opts: {
	source: string;
	chapterId: string;
	chapterTitle?: string;
	novelTitle?: string;
	mangaId?: string;
	cover?: string;
	content: string;
}): Promise<void> {
	if (!browser || !shouldAutoDownloadOnRead()) return;
	const { source, chapterId, content } = opts;
	if (!source || !chapterId || !String(content || '').trim()) return;

	const k = key(source, chapterId);
	if (inFlight.has(k)) return;
	inFlight.add(k);

	try {
		if (await hasOfflineNovelChapter(source, chapterId)) return;

		const mangaId = opts.mangaId || chapterId;
		const novelTitle = opts.novelTitle || 'Novel';
		const chapterTitle = opts.chapterTitle || 'Chapter';

		await saveOfflineNovelChapter({
			sourceId: source,
			mangaId,
			chapterId,
			novelTitle,
			chapterTitle,
			content: String(content)
		});

		try {
			await upsertLibraryEntry({
				mangaId,
				mangaTitle: novelTitle,
				cover: opts.cover || '',
				sourceId: source,
				type: 'novel',
				chapters: [
					{
						chapterId,
						chapterTitle
					}
				]
			} as any);
		} catch {
		}
	} catch (e) {
		console.warn('[auto-download novel]', source, chapterId, e);
	} finally {
		inFlight.delete(k);
	}
}
