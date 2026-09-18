import { browser } from '$app/environment';

const STORAGE_KEY = 'mikoroku_preferred_sources';
const COOKIE_KEY = 'preferred_sources';

const DEFAULT_SOURCES: string[] = [];

export function getPreferredSources(): string[] {
	if (!browser) return DEFAULT_SOURCES;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw === null) return DEFAULT_SOURCES;
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : DEFAULT_SOURCES;
	} catch {
		return DEFAULT_SOURCES;
	}
}

export function setPreferredSources(ids: string[]): void {
	if (!browser) return;
	const clean = [...new Set(ids.filter(Boolean))];
	localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
	const value = encodeURIComponent(clean.join(','));
	document.cookie = `${COOKIE_KEY}=${value}; path=/; max-age=31536000; SameSite=Lax`;
	window.dispatchEvent(new CustomEvent('preferred-sources-changed'));
}

export function togglePreferredSource(id: string): string[] {
	const current = getPreferredSources();
	const next = current.includes(id)
		? current.filter((s) => s !== id)
		: [...current, id];
	setPreferredSources(next);
	return next;
}

export function parsePreferredFromCookie(cookieHeader: string | null): string[] {
	if (!cookieHeader) return DEFAULT_SOURCES;
	const match = cookieHeader.match(new RegExp(`${COOKIE_KEY}=([^;]+)`));
	if (!match) return DEFAULT_SOURCES;
	try {
		const decoded = decodeURIComponent(match[1]);
		return decoded
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
	} catch {
		return DEFAULT_SOURCES;
	}
}