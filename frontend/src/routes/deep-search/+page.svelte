<script lang="ts">
	import { Search, Loader2, X, Tag } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import type { Manga } from '$lib/server/sources/types';
	import { isNovelSource } from '$lib/utils/novelSources';

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

	type TypeFilter = 'all' | 'manga' | 'novel';

	const PAGE_SIZE = 72;
	const LOAD_MORE_STEP = 48;
	const CACHE_KEY = 'rokuyomu:deep-search:last';

	interface CachePayload {
		key: string;
		results: Manga[];
		meta: { returned?: number; sourcesTried?: number; type?: string } | null;
		limit: number;
		hasMore: boolean;
		ts: number;
	}

	let query = $state('');
	let selectedTags = $state<string[]>([]);
	let typeFilter = $state<TypeFilter>('all');
	let results = $state<Manga[]>([]);
	let loading = $state(false);
	let loadingMore = $state(false);
	let error = $state('');
	let meta = $state<{ returned?: number; sourcesTried?: number; type?: string } | null>(null);
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let showTags = $state(true);
	let currentLimit = $state(PAGE_SIZE);
	let hasMore = $state(false);
	let searchSeq = 0;

	function cacheKey(): string {
		return [query.trim(), selectedTags.slice().sort().join(','), typeFilter, currentLimit].join('|');
	}

	function saveCache() {
		if (!browser) return;
		try {
			const payload: CachePayload = {
				key: cacheKey(),
				results,
				meta,
				limit: currentLimit,
				hasMore,
				ts: Date.now()
			};
			sessionStorage.setItem(CACHE_KEY, JSON.stringify(payload));
		} catch {
			/* ignore quota */
		}
	}

	function loadCache(expectedKey?: string): boolean {
		if (!browser) return false;
		try {
			const raw = sessionStorage.getItem(CACHE_KEY);
			if (!raw) return false;
			const data = JSON.parse(raw) as CachePayload;
			if (!data || Date.now() - (data.ts || 0) > 10 * 60 * 1000) return false;
			const key = expectedKey ?? cacheKey();
			const base = (k: string) => k.split('|').slice(0, 3).join('|');
			if (base(data.key) !== base(key)) return false;
			results = data.results || [];
			meta = data.meta || null;
			currentLimit = data.limit || PAGE_SIZE;
			hasMore = !!data.hasMore;
			return results.length > 0;
		} catch {
			return false;
		}
	}

	function normalizeTagName(raw: string): string {
		const s = String(raw || '').trim();
		if (!s) return '';
		const lower = s.toLowerCase();
		const found = TAG_OPTIONS.find((t) => t.toLowerCase() === lower);
		if (found) return found;
		return s
			.split(/[\s_/]+/)
			.map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ''))
			.join(' ');
	}

	function applySearchParams(sp: URLSearchParams) {
		const q = (sp.get('q') || '').trim();
		const tagsParam = (sp.get('tags') || '').trim();
		const type = (sp.get('type') || 'all').toLowerCase();
		query = q;
		selectedTags = tagsParam
			? [
					...new Set(
						tagsParam
							.split(',')
							.map((t) => normalizeTagName(t.trim()))
							.filter(Boolean)
					)
				]
			: [];
		if (type === 'manga' || type === 'novel' || type === 'all') {
			typeFilter = type as TypeFilter;
		}
	}

	function syncUrl() {
		if (!browser) return;
		const sp = new URLSearchParams();
		if (query.trim()) sp.set('q', query.trim());
		if (selectedTags.length) sp.set('tags', selectedTags.join(','));
		if (typeFilter !== 'all') sp.set('type', typeFilter);
		const qs = sp.toString();
		const next = qs ? `/deep-search?${qs}` : '/deep-search';
		const cur = window.location.pathname + window.location.search;
		if (cur !== next) history.replaceState({}, '', next);
	}

	onMount(() => {
		if (!browser) return;
		applySearchParams(new URLSearchParams(window.location.search));
		if (query.length >= 2 || selectedTags.length > 0) {
			const restored = loadCache();
			if (!restored) {
				void runSearch(false);
			}
		}
	});

	function toggleTag(tag: string) {
		if (selectedTags.includes(tag)) {
			selectedTags = selectedTags.filter((t) => t !== tag);
		} else {
			selectedTags = [...selectedTags, tag];
		}
		currentLimit = PAGE_SIZE;
		syncUrl();
		scheduleSearch();
	}

	function setType(t: TypeFilter) {
		typeFilter = t;
		currentLimit = PAGE_SIZE;
		syncUrl();
		scheduleSearch();
	}

	function scheduleSearch() {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			runSearch(false);
		}, 280);
	}

	async function runSearch(isLoadMore: boolean) {
		const q = query.trim();
		if (q.length < 2 && selectedTags.length === 0) {
			results = [];
			meta = null;
			error = '';
			hasMore = false;
			return;
		}

		const seq = ++searchSeq;

		if (isLoadMore) {
			loadingMore = true;
		} else {
			loading = true;
			results = [];
			meta = null;
			hasMore = false;
		}
		error = '';

		try {
			const params = new URLSearchParams();
			if (q) params.set('q', q);
			if (selectedTags.length) params.set('tags', selectedTags.join(','));
			params.set('limit', String(currentLimit));
			params.set('per', '12');
			params.set('type', typeFilter);

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
				meta?: { returned?: number; sourcesTried?: number; type?: string };
			};

			if (seq !== searchSeq) return;

			results = data.results || [];
			meta = data.meta || null;
			const returned = data.meta?.returned ?? results.length;
			hasMore = returned >= currentLimit;
			saveCache();
		} catch (e) {
			if (seq !== searchSeq) return;
			error = e instanceof Error ? e.message : 'Search failed';
			if (!isLoadMore) {
				results = [];
				meta = null;
			}
			hasMore = false;
		} finally {
			if (seq === searchSeq) {
				loading = false;
				loadingMore = false;
			}
		}
	}

	function loadMore() {
		if (loading || loadingMore || !hasMore) return;
		currentLimit += LOAD_MORE_STEP;
		void runSearch(true);
	}

	function onInput() {
		currentLimit = PAGE_SIZE;
		scheduleSearch();
	}

	function clearAll() {
		query = '';
		selectedTags = [];
		typeFilter = 'all';
		results = [];
		meta = null;
		error = '';
		currentLimit = PAGE_SIZE;
		hasMore = false;
		if (browser) {
			try {
				sessionStorage.removeItem(CACHE_KEY);
			} catch {
				/* ignore */
			}
		}
		syncUrl();
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

	function itemType(m: Manga): 'novel' | 'manga' {
		const t = String(m.type || '').toLowerCase();
		if (t === 'novel') return 'novel';
		if (isNovelSource(m.sourceId)) return 'novel';
		return 'manga';
	}
</script>

<div class="mx-auto max-w-6xl px-4 py-6">
	<!-- Header -->
	<div class="mb-6 flex items-center justify-between">
		<div class="flex items-center gap-2">
			<Search class="h-5 w-5 text-violet-500 dark:text-violet-400" />
			<h1 class="text-xl font-bold text-zinc-900 dark:text-zinc-100">Deep Search</h1>
		</div>

		{#if query || selectedTags.length || typeFilter !== 'all'}
			<button
				type="button"
				onclick={clearAll}
				class="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
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
			placeholder="Search manga / novel title..."
			class="theme-input w-full rounded-xl border border-zinc-300 bg-white py-3 pr-12 pl-4 text-sm text-zinc-900 outline-none transition focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-100"
		/>
		{#if loading}
			<span class="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2">
				<Loader2 class="h-5 w-5 animate-spin text-violet-500 dark:text-violet-400" />
			</span>
		{:else}
			<span class="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-zinc-400 dark:text-zinc-500">
				<Search class="h-5 w-5" />
			</span>
		{/if}
	</div>

	<!-- Type filter -->
	<div class="mb-4 flex flex-wrap gap-2">
		{#each (['all', 'manga', 'novel'] as const) as t}
			<button
				type="button"
				onclick={() => setType(t)}
				class="rounded-full border px-3 py-1 text-xs font-medium capitalize transition
					{typeFilter === t
					? 'border-violet-500 bg-violet-600/20 text-violet-700 dark:bg-violet-600/30 dark:text-violet-200'
					: 'border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-500'}"
			>
				{t === 'all' ? 'All types' : t}
			</button>
		{/each}
	</div>

	<!-- Tags -->
	<div class="mb-6">
		<button
			type="button"
			onclick={() => (showTags = !showTags)}
			class="mb-2 flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
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
							? 'border-violet-500 bg-violet-600/20 text-violet-700 dark:bg-violet-600/30 dark:text-violet-200'
							: 'border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-500'}"
					>
						{tag}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Error -->
	{#if error}
		<p class="mb-4 text-sm text-red-500 dark:text-red-400">{error}</p>
	{/if}

	<!-- Meta -->
	{#if meta && !loading}
		<p class="mb-4 text-xs text-zinc-500 dark:text-zinc-500">
			{meta.returned ?? 0} results · {meta.sourcesTried ?? 0} sources
			{#if meta.type && meta.type !== 'all'}
				· type: {meta.type}
			{/if}
			<span class="opacity-70">(worker = KV only)</span>
		</p>
	{/if}

	{#if loading && results.length === 0}
		<div class="grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
			{#each Array(12) as _}
				<div class="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 dark:border-transparent dark:bg-zinc-900/40">
					<div class="aspect-[2/3] animate-pulse bg-zinc-200 dark:bg-zinc-800"></div>
					<div class="space-y-2 p-2.5">
						<div class="h-3 w-4/5 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"></div>
						<div class="h-2 w-1/2 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"></div>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if results.length > 0}
		<div class="grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
			{#each results as m (m.sourceId + ':' + m.id)}
				{@const kind = itemType(m)}
				<a
					href={mangaHref(m)}
					class="group overflow-hidden rounded-xl border border-zinc-200 bg-white transition hover:border-violet-300 hover:bg-zinc-50 dark:border-transparent dark:bg-zinc-900/10 dark:hover:bg-zinc-800/80"
				>
					<div class="relative aspect-[2/3] overflow-hidden bg-zinc-100 dark:bg-zinc-800">
						{#if m.cover}
							<img
								src={proxyCover(m.cover, m.sourceId)}
								alt={m.title}
								class="h-full w-full object-cover transition group-hover:scale-105"
								loading="lazy"
								onerror={onCoverError}
							/>
						{/if}

						<span
							class="absolute top-2 left-2 max-w-[70%] truncate rounded-md bg-violet-600/70 px-2 py-0.5 text-[10px] font-bold capitalize text-white backdrop-blur-md dark:bg-violet-600/40 dark:text-violet-100"
						>
							{m.sourceId}
						</span>

						<span
							class="absolute bottom-2 left-2 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase backdrop-blur-md
								{kind === 'novel'
								? 'bg-amber-500/80 text-white dark:bg-amber-500/50 dark:text-amber-50'
								: 'bg-emerald-600/80 text-white dark:bg-emerald-600/50 dark:text-emerald-50'}"
						>
							{kind}
						</span>
					</div>

					<div class="p-2.5">
						<p class="line-clamp-2 text-sm font-medium leading-snug text-zinc-900 dark:text-zinc-100">
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

		{#if hasMore}
			<div class="mt-8 flex justify-center">
				<button
					type="button"
					onclick={loadMore}
					disabled={loadingMore}
					class="flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-6 py-2.5 text-sm font-medium text-zinc-800 transition hover:border-violet-500 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-200 dark:hover:bg-violet-600/20"
				>
					{#if loadingMore}
						<Loader2 class="h-4 w-4 animate-spin" />
						Loading...
					{:else}
						Load more
					{/if}
				</button>
			</div>
		{/if}
	{:else if !loading && (query.length >= 2 || selectedTags.length)}
		<p class="text-center text-sm text-zinc-500">
			No results found. Try more specific keywords, or ensure the novel source is cached / scraper is running.
		</p>
	{:else if !loading}
		<p class="text-center text-sm text-zinc-500">
			Search by title or pick a genre to start deep search across sources.
		</p>
	{/if}
</div>
