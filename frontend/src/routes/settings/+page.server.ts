import { getAllSources } from '$lib/server/sources';

export const load = async () => {
	const sources = getAllSources().map((s) => ({
		id: s.id,
		name: s.name
	}));
	return { sources };
};