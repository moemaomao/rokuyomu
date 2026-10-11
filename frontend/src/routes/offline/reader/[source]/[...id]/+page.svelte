<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import {
		getOfflineMangaChapter,
		listOfflineMangaChapters,
		mangaPagesToObjectUrls,
		offlineMangaReaderHref,
		type OfflineMangaChapter
	} from '$lib/utils/offlineChapter';
	import {
		ChevronLeft,
		ChevronRight,
		Home,
		WifiOff,
		BookOpen,
		List
	} from 'lucide-svelte';

	let source = $derived(String($page.params.source || ''));
	let chapterId = $derived.by(() => {
		const parts = $page.params.id;
		if (Array.isArray(parts)) return '/' + parts.filter(Boolean).join('/');
		if (typeof parts === 'string') return parts.startsWith('/') ? parts : '/' + parts;
		return '';
	});

	let loading = $state(true);
	let error = $state('');
	let meta = $state<OfflineMangaChapter | null>(null);
	let urls = $state<string[]>([]);
	let siblings = $state<OfflineMangaChapter[]>([]);
	let mode = $state<'webtoon' | 'ltr'>('webtoon');
	let index = $state(0);
	let showBar = $state(true);
	let showList = $state(false);

	let siblingIndex = $derived(
		siblings.findIndex(
			(s) =>
				s.chapterId === meta?.chapterId ||
				s.key === meta?.key
		)
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
		for (const u of urls) URL.revokeObjectURL(u);
		urls = [];
		meta = null;
		try {
			const cid = chapterId;
			const row = await getOfflineMangaChapter(source, cid);
			if (!row?.pages?.length) {
				error =
					'Chapter not found offline. Download it first from the online reader or Library batch download.';
				siblings = [];
				return;
			}
			meta = row;
			urls = mangaPagesToObjectUrls(row);
			index = 0;
			siblings = await listOfflineMangaChapters(source, row.mangaId);
		} catch (e: any) {
			error = e?.message || 'Failed to load offline chapter';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		source;
		$page.params.id;
		if (browser) void load();
	});

	onDestroy(() => {
		for (const u of urls) URL.revokeObjectURL(u);
	});

	function goChapter(ch: OfflineMangaChapter) {
		showList = false;
		goto(offlineMangaReaderHref(source, ch.chapterId));
	}

	function next() {
		if (index < urls.length - 1) index++;
	}
	function prev() {
		if (index > 0) index--;
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'ArrowRight' || e.key === ' ') {
			e.preventDefault();
			if (mode === 'ltr') next();
			else if (nextCh) goChapter(nextCh);
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			if (mode === 'ltr') prev();
			else if (prevCh) goChapter(prevCh);
		} else if (e.key === 'Escape') showBar = !showBar;
	}

	onMount(() => {
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});
</script>

<svelte:head>
	<title
		>{meta ? `${meta.chapterTitle} · ${meta.mangaTitle}` : 'Offline Reader'} | Rokuyomu</title
	>
</svelte:head>

