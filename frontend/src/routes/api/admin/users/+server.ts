import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { verifyAdminFromRequest } from '$lib/server/verifyAdmin';
import { getBannedUids, banUid, unbanUid, setBannedUids } from '$lib/server/adminConfig';

export const GET: RequestHandler = async ({ request, locals }) => {
	const auth = await verifyAdminFromRequest(request);
	if (!auth.ok) {
		return json({ error: auth.message }, { status: auth.status });
	}
	const banned = await getBannedUids(locals.kv);
	return json({ ok: true, banned });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const auth = await verifyAdminFromRequest(request);
	if (!auth.ok) {
		return json({ error: auth.message }, { status: auth.status });
	}
	if (!locals.kv) {
		return json({ error: 'KV not available' }, { status: 503 });
	}

	let body: { action?: string; uid?: string; banned?: string[] };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const action = body.action || 'list';

	if (action === 'ban' && body.uid) {
		const banned = await banUid(body.uid, locals.kv);
		return json({ ok: true, banned });
	}
	if (action === 'unban' && body.uid) {
		const banned = await unbanUid(body.uid, locals.kv);
		return json({ ok: true, banned });
	}
	if (action === 'set' && Array.isArray(body.banned)) {
		const banned = await setBannedUids(body.banned, locals.kv);
		return json({ ok: true, banned });
	}

	const banned = await getBannedUids(locals.kv);
	return json({ ok: true, banned });
};
