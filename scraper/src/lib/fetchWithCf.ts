import {
	getCfSession,
	setCfSession,
	clearCfSession,
	applyCfSessionHeaders
} from './cfCookieJar';
import { isByparrEnabled, solveWithByparr } from './byparr';

export function isCloudflareChallenge(status: number, html: string): boolean {
	const head = html.slice(0, 15000);
	const lower = head.toLowerCase();

	// ── Cloudflare classic ──────────────────────────────────────────
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
		(lower.includes('just a moment') ||
			lower.includes('turnstile') ||
			lower.includes('_cf_chl'))
	) {
		return true;
	}

	if ((status === 403 || status === 503) && /cf-ray|cloudflare/i.test(head.slice(0, 5000))) {
		if (lower.includes('challenge') || lower.includes('captcha')) return true;
	}

	if (
		lower.includes('stackprotect') ||
		lower.includes('/.stackprotect/') ||
		lower.includes('verification could not be completed') ||
		(lower.includes('please refresh the page to try again') &&
			(status === 401 || status === 403 || status === 503))
	) {
		return true;
	}

	if (status === 401 || status === 403 || status === 503) {
		if (
			lower.includes('captcha') ||
			lower.includes('bot detection') ||
			lower.includes('access denied') ||
			lower.includes('ray id') ||
			(lower.includes('verification') && lower.includes('refresh'))
		) {
			return true;
		}
	
		if (html.trim().length > 0 && html.trim().length < 2500) {
			if (
				lower.includes('javascript') ||
				lower.includes('enable cookies') ||
				lower.includes('browser') ||
				lower.includes('security check')
			) {
				return true;
			}
		}
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

	const headers = applyCfSessionHeaders(url, baseHeaders);
	const reused = Boolean(getCfSession(url));
	if (reused) {
		console.log(`[cf] reuse cookie ${safeHost(url)}`);
	}

	const res = await fetch(url, { headers, redirect: 'follow' });
	const html = await res.text();

	if (!isCloudflareChallenge(res.status, html)) {
		if (!res.ok) {
			throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
		}
		return html;
	}

	console.warn(`[cf] challenge detected → byparr: ${url}`);
	clearCfSession(url);

	if (!isByparrEnabled()) {
		throw new Error(
			`Cloudflare/StackProtect challenge on ${url} (Byparr disabled; set BYPARR_URL)`
		);
	}

	const solved = await solveWithByparr(url);
	if (!solved.cookieHeader) {
		throw new Error(`Byparr returned no cookies for ${url}`);
	}

	setCfSession(url, solved.cookieHeader, solved.userAgent);

	if (
		opts.preferSolverBody !== false &&
		solved.html &&
		!isCloudflareChallenge(200, solved.html)
	) {
		console.log(`[cf] using solver body ${safeHost(url)} len=${solved.html.length}`);
		return solved.html;
	}

	const retryHeaders = applyCfSessionHeaders(url, {
		...baseHeaders,
		Cookie: solved.cookieHeader,
		'User-Agent': solved.userAgent
	});

	const retry = await fetch(url, { headers: retryHeaders, redirect: 'follow' });
	const retryHtml = await retry.text();

	if (isCloudflareChallenge(retry.status, retryHtml)) {
		clearCfSession(url);
		throw new Error(`Still blocked after Byparr for ${url}`);
	}
	if (!retry.ok) {
		throw new Error(`Failed to fetch ${url} after solve: ${retry.status}`);
	}

	console.log(`[cf] ok after solve ${safeHost(url)} status=${retry.status}`);
	return retryHtml;
}

function safeHost(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
}
