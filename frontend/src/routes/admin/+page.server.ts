import { getSourceList } from '$lib/server/sources';
import { getDisabledSourceIds, getSourceNotes } from '$lib/server/sourceConfig';

type SourceItem = { id: string; name: string };

export async function load({
	locals,
	platform
}: {
	locals: App.Locals;
	platform?: App.Platform;
}) {
	const kv = locals.kv ?? platform?.env?.MIKOROKU_CACHE ?? null;
	const all: SourceItem[] = getSourceList();
	const disabled = await getDisabledSourceIds(kv);
	const notes = await getSourceNotes(kv);
	const disabledSet = new Set(disabled.map((id) => id.toLowerCase()));

	const sources = all.map((s: SourceItem) => ({
		id: s.id,
		name: s.name,
		enabled: !disabledSet.has(s.id.toLowerCase()),
		note: notes[s.id.toLowerCase()] || ''
	}));

	return {
		sources,
		disabledIds: disabled,
		notes
	};
}
