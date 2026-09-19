/**
 * NSFW / R18 age-gate helpers.
 * Confirmation is stored in localStorage so the user is only asked once.
 */
import { browser } from '$app/environment';

export const NSFW_STORAGE_KEY = 'rokuyomu_nsfw_confirmed';

export function isNsfwConfirmed(): boolean {
	if (!browser) return false;
	try {
		return localStorage.getItem(NSFW_STORAGE_KEY) === '1';
	} catch {
		return false;
	}
}

export function setNsfwConfirmed(value = true): void {
	if (!browser) return;
	try {
		if (value) {
			localStorage.setItem(NSFW_STORAGE_KEY, '1');
		} else {
			localStorage.removeItem(NSFW_STORAGE_KEY);
		}
	} catch {
		/* ignore quota / private mode */
	}
}

export function clearNsfwConfirmed(): void {
	setNsfwConfirmed(false);
}
