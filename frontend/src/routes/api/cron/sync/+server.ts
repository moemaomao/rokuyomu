import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { syncPopularSources } from '$lib/server/syncSources';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ request, platform }) => {
	const secret = request.headers.get('x-cron-secret');
	const expected = env.CRON_SECRET || 'ganti-secret-ini';

	if (!secret || secret !== expected) {
		throw error(401, 'Unauthorized');
	}

	const kv = platform?.env?.MIKOROKU_CACHE;
	if (!kv) {
		throw error(500, 'KV not available');
	}

	const result = await syncPopularSources(kv);
	return json(result);
};

// GET juga boleh (buat test manual)
export const GET: RequestHandler = async (event) => {
	return POST(event);
};