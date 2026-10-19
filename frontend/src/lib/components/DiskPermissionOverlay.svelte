<script lang="ts">
	import { browser } from '$app/environment';
	import {
		getLibraryFolderStatus,
		librarySupportsDisk,
		type LibraryFolderStatus
	} from '$lib/stores/download.svelte';
	import {
		prefersDiskDownload,
		shouldAutoDownloadOnRead,
		setPreferences
	} from '$lib/stores/preferences';
	import {
		requestStoredLibraryRoot,
		pickLibraryRoot
	} from '$lib/utils/localFs';
	import { FolderOpen, HardDrive, X } from 'lucide-svelte';

	let {
		chapterKey = '',
		onGranted = undefined as undefined | (() => void)
	}: {
		chapterKey?: string;
		onGranted?: () => void;
	} = $props();

	let supported = $state(false);
	let folderStatus = $state<LibraryFolderStatus>('unlinked');
	let busy = $state(false);
	let message = $state('');
	let dismissedKeys = $state(new Set<string>());
	let lastCheckedKey = $state('');

	const wantsDisk = $derived(shouldAutoDownloadOnRead() || prefersDiskDownload());
	const dismissKey = $derived(`disk-perm:${chapterKey || 'chapter'}`);

	const visible = $derived(
		browser &&
			supported &&
			wantsDisk &&
			(folderStatus === 'permission-needed' || folderStatus === 'unlinked') &&
			!dismissedKeys.has(dismissKey)
	);

	$effect(() => {
		if (!browser) return;
		const diskSupported = librarySupportsDisk();
		supported = diskSupported;
		if (!diskSupported || !wantsDisk) return;
		const key = dismissKey;
		if (key === lastCheckedKey) return;
		lastCheckedKey = key;
		void (async () => {
			try {
				folderStatus = await getLibraryFolderStatus();
			} catch {
				folderStatus = 'permission-needed';
			}
		})();
	});

	function dismiss() {
		dismissedKeys = new Set([...dismissedKeys, dismissKey]);
		message = '';
		busy = false;
	}

	function runBackgroundAfterGrant() {
		void (async () => {
			try {
				const { resyncLibraryFromDisk } = await import('$lib/stores/download.svelte');
				await resyncLibraryFromDisk().catch(() => 0);
			} catch {
				/* ignore */
			}
			try {
				const { exportBookmarksToDisk } = await import('$lib/stores/bookmark.svelte');
				await exportBookmarksToDisk();
			} catch {
				/* ignore */
			}
			try {
				onGranted?.();
			} catch (e) {
				console.warn('[DiskPermissionOverlay] onGranted', e);
			}

			try {
				window.dispatchEvent(new CustomEvent('library-folder-granted'));
			} catch {
				/* ignore */
			}
		})();
	}

	async function grant() {
		if (busy) return;
		busy = true;
		message = '';
		try {
			const root =
				folderStatus === 'permission-needed'
					? await requestStoredLibraryRoot()
					: await pickLibraryRoot();

			if (!root) {
				folderStatus = await getLibraryFolderStatus();
				message =
					folderStatus === 'permission-needed'
						? 'Permission not granted. Tap Grant access again.'
						: 'Folder not connected. Try again.';
				busy = false;
				return;
			}

			setPreferences({ autoDownloadOnRead: true });
			folderStatus = 'connected';
			dismiss();
			runBackgroundAfterGrant();
		} catch (e) {
			console.warn('[DiskPermissionOverlay]', e);
			message = 'Could not open folder permission. Try again.';
			busy = false;
		}
	}
</script>

{#if visible}
	<div
		class="fixed inset-0 z-[900] flex items-end justify-center bg-black/55 p-4 sm:items-center"
		role="dialog"
		aria-modal="true"
		aria-labelledby="disk-perm-title"
	>
		<button
			type="button"
			class="absolute inset-0 cursor-default"
			aria-label="Dismiss"
			onclick={dismiss}
		></button>

		<div
			class="relative z-10 w-full max-w-md rounded-2xl border border-violet-300/50 bg-white p-5 shadow-2xl dark:border-violet-700/50 dark:bg-zinc-900"
		>
			<button
				type="button"
				class="absolute right-3 top-3 rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
				aria-label="Close"
				onclick={dismiss}
			>
				<X class="h-4 w-4" />
			</button>

			<div class="flex items-start gap-3 pr-6">
				<div
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
				>
					<HardDrive class="h-5 w-5" />
				</div>
				<div class="min-w-0 flex-1">
					<h2 id="disk-perm-title" class="text-base font-semibold text-zinc-900 dark:text-zinc-50">
						Save this chapter to disk?
					</h2>
					<p class="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
						Tap Grant access once. The overlay closes right away — saving continues in the
						background while you keep reading.
					</p>
				</div>
			</div>

			{#if message}
				<p class="mt-3 text-xs text-amber-700 dark:text-amber-300" role="status">{message}</p>
			{/if}

			<div class="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
				<button
					type="button"
					onclick={dismiss}
					class="order-2 rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800 sm:order-1"
				>
					Not now
				</button>
				<button
					type="button"
					onclick={grant}
					disabled={busy}
					class="order-1 inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50 sm:order-2"
				>
					<FolderOpen class="h-4 w-4" />
					{busy
						? 'Allow in browser…'
						: folderStatus === 'permission-needed'
							? 'Grant access'
							: 'Choose folder'}
				</button>
			</div>
		</div>
	</div>
{/if}
