import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { verifyAdminFromRequest } from '$lib/server/verifyAdmin';
import {
	getAnnouncementsStore,
	saveAnnouncementsStore,
	type AnnouncementItem,
	type AnnouncementLevel
} from '$lib/server/adminConfig';

function getKv(locals: App.Locals, platform?: App.Platform) {
	return locals.kv ?? platform?.env?.MIKOROKU_CACHE ?? null;
}

function newId(): string {
	return `ann_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const GET: RequestHandler = async ({ request, locals, platform }) => {
	const auth = await verifyAdminFromRequest(request);
	if (!auth.ok) {
		return json({ error: auth.message }, { status: auth.status });
	}
	const store = await getAnnouncementsStore(getKv(locals, platform));
	return json({ ok: true, ...store });
};

/**
 * POST body:
 *  { action: 'create', message, level? }
 *  { action: 'update', id, message?, level? }
 *  { action: 'delete', id }
 *  { action: 'activate', id }   — show this one on site
 *  { action: 'deactivate' }     — hide banner (keep list)
 *  legacy: { enabled, message, level } still accepted via create+activate
 */
export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const auth = await verifyAdminFromRequest(request);
	if (!auth.ok) {
		return json({ error: auth.message }, { status: auth.status });
	}

	const kv = getKv(locals, platform);
	if (!kv) {
		return json({ error: 'KV not available' }, { status: 503 });
	}

	let body: {
		action?: string;
		id?: string;
		message?: string;
		level?: AnnouncementLevel;
		enabled?: boolean;
	};
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const store = await getAnnouncementsStore(kv);
	const now = new Date().toISOString();
	let action = body.action || '';

	// Legacy form: { enabled, message, level }
	if (!action && (body.message != null || body.enabled != null)) {
		const message = String(body.message ?? '').trim();
		const level = (body.level || 'info') as AnnouncementLevel;
		if (body.enabled && message) {
			const id = newId();
			store.items.unshift({
				id,
				message,
				level,
				createdAt: now,
				updatedAt: now
			});
			store.activeId = id;
		} else if (!body.enabled) {
			store.activeId = null;
		}
		const next = await saveAnnouncementsStore(store, kv);
		return json({ ok: true, ...next });
	}

	if (action === 'create') {
		const message = String(body.message ?? '').trim();
		if (!message) return json({ error: 'Message required' }, { status: 400 });
		const item: AnnouncementItem = {
			id: newId(),
			message,
			level: (body.level || 'info') as AnnouncementLevel,
			createdAt: now,
			updatedAt: now
		};
		store.items.unshift(item);
		const next = await saveAnnouncementsStore(store, kv);
		return json({ ok: true, item, ...next });
	}

	if (action === 'update' && body.id) {
		const idx = store.items.findIndex((i) => i.id === body.id);
		if (idx < 0) return json({ error: 'Not found' }, { status: 404 });
		if (body.message != null) store.items[idx].message = String(body.message).trim();
		if (body.level) store.items[idx].level = body.level;
		store.items[idx].updatedAt = now;
		if (!store.items[idx].message) {
			return json({ error: 'Message required' }, { status: 400 });
		}
		const next = await saveAnnouncementsStore(store, kv);
		return json({ ok: true, ...next });
	}

	if (action === 'delete' && body.id) {
		store.items = store.items.filter((i) => i.id !== body.id);
		if (store.activeId === body.id) store.activeId = null;
		const next = await saveAnnouncementsStore(store, kv);
		return json({ ok: true, ...next });
	}

	if (action === 'activate' && body.id) {
		if (!store.items.some((i) => i.id === body.id)) {
			return json({ error: 'Not found' }, { status: 404 });
		}
		store.activeId = body.id;
		const next = await saveAnnouncementsStore(store, kv);
		return json({ ok: true, ...next });
	}

	if (action === 'deactivate') {
		store.activeId = null;
		const next = await saveAnnouncementsStore(store, kv);
		return json({ ok: true, ...next });
	}

	return json(
		{
			error:
				'Use action: create | update | delete | activate | deactivate'
		},
		{ status: 400 }
	);
};
