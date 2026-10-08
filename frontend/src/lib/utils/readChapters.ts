/**
 * Per-chapter read tracking for Rokuyomu detail page.
 *
 * History only stores the LAST chapter per manga — that is not enough to know
 * which chapters were actually opened. This module keeps a set of chapter IDs
 * (and optional numbers) the user has read, keyed by sourceId + mangaId.
 *
 * Storage: localStorage (lightweight, no IDB schema bump).
 */

import { browser } from '$app/environment';

const STORAGE_KEY = 'rokuyomu_read_chapters_v1';
const MAX_MANGA_KEYS = 200;
const MAX_CHAPTERS_PER_MANGA = 2000;

type ReadRecord = {
	ids: string[];
	nums: number[];
	updatedAt: number;
};

type StoreShape = Record<string, ReadRecord>;

function mangaKey(sourceId: string, mangaId: string): string {
	let mid = String(mangaId || '').trim();
	if (mid && !mid.startsWith('/')) mid = '/' + mid;
	mid = mid.replace(/\/+$/, '') || '/';
	return `${sourceId || 'unknown'}::${mid}`;
}

function normalizeChapterId(id: unknown): string {
	return String(id ?? '').trim();
}

function readStore(): StoreShape {
	if (!browser) return {};
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as StoreShape;
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

function writeStore(store: StoreShape) {
	if (!browser) return;
	const entries = Object.entries(store);
	if (entries.length > MAX_MANGA_KEYS) {
		entries.sort((a, b) => (a[1].updatedAt || 0) - (b[1].updatedAt || 0));
		const drop = entries.length - MAX_MANGA_KEYS;
		for (let i = 0; i < drop; i++) delete store[entries[i][0]];
	}
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
	} catch {
	}
}

function trimRecord(rec: ReadRecord): ReadRecord {
	if (rec.ids.length > MAX_CHAPTERS_PER_MANGA) {
		rec.ids = rec.ids.slice(-MAX_CHAPTERS_PER_MANGA);
	}
	if (rec.nums.length > MAX_CHAPTERS_PER_MANGA) {
		rec.nums = rec.nums.slice(-MAX_CHAPTERS_PER_MANGA);
	}
	return rec;
}

export function markChapterRead(
	sourceId: string,
	mangaId: string,
	chapterId: unknown,
	chapterNumber?: unknown
): void {
	if (!browser || !mangaId) return;
	const key = mangaKey(sourceId, mangaId);
	const store = readStore();
	const rec: ReadRecord = store[key] || { ids: [], nums: [], updatedAt: 0 };
	const cid = normalizeChapterId(chapterId);
	if (cid && !rec.ids.includes(cid)) rec.ids.push(cid);
	const num = Number(chapterNumber);
	if (Number.isFinite(num) && num > 0 && !rec.nums.includes(num)) rec.nums.push(num);
	rec.updatedAt = Date.now();
	store[key] = trimRecord(rec);
	writeStore(store);
	if (browser) {
		window.dispatchEvent(
			new CustomEvent('read-chapters-changed', {
				detail: { sourceId, mangaId }
			})
		);
	}
}

export function isChapterRead(
	sourceId: string,
	mangaId: string,
	chapterId: unknown,
	chapterNumber?: unknown
): boolean {
	if (!browser || !mangaId) return false;
	const key = mangaKey(sourceId, mangaId);
	const store = readStore();
	const rec = store[key];
	if (!rec) return false;
	const cid = normalizeChapterId(chapterId);
	if (cid && rec.ids.includes(cid)) return true;
	const num = Number(chapterNumber);
	if (Number.isFinite(num) && num > 0 && rec.nums.includes(num)) return true;
	return false;
}

export function getReadSets(
	sourceId: string,
	mangaId: string
): { ids: Set<string>; nums: Set<number> } {
	if (!browser || !mangaId) return { ids: new Set(), nums: new Set() };
	const key = mangaKey(sourceId, mangaId);
	const rec = readStore()[key];
	if (!rec) return { ids: new Set(), nums: new Set() };
	return {
		ids: new Set(rec.ids.filter(Boolean)),
		nums: new Set(rec.nums.filter((n) => n > 0))
	};
}

export function unmarkChapterRead(
	sourceId: string,
	mangaId: string,
	chapterId: unknown,
	chapterNumber?: unknown
): void {
	if (!browser || !mangaId) return;
	const key = mangaKey(sourceId, mangaId);
	const store = readStore();
	const rec = store[key];
	if (!rec) return;
	const cid = normalizeChapterId(chapterId);
	if (cid) rec.ids = rec.ids.filter((x) => x !== cid);
	const num = Number(chapterNumber);
	if (Number.isFinite(num) && num > 0) rec.nums = rec.nums.filter((x) => x !== num);
	rec.updatedAt = Date.now();
	store[key] = rec;
	writeStore(store);
	if (browser) {
		window.dispatchEvent(
			new CustomEvent('read-chapters-changed', {
				detail: { sourceId, mangaId }
			})
		);
	}
}
