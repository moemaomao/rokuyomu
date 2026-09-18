import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	
	if (event.platform?.env?.MIKOROKU_CACHE) {
		event.locals.kv = event.platform.env.MIKOROKU_CACHE;
	}

	return resolve(event);
};