import type { LayoutServerLoad } from './$types';
import { getActiveAnnouncement } from '$lib/server/adminConfig';

export const load: LayoutServerLoad = async ({ cookies, locals, platform }) => {
	const sidebarOpen = cookies.get('sidebar_open') !== 'false';

	const kv = locals.kv ?? platform?.env?.MIKOROKU_CACHE ?? null;
	const active = await getActiveAnnouncement(kv);
	const announcement = active
		? {
				enabled: true as const,
				message: active.message,
				level: active.level,
				updatedAt: active.updatedAt
			}
		: null;

	return {
		sidebarOpen,
		announcement
	};
};
