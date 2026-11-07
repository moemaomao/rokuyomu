import { getSourceList } from '$lib/server/sources';

export const load = async () => {
	return {
		sources: getSourceList()
	};
};
