/**
 * Source enable/disable config — stored in Workers KV.
 * Disabled sources are hidden from the public source list.
 */

const KV_KEY = 'config:disabled_sources';

export async function getDisabledSourceIds(
    kv?: KVNamespace | null
): Promise<string[]> {
    if (!kv) return [];
    try {
        const raw = await kv.get(KV_KEY, 'json');
        if (Array.isArray(raw)) {
            return raw.map((id) => String(id).toLowerCase().trim()).filter(Boolean);
        }
    } catch (e) {
        console.error('[sourceConfig] get failed:', e);
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
    await kv.put(KV_KEY, JSON.stringify(clean));
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
