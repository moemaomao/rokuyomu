import { browser } from '$app/environment';
import {
    doc,
    getDoc,
    setDoc,
    runTransaction,
    type Firestore
} from 'firebase/firestore';
import { db } from '$lib/firebase';
import { getUser } from '$lib/stores/auth.svelte';
import {
    chapterProgressXp,
    computeTotalXp
} from '$lib/utils/level';

export type LifetimeStats = {
    totalXp: number;
    titlesEver: number;
    bookmarksEver: number;
    sourcesEver: number;
    chapterXpEver: number;
    seenTitles: string[];
    seenSources: string[];
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
    updatedAt: 0
};

const MAX_SEEN = 500;

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

export async function loadLifetimeStats(): Promise<LifetimeStats> {
    if (!browser || !db) return { ...EMPTY };
    const user = getUser();
    if (!user) {
        cache = { ...EMPTY };
        return cache;
    }

    if (loading) return loading;

    loading = (async () => {
        try {
            const snap = await getDoc(statsRef(user.uid, db!));
            if (snap.exists()) {
                const d = snap.data() as Partial<LifetimeStats>;
                cache = {
                    totalXp: Math.max(0, Number(d.totalXp) || 0),
                    titlesEver: Math.max(0, Number(d.titlesEver) || 0),
                    bookmarksEver: Math.max(0, Number(d.bookmarksEver) || 0),
                    sourcesEver: Math.max(0, Number(d.sourcesEver) || 0),
                    chapterXpEver: Math.max(0, Number(d.chapterXpEver) || 0),
                    seenTitles: Array.isArray(d.seenTitles) ? d.seenTitles.map(String) : [],
                    seenSources: Array.isArray(d.seenSources) ? d.seenSources.map(String) : [],
                    updatedAt: Number(d.updatedAt) || 0
                };
            } else {
                cache = { ...EMPTY };
            }
        } catch (e) {
            console.error('[lifetimeXp] load failed', e);
            cache = cache ?? { ...EMPTY };
        } finally {
            loading = null;
        }
        return cache!;
    })();

    return loading;
}

export function getCachedLifetimeStats(): LifetimeStats {
    return cache ?? { ...EMPTY };
}

