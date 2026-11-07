import type { Manga } from '$lib/server/sources/types';

export interface DeepSearchCachePayload {
	key: string;
	results: Manga[];
	meta: {
		returned?: number;
		sourcesTried?: number;
		type?: string;
		hasMore?: boolean;
		totalMatched?: number;
	} | null;
	offset: number;
	hasMore: boolean;
	scrollY?: number;
	urlSearch?: string;
	query?: string;
	tags?: string[];
	typeFilter?: string;
	ts: number;
}

const SESSION_KEY = 'rokuyomu:deep-search:last';

let memoryCache: DeepSearchCachePayload | null = null;

export function getDeepSearchMemory(): DeepSearchCachePayload | null {
	return memoryCache;
}

export function setDeepSearchMemory(payload: DeepSearchCachePayload | null) {
	memoryCache = payload;
}

export function clearDeepSearchMemory() {
	memoryCache = null;
	try {
		if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(SESSION_KEY);
	} catch {
	}
}

export function persistDeepSearchToSession(payload: DeepSearchCachePayload) {
	memoryCache = payload;
	try {
		sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
	} catch {
	}
}

export function readDeepSearchFromSession(): DeepSearchCachePayload | null {
	try {
		const raw = sessionStorage.getItem(SESSION_KEY);
		if (!raw) return null;
		const data = JSON.parse(raw) as DeepSearchCachePayload;
		if (!data || Date.now() - (data.ts || 0) > 30 * 60 * 1000) return null;
		memoryCache = data;
		return data;
	} catch {
		return null;
	}
}
