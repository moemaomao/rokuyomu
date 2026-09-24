<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getUser, isLoading } from '$lib/stores/auth.svelte';
	import { isAdmin } from '$lib/admin';
	import { auth, db } from '$lib/firebase';
	import { collection, onSnapshot, query } from 'firebase/firestore';
	import { isBrokenSource } from '$lib/stores/brokenSources.svelte';
	import { groupSourcesByLang, LANG_LABELS, getSourceMeta } from '$lib/utils/sourceMeta';
	import { isNovelSource } from '$lib/utils/novelSources';
	import {
		Shield,
		Eye,
		EyeOff,
		Loader2,
		Search,
		RefreshCw,
		CheckCircle2,
		XCircle,
		AlertTriangle,
		BookMarked,
		BookOpen
	} from 'lucide-svelte';

	type SourceRow = { id: string; name: string; enabled: boolean };
	type ContentKind = 'comic' | 'novel';

	let {
		data
	}: {
		data: { sources: SourceRow[]; disabledIds: string[] };
	} = $props();

	let sources = $state<SourceRow[]>([]);
	let loading = $state(false);
	let toggling = $state<Record<string, boolean>>({});
	let errorMsg = $state('');
	let successMsg = $state('');
	let search = $state('');
	let filter = $state<'all' | 'enabled' | 'disabled' | 'reported'>('all');
	let selectedKind = $state<ContentKind>('comic');
	let authChecked = $state(false);
	let reportCountMap = $state<Record<string, number>>({});

	function norm(id: string): string {
		return String(id || '')
			.toLowerCase()
			.replace(/[^a-z0-9]/g, '');
	}

	function reportCount(id: string): number {
		return reportCountMap[norm(id)] ?? 0;
	}

	function hasReport(id: string): boolean {
		return reportCount(id) > 0 || isBrokenSource(id);
	}

	$effect.pre(() => {
		if (sources.length === 0 && data?.sources?.length) {
			sources = [...data.sources];
		}
	});

	const user = $derived(getUser());
	const admin = $derived(isAdmin(user?.uid));

	const kindFiltered = $derived.by(() => {
		return sources.filter((s) => {
			const novel = isNovelSource(s.id);
			return selectedKind === 'novel' ? novel : !novel;
		});
	});

	const filtered = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return kindFiltered.filter((s) => {
			if (filter === 'enabled' && !s.enabled) return false;
			if (filter === 'disabled' && s.enabled) return false;
			if (filter === 'reported' && !hasReport(s.id)) return false;
			if (!q) return true;
			return s.id.includes(q) || s.name.toLowerCase().includes(q);
		});
	});

	const grouped = $derived(groupSourcesByLang(filtered));

	const enabledCount = $derived(kindFiltered.filter((s) => s.enabled).length);
	const disabledCount = $derived(kindFiltered.filter((s) => !s.enabled).length);
	const reportedCount = $derived(kindFiltered.filter((s) => hasReport(s.id)).length);
	const kindTotal = $derived(kindFiltered.length);

	onMount(() => {
		if (data?.sources?.length && sources.length === 0) {
			sources = [...data.sources];
		}
		const t = setInterval(() => {
			if (!isLoading()) {
				authChecked = true;
				clearInterval(t);
			}
		}, 80);

		let unsub: (() => void) | undefined;
		if (db) {
			try {
				const qReports = query(collection(db, 'reports'));
				unsub = onSnapshot(
					qReports,
					(snap) => {
						const counts: Record<string, number> = {};
						for (const d of snap.docs) {
							const r = d.data() as {
								type?: string;
								status?: string;
								sourceId?: string | null;
							};
							if (
								(r.type === 'broken_source' || r.type === 'bug') &&
								(r.status === 'open' || r.status === 'in_progress') &&
								r.sourceId
							) {
								const key = norm(r.sourceId);
								counts[key] = (counts[key] || 0) + 1;
							}
						}
						reportCountMap = counts;
					},
					(err) => console.warn('[admin reports]', err)
				);
			} catch (e) {
				console.warn('[admin reports] init failed', e);
			}
		}

		return () => {
			clearInterval(t);
			unsub?.();
		};
	});

	async function getIdToken(): Promise<string | null> {
		const u = getUser();
		if (!u || !auth) return null;
		try {
			return await u.getIdToken(true);
		} catch {
			return null;
		}
	}

	type ApiListResponse = {
		sources?: SourceRow[];
		error?: string;
		disabledIds?: string[];
	};

	type ApiToggleResponse = {
		ok?: boolean;
		error?: string;
		disabledIds?: string[];
	};

	async function refresh() {
		loading = true;
		errorMsg = '';
		try {
			const token = await getIdToken();
			if (!token) throw new Error('Not authenticated');
			const res = await fetch('/api/admin/sources', {
				headers: { Authorization: `Bearer ${token}` }
			});
			const body = (await res.json()) as ApiListResponse;
			if (!res.ok) throw new Error(body.error || res.statusText);
			sources = body.sources ?? [];
			successMsg = 'Refreshed';
			setTimeout(() => (successMsg = ''), 2000);
		} catch (e: unknown) {
			errorMsg = e instanceof Error ? e.message : 'Failed to refresh';
		} finally {
			loading = false;
		}
	}

	async function toggle(sourceId: string, enabled: boolean) {
		toggling[sourceId] = true;
		errorMsg = '';
		successMsg = '';
		try {
			const token = await getIdToken();
			if (!token) throw new Error('Not authenticated');
			const res = await fetch('/api/admin/sources', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ sourceId, enabled })
			});
			const body = (await res.json()) as ApiToggleResponse;
			if (!res.ok) throw new Error(body.error || res.statusText);

			sources = sources.map((s) => (s.id === sourceId ? { ...s, enabled } : s));
			successMsg = `${sourceId} → ${enabled ? 'ditampilkan' : 'disembunyikan'}`;
			setTimeout(() => (successMsg = ''), 2500);
		} catch (e: unknown) {
			errorMsg = e instanceof Error ? e.message : 'Toggle failed';
		} finally {
			toggling[sourceId] = false;
		}
	}

	async function bulkSet(enable: boolean) {
		const targets = filtered.filter((s) => s.enabled !== enable);
		if (targets.length === 0) return;
		if (
			!confirm(
				`${enable ? 'Tampilkan' : 'Sembunyikan'} ${targets.length} source yang terfilter?`
			)
		) {
			return;
		}

		loading = true;
		errorMsg = '';
		try {
			const token = await getIdToken();
			if (!token) throw new Error('Not authenticated');

			const disabled = new Set(sources.filter((s) => !s.enabled).map((s) => s.id));
			for (const t of targets) {
				if (enable) disabled.delete(t.id);
				else disabled.add(t.id);
			}

			const res = await fetch('/api/admin/sources', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ disabledIds: [...disabled] })
			});
			const body = (await res.json()) as ApiToggleResponse;
			if (!res.ok) throw new Error(body.error || res.statusText);

			const disSet = new Set((body.disabledIds ?? []).map((x) => x.toLowerCase()));
			sources = sources.map((s) => ({
				...s,
				enabled: !disSet.has(s.id.toLowerCase())
			}));
			successMsg = `Updated ${targets.length} sources`;
			setTimeout(() => (successMsg = ''), 2500);
		} catch (e: unknown) {
			errorMsg = e instanceof Error ? e.message : 'Bulk update failed';
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Admin — Source Management | Rokuyomu</title>
</svelte:head>

<div class="mx-auto max-w-4xl p-4 md:p-6">
	{#if !authChecked || isLoading()}
		<div class="flex items-center justify-center gap-2 py-24 text-zinc-500">
			<Loader2 class="h-5 w-5 animate-spin" />
			<span class="text-sm">Checking access…</span>
		</div>
	{:else if !user || !admin}
		<div
			class="rounded-xl border border-zinc-200 bg-zinc-50 p-8 text-center dark:border-zinc-800 dark:bg-zinc-900/50"
		>
			<Shield class="mx-auto mb-3 h-10 w-10 text-zinc-400" />
			<h1 class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Admin only</h1>
			<p class="mt-2 text-sm text-zinc-500">
				Login dengan akun admin untuk mengakses Source Management.
			</p>
			<button
				type="button"
				class="mt-4 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
				onclick={() => goto('/')}
			>
				Kembali ke Home
			</button>
		</div>
	{:else}
		<div
			class="mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800"
		>
			<div>
				<h1
					class="flex items-center gap-2 text-xl font-bold text-zinc-900 md:text-2xl dark:text-zinc-100"
				>
					<Shield class="h-6 w-6 text-violet-600 dark:text-violet-400" />
					Source Management
				</h1>
				<p class="mt-1 text-xs text-zinc-500">
					Hide / tampilkan source. Badge ERROR = report user aktif.
				</p>
			</div>
			<button
				type="button"
				class="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
				onclick={refresh}
				disabled={loading}
			>
				<RefreshCw class="h-4 w-4 {loading ? 'animate-spin' : ''}" />
				Refresh
			</button>
		</div>

		<!-- Comic | Novel switch (sama seperti Settings) -->
		<div
			class="mb-5 flex w-full max-w-xs overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-700 dark:bg-zinc-900"
		>
			<button
				type="button"
				onclick={() => (selectedKind = 'comic')}
				class="flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition
					{selectedKind === 'comic'
					? 'bg-violet-600 text-white shadow'
					: 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'}"
			>
				<BookMarked class="h-4 w-4" />
				Comic
			</button>
			<button
				type="button"
				onclick={() => (selectedKind = 'novel')}
				class="flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition
					{selectedKind === 'novel'
					? 'bg-amber-600 text-white shadow'
					: 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'}"
			>
				<BookOpen class="h-4 w-4" />
				Novel
			</button>
		</div>

		<!-- Stats -->
		<div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
			<div
				class="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900/60"
			>
				<div class="text-xs text-zinc-500">
					{selectedKind === 'novel' ? 'Novel' : 'Comic'}
				</div>
				<div class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{kindTotal}</div>
			</div>
			<div
				class="rounded-lg border border-emerald-200/60 bg-emerald-50/50 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/30"
			>
				<div class="text-xs text-emerald-600 dark:text-emerald-400">Enabled</div>
				<div class="text-lg font-semibold text-emerald-700 dark:text-emerald-300">
					{enabledCount}
				</div>
			</div>
			<div
				class="rounded-lg border border-red-200/60 bg-red-50/50 p-3 dark:border-red-900/40 dark:bg-red-950/30"
			>
				<div class="text-xs text-red-600 dark:text-red-400">Hidden</div>
				<div class="text-lg font-semibold text-red-700 dark:text-red-300">
					{disabledCount}
				</div>
			</div>
			<div
				class="rounded-lg border border-amber-200/60 bg-amber-50/50 p-3 dark:border-amber-900/40 dark:bg-amber-950/30"
			>
				<div class="text-xs text-amber-600 dark:text-amber-400">Reported</div>
				<div class="text-lg font-semibold text-amber-700 dark:text-amber-300">
					{reportedCount}
				</div>
			</div>
		</div>

		{#if errorMsg}
			<div
				class="mb-3 flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
			>
				<XCircle class="h-4 w-4 shrink-0" />
				{errorMsg}
			</div>
		{/if}
		{#if successMsg}
			<div
				class="mb-3 flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
			>
				<CheckCircle2 class="h-4 w-4 shrink-0" />
				{successMsg}
			</div>
		{/if}

		<!-- Search + filters -->
		<div class="mb-4 flex flex-wrap items-center gap-2">
			<div class="relative min-w-[200px] flex-1">
				<Search
					class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
				/>
				<input
					type="search"
					placeholder="Cari id / nama…"
					bind:value={search}
					class="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
				/>
			</div>
			<div
				class="flex flex-wrap items-center gap-1 rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700"
			>
				{#each (['all', 'enabled', 'disabled', 'reported'] as const) as f}
					<button
						type="button"
						class="rounded-md px-2.5 py-1.5 text-xs font-medium transition
							{filter === f
							? f === 'reported'
								? 'bg-amber-600 text-white'
								: 'bg-violet-600 text-white'
							: 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'}"
						onclick={() => (filter = f)}
					>
						{f === 'all'
							? 'All'
							: f === 'enabled'
								? 'Enabled'
								: f === 'disabled'
									? 'Hidden'
									: 'Reported'}
					</button>
				{/each}
			</div>
			<button
				type="button"
				class="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
				onclick={() => bulkSet(true)}
				disabled={loading}
			>
				Enable filtered
			</button>
			<button
				type="button"
				class="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
				onclick={() => bulkSet(false)}
				disabled={loading}
			>
				Hide filtered
			</button>
		</div>

		<!-- Grouped by language (seperti Settings) -->
		{#if Object.keys(grouped).length === 0}
			<div class="py-12 text-center text-sm text-zinc-500">Tidak ada source yang cocok.</div>
		{:else}
			<div class="space-y-5">
				{#each Object.entries(grouped) as [langKey, items]}
					<section>
						<div
							class="mb-2 flex items-center gap-2 border-b border-zinc-200 pb-1.5 dark:border-zinc-800"
						>
							<span class="text-xs font-bold uppercase tracking-wider text-zinc-500">
								{LANG_LABELS[langKey] || langKey}
							</span>
							<span class="text-[10px] text-zinc-400">({items.length})</span>
						</div>
						<div
							class="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800"
						>
							<table class="w-full text-left text-sm">
								<tbody class="divide-y divide-zinc-100 dark:divide-zinc-800/80">
									{#each items as s (s.id)}
										{@const reports = reportCount(s.id)}
										{@const broken = hasReport(s.id)}
										{@const meta = getSourceMeta(s.id)}
										<tr
											class="bg-white transition hover:bg-zinc-50 dark:bg-zinc-950/40 dark:hover:bg-zinc-900/60
												{broken ? 'bg-amber-50/40 dark:bg-amber-950/20' : ''}"
										>
											<td class="px-3 py-2.5">
												<div class="flex flex-wrap items-center gap-2">
													<span class="fi fi-{meta.flag} rounded-sm text-sm"></span>
													<span class="font-medium text-zinc-900 dark:text-zinc-100"
														>{s.name}</span
													>
													{#if meta.isR18}
														<span
															class="rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-bold text-white"
															>R18</span
														>
													{/if}
													{#if broken}
														<span
															class="inline-flex items-center gap-1 rounded-full border border-amber-400/60 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:border-amber-500/40 dark:text-amber-400"
														>
															<AlertTriangle class="h-3 w-3" />
															Error
															{#if reports > 0}
																<span
																	class="ml-0.5 rounded-full bg-amber-600 px-1.5 text-[9px] font-bold text-white dark:bg-amber-500"
																>
																	{reports}
																</span>
															{/if}
														</span>
													{/if}
												</div>
												<div class="font-mono text-xs text-zinc-500">{s.id}</div>
											</td>
											<td class="w-28 px-3 py-2.5">
												{#if s.enabled}
													<span
														class="inline-flex items-center gap-1 rounded-full border border-emerald-300/60 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
													>
														<Eye class="h-3 w-3" /> Visible
													</span>
												{:else}
													<span
														class="inline-flex items-center gap-1 rounded-full border border-red-300/60 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300"
													>
														<EyeOff class="h-3 w-3" /> Hidden
													</span>
												{/if}
											</td>
											<td class="w-24 px-3 py-2.5 text-right">
												<button
													type="button"
													class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50
														{s.enabled
														? 'border border-red-300/70 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40'
														: 'border border-emerald-300/70 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/40'}"
													disabled={!!toggling[s.id] || loading}
													onclick={() => toggle(s.id, !s.enabled)}
												>
													{#if toggling[s.id]}
														<Loader2 class="h-3.5 w-3.5 animate-spin" />
													{:else if s.enabled}
														<EyeOff class="h-3.5 w-3.5" /> Hide
													{:else}
														<Eye class="h-3.5 w-3.5" /> Show
													{/if}
												</button>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</section>
				{/each}
			</div>
		{/if}

		<p class="mt-4 text-xs text-zinc-500">
			Switch <strong>Comic / Novel</strong> seperti Settings. Source dikelompokkan per bahasa
			(Indonesian, English, dll). Badge ERROR dari report user (open / in progress).
		</p>
	{/if}
</div>
