const ROOT_HANDLE_KEY = 'rokuyomu_root_v3';
const FS_DB_NAME = 'rokuyomu-fs';
const FS_STORE = 'handles';

export const ROOT_FOLDER_NAME = 'Rokuyomu';
export const LIBRARY_SUBDIR = 'Library';
export const BOOKMARK_SUBDIR = 'Bookmark';
export const HISTORY_SUBDIR = 'History';

const HIDDEN = {
	root: 'AppCache',
	library: '_media',
	bookmark: '_fav',
	history: '_recent'
} as const;

/** @deprecated */
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

function readHideFolders(): {
	root: boolean;
	library: boolean;
	bookmark: boolean;
	history: boolean;
} {
	const defaults = { root: false, library: false, bookmark: false, history: false };
	try {
		if (typeof localStorage === 'undefined') return defaults;
		const raw = localStorage.getItem('rokuyomu_preferences');
		if (!raw) return defaults;
		const p = JSON.parse(raw);
		const h = p?.hideOfflineFolders;
		if (h === true) return { root: true, library: true, bookmark: true, history: true };
		if (h && typeof h === 'object') {
			return {
				root: Boolean(h.root),
				library: Boolean(h.library),
				bookmark: Boolean(h.bookmark),
				history: Boolean(h.history)
			};
		}
		return defaults;
	} catch {
		return defaults;
	}
}

export function getRootFolderName(): string {
	return readHideFolders().root ? HIDDEN.root : ROOT_FOLDER_NAME;
}

export function getLibrarySubdirName(): string {
	return readHideFolders().library ? HIDDEN.library : LIBRARY_SUBDIR;
}

export function getBookmarkSubdirName(): string {
	return readHideFolders().bookmark ? HIDDEN.bookmark : BOOKMARK_SUBDIR;
}

export function getHistorySubdirName(): string {
	return readHideFolders().history ? HIDDEN.history : HISTORY_SUBDIR;
}

async function ensureSubdirs(root: FileSystemDirectoryHandle): Promise<void> {
	await root.getDirectoryHandle(getLibrarySubdirName(), { create: true });
	await root.getDirectoryHandle(getBookmarkSubdirName(), { create: true });
	await root.getDirectoryHandle(getHistorySubdirName(), { create: true });
}

