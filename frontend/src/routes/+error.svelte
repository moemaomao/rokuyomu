<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { BookX, Home, ArrowLeft, AlertTriangle, RefreshCw } from 'lucide-svelte';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';

	let isDarkMode = $state(true);

	function syncTheme() {
		if (!browser) return;
		const saved = localStorage.getItem('darkMode');
		if (saved !== null) {
			isDarkMode = saved === 'true';
		} else {
			isDarkMode = !document.documentElement.classList.contains('light');
		}
	}

	const status = $derived($page.status ?? 500);
	const message = $derived(
		($page.error?.message as string) || 'Something went wrong'
	);
	const isNotFound = $derived(status === 404);

	// --- Auto-retry logic ---
	const MAX_RETRIES = 5;
	const RETRY_DELAY_MS = 2500;

	let retryCount = $state(0);
	let isRetrying = $state(false);
	let countdown = $state(0);
	let cancelled = $state(false);

	let timer: ReturnType<typeof setTimeout> | null = null;
	let countdownInterval: ReturnType<typeof setInterval> | null = null;

	function clearTimers() {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		if (countdownInterval) {
			clearInterval(countdownInterval);
			countdownInterval = null;
		}
	}

	function startCountdown(seconds: number) {
		countdown = seconds;
		countdownInterval = setInterval(() => {
			countdown -= 1;
			if (countdown <= 0 && countdownInterval) {
				clearInterval(countdownInterval);
				countdownInterval = null;
			}
		}, 1000);
	}

	function scheduleRetry() {
		if (cancelled || retryCount >= MAX_RETRIES) {
			isRetrying = false;
			return;
		}

		isRetrying = true;
		const next = retryCount + 1;
		retryCount = next;

		startCountdown(Math.ceil(RETRY_DELAY_MS / 1000));

		timer = setTimeout(() => {
			if (!cancelled && browser) {
				sessionStorage.setItem('error-retry-count', String(next));
				window.location.reload();
			}
		}, RETRY_DELAY_MS);
	}

	function cancelRetry() {
		cancelled = true;
		isRetrying = false;
		clearTimers();
		sessionStorage.removeItem('error-retry-count');
	}

	function goBack() {
		cancelRetry();
		if (browser && history.length > 1) {
			history.back();
		} else {
			goto('/');
		}
	}

	function hardReload() {
		cancelRetry();
		if (browser) {
			sessionStorage.setItem('error-retry-count', '0'); // reset
			window.location.reload();
		}
	}

	onMount(() => {
		syncTheme();
		const obs = new MutationObserver(syncTheme);
		obs.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class']
		});

		const saved = sessionStorage.getItem('error-retry-count');
		const current = saved ? parseInt(saved, 10) : 0;
		retryCount = current;

		const shouldAutoRetry = status === 404 || status === 500 || status === 503;

		if (shouldAutoRetry && current < MAX_RETRIES) {
			scheduleRetry();
		} else {
			sessionStorage.removeItem('error-retry-count');
		}

		return () => {
			obs.disconnect();
			clearTimers();
		};
	});

	onDestroy(() => {
		clearTimers();
	});
</script>

<div
	class="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-6 py-16 text-center
		{isDarkMode ? 'bg-zinc-950 text-zinc-100' : 'bg-zinc-50 text-zinc-900'}"
>
	<!-- Icon -->
	<div
		class="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl
			{isNotFound
				? isDarkMode
					? 'bg-red-500/10 text-red-400'
					: 'bg-red-50 text-red-500'
				: isDarkMode
					? 'bg-amber-500/10 text-amber-400'
					: 'bg-amber-50 text-amber-600'}"
	>
		{#if isNotFound}
			<BookX class="h-10 w-10" strokeWidth={1.5} />
		{:else}
			<AlertTriangle class="h-10 w-10" strokeWidth={1.5} />
		{/if}
	</div>

	<!-- Status -->
	<p
		class="mb-2 text-sm font-semibold tracking-widest uppercase
			{isNotFound
				? isDarkMode
					? 'text-red-400/80'
					: 'text-red-500'
				: isDarkMode
					? 'text-amber-400/80'
					: 'text-amber-600'}"
	>
		Error {status}
	</p>

	<!-- Message -->
	<h1
		class="mb-3 max-w-lg text-2xl font-semibold tracking-tight sm:text-3xl
			{isDarkMode ? 'text-white' : 'text-zinc-900'}"
	>
		{message}
	</h1>

	<!-- Hint -->
	<p
		class="mb-4 max-w-sm text-sm leading-relaxed
			{isDarkMode ? 'text-zinc-500' : 'text-zinc-500'}"
	>
		{#if isNotFound}
			This page or chapter may have been removed, the URL is incorrect, or the source is currently unavailable.
		{:else}
			Something went wrong on the server. Try reloading the page or come back later.
		{/if}
	</p>

	<!-- Auto-retry status -->
	{#if isRetrying}
		<div
			class="mb-6 flex flex-col items-center gap-2 rounded-xl px-4 py-3 text-sm
				{isDarkMode ? 'bg-white/5 text-zinc-300' : 'bg-zinc-100 text-zinc-600'}"
		>
			<div class="flex items-center gap-2">
				<RefreshCw class="h-4 w-4 animate-spin" />
				<span>
					Retrying… ({retryCount}/{MAX_RETRIES})
					{#if countdown > 0}
						— {countdown}s
					{/if}
				</span>
			</div>
			<button
				onclick={cancelRetry}
				class="text-xs underline opacity-70 hover:opacity-100"
			>
				Cancel
			</button>
		</div>
	{:else if retryCount >= MAX_RETRIES}
		<p class="mb-6 text-sm text-amber-500">
			Auto-retry stopped after {MAX_RETRIES} attempts. Please try again later.
		</p>
	{/if}

	<!-- Actions -->
	<div class="flex flex-wrap items-center justify-center gap-3">
		<button
			onclick={goBack}
			class="inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-medium transition
				{isDarkMode
					? 'border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10'
					: 'border-zinc-200 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50'}"
		>
			<ArrowLeft class="h-4 w-4" />
			Go Back
		</button>

		<button
			onclick={hardReload}
			class="inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-medium transition
				{isDarkMode
					? 'border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10'
					: 'border-zinc-200 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50'}"
		>
			<RefreshCw class="h-4 w-4" />
			Reload Now
		</button>

		<a
			href="/"
			class="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-red-500"
		>
			<Home class="h-4 w-4" />
			Home
		</a>
	</div>
</div>