<div class="offline-reader relative min-h-screen bg-zinc-950 text-zinc-100">
	{#if showBar}
		<header
			class="sticky top-0 z-40 flex items-center gap-2 border-b border-zinc-800 bg-zinc-950/95 px-3 py-2 backdrop-blur"
		>
			<a
				href="/library"
				class="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
				title="Library"
			>
				<Home class="h-4 w-4" />
			</a>
			<button
				type="button"
				class="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
				title="Offline chapters"
				onclick={() => (showList = !showList)}
			>
				<List class="h-4 w-4" />
			</button>
			<div class="min-w-0 flex-1">
				<p class="truncate text-sm font-semibold">
					{meta?.chapterTitle || 'Offline chapter'}
				</p>
				<p class="truncate text-[11px] text-zinc-500">
					{meta?.mangaTitle || ''} · {source}
					{#if siblings.length}
						· {siblings.length} offline
					{/if}
				</p>
			</div>
			<span
				class="flex items-center gap-1 rounded-full bg-emerald-600/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400"
			>
				<WifiOff class="h-3 w-3" /> OFFLINE
			</span>
			<div class="hidden gap-1 sm:flex">
				<button
					type="button"
					class="rounded-md px-2 py-1 text-xs {mode === 'webtoon'
						? 'bg-violet-600 text-white'
						: 'bg-zinc-800 text-zinc-400'}"
					onclick={() => (mode = 'webtoon')}>Webtoon</button
				>
				<button
					type="button"
					class="rounded-md px-2 py-1 text-xs {mode === 'ltr'
						? 'bg-violet-600 text-white'
						: 'bg-zinc-800 text-zinc-400'}"
					onclick={() => (mode = 'ltr')}>Page</button
				>
			</div>
		</header>
	{/if}

	<!-- Chapter list drawer -->
	{#if showList}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="fixed inset-0 z-50 bg-black/60"
			onclick={() => (showList = false)}
		>
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<aside
				class="absolute top-0 left-0 flex h-full w-72 max-w-[85vw] flex-col border-r border-zinc-800 bg-zinc-950 shadow-xl"
				onclick={(e) => e.stopPropagation()}
			>
				<div class="flex items-center justify-between border-b border-zinc-800 px-3 py-3">
					<p class="text-sm font-semibold">Offline chapters</p>
					<button type="button" class="text-xs text-zinc-400" onclick={() => (showList = false)}
						>Close</button
					>
				</div>
				<div class="flex-1 overflow-y-auto p-2">
					{#each siblings as ch}
						<button
							type="button"
							class="mb-1 w-full rounded-lg px-3 py-2 text-left text-sm transition hover:bg-zinc-800 {ch.chapterId ===
							meta?.chapterId
								? 'bg-violet-600/30 text-violet-100'
								: 'text-zinc-300'}"
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
		<div class="flex min-h-[60vh] items-center justify-center text-zinc-500">
			Loading offline chapter…
		</div>
	{:else if error}
		<div class="mx-auto max-w-md px-4 py-16 text-center">
			<BookOpen class="mx-auto mb-3 h-10 w-10 text-zinc-600" />
			<p class="text-sm text-red-400">{error}</p>
			<p class="mt-2 text-xs text-zinc-500">
				Tip: chapters downloaded before offline mode need one re-download.
			</p>
			<a href="/library" class="mt-4 inline-block text-sm text-violet-400 hover:underline"
				>Back to Library</a
			>
		</div>
	{:else if mode === 'webtoon'}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			id="reader"
			class="mx-auto flex max-w-3xl flex-col items-center gap-0 py-2"
			onclick={() => (showBar = !showBar)}
		>
			{#each urls as src, i}
				<img
					{src}
					alt="Page {i + 1}"
					class="w-full select-none"
					draggable="false"
					loading={i < 3 ? 'eager' : 'lazy'}
				/>
			{/each}
		</div>
	{:else}
		<div class="relative flex min-h-[70vh] items-center justify-center px-2 py-4">
			<button
				type="button"
				class="absolute left-2 z-10 rounded-full bg-black/50 p-2 text-white disabled:opacity-30"
				onclick={prev}
				disabled={index <= 0}
			>
				<ChevronLeft class="h-6 w-6" />
			</button>
			<img
				src={urls[index]}
				alt="Page {index + 1}"
				class="max-h-[85vh] max-w-full object-contain"
				draggable="false"
			/>
			<button
				type="button"
				class="absolute right-2 z-10 rounded-full bg-black/50 p-2 text-white disabled:opacity-30"
				onclick={next}
				disabled={index >= urls.length - 1}
			>
				<ChevronRight class="h-6 w-6" />
			</button>
		</div>
		<p class="pb-2 text-center text-xs text-zinc-500">{index + 1} / {urls.length}</p>
	{/if}

	<!-- Prev / next chapter bar -->
	{#if meta && (prevCh || nextCh)}
		<div
			class="sticky bottom-0 z-30 flex items-center justify-between gap-2 border-t border-zinc-800 bg-zinc-950/95 px-3 py-2 backdrop-blur"
		>
			<button
				type="button"
				class="flex items-center gap-1 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs disabled:opacity-30"
				disabled={!prevCh}
				onclick={() => prevCh && goChapter(prevCh)}
			>
				<ChevronLeft class="h-4 w-4" />
				<span class="max-w-[40vw] truncate">{prevCh?.chapterTitle || 'Prev'}</span>
			</button>
			<button
				type="button"
				class="flex items-center gap-1 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs disabled:opacity-30"
				disabled={!nextCh}
				onclick={() => nextCh && goChapter(nextCh)}
			>
				<span class="max-w-[40vw] truncate">{nextCh?.chapterTitle || 'Next'}</span>
				<ChevronRight class="h-4 w-4" />
			</button>
		</div>
	{/if}
</div>
