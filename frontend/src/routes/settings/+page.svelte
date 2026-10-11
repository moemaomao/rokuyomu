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
		SlidersHorizontal
	} from 'lucide-svelte';
	import { exportBackupToFile, importBackupFromFile } from '$lib/utils/backup';

	let isDark = $state(true);
	let busy = $state(false);
	let msg = $state('');
	let err = $state('');
	let lastCounts = $state<Record<string, number> | null>(null);
	let fileInput: HTMLInputElement | null = $state(null);

	onMount(() => {
		isDark = document.documentElement.classList.contains('dark');
		const obs = new MutationObserver(() => {
			isDark = document.documentElement.classList.contains('dark');
		});
		obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
		return () => obs.disconnect();
	});

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

	<!-- Placeholder sections -->
	<section
		class="mb-6 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/50 p-5 dark:border-zinc-700 dark:bg-zinc-900/20"
	>
		<div class="mb-2 flex items-center gap-2">
			<Database class="h-4 w-4 text-zinc-400" />
			<h2 class="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Data & storage</h2>
		</div>
		<p class="text-xs text-zinc-500">
			Coming soon: clear cache, storage usage estimate, clear offline chapters only.
		</p>
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
