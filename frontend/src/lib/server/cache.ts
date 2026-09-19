const DEFAULT_TTL = 60 * 15; // 15 menit

export async function getCached<T>(
	key: string,
	fetcher: () => Promise<T>,
	ttlSeconds = DEFAULT_TTL,
	kv?: KVNamespace | null
): Promise<T> {
	if (!kv) {
		return await fetcher();
	}

	try {
		const cached = await kv.get(key, 'json');
		if (cached !== null) {
			return cached as T;
		}
	} catch (err) {
		console.error('[KV] get failed:', key, err);
	}

	const data = await fetcher();

	try {
		await kv.put(key, JSON.stringify(data), {
			expirationTtl: ttlSeconds
		});
	} catch (err) {
		console.error('[KV] put failed:', key, err);
	}

	return data;
}

export async function readCache<T>(
	key: string,
	kv?: KVNamespace | null
): Promise<T | null> {
	if (!kv) return null;
	try {
		const cached = await kv.get(key, 'json');
		return cached !== null ? (cached as T) : null;
	} catch (err) {
		console.error('[KV] read failed:', key, err);
		return null;
	}
}

export async function deleteCache(key: string, kv?: KVNamespace | null): Promise<void> {
	if (!kv) return;
	try {
		await kv.delete(key);
	} catch (err) {
		console.error('[KV] delete failed:', key, err);
	}
}
