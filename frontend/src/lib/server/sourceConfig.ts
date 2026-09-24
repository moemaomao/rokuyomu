/**
 * Source enable/disable + admin notes — stored in Workers KV.
 */

const KV_DISABLED = 'config:disabled_sources';
const KV_NOTES = 'config:source_notes';

export type SourceNotesMap = Record<string, string>;

export async function getDisabledSourceIds(
	kv?: KVNamespace | null
): Promise<string[]> {
	if (!kv) return [];
	try {
		const raw = await kv.get(KV_DISABLED, 'json');
		if (Array.isArray(raw)) {
			return raw.map((id) => String(id).toLowerCase().trim()).filter(Boolean);
		}
	} catch (e) {
		console.error('[sourceConfig] get disabled failed:', e);
	}
	return [];
}

export async function setDisabledSourceIds(
	ids: string[],
	kv?: KVNamespace | null
): Promise<void> {
	if (!kv) throw new Error('KV not available');
	const clean = [
		...new Set(ids.map((id) => String(id).toLowerCase().trim()).filter(Boolean))
	];
	await kv.put(KV_DISABLED, JSON.stringify(clean));
}

export async function isSourceDisabled(
	sourceId: string,
	kv?: KVNamespace | null
): Promise<boolean> {
	const disabled = await getDisabledSourceIds(kv);
	return disabled.includes(String(sourceId).toLowerCase().trim());
}

export async function setSourceEnabled(
	sourceId: string,
	enabled: boolean,
	kv?: KVNamespace | null
): Promise<string[]> {
	const id = String(sourceId).toLowerCase().trim();
	if (!id) throw new Error('Invalid sourceId');

	const current = await getDisabledSourceIds(kv);
	const next = enabled
		? current.filter((x) => x !== id)
		: current.includes(id)
			? current
			: [...current, id];

	await setDisabledSourceIds(next, kv);
	return next;
}

/** Notes: { [sourceId]: string } */
export async function getSourceNotes(
	kv?: KVNamespace | null
): Promise<SourceNotesMap> {
	if (!kv) return {};
	try {
		const raw = await kv.get(KV_NOTES, 'json');
		if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
			const out: SourceNotesMap = {};
			for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
				const id = String(k).toLowerCase().trim();
				const note = String(v ?? '').trim();
				if (id && note) out[id] = note;
			}
			return out;
		}
	} catch (e) {
		console.error('[sourceConfig] get notes failed:', e);
	}
	return {};
}

export async function setSourceNote(
	sourceId: string,
	note: string,
	kv?: KVNamespace | null
): Promise<SourceNotesMap> {
	if (!kv) throw new Error('KV not available');
	const id = String(sourceId).toLowerCase().trim();
	if (!id) throw new Error('Invalid sourceId');

	const current = await getSourceNotes(kv);
	const text = String(note ?? '').trim();
	if (text) current[id] = text;
	else delete current[id];

	await kv.put(KV_NOTES, JSON.stringify(current));
	return current;
}
