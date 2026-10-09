import { browser } from '$app/environment';
import {
	doc,
	getDoc,
	runTransaction,
	type Firestore
} from 'firebase/firestore';
import { db } from '$lib/firebase';
import { getUser } from '$lib/stores/auth.svelte';
import { computeTotalXp, chapterAdvanceXp, computeLevelInfo } from '$lib/utils/level';

export type LifetimeStats = {
	totalXp: number;
	titlesEver: number;
	bookmarksEver: number;
	sourcesEver: number;
	chapterXpEver: number;
	seenTitles: string[];
	seenSources: string[];
	maxChapterByTitle: Record<string, number>;
	updatedAt: number;
};

const EMPTY: LifetimeStats = {
	totalXp: 0,
	titlesEver: 0,
	bookmarksEver: 0,
	sourcesEver: 0,
	chapterXpEver: 0,
	seenTitles: [],
	seenSources: [],
	maxChapterByTitle: {},
	updatedAt: 0
};

const MAX_SEEN = 500;
const MAX_CHAPTER_MAP = 400;
const LS_KEY = 'rokuyomu_lifetime_xp_v1';

export const XP_PER_CHAPTER = 5;
export const XP_NEW_TITLE = 25;
export const XP_NEW_SOURCE = 8;
export const XP_NEW_BOOKMARK = 20;

let cache: LifetimeStats | null = null;
let loading: Promise<LifetimeStats> | null = null;

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

function clampSeen(arr: string[]): string[] {
	if (arr.length <= MAX_SEEN) return arr;
	return arr.slice(-MAX_SEEN);
}

function parseChapter(n: unknown): number {
	const v = Number(n);
	if (!Number.isFinite(v) || v <= 0) return 0;
	return Math.floor(v);
}

function clampChapterMap(map: Record<string, number>): Record<string, number> {
	const keys = Object.keys(map);
	if (keys.length <= MAX_CHAPTER_MAP) return map;
	const keep = keys.slice(-MAX_CHAPTER_MAP);
	const out: Record<string, number> = {};
	for (const k of keep) out[k] = map[k];
	return out;
}

function readStats(data: any): LifetimeStats {
	const d = data || {};
	const rawMap = d.maxChapterByTitle && typeof d.maxChapterByTitle === 'object' ? d.maxChapterByTitle : {};
	const maxChapterByTitle: Record<string, number> = {};
	for (const [k, v] of Object.entries(rawMap)) {
		const n = Number(v);
		if (Number.isFinite(n) && n > 0) maxChapterByTitle[String(k)] = Math.floor(n);
	}
	return {
		totalXp: Math.max(0, Number(d.totalXp) || 0),
		titlesEver: Math.max(0, Number(d.titlesEver) || 0),
		bookmarksEver: Math.max(0, Number(d.bookmarksEver) || 0),
		sourcesEver: Math.max(0, Number(d.sourcesEver) || 0),
		chapterXpEver: Math.max(0, Number(d.chapterXpEver) || 0),
		seenTitles: Array.isArray(d.seenTitles) ? d.seenTitles.map(String) : [],
		seenSources: Array.isArray(d.seenSources) ? d.seenSources.map(String) : [],
		maxChapterByTitle,
		updatedAt: Number(d.updatedAt) || 0
	};
}

function lsRead(uid: string): LifetimeStats | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(LS_KEY + ':' + uid);
		if (!raw) return null;
		return readStats(JSON.parse(raw));
	} catch {
		return null;
	}
}

function lsWrite(uid: string, stats: LifetimeStats) {
	if (!browser) return;
	try {
		localStorage.setItem(LS_KEY + ':' + uid, JSON.stringify(stats));
		localStorage.setItem(LS_KEY + ':last', JSON.stringify({ uid, ...stats }));
	} catch {
	}
}

function setCache(stats: LifetimeStats, uid?: string) {
	cache = stats;
	if (uid) lsWrite(uid, stats);
	if (browser) {
		window.dispatchEvent(new CustomEvent('lifetime-xp-changed', { detail: { totalXp: stats.totalXp } }));
	}
}

