<script lang="ts">
	import {
		Info,
		AlertTriangle,
		AlertOctagon,
		X,
		Megaphone
	} from 'lucide-svelte';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';

	type Level = 'info' | 'warning' | 'danger';

	export type AnnouncementPublic = {
		id: string;
		message: string;
		level: Level;
		createdAt?: string;
		updatedAt?: string;
		active?: boolean;
	};

	let {
		items = [] as AnnouncementPublic[],
		/** @deprecated */
		message = '',
		level = 'info' as Level,
		updatedAt = '' as string | undefined,
		inline = true
	}: {
		items?: AnnouncementPublic[];
		message?: string;
		level?: Level;
		updatedAt?: string;
		inline?: boolean;
	} = $props();

	const SEEN_KEY = 'rokuyomu_ann_seen_ids_v2';
	const SEEN_LEGACY = 'rokuyomu_ann_seen';

	let open = $state(false);
	let unreadCount = $state(0);

	const list = $derived.by((): AnnouncementPublic[] => {
		if (items?.length) {
			return [...items].sort((a, b) => {
				if (a.active && !b.active) return -1;
				if (!a.active && b.active) return 1;
				const ta = Date.parse(b.updatedAt || b.createdAt || '') || 0;
				const tb = Date.parse(a.updatedAt || a.createdAt || '') || 0;
				return ta - tb;
			});
		}
		if (message?.trim()) {
			return [
				{
					id: 'legacy',
					message,
					level: level || 'info',
					updatedAt: updatedAt || '',
					createdAt: updatedAt || '',
					active: true
				}
			];
		}
		return [];
	});

	function readSeenIds(): Set<string> {
		if (!browser) return new Set();
		try {
			const raw = localStorage.getItem(SEEN_KEY);
			if (raw) {
				const arr = JSON.parse(raw) as string[];
				return new Set(Array.isArray(arr) ? arr.map(String) : []);
			}

			const leg = localStorage.getItem(SEEN_LEGACY);
			if (leg && list[0]) {
				const parsed = JSON.parse(leg) as { message?: string; updatedAt?: string };
				if (parsed.message === list[0].message) {
					return new Set([list[0].id]);
				}
			}
		} catch {
			/* ignore */
		}
		return new Set();
	}

	function writeSeenIds(ids: Set<string>) {
		if (!browser) return;
		try {
			const arr = [...ids].slice(-100);
			localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
		} catch {
			/* ignore */
		}
	}

	function refreshUnread() {
		if (!browser || !list.length) {
			unreadCount = 0;
			return;
		}
		const seen = readSeenIds();
		unreadCount = list.filter((i) => !seen.has(i.id)).length;
	}

	$effect(() => {
		list;
		refreshUnread();
	});

	function markAllSeen() {
		if (!browser) return;
		const seen = readSeenIds();
		for (const i of list) seen.add(i.id);
		writeSeenIds(seen);
		unreadCount = 0;
	}

	function openModal() {
		open = true;
		markAllSeen();
	}

	function closeModal() {
		open = false;
	}

	onMount(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key === 'Escape' && open) closeModal();
		}
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	});

	function levelStyles(lv: Level) {
		switch (lv) {
			case 'danger':
				return {
					iconBg: 'bg-red-500/15 text-red-600 dark:text-red-400',
					border: 'border-red-500/30',
					badge: 'bg-red-500/15 text-red-700 dark:text-red-300 ring-red-500/30'
				};
			case 'warning':
				return {
					iconBg: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
					border: 'border-amber-500/30',
					badge: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 ring-amber-500/30'
				};
			default:
				return {
					iconBg: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
					border: 'border-sky-500/30',
					badge: 'bg-sky-500/15 text-sky-800 dark:text-sky-300 ring-sky-500/30'
				};
		}
	}

	function formatDate(iso?: string): string {
		if (!iso) return '';
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
		try {
			return d.toLocaleString(undefined, {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			});
		} catch {
			return d.toISOString().slice(0, 16).replace('T', ' ');
		}
	}
</script>

