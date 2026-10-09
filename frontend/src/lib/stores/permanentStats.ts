import { browser } from '$app/environment';
import { doc, getDoc, runTransaction, type Firestore } from 'firebase/firestore';
import { db } from '$lib/firebase';
import { getUser } from '$lib/stores/auth.svelte';
import { isNovelSource } from '$lib/utils/novelSources';
import {
	idbGetPermanentStats,
	idbSetPermanentStats,
	type PermanentStatsDoc,
	type PermanentTitleMeta
} from '$lib/db';

const EMPTY: PermanentStatsDoc = {
	titles: {},
	sources: {},
	comicTitles: 0,
	novelTitles: 0,
	totalProgress: 0,
	chaptersReadEver: 0,
	updatedAt: 0
};

const LS_KEY = 'rokuyomu_permanent_stats_v1';
const MAX_TITLES = 800;

let cache: PermanentStatsDoc | null = null;
let loading: Promise<PermanentStatsDoc> | null = null;

function statsRef(uid: string, firestore: Firestore) {
	return doc(firestore, 'users', uid, 'stats', 'lifetime');
}

function normalizeId(id: string): string {
	let s = String(id || '').trim();
	if (!s) return '';
	if (!s.startsWith('/')) s = '/' + s;
	s = s.replace(/\/+$/, '');
	return s || '/';
}

function parseChapter(n: unknown): number {
	const v = Number(n);
	if (!Number.isFinite(v) || v <= 0) return 0;
	return Math.round(v * 10) / 10;
}

function recompute(doc: PermanentStatsDoc): PermanentStatsDoc {
	let comic = 0;
	let novel = 0;
	let progress = 0;
	const sources: Record<string, { count: number; isNovel: boolean }> = {};

	for (const meta of Object.values(doc.titles)) {
		if (meta.isNovel) novel++;
		else comic++;
		progress += meta.maxChapter || 0;
		const sid = meta.sourceId || 'unknown';
		if (!sources[sid]) sources[sid] = { count: 0, isNovel: !!meta.isNovel };
		sources[sid].count++;
	}

	return {
		...doc,
		comicTitles: comic,
		novelTitles: novel,
		totalProgress: Math.round(progress * 10) / 10,
		chaptersReadEver: Math.max(0, Number(doc.chaptersReadEver) || 0),
		sources,
		updatedAt: Date.now()
	};
}

function clampTitles(titles: Record<string, PermanentTitleMeta>): Record<string, PermanentTitleMeta> {
	const keys = Object.keys(titles);
	if (keys.length <= MAX_TITLES) return titles;
	const sorted = keys.sort((a, b) => (titles[a].lastRead || 0) - (titles[b].lastRead || 0));
	const drop = sorted.slice(0, keys.length - MAX_TITLES);
	const next = { ...titles };
	for (const k of drop) delete next[k];
	return next;
}

function readDoc(data: any): PermanentStatsDoc {
	if (!data || typeof data !== 'object') return { ...EMPTY, titles: {}, sources: {} };
	const raw = data.permanentStats && typeof data.permanentStats === 'object' ? data.permanentStats : data;
	const titles: Record<string, PermanentTitleMeta> = {};
	if (raw.titles && typeof raw.titles === 'object') {
		for (const [k, v] of Object.entries(raw.titles as Record<string, any>)) {
			if (!v || typeof v !== 'object') continue;
			titles[k] = {
				maxChapter: parseChapter(v.maxChapter),
				isNovel: !!v.isNovel,
				sourceId: String(v.sourceId || ''),
				title: String(v.title || '').slice(0, 120),
				lastRead: Number(v.lastRead) || 0
			};
		}
	}
	const base: PermanentStatsDoc = {
		titles,
		sources: {},
		comicTitles: 0,
		novelTitles: 0,
		totalProgress: 0,
		chaptersReadEver: Math.max(0, Number(raw.chaptersReadEver) || 0),
		updatedAt: Number(raw.updatedAt) || 0
	};
	return recompute(base);
}

