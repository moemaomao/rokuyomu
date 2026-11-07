/**
 * @deprecated Use refreshPopularSources from '$lib/server/refreshSources'.
 */

import { refreshPopularSources } from '$lib/server/refreshSources';

export async function syncPopularSources(kv: KVNamespace) {
	return refreshPopularSources(kv, { force: false });
}