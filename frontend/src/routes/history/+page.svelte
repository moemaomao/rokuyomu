<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { chapterHref, isNovelSource } from '$lib/utils/novelSources';
	import { History, Trash2, BookOpen, Clock } from 'lucide-svelte';
	import { getHistory, clearHistory, removeFromHistory, type ReadingEntry } from '$lib/stores/history';

	let history = $state<ReadingEntry[]>([]);

	function loadHistory() {
		history = getHistory();
	}

	onMount(() => {
		loadHistory();
		window.addEventListener('history-changed', loadHistory);
		return () => window.removeEventListener('history-changed', loadHistory);
	});

	async function handleClear() {
		if (!confirm('Clear all reading history?')) return;
		history = [];
		try {
			await clearHistory();
		} finally {
			loadHistory();
		}
	}

	async function handleRemove(mangaId: string) {
		history = history.filter((h) => h.mangaId !== mangaId);
		try {
			await removeFromHistory(mangaId);
		} finally {
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
            <p class="mt-1 text-sm text-zinc-500">{history.length} entries</p>
        </div>

        {#if history.length > 0}
            <button
                onclick={handleClear}
                class="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-red-400 hover:bg-red-400/10 hover:text-red-300 transition-colors"
            >
                <Trash2 class="h-4 w-4" />
                Clear All
            </button>
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
                    class="group relative flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/10 transition hover:border-zinc-700"
                >
                    <!-- Cover -->
                    <a
                        href={mangaHref}
                        onclick={(e) => handleNavigate(e, mangaHref)}
                        class="relative aspect-[3/4] w-full overflow-hidden bg-zinc-800"
                    >
                        {#if entry.cover}
                            <img
                                src="/api/proxy?url={encodeURIComponent(entry.cover)}&source={entry.sourceId}"
								onerror={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0'; }}
                                alt={entry.mangaTitle}
                                class="h-full w-full object-cover transition duration-300 group-hover:scale-105"
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
