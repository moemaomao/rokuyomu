<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { chapterHref, isNovelSource } from '$lib/utils/novelSources';
	import { History, Trash2, BookOpen, Clock, RefreshCw, HardDrive, Database, Info } from 'lucide-svelte';
	import {
		getHistory,
		clearHistory,
		removeFromHistory,
		whenHistoryReady,
		applyHistoryStorageMode,
		exportHistoryToDisk,
		reloadHistoryFromStorage,
		type ReadingEntry
	} from '$lib/stores/history';
	import { getPreferences, subscribePreferences, type HistoryStorageMode } from '$lib/stores/preferences';
	import { supportsFileSystemAccess } from '$lib/utils/localFs';
	import { chooseLibraryFolder } from '$lib/stores/library.svelte';
    import { proxyImage } from '$lib/utils/image';

	let history = $state<ReadingEntry[]>([]);
	let refreshing = $state(false);
	let storageMode = $state<HistoryStorageMode>(getPreferences().historyStorageMode || 'cache');
	let modeBusy = $state(false);
	let modeMsg = $state('');
	const fsOk = supportsFileSystemAccess();

	function loadHistory() {
		history = getHistory();
	}

	async function handleRefresh() {
		refreshing = true;
		try {
			await reloadHistoryFromStorage();
			loadHistory();
			await new Promise((r) => setTimeout(r, 200));
		} finally {
			refreshing = false;
		}
	}

	onMount(() => {
		let cancelled = false;
		storageMode = getPreferences().historyStorageMode || 'cache';
		(async () => {
			await whenHistoryReady();
			if (!cancelled) {
				if ((getPreferences().historyStorageMode || 'cache') === 'disk') {
					await reloadHistoryFromStorage();
				}
				loadHistory();
			}
		})();
		window.addEventListener('history-changed', loadHistory);
		const unsub = subscribePreferences((p) => {
			storageMode = p.historyStorageMode || 'cache';
		});
		return () => {
			cancelled = true;
			window.removeEventListener('history-changed', loadHistory);
			unsub();
		};
	});

	async function setStorageMode(mode: HistoryStorageMode) {
		if (mode === storageMode || modeBusy) return;
		modeBusy = true;
		modeMsg = '';
		try {
			if (mode === 'disk') {
				if (!fsOk) {
					modeMsg = 'Local disk requires Chrome or Edge (File System Access API).';
					return;
				}
				const ok = await chooseLibraryFolder();
				if (!ok) {
					modeMsg = 'Folder not selected — staying on browser cache.';
					return;
				}
			}
			await applyHistoryStorageMode(mode);
			storageMode = mode;
			await reloadHistoryFromStorage();
			loadHistory();
			if (mode === 'disk') {
				const res = await exportHistoryToDisk();
				modeMsg = res.ok
					? `Disk mode on — ${history.length} titles (no 80 cap). Saved to History/history.json.`
					: 'Disk mode on. Grant the folder to write history.json + covers.';
			} else {
				modeMsg = `Browser cache — max 80 titles (${history.length} shown).`;
			}
		} catch (e: any) {
			modeMsg = e?.message || 'Failed to change storage mode';
		} finally {
			modeBusy = false;
		}
	}

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
    <div class="mb-6 flex items-center justify-between border-b border-zinc-800 pb-4">
        <div>
            <h1 class="text-xl font-bold text-[var(--color-primary)] md:text-2xl">
                Reading History
            </h1>
            <p class="mt-1 text-sm text-zinc-500">
				{history.length} entries
				{#if storageMode === 'disk'}
					<span class="text-emerald-700 dark:text-emerald-500/80">· unlimited (disk)</span>
				{:else}
					<span class="text-zinc-600">· max 80 (cache)</span>
				{/if}
			</p>
        </div>

        <div class="flex items-center gap-2">
            <button
                type="button"
                onclick={handleRefresh}
                disabled={refreshing}
                class="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-50"
                title="Refresh"
            >
                <RefreshCw class="h-4 w-4 {refreshing ? 'animate-spin' : ''}" />
                Refresh
            </button>
            {#if history.length > 0}
                <button
                    type="button"
                    onclick={handleClear}
                    class="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-red-400 hover:bg-red-400/10 hover:text-red-300 transition-colors"
                >
                    <Trash2 class="h-4 w-4" />
                    Clear All
                </button>
            {/if}
        </div>
    </div>

	<!-- Storage mode toggle -->
	<div
		class="mb-6 rounded-xl border border-zinc-200 bg-zinc-50/90 p-4 dark:border-zinc-800 dark:bg-zinc-900/40"
	>
		<div class="mb-3 flex items-start gap-2">
			<Info class="mt-0.5 h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
			<div class="text-sm text-zinc-600 dark:text-zinc-400">
				<p class="font-medium text-zinc-800 dark:text-zinc-200">Where is history stored?</p>
				<p class="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
					<strong class="text-zinc-700 dark:text-zinc-300">Browser cache</strong> keeps reading history in IndexedDB on this device only
					(max <strong>80</strong> titles). Covers stay as remote URLs. Fast and private to the browser profile.
				</p>
				<p class="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
					<strong class="text-zinc-700 dark:text-zinc-300">Local disk (offline)</strong> also writes
					<code class="rounded bg-zinc-200 px-1 text-[10px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">history.json</code> and cover images under
					<code class="rounded bg-zinc-200 px-1 text-[10px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">Rokuyomu/History/</code>
					(or privacy-renamed folders). <strong class="text-zinc-700 dark:text-zinc-300">No 80-title limit</strong> — useful for long-term offline progress. Requires Chrome/Edge and a folder grant.
				</p>
			</div>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<button
				type="button"
				disabled={modeBusy}
				onclick={() => setStorageMode('cache')}
				class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50
					{storageMode === 'cache'
						? 'border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]'
						: 'border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800'}"
			>
				<Database class="h-3.5 w-3.5" />
				Browser cache (max 80)
			</button>
			<button
				type="button"
				disabled={modeBusy || !fsOk}
				onclick={() => setStorageMode('disk')}
				class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50
					{storageMode === 'disk'
						? 'border-emerald-600 bg-emerald-600/15 text-emerald-700 dark:border-emerald-500 dark:text-emerald-300'
						: 'border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800'}"
				title={!fsOk ? 'Not supported in this browser' : 'Unlimited offline history on disk'}
			>
				<HardDrive class="h-3.5 w-3.5" />
				Local disk (unlimited)
			</button>
			{#if storageMode === 'disk'}
				<span class="text-[11px] text-emerald-700 dark:text-emerald-500/80">{history.length} titles · no 80 cap · offline JSON</span>
			{:else}
				<span class="text-[11px] text-zinc-500 dark:text-zinc-600">{history.length}/80 in cache</span>
			{/if}
		</div>
		{#if modeMsg}
			<p class="mt-2 text-xs text-zinc-500 dark:text-zinc-500">{modeMsg}</p>
		{/if}
	</div>

    {#if history.length === 0}
        <div class="flex flex-col items-center justify-center py-20 text-center">
            <History class="mx-auto mb-4 h-12 w-12 text-zinc-700" />
            <p class="text-zinc-500">No reading history yet.</p>
            <p class="mt-1 text-sm text-zinc-600">Start reading to track your progress.</p>
        </div>
    {:else}
        <div class="grid grid-cols-3 gap-3 sm:gap-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
            {#each history as entry (entry.mangaId + entry.sourceId)}
                {@const mangaHref = `/manga/${entry.sourceId}${entry.mangaId}`}
                {@const readHref = chapterHref(entry.sourceId, entry.chapterId)}

                <div
                    class="history-card group relative flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/10 transition hover:border-zinc-700"
                >
                    <!-- Cover -->
                    <a
                        href={mangaHref}
                        onclick={(e) => handleNavigate(e, mangaHref)}
                        class="relative aspect-[3/4] w-full overflow-hidden bg-zinc-800"
                    >
                        {#if entry.cover}
                      <img
                              src={proxyImage(entry.cover, entry.sourceId, 160)}
                              onerror={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0'; }}
                              alt={entry.mangaTitle}
                              class="history-card-cover h-full w-full object-cover"
                              loading="lazy"
                              decoding="async"
                              fetchpriority="low"
                          />
                       {:else}
                            <div class="flex h-full w-full items-center justify-center">
                                <BookOpen class="h-8 w-8 text-zinc-700" />
                            </div>
                        {/if}

                        <span
                            class="absolute top-2 left-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[9px] font-bold capitalize text-white backdrop-blur-md"
                        >
                            {entry.sourceId}
                        </span>
                    </a>

                    <!-- Info & Actions -->
                    <div class="flex flex-1 flex-col justify-between p-2.5">
                        <div class="space-y-1">
                            <a
                                href={mangaHref}
                                onclick={(e) => handleNavigate(e, mangaHref)}
                                class="line-clamp-1 text-xs font-semibold text-zinc-500 hover:text-white transition-colors"
                                title={entry.mangaTitle}
                            >
                                {entry.mangaTitle}
                            </a>
                            <a
                                href={readHref}
                                onclick={(e) => handleNavigate(e, readHref)}
                                class="line-clamp-1 text-[11px] text-[var(--color-primary)] hover:opacity-80 transition-colors"
                                title={entry.chapterTitle}
                            >
                                {entry.chapterTitle}
                            </a>
                        </div>

                        <div class="mt-3 flex items-center justify-between pt-2 border-t border-zinc-800/60">
                            <span class="flex items-center gap-1 text-[10px] text-zinc-500">
                                <Clock class="h-3 w-3" />
                                {formatTime(entry.timestamp)}
                            </span>

                            <button
                                onclick={() => handleRemove(entry.mangaId)}
                                class="text-zinc-600 hover:text-red-400 transition-colors"
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

