import type { LayoutServerLoad } from './$types';
import { getPublicAnnouncements } from '$lib/server/adminConfig';

export const load: LayoutServerLoad = async ({ cookies, locals, platform }) => {
	const sidebarOpen = cookies.get('sidebar_open') !== 'false';

	const kv = locals.kv ?? platform?.env?.MIKOROKU_CACHE ?? null;
	const { items, activeId } = await getPublicAnnouncements(kv, 30);

	const announcements = items.map((i) => ({
		id: i.id,
		message: i.message,
		level: i.level,
		createdAt: i.createdAt,
		updatedAt: i.updatedAt,
		active: i.id === activeId
	}));

	const primary = items.find((i) => i.id === activeId) || items[0] || null;
	const announcement = primary
		? {
				enabled: true as const,
				message: primary.message,
				level: primary.level,
				updatedAt: primary.updatedAt
			}
		: null;

	return {
		sidebarOpen,
		announcement,
		announcements
	};
};
