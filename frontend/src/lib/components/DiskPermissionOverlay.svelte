<script lang="ts">
	import { browser } from '$app/environment';
	import {
		chooseLibraryFolder,
		getLibraryFolderStatus,
		librarySupportsDisk,
		requestLibraryFolderPermission,
		type LibraryFolderStatus
	} from '$lib/stores/download.svelte';
	import {
		prefersDiskDownload,
		shouldAutoDownloadOnRead,
		setPreferences
	} from '$lib/stores/preferences';
	import { FolderOpen, HardDrive, X } from 'lucide-svelte';

	let {
		progress = 0,
		nearEnd = false,
		chapterKey = '',
		threshold = 92
	}: {
		progress?: number;
		nearEnd?: boolean;
		chapterKey?: string;
		threshold?: number;
	} = $props();

	let supported = $state(false);
	let folderStatus = $state<LibraryFolderStatus>('unlinked');
	let busy = $state(false);
	let message = $state('');
	let dismissedKeys = $state(new Set<string>());
	let lastCheckedKey = $state('');

	const atEnd = $derived(Boolean(nearEnd) || Number(progress) >= threshold);
	const wantsDisk = $derived(shouldAutoDownloadOnRead() || prefersDiskDownload());
	const dismissKey = $derived(`disk-perm:${chapterKey || 'chapter'}`);

	const visible = $derived(
		browser &&
			supported &&
			wantsDisk &&
			atEnd &&
			(folderStatus === 'permission-needed' || folderStatus === 'unlinked') &&
			!dismissedKeys.has(dismissKey)
	);

	$effect(() => {
		if (!browser) return;
		supported = librarySupportsDisk();
		if (!supported || !wantsDisk) return;
		const key = dismissKey;
		const end = atEnd;
		if (!end && key === lastCheckedKey) return;
		lastCheckedKey = key;
		void (async () => {
			try {
				folderStatus = await getLibraryFolderStatus();
			} catch {
				folderStatus = 'permission-needed';
			}
		})();
	});

	$effect(() => {
		if (!browser || !atEnd || !wantsDisk || !supported) return;
		void (async () => {
			folderStatus = await getLibraryFolderStatus();
		})();
	});

	function dismiss() {
		dismissedKeys = new Set([...dismissedKeys, dismissKey]);
		message = '';
	}

	async function grant() {
		busy = true;
		message = '';
		try {
			const connected =
				folderStatus === 'permission-needed'
					? await requestLibraryFolderPermission()
					: await chooseLibraryFolder();
			if (connected) {
				setPreferences({ autoDownloadOnRead: true });
				folderStatus = 'connected';
				dismiss();
				return;
			}
			folderStatus = await getLibraryFolderStatus();
			message =
				folderStatus === 'permission-needed'
					? 'Permission not granted. Tap Grant access again.'
					: 'Folder not connected. Try again.';
		} catch (e) {
			console.warn('[DiskPermissionOverlay]', e);
			message = 'Could not open folder permission. Try again.';
		} finally {
			busy = false;
		}
	}
</script>

{#if visible}
	<!-- backdrop -->
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
						Auto-download is on, but the browser needs folder permission again
						{#if folderStatus === 'permission-needed'}
							(common on mobile each visit).
						{:else}
							— choose a folder once for this session.
						{/if}
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
						? 'Waiting…'
						: folderStatus === 'permission-needed'
							? 'Grant access'
							: 'Choose folder'}
				</button>
			</div>
		</div>
	</div>
{/if}
