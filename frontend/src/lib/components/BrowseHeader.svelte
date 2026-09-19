<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { Search, Loader2, ChevronDown, Check, Layers } from 'lucide-svelte';
	import { getImpl, setImpl, setMultiMode } from '$lib/stores/impl';
	import {
		getSourceMeta,
		groupSourcesByLang,
		LANG_LABELS,
		LANG_FILTER_SOURCES
	} from '$lib/utils/sourceMeta';
	import { isBrokenSource } from '$lib/stores/brokenSources';
	import { isNsfwConfirmed, setNsfwConfirmed } from '$lib/utils/nsfw';

	type SourceItem = { id: string; name: string };

	let {
		sources,
		currentSource = '',
		searchQuery = '',
		loading = $bindable(false),
		selectedLang = $bindable('all'),
		selectedType = $bindable('all')
	}: {
		sources: SourceItem[];
		currentSource?: string;
		searchQuery?: string;
		loading?: boolean;
		selectedLang?: string;
		selectedType?: string;
	} = $props();

	// ── Constants ────────────────────────────────────────────────────────────
	const LANGUAGES = [
		{ id: 'all', name: 'All Languages', flag: 'un', code: 'ALL' },
		{ id: 'english', name: 'English', flag: 'gb', code: 'EN' },
		{ id: 'japanese', name: 'Japanese', flag: 'jp', code: 'JP' },
		{ id: 'chinese', name: 'Chinese', flag: 'cn', code: 'ZH' },
		{ id: 'korean', name: 'Korean', flag: 'kr', code: 'KO' },
		{ id: 'indonesian', name: 'Indonesian', flag: 'id', code: 'ID' },
		{ id: 'spanish', name: 'Spanish', flag: 'es', code: 'ES' },
		{ id: 'russian', name: 'Russian', flag: 'ru', code: 'RU' },
		{ id: 'french', name: 'French', flag: 'fr', code: 'FR' },
		{ id: 'portuguese', name: 'Portuguese', flag: 'pt', code: 'PT' },
		{ id: 'thai', name: 'Thai', flag: 'th', code: 'TH' },
		{ id: 'vietnamese', name: 'Vietnamese', flag: 'vn', code: 'VI' }
	] as const;

	const TYPES = [
		{ id: 'all', name: 'All Types', icon: '✨' },
		{ id: 'manga', name: 'Manga', icon: '📖' },
		{ id: 'manhwa', name: 'Manhwa', icon: 'kr' },
		{ id: 'manhua', name: 'Manhua', icon: 'cn' },
		{ id: 'doujinshi', name: 'Doujinshi', icon: '🎨' },
		{ id: 'artistcg', name: 'Artist CG', icon: '🖼️' },
		{ id: 'gamecg', name: 'Game CG', icon: '🎮' },
		{ id: 'western', name: 'Western', icon: '🤠' },
		{ id: 'imageset', name: 'Image Set', icon: '📷' },
		{ id: 'cosplay', name: 'Cosplay', icon: '🎭' },
		{ id: 'non-h', name: 'Non-Hentai', icon: '🌱' },
		{ id: 'magazine', name: 'Magazine', icon: '📰' },
		{ id: 'anime', name: 'Anime / Screencap', icon: '🎬' },
		{ id: 'lightnovel', name: 'Light Novel', icon: '📚' },
		{ id: 'webtoon', name: 'Webtoon', icon: '📱' },
		{ id: 'misc', name: 'Miscellaneous', icon: '📦' }
	] as const;

	// ── State ────────────────────────────────────────────────────────────────
	let searchInput = $state('');
	let activeDropdown = $state<'source' | 'lang' | 'type' | null>(null);

	// Age gate (R18 / NSFW)
	let showAgeGate = $state(false);
	let pendingSourceId = $state<string | null>(null);

	// ── Derived ──────────────────────────────────────────────────────────────
	let isMultiMode = $derived(!currentSource);
	let groupedSources = $derived(groupSourcesByLang(sources));
	let currentSourceName = $derived(
		isMultiMode
			? 'Multi (Preferred)'
			: sources.find((s) => s.id === currentSource)?.name || currentSource || 'Select Source'
	);
	let currentLangObj = $derived(LANGUAGES.find((l) => l.id === selectedLang) ?? LANGUAGES[0]);
	let currentTypeObj = $derived(TYPES.find((t) => t.id === selectedType) ?? TYPES[0]);
	let showLangFilter = $derived(
		!isMultiMode && LANG_FILTER_SOURCES.includes((currentSource || '').toLowerCase())
	);
	let hasActiveFilters = $derived(
		!!searchQuery || selectedLang !== 'all' || selectedType !== 'all'
	);

	// ── Effects ──────────────────────────────────────────────────────────────
	$effect(() => {
		searchInput = searchQuery;
	});

	onMount(() => {
		if (currentSource && currentSource !== getImpl()) {
			setImpl(currentSource);
		}
	});

	// ── Helpers ──────────────────────────────────────────────────────────────
	function toggleDropdown(type: 'source' | 'lang' | 'type') {
		activeDropdown = activeDropdown === type ? null : type;
	}

	function closeDropdown() {
		activeDropdown = null;
	}

	function clickOutside(node: HTMLElement) {
		const handler = (e: MouseEvent) => {
			if (!node.contains(e.target as Node)) closeDropdown();
		};
		document.addEventListener('click', handler, true);
		return {
			destroy: () => document.removeEventListener('click', handler, true)
		};
	}

	async function navigate(params: URLSearchParams) {
		loading = true;
		try {
			const qs = params.toString();
			await goto(qs ? `/?${qs}` : '/', {
				invalidateAll: true,
				keepFocus: true,
				noScroll: false
			});
		} finally {
			loading = false;
		}
	}

	function buildParams(overrides: Record<string, string> = {}) {
		const params = new URLSearchParams();

		const source = overrides.source ?? (isMultiMode ? '' : currentSource);
		if (source) params.set('source', source);

		const q = overrides.q ?? searchInput.trim();
		if (q) params.set('q', q);

		const lang = overrides.lang ?? selectedLang;
		if (lang !== 'all') params.set('lang', lang);

		const type = overrides.type ?? selectedType;
		if (type !== 'all') params.set('type', type);

		return params;
	}

	// ── Actions ──────────────────────────────────────────────────────────────
	function applyFilters() {
		navigate(buildParams());
	}

	function selectLang(id: string) {
		selectedLang = id;
		closeDropdown();
		navigate(buildParams({ lang: id }));
	}

	function selectType(id: string) {
		selectedType = id;
		closeDropdown();
		navigate(buildParams({ type: id }));
	}

	async function doSelectSource(id: string) {
		setImpl(id);
		selectedLang = 'all';
		selectedType = 'all';
		loading = true;
		try {
			await goto(`/?source=${id}`, {
				invalidateAll: true,
				keepFocus: true
			});
		} finally {
			loading = false;
		}
	}

	function confirmAge() {
		setNsfwConfirmed(true);
		showAgeGate = false;
		const id = pendingSourceId;
		pendingSourceId = null;
		if (id) doSelectSource(id);
	}

	function cancelAgeGate() {
		showAgeGate = false;
		pendingSourceId = null;
	}

	async function selectSource(id: string) {
		closeDropdown();
		if (id === currentSource) return;

		const meta = getSourceMeta(id);
		if (meta.isR18 && !isNsfwConfirmed()) {
			pendingSourceId = id;
			showAgeGate = true;
			return;
		}

		await doSelectSource(id);
	}

	async function selectMulti() {
		closeDropdown();
		selectedLang = 'all';
		selectedType = 'all';
		setMultiMode();
		loading = true;
		try {
			await goto('/', {
				invalidateAll: true,
				keepFocus: true,
				noScroll: false
			});
		} finally {
			loading = false;
		}
	}

	function handleSearch(e: SubmitEvent) {
		e.preventDefault();
		applyFilters();
	}

	function clearFilters() {
		selectedLang = 'all';
		selectedType = 'all';
		searchInput = '';
		goto(isMultiMode ? '/' : `/?source=${currentSource}`, { invalidateAll: true });
	}
