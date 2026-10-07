<script lang="ts">
	import { onMount } from 'svelte';
	import {
		getUser,
		loginWithGoogle,
		loginWithGithub,
		logout
	} from '$lib/stores/auth.svelte';
	import { getBookmarks } from '$lib/stores/bookmark.svelte';
	import { getHistory } from '$lib/stores/history';
	import EmailLoginForm from '$lib/components/EmailLoginForm.svelte';
	import {
		LogOut,
		Github,
		BookOpen,
		Bookmark,
		Flame,
		Trophy,
		Star,
		Zap,
		Library
	} from 'lucide-svelte';

	let {
		isDarkMode = true,
		onSuccess,
		onLogout
	}: {
		isDarkMode?: boolean;
		onSuccess: () => void;
		onLogout: () => void;
	} = $props();

	let historyCount = $state(0);
	let bookmarkCount = $state(0);
	let chaptersRead = $state(0);
	let uniqueSources = $state(0);
	let level = $state(1);
	let xp = $state(0);
	let xpToNext = $state(100);
	let xpProgress = $state(0);
	let rankTitle = $state('Rookie Reader');
	let rankColor = $state('from-zinc-500 to-zinc-400');

	function calcStats() {
		const hist = getHistory();
		const bms = getBookmarks();
		historyCount = hist.length;
		bookmarkCount = bms.length;
		chaptersRead = hist.reduce((sum, h) => sum + (Number(h.chapterNumber) || 1), 0);
		const sources = new Set(hist.map((h) => h.sourceId).filter(Boolean));
		uniqueSources = sources.size;

		const totalXp = historyCount * 10 + bookmarkCount * 15 + chaptersRead * 2;
		xp = totalXp;

		// Level curve: 100, 250, 450, 700, 1000...
		let lv = 1;
		let need = 100;
		let remaining = totalXp;
		while (remaining >= need && lv < 99) {
			remaining -= need;
			lv++;
			need = 50 + lv * 50 + Math.floor(lv * lv * 2);
		}
		level = lv;
		xpToNext = need;
		xpProgress = Math.min(100, Math.round((remaining / need) * 100));

		if (lv >= 40) {
			rankTitle = 'Grand Master';
			rankColor = 'from-amber-400 to-yellow-300';
		} else if (lv >= 25) {
			rankTitle = 'Elite Reader';
			rankColor = 'from-violet-400 to-fuchsia-400';
		} else if (lv >= 15) {
			rankTitle = 'Veteran';
			rankColor = 'from-sky-400 to-cyan-300';
		} else if (lv >= 8) {
			rankTitle = 'Book Hunter';
			rankColor = 'from-emerald-400 to-teal-300';
		} else if (lv >= 3) {
			rankTitle = 'Page Turner';
			rankColor = 'from-orange-400 to-amber-300';
		} else {
			rankTitle = 'Rookie Reader';
			rankColor = 'from-zinc-400 to-zinc-300';
		}
	}

	onMount(() => {
		calcStats();
		const refresh = () => calcStats();
		window.addEventListener('history-changed', refresh);
		window.addEventListener('bookmarks-changed', refresh);
		return () => {
			window.removeEventListener('history-changed', refresh);
			window.removeEventListener('bookmarks-changed', refresh);
		};
	});

	async function handleGoogle() {
		try {
			await loginWithGoogle();
			onSuccess();
		} catch {}
	}

	async function handleGithub() {
		try {
			await loginWithGithub();
			onSuccess();
		} catch {}
	}

	function goToStats() {
		onSuccess();
	}
</script>

<div
	class="w-[min(20rem,calc(100vw-1.25rem))] overflow-hidden rounded-2xl border shadow-2xl
		{isDarkMode ? 'border-zinc-700/80 bg-zinc-900' : 'border-zinc-200 bg-white'}"
