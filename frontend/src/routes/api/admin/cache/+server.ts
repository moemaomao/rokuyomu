import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { verifyAdminFromRequest } from '$lib/server/verifyAdmin';
import { deleteCache } from '$lib/server/cache';

export const POST: RequestHandler = async ({ request, locals }) => {
	const auth = await verifyAdminFromRequest(request);
	if (!auth.ok) {
		return json({ error: auth.message }, { status: auth.status });
	}

	const kv = locals.kv;
	if (!kv) {
		return json({ error: 'KV not available' }, { status: 503 });
	}

	let body: { key?: string; prefix?: string; action?: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const action = body.action || (body.key ? 'delete' : body.prefix ? 'purge_prefix' : '');

	if (action === 'list' || action === 'purge_prefix') {
		const prefix = String(body.prefix || '').trim();
		try {
			const listed = await kv.list({ prefix: prefix || undefined, limit: 100 });
			const keys = listed.keys.map((k) => k.name);

			if (action === 'list') {
				return json({ ok: true, keys, count: keys.length, cursor: listed.list_complete ? null : listed.cursor });
			}

			let deleted = 0;
			for (const k of keys) {
				await deleteCache(k, kv);
				deleted++;
			}
			return json({ ok: true, deleted, keys, prefix });
		} catch (e: unknown) {
			return json(
				{ error: e instanceof Error ? e.message : 'KV list/purge failed' },
				{ status: 500 }
			);
		}
	}

	if (action === 'delete' && body.key) {
		const key = String(body.key).trim();
		if (!key) return json({ error: 'Empty key' }, { status: 400 });
		await deleteCache(key, kv);
		return json({ ok: true, deleted: 1, key });
	}

	return json(
		{
			error:
				'Provide { key }, { prefix } (purge), or { action: "list", prefix? }'
		},
		{ status: 400 }
	);
};
