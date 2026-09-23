<script lang="ts">
	import { onMount } from 'svelte';
	import { Check, Settings, AlertTriangle, BookMarked, BookOpen } from 'lucide-svelte';
	import { getPreferredSources, setPreferredSources } from '$lib/stores/preferredSources';
	import { getSourceMeta, groupSourcesByLang, LANG_LABELS } from '$lib/utils/sourceMeta';
	import { isNovelSource } from '$lib/utils/novelSources';
	import { isBrokenSource } from '$lib/stores/brokenSources.svelte';
	import { isNsfwConfirmed, setNsfwConfirmed } from '$lib/utils/nsfw';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	const MAX_PREFERRED = 4;

	type ContentKind = 'comic' | 'novel';

	let preferred = $state<string[]>([]);
	let isDarkMode = $state(true);
	let saved = $state(false);
	let showLimitToast = $state(false);
	let toastTimer: ReturnType<typeof setTimeout> | null = null;

	let showAgeGate = $state(false);
	let pendingR18Id = $state<string | null>(null);

	let selectedKind = $state<ContentKind>('comic');

	let filteredSources = $derived(
		data.sources.filter((s) => {
			const isNovel = isNovelSource(s.id);
			return selectedKind === 'novel' ? isNovel : !isNovel;
		})
	);

	let grouped = $derived(groupSourcesByLang(filteredSources));

	let preferredInKind = $derived(
		preferred.filter((id) => {
			const isNovel = isNovelSource(id);
			return selectedKind === 'novel' ? isNovel : !isNovel;
		})
	);

	let atLimit = $derived(preferred.length >= MAX_PREFERRED);

	onMount(() => {
		const savedPrefs = getPreferredSources().slice(0, MAX_PREFERRED);
		preferred = savedPrefs;
		isDarkMode = document.documentElement.classList.contains('dark');
		const obs = new MutationObserver(() => {
			isDarkMode = document.documentElement.classList.contains('dark');
		});
		obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
		return () => {
			obs.disconnect();
			if (toastTimer) clearTimeout(toastTimer);
		};
	});

	function setKind(kind: ContentKind) {
		selectedKind = kind;
	}

	function flashLimitToast() {
		showLimitToast = true;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => {
			showLimitToast = false;
		}, 2500);
	}

	function doToggleOn(id: string) {
		if (preferred.length >= MAX_PREFERRED) {
			flashLimitToast();
			return;
		}
		preferred = [...preferred, id];
		saved = false;
	}

	function confirmAge() {
		setNsfwConfirmed(true);
		showAgeGate = false;
		const id = pendingR18Id;
		pendingR18Id = null;
		if (id) doToggleOn(id);
	}

	function cancelAgeGate() {
		showAgeGate = false;
		pendingR18Id = null;
	}

	function toggle(id: string) {
		if (preferred.includes(id)) {
			preferred = preferred.filter((s) => s !== id);
			saved = false;
			return;
		}
		const meta = getSourceMeta(id);
		if (meta.isR18 && !isNsfwConfirmed()) {
			pendingR18Id = id;
			showAgeGate = true;
			return;
		}
		doToggleOn(id);
	}

	function save() {
		setPreferredSources(preferred.slice(0, MAX_PREFERRED));
		saved = true;
		setTimeout(() => {
			window.location.href = selectedKind === 'novel' ? '/?kind=novel' : '/';
		}, 300);
	}

	function selectAll() {
		const ids = filteredSources.map((s) => s.id);
		const next = [...preferred];
		for (const id of ids) {
			if (next.length >= MAX_PREFERRED) break;
			if (!next.includes(id)) next.push(id);
		}
		preferred = next;
		saved = false;
		if (filteredSources.length > MAX_PREFERRED) flashLimitToast();
	}

	function selectNone() {
		// Hapus hanya preferred yang termasuk kind aktif
		preferred = preferred.filter((id) => {
			const isNovel = isNovelSource(id);
			return selectedKind === 'novel' ? !isNovel : isNovel;
		});
		saved = false;
	}
</script>

<svelte:head>
	<title>Settings - Source Preferences | Rokuyomu</title>
</svelte:head>

