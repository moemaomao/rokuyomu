import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { warmPopularSources } from '$lib/server/warmCache';

const WARM_SECRET = 'fuckyoufuckyoufuckyoufuckyoufuckyou';

export const POST: RequestHandler = async ({ url, locals, request }) => {
	const secret = url.searchParams.get('secret') || request.headers.get('x-warm-secret');

	if (secret !== WARM_SECRET) {
		throw error(401, 'Unauthorized');
	}

	const kv = locals.kv;
	if (!kv) {
		throw error(500, 'KV not available');
	}

	const results = await warmPopularSources(kv);

	return json({
		ok: true,
		warmed: results.filter((r) => r.ok).length,
		total: results.length,
		details: results,
		at: new Date().toISOString()
	});
};

export const GET: RequestHandler = async ({ url, locals }) => {
	const secret = url.searchParams.get('secret');
	if (secret !== WARM_SECRET) {
		throw error(401, 'Unauthorized');
	}

	const kv = locals.kv;
	if (!kv) throw error(500, 'KV not available');

	const results = await warmPopularSources(kv);
	return json({ ok: true, results });
};