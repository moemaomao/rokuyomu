import { getPreferences, type AppPreferences, type GridSize } from '$lib/stores/preferences';
import { getSourceMeta } from '$lib/utils/sourceMeta';

export function currentPrefs(): AppPreferences {
	return getPreferences();
}

export function homepageGridClass(size?: GridSize): string {
	const s = size ?? getPreferences().gridSize;
	if (s === 'comfortable') {
		return 'grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';
	}
	return 'grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8';
}

export function shouldHideBadge(
	kind: 'status' | 'type' | 'source',
	prefs?: AppPreferences
): boolean {
	const p = prefs ?? getPreferences();
	return Boolean(p.hideBadges?.[kind]);
}

export function shouldHideR18Source(sourceId: string, prefs?: AppPreferences): boolean {
	const p = prefs ?? getPreferences();
	if (!p.hideR18Sources) return false;
	try {
		return Boolean(getSourceMeta(sourceId)?.isR18);
	} catch {
		return false;
	}
}

export function shouldBlurR18Cover(sourceId: string, prefs?: AppPreferences): boolean {
	const p = prefs ?? getPreferences();
	if (!p.blurR18Covers) return false;
	try {
		return Boolean(getSourceMeta(sourceId)?.isR18);
	} catch {
		return false;
	}
}

export function filterSourcesByR18Pref<T extends { id: string }>(
	sources: T[],
	prefs?: AppPreferences
): T[] {
	const p = prefs ?? getPreferences();
	if (!p.hideR18Sources) return sources;
	return sources.filter((s) => !shouldHideR18Source(s.id, p));
}

export function r18CoverClass(sourceId: string, prefs?: AppPreferences): string {
	return shouldBlurR18Cover(sourceId, prefs) ? 'blur-md scale-105 select-none' : '';
}
