import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { verifyAdminFromRequest } from '$lib/server/verifyAdmin';
import {
	getAnnouncementsStore,
	saveAnnouncementsStore,
	type AnnouncementItem,
	type AnnouncementLevel
} from '$lib/server/adminConfig';

function getKv(locals: App.Locals, platform?: App.Platform): KVNamespace | null {
	const fromLocals = locals?.kv;
	const fromPlatform = platform?.env?.MIKOROKU_CACHE;
	return fromLocals || fromPlatform || null;
}

function newId(): string {
	return `ann_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeLevel(v: unknown): AnnouncementLevel {
	const s = String(v || 'info');
	return (['info', 'warning', 'danger'].includes(s) ? s : 'info') as AnnouncementLevel;
}

export const GET: RequestHandler = async (event) => {
	const auth = await verifyAdminFromRequest(event.request);
	if (!auth.ok) {
		return json({ error: auth.message }, { status: auth.status });
	}
	try {
		const kv = getKv(event.locals, event.platform);
		const store = await getAnnouncementsStore(kv);
		return json({
			ok: true,
			items: store.items,
			activeId: store.activeId,
			_debug: { hasKv: !!kv }
		});
	} catch (e) {
		console.error('[admin/announcements GET]', e);
		return json(
			{ error: e instanceof Error ? e.message : 'GET failed', detail: String(e) },
			{ status: 500 }
		);
	}
};

export const POST: RequestHandler = async (event) => {
	const auth = await verifyAdminFromRequest(event.request);
	if (!auth.ok) {
		return json({ error: auth.message }, { status: auth.status });
	}

	const kv = getKv(event.locals, event.platform);
	if (!kv) {
		return json(
			{
				error: 'KV not available',
				detail:
					'locals.kv and platform.env.MIKOROKU_CACHE both empty — cek wrangler kv_namespaces + redeploy'
			},
			{ status: 503 }
		);
	}

	let body: {
		action?: string;
		id?: string;
		message?: string;
		level?: AnnouncementLevel;
		enabled?: boolean;
	};
	try {
		body = await event.request.json();
	} catch (e) {
		return json({ error: 'Invalid JSON body', detail: String(e) }, { status: 400 });
	}

	try {
		const store = await getAnnouncementsStore(kv);
		const items: AnnouncementItem[] = Array.isArray(store.items)
			? store.items.map((i) => ({ ...i }))
			: [];
		let activeId: string | null = store.activeId ?? null;
		const now = new Date().toISOString();
		const action = String(body.action || '').trim();

		if (!action && (body.message != null || body.enabled != null)) {
			const message = String(body.message ?? '').trim();
			const level = normalizeLevel(body.level);
			if (body.enabled && message) {
				const id = newId();
				items.unshift({ id, message, level, createdAt: now, updatedAt: now });
				activeId = id;
			} else if (!body.enabled) {
				activeId = null;
			}
			const next = await saveAnnouncementsStore({ items, activeId }, kv);
			return json({ ok: true, items: next.items, activeId: next.activeId });
		}

		if (action === 'create') {
			const message = String(body.message ?? '').trim();
			if (!message) return json({ error: 'Message required' }, { status: 400 });
			const item: AnnouncementItem = {
				id: newId(),
				message,
				level: normalizeLevel(body.level),
				createdAt: now,
				updatedAt: now
			};
			items.unshift(item);
			const next = await saveAnnouncementsStore({ items, activeId }, kv);
			return json({ ok: true, item, items: next.items, activeId: next.activeId });
		}

		if (action === 'update' && body.id) {
			const idx = items.findIndex((i) => i.id === body.id);
			if (idx < 0) return json({ error: 'Not found' }, { status: 404 });
			if (body.message != null) items[idx].message = String(body.message).trim();
			if (body.level) items[idx].level = normalizeLevel(body.level);
			items[idx].updatedAt = now;
			if (!items[idx].message) {
				return json({ error: 'Message required' }, { status: 400 });
			}
			const next = await saveAnnouncementsStore({ items, activeId }, kv);
			return json({ ok: true, items: next.items, activeId: next.activeId });
		}

		if (action === 'delete' && body.id) {
			const nextItems = items.filter((i) => i.id !== body.id);
			if (nextItems.length === items.length) {
				return json({ error: 'Not found' }, { status: 404 });
			}
			if (activeId === body.id) activeId = null;
			const next = await saveAnnouncementsStore({ items: nextItems, activeId }, kv);
			return json({ ok: true, items: next.items, activeId: next.activeId });
		}

		if (action === 'activate' && body.id) {
			if (!items.some((i) => i.id === body.id)) {
				return json({ error: 'Not found' }, { status: 404 });
			}
			const next = await saveAnnouncementsStore({ items, activeId: body.id }, kv);
			return json({ ok: true, items: next.items, activeId: next.activeId });
		}

		if (action === 'deactivate') {
			const next = await saveAnnouncementsStore({ items, activeId: null }, kv);
			return json({ ok: true, items: next.items, activeId: next.activeId });
		}

		return json(
			{ error: 'Use action: create | update | delete | activate | deactivate' },
			{ status: 400 }
		);
	} catch (e) {
		console.error('[admin/announcements POST]', e);
		return json(
			{
				error: e instanceof Error ? e.message : 'Save failed',
				detail: String(e),
				stack: e instanceof Error ? e.stack?.slice(0, 500) : undefined
			},
			{ status: 500 }
		);
	}
};
