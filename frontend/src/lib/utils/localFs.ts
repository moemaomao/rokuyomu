const ROOT_HANDLE_KEY = 'rokuyomu_root_v3';
const FS_DB_NAME = 'rokuyomu-fs';
const FS_STORE = 'handles';

export const ROOT_FOLDER_NAME = 'Rokuyomu';
export const LIBRARY_SUBDIR = 'Library';
export const BOOKMARK_SUBDIR = 'Bookmark';

/** @deprecated Use ROOT_FOLDER_NAME — kept for path string compatibility in older entries. */
export const LIBRARY_FOLDER_NAME = ROOT_FOLDER_NAME;

let memoryRoot: FileSystemDirectoryHandle | null = null;

export function supportsFileSystemAccess(): boolean {
	return (
		typeof window !== 'undefined' &&
		typeof (window as any).showDirectoryPicker === 'function'
	);
}

function openFsDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(FS_DB_NAME, 1);
		req.onerror = () => reject(req.error);
		req.onsuccess = () => resolve(req.result);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(FS_STORE)) {
				db.createObjectStore(FS_STORE);
			}
		};
	});
}

async function idbPutHandle(handle: FileSystemDirectoryHandle): Promise<boolean> {
	try {
		const db = await openFsDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(FS_STORE, 'readwrite');
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.objectStore(FS_STORE).put(handle, ROOT_HANDLE_KEY);
		});
		db.close();
		return true;
	} catch (e) {
		console.warn('[localFs] IDB put handle failed (session-only OK):', e);
		return false;
	}
}

async function idbGetHandle(): Promise<FileSystemDirectoryHandle | null> {
	try {
		const db = await openFsDb();
		const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
			const tx = db.transaction(FS_STORE, 'readonly');
			tx.onerror = () => reject(tx.error);
			const req = tx.objectStore(FS_STORE).get(ROOT_HANDLE_KEY);
			req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) || null);
			req.onerror = () => reject(req.error);
		});
		db.close();
		return handle;
	} catch {
		return null;
	}
}

async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
	try {
		const h = handle as any;
		if (typeof h.queryPermission === 'function') {
			let state = await h.queryPermission({ mode: 'readwrite' });
			if (state === 'granted') return true;
			if (typeof h.requestPermission === 'function') {
				state = await h.requestPermission({ mode: 'readwrite' });
				return state === 'granted';
			}
			return false;
		}
		return true;
	} catch {
		return false;
	}
}

async function ensureSubdirs(root: FileSystemDirectoryHandle): Promise<void> {
	await root.getDirectoryHandle(LIBRARY_SUBDIR, { create: true });
	await root.getDirectoryHandle(BOOKMARK_SUBDIR, { create: true });
}

export async function pickLibraryRoot(): Promise<FileSystemDirectoryHandle | null> {
	if (!supportsFileSystemAccess()) return null;
	try {
		const parent = (await (window as any).showDirectoryPicker({
			id: 'rokuyomu-root-parent',
			mode: 'readwrite',
			startIn: 'downloads'
		})) as FileSystemDirectoryHandle;

		const root = await parent.getDirectoryHandle(ROOT_FOLDER_NAME, { create: true });
		await ensureSubdirs(root);

		memoryRoot = root;
		await idbPutHandle(root);
		return root;
	} catch (e: any) {
		if (e?.name === 'AbortError') return null;
		console.warn('[localFs] pickLibraryRoot', e);
		return null;
	}
}

export async function getLibraryRoot(): Promise<FileSystemDirectoryHandle | null> {
	if (!supportsFileSystemAccess()) return null;

	if (memoryRoot) {
		const ok = await ensurePermission(memoryRoot);
		if (ok) {
			await ensureSubdirs(memoryRoot).catch(() => {});
			return memoryRoot;
		}
		memoryRoot = null;
	}

	const stored = await idbGetHandle();
	if (!stored) return null;

	const ok = await ensurePermission(stored);
	if (!ok) return null;

	memoryRoot = stored;
	await ensureSubdirs(stored).catch(() => {});
	return stored;
}

export async function ensureLibraryRoot(): Promise<FileSystemDirectoryHandle | null> {
	const existing = await getLibraryRoot();
	if (existing) return existing;
	return pickLibraryRoot();
}

export async function getLibraryDir(
	root?: FileSystemDirectoryHandle | null
): Promise<FileSystemDirectoryHandle | null> {
	const r = root ?? (await getLibraryRoot());
	if (!r) return null;
	return r.getDirectoryHandle(LIBRARY_SUBDIR, { create: true });
}

export async function getBookmarkDir(
	root?: FileSystemDirectoryHandle | null
): Promise<FileSystemDirectoryHandle | null> {
	const r = root ?? (await getLibraryRoot());
	if (!r) return null;
	return r.getDirectoryHandle(BOOKMARK_SUBDIR, { create: true });
}

