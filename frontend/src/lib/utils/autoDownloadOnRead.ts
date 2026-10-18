import { browser } from '$app/environment';
import {
	shouldAutoDownloadOnRead,
	prefersDiskDownload,
	getNovelDownloadFormat
} from '$lib/stores/preferences';
import { downloadChapter } from '$lib/utils/downloadManga';
import {
	hasOfflineMangaChapter,
	hasOfflineNovelChapter,
	saveOfflineNovelChapter
} from '$lib/utils/offlineChapter';
import { upsertLibraryEntry } from '$lib/stores/download.svelte';
import {
	ensureLibraryRoot,
	saveNovelPdfToDisk,
	sanitizePathSegment,
	supportsFileSystemAccess
} from '$lib/utils/localFs';

function htmlToPlain(raw: string): string {
	let s = String(raw || '');
	s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
	s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
	s = s.replace(/<br\s*\/?>/gi, '\n');
	s = s.replace(/<\/p>/gi, '\n\n');
	s = s.replace(/<\/div>/gi, '\n');
	s = s.replace(/<\/h[1-6]>/gi, '\n\n');
	s = s.replace(/<[^>]+>/g, '');
	s = s
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'");
	return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const inFlight = new Set<string>();

function key(source: string, chapterId: string) {
	return `${source}::${chapterId}`;
}

function shortChapterFilename(chapterTitle: string, chapterId?: string): string {
	const t = String(chapterTitle || '').trim();
	const m =
		t.match(/\b(?:chapter|ch\.?|bab|episode|ep\.?)\s*[-_.]?\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
	if (m) return `Chapter ${m[1]}`;
	const id = String(chapterId || '');
	const fromId =
		id.match(/(?:chapter|ch|bab|ep)[-_]?(\d+(?:\.\d+)?)/i) ||
		id.match(/[-_](\d+(?:\.\d+)?)(?:p\d+)?\/?$/i);
	if (fromId) return `Chapter ${fromId[1]}`;
	const any = t.match(/(\d+(?:\.\d+)?)/);
	if (any) return `Chapter ${any[1]}`;
	return 'Chapter';
}

async function getSilentLibraryRoot() {
	if (!prefersDiskDownload() || !supportsFileSystemAccess()) return null;
	try {
		return await ensureLibraryRoot();
	} catch {
		return null;
	}
}

export async function autoDownloadMangaChapter(opts: {
	source: string;
	chapterId: string;
	chapterTitle?: string;
	mangaTitle?: string;
	mangaId?: string;
	synopsis?: string;
	genres?: string[];
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
			synopsis: opts.synopsis,
			genres: opts.genres,
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
		const mangaId = opts.mangaId || chapterId;
		const novelTitle = opts.novelTitle || 'Novel';
		const chapterTitle = opts.chapterTitle || 'Chapter';
		const plain = String(content);
		const alreadyOffline = await hasOfflineNovelChapter(source, chapterId);

		if (!alreadyOffline) {
			await saveOfflineNovelChapter({
				sourceId: source,
				mangaId,
				chapterId,
				novelTitle,
				chapterTitle,
				content: plain
			});
		}

		try {
			await upsertLibraryEntry({
				mangaId,
				mangaTitle: novelTitle,
				cover: opts.cover || '',
				sourceId: source,
				isNovel: true,
				chapters: [{ chapterId, chapterTitle, savedAt: Date.now() }]
			});
		} catch {
			/* ignore */
		}

		const root = await getSilentLibraryRoot();
		if (!root) return;

		try {
			const format = getNovelDownloadFormat();
			const chapterFileLabel = shortChapterFilename(chapterTitle, chapterId);
			const body = htmlToPlain(plain) || plain;
			let fileBlob: Blob;
			if (format === 'epub') {
				const { buildSimpleEpubForAuto } = await import('$lib/utils/downloadNovel');
				fileBlob = await buildSimpleEpubForAuto({ novelTitle, chapterTitle, body });
			} else {
				const { buildSimplePdfForAuto } = await import('$lib/utils/downloadNovel');
				const heading = [novelTitle, chapterTitle].filter(Boolean).join(' — ');
				fileBlob = buildSimplePdfForAuto(heading, body);
			}
			const path = await saveNovelPdfToDisk({
				root,
				novelTitle: sanitizePathSegment(novelTitle),
				chapterTitle: chapterFileLabel,
				pdfBlob: fileBlob,
				ext: format,
				contentText: plain,
				meta: {
					source,
					mangaId,
					novelTitle,
					chapterId,
					chapterTitle,
					savedAt: Date.now(),
					isNovel: true,
					format,
					auto: true
				}
			});
			try {
				await upsertLibraryEntry({
					mangaId,
					mangaTitle: novelTitle,
					cover: opts.cover || '',
					sourceId: source,
					isNovel: true,
					localPath: path || undefined,
					chapters: [{ chapterId, chapterTitle, savedAt: Date.now() }]
				});
			} catch {
				/* ignore */
			}
		} catch (e) {
			console.warn('[auto-download novel] disk save failed', e);
		}
	} catch (e) {
		console.warn('[auto-download novel]', source, chapterId, e);
	} finally {
		inFlight.delete(k);
	}
}
