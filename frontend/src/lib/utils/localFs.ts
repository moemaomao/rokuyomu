const ROOT_HANDLE_KEY = 'rokuyomu_root_v3';
const FS_DB_NAME = 'rokuyomu-fs';
const FS_STORE = 'handles';

export const ROOT_FOLDER_NAME = 'Rokuyomu';
export const LIBRARY_SUBDIR = 'Download';
const LEGACY_LIBRARY_SUBDIR = 'Library';
export const BOOKMARK_SUBDIR = 'Bookmark';
export const HISTORY_SUBDIR = 'History';

const HIDDEN = {
	root: 'AppCache',
	library: '_media',
	bookmark: '_fav',
	history: '_recent'
} as const;

type DirectoryHandleWithEntries = FileSystemDirectoryHandle & {
	entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

/** @deprecated */
export const LIBRARY_FOLDER_NAME = ROOT_FOLDER_NAME;

let memoryRoot: FileSystemDirectoryHandle | null = null;
let permissionGranted = false;

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

async function ensurePermission(
	handle: FileSystemDirectoryHandle,
	opts?: { request?: boolean }
): Promise<boolean> {
	if (permissionGranted && memoryRoot === handle) return true;
	try {
		const h = handle as any;
		if (typeof h.queryPermission === 'function') {
			let state = await h.queryPermission({ mode: 'readwrite' });
			if (state === 'granted') {
				permissionGranted = true;
				return true;
			}
			if (opts?.request && typeof h.requestPermission === 'function') {
				state = await h.requestPermission({ mode: 'readwrite' });
				const ok = state === 'granted';
				permissionGranted = ok;
				return ok;
			}
			return false;
		}
		permissionGranted = true;
		return true;
	} catch {
		permissionGranted = false;
		return false;
	}
}

export function isMobileLikeFs(): boolean {
	if (typeof navigator === 'undefined') return false;
	const ua = navigator.userAgent || '';
	if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
	if (navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua)) return true;
	return false;
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

async function getExistingLibraryDirs(
	root: FileSystemDirectoryHandle
): Promise<{ name: string; handle: FileSystemDirectoryHandle }[]> {
	const names = [
		getLibrarySubdirName(),
		LIBRARY_SUBDIR,
		LEGACY_LIBRARY_SUBDIR,
		HIDDEN.library
	];
	const dirs: { name: string; handle: FileSystemDirectoryHandle }[] = [];
	for (const name of [...new Set(names)]) {
		try {
			dirs.push({ name, handle: await root.getDirectoryHandle(name) });
		} catch (error) {
			if (error instanceof DOMException && error.name === 'NotFoundError') continue;
			throw error;
		}
	}
	return dirs;
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
		const ok = await ensurePermission(memoryRoot, { request: false });
		if (ok) {
			if (!(memoryRoot as any).__rokuyomuSubdirs) {
				await ensureSubdirs(memoryRoot).catch(() => {});
				(memoryRoot as any).__rokuyomuSubdirs = true;
			}
			return memoryRoot;
		}
		memoryRoot = null;
		permissionGranted = false;
	}

	const stored = await idbGetHandle();
	if (!stored) return null;

	const ok = await ensurePermission(stored, { request: false });
	if (!ok) return null;

	memoryRoot = stored;
	permissionGranted = true;
	if (!(stored as any).__rokuyomuSubdirs) {
		await ensureSubdirs(stored).catch(() => {});
		(stored as any).__rokuyomuSubdirs = true;
	}
	return stored;
}

export async function ensureLibraryRoot(): Promise<FileSystemDirectoryHandle | null> {
	return getLibraryRoot();
}

