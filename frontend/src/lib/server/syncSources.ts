/**
 * @deprecated Use refreshPopularSources from '$lib/server/refreshSources'.
 * Thin wrapper kept for existing imports.
 */

import { refreshPopularSources } from '$lib/server/refreshSources';

export async function syncPopularSources(kv: KVNamespace) {
	return refreshPopularSources(kv, { force: true });
}