<script lang="ts">
	import {
		loginWithEmail,
		registerWithEmail,
		getAuthError,
		clearAuthError
	} from '$lib/stores/auth.svelte';
	import { Mail, Lock, Eye, EyeOff, UserPlus, LogIn } from 'lucide-svelte';

	let {
		onSuccess,
		isDarkMode = true
	}: { onSuccess: () => void; isDarkMode?: boolean } = $props();

	let mode = $state<'login' | 'register'>('login');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let loading = $state(false);
	let showPass = $state(false);
	let showConfirm = $state(false);
	let localError = $state('');

	function passwordStrength(pw: string): { score: number; label: string; color: string } {
		let score = 0;
		if (pw.length >= 6) score++;
		if (pw.length >= 10) score++;
		if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
		if (/\d/.test(pw)) score++;
		if (/[^A-Za-z0-9]/.test(pw)) score++;
		if (score <= 1) return { score, label: 'Weak', color: 'bg-red-500' };
		if (score <= 3) return { score, label: 'Medium', color: 'bg-amber-500' };
		return { score, label: 'Strong', color: 'bg-emerald-500' };
	}

	let strength = $derived(passwordStrength(password));

	async function handleSubmit() {
		localError = '';
		if (!email || !password) {
			localError = 'Email dan password wajib diisi';
			return;
		}
		if (mode === 'register') {
			if (password.length < 6) {
				localError = 'Password minimal 6 karakter';
				return;
			}
			if (password !== confirmPassword) {
				localError = 'Password tidak cocok. Cek lagi konfirmasi password.';
				return;
			}
		}
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
			// error di store
		} finally {
			loading = false;
		}
	}

	function switchMode() {
		mode = mode === 'login' ? 'register' : 'login';
		confirmPassword = '';
		localError = '';
		clearAuthError();
	}

	const inputCls = $derived(
		`w-full rounded-xl border px-3 py-2.5 pl-10 text-sm outline-none transition focus:ring-2 focus:ring-violet-500/60 ${
			isDarkMode
				? 'border-zinc-700/80 bg-zinc-800/80 text-white placeholder:text-zinc-500'
				: 'border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-400'
		}`
	);
</script>

<form
	onsubmit={(e) => {
		e.preventDefault();
		handleSubmit();
	}}
	class="space-y-3"
>
	<!-- Email -->
	<div class="relative">
		<Mail class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500" />
		<input
			type="email"
			bind:value={email}
			placeholder="Email"
			required
			autocomplete="email"
			class={inputCls}
		/>
	</div>

	<!-- Password -->
	<div class="relative">
		<Lock class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500" />
		<input
			type={showPass ? 'text' : 'password'}
			bind:value={password}
			placeholder="Password"
			required
			minlength="6"
			autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
			class="{inputCls} pr-10"
		/>
		<button
			type="button"
			onclick={() => (showPass = !showPass)}
			class="absolute top-1/2 right-3 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
			tabindex="-1"
			aria-label="Toggle password"
		>
			{#if showPass}
				<EyeOff class="h-4 w-4" />
			{:else}
				<Eye class="h-4 w-4" />
			{/if}
		</button>
	</div>

	<!-- Strength (register only) -->
	{#if mode === 'register' && password.length > 0}
		<div class="space-y-1">
			<div class="flex h-1.5 gap-1 overflow-hidden rounded-full">
				{#each [1, 2, 3, 4, 5] as i}
					<div
						class="flex-1 rounded-full transition-all {i <= strength.score
							? strength.color
							: isDarkMode
								? 'bg-zinc-700'
								: 'bg-zinc-200'}"
					></div>
				{/each}
			</div>
			<p class="text-[10px] {isDarkMode ? 'text-zinc-400' : 'text-zinc-500'}">
				Kekuatan: <span class="font-semibold">{strength.label}</span>
			</p>
		</div>
	{/if}

	<!-- Confirm password (register only) -->
	{#if mode === 'register'}
		<div class="relative">
			<Lock class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500" />
			<input
				type={showConfirm ? 'text' : 'password'}
				bind:value={confirmPassword}
				placeholder="Konfirmasi password"
				required
				minlength="6"
				autocomplete="new-password"
				class="{inputCls} pr-10 {confirmPassword && confirmPassword !== password
					? 'border-red-500/60 focus:ring-red-500/40'
					: confirmPassword && confirmPassword === password
						? 'border-emerald-500/50 focus:ring-emerald-500/40'
						: ''}"
			/>
			<button
				type="button"
				onclick={() => (showConfirm = !showConfirm)}
				class="absolute top-1/2 right-3 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
				tabindex="-1"
				aria-label="Toggle confirm password"
			>
				{#if showConfirm}
					<EyeOff class="h-4 w-4" />
				{:else}
					<Eye class="h-4 w-4" />
				{/if}
			</button>
		</div>
		{#if confirmPassword && confirmPassword !== password}
			<p class="text-[11px] text-red-400">Password tidak cocok</p>
		{:else if confirmPassword && confirmPassword === password}
			<p class="text-[11px] text-emerald-400">Password cocok ✓</p>
		{/if}
	{/if}

	{#if localError || getAuthError()}
		<p class="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
			{localError || getAuthError()}
		</p>
	{/if}

	<button
		type="submit"
		disabled={loading || (mode === 'register' && password !== confirmPassword)}
		class="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-3 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition hover:from-violet-500 hover:to-fuchsia-500 active:scale-[0.98] disabled:opacity-50"
	>
		{#if loading}
			<span class="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></span>
			Memproses...
		{:else if mode === 'login'}
			<LogIn class="h-4 w-4" />
			Login
		{:else}
			<UserPlus class="h-4 w-4" />
			Daftar Akun
		{/if}
	</button>

	<button
		type="button"
		onclick={switchMode}
		class="w-full text-center text-xs {isDarkMode
			? 'text-zinc-500 hover:text-zinc-300'
			: 'text-zinc-500 hover:text-zinc-700'}"
	>
		{mode === 'login' ? 'Belum punya akun? Daftar sekarang' : 'Sudah punya akun? Login'}
	</button>
</form>
