import { browser } from '$app/environment';

export type ThemeMode = 'dark' | 'light' | 'system';
export type GridSize = 'compact' | 'comfortable';

export type AppPreferences = {
	theme: ThemeMode;
	gridSize: GridSize;
	hideBadges: {
		status: boolean;
		type: boolean;
		source: boolean;
	};
	hideR18Sources: boolean;
	blurR18Covers: boolean;
	dontSaveHistory: boolean;
	autoClearHistoryDays: number;
	incognitoSession: boolean;
};

const STORAGE_KEY = 'rokuyomu_preferences';

const DEFAULTS: AppPreferences = {
	theme: 'dark',
	gridSize: 'compact',
	hideBadges: { status: false, type: false, source: false },
	hideR18Sources: false,
	blurR18Covers: false,
	dontSaveHistory: false,
	autoClearHistoryDays: 0,
	incognitoSession: false
};

function load(): AppPreferences {
	if (!browser) return { ...DEFAULTS, hideBadges: { ...DEFAULTS.hideBadges } };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULTS, hideBadges: { ...DEFAULTS.hideBadges } };
		const parsed = JSON.parse(raw) as Partial<AppPreferences>;
		return {
			...DEFAULTS,
			...parsed,
			hideBadges: { ...DEFAULTS.hideBadges, ...(parsed.hideBadges || {}) }
		};
	} catch {
		return { ...DEFAULTS, hideBadges: { ...DEFAULTS.hideBadges } };
	}
}

let prefs: AppPreferences = load();

export function getPreferences(): AppPreferences {
	return prefs;
}

export function setPreferences(partial: Partial<AppPreferences>): AppPreferences {
	if (!browser) {
		prefs = {
			...prefs,
			...partial,
			hideBadges: partial.hideBadges
				? { ...prefs.hideBadges, ...partial.hideBadges }
				: prefs.hideBadges
		};
		return prefs;
	}
	prefs = {
		...prefs,
		...partial,
		hideBadges: partial.hideBadges
			? { ...prefs.hideBadges, ...partial.hideBadges }
			: prefs.hideBadges
	};
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
	} catch {
	}
	window.dispatchEvent(new CustomEvent('preferences-changed', { detail: prefs }));
	return prefs;
}

export function subscribePreferences(cb: (p: AppPreferences) => void): () => void {
	if (!browser) return () => {};
	const handler = (e: Event) => {
		cb((e as CustomEvent<AppPreferences>).detail ?? getPreferences());
	};
	window.addEventListener('preferences-changed', handler);
	return () => window.removeEventListener('preferences-changed', handler);
}

export function resolveIsDark(theme: ThemeMode = prefs.theme): boolean {
	if (theme === 'dark') return true;
	if (theme === 'light') return false;
	if (!browser) return true;
	return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyThemeFromPreferences(theme?: ThemeMode): boolean {
	if (!browser) return true;
	const t = theme ?? getPreferences().theme;
	const dark = resolveIsDark(t);
	document.documentElement.classList.toggle('dark', dark);
	document.documentElement.classList.toggle('light', !dark);
	localStorage.setItem('darkMode', String(dark));
	return dark;
}

export function shouldSaveHistory(): boolean {
	const p = getPreferences();
	return !p.dontSaveHistory && !p.incognitoSession;
}
