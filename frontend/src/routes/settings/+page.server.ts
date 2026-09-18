import { getSourceList } from '$lib/server/sources';

export const load = async () => {
	const sources = getSourceList();
	return { sources };
};