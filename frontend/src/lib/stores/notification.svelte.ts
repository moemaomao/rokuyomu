/**
 * Notification store — track manga for new chapter alerts.
 * Data disimpan di IndexedDB (store "notifications") + localStorage fallback.
 * Mirip pola bookmark.svelte.ts
 */
import { browser } from '$app/environment';
import {
	idbGetNotifications,
	idbSetAllNotifications,
	idbDeleteNotification,
	idbClearNotifications,
	type NotificationEntry
} from '$lib/db';

export type { NotificationEntry };

const MAX = 80;
const CHECK_COOLDOWN_MS = 5 * 60 * 1000; // minimal 5 menit antar cek per manga

let notifications = $state<NotificationEntry[]>([]);
let ready = $state(false);
let checking = $state(false);

function lightCover(url: string | undefined | null): string {
	if (!url) return '';
	let u = String(url).trim();
	if (!u) return '';
	if (u.startsWith('//')) u = 'https:' + u;
	const keepQuery = /cvr\.voratoon\.id|X-Amz-Signature|X-Amz-Algorithm/i.test(u);
	try {
		const parsed = new URL(u);
		if (!keepQuery) {
			parsed.search = '';
			parsed.hash = '';
		}
		u = parsed.toString();
	} catch {
		/* ignore */
	}
	const max = keepQuery ? 600 : 180;
	return u.length > max ? u.slice(0, max) : u;
}

function lightEntry(entry: NotificationEntry): NotificationEntry {
	return {
		mangaId: entry.mangaId,
		mangaSlug: entry.mangaSlug || '',
		mangaTitle: (entry.mangaTitle || '').slice(0, 120),
		cover: lightCover(entry.cover),
		sourceId: entry.sourceId,
		lastChapterId: entry.lastChapterId || '',
		lastChapterTitle: (entry.lastChapterTitle || '').slice(0, 80),
		lastChapterNumber: entry.lastChapterNumber ?? 0,
		hasNew: Boolean(entry.hasNew),
		newChapterId: entry.newChapterId || '',
		newChapterTitle: (entry.newChapterTitle || '').slice(0, 80),
		newChapterNumber: entry.newChapterNumber ?? 0,
		lastChecked: entry.lastChecked || 0,
		timestamp: entry.timestamp || Date.now()
	};
}

function notifKey(mangaId: string, sourceId: string): string {
	return `${sourceId}::${mangaId}`;
}

if (browser) {
	(async () => {
		try {
			const old = localStorage.getItem('rokuyomu_notifications');
			if (old) {
				try {
					const parsed = JSON.parse(old) as NotificationEntry[];
					if (Array.isArray(parsed) && parsed.length > 0) {
						await idbSetAllNotifications(parsed.map(lightEntry).slice(0, MAX));
					}
				} catch {
					/* ignore */
				}
				localStorage.removeItem('rokuyomu_notifications');
			}
			notifications = await idbGetNotifications();
		} catch (e) {
			console.error('[notifications] failed to load', e);
			notifications = [];
		} finally {
			ready = true;
		}

		window.addEventListener('notifications-changed', async () => {
			notifications = await idbGetNotifications();
		});
	})();
}

export function getNotifications(): NotificationEntry[] {
	return notifications;
}

export function isNotificationsReady(): boolean {
	return ready;
}

export function isCheckingNotifications(): boolean {
	return checking;
}

export function getUnreadCount(): number {
	return notifications.filter((n) => n.hasNew).length;
}

export function isNotified(mangaId: string, sourceId?: string): boolean {
	return notifications.some(
		(n) => n.mangaId === mangaId && (!sourceId || n.sourceId === sourceId)
	);
}

export async function addNotification(
	entry: Omit<
		NotificationEntry,
		| 'timestamp'
		| 'hasNew'
		| 'newChapterId'
		| 'newChapterTitle'
		| 'newChapterNumber'
		| 'lastChecked'
	> & {
		lastChapterId?: string;
		lastChapterTitle?: string;
		lastChapterNumber?: number;
	}
) {
	if (!browser) return;

	const full = lightEntry({
		mangaId: entry.mangaId,
		mangaSlug: entry.mangaSlug || '',
		mangaTitle: entry.mangaTitle,
		cover: entry.cover || '',
		sourceId: entry.sourceId,
		lastChapterId: entry.lastChapterId || '',
		lastChapterTitle: entry.lastChapterTitle || '',
		lastChapterNumber: entry.lastChapterNumber ?? 0,
		hasNew: false,
		newChapterId: '',
		newChapterTitle: '',
		newChapterNumber: 0,
		lastChecked: Date.now(),
		timestamp: Date.now()
	});

	const list = (await idbGetNotifications()).filter(
		(n) => !(n.mangaId === entry.mangaId && n.sourceId === entry.sourceId)
	);
	list.unshift(full);
	const trimmed = list.slice(0, MAX);
	await idbSetAllNotifications(trimmed);
	notifications = trimmed;
	window.dispatchEvent(new CustomEvent('notifications-changed'));
}

export async function removeNotification(mangaId: string, sourceId?: string) {
	if (!browser) return;
	await idbDeleteNotification(mangaId, sourceId);
	notifications = await idbGetNotifications();
	window.dispatchEvent(new CustomEvent('notifications-changed'));
}

export async function toggleNotification(
	entry: Omit<
		NotificationEntry,
		| 'timestamp'
		| 'hasNew'
		| 'newChapterId'
		| 'newChapterTitle'
		| 'newChapterNumber'
		| 'lastChecked'
	> & {
		lastChapterId?: string;
		lastChapterTitle?: string;
		lastChapterNumber?: number;
	}
): Promise<boolean> {
	if (isNotified(entry.mangaId, entry.sourceId)) {
		await removeNotification(entry.mangaId, entry.sourceId);
		return false;
	}
	await addNotification(entry);
	return true;
}

