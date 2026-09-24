import { browser } from '$app/environment';

const STORAGE_KEY = 'mikoroku_impl';
const MODE_KEY = 'mikoroku_browse_mode';
const COOKIE_SOURCE = 'last_source';
const COOKIE_MODE = 'browse_mode';

function writeCookie(name: string, value: string, maxAge = 31536000) {
	if (!browser) return;
	document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

function clearCookie(name: string) {
	if (!browser) return;
	document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
}

export function getImpl(): string | null {
	if (!browser) return null;
	return localStorage.getItem(STORAGE_KEY);
}

export function setImpl(implId: string): void {
	if (!browser) return;
	const id = String(implId || '').trim();
	if (!id) return;
	localStorage.setItem(STORAGE_KEY, id);
	localStorage.setItem(MODE_KEY, 'single');
	writeCookie(COOKIE_SOURCE, id);
	writeCookie(COOKIE_MODE, 'single');
}

export function setMultiMode(): void {
	if (!browser) return;
	localStorage.setItem(MODE_KEY, 'multi');
	writeCookie(COOKIE_MODE, 'multi');
}

export function isMultiMode(): boolean {
	if (!browser) return false;
	return localStorage.getItem(MODE_KEY) === 'multi';
}

export function clearImpl(): void {
	if (!browser) return;
	localStorage.removeItem(STORAGE_KEY);
	clearCookie(COOKIE_SOURCE);
}

export function parseLastSourceFromCookie(cookieHeader: string | null): string | null {
	if (!cookieHeader) return null;
	const modeMatch = cookieHeader.match(/(?:^|;\s*)browse_mode=([^;]*)/);
	const mode = modeMatch ? decodeURIComponent(modeMatch[1].trim()) : '';
	if (mode === 'multi') return null;
	const match = cookieHeader.match(/(?:^|;\s*)last_source=([^;]*)/);
	if (!match) return null;
	try {
		const id = decodeURIComponent(match[1].trim());
		return id || null;
	} catch {
		return null;
	}
}
