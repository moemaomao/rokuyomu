import type { LayoutServerLoad } from './$types';
import { getAnnouncement } from '$lib/server/adminConfig';

export const load: LayoutServerLoad = async ({ cookies, locals, platform }) => {
	const sidebarOpen = cookies.get('sidebar_open') !== 'false';

	const kv = locals.kv ?? platform?.env?.MIKOROKU_CACHE ?? null;
	const raw = await getAnnouncement(kv);
	const announcement =
		raw.enabled && raw.message?.trim()
			? {
					enabled: true as const,
					message: raw.message,
					level: raw.level || ('info' as const),
					updatedAt: raw.updatedAt
				}
			: null;

	return {
		sidebarOpen,
		announcement
	};
};