{#if list.length}
	{#if inline}
		<button
			type="button"
			class="relative rounded-lg p-1.5 transition text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800/60 dark:hover:text-white"
			aria-label="Announcements{unreadCount > 0 ? ` ({unreadCount} unread)` : ''}"
			title="Announcements"
			onclick={openModal}
		>
			<Megaphone class="h-5 w-5" />
			{#if unreadCount > 0}
				<span
					class="absolute top-0.5 right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-bold text-white"
				>
					{unreadCount > 99 ? '99+' : unreadCount}
				</span>
			{/if}
		</button>
	{:else}
		<button
			type="button"
			class="fixed bottom-5 right-5 z-[60] flex h-12 w-12 items-center justify-center rounded-full
				bg-violet-600 text-white shadow-lg
				transition hover:scale-105 hover:brightness-110
				focus:outline-none focus:ring-2 focus:ring-offset-2
				dark:focus:ring-offset-zinc-900"
			style="box-shadow: 0 10px 25px -5px color-mix(in srgb, var(--accent, #7c3aed) 40%, transparent);
				--tw-ring-color: var(--accent, #7c3aed);"
			aria-label="Announcements{unreadCount > 0 ? ` ({unreadCount} unread)` : ''}"
			onclick={openModal}
		>
			<Megaphone class="h-5 w-5" />
			{#if unreadCount > 0}
				<span
					class="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center
						rounded-full bg-red-500 px-1 text-[11px] font-bold leading-none text-white
						ring-2 ring-white dark:ring-zinc-900"
				>
					{unreadCount > 99 ? '99+' : unreadCount}
				</span>
			{/if}
		</button>
	{/if}

	{#if open}
		<button
			type="button"
			class="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm"
			aria-label="Close announcements"
			onclick={closeModal}
		></button>

		<div
			class="fixed left-1/2 top-1/2 z-[80] flex max-h-[min(85vh,640px)] w-[min(92vw,440px)]
				-translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border
				border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
			role="dialog"
			aria-modal="true"
			aria-labelledby="ann-title"
		>
			<div class="flex shrink-0 items-start gap-3 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
				<span
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-600 dark:text-violet-400"
				>
					<Megaphone class="h-5 w-5" />
				</span>
				<div class="min-w-0 flex-1">
					<h2 id="ann-title" class="text-base font-semibold text-zinc-900 dark:text-zinc-50">
						Announcements
					</h2>
					<p class="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
						{list.length} message{list.length === 1 ? '' : 's'} · Rokuyomu
					</p>
				</div>
				<button
					type="button"
					class="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700
						dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
					aria-label="Close"
					onclick={closeModal}
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
				{#each list as item, idx (item.id)}
					{@const st = levelStyles(item.level || 'info')}
					<article
						class="rounded-xl border {st.border} bg-zinc-50 px-3.5 py-3 dark:bg-zinc-800/50
							{item.active ? 'ring-1 ring-violet-500/40' : ''}"
					>
						<div class="mb-2 flex flex-wrap items-center gap-2">
							<span
								class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 {st.badge}"
							>
								{#if item.level === 'danger'}
									<AlertOctagon class="h-3 w-3" />
								{:else if item.level === 'warning'}
									<AlertTriangle class="h-3 w-3" />
								{:else}
									<Info class="h-3 w-3" />
								{/if}
								{item.level || 'info'}
							</span>
							{#if item.active}
								<span
									class="rounded-md bg-violet-600/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700 ring-1 ring-violet-500/30 dark:text-violet-300"
								>
									Active
								</span>
							{/if}
							{#if idx === 0 && !item.active}
								<span class="text-[10px] font-medium text-zinc-400">Latest</span>
							{/if}
							<span class="ml-auto text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
								{formatDate(item.updatedAt || item.createdAt)}
							</span>
						</div>
						<div
							class="whitespace-pre-wrap text-sm leading-relaxed text-zinc-800 dark:text-zinc-200"
						>
							{item.message}
						</div>
					</article>
				{/each}
			</div>

			<div
				class="flex shrink-0 justify-end border-t border-zinc-100 px-5 py-3 dark:border-zinc-800"
			>
				<button
					type="button"
					class="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white
						transition hover:brightness-110"
					onclick={closeModal}
				>
					Got it
				</button>
			</div>
		</div>
	{/if}
{/if}
