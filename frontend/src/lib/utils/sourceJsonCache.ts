/**
 * Client-side JSON cache for browse/latest (and optional detail) per source.
 *
 * Why: Cloudflare Worker CPU is limited. KV only avoids *repeat scrape on the
 * edge* — every SSR still burns Worker time. Caching list JSON in the browser
 * means the same user re-opening a source can render without hitting the Worker.
 *
 * Strategy: stale-while-revalidate
 *  1. Read IDB → show immediately if present
 *  2. If age < TTL → skip network
 *  3. If age >= TTL → return stale + caller may revalidate in background
 *  4. Optional: mirror / export to Rokuyomu/Cache/sources/ on disk when FS is granted
 */

import { browser } from '$app/environment';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export type SourceCacheKind = 'latest' | 'search' | 'detail';
export type SourceCacheEntry = {
	key: string;
	sourceId: string;
	kind: SourceCacheKind;
	scope: string;
	savedAt: number;
	data: unknown;
};

interface SourceCacheDB extends DBSchema {
	entries: {
		key: string;
		value: SourceCacheEntry;
		indexes: { 'by-source': string; 'by-savedAt': number };
	};
}

const DB_NAME = 'rokuyomu-source-cache';
const DB_VERSION = 1;

export const SOURCE_CACHE_TTL_MS = 30 * 60 * 1000;
export const SOURCE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 400;

let dbPromise: Promise<IDBPDatabase<SourceCacheDB>> | null = null;

function getDb() {
	if (!browser) {
		return Promise.reject(new Error('sourceJsonCache is browser-only'));
	}
	if (!dbPromise) {
		dbPromise = openDB<SourceCacheDB>(DB_NAME, DB_VERSION, {
			upgrade(db) {
				if (!db.objectStoreNames.contains('entries')) {
					const store = db.createObjectStore('entries', { keyPath: 'key' });
					store.createIndex('by-source', 'sourceId');
					store.createIndex('by-savedAt', 'savedAt');
				}
			}
		});
	}
	return dbPromise;
}

export function sourceCacheKey(
	kind: SourceCacheKind,
	sourceId: string,
	scope: string = 'p1'
): string {
	const sid = String(sourceId || '')
		.trim()
		.toLowerCase();
	const sc = String(scope || 'p1')
		.trim()
		.toLowerCase()
		.slice(0, 200);
	return `${kind}:${sid}:${sc}`;
}

export function latestScope(opts: {
	page?: number;
	lang?: string;
	type?: string;
	q?: string;
}): string {
	const page = Math.max(1, Number(opts.page) || 1);
	const lang = (opts.lang || 'all').toLowerCase();
	const type = (opts.type || 'all').toLowerCase();
	const q = (opts.q || '').trim().toLowerCase().slice(0, 80);
	return `p${page}:l${lang}:t${type}:q${q}`;
}

async function trimOldEntries(db: IDBPDatabase<SourceCacheDB>) {
	try {
		const all = await db.getAllFromIndex('entries', 'by-savedAt');
		const cutoff = Date.now() - SOURCE_CACHE_MAX_AGE_MS;
		const toDelete: string[] = [];
		for (const e of all) {
			if (e.savedAt < cutoff) toDelete.push(e.key);
		}
		const remaining = all.filter((e) => e.savedAt >= cutoff);
		if (remaining.length > MAX_ENTRIES) {
			const overflow = remaining
				.sort((a, b) => a.savedAt - b.savedAt)
				.slice(0, remaining.length - MAX_ENTRIES);
			for (const e of overflow) toDelete.push(e.key);
		}
		if (toDelete.length) {
			const tx = db.transaction('entries', 'readwrite');
			await Promise.all(toDelete.map((k) => tx.store.delete(k)));
			await tx.done;
		}
	} catch (e) {
		console.warn('[sourceJsonCache] trim', e);
	}
}

export async function putSourceCache(opts: {
	kind: SourceCacheKind;
	sourceId: string;
	scope?: string;
	data: unknown;
}): Promise<void> {
	if (!browser || !opts.sourceId || opts.data == null) return;
	if (Array.isArray(opts.data) && opts.data.length === 0) return;

	const key = sourceCacheKey(opts.kind, opts.sourceId, opts.scope || 'p1');
	const entry: SourceCacheEntry = {
		key,
		sourceId: String(opts.sourceId),
		kind: opts.kind,
		scope: opts.scope || 'p1',
		savedAt: Date.now(),
		data: opts.data
	};

	try {
		const db = await getDb();
		await db.put('entries', entry);
		void trimOldEntries(db);
		void mirrorToDisk(entry).catch(() => {});
	} catch (e) {
		console.warn('[sourceJsonCache] put', e);
	}
}

export type SourceCacheHit<T = unknown> = {
	data: T;
	savedAt: number;
	fresh: boolean;
	ageMs: number;
};

export async function getSourceCache<T = unknown>(opts: {
	kind: SourceCacheKind;
	sourceId: string;
	scope?: string;
	ttlMs?: number;
}): Promise<SourceCacheHit<T> | null> {
	if (!browser || !opts.sourceId) return null;
	const key = sourceCacheKey(opts.kind, opts.sourceId, opts.scope || 'p1');
	try {
		const db = await getDb();
		const entry = await db.get('entries', key);
		if (!entry) return null;
		const ageMs = Date.now() - entry.savedAt;
		if (ageMs > SOURCE_CACHE_MAX_AGE_MS) {
			void db.delete('entries', key);
			return null;
		}
		const ttl = opts.ttlMs ?? SOURCE_CACHE_TTL_MS;
		return {
			data: entry.data as T,
			savedAt: entry.savedAt,
			fresh: ageMs < ttl,
			ageMs
		};
	} catch (e) {
		console.warn('[sourceJsonCache] get', e);
		return null;
	}
}

