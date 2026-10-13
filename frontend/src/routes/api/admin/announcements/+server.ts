import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { verifyAdminFromRequest } from '$lib/server/verifyAdmin';
import { getAnnouncement, setAnnouncement } from '$lib/server/adminConfig';

function getKv(locals: App.Locals, platform?: App.Platform) {
	return locals.kv ?? platform?.env?.MIKOROKU_CACHE ?? null;
}

export const GET: RequestHandler = async ({ request, locals, platform }) => {
	const auth = await verifyAdminFromRequest(request);
	if (!auth.ok) {
		return json({ error: auth.message }, { status: auth.status });
	}
	const announcement = await getAnnouncement(getKv(locals, platform));
	return json({ ok: true, announcement });
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const auth = await verifyAdminFromRequest(request);
	if (!auth.ok) {
		return json({ error: auth.message }, { status: auth.status });
	}

	const kv = getKv(locals, platform);
	if (!kv) {
		return json(
			{ error: 'KV not available. Pastikan binding MIKOROKU_CACHE aktif.' },
			{ status: 503 }
		);
	}

	let body: { enabled?: boolean; message?: string; level?: 'info' | 'warning' | 'danger' };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const announcement = await setAnnouncement(body, kv);
	return json({ ok: true, announcement });
};