export async function markAsRead(mangaId: string, sourceId: string) {
	if (!browser) return;
	const list = await idbGetNotifications();
	const idx = list.findIndex((n) => n.mangaId === mangaId && n.sourceId === sourceId);
	if (idx < 0) return;
	const n = list[idx];
	if (n.hasNew) {
		n.lastChapterId = n.newChapterId || n.lastChapterId;
		n.lastChapterTitle = n.newChapterTitle || n.lastChapterTitle;
		n.lastChapterNumber = n.newChapterNumber || n.lastChapterNumber;
	}
	n.hasNew = false;
	n.newChapterId = '';
	n.newChapterTitle = '';
	n.newChapterNumber = 0;
	list[idx] = lightEntry(n);
	await idbSetAllNotifications(list);
	notifications = list;
	window.dispatchEvent(new CustomEvent('notifications-changed'));
}

export async function markAllAsRead() {
	if (!browser) return;
	const list = await idbGetNotifications();
	for (const n of list) {
		if (n.hasNew) {
			n.lastChapterId = n.newChapterId || n.lastChapterId;
			n.lastChapterTitle = n.newChapterTitle || n.lastChapterTitle;
			n.lastChapterNumber = n.newChapterNumber || n.lastChapterNumber;
		}
		n.hasNew = false;
		n.newChapterId = '';
		n.newChapterTitle = '';
		n.newChapterNumber = 0;
	}
	const cleaned = list.map(lightEntry);
	await idbSetAllNotifications(cleaned);
	notifications = cleaned;
	window.dispatchEvent(new CustomEvent('notifications-changed'));
}

export async function clearNotifications() {
	if (!browser) return;
	await idbClearNotifications();
	notifications = [];
	window.dispatchEvent(new CustomEvent('notifications-changed'));
}

/**
 * Cek chapter terbaru untuk semua (atau satu) notifikasi aktif.
 * Memakai endpoint /api/chapters yang sudah ada di frontend.
 */
export async function checkForNewChapters(options?: {
	force?: boolean;
	onlyMangaId?: string;
	onlySourceId?: string;
}): Promise<number> {
	if (!browser || checking) return 0;
	checking = true;
	let found = 0;

	try {
		let list = await idbGetNotifications();
		if (options?.onlyMangaId) {
			list = list.filter(
				(n) =>
					n.mangaId === options.onlyMangaId &&
					(!options.onlySourceId || n.sourceId === options.onlySourceId)
			);
		}

		const now = Date.now();
		const updates: NotificationEntry[] = [];

		for (const n of list) {
			if (!options?.force && n.lastChecked && now - n.lastChecked < CHECK_COOLDOWN_MS) {
				updates.push(n);
				continue;
			}

			try {
				const params = new URLSearchParams({
					source: n.sourceId,
					id: n.mangaId,
					lang: 'all',
					offset: '0',
					limit: '5',
					sort: 'newest'
				});
				const res = await fetch(`/api/chapters?${params}`);
				if (!res.ok) {
					updates.push({ ...n, lastChecked: now });
					continue;
				}
				const json = (await res.json()) as {
					chapters?: Array<{
						id?: string;
						title?: string;
						number?: number;
						name?: string;
					}>;
				};
				const chapters = Array.isArray(json.chapters) ? json.chapters : [];
				const latest = chapters[0];
				if (!latest) {
					updates.push({ ...n, lastChecked: now });
					continue;
				}

				const latestId = String(latest.id || latest.number || '');
				const latestTitle = String(latest.title || latest.name || `Chapter ${latest.number ?? ''}`);
				const latestNum = Number(latest.number) || 0;

				const knownId = n.lastChapterId || '';
				const knownNum = n.lastChapterNumber || 0;

				let isNew = false;
				if (knownId && latestId && latestId !== knownId) {
					isNew = true;
				} else if (!knownId && knownNum > 0 && latestNum > knownNum) {
					isNew = true;
				} else if (!knownId && !knownNum && latestId) {
					// pertama kali: set baseline, jangan tandai new
					isNew = false;
				}

				if (isNew) {
					found++;
					updates.push(
						lightEntry({
							...n,
							hasNew: true,
							newChapterId: latestId,
							newChapterTitle: latestTitle,
							newChapterNumber: latestNum,
							lastChecked: now,
							timestamp: n.timestamp
						})
					);
				} else {
					// update baseline jika belum punya lastChapter
					updates.push(
						lightEntry({
							...n,
							lastChapterId: knownId || latestId,
							lastChapterTitle: n.lastChapterTitle || latestTitle,
							lastChapterNumber: knownNum || latestNum,
							lastChecked: now,
							hasNew: n.hasNew,
							newChapterId: n.newChapterId,
							newChapterTitle: n.newChapterTitle,
							newChapterNumber: n.newChapterNumber
						})
					);
				}
			} catch (e) {
				console.warn('[notifications] check failed', n.mangaId, e);
				updates.push({ ...n, lastChecked: now });
			}
		}

		// merge back ke full list
		const full = await idbGetNotifications();
		const map = new Map(full.map((x) => [notifKey(x.mangaId, x.sourceId), x]));
		for (const u of updates) {
			map.set(notifKey(u.mangaId, u.sourceId), u);
		}
		const merged = Array.from(map.values())
			.sort((a, b) => b.timestamp - a.timestamp)
			.slice(0, MAX);
		await idbSetAllNotifications(merged);
		notifications = merged;
		window.dispatchEvent(new CustomEvent('notifications-changed'));
	} finally {
		checking = false;
	}

	return found;
}
