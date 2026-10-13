import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { verifyAdminFromRequest } from '$lib/server/verifyAdmin';
import { getAnnouncement, setAnnouncement } from '$lib/server/adminConfig';

export const GET: RequestHandler = async ({ request, locals }) => {
	const auth = await verifyAdminFromRequest(request);
	if (!auth.ok) {
		return json({ error: auth.message }, { status: auth.status });
	}
	const announcement = await getAnnouncement(locals.kv);
	return json({ ok: true, announcement });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const auth = await verifyAdminFromRequest(request);
	if (!auth.ok) {
		return json({ error: auth.message }, { status: auth.status });
	}
	if (!locals.kv) {
		return json({ error: 'KV not available' }, { status: 503 });
	}

	let body: { enabled?: boolean; message?: string; level?: 'info' | 'warning' | 'danger' };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const announcement = await setAnnouncement(body, locals.kv);
	return json({ ok: true, announcement });
};
