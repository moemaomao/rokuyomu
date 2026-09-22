<script lang="ts">
	import { Search, Loader2, X, Tag } from 'lucide-svelte';
	import type { Manga } from '$lib/server/sources/types';

	const TAG_OPTIONS = [
		'Action',
		'Adventure',
		'Comedy',
		'Drama',
		'Ecchi',
		'Fantasy',
		'Harem',
		'Horror',
		'Isekai',
		'Josei',
		'Magic',
		'Martial Arts',
		'Mecha',
		'Mystery',
		'Psychological',
		'Romance',
		'School',
		'Sci-Fi',
		'Seinen',
		'Shoujo',
		'Shounen',
		'Slice of Life',
		'Sports',
		'Supernatural',
		'Tragedy',
		'Yuri',
		'Yaoi',
		'Hentai'
	] as const;

	let query = $state('');
	let selectedTags = $state<string[]>([]);
	let results = $state<Manga[]>([]);
	let loading = $state(false);
	let error = $state('');
	let meta = $state<{ returned?: number; sourcesTried?: number } | null>(null);
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let showTags = $state(true);

	function toggleTag(tag: string) {
		if (selectedTags.includes(tag)) {
			selectedTags = selectedTags.filter((t) => t !== tag);
		} else {
			selectedTags = [...selectedTags, tag];
		}
		scheduleSearch();
	}

	function scheduleSearch() {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			runSearch();
		}, 400);
	}

	async function runSearch() {
		const q = query.trim();
		if (q.length < 2 && selectedTags.length === 0) {
			results = [];
			meta = null;
			error = '';
			return;
		}

		loading = true;
		error = '';
		try {
			const params = new URLSearchParams();
			if (q) params.set('q', q);
			if (selectedTags.length) params.set('tags', selectedTags.join(','));
			params.set('limit', '36');
			params.set('per', '5');

			const res = await fetch(`/api/deep-search?${params.toString()}`);
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as {
					meta?: { error?: string };
					error?: string;
				};
				throw new Error(body?.meta?.error || body?.error || `HTTP ${res.status}`);
			}
			const data = (await res.json()) as {
				results: Manga[];
				meta?: { returned?: number; sourcesTried?: number };
			};
			results = data.results || [];
			meta = data.meta || null;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Search failed';
			results = [];
			meta = null;
		} finally {
			loading = false;
		}
	}

	function onInput() {
		scheduleSearch();
	}

	function clearAll() {
		query = '';
		selectedTags = [];
		results = [];
		meta = null;
		error = '';
	}

	function mangaHref(m: Manga): string {
		const id = String(m.id || '').replace(/^\/+/, '');
		return `/manga/${encodeURIComponent(m.sourceId)}/${id}`;
	}

	function proxyCover(url: string, sourceId: string): string {
		if (!url) return '';
		let u = String(url).trim();
		if (u.startsWith('//')) u = 'https:' + u;
		if (!/^https?:\/\//i.test(u)) return '';
		return `/api/proxy?url=${encodeURIComponent(u)}&source=${sourceId}&w=200&h=300`;
	}

	function onCoverError(e: Event) {
		const img = e.currentTarget as HTMLImageElement;
		img.style.display = 'none';
	}
</script>

<div class="mx-auto max-w-6xl px-4 py-6">
	<!-- Header -->
	<div class="mb-6 flex items-center justify-between">
		<div class="flex items-center gap-2">
			<Search class="h-5 w-5 text-violet-400" />
			<h1 class="text-xl font-bold">Deep Search</h1>
		</div>

		{#if query || selectedTags.length}
			<button
				type="button"
				onclick={clearAll}
				class="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
			>
				<X class="h-4 w-4" />
				Clear
			</button>
		{/if}
	</div>

<!-- Search Input -->
<div class="relative mb-4">
	<input
	type="search"
	bind:value={query}
	oninput={onInput}
	placeholder="Search manga title..."
	class="theme-input w-full rounded-xl border border-zinc-700 bg-zinc-900/80 py-3 pr-12 pl-4 text-sm outline-none transition focus:border-violet-500"
/>
	{#if loading}
		<span class="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2">
			<Loader2 class="h-5 w-5 animate-spin text-violet-400" />
		</span>
	{:else}
		<span class="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-zinc-500">
			<Search class="h-5 w-5" />
		</span>
	{/if}
</div>

	<!-- Tags -->
	<div class="mb-6">
		<button
			type="button"
			onclick={() => (showTags = !showTags)}
			class="mb-2 flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200"
		>
			<Tag class="h-4 w-4" />
			Genre / Tag
			{#if selectedTags.length}
				<span class="ml-1 rounded-full bg-violet-600 px-2 py-0.5 text-xs text-white">
					{selectedTags.length}
				</span>
			{/if}
		</button>

		{#if showTags}
			<div class="flex flex-wrap gap-2">
				{#each TAG_OPTIONS as tag}
					<button
						type="button"
						onclick={() => toggleTag(tag)}
						class="rounded-full border px-3 py-1 text-xs transition
							{selectedTags.includes(tag)
							? 'border-violet-500 bg-violet-600/30 text-violet-200'
							: 'border-zinc-700 text-zinc-400 hover:border-zinc-500'}"
					>
						{tag}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Error -->
	{#if error}
		<p class="mb-4 text-sm text-red-400">{error}</p>
	{/if}

	<!-- Meta -->
	{#if meta && !loading}
		<p class="mb-4 text-xs text-zinc-500">
			{meta.returned ?? 0} results · {meta.sourcesTried ?? 0} sources
			<span class="opacity-70">(worker = KV only)</span>
		</p>
	{/if}

	<!-- Results -->
	{#if results.length > 0}
		<div class="grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
			{#each results as m (m.sourceId + ':' + m.id)}
				<a
					href={mangaHref(m)}
					class="group overflow-hidden rounded-xl bg-zinc-900/10 transition hover:bg-zinc-800/80"
				>
					<div class="relative aspect-[2/3] overflow-hidden bg-zinc-800">
						{#if m.cover}
							<img
								src={proxyCover(m.cover, m.sourceId)}
								alt={m.title}
								class="h-full w-full object-cover transition group-hover:scale-105"
								loading="lazy"
								onerror={onCoverError}
							/>
						{/if}

						<!-- Badge Source (transparent purple) -->
						<span
							class="absolute top-2 left-2 rounded-md bg-violet-600/40 px-2 py-0.5 text-[10px] font-bold capitalize text-violet-100 backdrop-blur-md"
						>
							{m.sourceId}
						</span>
					</div>

					<div class="p-2.5">
						<p class="line-clamp-2 text-sm font-medium leading-snug">
							{m.title}
						</p>
						{#if m.latestChapter}
							<p class="mt-1 text-xs text-zinc-500">
								Ch. {m.latestChapter}
							</p>
						{/if}
					</div>
				</a>
			{/each}
		</div>
	{:else if !loading && (query.length >= 2 || selectedTags.length)}
		<p class="text-center text-sm text-zinc-500">
			No results found (worker sources are KV cache only).
		</p>
	{:else if !loading}
		<p class="text-center text-sm text-zinc-500">
			Type at least 2 characters or select a genre to start searching.
		</p>
	{/if}
</div>