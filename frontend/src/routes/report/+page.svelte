<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import {
		collection,
		addDoc,
		query,
		orderBy,
		onSnapshot,
		doc,
		updateDoc,
		deleteDoc,
		serverTimestamp,
		type Timestamp
	} from 'firebase/firestore';
	import { db } from '$lib/firebase';
	import { getUser } from '$lib/stores/auth.svelte';
	import { isAdmin } from '$lib/admin';
	import {
		MessageSquarePlus,
		Send,
		Loader2,
		CheckCircle2,
		Clock,
		XCircle,
		Wrench,
		Trash2,
		Shield,
		ChevronDown,
		Check
	} from 'lucide-svelte';
	import type { PageData } from './$types';
	import { groupSourcesByLang, LANG_LABELS, getSourceMeta } from '$lib/utils/sourceMeta';
	import { setBrokenIds } from '$lib/stores/brokenSources.svelte';
	import { getImpl } from '$lib/stores/impl';
	import { syncBrokenFromReports } from '$lib/stores/brokenSources.svelte';

	type ReportType = 'add_source' | 'fix_source' | 'bug' | 'feature' | 'other';
	type ReportStatus = 'open' | 'in_progress' | 'done' | 'rejected';

	type Report = {
		id: string;
		type: ReportType;
		title: string;
		message: string;
		sourceLink: string | null;
		sourceId: string | null;
		status: ReportStatus;
		userId: string | null;
		userName: string;
		userEmail: string | null;
		adminReply: string | null;
		createdAt: Timestamp | null;
		updatedAt: Timestamp | null;
	};

	const TYPE_OPTIONS: { id: ReportType; label: string }[] = [
		{ id: 'add_source', label: 'Request New Source' },
		{ id: 'fix_source', label: 'Broken / Error Source' },
		{ id: 'bug', label: 'Bug / Other Error' },
		{ id: 'feature', label: 'Feature Request' },
		{ id: 'other', label: 'Other' }
	];

	const TYPE_LABELS: Record<ReportType, string> = {
		add_source: 'Request New Source',
		fix_source: 'Broken / Error Source',
		bug: 'Bug / Other Error',
		feature: 'Feature Request',
		other: 'Other'
	};

	const STATUS_META: Record<
		ReportStatus,
		{ label: string; color: string; icon: typeof Clock }
	> = {
		open: { label: 'Open', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30', icon: Clock },
		in_progress: {
			label: 'In Progress',
			color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
			icon: Wrench
		},
		done: {
			label: 'Done',
			color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
			icon: CheckCircle2
		},
		rejected: {
			label: 'Rejected',
			color: 'bg-red-500/15 text-red-400 border-red-500/30',
			icon: XCircle
		}
	};

	let isDarkMode = $state(true);
	let reports = $state<Report[]>([]);
	/** Filter from /report?source=xxx (from admin ERROR badge) */
	let urlSourceFilter = $derived(
		($page.url.searchParams.get('source') || '').toLowerCase().trim()
	);
	let displayedReports = $derived(
		urlSourceFilter
			? reports.filter(
					(r) =>
						(r.sourceId || '').toLowerCase() === urlSourceFilter ||
						(r.sourceId || '').toLowerCase().includes(urlSourceFilter)
			  )
			: reports
	);
	let loading = $state(true);
	let submitting = $state(false);
	let errorMsg = $state('');
	let successMsg = $state('');

	let formType = $state<ReportType>('add_source');
	let formTitle = $state('');
	let formSourceLink = $state('');
	let formSourceId = $state('');
	let formMessage = $state('');
	let typeDropdownOpen = $state(false);
	let sourceDropdownOpen = $state(false);

	const { data }: { data: PageData } = $props();
	const groupedSources = $derived(groupSourcesByLang(data.sources ?? []));
	const showSourcePicker = $derived(formType === 'fix_source' || formType === 'bug');
	const showSourceLink = $derived(!(showSourcePicker && !!formSourceId));
	const selectedTypeLabel = $derived(TYPE_LABELS[formType] ?? formType);
	const selectedSourceName = $derived(
		formSourceId
			? (data.sources ?? []).find((s) => s.id === formSourceId)?.name || formSourceId
			: '— Select source —'
	);

	let editingId = $state<string | null>(null);
	let editStatus = $state<ReportStatus>('open');
	let editReply = $state('');

	const user = $derived(getUser());
	const admin = $derived(isAdmin(user?.uid));

	function selectType(id: ReportType) {
		formType = id;
		typeDropdownOpen = false;
		sourceDropdownOpen = false;
		if (id !== 'fix_source' && id !== 'bug') {
			formSourceId = '';
		}
	}

	function selectReportSource(id: string) {
		formSourceId = id;
		if (id) formSourceLink = '';
		sourceDropdownOpen = false;
	}

	function clickOutside(node: HTMLElement) {
		const handler = (e: MouseEvent) => {
			if (!node.contains(e.target as Node)) {
				typeDropdownOpen = false;
				sourceDropdownOpen = false;
			}
		};
		document.addEventListener('click', handler, true);
		return {
			destroy: () => document.removeEventListener('click', handler, true)
		};
	}

	onMount(() => {
		isDarkMode = document.documentElement.classList.contains('dark');
		const obs = new MutationObserver(() => {
			isDarkMode = document.documentElement.classList.contains('dark');
		});
		obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

		if (!db) {
			loading = false;
			errorMsg = 'Firestore is not ready.';
			return;
		}

		const q = query(collection(db, 'reports'), orderBy('createdAt', 'desc'));
		try {
			const current = getImpl();
			if (current) formSourceId = current;
		} catch {
			/* ignore */
		}

		const unsub = onSnapshot(
			q,
			(snap) => {
				reports = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Report);
				const broken: string[] = [];
				for (const d of snap.docs) {
					const r = d.data() as Report;
					if (
                      (r.type === 'fix_source' || r.type === 'bug') &&
                      (r.status === 'open' || r.status === 'in_progress') &&
                        r.sourceId
                        ) {
                     broken.push(r.sourceId);
                  }
				}
				setBrokenIds(broken);
				loading = false;
			},
			(err) => {
				console.error(err);
				errorMsg = 'Failed to load reports.';
				loading = false;
			}
		);

		return () => {
			obs.disconnect();
			unsub();
		};
	});

	async function submitReport(e: Event) {
		e.preventDefault();
		if (!db) return;
		if (!formTitle.trim() || !formMessage.trim()) {
			errorMsg = 'Title and message are required.';
			return;
		}

		if (formType === 'fix_source' && !formSourceId) {
			errorMsg = 'Please select the affected source.';
			return;
		}

		const link = showSourceLink ? formSourceLink.trim() : '';
		if (link && !/^https?:\/\//i.test(link)) {
			errorMsg = 'Source link must start with http:// or https://';
			return;
		}

		submitting = true;
		errorMsg = '';
		successMsg = '';

		try {
			await addDoc(collection(db, 'reports'), {
				type: formType,
				title: formTitle.trim(),
				message: formMessage.trim(),
				sourceLink: link || null,
				sourceId: formSourceId || null,
				status: 'open',
				userId: user?.uid ?? null,
				userName: user?.displayName || user?.email || 'Anonymous',
				userEmail: user?.email ?? null,
				adminReply: null,
				createdAt: serverTimestamp(),
				updatedAt: serverTimestamp()
			});
			formTitle = '';
			formSourceLink = '';
			formSourceId = '';
			formMessage = '';
			formType = 'add_source';
			typeDropdownOpen = false;
			sourceDropdownOpen = false;
			successMsg = 'Report submitted successfully. Thank you!';
			setTimeout(() => (successMsg = ''), 4000);
		} catch (err: any) {
			console.error(err);
			errorMsg = err?.message || 'Failed to submit report.';
		} finally {
			submitting = false;
		}
	}

	function startEdit(r: Report) {
		editingId = r.id;
		editStatus = r.status;
		editReply = r.adminReply || '';
	}

	function cancelEdit() {
		editingId = null;
		editReply = '';
	}

	async function saveEdit(id: string) {
	if (!db || !admin) return;
	try {
		await updateDoc(doc(db, 'reports', id), {
			status: editStatus,
			adminReply: editReply.trim() || null,
			updatedAt: serverTimestamp()
		});

		reports = reports.map((r) =>
			r.id === id
				? {
						...r,
						status: editStatus,
						adminReply: editReply.trim() || null
					}
				: r
		);
		syncBrokenFromReports(reports);

		editingId = null;
	} catch (err: any) {
		console.error(err);
		errorMsg = err?.code ? `${err.code}: ${err.message}` : 'Failed to save changes.';
	}
}

	async function removeReport(id: string) {
		if (!db || !admin) return;
		if (!confirm('Delete this report?')) return;
		try {
			await deleteDoc(doc(db, 'reports', id));
		} catch (err: any) {
			console.error(err);
			errorMsg = err?.message || 'Failed to delete report.';
		}
	}

	function formatDate(ts: Timestamp | null) {
		if (!ts?.toDate) return '—';
		return ts.toDate().toLocaleString('en-US', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function btnClass(open = false) {
		return `flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium shadow-sm transition active:scale-[0.99] ${
			isDarkMode
				? 'border-zinc-700 bg-zinc-900 text-zinc-100 hover:border-zinc-600'
				: 'border-zinc-300 bg-white text-zinc-900 hover:border-zinc-400'
		}${open ? (isDarkMode ? ' border-violet-500/50' : ' border-violet-400') : ''}`;
	}

	function menuClass() {
		return `absolute left-0 right-0 z-50 mt-2 overflow-hidden rounded-2xl border shadow-2xl ${
			isDarkMode ? 'border-zinc-700 bg-zinc-900' : 'border-zinc-200 bg-white'
		}`;
	}

	function itemClass(selected: boolean) {
		if (selected) {
			return isDarkMode ? 'bg-violet-500/15 text-violet-300' : 'bg-violet-50 text-violet-700';
		}
		return isDarkMode ? 'hover:bg-zinc-800' : 'hover:bg-zinc-100';
	}
</script>

<svelte:head>
	<title>Report / Request | Rokuyomu</title>
	<meta
		name="description"
		content="Request a new source, report a broken source, or suggest a feature for Rokuyomu."
	/>
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-8 sm:px-6">
	<div class="mb-6 flex items-start gap-3">
		<div class="rounded-xl bg-red-600/20 p-2.5">
			<MessageSquarePlus class="h-6 w-6 text-red-500" />
		</div>
		<div>
			<h1 class="text-xl font-bold sm:text-2xl">Report & Request</h1>
			<p class="mt-0.5 text-sm {isDarkMode ? 'text-zinc-400' : 'text-zinc-500'}">
				Request a new source, report something broken, or send a suggestion. All reports are shown
				below.
			</p>
		</div>
	</div>

	{#if admin}
		<div
			class="mb-5 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs
				{isDarkMode
				? 'border-violet-500/30 bg-violet-500/10 text-violet-300'
				: 'border-violet-200 bg-violet-50 text-violet-700'}"
		>
			<Shield class="h-4 w-4 shrink-0" />
			Admin mode active — you can change status, reply, and delete reports.
		</div>
	{/if}

	<form
		onsubmit={submitReport}
		class="mb-8 space-y-4 rounded-2xl border p-4 sm:p-5
			{isDarkMode ? 'border-zinc-800 bg-zinc-900/40' : 'border-zinc-200 bg-white'}"
		use:clickOutside
	>
		<!-- Report type -->
		<div class="relative">
			<p
				id="report-type-label"
				class="mb-1.5 block text-xs font-medium {isDarkMode ? 'text-zinc-400' : 'text-zinc-500'}"
			>
				Report type
			</p>
			<button
				type="button"
				id="report-type-btn"
				aria-labelledby="report-type-label"
				aria-haspopup="listbox"
				aria-expanded={typeDropdownOpen}
				onclick={() => {
					typeDropdownOpen = !typeDropdownOpen;
					sourceDropdownOpen = false;
				}}
				class={btnClass(typeDropdownOpen)}
			>
				<span class="min-w-0 flex-1 truncate">{selectedTypeLabel}</span>
				<ChevronDown
					class="h-4 w-4 shrink-0 opacity-60 transition-transform duration-200 {typeDropdownOpen
						? 'rotate-180'
						: ''}"
				/>
			</button>
			{#if typeDropdownOpen}
				<div class="{menuClass()} max-h-72 overflow-y-auto p-1.5" role="listbox">
					{#each TYPE_OPTIONS as opt (opt.id)}
						{@const selected = formType === opt.id}
						<button
							type="button"
							role="option"
							aria-selected={selected}
							onclick={() => selectType(opt.id)}
							class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition {itemClass(
								selected
							)}"
						>
							<span class="min-w-0 flex-1 truncate font-medium">{opt.label}</span>
							{#if selected}
								<Check class="h-4 w-4 shrink-0 text-violet-500" />
							{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Source picker -->
		{#if showSourcePicker}
			<div class="relative">
				<p
					id="report-source-label"
					class="mb-1.5 block text-xs font-medium {isDarkMode ? 'text-zinc-400' : 'text-zinc-500'}"
				>
					Source
					<span class="font-normal opacity-60">(select the broken one)</span>
				</p>
				<button
					type="button"
					id="report-source-btn"
					aria-labelledby="report-source-label"
					aria-haspopup="listbox"
					aria-expanded={sourceDropdownOpen}
					onclick={() => {
						sourceDropdownOpen = !sourceDropdownOpen;
						typeDropdownOpen = false;
					}}
					class={btnClass(sourceDropdownOpen)}
				>
					{#if formSourceId}
						{@const meta = getSourceMeta(formSourceId)}
						<span class="fi fi-{meta.flag} rounded-sm text-base"></span>
						<span class="min-w-0 flex-1 truncate">{selectedSourceName}</span>
						{#if meta.isR18}
							<span class="rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-bold text-white"
								>R18</span
							>
						{/if}
					{:else}
						<span class="min-w-0 flex-1 truncate opacity-50">{selectedSourceName}</span>
					{/if}
					<ChevronDown
						class="h-4 w-4 shrink-0 opacity-60 transition-transform duration-200 {sourceDropdownOpen
							? 'rotate-180'
							: ''}"
					/>
				</button>

				{#if sourceDropdownOpen}
					<div class="{menuClass()} max-h-[min(60vh,420px)]" role="listbox">
						<div class="max-h-[min(60vh,420px)] overflow-y-auto p-1.5">
							<button
								type="button"
								role="option"
								aria-selected={!formSourceId}
								onclick={() => selectReportSource('')}
								class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition {itemClass(
									!formSourceId
								)}"
							>
								<span
									class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm opacity-50"
									>—</span
								>
								<span class="flex-1 truncate font-medium">Select source</span>
								{#if !formSourceId}
									<Check class="h-4 w-4 shrink-0 text-violet-500" />
								{/if}
							</button>

							<div
								class="my-1.5 border-t {isDarkMode ? 'border-zinc-700/60' : 'border-zinc-200'}"
							></div>

							{#each Object.entries(groupedSources) as [langKey, items]}
								<div
									class="sticky top-0 z-10 -mx-1.5 my-1 px-3 py-1 text-[11px] font-bold uppercase tracking-wider
										{isDarkMode ? 'bg-zinc-900 text-zinc-500' : 'bg-white text-zinc-400'}"
								>
									{LANG_LABELS[langKey] || langKey}
								</div>

								{#each items as src (src.id)}
									{@const meta = getSourceMeta(src.id)}
									{@const isSelected = formSourceId === src.id}
									<button
										type="button"
										role="option"
										aria-selected={isSelected}
										onclick={() => selectReportSource(src.id)}
										class="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition {itemClass(
											isSelected
										)}"
									>
										<span
											class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-lg
												{isDarkMode ? 'bg-zinc-800' : 'bg-zinc-100'}"
										>
											<span class="fi fi-{meta.flag} rounded-sm"></span>
										</span>
										<div class="min-w-0 flex-1">
											<div class="flex items-center gap-2">
												<span class="truncate text-sm font-medium">{src.name}</span>
												{#if meta.isR18}
													<span
														class="rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-bold text-white"
														>R18</span
													>
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
		{/if}

		<div>
			<label
				for="report-title"
				class="mb-1.5 block text-xs font-medium {isDarkMode ? 'text-zinc-400' : 'text-zinc-500'}"
			>
				Title
			</label>
			<input
				id="report-title"
				type="text"
				bind:value={formTitle}
				placeholder="e.g. Please add MangaDex source"
				maxlength="120"
				class="w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition
					{isDarkMode
					? 'border-zinc-700 bg-zinc-900 text-zinc-100 placeholder:text-zinc-600 focus:border-red-500'
					: 'border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-400 focus:border-red-500'}"
			/>
		</div>

		{#if showSourceLink}
			<div>
				<label
					for="report-source-link"
					class="mb-1.5 block text-xs font-medium {isDarkMode ? 'text-zinc-400' : 'text-zinc-500'}"
				>
					Source link
					<span class="font-normal opacity-60">(optional)</span>
				</label>
				<input
					id="report-source-link"
					type="url"
					bind:value={formSourceLink}
					placeholder="https://example.com"
					maxlength="500"
					class="w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition
						{isDarkMode
						? 'border-zinc-700 bg-zinc-900 text-zinc-100 placeholder:text-zinc-600 focus:border-red-500'
						: 'border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-400 focus:border-red-500'}"
				/>
				<p class="mt-1 text-[11px] {isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}">
					Paste the website URL for new source requests or broken source reports.
				</p>
			</div>
		{/if}

		<div>
			<label
				for="report-message"
				class="mb-1.5 block text-xs font-medium {isDarkMode ? 'text-zinc-400' : 'text-zinc-500'}"
			>
				Message / details
			</label>
			<textarea
				id="report-message"
				bind:value={formMessage}
				rows="4"
				placeholder="Describe your request or the issue..."
				maxlength="2000"
				class="w-full resize-y rounded-xl border px-3 py-2.5 text-sm outline-none transition
					{isDarkMode
					? 'border-zinc-700 bg-zinc-900 text-zinc-100 placeholder:text-zinc-600 focus:border-red-500'
					: 'border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-400 focus:border-red-500'}"
			></textarea>
		</div>

		{#if errorMsg}
			<p class="text-sm text-red-400">{errorMsg}</p>
		{/if}
		{#if successMsg}
			<p class="text-sm text-emerald-400">{successMsg}</p>
		{/if}

		<div class="flex items-center justify-between gap-3">
			<p class="text-xs {isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}">
				{#if user}
					Submitting as <span class="font-medium">{user.displayName || user.email}</span>
				{:else}
					Submitting as Anonymous (login optional)
				{/if}
			</p>
			<button
				type="submit"
				disabled={submitting}
				class="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition
					hover:bg-red-500 active:scale-95 disabled:opacity-60"
			>
				{#if submitting}
					<Loader2 class="h-4 w-4 animate-spin" />
					Sending...
				{:else}
					<Send class="h-4 w-4" />
					Submit
				{/if}
			</button>
		</div>
	</form>

	<div class="mb-3 flex items-center justify-between">
		<h2
			class="text-sm font-semibold uppercase tracking-wider {isDarkMode
				? 'text-zinc-400'
				: 'text-zinc-500'}"
		>
			{urlSourceFilter ? `Reports for: ${urlSourceFilter}` : 'Latest reports'}
		</h2>
		<span class="text-xs {isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}">
			{reports.length} report{reports.length === 1 ? '' : 's'}
		</span>
	</div>

	{#if loading}
		<div
			class="flex items-center justify-center gap-2 py-12 text-sm {isDarkMode
				? 'text-zinc-500'
				: 'text-zinc-400'}"
		>
			<Loader2 class="h-5 w-5 animate-spin" />
			Loading...
		</div>
	{:else if displayedReports.length === 0}
		<p class="py-12 text-center text-sm {isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}">
			No reports yet. Be the first!
		</p>
	{:else}
		<div class="space-y-3">
			{#each displayedReports as r (r.id)}
				{@const statusMeta = STATUS_META[r.status]}
				{@const StatusIcon = statusMeta.icon}
				<article
					class="rounded-2xl border p-4 transition
						{isDarkMode ? 'border-zinc-800 bg-zinc-900/30' : 'border-zinc-200 bg-white'}"
				>
					<div class="mb-2 flex flex-wrap items-center gap-2">
						<span class="rounded-md border px-2 py-0.5 text-[11px] font-medium {statusMeta.color}">
							<span class="inline-flex items-center gap-1">
								<StatusIcon class="h-3 w-3" />
								{statusMeta.label}
							</span>
						</span>
						<span
							class="rounded-md px-2 py-0.5 text-[11px] font-medium
								{isDarkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-zinc-100 text-zinc-600'}"
						>
							{TYPE_LABELS[r.type]}
						</span>
						<span class="ml-auto text-[11px] {isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}">
							{formatDate(r.createdAt)}
						</span>
					</div>

					<h3 class="mb-1 text-sm font-semibold {isDarkMode ? 'text-zinc-100' : 'text-zinc-900'}">
						{r.title}
					</h3>
					{#if r.sourceId}
						<p class="mb-1 text-xs {isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}">
							Source: <span class="font-medium text-amber-400">{r.sourceId}</span>
						</p>
					{/if}
					<p class="mb-2 whitespace-pre-wrap text-sm {isDarkMode ? 'text-zinc-400' : 'text-zinc-600'}">
						{r.message}
					</p>

					{#if r.sourceLink}
						<p class="mb-2 text-sm">
							<a
								href={r.sourceLink}
								target="_blank"
								rel="noopener noreferrer"
								class="break-all underline underline-offset-2 transition hover:opacity-80
									{isDarkMode ? 'text-violet-400' : 'text-violet-600'}"
							>
								{r.sourceLink}
							</a>
						</p>
					{/if}

					<p class="text-[11px] {isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}">
						by {r.userName}
					</p>

					{#if r.adminReply}
						<div
							class="mt-3 rounded-xl border-l-2 border-violet-500 px-3 py-2 text-sm
								{isDarkMode ? 'bg-violet-500/10 text-violet-200' : 'bg-violet-50 text-violet-800'}"
						>
							<p class="mb-0.5 text-[11px] font-semibold uppercase tracking-wide opacity-70">
								Admin reply
							</p>
							<p class="whitespace-pre-wrap">{r.adminReply}</p>
						</div>
					{/if}

					{#if admin}
						{#if editingId === r.id}
							<div
								class="mt-3 space-y-2 border-t pt-3 {isDarkMode
									? 'border-zinc-800'
									: 'border-zinc-100'}"
							>
								<label for="edit-status-{r.id}" class="sr-only">Status</label>
								<select
									id="edit-status-{r.id}"
									bind:value={editStatus}
									class="w-full rounded-lg border px-3 py-2 text-sm
										{isDarkMode
										? 'border-zinc-700 bg-zinc-900 text-zinc-100'
										: 'border-zinc-300 bg-white text-zinc-900'}"
								>
									<option value="open">Open</option>
									<option value="in_progress">In Progress</option>
									<option value="done">Done</option>
									<option value="rejected">Rejected</option>
								</select>
								<label for="edit-reply-{r.id}" class="sr-only">Admin reply</label>
								<textarea
									id="edit-reply-{r.id}"
									bind:value={editReply}
									rows="2"
									placeholder="Admin reply (optional)"
									class="w-full rounded-lg border px-3 py-2 text-sm
										{isDarkMode
										? 'border-zinc-700 bg-zinc-900 text-zinc-100'
										: 'border-zinc-300 bg-white text-zinc-900'}"
								></textarea>
								<div class="flex gap-2">
									<button
										type="button"
										onclick={() => saveEdit(r.id)}
										class="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500"
									>
										Save
									</button>
									<button
										type="button"
										onclick={cancelEdit}
										class="rounded-lg px-3 py-1.5 text-xs font-medium
											{isDarkMode
											? 'text-zinc-400 hover:text-zinc-200'
											: 'text-zinc-500 hover:text-zinc-800'}"
									>
										Cancel
									</button>
								</div>
							</div>
						{:else}
							<div
								class="mt-3 flex gap-2 border-t pt-3 {isDarkMode
									? 'border-zinc-800'
									: 'border-zinc-100'}"
							>
								<button
									type="button"
									onclick={() => startEdit(r)}
									class="rounded-lg px-3 py-1.5 text-xs font-medium transition
										{isDarkMode
										? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
										: 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}"
								>
									Edit status / reply
								</button>
								<button
									type="button"
									onclick={() => removeReport(r.id)}
									class="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-500/10"
								>
									<Trash2 class="h-3.5 w-3.5" />
									Delete
								</button>
							</div>
						{/if}
					{/if}
				</article>
			{/each}
		</div>
	{/if}
</div>
