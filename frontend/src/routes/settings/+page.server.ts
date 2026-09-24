import { getSourceList, filterEnabledSources } from '$lib/server/sources';
import { getDisabledSourceIds } from '$lib/server/sourceConfig';

export const load = async ({ locals }: { locals: App.Locals }) => {
	const disabledIds = await getDisabledSourceIds(locals.kv);
	const sources = filterEnabledSources(getSourceList(), disabledIds);
	return { sources };
};