export function sanitizePathSegment(name: string): string {
	return (
		String(name || 'untitled')
			.replace(/[<>:"/\\|?*\x00-\x1f~'’`]/g, '_')
			.replace(/[\u200B-\u200D\uFEFF]/g, '')
			.replace(/\s+/g, ' ')
			.trim()
			.replace(/^\.+|\.+$/g, '')
			.replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i, '_$1')
			.slice(0, 80) || 'untitled'
	);
}

export async function getOrCreateDir(
	parent: FileSystemDirectoryHandle,
	name: string
): Promise<FileSystemDirectoryHandle> {
	const safe = sanitizePathSegment(name);
	return parent.getDirectoryHandle(safe, { create: true });
}

export async function writeBlobFile(
	dir: FileSystemDirectoryHandle,
	filename: string,
	blob: Blob
): Promise<void> {
	const safe = sanitizePathSegment(filename).replace(/\s+/g, '_');
	const fileHandle = await dir.getFileHandle(safe, { create: true });
	const writable = await fileHandle.createWritable();
	await writable.write(blob);
	await writable.close();
}

export async function writeTextFile(
	dir: FileSystemDirectoryHandle,
	filename: string,
	text: string
): Promise<void> {
	await writeBlobFile(dir, filename, new Blob([text], { type: 'text/plain;charset=utf-8' }));
}

function libraryRelPath(...parts: string[]): string {
	return [ROOT_FOLDER_NAME, LIBRARY_SUBDIR, ...parts.map(sanitizePathSegment)].join('/');
}

function bookmarkRelPath(...parts: string[]): string {
	return [ROOT_FOLDER_NAME, BOOKMARK_SUBDIR, ...parts.map((p) => p.replace(/\s+/g, '_'))].join(
		'/'
	);
}

// ─── Library (chapters) ───────────────────────────────────────────────────────

export async function saveMangaChapterToDisk(opts: {
	root: FileSystemDirectoryHandle;
	mangaTitle: string;
	chapterTitle: string;
	pages: { blob: Blob; ext: string }[];
	meta?: Record<string, unknown>;
}): Promise<string> {
	const library = await opts.root.getDirectoryHandle(LIBRARY_SUBDIR, { create: true });
	const mangaRoot = await getOrCreateDir(library, 'Manga');
	const titleDir = await getOrCreateDir(mangaRoot, opts.mangaTitle);
	if (opts.meta) {
		await writeTextFile(titleDir, 'meta.json', JSON.stringify(opts.meta, null, 2));
	}
	const chDir = await getOrCreateDir(titleDir, opts.chapterTitle);
	for (let i = 0; i < opts.pages.length; i++) {
		const { blob, ext } = opts.pages[i];
		const name = `${String(i + 1).padStart(3, '0')}.${ext}`;
		await writeBlobFile(chDir, name, blob);
	}
	return libraryRelPath('Manga', opts.mangaTitle, opts.chapterTitle);
}

export async function saveNovelPdfToDisk(opts: {
	root: FileSystemDirectoryHandle;
	novelTitle: string;
	chapterTitle: string;
	pdfBlob: Blob;
	meta?: Record<string, unknown>;
}): Promise<string> {
	const library = await opts.root.getDirectoryHandle(LIBRARY_SUBDIR, { create: true });
	const novelRoot = await getOrCreateDir(library, 'Novel');
	const titleDir = await getOrCreateDir(novelRoot, opts.novelTitle);
	if (opts.meta) {
		await writeTextFile(titleDir, 'meta.json', JSON.stringify(opts.meta, null, 2));
	}
	const fname = `${sanitizePathSegment(opts.chapterTitle)}.pdf`;
	await writeBlobFile(titleDir, fname, opts.pdfBlob);
	return libraryRelPath('Novel', opts.novelTitle, fname);
}

export async function saveCoverToDisk(opts: {
	root: FileSystemDirectoryHandle;
	kind: 'Manga' | 'Novel';
	title: string;
	coverBlob: Blob;
	ext?: string;
}): Promise<string> {
	const library = await opts.root.getDirectoryHandle(LIBRARY_SUBDIR, { create: true });
	const kindRoot = await getOrCreateDir(library, opts.kind);
	const titleDir = await getOrCreateDir(kindRoot, sanitizePathSegment(opts.title));
	let ext = opts.ext || 'jpg';
	const ct = (opts.coverBlob.type || '').toLowerCase();
	if (ct.includes('png')) ext = 'png';
	else if (ct.includes('webp')) ext = 'webp';
	else if (ct.includes('gif')) ext = 'gif';
	else if (ct.includes('jpeg') || ct.includes('jpg')) ext = 'jpg';
	const name = `cover.${ext}`;
	await writeBlobFile(titleDir, name, opts.coverBlob);
	return libraryRelPath(opts.kind, opts.title, name);
}

export async function readCoverFromDisk(opts: {
	root: FileSystemDirectoryHandle;
	kind: 'Manga' | 'Novel';
	title: string;
}): Promise<Blob | null> {
	try {
		const library = await opts.root.getDirectoryHandle(LIBRARY_SUBDIR);
		const kindRoot = await library.getDirectoryHandle(opts.kind);
		const titleDir = await kindRoot.getDirectoryHandle(sanitizePathSegment(opts.title));
		for (const name of ['cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'cover.gif']) {
			try {
				const fh = await titleDir.getFileHandle(name);
				return await fh.getFile();
			} catch {
			}
		}
	} catch {
	}
	return null;
}

export function bookmarkCoverKey(sourceId: string, mangaId: string): string {
	const src = sanitizePathSegment(sourceId || 'src').replace(/\s+/g, '_');
	const id = sanitizePathSegment(String(mangaId || 'id').replace(/\//g, '_')).replace(/\s+/g, '_');
	return `${src}__${id}`.slice(0, 120);
}

export async function saveBookmarksJsonToDisk(
	list: unknown[],
	root?: FileSystemDirectoryHandle | null
): Promise<string | null> {
	try {
		const bmDir = await getBookmarkDir(root);
		if (!bmDir) return null;
		const payload = JSON.stringify(
			{
				version: 1,
				updatedAt: Date.now(),
				count: Array.isArray(list) ? list.length : 0,
				bookmarks: list
			},
			null,
			2
		);
		await writeTextFile(bmDir, 'bookmarks.json', payload);
		return bookmarkRelPath('bookmarks.json');
	} catch (e) {
		console.warn('[localFs] saveBookmarksJsonToDisk', e);
		return null;
	}
}

export async function saveBookmarkCoverToDisk(opts: {
	root?: FileSystemDirectoryHandle | null;
	sourceId: string;
	mangaId: string;
	coverBlob: Blob;
	ext?: string;
}): Promise<string | null> {
	try {
		const bmDir = await getBookmarkDir(opts.root);
		if (!bmDir) return null;
		const coversDir = await bmDir.getDirectoryHandle('covers', { create: true });
		let ext = opts.ext || 'jpg';
		const ct = (opts.coverBlob.type || '').toLowerCase();
		if (ct.includes('png')) ext = 'png';
		else if (ct.includes('webp')) ext = 'webp';
		else if (ct.includes('gif')) ext = 'gif';
		else if (ct.includes('jpeg') || ct.includes('jpg')) ext = 'jpg';
		const base = bookmarkCoverKey(opts.sourceId, opts.mangaId);
		const name = `${base}.${ext}`;
		await writeBlobFile(coversDir, name, opts.coverBlob);
		return bookmarkRelPath('covers', name);
	} catch (e) {
		console.warn('[localFs] saveBookmarkCoverToDisk', e);
		return null;
	}
}

export async function removeBookmarkCoverFromDisk(opts: {
	root?: FileSystemDirectoryHandle | null;
	sourceId: string;
	mangaId: string;
}): Promise<void> {
	try {
		const bmDir = await getBookmarkDir(opts.root);
		if (!bmDir) return;
		const coversDir = await bmDir.getDirectoryHandle('covers');
		const base = bookmarkCoverKey(opts.sourceId, opts.mangaId);
		for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
			try {
				await coversDir.removeEntry(`${base}.${ext}`);
			} catch {
			}
		}
	} catch {
	}
}

export async function readBookmarkCoverFromDisk(opts: {
	root?: FileSystemDirectoryHandle | null;
	sourceId: string;
	mangaId: string;
}): Promise<Blob | null> {
	try {
		const bmDir = await getBookmarkDir(opts.root);
		if (!bmDir) return null;
		const coversDir = await bmDir.getDirectoryHandle('covers');
		const base = bookmarkCoverKey(opts.sourceId, opts.mangaId);
		for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
			try {
				const fh = await coversDir.getFileHandle(`${base}.${ext}`);
				return await fh.getFile();
			} catch {
			}
		}
	} catch {
	}
	return null;
}

export async function readBookmarksJsonFromDisk(
	root?: FileSystemDirectoryHandle | null
): Promise<unknown[] | null> {
	try {
		const bmDir = await getBookmarkDir(root);
		if (!bmDir) return null;
		const fh = await bmDir.getFileHandle('bookmarks.json');
		const file = await fh.getFile();
		const text = await file.text();
		const data = JSON.parse(text);
		if (Array.isArray(data)) return data;
		if (data && Array.isArray(data.bookmarks)) return data.bookmarks;
		return null;
	} catch {
		return null;
	}
}
