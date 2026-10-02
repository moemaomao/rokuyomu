import { getCfSession, setCfSession, clearCfSession } from './cfCookieJar';
import { isByparrEnabled, solveWithByparr } from './byparr';
const CF_MARKERS = [
	'just a moment...',
	'cf-browser-verification',
	'verify you are human',
	'checking your browser',
	'enable javascript and cookies to continue',
	'cf-chl-captcha',
	'cf-challenge',
	'challenge-platform',
	'attention required'
];

export function isCloudflareChallenge(status: number, html: string): boolean {
	const lower = html.slice(0, 15000).toLowerCase(); // cek bagian awal saja

	if (
		lower.includes('just a moment...') ||
		lower.includes('cf-browser-verification') ||
		lower.includes('checking your browser') ||
		lower.includes('enable javascript and cookies to continue') ||
		(lower.includes('attention required') && lower.includes('cloudflare'))
	) {
		return true;
	}

	if (
		lower.includes('challenge-platform') &&
		(lower.includes('just a moment') || lower.includes('turnstile') || lower.includes('_cf_chl'))
	) {
		return true;
	}

	if ((status === 403 || status === 503) && /cf-ray|cloudflare/i.test(html.slice(0, 5000))) {
		if (lower.includes('challenge') || lower.includes('captcha')) return true;
	}

	return false;
}

export type FetchWithCfOptions = {
	headers?: Record<string, string>;
	preferSolverBody?: boolean;
};

export async function fetchWithCf(
	url: string,
	opts: FetchWithCfOptions = {}
): Promise<string> {
	const baseHeaders: Record<string, string> = {
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		...opts.headers
	};

	const session = getCfSession(url);
	const headers: Record<string, string> = { ...baseHeaders };
	if (session) {
		headers['Cookie'] = session.cookieHeader;
		headers['User-Agent'] = session.userAgent;
	}

	const res = await fetch(url, { headers, redirect: 'follow' });
	const html = await res.text();

	if (!isCloudflareChallenge(res.status, html)) {
		if (!res.ok) {
			throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
		}
		return html;
	}

	if (!isByparrEnabled()) {
		throw new Error(
			`Cloudflare challenge on ${url} (Byparr disabled; set BYPARR_URL)`
		);
	}

	console.warn(`[cf] challenge detected → Byparr: ${url}`);
	clearCfSession(url);

	const solved = await solveWithByparr(url);
	if (!solved.cookieHeader) {
		throw new Error(`Byparr returned no cookies for ${url}`);
	}

	setCfSession(url, solved.cookieHeader, solved.userAgent);

	if (opts.preferSolverBody !== false && solved.html && !isCloudflareChallenge(200, solved.html)) {
		return solved.html;
	}

	const retryHeaders: Record<string, string> = {
		...baseHeaders,
		Cookie: solved.cookieHeader,
		'User-Agent': solved.userAgent
	};
	const retry = await fetch(url, { headers: retryHeaders, redirect: 'follow' });
	const retryHtml = await retry.text();

	if (isCloudflareChallenge(retry.status, retryHtml)) {
		clearCfSession(url);
		throw new Error(`CF still blocked after Byparr for ${url}`);
	}
	if (!retry.ok) {
		throw new Error(`Failed to fetch ${url} after CF solve: ${retry.status}`);
	}
	return retryHtml;
}