</script>

{#snippet renderIcon(icon: string)}
	{#if /^[a-z]{2}$/i.test(icon)}
		<span class="fi fi-{icon} rounded-sm"></span>
	{:else}
		{icon}
	{/if}
{/snippet}

{#snippet chevron(open: boolean)}
	<ChevronDown
		class="ml-auto h-4 w-4 shrink-0 opacity-60 transition-transform duration-200 {open
			? 'rotate-180'
			: ''}"
	/>
{/snippet}

<!-- ── Filter Bar ─────────────────────────────────────────────────────────── -->
<div
	class="relative z-30 mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
	use:clickOutside
>
	<!-- SOURCE -->
	<div class="relative">
		<button
			type="button"
			onclick={() => toggleDropdown('source')}
			aria-expanded={activeDropdown === 'source'}
			class="filter-btn flex w-full min-w-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium shadow-sm transition active:scale-[0.98] sm:w-auto sm:min-w-[150px]"
		>
			{#if isMultiMode}
				<Layers class="h-4 w-4 shrink-0 text-violet-500" />
			{:else}
				<span class="flex items-center text-base leading-none">
					{@render renderIcon(getSourceMeta(currentSource).flag)}
				</span>
			{/if}

			<span class="max-w-[120px] truncate">{currentSourceName}</span>

			{#if !isMultiMode && getSourceMeta(currentSource).isR18}
				<span class="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">R18</span>
			{/if}
			{#if !isMultiMode && (getSourceMeta(currentSource).isError || isBrokenSource(currentSource))}
				<span class="rounded border border-red-500/50 bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-400">ERROR</span>
			{/if}

			{@render chevron(activeDropdown === 'source')}
		</button>

		{#if activeDropdown === 'source'}
			<div
				class="dropdown-menu absolute left-0 top-full z-[200] mt-2 w-[280px] overflow-hidden rounded-2xl border shadow-2xl"
			>
				<div class="max-h-[60vh] overflow-y-auto p-1.5">
					<!-- Multi option -->
					<button
						type="button"
						onclick={selectMulti}
						class="dropdown-item flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition {isMultiMode
							? 'active-item'
							: ''}"
					>
						<span class="icon-wrapper flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
							<Layers class="h-4 w-4 text-violet-500" />
						</span>
						<div class="min-w-0 flex-1">
							<span class="truncate text-sm font-medium">Multi (Preferred)</span>
							<p class="mt-0.5 text-[11px] opacity-60">From Settings</p>
						</div>
						{#if isMultiMode}
							<Check class="h-4 w-4 shrink-0 text-violet-500" />
						{/if}
					</button>

					<div class="my-1.5 border-t border-zinc-600/40"></div>

					{#each Object.entries(groupedSources) as [langKey, items]}
						<div
							class="dropdown-header sticky top-0 z-10 -mx-1.5 my-1 px-3 py-1 text-[11px] font-bold uppercase tracking-wider"
						>
							{LANG_LABELS[langKey] || langKey}
						</div>

						{#each items as source (source.id)}
							{@const meta = getSourceMeta(source.id)}
							{@const isSelected =
								!isMultiMode &&
								source.id.toLowerCase() === (currentSource || '').toLowerCase()}

							<button
								type="button"
								onclick={() => selectSource(source.id)}
								class="dropdown-item flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition {isSelected
									? 'active-item'
									: ''}"
							>
								<span
									class="icon-wrapper flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg"
								>
									{@render renderIcon(meta.flag)}
								</span>
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2">
										<span class="truncate text-sm font-medium">{source.name}</span>
										{#if meta.isR18}
											<span
												class="rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-bold text-white"
											>
												R18
											</span>
										{/if}
										{#if meta.isError || isBrokenSource(source.id)}
											<span
												class="rounded border border-red-500/50 bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-400">
												ERROR
											</span>
										{/if}
									</div>
									<p class="mt-0.5 text-[11px] opacity-60">{meta.lang}</p>
								</div>
								{#if isSelected}
									<Check class="h-4 w-4 shrink-0 text-violet-500" />
								{/if}
							</button>
						{/each}
					{/each}
				</div>
			</div>
		{/if}
	</div>

	<!-- LANGUAGE (hanya untuk source yang support) -->
	{#if showLangFilter}
		<div class="relative">
			<button
				type="button"
				onclick={() => toggleDropdown('lang')}
				aria-expanded={activeDropdown === 'lang'}
				class="filter-btn flex w-full min-w-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium shadow-sm transition active:scale-[0.98] sm:w-auto sm:min-w-[130px]"
			>
				<span class="flex items-center text-base leading-none">
					{@render renderIcon(currentLangObj.flag)}
				</span>
				<span class="max-w-[90px] truncate">{currentLangObj.name}</span>
				{@render chevron(activeDropdown === 'lang')}
			</button>

			{#if activeDropdown === 'lang'}
				<div
					class="dropdown-menu absolute left-0 top-full z-[200] mt-2 w-[240px] overflow-hidden rounded-2xl border shadow-2xl"
				>
					<div class="max-h-[60vh] overflow-y-auto p-1.5">
						{#each LANGUAGES as lang (lang.id)}
							{@const isSelected = lang.id === selectedLang}
							<button
								type="button"
								onclick={() => selectLang(lang.id)}
								class="dropdown-item flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition {isSelected
									? 'active-item'
									: ''}"
							>
								<span class="flex h-7 w-7 shrink-0 items-center justify-center text-base">
									{@render renderIcon(lang.flag)}
								</span>
								<span class="flex-1 truncate text-sm font-medium">{lang.name}</span>
								<span
									class="code-badge rounded px-1.5 py-0.5 font-mono text-[10px] uppercase opacity-70"
								>
									{lang.code}
								</span>
								{#if isSelected}
									<Check class="h-4 w-4 shrink-0 text-violet-500" />
								{/if}
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- TYPE -->
	<div class="relative">
		<button
			type="button"
			onclick={() => toggleDropdown('type')}
			aria-expanded={activeDropdown === 'type'}
			class="filter-btn flex w-full min-w-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium shadow-sm transition active:scale-[0.98] sm:w-auto sm:min-w-[120px]"
		>
			<span class="flex items-center text-base leading-none">
				{@render renderIcon(currentTypeObj.icon)}
			</span>
			<span class="max-w-[90px] truncate">{currentTypeObj.name}</span>
			{@render chevron(activeDropdown === 'type')}
		</button>

		{#if activeDropdown === 'type'}
			<div
				class="dropdown-menu absolute left-0 top-full z-[200] mt-2 w-[220px] overflow-hidden rounded-2xl border shadow-2xl"
			>
				<div class="max-h-[60vh] overflow-y-auto p-1.5">
					{#each TYPES as t (t.id)}
						{@const isSelected = t.id === selectedType}
						<button
							type="button"
							onclick={() => selectType(t.id)}
							class="dropdown-item flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition {isSelected
								? 'active-item'
								: ''}"
						>
							<span class="flex h-7 w-7 shrink-0 items-center justify-center text-base">
								{@render renderIcon(t.icon)}
							</span>
							<span class="flex-1 truncate text-sm font-medium">{t.name}</span>
							{#if isSelected}
								<Check class="h-4 w-4 shrink-0 text-violet-500" />
							{/if}
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</div>

	<!-- SEARCH -->
	<form
		class="flex min-w-0 w-full basis-full gap-2 sm:max-w-md sm:flex-1 sm:basis-auto"
		onsubmit={handleSearch}
	>
		<div class="relative min-w-0 flex-1">
			<Search class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 opacity-40" />
			<input
				type="text"
				placeholder="Search manga..."
				bind:value={searchInput}
				class="filter-btn w-full rounded-full border py-2.5 pr-4 pl-9 text-sm transition-colors focus:ring-1 focus:ring-violet-500 focus:outline-none"
			/>
		</div>
		<button
			type="submit"
			disabled={loading}
			class="shrink-0 rounded-full bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
		>
			{#if loading}
				<Loader2 class="h-4 w-4 animate-spin" />
			{:else}
				Search
			{/if}
		</button>
	</form>
</div>

<!-- ── Active Filters Indicator ───────────────────────────────────────────── -->
{#if hasActiveFilters}
	<p class="mb-3 text-sm opacity-70">
		Filtering active:
		{#if searchQuery}
			<span class="font-semibold text-violet-500">"{searchQuery}"</span>
		{/if}
		{#if selectedLang !== 'all'}
			<span class="ml-2 rounded bg-violet-500/10 px-2 py-0.5 text-xs text-violet-500">
				Lang: {currentLangObj.name}
			</span>
		{/if}
		{#if selectedType !== 'all'}
			<span class="ml-2 rounded bg-violet-500/10 px-2 py-0.5 text-xs text-violet-500">
				Type: {currentTypeObj.name}
			</span>
		{/if}
		<button type="button" onclick={clearFilters} class="ml-3 text-violet-500 hover:underline">
			Clear all
		</button>
	</p>
{/if}


<!-- Age Gate Modal (R18) -->
{#if showAgeGate}
	<div
		class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
		aria-labelledby="age-gate-title"
	>
		<div class="w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
			<div class="mb-4 flex items-center justify-center">
				<span class="rounded-lg bg-red-600 px-3 py-1 text-sm font-bold tracking-wide text-white">R18</span>
			</div>
			<h2 id="age-gate-title" class="mb-2 text-center text-lg font-bold text-white">
				You must be 18+ to see it
			</h2>
			<p class="mb-6 text-center text-sm text-zinc-400">
				This source contains adult / NSFW content.
				<br />
				By continuing you confirm that you are at least 18 years old.
			</p>
			<div class="flex flex-col gap-2 sm:flex-row">
				<button
					type="button"
					onclick={cancelAgeGate}
					class="flex-1 rounded-xl border border-zinc-600 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-700 active:scale-[0.98]"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={confirmAge}
					class="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-red-500 active:scale-[0.98]"
				>
					I am 18+
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.filter-btn {
		background-color: #ffffff;
		color: #18181b;
		border-color: #e4e4e7;
	}
	.filter-btn:hover {
		background-color: #f4f4f5;
	}

	.dropdown-menu {
		background-color: #ffffff;
		color: #18181b;
		border-color: #e4e4e7;
		opacity: 1;
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
	}
	.dropdown-header {
		background-color: #f4f4f5;
		color: #71717a;
	}
	.dropdown-item {
		color: #27272a;
	}
	.dropdown-item:hover {
		background-color: #f4f4f5;
	}
	.active-item {
		background-color: rgba(139, 92, 246, 0.12) !important;
		color: #8b5cf6 !important;
	}
	.icon-wrapper,
	.code-badge {
		background-color: #f4f4f5;
	}

	:global(html.dark) .filter-btn,
	:global(.dark) .filter-btn {
		background-color: #3d3750;
		color: #f5f3ff;
		border-color: #4a4655;
	}
	:global(html.dark) .filter-btn:hover,
	:global(.dark) .filter-btn:hover {
		background-color: #4a445c;
	}

	:global(html.dark) .dropdown-menu,
	:global(.dark) .dropdown-menu {
		background-color: #1e1b28 !important;
		color: #f5f3ff;
		border-color: #4a4655;
		opacity: 1 !important;
		backdrop-filter: none !important;
		box-shadow:
			0 20px 25px -5px rgba(0, 0, 0, 0.55),
			0 10px 10px -5px rgba(0, 0, 0, 0.4);
	}
	:global(html.dark) .dropdown-header,
	:global(.dark) .dropdown-header {
		background-color: #2a2636;
		color: #c9c3d9;
	}
	:global(html.dark) .dropdown-item,
	:global(.dark) .dropdown-item {
		color: #eeeaf7;
	}
	:global(html.dark) .dropdown-item:hover,
	:global(.dark) .dropdown-item:hover {
		background-color: #353145;
		color: #ffffff;
	}
	:global(html.dark) .active-item,
	:global(.dark) .active-item {
		background-color: rgba(139, 92, 246, 0.2) !important;
		color: #a78bfa !important;
	}
	:global(html.dark) .icon-wrapper,
	:global(.dark) .icon-wrapper,
	:global(html.dark) .code-badge,
	:global(.dark) .code-badge {
		background-color: #2a2636;
	}
</style>