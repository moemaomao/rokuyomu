export const ADMIN_UIDS = [
	'G43jdC8zzoWXHv2DHyTwDcDcyK53'
];

export function isAdmin(uid: string | null | undefined): boolean {
	if (!uid) return false;
	return ADMIN_UIDS.includes(uid);
}