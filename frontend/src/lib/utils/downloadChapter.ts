import {
	supportsFileSystemAccess,
	ensureLibraryRoot,
	saveMangaChapterToDisk,
	sanitizePathSegment
} from '$lib/utils/localFs';
import { upsertLibraryEntry } from '$lib/stores/library.svelte';
import { cacheLibraryCover } from '$lib/utils/cacheCover';

export type DownloadProgress = {
	phase: 'pages' | 'images' | 'zip' | 'disk' | 'fetch' | 'pdf' | 'done' | 'error';
	current: number;
	total: number;
	message?: string;
};

type ProgressCb = (p: DownloadProgress) => void;

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
		const res = await fetch(`/api/pages?${params}`, { cache: 'force-cache' });
		if (!res.ok) {
			const res2 = await fetch(`/api/pages?${params}`);
			if (!res2.ok) throw new Error(`pages ${res2.status}`);
			const json = (await res2.json()) as {
				pages?: string[];
				total?: number;
				hasMore?: boolean;
			};
			const batch = Array.isArray(json.pages) ? json.pages : [];
			if (typeof json.total === 'number') total = json.total;
			all.push(...batch);
			if (!json.hasMore || batch.length === 0) break;
			start += batch.length;
			continue;
		}
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

function proxyUrl(url: string, source: string): string {
	if (!url) return '';
	let u = String(url).trim();
	if (u.startsWith('//')) u = 'https:' + u;
	// already proxied
	if (u.startsWith('/api/proxy')) return u;
	if (/\/api\/proxy\?/i.test(u)) return u;
	return `/api/proxy?url=${encodeURIComponent(u)}&source=${encodeURIComponent(source)}`;
}

async function fetchImageBlob(
	url: string,
	source: string
): Promise<{ blob: Blob; ext: string }> {
	const proxy = proxyUrl(url, source);

	let res = await fetch(proxy, { cache: 'force-cache' });
	if (!res.ok) {
		res = await fetch(proxy, { cache: 'default' });
	}
	if (!res.ok) throw new Error(`image ${res.status}`);

	const blob = await res.blob();
	const ct = (res.headers.get('content-type') || blob.type || '').toLowerCase();
	let ext = 'jpg';
	if (ct.includes('png')) ext = 'png';
	else if (ct.includes('webp')) ext = 'webp';
	else if (ct.includes('gif')) ext = 'gif';
	else if (ct.includes('avif')) ext = 'avif';
	else if (ct.includes('jpeg') || ct.includes('jpg')) ext = 'jpg';
	else {
		const m = url.match(/\.(jpe?g|png|webp|gif|avif)(?:\?|$)/i);
		if (m) ext = m[1].toLowerCase().replace('jpeg', 'jpg');
	}
	return { blob, ext };
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
		while (next < items.length) {
			const i = next++;
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
	concurrency?: number;
	forceZip?: boolean;
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

	let urls: string[] =
		Array.isArray(pageUrls) && pageUrls.length > 0
			? pageUrls.filter(Boolean)
			: await fetchAllPageUrls(source, chapterId);

	if (!urls.length) throw new Error('No pages found');

	report({
		phase: 'images',
		current: 0,
		total: urls.length,
		message: `Downloading 0/${urls.length}`
	});

	const blobs = await mapPool(
		urls,
		concurrency,
		async (url) => fetchImageBlob(url, source),
		(done, total) => {
			report({
				phase: 'images',
				current: done,
				total,
				message: `Downloading ${done}/${total}`
			});
		}
	);

	const pages: { blob: Blob; ext: string }[] = [];
	for (const item of blobs) {
		if (item) pages.push(item);
	}
	if (!pages.length) throw new Error('No images downloaded');

	if (!forceZip && supportsFileSystemAccess()) {
		const root = await ensureLibraryRoot();
		if (root) {
			report({
				phase: 'disk',
				current: pages.length,
				total: pages.length,
				message: 'Saving to local folder…'
			});
			const path = await saveMangaChapterToDisk({
				root,
				mangaTitle: sanitizePathSegment(mangaTitle || 'Manga'),
				chapterTitle: titleSafe,
				pages,
				meta: {
					source,
					mangaId: mangaId || '',
					mangaTitle: mangaTitle || '',
					chapterId,
					chapterTitle,
					savedAt: Date.now(),
					pageCount: pages.length
				}
			});
			try {
				void cacheLibraryCover({
					mangaId: mangaId || chapterId,
					sourceId: source,
					coverUrl: cover || '',
					title: mangaTitle || titleSafe,
					isNovel: false
				});
				await upsertLibraryEntry({
					mangaId: mangaId || chapterId,
					mangaTitle: mangaTitle || titleSafe,
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
				message: path || 'Saved'
			});
			return;
		}
	}

	// ZIP fallback
	const JSZip = await tryLoadJSZip();
	if (JSZip) {
		report({
			phase: 'zip',
			current: pages.length,
			total: pages.length,
			message: 'Packing ZIP…'
		});
		const zip = new JSZip();
		const folder = zip.folder(baseName) || zip;
		for (let i = 0; i < pages.length; i++) {
			folder.file(`${pad(i + 1)}.${pages[i].ext}`, pages[i].blob);
		}
		const out = await zip.generateAsync({
			type: 'blob',
			compression: 'STORE'
		});
		triggerDownload(out, `${baseName}.zip`);
		try {
			void cacheLibraryCover({
				mangaId: mangaId || chapterId,
				sourceId: source,
				coverUrl: cover || '',
				title: mangaTitle || titleSafe,
				isNovel: false
			});
			await upsertLibraryEntry({
				mangaId: mangaId || chapterId,
				mangaTitle: mangaTitle || titleSafe,
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

	// Last resort: individual files
	for (let i = 0; i < pages.length; i++) {
		report({
			phase: 'images',
			current: i + 1,
			total: pages.length,
			message: `Saving ${i + 1}/${pages.length}`
		});
		triggerDownload(pages[i].blob, `${baseName}_${pad(i + 1)}.${pages[i].ext}`);
		await new Promise((r) => setTimeout(r, 80));
	}
	try {
		void cacheLibraryCover({
			mangaId: mangaId || chapterId,
			sourceId: source,
			coverUrl: cover || '',
			title: mangaTitle || titleSafe,
			isNovel: false
		});
		await upsertLibraryEntry({
			mangaId: mangaId || chapterId,
			mangaTitle: mangaTitle || titleSafe,
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
