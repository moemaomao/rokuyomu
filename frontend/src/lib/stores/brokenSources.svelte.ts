let brokenIds = $state(new Set<string>());

function normalize(id: string): string {
	return String(id || '')
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '');
}

export function getBrokenIds(): Set<string> {
	return brokenIds;
}

export function isBrokenSource(id: string | null | undefined): boolean {
	if (!id) return false;
	return brokenIds.has(normalize(id));
}

export function setBrokenIds(ids: string[]) {
	const next = new Set<string>();
	for (const id of ids) {
		const clean = normalize(id);
		if (clean) next.add(clean);
	}
	brokenIds = next;
}

export function sourceShowsError(
	id: string | null | undefined,
	metaIsError?: boolean
): boolean {
	if (!id) return false;
	if (metaIsError) return true;
	return isBrokenSource(id);
}