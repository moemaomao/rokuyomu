<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { chapterHref } from '$lib/utils/novelSources';
	import {
		History,
		Trash2,
		BookOpen,
		Clock,
		RefreshCw,
		HardDrive,
		Database,
		Info
	} from 'lucide-svelte';
	import {
		getHistory,
		clearHistory,
		removeFromHistory,
		whenHistoryReady,
		isHistoryReady,
		type ReadingEntry
	} from '$lib/stores/history';
	import {
		getPreferences,
		setPreferences,
		subscribePreferences,
		type HistoryStorageMode
	} from '$lib/stores/preferences';
	import { proxyImage } from '$lib/utils/image';
	import { supportsFileSystemAccess, getRootFolderName, getHistorySubdirName } from '$lib/utils/localFs';

	let history = $state<ReadingEntry[]>([]);
	let refreshing = $state(false);
	let ready = $state(false);
	let storageMode = $state<HistoryStorageMode>(getPreferences().historyStorageMode || 'cache');
	let fsSupported = $state(false);

	const diskPathLabel = $derived(`${getRootFolderName()}/${getHistorySubdirName()}/`);

	function loadHistory() {
		try {
			history = getHistory() || [];
		} catch (e) {
			console.warn('[history page] loadHistory', e);
			history = [];
		}
	}

	async function handleRefresh() {
		refreshing = true;
		try {
			loadHistory();
			await new Promise((r) => setTimeout(r, 120));
		} finally {
			refreshing = false;
		}
	}

	function setStorageMode(mode: HistoryStorageMode) {
		if (mode === 'disk' && !fsSupported) {
			alert('Local disk requires a browser with File System Access API (Chrome / Edge).');
			return;
		}
		storageMode = mode;
		setPreferences({ historyStorageMode: mode });
	}

	onMount(() => {
		let cancelled = false;
		fsSupported = supportsFileSystemAccess();
		storageMode = getPreferences().historyStorageMode || 'cache';

		loadHistory();
		ready = isHistoryReady();

		if (!ready) {
			(async () => {
				try {
					await whenHistoryReady();
				} catch {
					/* ignore */
				}
				if (!cancelled) {
					ready = true;
					loadHistory();
				}
			})();
		}

		const onChanged = () => {
			if (!cancelled) loadHistory();
		};
		window.addEventListener('history-changed', onChanged);

		const unsub = subscribePreferences((p) => {
			if (!cancelled) storageMode = p.historyStorageMode || 'cache';
		});

		return () => {
			cancelled = true;
			window.removeEventListener('history-changed', onChanged);
			unsub();
		};
	});

	async function handleClear() {
		if (!confirm('Clear all reading history?')) return;
		const prev = history;
		history = [];
		try {
			await clearHistory();
		} catch (e) {
			console.error(e);
			history = prev;
			loadHistory();
		}
	}

	async function handleRemove(mangaId: string) {
		history = history.filter((h) => h.mangaId !== mangaId);
		try {
			await removeFromHistory(mangaId);
		} catch (e) {
			console.error(e);
			loadHistory();
		}
	}

	function handleNavigate(e: MouseEvent, href: string) {
		e.preventDefault();
		goto(href);
	}

	function formatTime(timestamp: number): string {
		const diff = Date.now() - timestamp;
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (days > 0) return `${days}d ago`;
		if (hours > 0) return `${hours}h ago`;
		if (minutes > 0) return `${minutes}m ago`;
		return 'Just now';
	}
</script>

<svelte:head>
	<title>My History</title>
</svelte:head>