export function hydrateLifetimeFromLocalStorage(): LifetimeStats | null {
	if (!browser) return null;

	const user = getUser();
	let best = cache;

	if (user) {
		const fromLs = lsRead(user.uid);
		if (fromLs && (!best || fromLs.totalXp >= best.totalXp)) {
			best = fromLs;
		}
	}

	try {
		const raw = localStorage.getItem(LS_KEY + ':last');
		if (raw) {
			const fromLast = readStats(JSON.parse(raw));
			if (fromLast.totalXp > 0 && (!best || fromLast.totalXp >= best.totalXp)) {
				best = fromLast;
			}
		}
	} catch {
	}

	if (best) cache = best;
	return cache;
}

export async function loadLifetimeStats(): Promise<LifetimeStats> {
	if (!browser || !db) return { ...EMPTY, maxChapterByTitle: {} };
	const user = getUser();
	if (!user) {
		cache = { ...EMPTY, maxChapterByTitle: {} };
		return cache;
	}

	if (!cache) {
		const fromLs = lsRead(user.uid);
		if (fromLs) cache = fromLs;
	}

	if (loading) return loading;

	loading = (async () => {
		try {
			const snap = await getDoc(statsRef(user.uid, db!));
			if (snap.exists()) {
				const remote = readStats(snap.data());
				const localXp = cache?.totalXp ?? 0;
				if (remote.totalXp >= localXp) {
					setCache(remote, user.uid);
				} else {
					const merged = {
						...remote,
						totalXp: localXp,
						titlesEver: Math.max(remote.titlesEver, cache?.titlesEver ?? 0),
						bookmarksEver: Math.max(remote.bookmarksEver, cache?.bookmarksEver ?? 0),
						sourcesEver: Math.max(remote.sourcesEver, cache?.sourcesEver ?? 0),
						chapterXpEver: Math.max(remote.chapterXpEver, cache?.chapterXpEver ?? 0)
					};
					setCache(merged, user.uid);
				}
			} else if (!cache) {
				setCache({ ...EMPTY, maxChapterByTitle: {} }, user.uid);
			}
		} catch (e) {
			console.error('[lifetimeXp] load failed', e);
			cache = cache ?? { ...EMPTY, maxChapterByTitle: {} };
		} finally {
			loading = null;
		}
		return cache!;
	})();

	return loading;
}

export function getCachedLifetimeStats(): LifetimeStats {
	return cache ?? { ...EMPTY, maxChapterByTitle: {} };
}

export function effectiveXp(localXp: number): number {
	const life = cache?.totalXp ?? 0;
	return Math.max(life, localXp);
}

export async function bootstrapLifetimeFromLocal(opts: {
	titleCount: number;
	bookmarkCount: number;
	sourceCount: number;
	chapterProgressXpSum: number;
	titleIds?: string[];
	sourceIds?: string[];
	chapterProgress?: { mangaId: string; chapterNumber?: unknown }[];
}): Promise<LifetimeStats> {
	if (!browser || !db) return { ...EMPTY, maxChapterByTitle: {} };
	const user = getUser();
	if (!user) return { ...EMPTY, maxChapterByTitle: {} };

	const localXp = computeTotalXp({
		titleCount: opts.titleCount,
		bookmarkCount: opts.bookmarkCount,
		sourceCount: opts.sourceCount,
		chapterProgressXpSum: opts.chapterProgressXpSum
	});

	try {
		const ref = statsRef(user.uid, db);
		await runTransaction(db, async (tx) => {
			const snap = await tx.get(ref);
			const cur = snap.exists() ? readStats(snap.data()) : { ...EMPTY, maxChapterByTitle: {} };
			const curXp = cur.totalXp;

			const maxMap = { ...cur.maxChapterByTitle };
			if (opts.chapterProgress) {
				for (const e of opts.chapterProgress) {
					const id = normalizeId(e.mangaId);
					const ch = parseChapter(e.chapterNumber);
					if (!id || ch <= 0) continue;
					maxMap[id] = Math.max(maxMap[id] || 0, ch);
				}
			}

			if (localXp <= curXp && snap.exists()) {
				const next: LifetimeStats = {
					...cur,
					maxChapterByTitle: clampChapterMap(maxMap),
					updatedAt: Date.now()
				};
				tx.set(ref, next, { merge: true });
				setCache(next, user.uid);
				return;
			}

			const next: LifetimeStats = {
				totalXp: Math.max(curXp, localXp),
				titlesEver: Math.max(cur.titlesEver, opts.titleCount | 0),
				bookmarksEver: Math.max(cur.bookmarksEver, opts.bookmarkCount | 0),
				sourcesEver: Math.max(cur.sourcesEver, opts.sourceCount | 0),
				chapterXpEver: Math.max(cur.chapterXpEver, opts.chapterProgressXpSum | 0),
				seenTitles: clampSeen([
					...new Set([
						...cur.seenTitles,
						...(opts.titleIds || []).map(normalizeId).filter(Boolean)
					])
				]),
				seenSources: clampSeen([
					...new Set([...cur.seenSources, ...(opts.sourceIds || []).map(String).filter(Boolean)])
				]),
				maxChapterByTitle: clampChapterMap(maxMap),
				updatedAt: Date.now()
			};
			tx.set(ref, next, { merge: true });
			setCache(next, user.uid);
		});
	} catch (e) {
		console.error('[lifetimeXp] bootstrap failed', e);
	}

	return cache ?? { ...EMPTY, maxChapterByTitle: {} };
}