export async function requestStoredLibraryRoot(): Promise<FileSystemDirectoryHandle | null> {
	if (!supportsFileSystemAccess()) return null;
	if (memoryRoot) {
		const ok = await ensurePermission(memoryRoot, { request: true });
		if (ok) {
			await ensureSubdirs(memoryRoot).catch(() => {});
			return memoryRoot;
		}
		memoryRoot = null;
	}
	const stored = await idbGetHandle();
	if (!stored) return null;
	const ok = await ensurePermission(stored, { request: true });
	if (!ok) return null;
	memoryRoot = stored;
	await ensureSubdirs(stored).catch(() => {});
	return stored;
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
	const raw = String(filename || 'file').trim() || 'file';
	const m = raw.match(/^(.*?)(\.[A-Za-z0-9]{1,10})$/);
	const baseRaw = (m ? m[1] : raw) || 'file';
	const ext = m ? m[2].toLowerCase() : '';
	let base = sanitizePathSegment(baseRaw).replace(/\s+/g, '_') || 'file';
	if (base.length > 100) base = base.slice(0, 100);
	const safe = base + ext;
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
		let previousMeta: Record<string, unknown> = {};
		try {
			const file = await titleDir.getFileHandle('meta.json');
			previousMeta = JSON.parse(await (await file.getFile()).text()) || {};
		} catch {
			// First chapter saved for this title.
		}
		const titleMeta = {
			...previousMeta,
			...opts.meta,
			synopsis:
				typeof opts.meta.synopsis === 'string' && opts.meta.synopsis.trim()
					? opts.meta.synopsis
					: previousMeta.synopsis,
			genres:
				Array.isArray(opts.meta.genres) && opts.meta.genres.length
					? opts.meta.genres
					: previousMeta.genres,
			author: opts.meta.author || previousMeta.author,
			artist: opts.meta.artist || previousMeta.artist,
			type: opts.meta.type || previousMeta.type
		};
		delete (titleMeta as any).chapterId;
		delete (titleMeta as any).chapterTitle;
		await writeTextFile(titleDir, 'meta.json', JSON.stringify(titleMeta, null, 2));
	}
	const chDir = await getOrCreateDir(titleDir, opts.chapterTitle);
	if (opts.meta) {
		await writeTextFile(chDir, 'meta.json', JSON.stringify(opts.meta, null, 2));
	}
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
	ext?: string;
	meta?: Record<string, unknown>;
	contentText?: string;
	contentHtml?: string;
}): Promise<string> {
	const library = await opts.root.getDirectoryHandle(getLibrarySubdirName(), { create: true });
	const novelRoot = await getOrCreateDir(library, 'Novel');
	const titleDir = await getOrCreateDir(novelRoot, opts.novelTitle);
	if (opts.meta) {
		let prev: Record<string, unknown> = {};
		try {
			const existing = await titleDir.getFileHandle('meta.json');
			prev = JSON.parse(await (await existing.getFile()).text()) || {};
		} catch {
			/* first save */
		}
		const titleMeta: Record<string, unknown> = {
			...prev,
			...opts.meta,
			source: opts.meta.source || prev.source,
			novelTitle: opts.meta.novelTitle || prev.novelTitle || opts.novelTitle,
			mangaId: opts.meta.mangaId || prev.mangaId,
			author: opts.meta.author || prev.author,
			artist: opts.meta.artist || prev.artist,
			type: opts.meta.type || prev.type,
			synopsis: opts.meta.synopsis || prev.synopsis,
			genres:
				Array.isArray(opts.meta.genres) && opts.meta.genres.length
					? opts.meta.genres
					: prev.genres,
			isNovel: true,
			updatedAt: Date.now()
		};
		delete titleMeta.chapterId;
		delete titleMeta.chapterTitle;
		const chapters = Array.isArray(prev.chapters) ? [...(prev.chapters as unknown[])] : [];
		const chId = String((opts.meta as any).chapterId || '');
		const chTitle = String((opts.meta as any).chapterTitle || opts.chapterTitle || '');
		if (chId || chTitle) {
			const entry = {
				chapterId: chId,
				chapterTitle: chTitle,
				file: `${sanitizePathSegment(opts.chapterTitle)}.${(opts.ext || 'pdf').replace(/^\./, '') || 'pdf'}`,
				savedAt: Date.now()
			};
			const ix = chapters.findIndex(
				(c: any) => c && (c.chapterId === chId || c.chapterTitle === chTitle)
			);
			if (ix >= 0) chapters[ix] = { ...(chapters[ix] as object), ...entry };
			else chapters.push(entry);
			titleMeta.chapters = chapters;
		}
		await writeTextFile(titleDir, 'meta.json', JSON.stringify(titleMeta, null, 2));
	}
	const ext = (opts.ext || 'pdf').replace(/^\./, '') || 'pdf';
	const base = sanitizePathSegment(opts.chapterTitle);
	const fname = `${base}.${ext}`;
	await writeBlobFile(titleDir, fname, opts.pdfBlob);
	if (opts.meta) {
		await writeTextFile(titleDir, `${base}.meta.json`, JSON.stringify(opts.meta, null, 2));
	}
	if (opts.contentHtml) {
		await writeBlobFile(
			titleDir,
			`${base}.html`,
			new Blob([opts.contentHtml], { type: 'text/html;charset=utf-8' })
		);
	}
	return libraryRelPath('Novel', opts.novelTitle, fname);
}

