/**
 * Lifetime XP store — permanent, monotonic XP in Firestore.
 * Path: users/{uid}/stats/lifetime
 *
 * XP sources:
 * - New title (mangaId first time)  → +25
 * - New source                      → +8
 * - New bookmark                    → +20
 * - Chapter progress (same series)  → +XP per chapter advanced past max seen
 *   (cannot re-farm old chapters; only highest chapter per title counts)
 */
import { browser } from '$app/environment';
import {
	doc,
	getDoc,
	runTransaction,
	type Firestore
} from 'firebase/firestore';
import { db } from '$lib/firebase';
import { getUser } from '$lib/stores/auth.svelte';
import { computeTotalXp } from '$lib/utils/level';

export type LifetimeStats = {
	totalXp: number;
	titlesEver: number;
	bookmarksEver: number;
	sourcesEver: number;
	chapterXpEver: number;
	/** mangaId keys already counted toward titlesEver (+ bm: keys for bookmarks) */
	seenTitles: string[];
	/** sourceId keys already counted toward sourcesEver */
	seenSources: string[];
	/**
	 * Highest chapter number already granted per mangaId.
	 * Key = normalized mangaId, value = max chapter number.
	 */
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

/** Cap arrays so the doc stays small */
const MAX_SEEN = 500;
/** Max keys kept in maxChapterByTitle map */
const MAX_CHAPTER_MAP = 400;

/**
 * XP granted per chapter number advanced on the same title.
 * Example: was at ch.5, now read ch.12 → (12-5)*5 = 35 XP
 */
export const XP_PER_CHAPTER = 5;

/**
 * Bonus on first time a title is seen (in addition to chapter XP).
 */
export const XP_NEW_TITLE = 25;

/**
 * Bonus on first time a source is used.
 */
export const XP_NEW_SOURCE = 8;

/**
 * Bonus on first bookmark of a title.
 */
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
	// Keep most recent keys by insertion order (object key order)
	const keep = keys.slice(-MAX_CHAPTER_MAP);
	const out: Record<string, number> = {};
	for (const k of keep) out[k] = map[k];
	return out;
}

