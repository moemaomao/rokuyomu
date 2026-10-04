/**
 * Cloudflare / anti-bot session cookie jar
 * Path: scraper/src/lib/cfCookieJar.ts
 *
 * Stores per-host:
 *   - cookieHeader  (e.g. "cf_clearance=...; __cf_bm=...")
 *   - userAgent     (must match the UA used when clearance was obtained)
 *   - expiresAt     (TTL)
 *
 * Usage with fetchWithCf:
 *   const s = getCfSession(url);
 *   if (s) headers.Cookie = s.cookieHeader; headers['User-Agent'] = s.userAgent;
 *   // after Byparr solve:
 *   setCfSession(url, cookieHeader, userAgent);
 */
export type CfSession = {
	cookieHeader: string;
	userAgent: string;
	expiresAt: number;
	updatedAt: number;
	cookies?: Record<string, string>;
};

const jar = new Map<string, CfSession>();

export const DEFAULT_CF_TTL_MS =
	Number(typeof process !== 'undefined' ? process.env?.CF_COOKIE_TTL_MS : 0) ||
	20 * 60 * 1000;

function domainKey(url: string): string {
	try {
		const host = new URL(url).hostname.toLowerCase();
		return host.replace(/^www\./, '');
	} catch {
		return String(url).toLowerCase();
	}
}

function parseCookieHeader(header: string): Record<string, string> {
	const out: Record<string, string> = {};
	if (!header) return out;
	for (const part of header.split(';')) {
		const idx = part.indexOf('=');
		if (idx <= 0) continue;
		const name = part.slice(0, idx).trim();
		const value = part.slice(idx + 1).trim();
		if (!name) continue;
		out[name] = value;
	}
	return out;
}

function toCookieHeader(map: Record<string, string>): string {
	return Object.entries(map)
		.filter(([k, v]) => k && v != null && v !== '')
		.map(([k, v]) => `${k}=${v}`)
		.join('; ');
}

const PRIORITY_COOKIES = new Set([
	'cf_clearance',
	'cf_clearance',
	'__cf_bm',
	'__cfruid',
	'_cfuvid',
	'cf_chl_rc_i',
	'cf_chl_2'
]);

export function getCfSession(url: string): CfSession | null {
	const key = domainKey(url);
	const s = jar.get(key);
	if (!s) return null;
	if (Date.now() >= s.expiresAt) {
		jar.delete(key);
		if (typeof console !== 'undefined') {
			console.log(`[cf-jar] expired host=${key}`);
		}
		return null;
	}
	return s;
}

/**
 * @param url - any URL on the protected host
 * @param cookieHeader - full Cookie header or Set-Cookie-derived string
 * @param userAgent - UA used during solve (required for clearance validity)
 * @param ttlMs - lifetime; default CF_COOKIE_TTL_MS or 20 min
 * @param merge - if true, merge with existing cookies for host (default true)
 */
export function setCfSession(
	url: string,
	cookieHeader: string,
	userAgent: string,
	ttlMs: number = DEFAULT_CF_TTL_MS,
	merge = true
): void {
	const key = domainKey(url);
	const incoming = parseCookieHeader(cookieHeader || '');
	const prev = jar.get(key);

	let cookies: Record<string, string> = {};
	if (merge && prev?.cookies) {
		cookies = { ...prev.cookies };
	} else if (merge && prev?.cookieHeader) {
		cookies = parseCookieHeader(prev.cookieHeader);
	}

	for (const [k, v] of Object.entries(incoming)) {
		cookies[k] = v;
	}

	const header = toCookieHeader(cookies);
	if (!header) {
		if (typeof console !== 'undefined') {
			console.warn(`[cf-jar] skip empty cookies host=${key}`);
		}
		return;
	}

	const ua =
		(userAgent || '').trim() ||
		prev?.userAgent ||
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

	const now = Date.now();
	const session: CfSession = {
		cookieHeader: header,
		userAgent: ua,
		expiresAt: now + Math.max(60_000, ttlMs),
		updatedAt: now,
		cookies
	};

	jar.set(key, session);

	const hasClearance = Boolean(cookies['cf_clearance']);
	if (typeof console !== 'undefined') {
		console.log(
			`[cf-jar] saved host=${key} clearance=${hasClearance} cookies=${Object.keys(cookies).length} ttlMs=${ttlMs}`
		);
	}
}

export function clearCfSession(url: string): void {
	const key = domainKey(url);
	if (jar.delete(key) && typeof console !== 'undefined') {
		console.log(`[cf-jar] cleared host=${key}`);
	}
}

export function pruneCfJar(): number {
	const now = Date.now();
	let n = 0;
	for (const [k, s] of jar) {
		if (s.expiresAt <= now) {
			jar.delete(k);
			n++;
		}
	}
	return n;
}

export function clearAllCfSessions(): void {
	jar.clear();
}

export function cfJarStats(): {
	size: number;
	alive: number;
	hosts: Array<{ host: string; expiresInSec: number; hasClearance: boolean }>;
} {
	const now = Date.now();
	const hosts: Array<{ host: string; expiresInSec: number; hasClearance: boolean }> = [];
	let alive = 0;
	for (const [host, s] of jar) {
		const left = Math.max(0, Math.floor((s.expiresAt - now) / 1000));
		if (left > 0) alive++;
		const hasClearance =
			Boolean(s.cookies?.['cf_clearance']) ||
			/(?:^|;\s*)cf_clearance=/.test(s.cookieHeader);
		hosts.push({ host, expiresInSec: left, hasClearance });
	}
	return { size: jar.size, alive, hosts };
}

export function applyCfSessionHeaders(
	url: string,
	base: Record<string, string> = {}
): Record<string, string> {
	const headers = { ...base };
	const s = getCfSession(url);
	if (!s) return headers;
	if (!headers['Cookie'] && !headers['cookie']) {
		headers['Cookie'] = s.cookieHeader;
	}
	if (!headers['User-Agent'] && !headers['user-agent']) {
		headers['User-Agent'] = s.userAgent;
	}
	return headers;
}
