<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { chapterHref } from '$lib/utils/novelSources';
	import {
		History,
		Trash2,
		BookOpen,
		Clock,
		RefreshCw,
		HardDrive,
		Database,
		Info
	} from 'lucide-svelte';
	import {
		getHistory,
		clearHistory,
		removeFromHistory,
		whenHistoryReady,
		isHistoryReady,
		type ReadingEntry
	} from '$lib/stores/history';
	import {
		getPreferences,
		setPreferences,
		subscribePreferences,
		type HistoryStorageMode
	} from '$lib/stores/preferences';
	import {
		getCachedPermanentStats,
		loadPermanentStats
	} from '$lib/stores/permanentStats';
	import type { PermanentStatsDoc } from '$lib/db';
	import { proxyImage } from '$lib/utils/image';
	import {
		supportsFileSystemAccess,
		getRootFolderName,
		getHistorySubdirName
	} from '$lib/utils/localFs';

	let history = $state<ReadingEntry[]>([]);
	let refreshing = $state(false);
	let ready = $state(false);
	let storageMode = $state<HistoryStorageMode>(getPreferences().historyStorageMode || 'cache');
	let fsSupported = $state(false);
	let stats = $state<PermanentStatsDoc | null>(null);

	const diskPathLabel = $derived(`${getRootFolderName()}/${getHistorySubdirName()}/`);

	function normalizeId(id: string): string {
		let s = String(id || '').trim();
		if (!s) return '';
		if (!s.startsWith('/')) s = '/' + s;
		return s.replace(/\/+$/, '') || '/';
	}

	/** Fallback when history stored chapterNumber=0 (common for novels). */
	function extractChapterNum(entry: ReadingEntry): number {
		const direct = Number(entry.chapterNumber);
		if (Number.isFinite(direct) && direct > 0) return Math.round(direct * 10) / 10;
		const tryParse = (s: string): number => {
			const t = String(s || '').replace(/\s+/g, ' ').trim();
			if (!t) return 0;
			let m = t.match(/(?:^|\/|[-_])(?:chapter|ch\.?|episode|ep\.?|bab)[-_.]?\s*(\d+(?:\.\d+)?)/i);
			if (m) {
				const n = parseFloat(m[1]);
				if (Number.isFinite(n) && n > 0) return Math.round(n * 10) / 10;
			}
			m = t.match(/\b(?:chapter|ch\.?|episode|ep\.?|bab|part|arc)\s*[.\-_]?\s*(\d+(?:\.\d+)?)/i);
			if (m) {
				const n = parseFloat(m[1]);
				if (Number.isFinite(n) && n > 0) return Math.round(n * 10) / 10;
			}
			m = t.match(/(?:^|[-_\/])(\d+(?:\.\d+)?)(?:\s*$|\.[a-z]+$)/i);
			if (m) {
				const n = parseFloat(m[1]);
				if (Number.isFinite(n) && n > 0 && n < 100000) return Math.round(n * 10) / 10;
			}
			if (/^\d+(?:\.\d+)?$/.test(t)) {
				const n = parseFloat(t);
				if (Number.isFinite(n) && n > 0) return Math.round(n * 10) / 10;
			}
			return 0;
		};
		return tryParse(entry.chapterTitle || '') || tryParse(entry.chapterId || '') || 0;
	}

	function progressPct(entry: ReadingEntry): number {
		const ch = extractChapterNum(entry);
		if (ch <= 0) return 0;
		const key = normalizeId(entry.mangaId);
		const max = Number(stats?.titles?.[key]?.maxChapter) || ch;
		const denom = Math.max(max, ch, 1);
		return Math.min(100, Math.round((ch / denom) * 100));
	}

	function progressLabel(entry: ReadingEntry): string {
		const ch = extractChapterNum(entry);
		const key = normalizeId(entry.mangaId);
		const max = Number(stats?.titles?.[key]?.maxChapter) || 0;
		if (ch > 0 && max > 0 && max !== ch) {
			return `Ch. ${ch} / ${max}`;
		}
		if (ch > 0) return `Ch. ${ch}`;
		return entry.chapterTitle || 'Read';
	}

	function loadHistory() {
		try {
			history = getHistory() || [];
		} catch (e) {
			console.warn('[history page] loadHistory', e);
			history = [];
		}
	}

	async function handleRefresh() {
		refreshing = true;
		try {
			loadHistory();
			try {
				stats = await loadPermanentStats();
			} catch {
				stats = getCachedPermanentStats();
			}
			await new Promise((r) => setTimeout(r, 120));
		} finally {
			refreshing = false;
		}
	}

	function setStorageMode(mode: HistoryStorageMode) {
		if (mode === 'disk' && !fsSupported) {
			alert('Local disk requires a browser with File System Access API (Chrome / Edge).');
			return;
		}
		storageMode = mode;
		setPreferences({ historyStorageMode: mode });
	}

	onMount(() => {
		let cancelled = false;
		fsSupported = supportsFileSystemAccess();
		storageMode = getPreferences().historyStorageMode || 'cache';
		stats = getCachedPermanentStats();

		loadHistory();
		ready = isHistoryReady();

		void loadPermanentStats()
			.then((s) => {
				if (!cancelled) stats = s;
			})
			.catch(() => {});

		if (!ready) {
			(async () => {
				try {
					await whenHistoryReady();
				} catch {
					/* ignore */
				}
				if (!cancelled) {
					ready = true;
					loadHistory();
				}
			})();
		}

		const onChanged = () => {
			if (!cancelled) loadHistory();
		};
		window.addEventListener('history-changed', onChanged);

		const unsub = subscribePreferences((p) => {
			if (!cancelled) storageMode = p.historyStorageMode || 'cache';
		});

		return () => {
			cancelled = true;
			window.removeEventListener('history-changed', onChanged);
			unsub();
		};
	});

	async function handleClear() {
		if (!confirm('Clear all reading history?')) return;
		const prev = history;
		history = [];
		try {
			await clearHistory();
		} catch (e) {
			console.error(e);
			history = prev;
			loadHistory();
		}
	}

	async function handleRemove(mangaId: string) {
		history = history.filter((h) => h.mangaId !== mangaId);
		try {
			await removeFromHistory(mangaId);
		} catch (e) {
			console.error(e);
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

		if (days > 0) return `${days}d ago`;
		if (hours > 0) return `${hours}h ago`;
		if (minutes > 0) return `${minutes}m ago`;
		return 'Just now';
	}
</script>

<svelte:head>
	<title>My History</title>
</svelte:head>

<div class="mx-auto max-w-7xl p-4 md:p-6">
	<!-- Header -->
	<div
		class="mb-5 flex flex-col gap-3 border-b border-[var(--border-color)] pb-4 sm:flex-row sm:items-end sm:justify-between"
	>
		<div>
			<h1 class="text-xl font-bold text-[var(--text-primary)]">Reading History</h1>
			<p class="mt-0.5 text-sm text-[var(--text-secondary)]">
				{#if ready}
					{history.length} entries
					{#if storageMode === 'disk'}
						· <span class="text-emerald-600 dark:text-emerald-400">unlimited (disk)</span>
					{:else}
						· <span class="text-zinc-500">max 80 (cache)</span>
					{/if}
				{:else}
					Loading…
				{/if}
			</p>
		</div>

		<div class="flex flex-wrap items-center gap-2">
			<button
				type="button"
				onclick={handleRefresh}
				disabled={refreshing}
				class="flex items-center gap-2 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-sm
					text-[var(--text-secondary)] transition hover:bg-[var(--hover-bg)] disabled:opacity-50"
				title="Refresh"
			>
				<RefreshCw class="h-4 w-4 {refreshing ? 'animate-spin' : ''}" />
				Refresh
			</button>
			{#if history.length > 0}
				<button
					type="button"
					onclick={handleClear}
					class="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-red-500 transition
						hover:bg-red-500/10 hover:text-red-400"
				>
					<Trash2 class="h-4 w-4" />
					Clear All
				</button>
			{/if}
		</div>
	</div>

	<!-- Storage info card -->
	<div
		class="mb-6 rounded-xl border border-amber-500/25 bg-amber-50/80 px-4 py-3.5
			dark:border-amber-500/20 dark:bg-amber-950/30"
	>
		<div class="flex gap-2.5">
			<Info class="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
			<div class="min-w-0 flex-1 space-y-2">
				<p class="text-sm font-semibold text-amber-900 dark:text-amber-100">
					Where is history stored?
				</p>
				<p class="text-xs leading-relaxed text-amber-900/80 dark:text-amber-100/75">
					<span class="font-semibold">Browser cache</span>
					keeps reading history in IndexedDB on this device only (max 80 titles). Covers stay as remote
					URLs. Fast and private to the browser profile.
				</p>
				<p class="text-xs leading-relaxed text-amber-900/80 dark:text-amber-100/75">
					<span class="font-semibold">Local disk (offline)</span>
					also writes
					<code class="rounded bg-black/10 px-1 py-0.5 text-[10px] dark:bg-white/10">history.json</code>
					and cover files under
					<code class="rounded bg-black/10 px-1 py-0.5 text-[10px] dark:bg-white/10">{diskPathLabel}</code>.
					<span class="font-semibold">No 80-title limit</span>
					— useful for long-term offline progress. Requires Chrome/Edge and a folder grant.
				</p>

				<div class="flex flex-wrap items-center gap-2 pt-1">
					<button
						type="button"
						onclick={() => setStorageMode('cache')}
						class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition
							{storageMode === 'cache'
							? 'border-zinc-400 bg-white text-zinc-900 shadow-sm dark:border-zinc-500 dark:bg-zinc-800 dark:text-zinc-100'
							: 'border-transparent bg-white/50 text-zinc-600 hover:bg-white dark:bg-zinc-900/40 dark:text-zinc-400 dark:hover:bg-zinc-800'}"
					>
						<Database class="h-3.5 w-3.5" />
						Browser cache (max 80)
					</button>
					<button
						type="button"
						onclick={() => setStorageMode('disk')}
						disabled={!fsSupported}
						class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition
							{storageMode === 'disk'
							? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-800 shadow-sm dark:text-emerald-300'
							: 'border-transparent bg-white/50 text-zinc-600 hover:bg-white dark:bg-zinc-900/40 dark:text-zinc-400 dark:hover:bg-zinc-800'}
							disabled:cursor-not-allowed disabled:opacity-40"
					>
						<HardDrive class="h-3.5 w-3.5" />
						Local disk (unlimited)
					</button>
					{#if storageMode === 'disk'}
						<span class="text-[11px] text-emerald-700 dark:text-emerald-400">
							{history.length} titles · no 80 cap · offline JSON
						</span>
					{:else}
						<span class="text-[11px] text-zinc-500">
							{history.length} / 80 titles · IndexedDB only
						</span>
					{/if}
				</div>
			</div>
		</div>
	</div>

	<!-- List -->
	{#if !ready}
		<div class="flex flex-col items-center justify-center py-24 text-zinc-500">
			<History class="mb-3 h-10 w-10 opacity-40" />
			<p class="text-sm">Loading history…</p>
		</div>
	{:else if history.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-zinc-500">
			<History class="mb-3 h-10 w-10 opacity-40" />
			<p class="text-sm">No reading history yet.</p>
		</div>
	{:else}
		<ul class="grid grid-cols-1 gap-2 lg:grid-cols-2 lg:gap-3">
			{#each history as entry (entry.mangaId + '-' + entry.timestamp)}
				{@const mangaHref = `/manga/${entry.sourceId}${entry.mangaId}`}
				{@const readHref = chapterHref(entry.sourceId, entry.chapterId)}
				{@const pct = progressPct(entry)}
				<li
					class="history-row group flex gap-3 rounded-xl border border-[var(--border-color)]
						bg-[var(--card-bg,transparent)] p-2.5 transition hover:border-zinc-400 dark:hover:border-zinc-600
						sm:gap-4 sm:p-3"
				>
					<!-- Cover -->
					<a
						href={mangaHref}
						onclick={(e) => handleNavigate(e, mangaHref)}
						class="relative h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-zinc-200 dark:bg-zinc-800 sm:h-24 sm:w-[4.25rem]"
					>
						{#if entry.cover}
							<img
								src={proxyImage(entry.cover, entry.sourceId, 120)}
								onerror={(e) => {
									(e.currentTarget as HTMLImageElement).style.opacity = '0';
								}}
								alt=""
								class="h-full w-full object-cover"
								loading="lazy"
								decoding="async"
							/>
						{:else}
							<div class="flex h-full w-full items-center justify-center">
								<BookOpen class="h-6 w-6 text-zinc-400" />
							</div>
						{/if}
					</a>

					<!-- Body -->
					<div class="min-w-0 flex-1">
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0">
								<a
									href={mangaHref}
									onclick={(e) => handleNavigate(e, mangaHref)}
									class="line-clamp-1 text-sm font-semibold text-[var(--text-primary)] transition hover:opacity-80"
									title={entry.mangaTitle}
								>
									{entry.mangaTitle}
								</a>
								<a
									href={readHref}
									onclick={(e) => handleNavigate(e, readHref)}
									class="mt-0.5 line-clamp-1 text-xs text-[var(--color-primary)] transition hover:opacity-80"
									title={entry.chapterTitle}
								>
									{entry.chapterTitle}
								</a>
							</div>

							<button
								type="button"
								onclick={() => handleRemove(entry.mangaId)}
								class="shrink-0 rounded-lg p-1.5 text-zinc-400 transition hover:bg-red-500/10 hover:text-red-500"
								title="Remove"
							>
								<Trash2 class="h-4 w-4" />
							</button>
						</div>

						<!-- Progress bar -->
						<div class="mt-2.5">
							<div class="mb-1 flex items-center justify-between gap-2 text-[10px]">
								<span class="font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
									{progressLabel(entry)}
								</span>
								<span class="history-progress-pct tabular-nums font-semibold">{pct}%</span>
							</div>
							<div
								class="history-progress-track h-1 w-full overflow-hidden rounded-full"
								role="progressbar"
								aria-valuenow={pct}
								aria-valuemin={0}
								aria-valuemax={100}
							>
								<div
									class="history-progress-fill h-full rounded-full transition-[width] duration-500 ease-out"
									style="width: {pct}%"
								></div>
							</div>
						</div>

						<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-500">
							<span
								class="rounded-md bg-zinc-100 px-1.5 py-0.5 font-semibold capitalize text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
							>
								{entry.sourceId}
							</span>
							<span class="flex items-center gap-1">
								<Clock class="h-3 w-3" />
								{formatTime(entry.timestamp)}
							</span>
							<a
								href={readHref}
								onclick={(e) => handleNavigate(e, readHref)}
								class="font-medium text-violet-600 hover:underline dark:text-violet-400"
							>
								Continue reading →
							</a>
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.history-row {
		content-visibility: auto;
		contain-intrinsic-size: auto 100px;
	}


	.history-progress-track {
		background: color-mix(in srgb, var(--accent, #7c3aed) 18%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent, #7c3aed) 22%, transparent);
	}

	.history-progress-fill {
		background: var(--accent, #7c3aed);
		background-image: linear-gradient(
			90deg,
			var(--accent, #7c3aed) 0%,
			color-mix(in srgb, var(--accent, #7c3aed) 75%, white) 100%
		);
		box-shadow: 0 0 6px color-mix(in srgb, var(--accent, #7c3aed) 35%, transparent);
		min-width: 0;
	}

	.history-progress-fill[style*='width: 0%'] {
		box-shadow: none;
	}

	.history-progress-pct {
		color: var(--accent, #7c3aed);
	}
</style>
