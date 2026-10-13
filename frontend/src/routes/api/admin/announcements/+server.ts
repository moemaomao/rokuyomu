import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getAnnouncement } from '$lib/server/adminConfig';

export const GET: RequestHandler = async ({ locals, platform, setHeaders }) => {
	const kv = locals.kv ?? platform?.env?.MIKOROKU_CACHE ?? null;
	const announcement = await getAnnouncement(kv);

	setHeaders({
		'cache-control': 'public, max-age=30, s-maxage=30'
	});

	if (!announcement.enabled || !announcement.message?.trim()) {
		return json({ ok: true, announcement: null });
	}

	return json({
		ok: true,
		announcement: {
			enabled: true,
			message: announcement.message,
			level: announcement.level || 'info',
			updatedAt: announcement.updatedAt
		}
	});
};
