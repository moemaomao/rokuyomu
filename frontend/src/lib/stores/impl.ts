import { browser } from '$app/environment';

const STORAGE_KEY = 'mikoroku_impl';
const MODE_KEY = 'mikoroku_browse_mode';
export function getImpl(): string | null {
	if (!browser) return null;
	return localStorage.getItem(STORAGE_KEY);
}

export function setImpl(implId: string): void {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, implId);
	localStorage.setItem(MODE_KEY, 'single');
}

export function setMultiMode(): void {
	if (!browser) return;
	localStorage.setItem(MODE_KEY, 'multi');
}

export function isMultiMode(): boolean {
	if (!browser) return false;
	return localStorage.getItem(MODE_KEY) === 'multi';
}