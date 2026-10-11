<script lang="ts">
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import {
		getOfflineNovelChapter,
		listOfflineNovelChapters,
		offlineNovelReaderHref,
		type OfflineNovelChapter
	} from '$lib/utils/offlineChapter';
	import { Home, WifiOff, BookOpen, List, ChevronLeft, ChevronRight } from 'lucide-svelte';

	let source = $derived(String($page.params.source || ''));
	let chapterId = $derived.by(() => {
		const parts = $page.params.id;
		if (Array.isArray(parts)) return '/' + parts.filter(Boolean).join('/');
		if (typeof parts === 'string') return parts.startsWith('/') ? parts : '/' + parts;
		return '';
	});

	let loading = $state(true);
	let error = $state('');
	let meta = $state<OfflineNovelChapter | null>(null);
	let siblings = $state<OfflineNovelChapter[]>([]);
	let fontSize = $state(18);
	let showList = $state(false);

	let siblingIndex = $derived(
		siblings.findIndex((s) => s.chapterId === meta?.chapterId || s.key === meta?.key)
	);
	let prevCh = $derived(siblingIndex > 0 ? siblings[siblingIndex - 1] : null);
	let nextCh = $derived(
		siblingIndex >= 0 && siblingIndex < siblings.length - 1
			? siblings[siblingIndex + 1]
			: null
	);

	async function load() {
		if (!browser || !source) return;
		loading = true;
		error = '';
		meta = null;
		try {
			const row = await getOfflineNovelChapter(source, chapterId);
			if (!row?.content) {
				error =
					'Chapter not found offline. Download the novel chapter first (saves text for offline reading).';
				siblings = [];
				return;
			}
			meta = row;
			siblings = await listOfflineNovelChapters(source, row.mangaId);
		} catch (e: any) {
			error = e?.message || 'Failed to load offline novel';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		source;
		$page.params.id;
		if (browser) void load();
	});

	function isHtml(s: string) {
		return /<[a-z][\s\S]*>/i.test(s);
	}

	function goChapter(ch: OfflineNovelChapter) {
		showList = false;
		goto(offlineNovelReaderHref(source, ch.chapterId));
	}
</script>

<svelte:head>
	<title
		>{meta ? `${meta.chapterTitle} · ${meta.novelTitle}` : 'Offline Novel'} | Rokuyomu</title
	>
</svelte:head>

<div class="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
	<header
		class="sticky top-0 z-40 flex items-center gap-2 border-b border-zinc-200 bg-white/95 px-3 py-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95"
	>
		<a
			href="/library"
			class="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-300 dark:border-zinc-700"
			title="Library"
		>
			<Home class="h-4 w-4" />
		</a>
		<button
			type="button"
			class="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-300 dark:border-zinc-700"
			title="Offline chapters"
			onclick={() => (showList = !showList)}
		>
			<List class="h-4 w-4" />
		</button>
		<div class="min-w-0 flex-1">
			<p class="truncate text-sm font-semibold">{meta?.chapterTitle || 'Offline chapter'}</p>
			<p class="truncate text-[11px] text-zinc-500">
				{meta?.novelTitle || ''} · {source}
				{#if siblings.length}
					· {siblings.length} offline
				{/if}
			</p>
		</div>
		<span
			class="flex items-center gap-1 rounded-full bg-emerald-600/15 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400"
		>
			<WifiOff class="h-3 w-3" /> OFFLINE
		</span>
		<div class="flex items-center gap-1 text-xs">
			<button
				type="button"
				class="rounded border px-2 py-1 dark:border-zinc-700"
				onclick={() => (fontSize = Math.max(14, fontSize - 2))}>A-</button
			>
			<button
				type="button"
				class="rounded border px-2 py-1 dark:border-zinc-700"
				onclick={() => (fontSize = Math.min(28, fontSize + 2))}>A+</button
			>
		</div>
	</header>

	{#if showList}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="fixed inset-0 z-50 bg-black/50" onclick={() => (showList = false)}>
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<aside
				class="absolute top-0 left-0 flex h-full w-72 max-w-[85vw] flex-col border-r border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
				onclick={(e) => e.stopPropagation()}
			>
				<div class="flex items-center justify-between border-b px-3 py-3 dark:border-zinc-800">
					<p class="text-sm font-semibold">Offline chapters</p>
					<button type="button" class="text-xs text-zinc-500" onclick={() => (showList = false)}
						>Close</button
					>
				</div>
				<div class="flex-1 overflow-y-auto p-2">
					{#each siblings as ch}
						<button
							type="button"
							class="mb-1 w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 {ch.chapterId ===
							meta?.chapterId
								? 'bg-violet-100 text-violet-900 dark:bg-violet-600/30 dark:text-violet-100'
								: ''}"
							onclick={() => goChapter(ch)}
						>
							{ch.chapterTitle}
						</button>
					{:else}
						<p class="p-3 text-xs text-zinc-500">No other offline chapters.</p>
					{/each}
				</div>
			</aside>
		</div>
	{/if}

	{#if loading}
		<div class="flex min-h-[50vh] items-center justify-center text-zinc-500">Loading…</div>
	{:else if error}
		<div class="mx-auto max-w-md px-4 py-16 text-center">
			<BookOpen class="mx-auto mb-3 h-10 w-10 text-zinc-400" />
			<p class="text-sm text-red-500">{error}</p>
			<a href="/library" class="mt-4 inline-block text-sm text-violet-600 hover:underline"
				>Back to Library</a
			>
		</div>
	{:else if meta}
		<article
			class="mx-auto max-w-2xl px-4 py-8 leading-relaxed"
			style="font-size: {fontSize}px"
		>
			<h1 class="mb-6 text-xl font-bold">{meta.chapterTitle}</h1>
			{#if isHtml(meta.content)}
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				<div class="novel-body space-y-3">{@html meta.content}</div>
			{:else}
				<div class="novel-body whitespace-pre-wrap">{meta.content}</div>
			{/if}
		</article>
	{/if}

	{#if meta && (prevCh || nextCh)}
		<div
			class="sticky bottom-0 flex items-center justify-between gap-2 border-t border-zinc-200 bg-white/95 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950/95"
		>
			<button
				type="button"
				class="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs disabled:opacity-30 dark:border-zinc-700"
				disabled={!prevCh}
				onclick={() => prevCh && goChapter(prevCh)}
			>
				<ChevronLeft class="h-4 w-4" />
				<span class="max-w-[40vw] truncate">{prevCh?.chapterTitle || 'Prev'}</span>
			</button>
			<button
				type="button"
				class="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs disabled:opacity-30 dark:border-zinc-700"
				disabled={!nextCh}
				onclick={() => nextCh && goChapter(nextCh)}
			>
				<span class="max-w-[40vw] truncate">{nextCh?.chapterTitle || 'Next'}</span>
				<ChevronRight class="h-4 w-4" />
			</button>
		</div>
	{/if}
</div>

<style>
	:global(.novel-body p) {
		margin-bottom: 0.85em;
	}
</style>
