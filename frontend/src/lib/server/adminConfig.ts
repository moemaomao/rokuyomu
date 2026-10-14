const KV_ANNOUNCEMENT_LEGACY = 'config:announcement';
const KV_ANNOUNCEMENTS = 'config:announcements';
const KV_FLAGS = 'config:feature_flags';
const KV_BANNED = 'config:banned_uids';

export type AnnouncementLevel = 'info' | 'warning' | 'danger';

export type AnnouncementItem = {
	id: string;
	message: string;
	level: AnnouncementLevel;
	createdAt: string;
	updatedAt: string;
};

export type AnnouncementsStore = {
	items: AnnouncementItem[];
	activeId: string | null;
};

export type Announcement = {
	enabled: boolean;
	message: string;
	level: AnnouncementLevel;
	updatedAt?: string;
};

export type FeatureFlags = Record<string, boolean>;

const DEFAULT_FLAGS: FeatureFlags = {
	offline_library: true,
	deep_search: true,
	community: true,
	pwa_prompt: false,
	download_zip: true,
	novel_pdf: true
};

function newId(): string {
	return `ann_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeLevel(v: unknown): AnnouncementLevel {
	const s = String(v || 'info');
	return (['info', 'warning', 'danger'].includes(s) ? s : 'info') as AnnouncementLevel;
}

export async function getAnnouncementsStore(
	kv?: KVNamespace | null
): Promise<AnnouncementsStore> {
	if (!kv) return { items: [], activeId: null };

	try {
		const raw = await kv.get(KV_ANNOUNCEMENTS, 'json');
		if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
			const o = raw as Record<string, unknown>;
			const itemsIn = Array.isArray(o.items) ? o.items : [];
			const items: AnnouncementItem[] = [];
			for (const it of itemsIn) {
				if (!it || typeof it !== 'object') continue;
				const row = it as Record<string, unknown>;
				const message = String(row.message ?? '').trim();
				if (!message) continue;
				const id = String(row.id || newId());
				const now = new Date().toISOString();
				items.push({
					id,
					message,
					level: normalizeLevel(row.level),
					createdAt: String(row.createdAt || now),
					updatedAt: String(row.updatedAt || now)
				});
			}
			const activeId =
				o.activeId == null || o.activeId === ''
					? null
					: String(o.activeId);
			const validActive =
				activeId && items.some((x) => x.id === activeId) ? activeId : null;
			return { items, activeId: validActive };
		}
	} catch (e) {
		console.error('[adminConfig] get announcements failed:', e);
	}

	try {
		const legacy = await kv.get(KV_ANNOUNCEMENT_LEGACY, 'json');
		if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
			const o = legacy as Record<string, unknown>;
			const message = String(o.message ?? '').trim();
			if (message) {
				const now = new Date().toISOString();
				const id = newId();
				const store: AnnouncementsStore = {
					items: [
						{
							id,
							message,
							level: normalizeLevel(o.level),
							createdAt: String(o.updatedAt || now),
							updatedAt: String(o.updatedAt || now)
						}
					],
					activeId: o.enabled ? id : null
				};
				await kv.put(KV_ANNOUNCEMENTS, JSON.stringify(store));
				return store;
			}
		}
	} catch (e) {
		console.error('[adminConfig] legacy migrate failed:', e);
	}

	return { items: [], activeId: null };
}

export async function saveAnnouncementsStore(
	store: AnnouncementsStore,
	kv?: KVNamespace | null
): Promise<AnnouncementsStore> {
	if (!kv) throw new Error('KV not available');
	const items = store.items.filter((i) => i.message?.trim());
	const activeId =
		store.activeId && items.some((i) => i.id === store.activeId)
			? store.activeId
			: null;
	const next: AnnouncementsStore = { items, activeId };
	await kv.put(KV_ANNOUNCEMENTS, JSON.stringify(next));

	const active = activeId ? items.find((i) => i.id === activeId) : null;
	const legacy: Announcement = active
		? {
				enabled: true,
				message: active.message,
				level: active.level,
				updatedAt: active.updatedAt
			}
		: { enabled: false, message: '', level: 'info' };
	await kv.put(KV_ANNOUNCEMENT_LEGACY, JSON.stringify(legacy));

	return next;
}

export async function getActiveAnnouncement(
	kv?: KVNamespace | null
): Promise<Announcement | null> {
	const store = await getAnnouncementsStore(kv);
	if (!store.activeId) return null;
	const item = store.items.find((i) => i.id === store.activeId);
	if (!item) return null;
	return {
		enabled: true,
		message: item.message,
		level: item.level,
		updatedAt: item.updatedAt
	};
}

export async function getPublicAnnouncements(
	kv?: KVNamespace | null,
	limit = 30
): Promise<{ items: AnnouncementItem[]; activeId: string | null }> {
	const store = await getAnnouncementsStore(kv);
	const items = [...store.items].sort((a, b) => {
		const ta = Date.parse(b.updatedAt || b.createdAt || '') || 0;
		const tb = Date.parse(a.updatedAt || a.createdAt || '') || 0;
		return ta - tb;
	});
	return {
		items: items.slice(0, Math.max(1, limit)),
		activeId: store.activeId
	};
}

/** @deprecated use getActiveAnnouncement / getAnnouncementsStore */
export async function getAnnouncement(kv?: KVNamespace | null): Promise<Announcement> {
	const active = await getActiveAnnouncement(kv);
	if (active) return active;
	return { enabled: false, message: '', level: 'info' };
}

/** @deprecated prefer list APIs */
export async function setAnnouncement(
	data: Partial<Announcement>,
	kv?: KVNamespace | null
): Promise<Announcement> {
	if (!kv) throw new Error('KV not available');
	const store = await getAnnouncementsStore(kv);
	const now = new Date().toISOString();
	const message = data.message != null ? String(data.message).trim() : '';
	const level = data.level ? normalizeLevel(data.level) : 'info';
	const enabled = data.enabled ?? false;

	if (enabled && message) {
		if (store.activeId) {
			const idx = store.items.findIndex((i) => i.id === store.activeId);
			if (idx >= 0) {
				store.items[idx] = {
					...store.items[idx],
					message,
					level,
					updatedAt: now
				};
			}
		} else {
			const id = newId();
			store.items.unshift({
				id,
				message,
				level,
				createdAt: now,
				updatedAt: now
			});
			store.activeId = id;
		}
	} else {
		store.activeId = null;
		if (message) {
			const id = newId();
			store.items.unshift({
				id,
				message,
				level,
				createdAt: now,
				updatedAt: now
			});
		}
	}

	await saveAnnouncementsStore(store, kv);
	return (await getActiveAnnouncement(kv)) || {
		enabled: false,
		message: '',
		level: 'info'
	};
}

export async function getFeatureFlags(kv?: KVNamespace | null): Promise<FeatureFlags> {
	if (!kv) return { ...DEFAULT_FLAGS };
	try {
		const raw = await kv.get(KV_FLAGS, 'json');
		if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
			return { ...DEFAULT_FLAGS, ...(raw as FeatureFlags) };
		}
	} catch (e) {
		console.error('[adminConfig] get flags failed:', e);
	}
	return { ...DEFAULT_FLAGS };
}

export async function setFeatureFlags(
	flags: FeatureFlags,
	kv?: KVNamespace | null
): Promise<FeatureFlags> {
	if (!kv) throw new Error('KV not available');
	const next = { ...DEFAULT_FLAGS, ...flags };
	await kv.put(KV_FLAGS, JSON.stringify(next));
	return next;
}

export async function getBannedUids(kv?: KVNamespace | null): Promise<string[]> {
	if (!kv) return [];
	try {
		const raw = await kv.get(KV_BANNED, 'json');
		if (Array.isArray(raw)) {
			return raw.map((id) => String(id).trim()).filter(Boolean);
		}
	} catch (e) {
		console.error('[adminConfig] get banned failed:', e);
	}
	return [];
}

export async function setBannedUids(uids: string[], kv?: KVNamespace | null): Promise<string[]> {
	if (!kv) throw new Error('KV not available');
	const clean = [...new Set(uids.map((u) => String(u).trim()).filter(Boolean))];
	await kv.put(KV_BANNED, JSON.stringify(clean));
	return clean;
}

export async function banUid(uid: string, kv?: KVNamespace | null): Promise<string[]> {
	const id = String(uid).trim();
	if (!id) throw new Error('Invalid uid');
	const current = await getBannedUids(kv);
	if (current.includes(id)) return current;
	return setBannedUids([...current, id], kv);
}

export async function unbanUid(uid: string, kv?: KVNamespace | null): Promise<string[]> {
	const id = String(uid).trim();
	const current = await getBannedUids(kv);
	return setBannedUids(
		current.filter((x) => x !== id),
		kv
	);
}