<div class="mx-auto max-w-7xl p-4 md:p-6">
	<!-- Header -->
	<div class="mb-5 flex flex-col gap-3 border-b border-[var(--border-color)] pb-4 sm:flex-row sm:items-end sm:justify-between">
		<div>
			<h1 class="text-xl font-bold text-[var(--text-primary)]">Reading History</h1>
			<p class="mt-0.5 text-sm text-[var(--text-secondary)]">
				{#if ready}
					{history.length} entries
					{#if storageMode === 'disk'}
						· <span class="text-emerald-600 dark:text-emerald-400">unlimited (disk)</span>
					{:else}
						· <span class="text-zinc-500">max 80 (cache)</span>
					{/if}
				{:else}
					Loading…
				{/if}
			</p>
		</div>

		<div class="flex flex-wrap items-center gap-2">
			<button
				type="button"
				onclick={handleRefresh}
				disabled={refreshing}
				class="flex items-center gap-2 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-sm
					text-[var(--text-secondary)] transition hover:bg-[var(--hover-bg)] disabled:opacity-50"
				title="Refresh"
			>
				<RefreshCw class="h-4 w-4 {refreshing ? 'animate-spin' : ''}" />
				Refresh
			</button>
			{#if history.length > 0}
				<button
					type="button"
					onclick={handleClear}
					class="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-red-500 transition
						hover:bg-red-500/10 hover:text-red-400"
				>
					<Trash2 class="h-4 w-4" />
					Clear All
				</button>
			{/if}
		</div>
	</div>

	<!-- Storage info card -->
	<div
		class="mb-6 rounded-xl border border-amber-500/25 bg-amber-50/80 px-4 py-3.5
			dark:border-amber-500/20 dark:bg-amber-950/30"
	>
		<div class="flex gap-2.5">
			<Info class="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
			<div class="min-w-0 flex-1 space-y-2">
				<p class="text-sm font-semibold text-amber-900 dark:text-amber-100">
					Where is history stored?
				</p>
				<p class="text-xs leading-relaxed text-amber-900/80 dark:text-amber-100/75">
					<span class="font-semibold">Browser cache</span>
					keeps reading history in IndexedDB on this device only (max 80 titles). Covers stay as remote
					URLs. Fast and private to the browser profile.
				</p>
				<p class="text-xs leading-relaxed text-amber-900/80 dark:text-amber-100/75">
					<span class="font-semibold">Local disk (offline)</span>
					also writes
					<code class="rounded bg-black/10 px-1 py-0.5 text-[10px] dark:bg-white/10">history.json</code>
					and cover files under
					<code class="rounded bg-black/10 px-1 py-0.5 text-[10px] dark:bg-white/10">{diskPathLabel}</code>
					(or privacy-renamed folders).
					<span class="font-semibold">No 80-title limit</span>
					— useful for long-term offline progress. Requires Chrome/Edge and a folder grant.
				</p>

				<div class="flex flex-wrap items-center gap-2 pt-1">
					<button
						type="button"
						onclick={() => setStorageMode('cache')}
						class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition
							{storageMode === 'cache'
							? 'border-zinc-400 bg-white text-zinc-900 shadow-sm dark:border-zinc-500 dark:bg-zinc-800 dark:text-zinc-100'
							: 'border-transparent bg-white/50 text-zinc-600 hover:bg-white dark:bg-zinc-900/40 dark:text-zinc-400 dark:hover:bg-zinc-800'}"
					>
						<Database class="h-3.5 w-3.5" />
						Browser cache (max 80)
					</button>
					<button
						type="button"
						onclick={() => setStorageMode('disk')}
						disabled={!fsSupported}
						class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition
							{storageMode === 'disk'
							? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-800 shadow-sm dark:text-emerald-300'
							: 'border-transparent bg-white/50 text-zinc-600 hover:bg-white dark:bg-zinc-900/40 dark:text-zinc-400 dark:hover:bg-zinc-800'}
							disabled:cursor-not-allowed disabled:opacity-40"
						title={fsSupported
							? 'Write history.json + covers to your offline folder'
							: 'File System Access API not available'}
					>
						<HardDrive class="h-3.5 w-3.5" />
						Local disk (unlimited)
					</button>
					{#if storageMode === 'disk'}
						<span class="text-[11px] text-emerald-700 dark:text-emerald-400">
							{history.length} titles · no 80 cap · offline JSON
						</span>
					{:else}
						<span class="text-[11px] text-zinc-500">
							{history.length} / 80 titles · IndexedDB only
						</span>
					{/if}
				</div>
			</div>
		</div>
	</div>

	<!-- Grid -->
	{#if !ready}
		<div class="flex flex-col items-center justify-center py-24 text-zinc-500">
			<History class="mb-3 h-10 w-10 opacity-40" />
			<p class="text-sm">Loading history…</p>
		</div>
	{:else if history.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-zinc-500">
			<History class="mb-3 h-10 w-10 opacity-40" />
			<p class="text-sm">No reading history yet.</p>
		</div>
	{:else}
		<div
			class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8"
		>
			{#each history as entry (entry.mangaId + '-' + entry.timestamp)}
				{@const mangaHref = `/manga/${entry.sourceId}${entry.mangaId}`}
				{@const readHref = chapterHref(entry.sourceId, entry.chapterId)}
				<div
					class="history-card group flex flex-col overflow-hidden rounded-xl border border-[var(--border-color)]
						bg-[var(--card-bg,transparent)] transition hover:border-zinc-400 dark:hover:border-zinc-600"
				>
					<a
						href={mangaHref}
						onclick={(e) => handleNavigate(e, mangaHref)}
						class="relative aspect-[3/4] w-full overflow-hidden bg-zinc-200 dark:bg-zinc-800"
					>
						{#if entry.cover}
							<img
								src={proxyImage(entry.cover, entry.sourceId, 160)}
								onerror={(e) => {
									(e.currentTarget as HTMLImageElement).style.opacity = '0';
								}}
								alt={entry.mangaTitle}
								class="history-card-cover h-full w-full object-cover"
								loading="lazy"
								decoding="async"
								fetchpriority="low"
							/>
						{:else}
							<div class="flex h-full w-full items-center justify-center">
								<BookOpen class="h-8 w-8 text-zinc-400 dark:text-zinc-600" />
							</div>
						{/if}

						<span
							class="absolute top-2 left-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[9px] font-bold capitalize text-white backdrop-blur-md"
						>
							{entry.sourceId}
						</span>
					</a>

					<div class="flex flex-1 flex-col justify-between p-2.5">
						<div class="space-y-1">
							<a
								href={mangaHref}
								onclick={(e) => handleNavigate(e, mangaHref)}
								class="line-clamp-1 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
								title={entry.mangaTitle}
							>
								{entry.mangaTitle}
							</a>
							<a
								href={readHref}
								onclick={(e) => handleNavigate(e, readHref)}
								class="line-clamp-1 text-[11px] text-[var(--color-primary)] transition-colors hover:opacity-80"
								title={entry.chapterTitle}
							>
								{entry.chapterTitle}
							</a>
						</div>

						<div
							class="mt-3 flex items-center justify-between border-t border-[var(--border-color)] pt-2"
						>
							<span class="flex items-center gap-1 text-[10px] text-zinc-500">
								<Clock class="h-3 w-3" />
								{formatTime(entry.timestamp)}
							</span>

							<button
								onclick={() => handleRemove(entry.mangaId)}
								class="text-zinc-400 transition-colors hover:text-red-500"
								title="Remove entry"
							>
								<Trash2 class="h-3.5 w-3.5" />
							</button>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.history-card {
		content-visibility: auto;
		contain-intrinsic-size: auto 280px;
		contain: layout style paint;
	}
	@media (hover: hover) and (pointer: fine) {
		.history-card-cover {
			transition: transform 0.3s ease;
		}
		.group:hover .history-card-cover {
			transform: scale(1.05);
		}
	}
</style>
