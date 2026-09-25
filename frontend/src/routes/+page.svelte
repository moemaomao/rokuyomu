<script lang="ts">
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { ChevronLeft, ChevronRight, Loader2, ArrowRight } from 'lucide-svelte';
	import BrowseHeader from '$lib/components/BrowseHeader.svelte';
	import { getSourceMeta } from '$lib/utils/sourceMeta';
	import { isNsfwConfirmed, setNsfwConfirmed } from '$lib/utils/nsfw';
	import { getImpl, isMultiMode } from '$lib/stores/impl';
	import { isNovelSource } from '$lib/utils/novelSources';
	import coverNotFound from '$lib/assets/cover not found.jpg';

	const { data }: { data: PageData } = $props();

	const pageData = $derived(
		data as PageData & {
			isMulti?: boolean;
			preferredSources?: string[];
		}
	);

	let mangas = $derived(pageData.mangas);
	let sources = $derived(pageData.sources);
	let currentSource = $derived(pageData.currentSource);
	let currentPage = $derived(pageData.currentPage);
	let searchQuery = $derived(pageData.searchQuery);
	let isMulti = $derived(pageData.isMulti ?? false);
	let preferredSources = $derived(pageData.preferredSources ?? []);

	let loading = $state(false);
	let isDarkMode = $state(true);
	let jumpPageInput = $state('');

	let showAgeGate = $state(false);
	let nsfwBlocked = $state(false);

	let selectedLang = $state($page.url.searchParams.get('lang') || 'all');
	let selectedType = $state($page.url.searchParams.get('type') || 'all');

	$effect(() => {
		selectedLang = $page.url.searchParams.get('lang') || 'all';
		selectedType = $page.url.searchParams.get('type') || 'all';
		jumpPageInput = '';
		loading = false;
	});

	function checkR18Gate() {
		const src = currentSource || '';
		if (src && getSourceMeta(src).isR18 && !isNsfwConfirmed()) {
			nsfwBlocked = true;
			showAgeGate = true;
		} else {
			nsfwBlocked = false;
			showAgeGate = false;
		}
	}

	function confirmAge() {
		setNsfwConfirmed(true);
		showAgeGate = false;
		nsfwBlocked = false;
	}

	function cancelAgeGate() {
		showAgeGate = false;
		goto('/', { invalidateAll: true });
	}

	onMount(() => {
		const updateTheme = () => {
			isDarkMode = document.documentElement.classList.contains('dark');
		};
		updateTheme();
		checkR18Gate();
		const observer = new MutationObserver(updateTheme);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class']
		});

		try {
			const url = new URL(window.location.href);
			const hasSource = !!url.searchParams.get('source');
			const hasQuery = !!url.searchParams.get('q')?.trim();
		
			if (!hasSource && !hasQuery && !isMultiMode()) {
				const last = getImpl();
				if (last) {
					const ok = (sources ?? []).some(
						(s) => s.id.toLowerCase() === last.toLowerCase()
					);
					if (ok) {
						const p = new URLSearchParams();
						p.set('source', last);
						if (isNovelSource(last) || url.searchParams.get('kind') === 'novel') {
							p.set('kind', 'novel');
						}

						goto(`/?${p.toString()}`, {
							replaceState: true,
							invalidateAll: true,
							noScroll: true
						});
					}
				}
			}
		} catch (e) {
			console.warn('[restore source]', e);
		}

		return () => observer.disconnect();
	});

	$effect(() => {
		const _ = currentSource;
		if (typeof window !== 'undefined') checkR18Gate();
	});

	function proxyImage(url: string, sourceId?: string): string {
		const src = sourceId || currentSource;
		if (!url || !src) return '';
		let u = String(url).trim();
		if (u.startsWith('//')) u = 'https:' + u;
		return `/api/proxy?url=${encodeURIComponent(u)}&source=${src}`;
	}

	function onCoverError(e: Event) {
	const img = e.currentTarget as HTMLImageElement;
	const original = img.dataset.original;
	const src = img.dataset.source || currentSource;

	if (!original || !src || img.dataset.fallback === '1') {
		img.src = coverNotFound;
		img.onerror = null;
		return;
	}

	img.dataset.fallback = '1';
	img.src = `/api/proxy?url=${encodeURIComponent(original)}&source=${src}`;
}

	async function navigate(params: URLSearchParams) {
		loading = true;
		try {
			await goto(`/?${params.toString()}`, {
				invalidateAll: true,
				keepFocus: true,
				noScroll: false
			});
		} finally {
			loading = false;
		}
	}

	function goToPage(p: number) {
		if (p < 1 || p === currentPage || loading) return;

		const params = new URLSearchParams();
		if (!isMulti && currentSource) {
			params.set('source', currentSource);
		}
		params.set('page', String(p));
		if (searchQuery) params.set('q', searchQuery);
		if (selectedLang !== 'all') params.set('lang', selectedLang);
		if (selectedType !== 'all') params.set('type', selectedType);
		navigate(params);
	}

	function handleJumpPage(e: SubmitEvent) {
		e.preventDefault();
		const target = parseInt(jumpPageInput, 10);
		if (!isNaN(target) && target > 0) goToPage(target);
	}

	function getPaginationRange(current: number) {
		const delta = 2;
		const range: number[] = [];
		for (let i = Math.max(1, current - delta); i <= current + delta; i++) {
			range.push(i);
		}

		const withDots: (number | string)[] = [];
		if (range[0] > 1) {
			withDots.push(1);
			if (range[0] > 2) withDots.push('...');
		}
		withDots.push(...range);
		withDots.push('...');
		return withDots;
	}

	function statusClass(status?: string) {
		const s = (status || '').toLowerCase();
		if (s.includes('ongoing')) return 'bg-green-600';
		if (s.includes('completed') || s.includes('complete')) return 'bg-blue-600';
		if (s.includes('hiatus')) return 'bg-orange-500';
		if (s.includes('dropped')) return 'bg-red-700';
		return 'bg-green-600';
	}

	function typeBadgeClass(type?: string) {
		const t = (type || 'manga').toLowerCase();
		const map: Record<string, string> = {
			doujinshi: 'bg-[#8b1e42]',
			artistcg: 'bg-[#009688]',
			gamecg: 'bg-[#009688]',
			imageset: 'bg-[#616161]',
			anime: 'bg-[#7b1fa2]',
			western: 'bg-[#5d4037]',
			'non-h': 'bg-[#455a64]',
			manhwa: 'bg-[#1976D2]',
			manhua: 'bg-[#2E7D32]'
		};
		return map[t] || 'bg-[#c91714]';
	}

	function listChapterFlag(lang?: string): string {
		const l = String(lang || '')
			.trim()
			.toLowerCase();
		const map: Record<string, string> = {
			en: 'gb',
			'en-us': 'us',
			id: 'id',
			ja: 'jp',
			'ja-ro': 'jp',
			ko: 'kr',
			'ko-ro': 'kr',
			zh: 'cn',
			'zh-hk': 'hk',
			'zh-ro': 'cn',
			fr: 'fr',
			pl: 'pl',
			es: 'es',
			'es-la': 'mx',
			'pt-br': 'br',
			pt: 'pt',
			ru: 'ru',
			vi: 'vn',
			th: 'th',
			ar: 'sa',
			de: 'de',
			it: 'it',
			tr: 'tr',
			uk: 'ua',
			hi: 'in',
			ms: 'my',
			nl: 'nl'
		};
		return map[l] || '';
	}

	function sourceName(id: string) {
		return sources.find((s) => s.id === id)?.name || id;
	}

	// ── SEO / share card ─────────────────────────────────────────────────────
	let siteUrl = $derived($page.url.origin);
	let pageTitle = $derived(
		isMulti
			? 'RokuYomu - Manga Source Base'
			: currentSource
				? `${sourceName(currentSource)} — RokuYomu`
				: 'RokuYomu — Baca Manga, Manhwa & Manhua'
	);
	let pageDesc = $derived(
		searchQuery
			? `Hasil pencarian "${searchQuery}" di RokuYomu`
			: 'Baca manga, manhwa, dan manhua gratis dari banyak sumber di RokuYomu.'
	);
	let pageImage = $derived(`${siteUrl}/rokuyomu.png`);
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={pageDesc} />

	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="RokuYomu" />
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={pageDesc} />
	<meta property="og:url" content={$page.url.href} />
	<meta property="og:image" content={pageImage} />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={pageTitle} />
	<meta name="twitter:description" content={pageDesc} />
	<meta name="twitter:image" content={pageImage} />

	<link rel="canonical" href={$page.url.href} />