export async function pickLibraryRoot(): Promise<FileSystemDirectoryHandle | null> {
	if (!supportsFileSystemAccess()) return null;
	try {
		const parent = (await (window as any).showDirectoryPicker({
			id: 'rokuyomu-root-parent',
			mode: 'readwrite',
			startIn: 'downloads'
		})) as FileSystemDirectoryHandle;

		const root = await parent.getDirectoryHandle(getRootFolderName(), { create: true });
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
	return r.getDirectoryHandle(getLibrarySubdirName(), { create: true });
}

export async function getBookmarkDir(
	root?: FileSystemDirectoryHandle | null
): Promise<FileSystemDirectoryHandle | null> {
	const r = root ?? (await getLibraryRoot());
	if (!r) return null;
	return r.getDirectoryHandle(getBookmarkSubdirName(), { create: true });
}

export async function getHistoryDir(
	root?: FileSystemDirectoryHandle | null
): Promise<FileSystemDirectoryHandle | null> {
	const r = root ?? (await getLibraryRoot());
	if (!r) return null;
	return r.getDirectoryHandle(getHistorySubdirName(), { create: true });
}

export function sanitizePathSegment(name: string): string {
	let s = String(name ?? '');

	try {
		s = s.normalize('NFKC');
	} catch {
		/* ignore */
	}

	s = s
		.replace(/[\uFFFD\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g, '')
		.replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
		.replace(/[<>:"/\\|?*]/g, '_')
		.replace(/[~'’`]/g, '_')
		.replace(/[âÃ][\u0080-\u00FF]?/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+|\.+$/g, '')
		.replace(/_+/g, '_')
		.replace(/^_+|_+$/g, '');

	if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(s)) {
		s = '_' + s;
	}

	if (s.length > 80) {
		s = s.slice(0, 80).replace(/\s+\S*$/, '').trim() || s.slice(0, 80);
	}

	if (!s || /^[_\s.]*$/.test(s)) {
		let hash = 0;
		const raw = String(name ?? 'untitled');
		for (let i = 0; i < raw.length; i++) {
			hash = (Math.imul(31, hash) + raw.charCodeAt(i)) | 0;
		}
		s = 'title_' + (hash >>> 0).toString(36);
	}

	return s;
}

export async function getOrCreateDir(
	parent: FileSystemDirectoryHandle,
	name: string
): Promise<FileSystemDirectoryHandle> {
	const safe = sanitizePathSegment(name);
	try {
		for await (const [existingName, handle] of parent.entries()) {
			if (handle.kind !== 'directory') continue;
			if (existingName === safe || existingName.toLowerCase() === safe.toLowerCase()) {
				return handle as FileSystemDirectoryHandle;
			}
		}
	} catch {
	}
	try {
		return await parent.getDirectoryHandle(safe, { create: true });
	} catch (e) {
		console.warn('[localFs] getOrCreateDir failed for', safe, e);
		let hash = 0;
		const raw = String(name ?? 'untitled');
		for (let i = 0; i < raw.length; i++) {
			hash = (Math.imul(31, hash) + raw.charCodeAt(i)) | 0;
		}
		const fallback = 'title_' + (hash >>> 0).toString(36);
		try {
			return await parent.getDirectoryHandle(fallback, { create: false });
		} catch {
			return parent.getDirectoryHandle(fallback, { create: true });
		}
	}
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
	return [getRootFolderName(), getLibrarySubdirName(), ...parts.map(sanitizePathSegment)].join('/');
}

function bookmarkRelPath(...parts: string[]): string {
	return [getRootFolderName(), getBookmarkSubdirName(), ...parts.map((p) => p.replace(/\s+/g, '_'))].join(
		'/'
	);
}

function historyRelPath(...parts: string[]): string {
	return [getRootFolderName(), getHistorySubdirName(), ...parts.map((p) => p.replace(/\s+/g, '_'))].join(
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
	const library = await opts.root.getDirectoryHandle(getLibrarySubdirName(), { create: true });
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
	const library = await opts.root.getDirectoryHandle(getLibrarySubdirName(), { create: true });
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
	const library = await opts.root.getDirectoryHandle(getLibrarySubdirName(), { create: true });
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
		const library = await opts.root.getDirectoryHandle(getLibrarySubdirName());
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

export async function deleteBookmarkCoverFromDisk(opts: {
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

export function historyCoverKey(sourceId: string, mangaId: string): string {
	const src = sanitizePathSegment(sourceId || 'src').replace(/\s+/g, '_');
	const id = sanitizePathSegment(String(mangaId || 'id').replace(/\//g, '_')).replace(/\s+/g, '_');
	return `${src}__${id}`.slice(0, 120);
}

export async function saveHistoryJsonToDisk(
	list: unknown[],
	root?: FileSystemDirectoryHandle | null
): Promise<string | null> {
	try {
		const histDir = await getHistoryDir(root);
		if (!histDir) return null;
		const payload = JSON.stringify(
			{
				version: 1,
				updatedAt: Date.now(),
				count: Array.isArray(list) ? list.length : 0,
				history: list
			},
			null,
			2
		);
		await writeTextFile(histDir, 'history.json', payload);
		return historyRelPath('history.json');
	} catch (e) {
		console.warn('[localFs] saveHistoryJsonToDisk', e);
		return null;
	}
}

export async function readHistoryJsonFromDisk(
	root?: FileSystemDirectoryHandle | null
): Promise<unknown[] | null> {
	try {
		const histDir = await getHistoryDir(root);
		if (!histDir) return null;
		const fh = await histDir.getFileHandle('history.json');
		const file = await fh.getFile();
		const fileText = await file.text();
		const data = JSON.parse(fileText);
		if (Array.isArray(data)) return data;
		if (data && Array.isArray(data.history)) return data.history;
		return null;
	} catch {
		return null;
	}
}

export async function saveHistoryCoverToDisk(opts: {
	root?: FileSystemDirectoryHandle | null;
	sourceId: string;
	mangaId: string;
	coverBlob: Blob;
	ext?: string;
}): Promise<string | null> {
	try {
		const histDir = await getHistoryDir(opts.root);
		if (!histDir) return null;
		const coversDir = await histDir.getDirectoryHandle('covers', { create: true });
		const base = historyCoverKey(opts.sourceId, opts.mangaId);
		const name = `${base}.bin`;
		await writeBlobFile(coversDir, name, opts.coverBlob);

		for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
			try {
				await coversDir.removeEntry(`${base}.${ext}`);
			} catch {
				/* ignore */
			}
		}

		return historyRelPath('covers', name);
	} catch (e) {
		console.warn('[localFs] saveHistoryCoverToDisk', e);
		return null;
	}
}

export async function deleteHistoryCoverFromDisk(opts: {
	root?: FileSystemDirectoryHandle | null;
	sourceId: string;
	mangaId: string;
}): Promise<void> {
	try {
		const histDir = await getHistoryDir(opts.root);
		if (!histDir) return;
		const coversDir = await histDir.getDirectoryHandle('covers');
		const base = historyCoverKey(opts.sourceId, opts.mangaId);
		for (const ext of ['bin', 'jpg', 'jpeg', 'png', 'webp', 'gif']) {
			try {
				await coversDir.removeEntry(`${base}.${ext}`);
			} catch {
				/* ignore */
			}
		}
	} catch {
		/* ignore */
	}
}

export async function readHistoryCoverFromDisk(opts: {
	root?: FileSystemDirectoryHandle | null;
	sourceId: string;
	mangaId: string;
}): Promise<Blob | null> {
	try {
		const histDir = await getHistoryDir(opts.root);
		if (!histDir) return null;
		const coversDir = await histDir.getDirectoryHandle('covers');
		const base = historyCoverKey(opts.sourceId, opts.mangaId);
		for (const ext of ['bin', 'jpg', 'jpeg', 'png', 'webp', 'gif']) {
			try {
				const fh = await coversDir.getFileHandle(`${base}.${ext}`);
				return await fh.getFile();
			} catch {
				/* try next */
			}
		}
	} catch {
		/* ignore */
	}
	return null;
}


export type DiskLibraryTitle = {
	kind: 'Manga' | 'Novel';
	folderName: string;
	mangaTitle: string;
	sourceId: string;
	mangaId: string;
	isNovel: boolean;
	localPath: string;
	chapters: {
		chapterId: string;
		chapterTitle: string;
		savedAt: number;
		pageCount?: number;
	}[];
	coverFileName?: string;
};

async function readMetaJson(
	dir: FileSystemDirectoryHandle
): Promise<Record<string, unknown> | null> {
	try {
		const fh = await dir.getFileHandle('meta.json');
		const file = await fh.getFile();
		const text = await file.text();
		const data = JSON.parse(text);
		return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

export async function scanLibraryFromDisk(
	root?: FileSystemDirectoryHandle | null
): Promise<DiskLibraryTitle[]> {
	const r = root ?? (await getLibraryRoot());
	if (!r) return [];

	let library: FileSystemDirectoryHandle;
	try {
		library = await r.getDirectoryHandle(getLibrarySubdirName());
	} catch {
		return [];
	}

	const out: DiskLibraryTitle[] = [];

	for (const kind of ['Manga', 'Novel'] as const) {
		let kindRoot: FileSystemDirectoryHandle;
		try {
			kindRoot = await library.getDirectoryHandle(kind);
		} catch {
			continue;
		}

		for await (const [name, handle] of kindRoot.entries()) {
			if (handle.kind !== 'directory') continue;
			const titleDir = handle as FileSystemDirectoryHandle;
			const meta = await readMetaJson(titleDir);
			const isNovel = kind === 'Novel';

			const sourceId = String(meta?.source || meta?.sourceId || 'disk').trim() || 'disk';
			const mangaIdRaw = String(meta?.mangaId || meta?.id || '').trim();
			const mangaTitle = String(
				meta?.mangaTitle || meta?.title || name || 'Untitled'
			).slice(0, 160);

			const mangaId =
				mangaIdRaw ||
				`/disk/${kind.toLowerCase()}/${sanitizePathSegment(name)}`;

			const chapters: DiskLibraryTitle['chapters'] = [];
			let coverFileName: string | undefined;

			if (isNovel) {
				for await (const [fname, fhandle] of titleDir.entries()) {
					if (fhandle.kind !== 'file') continue;
					const lower = fname.toLowerCase();
					if (lower === 'meta.json') continue;
					if (lower.startsWith('cover.')) {
						coverFileName = fname;
						continue;
					}
					if (!lower.endsWith('.pdf')) continue;
					const chapterTitle = fname.replace(/\.pdf$/i, '');
					const chMetaId = String(meta?.chapterId || '').trim();
					chapters.push({
						chapterId: chMetaId || `/disk/${sanitizePathSegment(chapterTitle)}`,
						chapterTitle,
						savedAt: Number(meta?.savedAt) || Date.now(),
						pageCount: undefined
					});
				}
			} else {
				for await (const [chName, chHandle] of titleDir.entries()) {
					if (chHandle.kind === 'file') {
						const lower = chName.toLowerCase();
						if (lower.startsWith('cover.')) coverFileName = chName;
						continue;
					}
					if (chHandle.kind !== 'directory') continue;
					const chDir = chHandle as FileSystemDirectoryHandle;
					let pageCount = 0;
					try {
						for await (const [, ph] of chDir.entries()) {
							if (ph.kind === 'file') pageCount++;
						}
					} catch {
						/* ignore */
					}
					const chMeta = await readMetaJson(chDir);
					chapters.push({
						chapterId: String(chMeta?.chapterId || meta?.chapterId || '').trim() ||
							`/disk/${sanitizePathSegment(chName)}`,
						chapterTitle: String(chMeta?.chapterTitle || chName),
						savedAt: Number(chMeta?.savedAt || meta?.savedAt) || Date.now(),
						pageCount: pageCount || undefined
					});
				}
			}

			out.push({
				kind,
				folderName: name,
				mangaTitle,
				sourceId,
				mangaId,
				isNovel,
				localPath: libraryRelPath(kind, name),
				chapters: chapters.sort((a, b) => b.savedAt - a.savedAt),
				coverFileName
			});
		}
	}

	return out;
}
