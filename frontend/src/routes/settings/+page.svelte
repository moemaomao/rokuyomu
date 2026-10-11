<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Settings,
		Download,
		Upload,
		HardDrive,
		Info,
		Check,
		AlertTriangle,
		Database,
		SlidersHorizontal,
		Trash2,
		RefreshCw
	} from 'lucide-svelte';
	import { exportBackupToFile, importBackupFromFile } from '$lib/utils/backup';
	import {
		getDB,
		idbClearLibrary,
		idbClearActivityLog,
		idbClearNotifications,
		idbClearHistory,
		idbClearBookmarks
	} from '$lib/db';

	let isDark = $state(true);
	let busy = $state(false);
	let msg = $state('');
	let err = $state('');
	let lastCounts = $state<Record<string, number> | null>(null);
	let fileInput: HTMLInputElement | null = $state(null);

	let storageBusy = $state(false);
	let storageMsg = $state('');
	let storageErr = $state('');
	let storageInfo = $state<{
		usage: number;
		quota: number;
		bookmarks: number;
		history: number;
		notifications: number;
		library: number;
		covers: number;
		activity: number;
	} | null>(null);

	onMount(() => {
		isDark = document.documentElement.classList.contains('dark');
		const obs = new MutationObserver(() => {
			isDark = document.documentElement.classList.contains('dark');
		});
		obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
		refreshStorage();
		return () => obs.disconnect();
	});

	function formatBytes(n: number): string {
		if (!n || n < 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB'];
		let v = n;
		let i = 0;
		while (v >= 1024 && i < units.length - 1) {
			v /= 1024;
			i++;
		}
		return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
	}

	async function refreshStorage() {
		storageBusy = true;
		storageErr = '';
		try {
			let usage = 0;
			let quota = 0;
			if (navigator.storage?.estimate) {
				const est = await navigator.storage.estimate();
				usage = est.usage ?? 0;
				quota = est.quota ?? 0;
			}

			const db = await getDB();
			const [bookmarks, history, notifications, library, covers, activity] = await Promise.all([
				db.count('bookmarks'),
				db.count('history'),
				db.count('notifications'),
				db.count('library'),
				db.count('libraryCovers'),
				db.count('activityLog')
			]);

			storageInfo = {
				usage,
				quota,
				bookmarks,
				history,
				notifications,
				library,
				covers,
				activity
			};
		} catch (e: any) {
			storageErr = e?.message || 'Failed to read storage';
		} finally {
			storageBusy = false;
		}
	}

	async function clearLibraryCovers() {
		if (!confirm('Clear all cached cover images in IndexedDB? Library titles stay; covers re-download when needed.')) {
			return;
		}
		storageBusy = true;
		storageMsg = '';
		storageErr = '';
		try {
			const db = await getDB();
			await db.clear('libraryCovers');
			storageMsg = 'Cover cache cleared.';
			await refreshStorage();
		} catch (e: any) {
			storageErr = e?.message || 'Failed to clear covers';
		} finally {
			storageBusy = false;
		}
	}

	async function clearActivityOnly() {
		if (!confirm('Clear activity log (stats graph data, last 30 days)?')) return;
		storageBusy = true;
		storageMsg = '';
		storageErr = '';
		try {
			await idbClearActivityLog();
			storageMsg = 'Activity log cleared.';
			await refreshStorage();
		} catch (e: any) {
			storageErr = e?.message || 'Failed to clear activity log';
		} finally {
			storageBusy = false;
		}
	}

	async function clearLibraryMeta() {
		if (
			!confirm(
				'Clear offline library metadata in IndexedDB? Disk folder RokuyomuLibrary is NOT deleted. You can re-sync from bookmarks.'
			)
		) {
			return;
		}
		storageBusy = true;
		storageMsg = '';
		storageErr = '';
		try {
			await idbClearLibrary();
			const db = await getDB();
			await db.clear('libraryCovers');
			storageMsg = 'Library metadata + cover cache cleared.';
			await refreshStorage();
		} catch (e: any) {
			storageErr = e?.message || 'Failed to clear library';
		} finally {
			storageBusy = false;
		}
	}

	async function clearReadingData() {
		if (
			!confirm(
				'Clear bookmarks, history, and notifications on this device? Permanent stats are kept. This cannot be undone.'
			)
		) {
			return;
		}
		storageBusy = true;
		storageMsg = '';
		storageErr = '';
		try {
			await idbClearBookmarks();
			await idbClearHistory();
			await idbClearNotifications();
			storageMsg = 'Bookmarks, history, and notifications cleared.';
			await refreshStorage();
		} catch (e: any) {
			storageErr = e?.message || 'Failed to clear reading data';
		} finally {
			storageBusy = false;
		}
	}

	async function handleExport() {
		busy = true;
		msg = '';
		err = '';
		try {
			const b = await exportBackupToFile();
			msg = `Backup exported (${b.data.bookmarks.length} bookmarks, ${b.data.library.length} library, ${b.data.history.length} history).`;
		} catch (e: any) {
			err = e?.message || 'Export failed';
		} finally {
			busy = false;
		}
	}

	async function handleImportFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (
			!confirm(
				'Import will replace bookmarks, history, library meta, and notifications on this device. Continue?'
			)
		) {
			return;
		}
		busy = true;
		msg = '';
		err = '';
		lastCounts = null;
		try {
			const res = await importBackupFromFile(file);
			lastCounts = res.counts;
			msg = 'Backup imported. Reload the page to apply theme / preferred sources.';
			await refreshStorage();
		} catch (e: any) {
			err = e?.message || 'Import failed';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Settings · Rokuyomu</title>
</svelte:head>

<div class="mx-auto max-w-2xl px-4 py-8">
	<div class="mb-8 flex items-center gap-3">
		<div
			class="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-600/15 text-violet-600 dark:text-violet-400"
		>
			<Settings class="h-5 w-5" />
		</div>
		<div>
			<h1 class="text-xl font-bold text-zinc-900 dark:text-zinc-100">Settings</h1>
			<p class="text-sm text-zinc-500">Backup, data, and app preferences</p>
		</div>
	</div>

	<!-- Backup -->
	<section
		class="mb-6 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900/40"
	>
		<div class="mb-3 flex items-center gap-2">
			<HardDrive class="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
			<h2 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Backup & restore</h2>
		</div>
		<p class="mb-4 text-xs leading-relaxed text-zinc-500">
			Export bookmarks, reading history, library metadata, notifications, XP stats, and local
			preferences (theme, preferred sources, novel reader settings) as a JSON file. Offline chapter
			<strong>images/text blobs are not included</strong> — re-download chapters after import if
			needed. Your disk folder <code class="text-[11px]">RokuyomuLibrary</code> is separate.
		</p>

		<div class="flex flex-wrap gap-2">
			<button
				type="button"
				disabled={busy}
				onclick={handleExport}
				class="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:opacity-50"
			>
				<Download class="h-4 w-4" />
				Export backup
			</button>
			<button
				type="button"
				disabled={busy}
				onclick={() => fileInput?.click()}
				class="inline-flex items-center gap-2 rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-2.5 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
			>
				<Upload class="h-4 w-4" />
				Import backup
			</button>
			<input
				bind:this={fileInput}
				type="file"
				accept="application/json,.json"
				class="hidden"
				onchange={handleImportFile}
			/>
		</div>

		{#if msg}
			<p
				class="mt-3 flex items-start gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
			>
				<Check class="mt-0.5 h-3.5 w-3.5 shrink-0" />
				{msg}
			</p>
		{/if}
		{#if err}
			<p
				class="mt-3 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400"
			>
				<AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
				{err}
			</p>
		{/if}
		{#if lastCounts}
			<ul class="mt-2 grid grid-cols-2 gap-1 text-[11px] text-zinc-500">
				{#each Object.entries(lastCounts) as [k, v]}
					<li>{k}: <strong class="text-zinc-800 dark:text-zinc-200">{v}</strong></li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- Source preferences shortcut -->
	<section
		class="mb-6 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900/40"
	>
		<div class="mb-2 flex items-center gap-2">
			<SlidersHorizontal class="h-4 w-4 text-violet-600 dark:text-violet-400" />
			<h2 class="text-sm font-semibold">Source preferences</h2>
		</div>
		<p class="mb-3 text-xs text-zinc-500">
			Choose preferred comic/novel sources (homepage priority). Moved to its own page.
		</p>
		<a
			href="/source-preferences"
			class="inline-flex text-sm font-medium text-violet-600 hover:underline dark:text-violet-400"
		>
			Open Source Preferences →
		</a>
	</section>

	<!-- Data & storage (active) -->
	<section
		class="mb-6 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900/40"
	>
		<div class="mb-3 flex items-center justify-between gap-2">
			<div class="flex items-center gap-2">
				<Database class="h-4 w-4 text-sky-600 dark:text-sky-400" />
				<h2 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Data & storage</h2>
			</div>
			<button
				type="button"
				disabled={storageBusy}
				onclick={refreshStorage}
				class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
			>
				<RefreshCw class="h-3 w-3 {storageBusy ? 'animate-spin' : ''}" />
				Refresh
			</button>
		</div>
		<p class="mb-4 text-xs leading-relaxed text-zinc-500">
			Browser storage estimate and IndexedDB counts. Disk folder
			<code class="text-[11px]">RokuyomuLibrary</code> (File System Access) is separate and not cleared here.
		</p>

		{#if storageInfo}
			<div class="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
				<div class="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/60">
					<p class="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Used</p>
					<p class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{formatBytes(storageInfo.usage)}</p>
				</div>
				<div class="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/60">
					<p class="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Quota</p>
					<p class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{formatBytes(storageInfo.quota)}</p>
				</div>
				<div class="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/60">
					<p class="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Library</p>
					<p class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{storageInfo.library} titles</p>
				</div>
				<div class="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/60">
					<p class="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Covers</p>
					<p class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{storageInfo.covers}</p>
				</div>
				<div class="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/60">
					<p class="text-[10px] font-medium uppercase tracking-wide text-zinc-500">Bookmarks</p>
					<p class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{storageInfo.bookmarks}</p>
				</div>
				<div class="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/60">
					<p class="text-[10px] font-medium uppercase tracking-wide text-zinc-500">History</p>
					<p class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{storageInfo.history}</p>
				</div>
			</div>
			<p class="mb-4 text-[11px] text-zinc-500">
				Notifications: {storageInfo.notifications} · Activity log: {storageInfo.activity}
			</p>
		{:else if storageBusy}
			<p class="mb-4 text-xs text-zinc-500">Loading storage info…</p>
		{/if}

		<div class="flex flex-col gap-2">
			<button
				type="button"
				disabled={storageBusy}
				onclick={clearLibraryCovers}
				class="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-2.5 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
			>
				<Trash2 class="h-4 w-4" />
				Clear cover cache
			</button>
			<button
				type="button"
				disabled={storageBusy}
				onclick={clearActivityOnly}
				class="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-2.5 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
			>
				<Trash2 class="h-4 w-4" />
				Clear activity log
			</button>
			<button
				type="button"
				disabled={storageBusy}
				onclick={clearLibraryMeta}
				class="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300/80 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/70"
			>
				<Trash2 class="h-4 w-4" />
				Clear library metadata
			</button>
			<button
				type="button"
				disabled={storageBusy}
				onclick={clearReadingData}
				class="inline-flex items-center justify-center gap-2 rounded-xl border border-red-300/80 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-800 transition hover:bg-red-100 disabled:opacity-50 dark:border-red-800/50 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/70"
			>
				<Trash2 class="h-4 w-4" />
				Clear bookmarks, history & notifications
			</button>
		</div>

		{#if storageMsg}
			<p
				class="mt-3 flex items-start gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
			>
				<Check class="mt-0.5 h-3.5 w-3.5 shrink-0" />
				{storageMsg}
			</p>
		{/if}
		{#if storageErr}
			<p
				class="mt-3 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400"
			>
				<AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
				{storageErr}
			</p>
		{/if}
	</section>

	<section
		class="mb-6 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/50 p-5 dark:border-zinc-700 dark:bg-zinc-900/20"
	>
		<div class="mb-2 flex items-center gap-2">
			<Info class="h-4 w-4 text-zinc-400" />
			<h2 class="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Reader defaults</h2>
		</div>
		<p class="text-xs text-zinc-500">
			Coming soon: default manga reader mode (webtoon/page), data saver defaults.
		</p>
	</section>
</div>