export async function bootstrapLifetimeFromLocal(opts: {
    titleCount: number;
    bookmarkCount: number;
    sourceCount: number;
    chapterProgressXpSum: number;
    titleIds?: string[];
    sourceIds?: string[];
}): Promise<LifetimeStats> {
    if (!browser || !db) return { ...EMPTY };
    const user = getUser();
    if (!user) return { ...EMPTY };

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
            const cur = snap.exists()
                ? (snap.data() as Partial<LifetimeStats>)
                : {};

            const curXp = Math.max(0, Number(cur.totalXp) || 0);
            if (localXp <= curXp && snap.exists()) {
                cache = {
                    totalXp: curXp,
                    titlesEver: Math.max(0, Number(cur.titlesEver) || 0),
                    bookmarksEver: Math.max(0, Number(cur.bookmarksEver) || 0),
                    sourcesEver: Math.max(0, Number(cur.sourcesEver) || 0),
                    chapterXpEver: Math.max(0, Number(cur.chapterXpEver) || 0),
                    seenTitles: Array.isArray(cur.seenTitles) ? cur.seenTitles.map(String) : [],
                    seenSources: Array.isArray(cur.seenSources) ? cur.seenSources.map(String) : [],
                    updatedAt: Number(cur.updatedAt) || 0
                };
                return;
            }

            const titles = Math.max(
                Number(cur.titlesEver) || 0,
                opts.titleCount | 0
            );
            const bookmarks = Math.max(
                Number(cur.bookmarksEver) || 0,
                opts.bookmarkCount | 0
            );
            const sources = Math.max(
                Number(cur.sourcesEver) || 0,
                opts.sourceCount | 0
            );
            const chapterXp = Math.max(
                Number(cur.chapterXpEver) || 0,
                opts.chapterProgressXpSum | 0
            );

            const seenTitles = clampSeen([
                ...new Set([
                    ...(Array.isArray(cur.seenTitles) ? cur.seenTitles.map(String) : []),
                    ...(opts.titleIds || []).map(normalizeId).filter(Boolean)
                ])
            ]);
            const seenSources = clampSeen([
                ...new Set([
                    ...(Array.isArray(cur.seenSources) ? cur.seenSources.map(String) : []),
                    ...(opts.sourceIds || []).map(String).filter(Boolean)
                ])
            ]);

            const next: LifetimeStats = {
                totalXp: Math.max(curXp, localXp),
                titlesEver: titles,
                bookmarksEver: bookmarks,
                sourcesEver: sources,
                chapterXpEver: chapterXp,
                seenTitles,
                seenSources,
                updatedAt: Date.now()
            };
            tx.set(ref, next, { merge: true });
            cache = next;
        });
    } catch (e) {
        console.error('[lifetimeXp] bootstrap failed', e);
    }

    return cache ?? { ...EMPTY };
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

    const chapterXp = chapterProgressXp(opts.chapterNumber);
    let granted = 0;

    try {
        const ref = statsRef(user.uid, db);
        await runTransaction(db, async (tx) => {
            const snap = await tx.get(ref);
            const cur: LifetimeStats = snap.exists()
                ? {
                        totalXp: Math.max(0, Number((snap.data() as any).totalXp) || 0),
                        titlesEver: Math.max(0, Number((snap.data() as any).titlesEver) || 0),
                        bookmarksEver: Math.max(0, Number((snap.data() as any).bookmarksEver) || 0),
                        sourcesEver: Math.max(0, Number((snap.data() as any).sourcesEver) || 0),
                        chapterXpEver: Math.max(0, Number((snap.data() as any).chapterXpEver) || 0),
                        seenTitles: Array.isArray((snap.data() as any).seenTitles)
                            ? (snap.data() as any).seenTitles.map(String)
                            : [],
                        seenSources: Array.isArray((snap.data() as any).seenSources)
                            ? (snap.data() as any).seenSources.map(String)
                            : [],
                        updatedAt: Number((snap.data() as any).updatedAt) || 0
                    }
                : { ...EMPTY };

            let delta = 0;
            const seenTitles = new Set(cur.seenTitles);
            const seenSources = new Set(cur.seenSources);

            if (!seenTitles.has(mangaKey)) {
                seenTitles.add(mangaKey);
                delta += 25;
                cur.titlesEver += 1;
            }

            if (sourceKey && !seenSources.has(sourceKey)) {
                seenSources.add(sourceKey);
                delta += 8;
                cur.sourcesEver += 1;
            }

            delta += chapterXp;
            cur.chapterXpEver += chapterXp;

            if (delta <= 0) return;

            cur.totalXp += delta;
            cur.seenTitles = clampSeen([...seenTitles]);
            cur.seenSources = clampSeen([...seenSources]);
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
            const cur: LifetimeStats = snap.exists()
                ? {
                        totalXp: Math.max(0, Number((snap.data() as any).totalXp) || 0),
                        titlesEver: Math.max(0, Number((snap.data() as any).titlesEver) || 0),
                        bookmarksEver: Math.max(0, Number((snap.data() as any).bookmarksEver) || 0),
                        sourcesEver: Math.max(0, Number((snap.data() as any).sourcesEver) || 0),
                        chapterXpEver: Math.max(0, Number((snap.data() as any).chapterXpEver) || 0),
                        seenTitles: Array.isArray((snap.data() as any).seenTitles)
                            ? (snap.data() as any).seenTitles.map(String)
                            : [],
                        seenSources: Array.isArray((snap.data() as any).seenSources)
                            ? (snap.data() as any).seenSources.map(String)
                            : [],
                        updatedAt: Number((snap.data() as any).updatedAt) || 0
                    }
                : { ...EMPTY };

            const seenTitles = new Set(cur.seenTitles);
            const bmKey = 'bm:' + key;
            if (seenTitles.has(bmKey)) return;

            seenTitles.add(bmKey);
            cur.bookmarksEver += 1;
            cur.totalXp += 20;
            cur.seenTitles = clampSeen([...seenTitles]);
            cur.updatedAt = Date.now();
            granted = 20;

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
