/**
 * @deprecated Use refreshPopularSources from '$lib/server/refreshSources'.
 */

import {
	refreshPopularSources,
	type RefreshResult
} from '$lib/server/refreshSources';

export async function warmPopularSources(kv: KVNamespace) {
	const report = await refreshPopularSources(kv, { force: false });

	return report.results.map(
		(r: RefreshResult): { id: string; ok: boolean; count: number } => ({
			id: r.sourceId,
			ok: r.ok,
			count: r.count
		})
	);
}