const ROOT_HANDLE_KEY = 'rokuyomu_library_root_v2';
const FS_DB_NAME = 'rokuyomu-fs';
const FS_STORE = 'handles';
export const LIBRARY_FOLDER_NAME = 'RokuyomuLibrary';

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

export async function pickLibraryRoot(): Promise<FileSystemDirectoryHandle | null> {
	if (!supportsFileSystemAccess()) return null;
	try {
		const parent = (await (window as any).showDirectoryPicker({
			id: 'rokuyomu-library-parent',
			mode: 'readwrite',
			startIn: 'downloads'
		})) as FileSystemDirectoryHandle;

		const lib = await parent.getDirectoryHandle(LIBRARY_FOLDER_NAME, { create: true });

		memoryRoot = lib;

		await idbPutHandle(lib);

		return lib;
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
		if (ok) return memoryRoot;
		memoryRoot = null;
	}

	const stored = await idbGetHandle();
	if (!stored) return null;

	const ok = await ensurePermission(stored);
	if (!ok) return null;

	memoryRoot = stored;
	return stored;
}

export async function ensureLibraryRoot(): Promise<FileSystemDirectoryHandle | null> {
	const existing = await getLibraryRoot();
	if (existing) return existing;
	return pickLibraryRoot();
}

export function sanitizePathSegment(name: string): string {
	return (
		String(name || 'untitled')
			.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 100) || 'untitled'
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

export async function saveMangaChapterToDisk(opts: {
	root: FileSystemDirectoryHandle;
	mangaTitle: string;
	chapterTitle: string;
	pages: { blob: Blob; ext: string }[];
	meta?: Record<string, unknown>;
}): Promise<string> {
	const mangaRoot = await getOrCreateDir(opts.root, 'Manga');
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
	return `${LIBRARY_FOLDER_NAME}/Manga/${sanitizePathSegment(opts.mangaTitle)}/${sanitizePathSegment(opts.chapterTitle)}`;
}

export async function saveNovelPdfToDisk(opts: {
	root: FileSystemDirectoryHandle;
	novelTitle: string;
	chapterTitle: string;
	pdfBlob: Blob;
	meta?: Record<string, unknown>;
}): Promise<string> {
	const novelRoot = await getOrCreateDir(opts.root, 'Novel');
	const titleDir = await getOrCreateDir(novelRoot, opts.novelTitle);
	if (opts.meta) {
		await writeTextFile(titleDir, 'meta.json', JSON.stringify(opts.meta, null, 2));
	}
	const fname = `${sanitizePathSegment(opts.chapterTitle)}.pdf`;
	await writeBlobFile(titleDir, fname, opts.pdfBlob);
	return `${LIBRARY_FOLDER_NAME}/Novel/${sanitizePathSegment(opts.novelTitle)}/${fname}`;
}

export async function saveCoverToDisk(opts: {
	root: FileSystemDirectoryHandle;
	kind: 'Manga' | 'Novel';
	title: string;
	coverBlob: Blob;
	ext?: string;
}): Promise<string> {
	const kindRoot = await getOrCreateDir(opts.root, opts.kind);
	const titleDir = await getOrCreateDir(kindRoot, sanitizePathSegment(opts.title));
	let ext = opts.ext || 'jpg';
	const ct = (opts.coverBlob.type || '').toLowerCase();
	if (ct.includes('png')) ext = 'png';
	else if (ct.includes('webp')) ext = 'webp';
	else if (ct.includes('gif')) ext = 'gif';
	else if (ct.includes('jpeg') || ct.includes('jpg')) ext = 'jpg';
	const name = `cover.${ext}`;
	await writeBlobFile(titleDir, name, opts.coverBlob);
	return `${LIBRARY_FOLDER_NAME}/${opts.kind}/${sanitizePathSegment(opts.title)}/${name}`;
}

export async function readCoverFromDisk(opts: {
	root: FileSystemDirectoryHandle;
	kind: 'Manga' | 'Novel';
	title: string;
}): Promise<Blob | null> {
	try {
		const kindRoot = await opts.root.getDirectoryHandle(opts.kind);
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
