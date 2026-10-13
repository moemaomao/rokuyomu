const KV_ANNOUNCEMENT = 'config:announcement';
const KV_FLAGS = 'config:feature_flags';
const KV_BANNED = 'config:banned_uids';

export type Announcement = {
	enabled: boolean;
	message: string;
	level: 'info' | 'warning' | 'danger';
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

export async function getAnnouncement(kv?: KVNamespace | null): Promise<Announcement> {
	if (!kv) {
		return { enabled: false, message: '', level: 'info' };
	}
	try {
		const raw = await kv.get(KV_ANNOUNCEMENT, 'json');
		if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
			const o = raw as Record<string, unknown>;
			return {
				enabled: Boolean(o.enabled),
				message: String(o.message ?? ''),
				level: (['info', 'warning', 'danger'].includes(String(o.level))
					? String(o.level)
					: 'info') as Announcement['level'],
				updatedAt: o.updatedAt ? String(o.updatedAt) : undefined
			};
		}
	} catch (e) {
		console.error('[adminConfig] get announcement failed:', e);
	}
	return { enabled: false, message: '', level: 'info' };
}

export async function setAnnouncement(
	data: Partial<Announcement>,
	kv?: KVNamespace | null
): Promise<Announcement> {
	if (!kv) throw new Error('KV not available');
	const current = await getAnnouncement(kv);
	const next: Announcement = {
		enabled: data.enabled ?? current.enabled,
		message: data.message != null ? String(data.message) : current.message,
		level: data.level ?? current.level,
		updatedAt: new Date().toISOString()
	};
	await kv.put(KV_ANNOUNCEMENT, JSON.stringify(next));
	return next;
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
