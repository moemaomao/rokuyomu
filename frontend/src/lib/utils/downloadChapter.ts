import {
	supportsFileSystemAccess,
	ensureLibraryRoot,
	requestStoredLibraryRoot,
	pickLibraryRoot,
	saveMangaChapterToDisk,
	sanitizePathSegment,
	getLibraryRoot,
	readMangaChapterFromDisk
} from '$lib/utils/localFs';
import { upsertLibraryEntry } from '$lib/stores/library.svelte';
import { cacheLibraryCover } from '$lib/utils/cacheCover';
import {
	saveOfflineMangaChapter,
	getOfflineMangaChapter
} from '$lib/utils/offlineChapter';

export type DownloadProgress = {
	phase: 'pages' | 'images' | 'zip' | 'disk' | 'fetch' | 'pdf' | 'done' | 'error';
	current: number;
	total: number;
	message?: string;
};

type ProgressCb = (p: DownloadProgress) => void;

export type PageBlob = { blob: Blob; ext: string };

function sanitizeFilename(name: string): string {
	return (
		String(name || 'chapter')
			.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 120) || 'chapter'
	);
}

function pad(n: number, width = 3): string {
	return String(n).padStart(width, '0');
}

function proxyFilename(url: string): string {
	let filename = 'image.jpg';
	try {
		const path = new URL(url).pathname;
		const last = path.split('/').pop() || '';
		if (last) filename = decodeURIComponent(last);
	} catch {
	}
	filename = filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'image.jpg';
	if (!/\.[a-zA-Z0-9]{2,5}$/.test(filename)) filename += '.jpg';
	return filename;
}

function normalizeRemoteUrl(url: string): string {
	let u = String(url || '').trim();
	if (!u) return '';
	if (u.startsWith('//')) u = 'https:' + u;
	return u;
}

function proxyUrl(url: string, source: string, withFilename = true): string {
	if (!url) return '';
	let u = normalizeRemoteUrl(url);
	if (u.startsWith('/api/proxy') || /\/api\/proxy\?/i.test(u)) return u;
	const base = `/api/proxy?url=${encodeURIComponent(u)}&source=${encodeURIComponent(source)}`;
	if (!withFilename) return base;
	return `${base}&filename=${encodeURIComponent(proxyFilename(u))}`;
}

async function fetchAllPageUrls(source: string, chapterId: string): Promise<string[]> {
	const all: string[] = [];
	let start = 0;
	const count = 40;
	let total = Infinity;

	while (start < total) {
		const params = new URLSearchParams({
			source,
			chapterId,
			start: String(start),
			count: String(count)
		});
		let res = await fetch(`/api/pages?${params}`, { cache: 'force-cache' });
		if (!res.ok) res = await fetch(`/api/pages?${params}`);
		if (!res.ok) throw new Error(`pages ${res.status}`);
		const json = (await res.json()) as {
			pages?: string[];
			total?: number;
			hasMore?: boolean;
		};
		const batch = Array.isArray(json.pages) ? json.pages : [];
		if (typeof json.total === 'number') total = json.total;
		all.push(...batch);
		if (!json.hasMore || batch.length === 0) break;
		start += batch.length;
	}

	return all;
}

function extFromBlob(blob: Blob, url: string): string {
	const ct = (blob.type || '').toLowerCase();
	if (ct.includes('png')) return 'png';
	if (ct.includes('webp')) return 'webp';
	if (ct.includes('gif')) return 'gif';
	if (ct.includes('avif')) return 'avif';
	if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
	const m = url.match(/\.(jpe?g|png|webp|gif|avif)(?:\?|$)/i);
	if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
	return 'jpg';
}

