<script lang="ts">
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { getOfflineNovelChapter, type OfflineNovelChapter } from '$lib/utils/offlineChapter';
	import { Home, WifiOff, BookOpen } from 'lucide-svelte';

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
	let fontSize = $state(18);

	async function load() {
		if (!browser || !source) return;
		loading = true;
		error = '';
		meta = null;
		try {
			const cid = chapterId;
			const row = await getOfflineNovelChapter(source, cid);
			if (!row?.content) {
				error =
					'Chapter not found offline. Download the novel chapter first (PDF download also saves text for offline reading).';
				return;
			}
			meta = row;
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
</script>

<svelte:head>
	<title
		>{meta ? `${meta.chapterTitle} · ${meta.novelTitle}` : 'Offline Novel'} | Rokuyomu</title
	>
</svelte:head>

<div class="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
	<header
		class="sticky top-0 z-40 flex items-center gap-3 border-b border-zinc-200 bg-white/95 px-3 py-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95"
	>
		<a
			href="/library"
			class="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-300 dark:border-zinc-700"
			title="Library"
		>
			<Home class="h-4 w-4" />
		</a>
		<div class="min-w-0 flex-1">
			<p class="truncate text-sm font-semibold">{meta?.chapterTitle || 'Offline chapter'}</p>
			<p class="truncate text-[11px] text-zinc-500">{meta?.novelTitle || ''} · {source}</p>
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
				<div class="novel-body space-y-3">{@html meta.content}</div>
			{:else}
				<div class="novel-body whitespace-pre-wrap">{meta.content}</div>
			{/if}
		</article>
	{/if}
</div>

<style>
	:global(.novel-body p) {
		margin-bottom: 0.85em;
	}
</style>