function lsRead(uid: string): PermanentStatsDoc | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(LS_KEY + ':' + uid);
		if (!raw) return null;
		return readDoc(JSON.parse(raw));
	} catch {
		return null;
	}
}

function lsWrite(uid: string, doc: PermanentStatsDoc) {
	if (!browser) return;
	try {
		localStorage.setItem(LS_KEY + ':' + uid, JSON.stringify(doc));
	} catch {
	}
}

async function persistLocal(doc: PermanentStatsDoc) {
	cache = doc;
	try {
		await idbSetPermanentStats(doc);
	} catch (e) {
		console.error('[permanentStats] idb write failed', e);
	}
	const user = getUser();
	if (user) lsWrite(user.uid, doc);
	if (browser) {
		window.dispatchEvent(
			new CustomEvent('permanent-stats-changed', { detail: { totalProgress: doc.totalProgress } })
		);
	}
}

export function getCachedPermanentStats(): PermanentStatsDoc {
	return cache ?? { ...EMPTY, titles: {}, sources: {} };
}

export function hydratePermanentStats(): PermanentStatsDoc {
	if (cache) return cache;
	const user = getUser();
	if (user) {
		const fromLs = lsRead(user.uid);
		if (fromLs) {
			cache = fromLs;
			return fromLs;
		}
	}
	return { ...EMPTY, titles: {}, sources: {} };
}

export async function loadPermanentStats(): Promise<PermanentStatsDoc> {
	if (!browser) return { ...EMPTY, titles: {}, sources: {} };

	// IDB first
	try {
		const idb = await idbGetPermanentStats();
		if (idb && Object.keys(idb.titles || {}).length > 0) {
			cache = recompute(idb);
		}
	} catch {
	}

	hydratePermanentStats();

	const user = getUser();
	if (!user || !db) return cache ?? { ...EMPTY, titles: {}, sources: {} };

	if (loading) return loading;

	loading = (async () => {
		try {
			const snap = await getDoc(statsRef(user.uid, db!));
			if (snap.exists()) {
				const remote = readDoc(snap.data());
				const local = cache ?? { ...EMPTY, titles: {}, sources: {} };
				const mergedTitles = { ...local.titles };
				for (const [k, v] of Object.entries(remote.titles)) {
					const cur = mergedTitles[k];
					if (!cur || (v.maxChapter || 0) > (cur.maxChapter || 0)) {
						mergedTitles[k] = v;
					} else if (cur && v.lastRead > (cur.lastRead || 0)) {
						mergedTitles[k] = { ...cur, lastRead: v.lastRead, title: v.title || cur.title };
					}
				}
				const merged = recompute({ ...local, titles: mergedTitles });
				await persistLocal(merged);
				if (Object.keys(merged.titles).length > Object.keys(remote.titles).length) {
					await syncToCloud(merged);
				}
			}
		} catch (e) {
			console.error('[permanentStats] load failed', e);
		} finally {
			loading = null;
		}
		return cache ?? { ...EMPTY, titles: {}, sources: {} };
	})();

	return loading;
}

async function syncToCloud(docData: PermanentStatsDoc) {
	const user = getUser();
	if (!user || !db) return;
	try {
		const ref = statsRef(user.uid, db);
		await runTransaction(db, async (tx) => {
			const snap = await tx.get(ref);
			const existing = snap.exists() ? snap.data() : {};
			tx.set(
				ref,
				{
					...existing,
					permanentStats: {
						titles: docData.titles,
						comicTitles: docData.comicTitles,
						novelTitles: docData.novelTitles,
						totalProgress: docData.totalProgress,
						sources: docData.sources,
						updatedAt: docData.updatedAt
					}
				},
				{ merge: true }
			);
		});
	} catch (e) {
		console.error('[permanentStats] cloud sync failed', e);
	}
}

export type RecordReadingOpts = {
	mangaId: string;
	sourceId: string;
	chapterNumber?: unknown;
	mangaTitle?: string;
};

