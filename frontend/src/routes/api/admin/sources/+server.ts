import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getSourceList } from '$lib/server/sources';
import {
	getDisabledSourceIds,
	setSourceEnabled,
	setDisabledSourceIds
} from '$lib/server/sourceConfig';
import { verifyAdminFromRequest } from '$lib/server/verifyAdmin';

/** GET — list all sources + enabled/disabled state (admin only) */
export const GET: RequestHandler = async ({ request, locals }) => {
	const auth = await verifyAdminFromRequest(request);
	if (!auth.ok) {
		return json({ error: auth.message }, { status: auth.status });
	}

	const all = getSourceList();
	const disabled = await getDisabledSourceIds(locals.kv);
	const disabledSet = new Set(disabled);

	const sources = all.map((s) => ({
		id: s.id,
		name: s.name,
		enabled: !disabledSet.has(s.id.toLowerCase())
	}));

	return json({
		sources,
		disabledIds: disabled,
		total: sources.length,
		enabledCount: sources.filter((s) => s.enabled).length,
		disabledCount: sources.filter((s) => !s.enabled).length
	});
};

/**
 * POST body:
 *   { sourceId: string, enabled: boolean }  — toggle one source
 *   { disabledIds: string[] }               — replace full disabled list
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const auth = await verifyAdminFromRequest(request);
	if (!auth.ok) {
		return json({ error: auth.message }, { status: auth.status });
	}

	if (!locals.kv) {
		return json({ error: 'KV not available' }, { status: 503 });
	}

	let body: {
		sourceId?: string;
		enabled?: boolean;
		disabledIds?: string[];
	};

	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const allIds = new Set(getSourceList().map((s) => s.id.toLowerCase()));

	if (Array.isArray(body.disabledIds)) {
		const next = body.disabledIds
			.map((id) => String(id).toLowerCase().trim())
			.filter((id) => allIds.has(id));
		await setDisabledSourceIds(next, locals.kv);
		return json({ ok: true, disabledIds: next });
	}

	if (body.sourceId != null && typeof body.enabled === 'boolean') {
		const id = String(body.sourceId).toLowerCase().trim();
		if (!allIds.has(id)) {
			return json({ error: `Unknown source: ${body.sourceId}` }, { status: 400 });
		}
		const disabledIds = await setSourceEnabled(id, body.enabled, locals.kv);
		return json({
			ok: true,
			sourceId: id,
			enabled: body.enabled,
			disabledIds
		});
	}

	return json(
		{ error: 'Provide { sourceId, enabled } or { disabledIds }' },
		{ status: 400 }
	);
};
