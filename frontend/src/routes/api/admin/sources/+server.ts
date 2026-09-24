import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getSourceList } from '$lib/server/sources';
import {
	getDisabledSourceIds,
	setSourceEnabled,
	setDisabledSourceIds,
	getSourceNotes,
	setSourceNote
} from '$lib/server/sourceConfig';
import { verifyAdminFromRequest } from '$lib/server/verifyAdmin';

export const GET: RequestHandler = async ({ request, locals, platform }) => {
	const auth = await verifyAdminFromRequest(request);
	if (!auth.ok) {
		return json({ error: auth.message }, { status: auth.status });
	}

	const kv = locals.kv ?? (platform as App.Platform | undefined)?.env?.MIKOROKU_CACHE ?? null;
	const all = getSourceList();
	const disabled = await getDisabledSourceIds(kv);
	const notes = await getSourceNotes(kv);
	const disabledSet = new Set(disabled.map((x) => x.toLowerCase()));

	const sources = all.map((s) => ({
		id: s.id,
		name: s.name,
		enabled: !disabledSet.has(s.id.toLowerCase()),
		note: notes[s.id.toLowerCase()] || ''
	}));

	return json({
		sources,
		disabledIds: disabled,
		notes,
		total: sources.length,
		enabledCount: sources.filter((s) => s.enabled).length,
		disabledCount: sources.filter((s) => !s.enabled).length
	});
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const auth = await verifyAdminFromRequest(request);
	if (!auth.ok) {
		return json({ error: auth.message }, { status: auth.status });
	}

	const kv = locals.kv ?? (platform as App.Platform | undefined)?.env?.MIKOROKU_CACHE ?? null;
	if (!kv) {
		return json({ error: 'KV not available' }, { status: 503 });
	}

	let body: {
		sourceId?: string;
		enabled?: boolean;
		disabledIds?: string[];
		note?: string;
		action?: string;
	};

	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const allIds = new Set(getSourceList().map((s) => s.id.toLowerCase()));

	// Save note
	if (body.action === 'note' && body.sourceId != null) {
		const id = String(body.sourceId).toLowerCase().trim();
		if (!allIds.has(id)) {
			return json({ error: `Unknown source: ${body.sourceId}` }, { status: 400 });
		}
		const notes = await setSourceNote(id, String(body.note ?? ''), kv);
		return json({ ok: true, sourceId: id, note: notes[id] || '', notes });
	}

	if (Array.isArray(body.disabledIds)) {
		const next = body.disabledIds
			.map((id) => String(id).toLowerCase().trim())
			.filter((id) => allIds.has(id));
		await setDisabledSourceIds(next, kv);
		return json({ ok: true, disabledIds: next });
	}

	if (body.sourceId != null && typeof body.enabled === 'boolean') {
		const id = String(body.sourceId).toLowerCase().trim();
		if (!allIds.has(id)) {
			return json({ error: `Unknown source: ${body.sourceId}` }, { status: 400 });
		}
		const disabledIds = await setSourceEnabled(id, body.enabled, kv);
		return json({
			ok: true,
			sourceId: id,
			enabled: body.enabled,
			disabledIds
		});
	}

	return json(
		{ error: 'Provide { sourceId, enabled }, { disabledIds }, or { action: "note", sourceId, note }' },
		{ status: 400 }
	);
};
