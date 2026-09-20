let brokenMap = $state<Record<string, true>>({});
let brokenTick = $state(0);

function normalize(id: string): string {
	return String(id || '')
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '');
}

export function getBrokenIds(): Set<string> {
	void brokenTick;
	return new Set(Object.keys(brokenMap));
}

export function isBrokenSource(id: string | null | undefined): boolean {
	if (!id) return false;
	void brokenTick;
	return brokenMap[normalize(id)] === true;
}

export function setBrokenIds(ids: string[]) {
	const next: Record<string, true> = {};
	for (const id of ids) {
		const clean = normalize(id);
		if (clean) next[clean] = true;
	}
	brokenMap = next;
	brokenTick += 1;
}

export function sourceShowsError(
	id: string | null | undefined,
	metaIsError?: boolean
): boolean {
	if (!id) return false;
	if (metaIsError) return true;
	return isBrokenSource(id);
}

export function syncBrokenFromReports(
	reports: Array<{ type?: string; status?: string; sourceId?: string | null }>
) {
	const ids: string[] = [];
	for (const r of reports) {
		if (
			(r.type === 'fix_source' || r.type === 'bug') &&
			(r.status === 'open' || r.status === 'in_progress') &&
			r.sourceId
		) {
			ids.push(r.sourceId);
		}
	}
	setBrokenIds(ids);
}