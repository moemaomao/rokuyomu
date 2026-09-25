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
		BookOpen,
		StickyNote,
		Activity,
		ExternalLink
	} from 'lucide-svelte';

	type SourceRow = { id: string; name: string; enabled: boolean; note?: string };
	type ContentKind = 'comic' | 'novel';
	type HealthStatus = 'idle' | 'loading' | 'healthy' | 'empty' | 'timeout' | 'error';
	type HealthInfo = { status: HealthStatus; ms?: number; message?: string; count?: number };

	let {
		data
	}: {
		data: {
			sources: SourceRow[];
			disabledIds: string[];
			notes?: Record<string, string>;
		};
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
	let openReportTotal = $state(0);

	/** notes draft while editing */
	let editingNoteId = $state<string | null>(null);
	let noteDraft = $state('');
	let savingNote = $state(false);

	/** health check results */
	let healthMap = $state<Record<string, HealthInfo>>({});
	let healthRunning = $state(false);

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
			sources = data.sources.map((s) => ({
				...s,
				note: s.note ?? data.notes?.[s.id.toLowerCase()] ?? ''
			}));
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
			const note = (s.note || '').toLowerCase();
			return s.id.includes(q) || s.name.toLowerCase().includes(q) || note.includes(q);
		});
	});

	const grouped = $derived(groupSourcesByLang(filtered));

	const enabledCount = $derived(kindFiltered.filter((s) => s.enabled).length);
	const disabledCount = $derived(kindFiltered.filter((s) => !s.enabled).length);
	const reportedCount = $derived(kindFiltered.filter((s) => hasReport(s.id)).length);
	const kindTotal = $derived(kindFiltered.length);
	const notesCount = $derived(sources.filter((s) => (s.note || '').trim()).length);
	const allDisabledCount = $derived(sources.filter((s) => !s.enabled).length);
	const allReportedCount = $derived(sources.filter((s) => hasReport(s.id)).length);

	onMount(() => {
		if (data?.sources?.length && sources.length === 0) {
			sources = data.sources.map((s) => ({
				...s,
				note: s.note ?? data.notes?.[s.id.toLowerCase()] ?? ''
			}));
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
						let openTotal = 0;
						for (const d of snap.docs) {
							const r = d.data() as {
								type?: string;
								status?: string;
								sourceId?: string | null;
							};
							const isOpen =
								(r.type === 'broken_source' || r.type === 'bug') &&
								(r.status === 'open' || r.status === 'in_progress');
							if (isOpen) {
								openTotal += 1;
								if (r.sourceId) {
									const key = norm(r.sourceId);
									counts[key] = (counts[key] || 0) + 1;
								}
							}
						}
						reportCountMap = counts;
						openReportTotal = openTotal;
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
		notes?: Record<string, string>;
	};

	type ApiToggleResponse = {
		ok?: boolean;
		error?: string;
		disabledIds?: string[];
		note?: string;
		notes?: Record<string, string>;
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
			sources = (body.sources ?? []).map((s) => ({
				...s,
				note: s.note ?? body.notes?.[s.id.toLowerCase()] ?? ''
			}));
			successMsg = 'Refreshed';
			setTimeout(() => (successMsg = ''), 2000);
		} catch (e: unknown) {
			errorMsg = e instanceof Error ? e.message : 'Failed to refresh';
		} finally {
			loading = false;
		}
	}

		async function toggle(sourceId: string, enabled: boolean) {
		toggling = { ...toggling, [sourceId]: true };
		errorMsg = '';
		successMsg = '';
		try {
			const token = await getIdToken();
			if (!token) throw new Error('Not authenticated — login ulang');
			const res = await fetch('/api/admin/sources', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ sourceId, enabled })
			});
			const body = (await res.json()) as ApiToggleResponse;
			if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);

			sources = sources.map((s) => (s.id === sourceId ? { ...s, enabled } : s));
			successMsg = `${sourceId} → ${enabled ? 'ditampilkan' : 'disembunyikan'}`;
			setTimeout(() => (successMsg = ''), 2500);
		} catch (e: unknown) {
			errorMsg = e instanceof Error ? e.message : 'Toggle failed';
			console.error('[admin toggle]', sourceId, e);
		} finally {
			toggling = { ...toggling, [sourceId]: false };
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

	function openNoteEditor(s: SourceRow) {
		editingNoteId = s.id;
		noteDraft = s.note || '';
	}

	function cancelNote() {
		editingNoteId = null;
		noteDraft = '';
	}

	async function saveNote(sourceId: string) {
		savingNote = true;
		errorMsg = '';
		try {
			const token = await getIdToken();
			if (!token) throw new Error('Not authenticated');
			const res = await fetch('/api/admin/sources', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ action: 'note', sourceId, note: noteDraft })
			});
			const body = (await res.json()) as ApiToggleResponse;
			if (!res.ok) throw new Error(body.error || res.statusText);

			const saved = body.note || '';
			sources = sources.map((s) => (s.id === sourceId ? { ...s, note: saved } : s));
			editingNoteId = null;
			noteDraft = '';
			successMsg = `Note saved for ${sourceId}`;
			setTimeout(() => (successMsg = ''), 2000);
		} catch (e: unknown) {
			errorMsg = e instanceof Error ? e.message : 'Save note failed';
		} finally {
			savingNote = false;
		}
	}

	async function runHealth(sourceId: string) {
		healthMap[sourceId] = { status: 'loading' };
		healthMap = { ...healthMap };
		try {
			const token = await getIdToken();
			if (!token) throw new Error('Not authenticated');
			const res = await fetch('/api/admin/health', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ sourceId })
			});
			const body = (await res.json()) as {
				ok?: boolean;
				status?: HealthStatus;
				ms?: number;
				message?: string;
				count?: number;
				error?: string;
			};
			if (!res.ok && !body.status) {
				healthMap[sourceId] = {
					status: 'error',
					message: body.error || res.statusText
				};
			} else {
				healthMap[sourceId] = {
					status: (body.status as HealthStatus) || (body.ok ? 'healthy' : 'error'),
					ms: body.ms,
					message: body.message,
					count: body.count
				};
			}
			healthMap = { ...healthMap };
		} catch (e: unknown) {
			healthMap[sourceId] = {
				status: 'error',
				message: e instanceof Error ? e.message : 'Health check failed'
			};
			healthMap = { ...healthMap };
		}
	}

	async function runHealthFiltered() {
		const targets = filtered.slice(0, 15);
		if (targets.length === 0) return;
		if (!confirm(`Health-check ${targets.length} source (max 15, ~8s timeout each)?`)) return;
		healthRunning = true;
		for (const s of targets) {
			await runHealth(s.id);
		}
		healthRunning = false;
		successMsg = `Health check selesai (${targets.length} source)`;
		setTimeout(() => (successMsg = ''), 2500);
	}

	function goToReports(sourceId: string) {
		goto(`/report?source=${encodeURIComponent(sourceId)}`);
	}

	function healthBadge(h: HealthInfo | undefined) {
		if (!h || h.status === 'idle') return null;
		return h;
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
					Hide source, notes, health check, dan link ke report user.
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

		<!-- Comic | Novel -->
		<div
			class="mb-4 flex w-full max-w-xs overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-700 dark:bg-zinc-900"
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

		<!-- Stats (merged: global + current kind) -->
		<div class="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
					{allDisabledCount}
				</div>
			</div>
			<div
				class="rounded-lg border border-amber-200/60 bg-amber-50/80 p-3 dark:border-amber-900/40 dark:bg-amber-950/30"
			>
				<div class="text-xs text-amber-600 dark:text-amber-400">Report open</div>
				<div class="text-lg font-semibold text-amber-700 dark:text-amber-300">
					{openReportTotal}
				</div>
			</div>
			<div
				class="rounded-lg border border-orange-200/60 bg-orange-50/80 p-3 dark:border-orange-900/40 dark:bg-orange-950/30"
			>
				<div class="text-xs text-orange-600 dark:text-orange-400">Broken</div>
				<div class="text-lg font-semibold text-orange-700 dark:text-orange-300">
					{allReportedCount}
				</div>
			</div>
			<div
				class="rounded-lg border border-sky-200/60 bg-sky-50/80 p-3 dark:border-sky-900/40 dark:bg-sky-950/30"
			>
				<div class="text-xs text-sky-600 dark:text-sky-400">Notes</div>
				<div class="text-lg font-semibold text-sky-700 dark:text-sky-300">
					{notesCount}
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
					placeholder="Cari id / nama / note…"
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
			<button
				type="button"
				class="inline-flex items-center gap-1 rounded-lg border border-sky-300/70 px-2.5 py-1.5 text-xs text-sky-700 hover:bg-sky-50 dark:border-sky-800 dark:text-sky-300 dark:hover:bg-sky-950/40"
				onclick={runHealthFiltered}
				disabled={loading || healthRunning}
			>
				<Activity class="h-3.5 w-3.5 {healthRunning ? 'animate-pulse' : ''}" />
				Health filtered
			</button>
		</div>

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
										{@const h = healthBadge(healthMap[s.id])}
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
														<button
															type="button"
															class="inline-flex items-center gap-1 rounded-full border border-amber-400/60 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 transition hover:bg-amber-500/25 dark:border-amber-500/40 dark:text-amber-400"
															title="Lihat report di /report"
															onclick={() => goToReports(s.id)}
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
															<ExternalLink class="h-2.5 w-2.5 opacity-70" />
														</button>
													{/if}
													{#if h}
														<span
															class="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium
																{h.status === 'healthy'
																? 'border-emerald-400/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
																: h.status === 'loading'
																	? 'border-zinc-400/40 text-zinc-500'
																	: h.status === 'empty'
																		? 'border-amber-400/50 bg-amber-500/10 text-amber-600'
																		: 'border-red-400/50 bg-red-500/10 text-red-600 dark:text-red-400'}"
															title={h.message}
														>
															{#if h.status === 'loading'}
																<Loader2 class="h-3 w-3 animate-spin" />
															{:else}
																<Activity class="h-3 w-3" />
															{/if}
															{h.status === 'loading'
																? '…'
																: h.status === 'healthy'
																	? `${h.ms}ms`
																	: h.status}
														</span>
													{/if}
												</div>
												<div class="font-mono text-xs text-zinc-500">{s.id}</div>
												{#if s.note}
													<div
														class="mt-1 flex items-start gap-1 text-xs text-sky-700 dark:text-sky-300"
													>
														<StickyNote class="mt-0.5 h-3 w-3 shrink-0" />
														<span class="line-clamp-2">{s.note}</span>
													</div>
												{/if}
												{#if editingNoteId === s.id}
													<div class="mt-2 space-y-2">
														<textarea
															bind:value={noteDraft}
															rows="2"
															maxlength="500"
															placeholder="Catatan admin (domain ganti, butuh cookie, dll.)"
															class="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-violet-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
														></textarea>
														<div class="flex gap-2">
															<button
																type="button"
																class="rounded-md bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
																disabled={savingNote}
																onclick={() => saveNote(s.id)}
															>
																{savingNote ? 'Saving…' : 'Save note'}
															</button>
															<button
																type="button"
																class="rounded-md border border-zinc-300 px-2.5 py-1 text-xs dark:border-zinc-600"
																onclick={cancelNote}
															>
																Cancel
															</button>
														</div>
													</div>
												{/if}
											</td>
											<td class="w-28 px-3 py-2.5 align-top">
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
											<td class="w-36 px-3 py-2.5 text-right align-top">
												<div class="flex flex-col items-end gap-1">
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
													<div class="flex gap-1">
														<button
															type="button"
															class="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-[10px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
															title="Edit note"
															onclick={() => openNoteEditor(s)}
														>
															<StickyNote class="h-3 w-3" /> Note
														</button>
														<button
															type="button"
															class="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-[10px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
															title="Health check"
															disabled={healthMap[s.id]?.status === 'loading'}
															onclick={() => runHealth(s.id)}
														>
															{#if healthMap[s.id]?.status === 'loading'}
																<Loader2 class="h-3 w-3 animate-spin" />
															{:else}
																<Activity class="h-3 w-3" />
															{/if}
															Ping
														</button>
													</div>
												</div>
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

		<p class="mt-4 space-y-1 text-xs text-zinc-500">
			<span class="block">
				<strong class="text-amber-600 dark:text-amber-400">ERROR</strong> = klik untuk buka
				<code class="rounded bg-zinc-100 px-1 dark:bg-zinc-800">/report?source=…</code>
			</span>
			<span class="block">
				<strong class="text-sky-600 dark:text-sky-400">Note</strong> tersimpan di KV —
				contoh: “domain ganti”, “butuh cookie”.
			</span>
			<span class="block">
				<strong class="text-emerald-600 dark:text-emerald-400">Ping</strong> = health check
				scraper (timeout 8s).
			</span>
		</p>
	{/if}
</div>
