/**
 * Fetch + deteksi Cloudflare Challenge.
 * Di Workers tidak bisa solve challenge, jadi kalau ketahuan → throw
 * supaya bisa fallback ke scraper remote.
 */
export async function fetchWithCf(
	url: string,
	init?: RequestInit
): Promise<string> {
	const res = await fetch(url, {
		...init,
		cf: { cacheTtl: 0, cacheEverything: false } as any
	});

	const text = await res.text();

	if (isCloudflareChallenge(res, text)) {
		throw new Error(
			`Cloudflare challenge detected on ${url} (status ${res.status})`
		);
	}

	if (!res.ok) {
		throw new Error(`fetchWithCf failed ${res.status}: ${url}`);
	}

	return text;
}

function isCloudflareChallenge(res: Response, body: string): boolean {
	const lower = body.slice(0, 5000).toLowerCase();

	if (
		lower.includes('just a moment') ||
		lower.includes('cf-browser-verification') ||
		lower.includes('challenge-platform') ||
		lower.includes('cf-challenge') ||
		lower.includes('checking your browser') ||
		lower.includes('_cf_chl_opt') ||
		lower.includes('turnstile') ||
		(lower.includes('cloudflare') && lower.includes('ray id'))
	) {
		return true;
	}

	if ((res.status === 403 || res.status === 503) && res.headers.get('cf-ray')) {
		if (lower.includes('challenge') || lower.includes('captcha')) {
			return true;
		}
	}

	return false;
}