function readStats(data: Partial<LifetimeStats> | Record<string, unknown> | undefined): LifetimeStats {
	const d = (data || {}) as any;
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

/**
 * Load lifetime stats for current user (or return empty if guest).
 */
export async function loadLifetimeStats(): Promise<LifetimeStats> {
	if (!browser || !db) return { ...EMPTY, maxChapterByTitle: {} };
	const user = getUser();
	if (!user) {
		cache = { ...EMPTY, maxChapterByTitle: {} };
		return cache;
	}

	if (loading) return loading;

	loading = (async () => {
		try {
			const snap = await getDoc(statsRef(user.uid, db!));
			cache = snap.exists() ? readStats(snap.data() as any) : { ...EMPTY, maxChapterByTitle: {} };
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

/**
 * Bootstrap: seed lifetime from current local counts if doc is empty / lower.
 * Also seeds maxChapterByTitle from history entries when provided.
 */
export async function bootstrapLifetimeFromLocal(opts: {
	titleCount: number;
	bookmarkCount: number;
	sourceCount: number;
	chapterProgressXpSum: number;
	titleIds?: string[];
	sourceIds?: string[];
	/** optional: { mangaId, chapterNumber }[] from history to seed max chapters */
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
			const cur = snap.exists() ? readStats(snap.data() as any) : { ...EMPTY, maxChapterByTitle: {} };

			const curXp = cur.totalXp;

			// Merge max chapters from local history (never lower existing)
			const maxMap = { ...cur.maxChapterByTitle };
			if (opts.chapterProgress) {
				for (const e of opts.chapterProgress) {
					const id = normalizeId(e.mangaId);
					const ch = parseChapter(e.chapterNumber);
					if (!id || ch <= 0) continue;
					maxMap[id] = Math.max(maxMap[id] || 0, ch);
				}
			}

			// Only raise totalXp / counters, never lower
			if (localXp <= curXp && snap.exists()) {
				const next: LifetimeStats = {
					...cur,
					maxChapterByTitle: clampChapterMap(maxMap),
					updatedAt: Date.now()
				};
				// Still persist maxChapter map if it grew
				const mapGrew =
					Object.keys(maxMap).length > Object.keys(cur.maxChapterByTitle).length ||
					Object.keys(maxMap).some((k) => (maxMap[k] || 0) > (cur.maxChapterByTitle[k] || 0));
				if (mapGrew) {
					tx.set(ref, next, { merge: true });
				}
				cache = next;
				return;
			}

			const titles = Math.max(cur.titlesEver, opts.titleCount | 0);
			const bookmarks = Math.max(cur.bookmarksEver, opts.bookmarkCount | 0);
			const sources = Math.max(cur.sourcesEver, opts.sourceCount | 0);
			const chapterXp = Math.max(cur.chapterXpEver, opts.chapterProgressXpSum | 0);

			const seenTitles = clampSeen([
				...new Set([
					...cur.seenTitles,
					...(opts.titleIds || []).map(normalizeId).filter(Boolean)
				])
			]);
			const seenSources = clampSeen([
				...new Set([...cur.seenSources, ...(opts.sourceIds || []).map(String).filter(Boolean)])
			]);

			const next: LifetimeStats = {
				totalXp: Math.max(curXp, localXp),
				titlesEver: titles,
				bookmarksEver: bookmarks,
				sourcesEver: sources,
				chapterXpEver: chapterXp,
				seenTitles,
				seenSources,
				maxChapterByTitle: clampChapterMap(maxMap),
				updatedAt: Date.now()
			};
			tx.set(ref, next, { merge: true });
			cache = next;
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

/**
 * Grant XP when user reads a chapter.
 *
 * - First time title  → +XP_NEW_TITLE
 * - First time source → +XP_NEW_SOURCE
 * - Chapter progress  → +(newChapter - maxChapter) * XP_PER_CHAPTER
 *   Only when chapter number is HIGHER than previously granted for that title.
 *   Re-reading old chapters / same chapter → 0 chapter XP.
 */
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
			const cur = snap.exists()
				? readStats(snap.data() as any)
				: { ...EMPTY, maxChapterByTitle: {} };

			let delta = 0;
			const seenTitles = new Set(cur.seenTitles);
			const seenSources = new Set(cur.seenSources);
			const maxMap = { ...cur.maxChapterByTitle };

			// New title bonus
			if (!seenTitles.has(mangaKey)) {
				seenTitles.add(mangaKey);
				delta += XP_NEW_TITLE;
				cur.titlesEver += 1;
			}

			// New source bonus
			if (sourceKey && !seenSources.has(sourceKey)) {
				seenSources.add(sourceKey);
				delta += XP_NEW_SOURCE;
				cur.sourcesEver += 1;
			}

			// Chapter progress — only grant for chapters ABOVE previous max
			if (newChapter > 0) {
				const prevMax = maxMap[mangaKey] || 0;
				if (newChapter > prevMax) {
					const advanced = newChapter - prevMax;
					const chapterGain = advanced * XP_PER_CHAPTER;
					delta += chapterGain;
					cur.chapterXpEver += chapterGain;
					maxMap[mangaKey] = newChapter;
				}
			}

			if (delta <= 0) {
				// Still update cache so UI is consistent
				cache = cur;
				return;
			}

			cur.totalXp += delta;
			cur.seenTitles = clampSeen([...seenTitles]);
			cur.seenSources = clampSeen([...seenSources]);
			cur.maxChapterByTitle = clampChapterMap(maxMap);
			cur.updatedAt = Date.now();

			tx.set(ref, cur, { merge: true });
			cache = cur;
			granted = delta;
		});
	} catch (e) {
		console.error('[lifetimeXp] grantReadingXp failed', e);
	}

	if (granted > 0 && browser) {
		window.dispatchEvent(new CustomEvent('lifetime-xp-changed', { detail: { granted } }));
	}
	return granted;
}

/**
 * Grant XP when user adds a new bookmark.
 */
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
			const cur = snap.exists()
				? readStats(snap.data() as any)
				: { ...EMPTY, maxChapterByTitle: {} };

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
			cache = cur;
		});
	} catch (e) {
		console.error('[lifetimeXp] grantBookmarkXp failed', e);
	}

	if (granted > 0 && browser) {
		window.dispatchEvent(new CustomEvent('lifetime-xp-changed', { detail: { granted } }));
	}
	return granted;
}
