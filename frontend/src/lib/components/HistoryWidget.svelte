<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { History, Trash2, BookOpen, Clock, ChevronRight, X } from 'lucide-svelte';
	import {
		getHistory,
		removeFromHistory,
		type ReadingEntry
	} from '$lib/stores/history';
	import { browser } from '$app/environment';

	let {
		open = $bindable(true),
		isDarkMode = true
	}: {
		open?: boolean;
		isDarkMode?: boolean;
	} = $props();

	let history = $state<ReadingEntry[]>([]);
	const MAX_SHOW = 12;

	function loadHistory() {
		history = getHistory().slice(0, MAX_SHOW);
	}

	function close() {
		open = false;
		if (browser) localStorage.setItem('history_widget_open', 'false');
	}

	async function handleRemove(mangaId: string, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();

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
		if (days > 0) return `${days}d`;
		if (hours > 0) return `${hours}h`;
		if (minutes > 0) return `${minutes}m`;
		return 'now';
	}

	function onCoverError(e: Event) {
		const img = e.currentTarget as HTMLImageElement;
		const original = img.dataset.original;
		if (!original || img.dataset.fallback === '1') {
			img.style.display = 'none';
			return;
		}
		img.dataset.fallback = '1';
		img.src = `/api/proxy?url=${encodeURIComponent(original)}&source=${img.dataset.source || ''}`;
	}

	function proxyCover(entry: ReadingEntry): string {
	   if (!entry.cover) return '';
	   let u = String(entry.cover).trim();
	   if (!u) return '';
	   if (u.startsWith('//')) u = 'https:' + u;
	   if (/^https?:\/\//i.test(u)) {
		return `/api/proxy?url=${encodeURIComponent(u)}&source=${entry.sourceId}`;
	    }
	   return '';
    }

	onMount(() => {
		loadHistory();
		window.addEventListener('history-changed', loadHistory);
		return () => window.removeEventListener('history-changed', loadHistory);
	});
</script>

<aside
    class="history-widget flex h-full min-h-0 w-full flex-col border-l transition-transform duration-300 ease-in-out
        xl:w-[280px]
        {open ? 'translate-x-0' : 'translate-x-full'}
        {isDarkMode ? 'border-zinc-800 bg-gradient-to-b from-violet-950/80 via-zinc-900 to-zinc-950' : 'border-zinc-200 bg-white/95'}"
>
	<!-- Header -->
	<div
		class="relative flex shrink-0 items-center justify-between gap-2 border-b px-3 py-3.5
			{isDarkMode ? 'border-zinc-800/80' : 'border-zinc-200'}"
	>
		<button
			onclick={close}
			class="z-10 shrink-0 rounded-lg p-1.5 transition
				{isDarkMode
				? 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
				: 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900'}"
			aria-label="Close history"
			title="Close"
		>
			<X class="h-4 w-4" />
		</button>

		<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
			<div class="flex items-center gap-1.5">
				<History class="h-4 w-4 text-[var(--color-primary)]" />
				<h2 class="text-sm font-semibold tracking-wide">My History</h2>
			</div>
		</div>

		<div class="z-10 flex shrink-0 items-center">
			{#if history.length > 0}
				<a
					href="/history"
					onclick={(e) => handleNavigate(e, '/history')}
					class="flex items-center gap-0.5 rounded-md px-1.5 py-1 text-[11px] font-medium text-zinc-500 transition
						hover:bg-zinc-800/50 hover:text-[var(--color-primary)]"
				>
					See all
					<ChevronRight class="h-3.5 w-3.5" />
				</a>
			{:else}
				<div class="w-8"></div>
			{/if}
		</div>
	</div>

	<div
		class="history-list min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
		style="touch-action: pan-y; -webkit-overflow-scrolling: touch;"
	>
		{#if history.length === 0}
			<div class="flex flex-col items-center justify-center px-4 py-12 text-center">
				<div
					class="mb-3 flex h-12 w-12 items-center justify-center rounded-full
						{isDarkMode ? 'bg-zinc-900' : 'bg-zinc-100'}"
				>
					<History class="h-5 w-5 text-zinc-500" />
				</div>
				<p class="text-xs text-zinc-500">No reading history yet</p>
				<p class="mt-1 text-[11px] text-zinc-600">Start reading to track progress</p>
			</div>
		{:else}
			<ul class="space-y-1">
				{#each history as entry (entry.mangaId + entry.chapterId)}
					{@const readHref = `/reader/${entry.sourceId}${entry.chapterId}`}
					<li class="group relative">
						<a
							href={readHref}
							onclick={(e) => handleNavigate(e, readHref)}
							class="flex gap-2.5 rounded-lg p-2 transition
								{isDarkMode ? 'hover:bg-zinc-900/80' : 'hover:bg-zinc-100'}"
						>
							<div class="relative h-[72px] w-12 shrink-0 overflow-hidden rounded-md bg-zinc-800">
								{#if entry.cover}
									<img
										src={proxyCover(entry)}
										data-original={entry.cover}
										data-source={entry.sourceId}
										alt=""
										class="h-full w-full object-cover"
										loading="lazy"
										onerror={onCoverError}
									/>
								{:else}
									<div class="flex h-full w-full items-center justify-center">
										<BookOpen class="h-4 w-4 text-zinc-600" />
									</div>
								{/if}
							</div>

							<div class="min-w-0 flex-1 py-0.5">
								<p
									class="line-clamp-2 text-[12px] font-medium leading-snug
										{isDarkMode ? 'text-zinc-200' : 'text-zinc-800'}"
								>
									{entry.mangaTitle}
								</p>
								<p class="mt-0.5 line-clamp-1 text-[11px] text-[var(--color-primary)]">
									{entry.chapterTitle}
								</p>
								<div class="mt-1 flex items-center gap-1 text-[10px] text-zinc-500">
									<Clock class="h-2.5 w-2.5" />
									<span>{formatTime(entry.timestamp)}</span>
									<span class="mx-0.5">·</span>
									<span class="capitalize">{entry.sourceId}</span>
								</div>
							</div>
						</a>

						<button
							onclick={(e) => handleRemove(entry.mangaId, e)}
							class="absolute right-1.5 top-1.5 rounded-md p-1 text-zinc-500 opacity-0 transition
								group-hover:opacity-100 hover:bg-red-500/15 hover:text-red-400
								max-xl:opacity-100"
							aria-label="Remove from history"
						>
							<Trash2 class="h-3.5 w-3.5" />
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	{#if history.length > 0}
		<div class="shrink-0 border-t p-2 {isDarkMode ? 'border-zinc-800/80' : 'border-zinc-200'}">
			<a
				href="/history"
				onclick={(e) => handleNavigate(e, '/history')}
				class="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition
					{isDarkMode
					? 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white'
					: 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900'}"
			>
				View full history
				<ChevronRight class="h-3.5 w-3.5" />
			</a>
		</div>
	{/if}
</aside>

<style>
	.history-widget {
		scrollbar-width: thin;
		scrollbar-color: rgb(63 63 70) transparent;
	}
	.history-list::-webkit-scrollbar {
		width: 4px;
	}
	.history-list::-webkit-scrollbar-thumb {
		background: rgb(63 63 70);
		border-radius: 4px;
	}
</style>