export async function saveNovelFileToDisk(
	opts: Parameters<typeof saveNovelPdfToDisk>[0]
): Promise<string> {
	return saveNovelPdfToDisk(opts);
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
	for (const { handle: library } of await getExistingLibraryDirs(opts.root)) {
		try {
			const kindRoot = await library.getDirectoryHandle(opts.kind);
			const titleDir = await kindRoot.getDirectoryHandle(sanitizePathSegment(opts.title));
			for (const name of ['cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'cover.gif']) {
				try {
					const fh = await titleDir.getFileHandle(name);
					return await fh.getFile();
				} catch {
					continue;
				}
			}
		} catch {
			continue;
		}
	}
	return null;
}

function wantDiskChapterHint(chapterId: string): boolean {
	return /^\/?disk\//i.test(String(chapterId || '').trim());
}

export async function readMangaChapterFromDisk(opts: {
	root?: FileSystemDirectoryHandle | null;
	sourceId: string;
	chapterId: string;
	mangaTitle?: string;
	mangaId?: string;
	chapterTitle?: string;
	maxPages?: number;
	librarySubdirName?: string;
}): Promise<{
	pages: { blob: Blob; ext: string }[];
	mangaTitle: string;
	chapterTitle: string;
	mangaId: string;
	chapterId: string;
	sourceId: string;
} | null> {
	const titleHint = sanitizePathSegment(opts.mangaTitle || '');
	const chTitleHint = sanitizePathSegment(opts.chapterTitle || '');
	const diskChapterHint = wantDiskChapterHint(opts.chapterId);
	if (!titleHint && !chTitleHint && !diskChapterHint) return null;

	const root = opts.root ?? (await getLibraryRoot());
	if (!root) return null;

	if (!opts.librarySubdirName) {
		for (const { name } of await getExistingLibraryDirs(root)) {
			const result = await readMangaChapterFromDisk({ ...opts, root, librarySubdirName: name });
			if (result) return result;
		}
		return null;
	}

	let library: FileSystemDirectoryHandle;
	try {
		library = await root.getDirectoryHandle(opts.librarySubdirName);
	} catch {
		return null;
	}

	let mangaRoot: FileSystemDirectoryHandle;
	try {
		mangaRoot = await library.getDirectoryHandle('Manga');
	} catch {
		return null;
	}

	const wantCh = String(opts.chapterId || '').trim();
	const wantChNorm = wantCh.replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase();
	const wantChSeg = wantChNorm.split('/').filter(Boolean).pop() || wantChNorm;
	const diskFolderName = diskChapterHint
		? sanitizePathSegment(wantChNorm.slice('disk/'.length)).toLowerCase()
		: '';
	const maxPages = Math.max(1, Math.min(opts.maxPages ?? 200, 400));

	function yieldMain(): Promise<void> {
		return new Promise((r) => setTimeout(r, 0));
	}

	function idMatch(stored: string, target: string, seg: string): boolean {
		const s = String(stored || '')
			.replace(/^\/+/, '')
			.replace(/\/+$/, '')
			.toLowerCase();
		const t = target.toLowerCase();
		if (!s || !t) return false;
		if (s === t) return true;
		if (s.endsWith(t) || t.endsWith(s)) return true;
		if (seg && (s === seg || s.endsWith('/' + seg) || s.endsWith(seg))) return true;
		return false;
	}

	async function readMeta(dir: FileSystemDirectoryHandle): Promise<Record<string, unknown> | null> {
		try {
			const fh = await dir.getFileHandle('meta.json');
			const data = JSON.parse(await (await fh.getFile()).text());
			return data && typeof data === 'object' ? data : null;
		} catch {
			return null;
		}
	}

	async function loadPages(
		chDir: FileSystemDirectoryHandle
	): Promise<{ blob: Blob; ext: string }[]> {
		const files: { name: string; handle: FileSystemFileHandle }[] = [];
		for await (const [pn, ph] of chDir.entries()) {
			if (ph.kind !== 'file') continue;
			const lower = pn.toLowerCase();
			if (lower === 'meta.json' || lower.endsWith('.json')) continue;
			if (!/\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(pn) && !/^\d/.test(pn)) continue;
			files.push({ name: pn, handle: ph as FileSystemFileHandle });
		}
		files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
		if (files.length > maxPages) files.length = maxPages;

		const pages: { blob: Blob; ext: string }[] = [];
		for (let i = 0; i < files.length; i++) {
			const f = files[i];
			try {
				const file = await f.handle.getFile();
				if (!file.size) continue;
				let ext =
					(f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') ||
					'jpg';
				if (ext === 'jpeg') ext = 'jpg';
				pages.push({ blob: file, ext });
			} catch {
				/* skip */
			}
			if (i > 0 && i % 4 === 0) await yieldMain();
		}
		return pages;
	}

	const titleCandidates: string[] = [];
	if (titleHint) {
		titleCandidates.push(titleHint);
		titleCandidates.push(titleHint.replace(/_/g, ' '));
	}

	const titleDirs: { name: string; handle: FileSystemDirectoryHandle }[] = [];
	for (const name of titleCandidates) {
		try {
			const h = await mangaRoot.getDirectoryHandle(name);
			titleDirs.push({ name, handle: h });
		} catch {
			/* not found */
		}
	}

	if (!titleDirs.length && titleHint) {
		let n = 0;
		for await (const [name, handle] of mangaRoot.entries()) {
			if (handle.kind !== 'directory') continue;
			n++;
			if (n > 80) break;
			const nn = name.toLowerCase();
			const th = titleHint.toLowerCase();
			if (nn === th || nn.includes(th) || th.includes(nn)) {
				titleDirs.push({ name, handle: handle as FileSystemDirectoryHandle });
				break;
			}
			if (n % 10 === 0) await yieldMain();
		}
	}

	if (diskChapterHint) {
		const knownTitles = new Set(titleDirs.map((titleDir) => titleDir.name));
		for await (const [name, handle] of (mangaRoot as DirectoryHandleWithEntries).entries()) {
			if (handle.kind !== 'directory' || knownTitles.has(name)) continue;
			titleDirs.push({ name, handle: handle as FileSystemDirectoryHandle });
		}
	}

	for (const td of titleDirs) {
		const titleMeta = await readMeta(td.handle);
		const folderSrc = String(titleMeta?.source || titleMeta?.sourceId || '').trim();
		if (folderSrc && folderSrc !== opts.sourceId) continue;
		const storedMangaId = String(titleMeta?.mangaId || titleMeta?.id || '').replace(/^\/+|\/+$/g, '');
		const wantedMangaId = String(opts.mangaId || '').replace(/^\/+|\/+$/g, '');
		if (wantedMangaId && storedMangaId && storedMangaId !== wantedMangaId) continue;
		const mangaTitle = String(
			titleMeta?.mangaTitle || titleMeta?.title || td.name || 'Manga'
		).slice(0, 160);
		const mangaId = String(titleMeta?.mangaId || titleMeta?.id || '').trim() || wantCh;

		const chTryNames: string[] = [];
		if (chTitleHint) {
			chTryNames.push(chTitleHint);
			chTryNames.push(chTitleHint.replace(/_/g, ' '));
		}

		for (const cn of chTryNames) {
			try {
				const chDir = await td.handle.getDirectoryHandle(cn);
				const chMeta = await readMeta(chDir);
				const pages = await loadPages(chDir);
				if (!pages.length) continue;
				return {
					pages,
					mangaTitle,
					chapterTitle: String(chMeta?.chapterTitle || cn),
					mangaId,
					chapterId: String(chMeta?.chapterId || chMeta?.id || wantCh),
					sourceId: folderSrc || opts.sourceId || 'disk'
				};
			} catch {
				/* try next */
			}
		}

		let scanned = 0;
		for await (const [chName, chHandle] of td.handle.entries()) {
			if (chHandle.kind !== 'directory') continue;
			scanned++;
			if (scanned > 120) break;
			const chDir = chHandle as FileSystemDirectoryHandle;
			const chMeta = await readMeta(chDir);
			const metaId = String(chMeta?.chapterId || chMeta?.id || '').trim();
			const matched =
				(metaId && idMatch(metaId, wantChNorm, wantChSeg)) ||
				(diskFolderName && sanitizePathSegment(chName).toLowerCase() === diskFolderName) ||
				(chTitleHint &&
					(sanitizePathSegment(chName).toLowerCase() === chTitleHint.toLowerCase() ||
						sanitizePathSegment(chName).toLowerCase().includes(chTitleHint.toLowerCase())));
			if (!matched) {
				if (scanned % 8 === 0) await yieldMain();
				continue;
			}
			const pages = await loadPages(chDir);
			if (!pages.length) continue;
			return {
				pages,
				mangaTitle,
				chapterTitle: String(chMeta?.chapterTitle || chName),
				mangaId,
				chapterId: metaId || wantCh,
				sourceId: folderSrc || opts.sourceId || 'disk'
			};
		}
	}

	return null;
}

export async function readNovelChapterFromDisk(opts: {
	root?: FileSystemDirectoryHandle | null;
	sourceId: string;
	chapterId: string;
	novelTitle?: string;
	chapterTitle?: string;
}): Promise<{
	content: string;
	novelTitle: string;
	chapterTitle: string;
	mangaId: string;
	chapterId: string;
	sourceId: string;
} | null> {
	const root = opts.root ?? (await getLibraryRoot());
	if (!root || !opts.novelTitle) return null;
	const titleHint = sanitizePathSegment(opts.novelTitle);
	const wantedId = String(opts.chapterId || '').replace(/^\/+|\/+$/g, '').toLowerCase();
	const wantedTitle = sanitizePathSegment(opts.chapterTitle || '').toLowerCase();

	for (const { handle: library } of await getExistingLibraryDirs(root)) {
		let titleDir: FileSystemDirectoryHandle;
		try {
			const novelRoot = await library.getDirectoryHandle('Novel');
			titleDir = await novelRoot.getDirectoryHandle(titleHint);
		} catch {
			continue;
		}

		let titleMeta: Record<string, unknown> | null = null;
		try {
			const metaFile = await (await titleDir.getFileHandle('meta.json')).getFile();
			titleMeta = JSON.parse(await metaFile.text());
		} catch {
			titleMeta = null;
		}
		const files: { name: string; handle: FileSystemFileHandle }[] = [];
		for await (const [name, handle] of (titleDir as DirectoryHandleWithEntries).entries()) {
			if (handle.kind === 'file' && name.toLowerCase().endsWith('.meta.json')) {
				files.push({ name, handle: handle as FileSystemFileHandle });
			}
		}
		for (const metaFile of files) {
			let chapterMeta: Record<string, unknown>;
			try {
				chapterMeta = JSON.parse(await (await metaFile.handle.getFile()).text());
			} catch {
				continue;
			}
			const storedId = String(chapterMeta.chapterId || '').replace(/^\/+|\/+$/g, '').toLowerCase();
			const storedTitle = sanitizePathSegment(String(chapterMeta.chapterTitle || '')).toLowerCase();
			if (
				(wantedId && storedId !== wantedId && !storedId.endsWith(`/${wantedId}`) && !wantedId.endsWith(`/${storedId}`)) &&
				(!wantedTitle || storedTitle !== wantedTitle)
			) {
				continue;
			}
			const base = metaFile.name.slice(0, -'.meta.json'.length);
			for (const ext of ['html', 'txt']) {
				try {
					const file = await (await titleDir.getFileHandle(`${base}.${ext}`)).getFile();
					const content = await file.text();
					if (!content.trim()) continue;
					return {
						content,
						novelTitle: String(titleMeta?.novelTitle || titleMeta?.title || opts.novelTitle),
						chapterTitle: String(chapterMeta.chapterTitle || opts.chapterTitle || base),
						mangaId: String(chapterMeta.mangaId || titleMeta?.mangaId || ''),
						chapterId: String(chapterMeta.chapterId || opts.chapterId),
						sourceId: String(chapterMeta.source || titleMeta?.source || opts.sourceId)
					};
				} catch {
					continue;
				}
			}
		}
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
	directoryName: string;
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

	const out: DiskLibraryTitle[] = [];

	for (const { name: directoryName, handle: library } of await getExistingLibraryDirs(r)) {
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
					mangaIdRaw || `/disk/${kind.toLowerCase()}/${sanitizePathSegment(name)}`;

				const chapters: DiskLibraryTitle['chapters'] = [];
				let coverFileName: string | undefined;

				if (isNovel) {
					for await (const [fname, fhandle] of titleDir.entries()) {
						if (fhandle.kind !== 'file') continue;
						const lower = fname.toLowerCase();
						if (lower === 'meta.json') continue;
						if (lower.endsWith('.meta.json') || lower.endsWith('.txt')) continue;
						if (lower.startsWith('cover.')) {
							coverFileName = fname;
							continue;
						}
						if (
							!lower.endsWith('.pdf') &&
							!lower.endsWith('.epub') &&
							!lower.endsWith('.html')
						) continue;
						const chapterTitle = fname.replace(/\.(pdf|epub|html)$/i, '');
						let chMeta: Record<string, unknown> | null = null;
						try {
							const mfh = await titleDir.getFileHandle(`${chapterTitle}.meta.json`);
							const mfile = await mfh.getFile();
							chMeta = JSON.parse(await mfile.text());
						} catch {
							chMeta = null;
						}
						const chMetaId = String(chMeta?.chapterId || '').trim();
						chapters.push({
							chapterId: chMetaId || `/disk/${sanitizePathSegment(chapterTitle)}`,
							chapterTitle: String(chMeta?.chapterTitle || chapterTitle),
							savedAt: Number(chMeta?.savedAt || meta?.savedAt) || Date.now(),
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
							chapterId:
								String(chMeta?.chapterId || meta?.chapterId || '').trim() ||
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
					localPath: [
						getRootFolderName(),
						directoryName,
						kind,
						sanitizePathSegment(name)
					].join('/'),
					directoryName,
					chapters: chapters.sort((a, b) => b.savedAt - a.savedAt),
					coverFileName
				});
			}
		}
	}

	return out;
}

export async function rebuildLibraryTitleMetadata(opts: {
	sourceId: string;
	mangaId: string;
	directoryMangaId?: string;
	mangaTitle: string;
	directoryTitle?: string;
	isNovel: boolean;
	cover?: string;
	description?: string;
	authors?: string[];
	author?: string;
	artist?: string;
	type?: string;
	genres?: string[];
}): Promise<number> {
	const root = await getLibraryRoot();
	if (!root) return 0;

	const kind = opts.isNovel ? 'Novel' : 'Manga';
	const wantedId = String(opts.directoryMangaId || opts.mangaId)
		.replace(/^\/+|\/+$/g, '')
		.toLowerCase();
	const wantedTitle = sanitizePathSegment(opts.directoryTitle || opts.mangaTitle).toLowerCase();
	const metadataLines =
		/^\s*(alttitle|alt title|alternative(?: title)?|type|language|artists?|groups?|pages|author|publication|published|serialization|demographic|latest(?: update)?|updated|rating|volume|vol)\s*:/i;
	const synopsis = String(opts.description || '')
		.split(/\n+/)
		.filter((line) => !metadataLines.test(line))
		.join('\n')
		.trim();
	const seriesMeta: Record<string, unknown> = {
		source: opts.sourceId,
		sourceId: opts.sourceId,
		mangaId: opts.mangaId,
		mangaTitle: opts.mangaTitle,
		...(opts.isNovel ? { novelTitle: opts.mangaTitle, isNovel: true } : {}),
		...(opts.cover ? { cover: opts.cover } : {}),
		...(synopsis ? { synopsis } : {}),
		...(opts.author ? { author: opts.author } : {}),
		...(opts.artist ? { artist: opts.artist } : {}),
		...(opts.type ? { type: opts.type } : {}),
		...(opts.genres?.length ? { genres: opts.genres } : {}),
		...(opts.authors?.length ? { authors: opts.authors } : {})
	};

	const matches = (value: unknown) =>
		String(value || '')
			.replace(/^\/+|\/+$/g, '')
			.toLowerCase() === wantedId;

	let updated = 0;
	for (const { handle: library } of await getExistingLibraryDirs(root)) {
		let kindRoot: FileSystemDirectoryHandle;
		try {
			kindRoot = await library.getDirectoryHandle(kind);
		} catch {
			continue;
		}

		let selected: FileSystemDirectoryHandle | null = null;
		let titleFallback: FileSystemDirectoryHandle | null = null;
		for await (const [name, handle] of (kindRoot as DirectoryHandleWithEntries).entries()) {
			if (handle.kind !== 'directory') continue;
			const dir = handle as FileSystemDirectoryHandle;
			const meta = await readMetaJson(dir);
			if (
				matches(meta?.mangaId || meta?.id) &&
				String(meta?.source || meta?.sourceId || opts.sourceId) === opts.sourceId
			) {
				selected = dir;
				break;
			}
			if (
				name.toLowerCase() === wantedTitle &&
				(!meta?.source && !meta?.sourceId && !meta?.mangaId && !meta?.id)
			) {
				titleFallback = dir;
			}
		}
		selected ||= titleFallback;
		if (!selected) continue;

		const titleMeta = await readMetaJson(selected);
		const mergedTitleMeta = { ...titleMeta, ...seriesMeta, updatedAt: Date.now() };
		if (opts.isNovel && Array.isArray(titleMeta?.chapters)) {
			mergedTitleMeta.chapters = titleMeta.chapters.map((chapter) =>
				chapter && typeof chapter === 'object'
					? { ...(chapter as Record<string, unknown>), ...seriesMeta }
					: chapter
			);
		}
		await writeTextFile(selected, 'meta.json', JSON.stringify(mergedTitleMeta, null, 2));
		updated++;

		for await (const [name, handle] of (selected as DirectoryHandleWithEntries).entries()) {
			if (opts.isNovel) {
				if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.meta.json')) continue;
				const fileHandle = handle as FileSystemFileHandle;
				const raw = await (await fileHandle.getFile()).text();
				const chapterMeta = JSON.parse(raw) as Record<string, unknown>;
				await writeTextFile(selected, name, JSON.stringify({ ...chapterMeta, ...seriesMeta }, null, 2));
				updated++;
				continue;
			}

			if (handle.kind !== 'directory') continue;
			const chapterDir = handle as FileSystemDirectoryHandle;
			try {
				const metaHandle = await chapterDir.getFileHandle('meta.json');
				const raw = await (await metaHandle.getFile()).text();
				const chapterMeta = JSON.parse(raw) as Record<string, unknown>;
				await writeTextFile(
					chapterDir,
					'meta.json',
					JSON.stringify({ ...chapterMeta, ...seriesMeta }, null, 2)
				);
				updated++;
			} catch (error) {
				if (error instanceof DOMException && error.name === 'NotFoundError') continue;
				throw error;
			}
		}
	}
	return updated;
}

export async function hydrateOfflineFromDisk(
	root?: FileSystemDirectoryHandle | null
): Promise<{ titles: number; chapters: number; covers: number }> {
	const r = root ?? (await getLibraryRoot());
	const stats = { titles: 0, chapters: 0, covers: 0 };
	if (!r) return stats;

	const scanned = await scanLibraryFromDisk(r);
	if (!scanned.length) return stats;

	const {
		saveOfflineMangaChapter,
		saveOfflineNovelChapter,
		hasOfflineMangaChapter,
		hasOfflineNovelChapter
	} = await import('$lib/utils/offlineChapter');
	const { idbPutLibraryCover } = await import('$lib/db');
	const { normalizeMangaId } = await import('$lib/stores/bookmark.svelte');

	function libCoverKey(mangaId: string, sourceId: string) {
		return `${sourceId}::${normalizeMangaId(mangaId)}`;
	}

	for (const t of scanned) {
		stats.titles++;
		let kindRoot: FileSystemDirectoryHandle;
		try {
			const library = await r.getDirectoryHandle(t.directoryName);
			kindRoot = await library.getDirectoryHandle(t.kind);
		} catch {
			continue;
		}
		let titleDir: FileSystemDirectoryHandle;
		try {
			titleDir = await kindRoot.getDirectoryHandle(t.folderName);
		} catch {
			continue;
		}

		if (t.coverFileName) {
			try {
				const fh = await titleDir.getFileHandle(t.coverFileName);
				const file = await fh.getFile();
				const blob = file.slice(0, file.size, file.type || 'image/jpeg');
				await idbPutLibraryCover(libCoverKey(t.mangaId, t.sourceId), blob);
				stats.covers++;
			} catch {
				/* ignore */
			}
		}

		if (t.isNovel) {
			for await (const [fname, fhandle] of titleDir.entries()) {
				if (fhandle.kind !== 'file') continue;
				const lower = fname.toLowerCase();
				if (
					!lower.endsWith('.pdf') &&
					!lower.endsWith('.epub') &&
					!lower.endsWith('.html')
				) continue;
				const base = fname.replace(/\.(pdf|epub|html)$/i, '');
				let chMeta: Record<string, unknown> | null = null;
				try {
					const mfh = await titleDir.getFileHandle(`${base}.meta.json`);
					chMeta = JSON.parse(await (await mfh.getFile()).text());
				} catch {
					chMeta = null;
				}
				const chapterId =
					String(chMeta?.chapterId || '').trim() || `/disk/${sanitizePathSegment(base)}`;
				if (await hasOfflineNovelChapter(t.sourceId, chapterId)) continue;

				let content = '';
				try {
					const tfh = await titleDir.getFileHandle(`${base}.html`);
					content = await (await tfh.getFile()).text();
				} catch {
					try {
						const tfh = await titleDir.getFileHandle(`${base}.txt`);
						content = await (await tfh.getFile()).text();
					} catch {
						content = '';
					}
				}
				if (!content.trim()) {
					continue;
				}
				try {
					await saveOfflineNovelChapter({
						sourceId: t.sourceId,
						mangaId: t.mangaId,
						chapterId,
						novelTitle: t.mangaTitle,
						chapterTitle: String(chMeta?.chapterTitle || base),
						content
					});
					stats.chapters++;
				} catch (e) {
					console.warn('[hydrate] novel chapter', t.sourceId, chapterId, e);
				}
			}
		} else {
			for await (const [chName, chHandle] of titleDir.entries()) {
				if (chHandle.kind !== 'directory') continue;
				const chDir = chHandle as FileSystemDirectoryHandle;
				const chMeta = await readMetaJson(chDir);
				const chapterId =
					String(chMeta?.chapterId || '').trim() ||
					`/disk/${sanitizePathSegment(chName)}`;
				if (await hasOfflineMangaChapter(t.sourceId, chapterId)) continue;

				const pages: { blob: Blob; ext: string }[] = [];
				const files: { name: string; handle: FileSystemFileHandle }[] = [];
				try {
					for await (const [pn, ph] of chDir.entries()) {
						if (ph.kind !== 'file') continue;
						if (pn.toLowerCase() === 'meta.json') continue;
						files.push({ name: pn, handle: ph as FileSystemFileHandle });
					}
				} catch {
					continue;
				}
				files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
				for (const f of files) {
					try {
						const file = await f.handle.getFile();
						const ext =
							(f.name.split('.').pop() || 'jpg')
								.toLowerCase()
								.replace(/[^a-z0-9]/g, '') || 'jpg';
						pages.push({
							blob: file.slice(0, file.size, file.type || 'image/jpeg'),
							ext
						});
					} catch {
						/* skip page */
					}
				}
				if (!pages.length) continue;
				try {
					await saveOfflineMangaChapter({
						sourceId: t.sourceId,
						mangaId: t.mangaId,
						chapterId,
						mangaTitle: t.mangaTitle,
						chapterTitle: String(chMeta?.chapterTitle || chName),
						pages
					});
					stats.chapters++;
				} catch (e) {
					console.warn('[hydrate] manga chapter', t.sourceId, chapterId, e);
				}
			}
		}
	}

	return stats;
}
