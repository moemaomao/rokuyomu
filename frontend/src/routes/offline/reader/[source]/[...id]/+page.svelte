<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import {
		getOfflineMangaChapter,
		mangaPagesToObjectUrls,
		type OfflineMangaChapter
	} from '$lib/utils/offlineChapter';
	import { ChevronLeft, ChevronRight, Home, WifiOff, BookOpen } from 'lucide-svelte';

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
	let mode = $state<'webtoon' | 'ltr'>('webtoon');
	let index = $state(0);
	let showBar = $state(true);

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
				return;
			}
			meta = row;
			urls = mangaPagesToObjectUrls(row);
			index = 0;
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

	function next() {
		if (index < urls.length - 1) index++;
	}
	function prev() {
		if (index > 0) index--;
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'ArrowRight' || e.key === ' ') {
			e.preventDefault();
			next();
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			prev();
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

<div class="offline-reader min-h-screen bg-zinc-950 text-zinc-100">
	{#if showBar}
		<header
			class="sticky top-0 z-40 flex items-center gap-3 border-b border-zinc-800 bg-zinc-950/95 px-3 py-2 backdrop-blur"
		>
			<a
				href="/library"
				class="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
				title="Library"
			>
				<Home class="h-4 w-4" />
			</a>
			<div class="min-w-0 flex-1">
				<p class="truncate text-sm font-semibold">
					{meta?.chapterTitle || 'Offline chapter'}
				</p>
				<p class="truncate text-[11px] text-zinc-500">
					{meta?.mangaTitle || ''} · {source}
				</p>
			</div>
			<span
				class="flex items-center gap-1 rounded-full bg-emerald-600/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400"
			>
				<WifiOff class="h-3 w-3" /> OFFLINE
			</span>
			<div class="flex gap-1">
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

	{#if loading}
		<div class="flex min-h-[60vh] items-center justify-center text-zinc-500">
			Loading offline chapter…
		</div>
	{:else if error}
		<div class="mx-auto max-w-md px-4 py-16 text-center">
			<BookOpen class="mx-auto mb-3 h-10 w-10 text-zinc-600" />
			<p class="text-sm text-red-400">{error}</p>
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
				class="absolute left-2 z-10 rounded-full bg-black/50 p-2 text-white"
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
				class="absolute right-2 z-10 rounded-full bg-black/50 p-2 text-white"
				onclick={next}
				disabled={index >= urls.length - 1}
			>
				<ChevronRight class="h-6 w-6" />
			</button>
		</div>
		<p class="pb-4 text-center text-xs text-zinc-500">
			{index + 1} / {urls.length}
		</p>
	{/if}
</div>
