import { getSourceList } from '$lib/server/sources';
import { getDisabledSourceIds } from '$lib/server/sourceConfig';

type SourceItem = { id: string; name: string };

export async function load({ locals }: { locals: App.Locals }) {
	const all: SourceItem[] = getSourceList();
	const disabled = await getDisabledSourceIds(locals.kv);
	const disabledSet = new Set(disabled.map((id) => id.toLowerCase()));

	const sources = all.map((s: SourceItem) => ({
		id: s.id,
		name: s.name,
		enabled: !disabledSet.has(s.id.toLowerCase())
	}));

	return {
		sources,
		disabledIds: disabled
	};
}