</svelte:head>

<div class="mx-auto w-full max-w-none px-2 py-3 sm:px-3 sm:py-4 lg:px-4">
	<!-- HEADER / FILTER -->
	<BrowseHeader
		{sources}
		currentSource={currentSource ?? ''}
		{searchQuery}
		bind:loading
		bind:selectedLang
		bind:selectedType
	/>

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
						Go back
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

	{#if nsfwBlocked}
		<div class="flex min-h-[50vh] w-full flex-col items-center justify-center gap-3 py-20 text-center">
			<span class="rounded-lg bg-red-600 px-3 py-1 text-sm font-bold text-white">R18</span>
			<p class="text-sm font-medium {isDarkMode ? 'text-zinc-300' : 'text-zinc-600'}">
				Content is hidden until you confirm you are 18 or older.
			</p>
		</div>
	{:else}
	<!-- Multi-source indicator -->
	{#if isMulti}
		<div
			class="mb-3 flex flex-wrap items-center gap-1.5 text-[11px] sm:text-xs
				{isDarkMode ? 'text-zinc-400' : 'text-zinc-500'}"
		>
			<span class="font-medium">Multi-source</span>
			<span class="opacity-50">·</span>
			{#each preferredSources as sid}
				<span
					class="rounded-full border px-2 py-0.5 font-medium
						{isDarkMode
						? 'border-zinc-700 bg-zinc-900 text-zinc-300'
						: 'border-zinc-300 bg-white text-zinc-700 shadow-sm'}"
				>
					{sourceName(sid)}
				</span>
			{/each}
			<a href="/settings" class="ml-1 font-medium text-red-500 hover:underline">
				Edit
			</a>
		</div>
	{/if}

	<!-- Sub-Header -->
	<div class="mb-3 flex items-center gap-0">
		<div class="h-px flex-1 {isDarkMode ? 'bg-zinc-800' : 'bg-zinc-300'}"></div>
		<span
			class="mx-3 inline-flex items-center rounded-full border px-3.5 py-1 text-[12px] font-semibold transition-colors sm:text-[13px]
				{isDarkMode
				? 'border-zinc-700 bg-zinc-900 text-white'
				: 'border-zinc-300 bg-white text-zinc-800 shadow-sm'}"
		>
			Latest Manga
		</span>
		<div class="h-px flex-1 {isDarkMode ? 'bg-zinc-800' : 'bg-zinc-300'}"></div>
	</div>

	<!-- Content -->
	{#if loading}
		<div class="flex min-h-[50vh] w-full items-center justify-center py-20">
			<div class="flex flex-col items-center gap-3">
				<Loader2 class="h-10 w-10 animate-spin text-red-500" />
				<span class="text-sm font-medium {isDarkMode ? 'text-zinc-400' : 'text-zinc-600'}">
					Loading manga...
				</span>
			</div>
		</div>
	{:else if mangas.length === 0}
		<div class="py-16 text-center {isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}">
			<p>No manga found matching the selected filters.</p>
			{#if isMulti}
				<p class="mt-2 text-sm">
					Silakan <a href="/settings" class="text-red-500 hover:underline">ubah preferred sources</a>
					atau pilih source spesifik dari dropdown.
				</p>
			{/if}
		</div>
	{:else}
		{#key `${isMulti ? 'multi-' + preferredSources.join(',') : currentSource}-${currentPage}-${searchQuery}`}
			<div
				class="grid grid-cols-3 gap-1.5 sm:grid-cols-4 sm:gap-2 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-8"
			>
				{#each mangas as manga, i (`${manga.sourceId ?? 'x'}:${manga.id}:${i}`)}
					<a
						href="/manga/{manga.sourceId}{manga.id}{selectedLang !== 'all'
							? `?lang=${selectedLang}`
							: ''}"
						class="group block"
					>
						<div
							class="relative overflow-hidden rounded-md bg-zinc-900 ring-1 ring-black/5 dark:ring-white/5"
						>
							<div class="relative aspect-[3/4] w-full overflow-hidden">
								{#if manga.cover}
									<img
										src={proxyImage(manga.cover, manga.sourceId)}
										data-original={manga.cover}
										data-source={manga.sourceId}
										alt={manga.title}
										loading="lazy"
										decoding="async"
										onerror={onCoverError}
										class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
									/>
								{:else}
	                               <img
		                               src={coverNotFound}
		                               alt="Cover not found"
		                               class="h-full w-full object-cover"
	                                />
                                 {/if}

								<!-- STATUS -->
								<span
									class="absolute top-1 left-1 z-20 rounded px-1 py-0.5 text-[8px] font-bold uppercase text-white sm:text-[9px]
										{statusClass(manga.status)}"
								>
									{manga.status || 'ONGOING'}
								</span>

								<!-- CHAPTER -->
								{#if manga.latestChapter || (manga as any).chapter}
									<span
										class="absolute top-[24px] left-1 z-20 flex items-center gap-0.5 rounded bg-yellow-400 px-1 py-0.5 text-[8px] font-bold text-black sm:text-[9px]"
									>
										{#if listChapterFlag(manga.lang)}
											<span
												class="fi fi-{listChapterFlag(manga.lang)} text-[9px] leading-none sm:text-[10px]"
											></span>
										{/if}
										<span>Ch. {manga.latestChapter || (manga as any).chapter}</span>
									</span>
								{/if}

								<!-- TYPE -->
								<span
									class="absolute bottom-1 left-1 z-20 rounded px-1 py-0.5 text-[8px] font-bold uppercase text-white shadow-sm sm:text-[9px]
										{typeBadgeClass(manga.type)}"
								>
									{manga.type || 'manga'}
								</span>

								<!-- SOURCE badge (multi mode) -->
								{#if isMulti && manga.sourceId}
									<span
										class="absolute right-1 bottom-1 z-20 max-w-[60%] truncate rounded bg-purple-500/50 px-1 py-0.5 text-[8px] font-bold uppercase text-white shadow-sm sm:text-[9px]"
									>
										{manga.sourceId}
									</span>
								{/if}

								<!-- TITLE -->
                                <div
                                    class="absolute inset-x-0 bottom-0 z-10 max-h-12 bg-gradient-to-t from-black/95 via-black/80 to-transparent px-1 pt-4 pb-13 transition-all duration-300 group-hover:max-h-full group-hover:pt-8 group-active:max-h-full group-active:pt-8"
                                >
                                    <h3
                                        class="line-clamp-2 text-center text-[10px] font-semibold leading-tight text-white drop-shadow-md transition-all duration-300 group-hover:line-clamp-none group-active:line-clamp-none sm:text-[11px]"
                                    >
                                        {manga.title}
                                    </h3>
                                </div>
							</div>
						</div>
					</a>
				{/each}
			</div>
		{/key}

		<!-- PAGINATION -->
		<div
			class="mt-8 flex flex-col items-center justify-center gap-4 border-t pt-6
				{isDarkMode ? 'border-zinc-800/80' : 'border-zinc-200'}"
		>
			<div class="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
				<div class="flex items-center gap-1 sm:gap-1.5">
					<button
						onclick={() => goToPage(currentPage - 1)}
						disabled={currentPage <= 1 || loading}
						aria-label="Previous Page"
						class="flex h-9 w-9 items-center justify-center rounded-xl border transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40
							{isDarkMode
							? 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800'
							: 'border-zinc-200 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50'}"
					>
						<ChevronLeft class="h-4 w-4" />
					</button>

					{#each getPaginationRange(currentPage) as item}
						{#if item === '...'}
							<span
								class="px-1.5 text-xs font-semibold {isDarkMode ? 'text-zinc-600' : 'text-zinc-400'}"
							>
								•••
							</span>
						{:else}
							<button
								onclick={() => goToPage(Number(item))}
								disabled={loading}
								class="h-9 min-w-[36px] rounded-xl px-2.5 text-xs font-semibold transition active:scale-95
									{currentPage === item
									? 'bg-red-600 text-white shadow-md shadow-red-600/30'
									: isDarkMode
										? 'border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800'
										: 'border border-zinc-200 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50'}"
							>
								{item}
							</button>
						{/if}
					{/each}

					<button
						onclick={() => goToPage(currentPage + 1)}
						disabled={loading}
						aria-label="Next Page"
						class="flex h-9 w-9 items-center justify-center rounded-xl border transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40
							{isDarkMode
							? 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800'
							: 'border-zinc-200 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50'}"
					>
						<ChevronRight class="h-4 w-4" />
					</button>
				</div>

				<div class="hidden h-5 w-px bg-zinc-700/50 sm:block"></div>

				<form onsubmit={handleJumpPage} class="flex items-center gap-2">
					<span class="text-xs font-medium {isDarkMode ? 'text-zinc-400' : 'text-zinc-500'}">
						Page
					</span>
					<input
						type="number"
						min="1"
						placeholder={String(currentPage)}
						bind:value={jumpPageInput}
						class="h-9 w-14 rounded-xl border px-2 text-center text-xs font-semibold transition-all focus:outline-none focus:ring-1 focus:ring-red-500
							[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
							{isDarkMode
							? 'border-zinc-800 bg-zinc-900 text-zinc-100 placeholder:text-zinc-600'
							: 'border-zinc-200 bg-white text-zinc-800 shadow-sm placeholder:text-zinc-400'}"
					/>
					<button
						type="submit"
						disabled={loading || !jumpPageInput}
						aria-label="Go to page"
						class="flex h-9 w-9 items-center justify-center rounded-xl bg-red-600 text-white transition hover:bg-red-500 active:scale-95 disabled:opacity-40"
					>
						<ArrowRight class="h-4 w-4" />
					</button>
				</form>
			</div>
		</div>
	{/if}

	{/if}
</div>