async function fetchImageBlob(url: string, source: string): Promise<PageBlob> {
	const candidates = [
		proxyUrl(url, source, true),
		proxyUrl(url, source, false)
	].filter(Boolean);

	const seen = new Set<string>();
	const list = candidates.filter((u) => {
		if (seen.has(u)) return false;
		seen.add(u);
		return true;
	});

	let lastErr: unknown;
	for (const proxy of list) {
		try {
			let res = await fetch(proxy, { cache: 'force-cache' });
			if (!res.ok) {
				res = await fetch(proxy, { cache: 'default' });
			}
			if (!res.ok) {
				lastErr = new Error(`image ${res.status}`);
				continue;
			}
			const blob = await res.blob();
			if (!blob.size) {
				lastErr = new Error('empty image');
				continue;
			}
			return { blob, ext: extFromBlob(blob, url) };
		} catch (e) {
			lastErr = e;
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error('image fetch failed');
}

export async function blobsFromReaderImages(
	selector = '#reader img'
): Promise<(PageBlob | null)[]> {
	if (typeof document === 'undefined') return [];
	const imgs = Array.from(document.querySelectorAll(selector)) as HTMLImageElement[];
	const out: (PageBlob | null)[] = [];

	for (const img of imgs) {
		const src = img.currentSrc || img.src;
		if (!src || !img.complete || img.naturalWidth === 0) {
			out.push(null);
			continue;
		}
		try {
			const res = await fetch(src, { cache: 'force-cache' });
			if (!res.ok) {
				out.push(null);
				continue;
			}
			const blob = await res.blob();
			if (!blob.size) {
				out.push(null);
				continue;
			}
			out.push({ blob, ext: extFromBlob(blob, src) });
		} catch {
			out.push(null);
		}
	}
	return out;
}

async function mapPool<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T, index: number) => Promise<R>,
	onItem?: (done: number, total: number) => void
): Promise<(R | null)[]> {
	const results: (R | null)[] = new Array(items.length).fill(null);
	let next = 0;
	let done = 0;

	async function worker() {
		while (true) {
			const i = next++;
			if (i >= items.length) break;
			try {
				results[i] = await fn(items[i], i);
			} catch (e) {
				console.warn('[download] item failed', i + 1, e);
				results[i] = null;
			}
			done++;
			onItem?.(done, items.length);
		}
	}

	const n = Math.min(concurrency, Math.max(1, items.length));
	await Promise.all(Array.from({ length: n }, () => worker()));
	return results;
}

function triggerDownload(blob: Blob, filename: string) {
	const a = document.createElement('a');
	const href = URL.createObjectURL(blob);
	a.href = href;
	a.download = filename;
	a.rel = 'noopener';
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(href), 4000);
}

async function tryLoadJSZip(): Promise<any | null> {
	try {
		const mod = await import('jszip');
		return (mod as any).default || mod;
	} catch {
		/* continue */
	}
	const g = globalThis as any;
	if (g.JSZip) return g.JSZip;
	await new Promise<void>((resolve, reject) => {
		const s = document.createElement('script');
		s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
		s.onload = () => resolve();
		s.onerror = () => reject(new Error('JSZip load failed'));
		document.head.appendChild(s);
	});
	return g.JSZip || null;
}

