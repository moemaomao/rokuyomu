/**
 * Client-side chapter downloader for RokuYomu detail page.
 * Uses existing /api/pages + /api/proxy — no server ZIP needed.
 *
 * Drop at: frontend/src/lib/utils/downloadChapter.ts
 * Optional: pnpm add jszip && pnpm add -D @types/jszip
 * (falls back to sequential single-image downloads if JSZip missing)
 */

export type DownloadProgress = {
	phase: 'pages' | 'images' | 'zip' | 'done' | 'error';
	current: number;
	total: number;
	message?: string;
};

type ProgressCb = (p: DownloadProgress) => void;

function sanitizeFilename(name: string): string {
	return String(name || 'chapter')
		.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 120) || 'chapter';
}

function pad(n: number, width = 3): string {
	return String(n).padStart(width, '0');
}

async function fetchAllPageUrls(
	source: string,
	chapterId: string
): Promise<string[]> {
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
		const res = await fetch(`/api/pages?${params}`);
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

async function fetchImageBlob(
	url: string,
	source: string
): Promise<{ blob: Blob; ext: string }> {
	const proxy = `/api/proxy?url=${encodeURIComponent(url)}&source=${encodeURIComponent(source)}`;
	const res = await fetch(proxy);
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
		// Prefer installed package
		const mod = await import('jszip');
		return (mod as any).default || mod;
	} catch {
		/* CDN fallback */
	}
	try {
		const g = globalThis as any;
		if (g.JSZip) return g.JSZip;
		await new Promise<void>((resolve, reject) => {
			const s = document.createElement('script');
			s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
			s.onload = () => resolve();
			s.onerror = () => reject(new Error('JSZip CDN failed'));
			document.head.appendChild(s);
		});
		return (globalThis as any).JSZip || null;
	} catch {
		return null;
	}
}

/**
 * Download one chapter as .cbz (zip of images).
 * chapterId must match reader path (e.g. "/manga/slug/chapter-1").
 */
export async function downloadChapter(opts: {
	source: string;
	chapterId: string;
	chapterTitle: string;
	mangaTitle?: string;
	onProgress?: ProgressCb;
}): Promise<void> {
	const { source, chapterId, chapterTitle, mangaTitle, onProgress } = opts;
	const report = (p: DownloadProgress) => onProgress?.(p);

	report({ phase: 'pages', current: 0, total: 0, message: 'Fetching page list…' });
	const urls = await fetchAllPageUrls(source, chapterId);
	if (!urls.length) throw new Error('No pages found');

	const JSZip = await tryLoadJSZip();
	const baseName = sanitizeFilename(
		[mangaTitle, chapterTitle].filter(Boolean).join(' - ')
	);

	if (JSZip) {
		const zip = new JSZip();
		const folder = zip.folder(baseName) || zip;

		for (let i = 0; i < urls.length; i++) {
			report({
				phase: 'images',
				current: i + 1,
				total: urls.length,
				message: `Downloading ${i + 1}/${urls.length}`
			});
			try {
				const { blob, ext } = await fetchImageBlob(urls[i], source);
				folder.file(`${pad(i + 1)}.${ext}`, blob);
			} catch (e) {
				console.warn('[download] skip page', i + 1, e);
			}
		}

		report({ phase: 'zip', current: urls.length, total: urls.length, message: 'Packing…' });
		const out = await zip.generateAsync({
			type: 'blob',
			compression: 'DEFLATE',
			compressionOptions: { level: 6 }
		});
		triggerDownload(out, `${baseName}.cbz`);
		report({ phase: 'done', current: urls.length, total: urls.length });
		return;
	}

	// Fallback: download images one-by-one (no zip)
	for (let i = 0; i < urls.length; i++) {
		report({
			phase: 'images',
			current: i + 1,
			total: urls.length,
			message: `Saving ${i + 1}/${urls.length}`
		});
		try {
			const { blob, ext } = await fetchImageBlob(urls[i], source);
			triggerDownload(blob, `${baseName}_${pad(i + 1)}.${ext}`);
			await new Promise((r) => setTimeout(r, 120));
		} catch (e) {
			console.warn('[download] skip page', i + 1, e);
		}
	}
	report({ phase: 'done', current: urls.length, total: urls.length });
}
