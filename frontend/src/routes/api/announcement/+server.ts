import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getPublicAnnouncements } from '$lib/server/adminConfig';

export const GET: RequestHandler = async ({ locals, platform, setHeaders }) => {
	const kv = locals.kv ?? platform?.env?.MIKOROKU_CACHE ?? null;
	const { items, activeId } = await getPublicAnnouncements(kv, 30);

	setHeaders({
		'cache-control': 'public, max-age=15, s-maxage=15'
	});

	return json({
		ok: true,
		activeId,
		items: items.map((i) => ({
			id: i.id,
			message: i.message,
			level: i.level,
			createdAt: i.createdAt,
			updatedAt: i.updatedAt
		})),
		announcement:
			items.find((i) => i.id === activeId) || items[0]
				? {
						enabled: true,
						message: (items.find((i) => i.id === activeId) || items[0]).message,
						level: (items.find((i) => i.id === activeId) || items[0]).level,
						updatedAt: (items.find((i) => i.id === activeId) || items[0]).updatedAt
					}
				: null
	});
};
