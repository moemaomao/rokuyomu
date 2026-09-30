const BYPARR_URL = (process.env.BYPARR_URL || '').replace(/\/$/, '');

export type ByparrResult = {
	html: string;
	cookieHeader: string;
	userAgent: string;
};

function cookiesToHeader(
	cookies: Array<{ name: string; value: string }> | undefined
): string {
	if (!Array.isArray(cookies) || !cookies.length) return '';
	return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

export function isByparrEnabled(): boolean {
	return Boolean(BYPARR_URL);
}

export async function solveWithByparr(
	url: string,
	opts?: { maxTimeoutMs?: number }
): Promise<ByparrResult> {
	if (!BYPARR_URL) {
		throw new Error('BYPARR_URL not set');
	}

	const maxTimeout = opts?.maxTimeoutMs ?? 60_000;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), maxTimeout + 5_000);

	try {
		const res = await fetch(`${BYPARR_URL}/v1`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				cmd: 'request.get',
				url,
				maxTimeout
			}),
			signal: controller.signal
		});

		if (!res.ok) {
			const t = await res.text().catch(() => '');
			throw new Error(`Byparr HTTP ${res.status}: ${t.slice(0, 200)}`);
		}

		const data = (await res.json()) as {
			status?: string;
			message?: string;
			solution?: {
				response?: string;
				cookies?: Array<{ name: string; value: string }>;
				userAgent?: string;
			};
		};

		if (data.status !== 'ok' || !data.solution) {
			throw new Error(`Byparr failed: ${data.message || data.status || 'unknown'}`);
		}

		const cookieHeader = cookiesToHeader(data.solution.cookies);
		const userAgent =
			data.solution.userAgent ||
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

		return {
			html: data.solution.response || '',
			cookieHeader,
			userAgent
		};
	} finally {
		clearTimeout(timer);
	}
}