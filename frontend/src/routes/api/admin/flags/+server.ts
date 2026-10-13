import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { verifyAdminFromRequest } from '$lib/server/verifyAdmin';
import { getFeatureFlags, setFeatureFlags, type FeatureFlags } from '$lib/server/adminConfig';

export const GET: RequestHandler = async ({ request, locals }) => {
	const auth = await verifyAdminFromRequest(request);
	if (!auth.ok) {
		return json({ error: auth.message }, { status: auth.status });
	}
	const flags = await getFeatureFlags(locals.kv);
	return json({ ok: true, flags });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const auth = await verifyAdminFromRequest(request);
	if (!auth.ok) {
		return json({ error: auth.message }, { status: auth.status });
	}
	if (!locals.kv) {
		return json({ error: 'KV not available' }, { status: 503 });
	}

	let body: { flags?: FeatureFlags; key?: string; value?: boolean };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	let next: FeatureFlags;
	if (body.flags && typeof body.flags === 'object') {
		next = await setFeatureFlags(body.flags, locals.kv);
	} else if (body.key != null && typeof body.value === 'boolean') {
		const current = await getFeatureFlags(locals.kv);
		current[String(body.key)] = body.value;
		next = await setFeatureFlags(current, locals.kv);
	} else {
		return json({ error: 'Provide { flags } or { key, value }' }, { status: 400 });
	}

	return json({ ok: true, flags: next });
};
