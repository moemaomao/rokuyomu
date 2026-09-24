import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { isValidSource } from '$lib/server/sources';
import { verifyAdminFromRequest } from '$lib/server/verifyAdmin';
import { remoteLatest } from '$lib/server/scraperClient';

const TIMEOUT_MS = 8000;

export const POST: RequestHandler = async ({ request }) => {
	const auth = await verifyAdminFromRequest(request);
	if (!auth.ok) {
		return json({ error: auth.message }, { status: auth.status });
	}

	let body: { sourceId?: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const sourceId = String(body.sourceId || '')
		.toLowerCase()
		.trim();
	if (!sourceId || !isValidSource(sourceId)) {
		return json({ error: 'Invalid sourceId' }, { status: 400 });
	}

	const started = Date.now();
	try {
		const result = await Promise.race([
			remoteLatest(sourceId, 1, {}),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)
			)
		]);
		const ms = Date.now() - started;
		const count = Array.isArray(result) ? result.length : 0;
		return json({
			ok: true,
			sourceId,
			ms,
			count,
			status: count > 0 ? 'healthy' : 'empty',
			message: count > 0 ? `OK — ${count} items in ${ms}ms` : `Empty list (${ms}ms)`
		});
	} catch (e: unknown) {
		const ms = Date.now() - started;
		const msg = e instanceof Error ? e.message : String(e);
		const isTimeout = msg === 'timeout' || /timeout/i.test(msg);
		return json({
			ok: false,
			sourceId,
			ms,
			count: 0,
			status: isTimeout ? 'timeout' : 'error',
			message: isTimeout ? `Timeout after ${TIMEOUT_MS}ms` : msg.slice(0, 200)
		});
	}
};
