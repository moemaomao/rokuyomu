import { browser } from '$app/environment';

export type ThemeMode =
	| 'dark'
	| 'light'
	| 'system'
	| 'miku'
	| 'miku-light'
	| 'luka'
	| 'luka-dark'
	| 'kagamine'
	| 'kagamine-dark'
	| 'kaito'
	| 'kaito-light'
	| 'meiko'
	| 'meiko-light'
	| 'gumi'
	| 'gumi-light';

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

const DARK_THEMES: ThemeMode[] = [
	'dark',
	'miku',
	'luka-dark',
	'kagamine-dark',
	'kaito',
	'meiko',
	'gumi'
];

function load(): AppPreferences {
	if (!browser) return { ...DEFAULTS, hideBadges: { ...DEFAULTS.hideBadges } };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULTS, hideBadges: { ...DEFAULTS.hideBadges } };
		const parsed = JSON.parse(raw) as Partial<AppPreferences>;
		// migrate removed themes
		const t = parsed.theme as string | undefined;
		if (t === 'amoled' || t === 'sepia' || t === 'midnight' || t === 'cyan' || t === 'pink') {
			parsed.theme = 'dark';
		}
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
		/* ignore */
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
	if (theme === 'system') {
		if (!browser) return true;
		return window.matchMedia('(prefers-color-scheme: dark)').matches;
	}
	return DARK_THEMES.includes(theme);
}

export function applyThemeFromPreferences(theme?: ThemeMode): boolean {
	if (!browser) return true;

	const t = theme ?? getPreferences().theme;
	const resolved: ThemeMode =
		t === 'system'
			? window.matchMedia('(prefers-color-scheme: dark)').matches
				? 'dark'
				: 'light'
			: t;

	const dark = resolveIsDark(t);

	document.documentElement.classList.toggle('dark', dark);
	document.documentElement.classList.toggle('light', !dark);
	document.documentElement.setAttribute('data-theme', resolved);

	const all = [
		'theme-dark',
		'theme-light',
		'theme-miku',
		'theme-miku-light',
		'theme-luka',
		'theme-luka-dark',
		'theme-kagamine',
		'theme-kagamine-dark',
		'theme-kaito',
		'theme-kaito-light',
		'theme-meiko',
		'theme-meiko-light',
		'theme-gumi',
		'theme-gumi-light'
	];
	all.forEach((c) => document.documentElement.classList.remove(c));
	document.documentElement.classList.add(`theme-${resolved}`);

	localStorage.setItem('darkMode', String(dark));
	localStorage.setItem('rokuyomu_theme', resolved);

	return dark;
}

export function shouldSaveHistory(): boolean {
	const p = getPreferences();
	return !p.dontSaveHistory && !p.incognitoSession;
}
