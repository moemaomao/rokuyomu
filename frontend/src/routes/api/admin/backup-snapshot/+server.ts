import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifyAdminFromRequest } from '$lib/server/verifyAdmin';
import { getPopularSourceIds } from '$lib/server/refreshSources';
import { remoteLatest } from '$lib/server/scraperClient';
import { listToBackupItems, saveSourceBackup } from '$lib/server/backupMeta';

const TIMEOUT_MS = 10000;
const DELAY_MS = 250;
const LIMIT = 24;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error('timeout')), ms);
		p.then((v) => {
			clearTimeout(t);
			resolve(v);
		}).catch((e) => {
			clearTimeout(t);
			reject(e);
		});
	});
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const auth = await verifyAdminFromRequest(request);
	if (!auth.ok) {
		return json({ error: auth.message }, { status: auth.status });
	}

	const kv = locals.kv;
	if (!kv) {
		return json({ error: 'KV not available' }, { status: 503 });
	}

	let body: { sources?: string[] } = {};
	try {
		body = await request.json();
	} catch {
		/* empty body = all popular */
	}

	const targets =
		Array.isArray(body.sources) && body.sources.length
			? body.sources.map((s) => String(s).toLowerCase().trim()).filter(Boolean)
			: getPopularSourceIds();

	const results: {
		sourceId: string;
		ok: boolean;
		count: number;
		error?: string;
	}[] = [];

	for (const sourceId of targets) {
		try {
			const list = await withTimeout(
				remoteLatest(sourceId, 1, { lang: 'all', type: 'all' }),
				TIMEOUT_MS
			);
			const arr = (Array.isArray(list) ? list : []).slice(0, LIMIT);
			const items = listToBackupItems(arr, sourceId);
			await saveSourceBackup(sourceId, items, kv);
			results.push({ sourceId, ok: true, count: items.length });
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			console.error('[backup-snapshot]', sourceId, message);
			results.push({ sourceId, ok: false, count: 0, error: message });
		}
		await new Promise((r) => setTimeout(r, DELAY_MS));
	}

	return json({
		ok: true,
		syncedAt: new Date().toISOString(),
		total: results.length,
		success: results.filter((r) => r.ok).length,
		failed: results.filter((r) => !r.ok).length,
		results
	});
};