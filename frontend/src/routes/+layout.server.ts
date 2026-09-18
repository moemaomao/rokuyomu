import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ cookies }) => {
	const sidebarOpen = cookies.get('sidebar_open') !== 'false';

	return {
		sidebarOpen
	};
};