export async function recordPermanentReading(opts: RecordReadingOpts): Promise<PermanentStatsDoc> {
	if (!browser) return { ...EMPTY, titles: {}, sources: {} };

	const mangaKey = normalizeId(opts.mangaId);
	if (!mangaKey) return getCachedPermanentStats();

	const ch = parseChapter(opts.chapterNumber);
	const isNovel = isNovelSource(opts.sourceId);
	const sourceId = String(opts.sourceId || '').trim() || 'unknown';

	let docData = cache ?? (await loadPermanentStats());
	const titles = { ...docData.titles };
	const prev = titles[mangaKey];
	const prevMax = prev?.maxChapter || 0;
	const maxChapter = Math.max(prevMax, ch);
	const advanced = maxChapter > prevMax ? Math.ceil(maxChapter - prevMax) : 0;
	titles[mangaKey] = {
		maxChapter,
		isNovel: prev?.isNovel ?? isNovel,
		sourceId: sourceId || prev?.sourceId || 'unknown',
		title: (opts.mangaTitle || prev?.title || '').slice(0, 120),
		lastRead: Date.now()
	};

	docData = recompute({
		...docData,
		titles: clampTitles(titles),
		chaptersReadEver: (docData.chaptersReadEver || 0) + advanced
	});

	await persistLocal(docData);
	void syncToCloud(docData);
	return docData;
}

export async function bootstrapPermanentFromHistory(
	entries: {
		mangaId: string;
		sourceId?: string;
		chapterNumber?: unknown;
		mangaTitle?: string;
	}[]
): Promise<PermanentStatsDoc> {
	if (!browser || !entries?.length) return getCachedPermanentStats();

	let docData = cache ?? (await loadPermanentStats());
	const titles = { ...docData.titles };
	let changed = false;

	for (const e of entries) {
		const mangaKey = normalizeId(e.mangaId);
		if (!mangaKey) continue;
		const ch = parseChapter(e.chapterNumber);
		const isNovel = isNovelSource(e.sourceId);
		const sourceId = String(e.sourceId || '').trim() || 'unknown';
		const prev = titles[mangaKey];
		const maxChapter = Math.max(prev?.maxChapter || 0, ch);
		if (!prev || maxChapter > (prev.maxChapter || 0) || !prev.sourceId) {
			changed = true;
		}
		titles[mangaKey] = {
			maxChapter,
			isNovel: prev?.isNovel ?? isNovel,
			sourceId: sourceId || prev?.sourceId || 'unknown',
			title: (e.mangaTitle || prev?.title || '').slice(0, 120),
			lastRead: Math.max(prev?.lastRead || 0, Date.now())
		};
	}

	if (!changed && Object.keys(docData.titles).length > 0) {
		return docData;
	}

	docData = recompute({
		...docData,
		titles: clampTitles(titles)
	});
	await persistLocal(docData);
	void syncToCloud(docData);
	return docData;
}

export function permanentStatsView(docData: PermanentStatsDoc) {
	const comicTitles = docData.comicTitles || 0;
	const novelTitles = docData.novelTitles || 0;
	const totalTitles = comicTitles + novelTitles;
	const totalProgress = docData.chaptersReadEver || 0;

	let comicProgress = 0;
	let novelProgress = 0;
	let comicWeight = 0;
	let novelWeight = 0;
	for (const m of Object.values(docData.titles || {})) {
		if (m.isNovel) novelWeight += m.maxChapter || 0;
		else comicWeight += m.maxChapter || 0;
	}
	const w = comicWeight + novelWeight || 1;
	comicProgress = Math.round((totalProgress * comicWeight) / w);
	novelProgress = Math.max(0, totalProgress - comicProgress);

	const topSources = Object.entries(docData.sources || {})
		.map(([id, v]) => ({
			id,
			count: v.count,
			isNovel: v.isNovel
		}))
		.sort((a, b) => b.count - a.count)
		.slice(0, 8);

	return {
		comicTitles,
		novelTitles,
		totalTitles,
		comicProgress,
		novelProgress,
		totalProgress,
		topSources,
		sourceCount: Object.keys(docData.sources || {}).length
	};
}
