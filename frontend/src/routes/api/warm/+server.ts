import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { refreshPopularSources } from '$lib/server/refreshSources';

const WARM_SECRET = 'fuckyoufuckyoufuckyoufuckyoufuckyou';

function authorize(url: URL, request: Request): boolean {
	const secret =
		url.searchParams.get('secret') || request.headers.get('x-warm-secret');
	return secret === WARM_SECRET;
}

function parseForce(url: URL): boolean {
	const v = url.searchParams.get('force');
	return v === '1' || v === 'true';
}

export const POST: RequestHandler = async ({ url, locals, request }) => {
	if (!authorize(url, request)) {
		throw error(401, 'Unauthorized');
	}

	const kv = locals.kv;
	if (!kv) {
		throw error(500, 'KV not available');
	}

	const force = parseForce(url);
	const report = await refreshPopularSources(kv, { force });

	return json({
		ok: true,
		force: report.force,
		scraped: report.scraped,
		skipped: report.skipped,
		failed: report.failed,
		warmed: report.success,
		total: report.total,
		details: report.results,
		at: report.syncedAt
	});
};

export const GET: RequestHandler = async ({ url, locals, request }) => {
	if (!authorize(url, request)) {
		throw error(401, 'Unauthorized');
	}

	const kv = locals.kv;
	if (!kv) throw error(500, 'KV not available');

	const force = parseForce(url);
	const report = await refreshPopularSources(kv, { force });
	return json({ ok: true, ...report });
};