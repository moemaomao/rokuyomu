export type CfSession = {
	cookieHeader: string;
	userAgent: string;
	expiresAt: number;
};

const jar = new Map<string, CfSession>();

function domainKey(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
}

export function getCfSession(url: string): CfSession | null {
	const key = domainKey(url);
	const s = jar.get(key);
	if (!s) return null;
	if (Date.now() >= s.expiresAt) {
		jar.delete(key);
		return null;
	}
	return s;
}

export function setCfSession(
	url: string,
	cookieHeader: string,
	userAgent: string,
	ttlMs = Number(process.env.CF_COOKIE_TTL_MS) || 15 * 60 * 1000
): void {
	const key = domainKey(url);
	jar.set(key, {
		cookieHeader,
		userAgent,
		expiresAt: Date.now() + ttlMs
	});
}

export function clearCfSession(url: string): void {
	jar.delete(domainKey(url));
}

/** Debug / health */
export function cfJarStats() {
	const now = Date.now();
	let alive = 0;
	for (const s of jar.values()) if (s.expiresAt > now) alive++;
	return { size: jar.size, alive };
}