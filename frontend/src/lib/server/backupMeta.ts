
import type { Manga, MangaDetails } from '$lib/server/sources/types';
import { readCache } from '$lib/server/cache';

export const BACKUP_VERSION = 1;
export const BACKUP_TTL = 60 * 60 * 24 * 14;

const WESERV_W = 100;
const WESERV_Q = 75;

export type MangaMetaBackup = {
	id: string;
	title: string;
	cover: string;
	sourceId: string;
	type?: string;
	status?: string;
	latestChapter?: string | number;
	lang?: string;
	updatedAt?: number;
	description?: string;
	authors?: string[];
	genres?: string[];
};

export type SourceBackup = {
	sourceId: string;
	savedAt: string;
	version: number;
	items: MangaMetaBackup[];
};

export function backupKey(sourceId: string): string {
	return `backup:meta:${sourceId}`;
}

export function compressCover(url: string | undefined | null): string {
	if (!url || typeof url !== 'string') return '';
	const u = url.trim();
	if (!u) return '';
	if (u.startsWith('data:')) return u;
	if (/wsrv\.nl|images\.weserv\.nl/i.test(u)) return u;

	const target = u.replace(/^https?:\/\//i, '');
	const params = new URLSearchParams({
		url: target,
		w: String(WESERV_W),
		q: String(WESERV_Q),
		output: 'webp',
		n: '-1',
		we: '' 
	});

	return `https://wsrv.nl/?${params.toString()}&we`;
}

export function toMetaOnly(
	m: Manga | MangaDetails,
	sourceId: string
): MangaMetaBackup {
	const d = m as MangaDetails;
	return {
		id: m.id,
		title: m.title || '',
		cover: compressCover(m.cover),
		sourceId: m.sourceId || sourceId,
		type: m.type,
		status: m.status,
		latestChapter: m.latestChapter,
		lang: m.lang,
		updatedAt: m.updatedAt,
		description: typeof d.description === 'string' ? d.description : undefined,
		authors: Array.isArray(d.authors) ? d.authors : undefined,
		genres: Array.isArray(d.genres) ? d.genres : undefined
	};
}

export function listToBackupItems(
	list: Manga[],
	sourceId: string
): MangaMetaBackup[] {
	return (Array.isArray(list) ? list : []).map((m) => toMetaOnly(m, sourceId));
}

export async function saveSourceBackup(
	sourceId: string,
	items: MangaMetaBackup[],
	kv: KVNamespace
): Promise<void> {
	if (!kv || !sourceId || !items.length) return;

	const payload: SourceBackup = {
		sourceId,
		savedAt: new Date().toISOString(),
		version: BACKUP_VERSION,
		items
	};

	try {
		await kv.put(backupKey(sourceId), JSON.stringify(payload), {
			expirationTtl: BACKUP_TTL
		});
	} catch (e) {
		console.error('[Backup] put failed:', sourceId, e);
	}
}

export async function readSourceBackup(
	sourceId: string,
	kv?: KVNamespace | null
): Promise<SourceBackup | null> {
	if (!kv || !sourceId) return null;
	try {
		const raw = await readCache<SourceBackup>(backupKey(sourceId), kv);
		if (!raw || !Array.isArray(raw.items)) return null;
		return raw;
	} catch {
		return null;
	}
}

export async function fallbackBrowseList(
	sourceId: string,
	kv?: KVNamespace | null,
	limit = 24
): Promise<(Manga & { fromBackup?: boolean })[]> {
	const bak = await readSourceBackup(sourceId, kv);
	if (!bak?.items?.length) return [];
	return bak.items.slice(0, limit).map((m) => ({
		id: m.id,
		title: m.title,
		cover: m.cover,
		sourceId: m.sourceId || sourceId,
		type: m.type,
		status: m.status,
		latestChapter: m.latestChapter,
		lang: m.lang,
		updatedAt: m.updatedAt,
		fromBackup: true
	}));
}

export async function fallbackMangaDetails(
	sourceId: string,
	mangaId: string,
	kv?: KVNamespace | null
): Promise<MangaDetails | null> {
	const bak = await readSourceBackup(sourceId, kv);
	if (!bak?.items?.length) return null;

	const norm = (s: string) => s.replace(/^\/+/, '').toLowerCase();
	const want = norm(mangaId);

	const hit =
		bak.items.find((m) => norm(m.id) === want) ||
		bak.items.find((m) => norm(m.id).endsWith(want) || want.endsWith(norm(m.id)));

	if (!hit) return null;

	return {
		id: hit.id,
		title: hit.title,
		cover: hit.cover,
		sourceId: hit.sourceId || sourceId,
		type: hit.type,
		status: hit.status || 'Unknown',
		latestChapter: hit.latestChapter,
		lang: hit.lang,
		updatedAt: hit.updatedAt,
		description: hit.description || '',
		authors: hit.authors || [],
		genres: hit.genres || [],
		chapters: []
	};
}