export async function clearSourceCache(sourceId?: string): Promise<void> {
	if (!browser) return;
	try {
		const db = await getDb();
		if (!sourceId) {
			await db.clear('entries');
			return;
		}
		const tx = db.transaction('entries', 'readwrite');
		const idx = tx.store.index('by-source');
		let cursor = await idx.openCursor(String(sourceId));
		while (cursor) {
			await cursor.delete();
			cursor = await cursor.continue();
		}
		await tx.done;
	} catch (e) {
		console.warn('[sourceJsonCache] clear', e);
	}
}

export async function listSourceCacheEntries(): Promise<SourceCacheEntry[]> {
	if (!browser) return [];
	try {
		const db = await getDb();
		return await db.getAll('entries');
	} catch {
		return [];
	}
}

export async function getSourceCacheStats(): Promise<{
	count: number;
	sources: number;
	oldestAt: number | null;
	newestAt: number | null;
}> {
	const all = await listSourceCacheEntries();
	if (!all.length) {
		return { count: 0, sources: 0, oldestAt: null, newestAt: null };
	}
	const sourceSet = new Set(all.map((e) => e.sourceId));
	let oldest = all[0].savedAt;
	let newest = all[0].savedAt;
	for (const e of all) {
		if (e.savedAt < oldest) oldest = e.savedAt;
		if (e.savedAt > newest) newest = e.savedAt;
	}
	return {
		count: all.length,
		sources: sourceSet.size,
		oldestAt: oldest,
		newestAt: newest
	};
}

function safeCacheFileName(entry: SourceCacheEntry): string {
	const raw = `${entry.kind}__${entry.sourceId}__${entry.scope}`;
	return (
		raw
			.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
			.replace(/[:]/g, '_')
			.replace(/\s+/g, '_')
			.replace(/_+/g, '_')
			.slice(0, 100) + '.json'
	);
}

async function mirrorToDisk(entry: SourceCacheEntry): Promise<void> {
	try {
		const { supportsFileSystemAccess, getLibraryRoot, writeTextFile } = await import(
			'$lib/utils/localFs'
		);
		if (!supportsFileSystemAccess()) return;
		const root = await getLibraryRoot();
		if (!root) return;
		const cacheDir = await root.getDirectoryHandle('Cache', { create: true });
		const sourcesDir = await cacheDir.getDirectoryHandle('sources', { create: true });
		await writeTextFile(sourcesDir, safeCacheFileName(entry), JSON.stringify(entry));
	} catch {
	}
}

export async function exportSourceCacheToDisk(): Promise<{
	written: number;
	pathHint: string;
}> {
	if (!browser) return { written: 0, pathHint: '' };

	const { supportsFileSystemAccess, ensureLibraryRoot, writeTextFile } = await import(
		'$lib/utils/localFs'
	);
	if (!supportsFileSystemAccess()) {
		throw new Error('File System Access API not supported (use Chrome or Edge).');
	}

	const root = await ensureLibraryRoot();
	if (!root) {
		throw new Error('Folder not selected or permission denied.');
	}

	const all = await listSourceCacheEntries();
	if (!all.length) {
		return { written: 0, pathHint: 'Rokuyomu/Cache/sources/' };
	}

	const cacheDir = await root.getDirectoryHandle('Cache', { create: true });
	const sourcesDir = await cacheDir.getDirectoryHandle('sources', { create: true });

	const manifest = {
		exportedAt: new Date().toISOString(),
		count: all.length,
		keys: all.map((e) => ({
			key: e.key,
			sourceId: e.sourceId,
			kind: e.kind,
			scope: e.scope,
			savedAt: e.savedAt
		}))
	};
	await writeTextFile(sourcesDir, '_manifest.json', JSON.stringify(manifest, null, 2));

	let written = 0;
	for (const entry of all) {
		await writeTextFile(sourcesDir, safeCacheFileName(entry), JSON.stringify(entry, null, 2));
		written++;
	}

	return { written, pathHint: 'Rokuyomu/Cache/sources/' };
}

export async function cachedJsonFetch<T>(opts: {
	kind: SourceCacheKind;
	sourceId: string;
	scope?: string;
	ttlMs?: number;
	fetcher: () => Promise<T>;
	staleWhileRevalidate?: boolean;
}): Promise<{ data: T; fromCache: boolean; fresh: boolean }> {
	const hit = await getSourceCache<T>({
		kind: opts.kind,
		sourceId: opts.sourceId,
		scope: opts.scope,
		ttlMs: opts.ttlMs
	});

	if (hit?.fresh) {
		return { data: hit.data, fromCache: true, fresh: true };
	}

	if (hit && opts.staleWhileRevalidate) {
		void (async () => {
			try {
				const data = await opts.fetcher();
				await putSourceCache({
					kind: opts.kind,
					sourceId: opts.sourceId,
					scope: opts.scope,
					data
				});
			} catch (e) {
				console.warn('[sourceJsonCache] background refresh failed', e);
			}
		})();
		return { data: hit.data, fromCache: true, fresh: false };
	}

	const data = await opts.fetcher();
	await putSourceCache({
		kind: opts.kind,
		sourceId: opts.sourceId,
		scope: opts.scope,
		data
	});
	return { data, fromCache: false, fresh: true };
}