<div class="relative mx-auto max-w-3xl px-4 py-6 sm:px-6">
	<div class="mb-6 flex items-center gap-3">
		<div class="rounded-xl bg-red-600/20 p-2.5">
			<Settings class="h-6 w-6 text-red-500" />
		</div>
		<div>
			<h1 class="text-xl font-bold sm:text-2xl">Source Preferences</h1>
			<p class="mt-0.5 text-sm {isDarkMode ? 'text-zinc-400' : 'text-zinc-500'}">
				Choose which sources appear on the homepage (max {MAX_PREFERRED}). Manga will be merged
				and sorted from the latest updates. Leave empty to use the source dropdown instead.
			</p>
		</div>
	</div>

	<!-- Switch Comic | Novel -->
	<div
		class="mb-5 flex w-full max-w-xs overflow-hidden rounded-xl border p-1
			{isDarkMode ? 'border-zinc-700 bg-zinc-900' : 'border-zinc-200 bg-zinc-100'}"
	>
		<button
			type="button"
			onclick={() => setKind('comic')}
			class="flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition
				{selectedKind === 'comic'
					? 'bg-violet-600 text-white shadow'
					: isDarkMode
						? 'text-zinc-400 hover:text-zinc-200'
						: 'text-zinc-500 hover:text-zinc-800'}"
		>
			<BookMarked class="h-4 w-4" />
			Comic
		</button>
		<button
			type="button"
			onclick={() => setKind('novel')}
			class="flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition
				{selectedKind === 'novel'
					? 'bg-amber-600 text-white shadow'
					: isDarkMode
						? 'text-zinc-400 hover:text-zinc-200'
						: 'text-zinc-500 hover:text-zinc-800'}"
		>
			<BookOpen class="h-4 w-4" />
			Novel
		</button>
	</div>

	<!-- Actions -->
	<div class="mb-5 flex flex-wrap items-center gap-2">
		<button
			onclick={selectAll}
			class="rounded-lg border px-3 py-1.5 text-xs font-medium transition
				{isDarkMode ? 'border-zinc-700 hover:bg-zinc-800' : 'border-zinc-300 hover:bg-zinc-100'}"
		>
			Select All
		</button>
		<button
			onclick={selectNone}
			class="rounded-lg border px-3 py-1.5 text-xs font-medium transition
				{isDarkMode ? 'border-zinc-700 hover:bg-zinc-800' : 'border-zinc-300 hover:bg-zinc-100'}"
		>
			Clear All
		</button>
		<span
			class="ml-auto text-xs font-medium
				{atLimit
				? 'text-amber-500'
				: isDarkMode
					? 'text-zinc-500'
					: 'text-zinc-400'}"
		>
			{preferred.length}/{MAX_PREFERRED} selected
			{#if preferredInKind.length !== preferred.length}
				<span class="opacity-70">({preferredInKind.length} {selectedKind})</span>
			{/if}
		</span>
	</div>

	<!-- Source checklist (filtered by kind) -->
	<div class="space-y-5">
		{#if filteredSources.length === 0}
			<p class="py-10 text-center text-sm {isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}">
				{selectedKind === 'novel'
					? 'Belum ada source novel terdaftar. Tambahkan di novelSources.ts + sources registry.'
					: 'Tidak ada source comic.'}
			</p>
		{:else}
			{#each Object.entries(grouped) as [langKey, items]}
				<div>
					<h2
						class="mb-2 text-xs font-bold uppercase tracking-wider {isDarkMode
							? 'text-zinc-500'
							: 'text-zinc-400'}"
					>
						{LANG_LABELS[langKey] || langKey}
					</h2>
					<div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
						{#each items as src (src.id)}
							{@const meta = getSourceMeta(src.id)}
							{@const active = preferred.includes(src.id)}
							{@const disabled = atLimit && !active}
							<button
								type="button"
								onclick={() => toggle(src.id)}
								class="flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition
									{disabled ? 'cursor-not-allowed opacity-40' : ''}
									{active
										? isDarkMode
											? 'border-red-600/60 bg-red-600/10'
											: 'border-red-500 bg-red-50'
										: isDarkMode
											? 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700'
											: 'border-zinc-200 bg-white hover:border-zinc-300'}"
							>
								<div
									class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition
										{active
											? 'border-red-500 bg-red-600 text-white'
											: isDarkMode
												? 'border-zinc-600'
												: 'border-zinc-300'}"
								>
									{#if active}
										<Check class="h-3.5 w-3.5" />
									{/if}
								</div>
								<span class="fi fi-{meta.flag} text-sm"></span>
								<span class="min-w-0 flex-1 truncate text-sm font-medium">{src.name}</span>
								{#if meta.isR18}
									<span class="rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-bold text-white"
										>R18</span
									>
								{/if}
								{#if meta.isError || isBrokenSource(src.id)}
									<span
										class="rounded border border-red-500/50 bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-400"
									>
										ERROR</span
									>
								{/if}
							</button>
						{/each}
					</div>
				</div>
			{/each}
		{/if}
	</div>

	<!-- Save bar -->
	<div
		class="sticky bottom-4 mt-8 flex items-center justify-between gap-3 rounded-2xl border p-3 shadow-xl
			{isDarkMode
				? 'border-zinc-800 bg-zinc-900/95 backdrop-blur'
				: 'border-zinc-200 bg-white/95 backdrop-blur'}"
	>
		<p class="max-w-[70%] text-xs {isDarkMode ? 'text-zinc-400' : 'text-zinc-500'}">
			{#if preferred.length === 0}
				No sources selected — multi-source homepage will be empty. Use the source dropdown to
				browse a single source.
			{:else}
				{preferred.length} source{preferred.length === 1 ? '' : 's'} will be shown on the homepage
				({selectedKind}).
			{/if}
		</p>
		<button
			onclick={save}
			class="shrink-0 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition
				hover:bg-red-500 active:scale-95"
		>
			{saved ? 'Saved ✓' : 'Save'}
		</button>
	</div>

	<!-- Limit toast overlay -->
	{#if showLimitToast}
		<div
			class="pointer-events-none fixed inset-0 z-[200] flex items-end justify-center p-6 sm:items-center"
		>
			<div
				class="pointer-events-auto flex max-w-sm items-start gap-3 rounded-2xl border px-4 py-3 shadow-2xl
					{isDarkMode
					? 'border-amber-500/40 bg-zinc-900 text-amber-100'
					: 'border-amber-300 bg-white text-amber-900'}"
				role="status"
			>
				<div class="rounded-lg bg-amber-500/20 p-2">
					<AlertTriangle class="h-5 w-5 text-amber-500" />
				</div>
				<div class="min-w-0 flex-1">
					<p class="text-sm font-semibold">Limit reached</p>
					<p class="mt-0.5 text-xs opacity-80">
						You can only select up to {MAX_PREFERRED} sources for the homepage. Uncheck one to
						add another.
					</p>
				</div>
			</div>
		</div>
	{/if}

	<!-- Age Gate Modal (R18 preferred source) -->
	{#if showAgeGate}
		<div
			class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			aria-labelledby="age-gate-title"
		>
			<div class="w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
				<div class="mb-4 flex items-center justify-center">
					<span class="rounded-lg bg-red-600 px-3 py-1 text-sm font-bold tracking-wide text-white"
						>R18</span
					>
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
</div>
