<script lang="ts">
	import {
		loginWithEmail,
		registerWithEmail,
		getAuthError,
		clearAuthError
	} from '$lib/stores/auth.svelte';
	import { Mail } from 'lucide-svelte';

	let {
		onSuccess,
		isDarkMode = true
	}: { onSuccess: () => void; isDarkMode?: boolean } = $props();

	let mode = $state<'login' | 'register'>('login');
	let email = $state('');
	let password = $state('');
	let loading = $state(false);

	async function handleSubmit() {
		if (!email || !password) return;
		loading = true;
		clearAuthError();
		try {
			if (mode === 'login') {
				await loginWithEmail(email, password);
			} else {
				await registerWithEmail(email, password);
			}
			onSuccess();
		} catch {
			// error sudah di-store
		} finally {
			loading = false;
		}
	}
</script>

<form
	onsubmit={(e) => {
		e.preventDefault();
		handleSubmit();
	}}
	class="space-y-2"
>
	<input
		type="email"
		bind:value={email}
		placeholder="Email"
		required
		class="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500
			{isDarkMode
				? 'border-zinc-700 bg-zinc-800 text-white placeholder:text-zinc-500'
				: 'border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-400'}"
	/>
	<input
		type="password"
		bind:value={password}
		placeholder="Password"
		required
		minlength="6"
		class="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500
			{isDarkMode
				? 'border-zinc-700 bg-zinc-800 text-white placeholder:text-zinc-500'
				: 'border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-400'}"
	/>

	{#if getAuthError()}
		<p class="text-xs text-red-400">{getAuthError()}</p>
	{/if}

	<button
		type="submit"
		disabled={loading}
		class="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-60"
	>
		<Mail class="h-4 w-4" />
		{loading ? 'Memproses...' : mode === 'login' ? 'Login' : 'Daftar'}
	</button>

	<button
		type="button"
		onclick={() => {
			mode = mode === 'login' ? 'register' : 'login';
			clearAuthError();
		}}
		class="w-full text-center text-xs text-zinc-500 hover:text-zinc-300"
	>
		{mode === 'login' ? 'Belum punya akun? Daftar' : 'Sudah punya akun? Login'}
	</button>
</form>