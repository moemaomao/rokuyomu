import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getActiveAnnouncement } from '$lib/server/adminConfig';

export const GET: RequestHandler = async ({ locals, platform, setHeaders }) => {
	const kv = locals.kv ?? platform?.env?.MIKOROKU_CACHE ?? null;
	const announcement = await getActiveAnnouncement(kv);

	setHeaders({
		'cache-control': 'public, max-age=15, s-maxage=15'
	});

	if (!announcement) {
		return json({ ok: true, announcement: null });
	}

	return json({
		ok: true,
		announcement: {
			enabled: true,
			message: announcement.message,
			level: announcement.level,
			updatedAt: announcement.updatedAt
		}
	});
};
