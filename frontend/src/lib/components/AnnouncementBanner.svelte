<script lang="ts">
	import { X, Info, AlertTriangle, AlertOctagon } from 'lucide-svelte';
	import { browser } from '$app/environment';

	type Level = 'info' | 'warning' | 'danger';

	let {
		message = '',
		level = 'info' as Level,
		updatedAt = '' as string | undefined
	}: {
		message?: string;
		level?: Level;
		updatedAt?: string;
	} = $props();

	const DISMISS_KEY = 'rokuyomu_ann_dismiss';

	let dismissed = $state(false);

	$effect(() => {
		if (!browser || !message) return;
		try {
			const raw = sessionStorage.getItem(DISMISS_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as { message?: string; updatedAt?: string };
			if (parsed.message === message && (parsed.updatedAt || '') === (updatedAt || '')) {
				dismissed = true;
			}
		} catch {
			/* ignore */
		}
	});

	function dismiss() {
		dismissed = true;
		if (!browser) return;
		try {
			sessionStorage.setItem(
				DISMISS_KEY,
				JSON.stringify({ message, updatedAt: updatedAt || '' })
			);
		} catch {
		}
	}

	const styles = $derived.by(() => {
		switch (level) {
			case 'danger':
				return {
					wrap: 'border-red-300/80 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/80 dark:text-red-100',
					icon: 'text-red-600 dark:text-red-400'
				};
			case 'warning':
				return {
					wrap: 'border-amber-300/80 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/70 dark:text-amber-100',
					icon: 'text-amber-600 dark:text-amber-400'
				};
			default:
				return {
					wrap: 'border-sky-300/80 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-950/70 dark:text-sky-100',
					icon: 'text-sky-600 dark:text-sky-400'
				};
		}
	});
</script>

{#if message && !dismissed}
	<div
		class="w-full border-b px-3 py-2.5 sm:px-4 {styles.wrap}"
		role="status"
		aria-live="polite"
	>
		<div class="mx-auto flex max-w-6xl items-start gap-2.5 sm:items-center">
			<span class="mt-0.5 shrink-0 sm:mt-0 {styles.icon}">
				{#if level === 'danger'}
					<AlertOctagon class="h-4 w-4" />
				{:else if level === 'warning'}
					<AlertTriangle class="h-4 w-4" />
				{:else}
					<Info class="h-4 w-4" />
				{/if}
			</span>
			<p class="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-snug">{message}</p>
			<button
				type="button"
				class="shrink-0 rounded-md p-1 opacity-70 transition hover:opacity-100"
				aria-label="Close"
				onclick={dismiss}
			>
				<X class="h-4 w-4" />
			</button>
		</div>
	</div>
{/if}
