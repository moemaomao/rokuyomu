import {
	idbGetBookmarks,
	idbSetAllBookmarks,
	idbGetHistory,
	idbSetAllHistory,
	idbGetLibrary,
	idbSetAllLibrary,
	idbGetNotifications,
	idbSetAllNotifications,
	idbGetPermanentStats,
	idbSetPermanentStats,
	type LibraryEntry
} from '$lib/db';

export const BACKUP_VERSION = 1;
export const BACKUP_KIND = 'rokuyomu-backup';

const LS_KEYS = [
	'darkMode',
	'mikoroku-preferred-sources',
	'preferredSources',
	'novelReaderSettings',
	'nsfwConfirmed',
	'mikoroku-chapter-view',
	'mikoroku-chapter-sort',
	'sidebar_open'
] as const;

export type RokuyomuBackup = {
	kind: typeof BACKUP_KIND;
	version: number;
	exportedAt: string;
	app: string;
	data: {
		bookmarks: unknown[];
		history: unknown[];
		library: LibraryEntry[];
		notifications: unknown[];
		permanentStats: unknown | null;
		localStorage: Record<string, string>;
	};
	notes?: string;
};

function collectLocalStorage(): Record<string, string> {
	const out: Record<string, string> = {};
	if (typeof localStorage === 'undefined') return out;
	for (const key of LS_KEYS) {
		try {
			const v = localStorage.getItem(key);
			if (v != null) out[key] = v;
		} catch {
		}
	}

	try {
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (!k) continue;
			if (
				(k.startsWith('mikoroku-') || k.startsWith('rokuyomu-') || k.startsWith('novel')) &&
				!(k in out)
			) {
				const v = localStorage.getItem(k);
				if (v != null) out[k] = v;
			}
		}
	} catch {
		/* ignore */
	}
	return out;
}

function restoreLocalStorage(map: Record<string, string>) {
	if (typeof localStorage === 'undefined' || !map) return;
	for (const [k, v] of Object.entries(map)) {
		try {
			localStorage.setItem(k, v);
		} catch {
		}
	}
}

export async function buildBackup(): Promise<RokuyomuBackup> {
	const [bookmarks, history, library, notifications, permanentStats] = await Promise.all([
		idbGetBookmarks(),
		idbGetHistory(),
		idbGetLibrary(),
		idbGetNotifications(),
		idbGetPermanentStats()
	]);

	return {
		kind: BACKUP_KIND,
		version: BACKUP_VERSION,
		exportedAt: new Date().toISOString(),
		app: 'rokuyomu',
		data: {
			bookmarks: bookmarks || [],
			history: history || [],
			library: (library || []).map((e) => ({
				...e,
				chapters: Array.isArray(e.chapters)
					? e.chapters.map((c) => ({
							chapterId: c.chapterId,
							chapterTitle: c.chapterTitle,
							savedAt: c.savedAt,
							pageCount: c.pageCount
						}))
					: []
			})),
			notifications: notifications || [],
			permanentStats: permanentStats || null,
			localStorage: collectLocalStorage()
		},
		notes:
			'Offline chapter images/text blobs are NOT included. Re-download chapters after import if needed. Disk folder RokuyomuLibrary is separate.'
	};
}

export function downloadBackupJson(backup: RokuyomuBackup, filename?: string) {
	const name =
		filename ||
		`rokuyomu-backup-${backup.exportedAt.slice(0, 10).replace(/-/g, '')}.json`;
	const blob = new Blob([JSON.stringify(backup, null, 2)], {
		type: 'application/json;charset=utf-8'
	});
	const a = document.createElement('a');
	const href = URL.createObjectURL(blob);
	a.href = href;
	a.download = name;
	a.rel = 'noopener';
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(href), 4000);
}

export async function exportBackupToFile(): Promise<RokuyomuBackup> {
	const backup = await buildBackup();
	downloadBackupJson(backup);
	return backup;
}

export function parseBackupJson(raw: string): RokuyomuBackup {
	const data = JSON.parse(raw) as RokuyomuBackup;
	if (!data || data.kind !== BACKUP_KIND) {
		throw new Error('Not a Rokuyomu backup file');
	}
	if (typeof data.version !== 'number' || data.version > BACKUP_VERSION) {
		throw new Error(`Unsupported backup version: ${data.version}`);
	}
	if (!data.data || typeof data.data !== 'object') {
		throw new Error('Invalid backup data');
	}
	return data;
}

export type ImportOptions = {
	replace?: boolean;
};

export async function importBackup(
	backup: RokuyomuBackup,
	opts: ImportOptions = {}
): Promise<{ ok: true; counts: Record<string, number> }> {
	const replace = opts.replace !== false;
	const d = backup.data;

	if (Array.isArray(d.bookmarks)) {
		if (replace) await idbSetAllBookmarks(d.bookmarks as any);
	}
	if (Array.isArray(d.history)) {
		if (replace) await idbSetAllHistory(d.history as any);
	}
	if (Array.isArray(d.library)) {
		if (replace) await idbSetAllLibrary(d.library as LibraryEntry[]);
	}
	if (Array.isArray(d.notifications)) {
		if (replace) await idbSetAllNotifications(d.notifications as any);
	}
	if (d.permanentStats && typeof d.permanentStats === 'object') {
		await idbSetPermanentStats(d.permanentStats as any);
	}
	if (d.localStorage && typeof d.localStorage === 'object') {
		restoreLocalStorage(d.localStorage);
	}

	try {
		window.dispatchEvent(new Event('library-changed'));
		window.dispatchEvent(new Event('bookmarks-changed'));
	} catch {
		/* ignore */
	}

	return {
		ok: true,
		counts: {
			bookmarks: Array.isArray(d.bookmarks) ? d.bookmarks.length : 0,
			history: Array.isArray(d.history) ? d.history.length : 0,
			library: Array.isArray(d.library) ? d.library.length : 0,
			notifications: Array.isArray(d.notifications) ? d.notifications.length : 0
		}
	};
}

export async function importBackupFromFile(file: File): Promise<{
	ok: true;
	counts: Record<string, number>;
}> {
	const text = await file.text();
	const backup = parseBackupJson(text);
	return importBackup(backup);
}