>
	{#if getUser()}
		{@const u = getUser()!}
		<!-- ═══ PROFILE HEADER (game style) ═══ -->
		<div class="relative overflow-hidden px-4 pt-4 pb-3">
			<!-- glow bg -->
			<div
				class="pointer-events-none absolute inset-0 bg-gradient-to-br opacity-20 {rankColor}"
			></div>
			<div
				class="pointer-events-none absolute -top-8 -right-8 h-24 w-24 rounded-full bg-violet-500/20 blur-2xl"
			></div>

			<div class="relative flex items-start gap-3">
				<!-- Avatar + level ring -->
				<div class="relative shrink-0">
					{#if u.photoURL}
						<img
							src={u.photoURL}
							alt="avatar"
							class="h-14 w-14 rounded-2xl object-cover ring-2 ring-violet-500/50"
						/>
					{:else}
						<div
							class="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-600 text-xl font-black text-white ring-2 ring-violet-400/40"
						>
							{(u.displayName?.[0] || u.email?.[0] || 'U').toUpperCase()}
						</div>
					{/if}
					<!-- Level badge -->
					<span
						class="absolute -right-1.5 -bottom-1.5 flex h-6 min-w-[1.5rem] items-center justify-center rounded-lg bg-gradient-to-r px-1 text-[10px] font-black text-zinc-900 shadow-md {rankColor}"
					>
						Lv.{level}
					</span>
				</div>

				<div class="min-w-0 flex-1">
					<p class="truncate text-sm font-bold {isDarkMode ? 'text-white' : 'text-zinc-900'}">
						{u.displayName || 'Reader'}
					</p>
					<p class="truncate text-[11px] text-zinc-500">{u.email}</p>
					<div class="mt-1.5 flex items-center gap-1.5">
						<span
							class="inline-flex items-center gap-1 rounded-md bg-gradient-to-r px-2 py-0.5 text-[10px] font-bold text-zinc-900 {rankColor}"
						>
							<Trophy class="h-3 w-3" />
							{rankTitle}
						</span>
					</div>
				</div>
			</div>

			<!-- XP bar -->
			<div class="relative mt-3">
				<div class="mb-1 flex items-center justify-between text-[10px]">
					<span class="flex items-center gap-1 font-semibold text-violet-400">
						<Zap class="h-3 w-3" />
						{xp} XP
					</span>
					<span class="text-zinc-500">Next: {xpToNext} XP</span>
				</div>
				<div
					class="h-2 overflow-hidden rounded-full {isDarkMode ? 'bg-zinc-800' : 'bg-zinc-200'}"
				>
					<div
						class="h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-amber-400 transition-all duration-500"
						style="width: {xpProgress}%"
					></div>
				</div>
			</div>
		</div>

		<!-- ═══ STATS GRID ═══ -->
		<div class="grid grid-cols-2 gap-2 px-3 pb-3">
			<div
				class="rounded-xl border p-2.5 {isDarkMode
					? 'border-zinc-800 bg-zinc-800/50'
					: 'border-zinc-100 bg-zinc-50'}"
			>
				<div class="flex items-center gap-1.5 text-[10px] text-zinc-500">
					<BookOpen class="h-3 w-3 text-sky-400" />
					History
				</div>
				<p class="mt-0.5 text-lg font-black tabular-nums {isDarkMode ? 'text-white' : 'text-zinc-900'}">
					{historyCount}
				</p>
				<p class="text-[9px] text-zinc-500">titles tracked</p>
			</div>
			<div
				class="rounded-xl border p-2.5 {isDarkMode
					? 'border-zinc-800 bg-zinc-800/50'
					: 'border-zinc-100 bg-zinc-50'}"
			>
				<div class="flex items-center gap-1.5 text-[10px] text-zinc-500">
					<Bookmark class="h-3 w-3 text-rose-400" />
					Bookmarks
				</div>
				<p class="mt-0.5 text-lg font-black tabular-nums {isDarkMode ? 'text-white' : 'text-zinc-900'}">
					{bookmarkCount}
				</p>
				<p class="text-[9px] text-zinc-500">saved series</p>
			</div>
			<div
				class="rounded-xl border p-2.5 {isDarkMode
					? 'border-zinc-800 bg-zinc-800/50'
					: 'border-zinc-100 bg-zinc-50'}"
			>
				<div class="flex items-center gap-1.5 text-[10px] text-zinc-500">
					<Flame class="h-3 w-3 text-orange-400" />
					Chapters
				</div>
				<p class="mt-0.5 text-lg font-black tabular-nums {isDarkMode ? 'text-white' : 'text-zinc-900'}">
					{chaptersRead}
				</p>
				<p class="text-[9px] text-zinc-500">approx. read</p>
			</div>
			<div
				class="rounded-xl border p-2.5 {isDarkMode
					? 'border-zinc-800 bg-zinc-800/50'
					: 'border-zinc-100 bg-zinc-50'}"
			>
				<div class="flex items-center gap-1.5 text-[10px] text-zinc-500">
					<Library class="h-3 w-3 text-emerald-400" />
					Sources
				</div>
				<p class="mt-0.5 text-lg font-black tabular-nums {isDarkMode ? 'text-white' : 'text-zinc-900'}">
					{uniqueSources}
				</p>
				<p class="text-[9px] text-zinc-500">explored</p>
			</div>
		</div>

		<!-- Stats link + Logout -->
		<div class="border-t p-2 space-y-1 {isDarkMode ? 'border-zinc-800' : 'border-zinc-100'}">
			<a
				href="/stats"
				onclick={goToStats}
				class="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition
					{isDarkMode
					? 'text-violet-300 hover:bg-violet-500/10'
					: 'text-violet-600 hover:bg-violet-50'}"
			>
				My Stats
			</a>
			<button
				onclick={onLogout}
				class="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition
					{isDarkMode
					? 'text-zinc-400 hover:bg-zinc-800 hover:text-red-400'
					: 'text-zinc-600 hover:bg-zinc-100 hover:text-red-500'}"
			>
				<LogOut class="h-4 w-4" />
				Logout
			</button>
		</div>
	{:else}
		<!-- ═══ LOGIN / REGISTER ═══ -->
		<div class="relative overflow-hidden px-4 pt-4 pb-2">
			<div
				class="pointer-events-none absolute -top-10 -right-6 h-28 w-28 rounded-full bg-violet-600/25 blur-3xl"
			></div>
			<div class="relative">
				<div class="mb-1 flex items-center gap-2">
					<span
						class="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-600/30"
					>
						<Star class="h-4 w-4" />
					</span>
					<div>
						<p class="text-sm font-bold {isDarkMode ? 'text-white' : 'text-zinc-900'}">
							Join Rokuyomu
						</p>
						<p class="text-[11px] text-zinc-500">Sync · Stats · Level up</p>
					</div>
				</div>
			</div>
		</div>

		<div class="space-y-2 px-3 pb-3">
			<button
				onclick={handleGoogle}
				class="flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition
					{isDarkMode
					? 'border-zinc-700 bg-zinc-800/80 text-white hover:bg-zinc-750'
					: 'border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50'}"
			>
				<svg class="h-4 w-4" viewBox="0 0 24 24">
					<path
						fill="#EA4335"
						d="M5.266 9.378A7.995 7.995 0 0 1 12 4c1.955 0 3.729.72 5.096 1.904l3.23-3.23C18.009.946 15.18 0 12 0 7.392 0 3.396 2.599 1.386 6.41l3.88 2.968z"
					/>
					<path
						fill="#34A853"
						d="M16.04 18.013C14.807 18.823 13.451 19.25 12 19.25a7.99 7.99 0 0 1-6.72-3.838l-3.88 2.968A12 12 0 0 0 12 24c3.043 0 5.79-1.06 7.938-2.86l-3.898-3.127z"
					/>
					<path
						fill="#4A90E2"
						d="M19.938 21.14C22.172 19.176 23.5 15.99 23.5 12c0-.705-.06-1.39-.174-2.054H12v4.31h6.47a5.52 5.52 0 0 1-2.392 3.62l3.86 3.264z"
					/>
					<path
						fill="#FBBC05"
						d="M5.28 15.412A7.95 7.95 0 0 1 4.75 12c0-1.21.27-2.35.75-3.378L1.62 5.654A11.95 11.95 0 0 0 0 12c0 1.94.46 3.77 1.28 5.412l4-2z"
					/>
				</svg>
				Continue with Google
			</button>

			<button
				onclick={handleGithub}
				class="flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition
					{isDarkMode
					? 'border-zinc-700 bg-zinc-800/80 text-white hover:bg-zinc-750'
					: 'border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50'}"
			>
				<Github class="h-4 w-4" />
				Continue with GitHub
			</button>

			<div class="relative py-1">
				<div class="absolute inset-0 flex items-center">
					<div class="w-full border-t {isDarkMode ? 'border-zinc-700' : 'border-zinc-200'}"></div>
				</div>
				<div class="relative flex justify-center text-[10px]">
					<span class="px-2 {isDarkMode ? 'bg-zinc-900 text-zinc-500' : 'bg-white text-zinc-500'}"
						>or email</span
					>
				</div>
			</div>

			<EmailLoginForm {onSuccess} {isDarkMode} />
		</div>
	{/if}
</div>