export type GrantReadingOpts = {
	mangaId: string;
	sourceId: string;
	chapterNumber?: unknown;
};

export async function grantReadingXp(opts: GrantReadingOpts): Promise<number> {
	if (!browser || !db) return 0;
	const user = getUser();
	if (!user) return 0;

	const mangaKey = normalizeId(opts.mangaId);
	const sourceKey = String(opts.sourceId || '').trim();
	if (!mangaKey) return 0;

	const newChapter = parseChapter(opts.chapterNumber);
	let granted = 0;

	try {
		const ref = statsRef(user.uid, db);
		await runTransaction(db, async (tx) => {
			const snap = await tx.get(ref);
			const cur = snap.exists() ? readStats(snap.data()) : { ...EMPTY, maxChapterByTitle: {} };

			let delta = 0;
			const seenTitles = new Set(cur.seenTitles);
			const seenSources = new Set(cur.seenSources);
			const maxMap = { ...cur.maxChapterByTitle };

			if (!seenTitles.has(mangaKey)) {
				seenTitles.add(mangaKey);
				delta += XP_NEW_TITLE;
				cur.titlesEver += 1;
			}

			if (sourceKey && !seenSources.has(sourceKey)) {
				seenSources.add(sourceKey);
				delta += XP_NEW_SOURCE;
				cur.sourcesEver += 1;
			}

			if (newChapter > 0) {
				const prevMax = maxMap[mangaKey] || 0;
				if (newChapter > prevMax) {
					const advanced = newChapter - prevMax;
					const levelNow = computeLevelInfo(cur.totalXp).lv;
					const chapterGain = chapterAdvanceXp(advanced, levelNow);
					delta += chapterGain;
					cur.chapterXpEver += chapterGain;
					maxMap[mangaKey] = newChapter;
				}
			}

			if (delta <= 0) {
				setCache(cur, user.uid);
				return;
			}

			cur.totalXp += delta;
			cur.seenTitles = clampSeen([...seenTitles]);
			cur.seenSources = clampSeen([...seenSources]);
			cur.maxChapterByTitle = clampChapterMap(maxMap);
			cur.updatedAt = Date.now();

			tx.set(ref, cur, { merge: true });
			setCache(cur, user.uid);
			granted = delta;
		});
	} catch (e) {
		console.error('[lifetimeXp] grantReadingXp failed', e);
	}

	return granted;
}

export async function grantBookmarkXp(mangaId: string): Promise<number> {
	if (!browser || !db) return 0;
	const user = getUser();
	if (!user) return 0;

	const key = normalizeId(mangaId);
	if (!key) return 0;

	let granted = 0;

	try {
		const ref = statsRef(user.uid, db);
		await runTransaction(db, async (tx) => {
			const snap = await tx.get(ref);
			const cur = snap.exists() ? readStats(snap.data()) : { ...EMPTY, maxChapterByTitle: {} };

			const seenTitles = new Set(cur.seenTitles);
			const bmKey = 'bm:' + key;
			if (seenTitles.has(bmKey)) return;

			seenTitles.add(bmKey);
			cur.bookmarksEver += 1;
			cur.totalXp += XP_NEW_BOOKMARK;
			cur.seenTitles = clampSeen([...seenTitles]);
			cur.updatedAt = Date.now();
			granted = XP_NEW_BOOKMARK;

			tx.set(ref, cur, { merge: true });
			setCache(cur, user.uid);
		});
	} catch (e) {
		console.error('[lifetimeXp] grantBookmarkXp failed', e);
	}

	return granted;
}

export function getInstantLifetimeXp(): number {
	hydrateLifetimeFromLocalStorage();
	return cache?.totalXp ?? 0;
}