export async function downloadChapter(opts: {
	source: string;
	chapterId: string;
	chapterTitle?: string;
	mangaTitle?: string;
	mangaId?: string;
	cover?: string;
	pageUrls?: string[];
	pageBlobs?: (PageBlob | null)[];
	useReaderDom?: boolean;
	concurrency?: number;
	forceZip?: boolean;
	offlineOnly?: boolean;
	onProgress?: ProgressCb;
}): Promise<void> {
	const {
		source,
		chapterId,
		mangaTitle,
		mangaId,
		cover,
		pageUrls,
		forceZip = false,
		offlineOnly = false,
		onProgress
	} = opts;
	const concurrency = Math.max(1, Math.min(opts.concurrency ?? 6, 12));
	const report = (p: DownloadProgress) => onProgress?.(p);

	const chapterTitle = opts.chapterTitle || 'Chapter';
	const titleSafe = sanitizeFilename(chapterTitle);
	const baseName = sanitizeFilename(
		[mangaTitle, chapterTitle].filter(Boolean).join(' - ') || 'chapter'
	);

	report({ phase: 'pages', current: 0, total: 1, message: 'Loading pages…' });

	// Already offline (IDB) — mark library + done, do not re-fetch network
	try {
		const existing = await getOfflineMangaChapter(source, String(chapterId));
		if (existing?.pages?.length) {
			report({
				phase: 'done',
				current: existing.pages.length,
				total: existing.pages.length,
				message: 'Already offline'
			});
			try {
				await upsertLibraryEntry({
					mangaId: mangaId || chapterId,
					mangaTitle: mangaTitle || existing.mangaTitle || 'Manga',
					cover: cover || '',
					sourceId: source,
					isNovel: false,
					chapters: [
						{
							chapterId: String(chapterId),
							chapterTitle: existing.chapterTitle || chapterTitle,
							savedAt: Date.now(),
							pageCount: existing.pages.length
						}
					]
				});
			} catch {
				/* ignore */
			}
			return;
		}
	} catch (e) {
		console.warn('[download] offline check', e);
	}

	// Already on disk — hydrate IDB + library, skip network
	if (supportsFileSystemAccess() && (mangaTitle || chapterTitle)) {
		try {
			const root = await getLibraryRoot();
			if (root) {
				const fromDisk = await readMangaChapterFromDisk({
					root,
					sourceId: source,
					chapterId: String(chapterId),
					mangaTitle: mangaTitle || undefined,
					chapterTitle: chapterTitle || undefined,
					maxPages: 200
				});
				if (fromDisk?.pages?.length) {
					report({
						phase: 'disk',
						current: fromDisk.pages.length,
						total: fromDisk.pages.length,
						message: 'Found on disk…'
					});
					try {
						await saveOfflineMangaChapter({
							sourceId: source,
							mangaId: mangaId || chapterId,
							chapterId: String(chapterId),
							mangaTitle: fromDisk.mangaTitle || mangaTitle || 'Manga',
							chapterTitle: fromDisk.chapterTitle || chapterTitle,
							pages: fromDisk.pages
						});
					} catch (e) {
						console.warn('[download] hydrate IDB from disk', e);
					}
					try {
						await upsertLibraryEntry({
							mangaId: mangaId || chapterId,
							mangaTitle: fromDisk.mangaTitle || mangaTitle || 'Manga',
							cover: cover || '',
							sourceId: source,
							isNovel: false,
							chapters: [
								{
									chapterId: String(chapterId),
									chapterTitle: fromDisk.chapterTitle || chapterTitle,
									savedAt: Date.now(),
									pageCount: fromDisk.pages.length
								}
							]
						});
					} catch {
						/* ignore */
					}
					report({
						phase: 'done',
						current: fromDisk.pages.length,
						total: fromDisk.pages.length,
						message: 'Loaded from disk'
					});
					return;
				}
			}
		} catch (e) {
			console.warn('[download] disk check', e);
		}
	}

	let urls: string[] =
		Array.isArray(pageUrls) && pageUrls.length > 0
			? pageUrls.filter(Boolean)
			: await fetchAllPageUrls(source, chapterId);

	if (!urls.length && !(opts.pageBlobs && opts.pageBlobs.some(Boolean))) {
		throw new Error('No pages found');
	}

	let prefetched: (PageBlob | null)[] = Array.isArray(opts.pageBlobs)
		? [...opts.pageBlobs]
		: [];

	if (opts.useReaderDom) {
		const fromDom = await blobsFromReaderImages('#reader img');
		if (fromDom.length) {
			const n = Math.max(urls.length, fromDom.length);
			const merged: (PageBlob | null)[] = new Array(n).fill(null);
			for (let i = 0; i < n; i++) {
				merged[i] = fromDom[i] || prefetched[i] || null;
			}
			prefetched = merged;
			if (!urls.length) {
				urls = fromDom.map((_, i) => `page-${i + 1}`);
			}
		}
	}

	const total = Math.max(urls.length, prefetched.length);
	if (!total) throw new Error('No pages found');

	report({
		phase: 'images',
		current: 0,
		total,
		message: `Downloading 0/${total}`
	});

	const results = await mapPool(
		Array.from({ length: total }, (_, i) => i),
		concurrency,
		async (i) => {
			if (prefetched[i]?.blob?.size) {
				return prefetched[i] as PageBlob;
			}
			const url = urls[i];
			if (!url || url.startsWith('page-')) {
				throw new Error(`missing page ${i + 1}`);
			}
			return fetchImageBlob(url, source);
		},
		(done, t) => {
			report({
				phase: 'images',
				current: done,
				total: t,
				message: `Downloading ${done}/${t}`
			});
		}
	);

	const pages: PageBlob[] = [];
	for (const item of results) {
		if (item?.blob?.size) pages.push(item);
	}
	if (!pages.length) throw new Error('No images downloaded');

	try {
		await saveOfflineMangaChapter({
			sourceId: source,
			mangaId: mangaId || chapterId,
			chapterId: String(chapterId),
			mangaTitle: mangaTitle || 'Manga',
			chapterTitle,
			pages
		});
	} catch (e) {
		console.warn('[offline] save manga chapter failed', e);
	}

	const chapterSafe = sanitizePathSegment(chapterTitle);
	const mangaSafe = sanitizePathSegment(mangaTitle || 'Manga');
	const preferDisk =
		!forceZip &&
		(await import('$lib/stores/preferences')).prefersDiskDownload() &&
		supportsFileSystemAccess();

	if (preferDisk) {
		let root = offlineOnly
			? await ensureLibraryRoot()
			: (await requestStoredLibraryRoot()) || (await pickLibraryRoot());
		if (root) {
			report({
				phase: 'disk',
				current: pages.length,
				total: pages.length,
				message: 'Saving to local folder…'
			});
			const path = await saveMangaChapterToDisk({
				root,
				mangaTitle: mangaSafe,
				chapterTitle: chapterSafe,
				pages,
				meta: {
					source,
					mangaId: mangaId || '',
					mangaTitle: mangaTitle || mangaSafe,
					chapterId,
					chapterTitle,
					savedAt: Date.now(),
					pageCount: pages.length
				}
			});

			void cacheLibraryCover({
				mangaId: mangaId || chapterId,
				sourceId: source,
				coverUrl: cover || '',
				title: mangaTitle || mangaSafe,
				isNovel: false
			});

			try {
				await upsertLibraryEntry({
					mangaId: mangaId || chapterId,
					mangaTitle: mangaTitle || mangaSafe,
					cover: cover || '',
					sourceId: source,
					isNovel: false,
					localPath: path,
					chapters: [
						{
							chapterId: String(chapterId),
							chapterTitle,
							savedAt: Date.now(),
							pageCount: pages.length
						}
					]
				});
			} catch (e) {
				console.warn('[library] upsert failed', e);
			}

			report({
				phase: 'done',
				current: pages.length,
				total: pages.length,
				message: path
			});
			return;
		}
	}

	if (offlineOnly) {
		void cacheLibraryCover({
			mangaId: mangaId || chapterId,
			sourceId: source,
			coverUrl: cover || '',
			title: mangaTitle || mangaSafe,
			isNovel: false
		});
		try {
			await upsertLibraryEntry({
				mangaId: mangaId || chapterId,
				mangaTitle: mangaTitle || mangaSafe,
				cover: cover || '',
				sourceId: source,
				isNovel: false,
				chapters: [
					{
						chapterId: String(chapterId),
						chapterTitle,
						savedAt: Date.now(),
						pageCount: pages.length
					}
				]
			});
		} catch (e) {
			console.warn('[library] upsert failed (offlineOnly)', e);
		}
		report({
			phase: 'done',
			current: pages.length,
			total: pages.length,
			message: 'Saved to Offline Library'
		});
		return;
	}

	const JSZip = await tryLoadJSZip();
	if (JSZip) {
		const zip = new JSZip();
		const folder = zip.folder(baseName) || zip;
		for (let i = 0; i < pages.length; i++) {
			folder.file(`${pad(i + 1)}.${pages[i].ext}`, pages[i].blob);
		}
		report({
			phase: 'zip',
			current: pages.length,
			total: pages.length,
			message: 'Packing…'
		});
		const out = await zip.generateAsync({
			type: 'blob',
			compression: 'DEFLATE',
			compressionOptions: { level: 6 }
		});
		triggerDownload(out, `${baseName}.zip`);
		void cacheLibraryCover({
			mangaId: mangaId || chapterId,
			sourceId: source,
			coverUrl: cover || '',
			title: mangaTitle || mangaSafe,
			isNovel: false
		});
		try {
			await upsertLibraryEntry({
				mangaId: mangaId || chapterId,
				mangaTitle: mangaTitle || mangaSafe,
				cover: cover || '',
				sourceId: source,
				isNovel: false,
				chapters: [
					{
						chapterId: String(chapterId),
						chapterTitle,
						savedAt: Date.now(),
						pageCount: pages.length
					}
				]
			});
		} catch (e) {
			console.warn('[library] upsert failed', e);
		}
		report({ phase: 'done', current: pages.length, total: pages.length });
		return;
	}

	for (let i = 0; i < pages.length; i++) {
		report({
			phase: 'images',
			current: i + 1,
			total: pages.length,
			message: `Saving ${i + 1}/${pages.length}`
		});
		triggerDownload(pages[i].blob, `${baseName}_${pad(i + 1)}.${pages[i].ext}`);
		await new Promise((r) => setTimeout(r, 120));
	}
	void cacheLibraryCover({
		mangaId: mangaId || chapterId,
		sourceId: source,
		coverUrl: cover || '',
		title: mangaTitle || mangaSafe,
		isNovel: false
	});
	try {
		await upsertLibraryEntry({
			mangaId: mangaId || chapterId,
			mangaTitle: mangaTitle || mangaSafe,
			cover: cover || '',
			sourceId: source,
			isNovel: false,
			chapters: [
				{
					chapterId: String(chapterId),
					chapterTitle,
					savedAt: Date.now(),
					pageCount: pages.length
				}
			]
		});
	} catch (e) {
		console.warn('[library] upsert failed', e);
	}
	report({ phase: 'done', current: pages.length, total: pages.length });
}
