<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.ico';
	import logo from '$lib/assets/rokuyomu.png';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto, beforeNavigate, afterNavigate } from '$app/navigation';
	import NProgress from 'nprogress';
	import 'nprogress/nprogress.css';
	import { isMultiMode } from '$lib/stores/impl';
	import { untrack } from 'svelte';
	import { collection, query, onSnapshot } from 'firebase/firestore';
    import { db } from '$lib/firebase';
    import { syncBrokenFromReports } from '$lib/stores/brokenSources.svelte';

	// Components
	import Footer from '$lib/components/Footer.svelte';
	import HistoryWidget from '$lib/components/HistoryWidget.svelte';
	import EmailLoginForm from '$lib/components/EmailLoginForm.svelte';

	// Auth
	import {
		getUser,
		isLoading,
		loginWithGoogle,
		loginWithGithub,
		logout
	} from '$lib/stores/auth.svelte';

	// Hybrid sync
	import { syncBookmarksOnLogin } from '$lib/stores/bookmark.svelte';
	import { syncHistoryOnLogin } from '$lib/stores/history';

	// Icons
	import {
		Menu,
		X,
		BookOpen,
		Sun,
		Moon,
		Bookmark,
		Library,
		History,
		MessageSquare,
		DollarSign,
		Trash2,
		FileText,
		Shield,
		LogOut,
		Github,
		Settings,
		Search,
		Bell
	} from 'lucide-svelte';

	// Stores
	import {
		getBookmarks,
		removeBookmark,
		type BookmarkEntry
	} from '$lib/stores/bookmark.svelte';
	import {
		getUnreadCount,
		checkForNewChapters
	} from '$lib/stores/notification.svelte';
	import { getImpl } from '$lib/stores/impl';

	// ── Progress bar ─────────────────────────────────────────────────────────
	NProgress.configure({
		showSpinner: false,
		trickleSpeed: 100,
		minimum: 0.08,
		easing: 'ease',
		speed: 400
	});
	beforeNavigate(() => NProgress.start());
	afterNavigate(() => {
		NProgress.done();
		if (browser && !isDesktop) {
			isSidebarOpen = false;
		}
	});

	// ── Props & derived ──────────────────────────────────────────────────────
	let { data, children } = $props();

	let isReaderPage = $derived($page.url.pathname.startsWith('/reader/'));

	// ── UI state ─────────────────────────────────────────────────────────────
	let isDesktop = $state(true);
	let isSidebarOpen = $state(false);
	let hasHydrated = $state(false);
	let isDarkMode = $state(true);
	let isBookmarkOpen = $state(false);
	let isAuthOpen = $state(false);
	let isHistoryOpen = $state(true);
	let bookmarks = $state<BookmarkEntry[]>([]);
	let isHeaderHidden = $state(false);
	let notifUnread = $state(0);

	function loadNotifBadge() {
		notifUnread = getUnreadCount();
	}

	// ── Helpers ──────────────────────────────────────────────────────────────
	function formatMangaHref(sourceId: string, mangaId: string): string {
		const clean = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		return `/manga/${sourceId}${clean}`;
	}

	function navClass(): string {
		return isDarkMode
			? 'hover:bg-zinc-900/80 hover:text-white'
			: 'hover:bg-black/5 hover:text-zinc-900';
	}

	function iconBtnClass(active = false): string {
		const base = isDarkMode
			? 'text-zinc-300 hover:bg-zinc-800/60 hover:text-white'
			: 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900';
		return active ? `${base} text-[var(--color-primary)]` : base;
	}

	function proxyCover(url: string, sourceId: string, w = 80, h = 120): string {
		if (!url) return '';
		let u = String(url).trim();
		if (u.startsWith('//')) u = 'https:' + u;
		if (!/^https?:\/\//i.test(u)) return '';
		return `/api/proxy?url=${encodeURIComponent(u)}&source=${sourceId}&w=${w}&h=${h}`;
	}

	function onCoverError(e: Event) {
		const img = e.currentTarget as HTMLImageElement;
		const original = img.dataset.original;
		if (!original || img.dataset.fallback === '1') {
			img.style.display = 'none';
			return;
		}
		img.dataset.fallback = '1';
		const u = original.startsWith('//') ? 'https:' + original : original;
		img.src = `/api/proxy?url=${encodeURIComponent(u)}&source=${img.dataset.source || ''}`;
	}

	// ── Theme ────────────────────────────────────────────────────────────────
	function applyTheme(dark: boolean) {
		isDarkMode = dark;
		if (!browser) return;
		document.documentElement.classList.toggle('dark', dark);
		document.documentElement.classList.toggle('light', !dark);
		localStorage.setItem('darkMode', String(dark));
	}

	function toggleDarkMode() {
		applyTheme(!isDarkMode);
	}

	// ── Sidebar ──────────────────────────────────────────────────────────────
	function toggleSidebar() {
	isSidebarOpen = !isSidebarOpen;
	if (browser && isDesktop) {
		document.cookie = `sidebar_open=${isSidebarOpen ? 'true' : 'false'}; path=/; max-age=31536000; SameSite=Lax`;
	    }
    }

	function closeOverlays() {
		if (!isDesktop) isSidebarOpen = false;
		isBookmarkOpen = false;
		isAuthOpen = false;
	}

	// ── History widget ───────────────────────────────────────────────────────
	function toggleHistory() {
		isHistoryOpen = !isHistoryOpen;
		if (browser) {
			localStorage.setItem('history_widget_open', String(isHistoryOpen));
		}
	}

	// ── Bookmark / Auth panels ───────────────────────────────────────────────
	function loadBookmarks() {
		bookmarks = getBookmarks();
	}

	function toggleBookmarkPanel() {
		isBookmarkOpen = !isBookmarkOpen;
		isAuthOpen = false;
		if (isBookmarkOpen) loadBookmarks();
	}

	function handleRemoveBookmark(mangaId: string) {
		removeBookmark(mangaId);
		loadBookmarks();
	}

	function toggleAuth() {
		isAuthOpen = !isAuthOpen;
		isBookmarkOpen = false;
	}

	async function handleAuthSuccess() {
		isAuthOpen = false;
		await Promise.all([syncBookmarksOnLogin(), syncHistoryOnLogin()]);
		loadBookmarks();
	}

	async function handleLogout() {
		await logout();
		isAuthOpen = false;
	}

	// ── Navigation ───────────────────────────────────────────────────────────
	function handleNavigate(e: MouseEvent, href: string) {
		e.preventDefault();
		closeOverlays();
		goto(href);
	}

	function goHome(e: MouseEvent) {
		e.preventDefault();
		closeOverlays();

		if (isMultiMode()) {
			goto('/', { invalidateAll: true });
			return;
		}

		let source = $page.url.searchParams.get('source');

		if (!source) {
			const match = $page.url.pathname.match(/^\/(manga|reader)\/([^/]+)/);
			if (match) source = match[2];
		}

		if (!source && browser) {
			source = getImpl();
		}

		if (source) {
			goto(`/?source=${source}`, { invalidateAll: true });
		} else {
			goto('/', { invalidateAll: true });
		}
	}

	// ── Lifecycle ────────────────────────────────────────────────────────────
onMount(() => {
	const mq = window.matchMedia('(min-width: 1024px)');
	// ── Auto-retry Error 1102 ────────────────────────────────────────────────
	const MAX_RETRY = 2;
	const RETRY_KEY = 'rokuyomu_1102_retry';
	const RETRY_DELAY = 1400;

	const isError1102 =
		document.body.innerText.includes('Error 1102') ||
		document.body.innerText.includes('Worker exceeded resource limits');

	if (isError1102) {
		const currentRetry = parseInt(sessionStorage.getItem(RETRY_KEY) || '0', 10);

		if (currentRetry < MAX_RETRY) {
			sessionStorage.setItem(RETRY_KEY, String(currentRetry + 1));

			const overlay = document.createElement('div');
			overlay.id = 'retry-overlay';
			overlay.innerHTML = `
			<div style="
				position:fixed;inset:0;z-index:99999;
				display:flex;align-items:center;justify-content:center;
				background:rgba(12,9,16,0.92);backdrop-filter:blur(8px);
				font-family:system-ui,sans-serif;color:#e4e4e7;
			">
				<div style="text-align:center;">
					<div style="
						width:42px;height:42px;margin:0 auto 16px;
						border:3px solid #3f3f46;border-top-color:#a78bfa;
						border-radius:50%;animation:spin 0.8s linear infinite;
					"></div>
					<div style="font-size:15px;font-weight:500;">Sedang memuat ulang...</div>
					<div style="font-size:12px;color:#71717a;margin-top:6px;">
						Percobaan ${currentRetry + 1} dari ${MAX_RETRY}
					</div>
				</div>
			</div>
			<style>@keyframes spin{to{transform:rotate(360deg)}}</style>
		`;
			document.body.appendChild(overlay);

			setTimeout(() => {
				window.location.reload();
			}, RETRY_DELAY);

			return;
		} else {
			sessionStorage.removeItem(RETRY_KEY);
		}
	} else {
		sessionStorage.removeItem(RETRY_KEY);
	}

	const applyMq = () => {
		isDesktop = mq.matches;

		if (isDesktop) {
			isSidebarOpen = data.sidebarOpen;
		} else {
			isSidebarOpen = false;
		}
	};

	applyMq();
	mq.addEventListener('change', applyMq);

	requestAnimationFrame(() => {
		hasHydrated = true;
	});

	const savedTheme = localStorage.getItem('darkMode');
	applyTheme(savedTheme === null ? true : savedTheme === 'true');

	const savedHistory = localStorage.getItem('history_widget_open');
	if (savedHistory !== null) {
		isHistoryOpen = savedHistory === 'true';
	}

	loadBookmarks();
	window.addEventListener('bookmarks-changed', loadBookmarks);

	loadNotifBadge();
	window.addEventListener('notifications-changed', loadNotifBadge);
	checkForNewChapters().then(loadNotifBadge);

	const onDocClick = (e: MouseEvent) => {
		const t = e.target as HTMLElement;
		if (!t.closest('[data-dropdown]') && !t.closest('[data-dropdown-btn]')) {
			isBookmarkOpen = false;
			isAuthOpen = false;
		}
	};
	document.addEventListener('click', onDocClick);

	let lastScrollY = window.scrollY;

	const handleScroll = () => {
		const currentScrollY = window.scrollY;

		if (currentScrollY <= 10) {
			isHeaderHidden = false;
			lastScrollY = currentScrollY;
			return;
		}

		if (currentScrollY > lastScrollY) {
			isHeaderHidden = true;
		} else if (currentScrollY < lastScrollY) {
			isHeaderHidden = false;
		}

		lastScrollY = currentScrollY;
	};

	window.addEventListener('scroll', handleScroll, { passive: true });
// ── Broken sources (ERROR badge) ───────────────────────────────────────
let unsubBroken: (() => void) | undefined;
if (db) {
	try {
		const qBroken = query(collection(db, 'reports'));
		unsubBroken = onSnapshot(
			qBroken,
			(snap) => {
				const list = snap.docs.map(
					(d) =>
						d.data() as {
							type?: string;
							status?: string;
							sourceId?: string;
						}
				);
				syncBrokenFromReports(list);
			},
			(err) => console.warn('[brokenSources]', err)
		);
	} catch (e) {
		console.warn('[brokenSources] init failed', e);
	}
}

	return () => {
		mq.removeEventListener('change', applyMq);
		window.removeEventListener('bookmarks-changed', loadBookmarks);
		window.removeEventListener('notifications-changed', loadNotifBadge);
		document.removeEventListener('click', onDocClick);
		window.removeEventListener('scroll', handleScroll);
		unsubBroken?.();
	};
});

$effect(() => {
	const user = getUser();
	if (user && browser) {
		const t = setTimeout(() => {
			syncBookmarksOnLogin();
			syncHistoryOnLogin();
		}, 600);
		return () => clearTimeout(t);
	}
});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Kodchasan:wght@400;500;600;700&display=swap"
		rel="stylesheet"
	/>
	<script>
		(function () {
			try {
				var d = localStorage.getItem('darkMode');
				var dark = d === null ? true : d === 'true';
				document.documentElement.classList.toggle('dark', dark);
				document.documentElement.classList.toggle('light', !dark);
			} catch (e) {}
		})();
	</script>
</svelte:head>

<div
	class="theme-root min-h-screen font-[Kodchasan,system-ui,sans-serif] {isDarkMode
		? 'bg-gradient-to-b from-violet-950/70 via-[#0c0910] to-[#0c0910] text-zinc-100'
		: 'bg-[#f5f5f7] text-zinc-900'}"
>
		<!-- ========== LEFT SIDEBAR ========== -->
	{#if isSidebarOpen && !isDesktop}
		<button
			onclick={closeOverlays}
			class="fixed inset-0 z-40 border-none bg-black/50 backdrop-blur-sm"
			aria-label="Close sidebar"
		></button>
	{/if}

	<aside
		class="fixed top-0 bottom-0 left-0 z-50 flex w-[260px] flex-col border-r
			{hasHydrated ? 'transition-transform duration-300' : ''}
			{isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
			{isDarkMode
			? 'border-zinc-800/80 bg-gradient-to-b from-violet-950/70 via-[#0c0910] to-[#0c0910]'
			: 'border-zinc-200 bg-white'}"
	>
		<div
			class="relative z-10 flex h-16 shrink-0 items-center justify-between gap-2 border-b px-4
				{isDarkMode ? 'border-zinc-800/80' : 'border-zinc-200'}"
		>
			<a href="/" onclick={goHome} class="flex min-w-0 items-center">
				<img src={logo} alt="Rokuyomu" class="h-12 w-auto" />
			</a>
			<button
				onclick={toggleSidebar}
				class="shrink-0 rounded-lg p-1.5 transition
					{isDarkMode ? 'text-zinc-400 hover:text-white' : 'text-zinc-500 hover:text-zinc-900'}"
				aria-label="Close sidebar"
			>
				<X class="h-5 w-5" />
			</button>
		</div>

		<nav
			class="relative z-10 flex-1 space-y-0.5 overflow-y-auto p-3 text-sm
				{isDarkMode ? 'text-zinc-400' : 'text-zinc-600'}"
		>
			<!-- Deep Search -->
			<a
				href="/deep-search"
				onclick={(e) => handleNavigate(e, '/deep-search')}
				class="flex items-center gap-3 rounded-lg px-3 py-2.5 transition {navClass()}"
			>
				<Search class="h-5 w-5 shrink-0" />
				Deep Search
			</a>
			<a
				href="/bookmark"
				onclick={(e) => handleNavigate(e, '/bookmark')}
				class="flex items-center gap-3 rounded-lg px-3 py-2.5 transition {navClass()}"
			>
				<Bookmark class="h-5 w-5 shrink-0" /> Bookmark
			</a>
			<a
				href="/notification"
				onclick={(e) => handleNavigate(e, '/notification')}
				class="flex items-center gap-3 rounded-lg px-3 py-2.5 transition {navClass()}"
			>
				<Bell class="h-5 w-5 shrink-0" /> Notifikasi
				{#if notifUnread > 0}
					<span
						class="ml-auto rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white"
					>
						{notifUnread > 99 ? '99+' : notifUnread}
					</span>
				{/if}
			</a>
			<a
				href="/history"
				onclick={(e) => handleNavigate(e, '/history')}
				class="flex items-center gap-3 rounded-lg px-3 py-2.5 transition {navClass()}"
			>
				<History class="h-5 w-5 shrink-0" /> History
			</a>
			<a
				href="/report"
				onclick={(e) => handleNavigate(e, '/report')}
				class="flex items-center gap-3 rounded-lg px-3 py-2.5 transition {navClass()}"
			>
				<MessageSquare class="h-5 w-5 shrink-0" /> Report & Request
			</a>
			<a
				href="/settings"
				onclick={(e) => handleNavigate(e, '/settings')}
				class="flex items-center gap-3 rounded-lg px-3 py-2.5 transition {navClass()}"
			>
				<Settings class="h-5 w-5 shrink-0" /> Settings
			</a>

			<div class="my-2 border-t {isDarkMode ? 'border-zinc-800/80' : 'border-zinc-200'}"></div>

			<a
	            href="https://discord.gg/kkt669knaG"
	            target="_blank"
	            rel="noopener noreferrer"
	            class="flex items-center gap-3 rounded-lg px-3 py-2.5 transition {navClass()}"
>
	         <svg
		        class="h-5 w-5 shrink-0"
		        viewBox="0 0 24 24"
		        fill="currentColor"
		        xmlns="http://www.w3.org/2000/svg"
	>
		     <path
			   d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.635-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
		      /></svg> Discord
           </a>
		</nav>
	</aside>

	<!-- ========== MAIN + HISTORY ========== -->
	<div
		class="flex min-h-screen
			{hasHydrated ? 'transition-[margin] duration-300' : ''}
			{isSidebarOpen ? 'lg:ml-[260px]' : 'ml-0'}
			{!isReaderPage ? 'xl:flex-row' : 'flex-col'}"
	>
		<!-- Left column -->
		<div class="flex min-h-screen min-w-0 flex-1 flex-col">
			<!-- Header -->
<header
	class="sticky top-0 z-40 w-full border-b backdrop-blur-xl
		transition-transform duration-300 ease-in-out
		{isHeaderHidden ? '-translate-y-full' : 'translate-y-0'}
		{isDarkMode
		? 'border-zinc-800/50 bg-gradient-to-b from-violet-950/70 via-[#0c0910]/90 to-[#0c0910]/90'
		: 'border-zinc-200/80 bg-white/90'}"
>
	<div class="flex h-12 w-full items-center justify-between gap-1.5 px-2.5 sm:h-14 sm:gap-2 sm:px-4">
		<!-- Left: menu + logo -->
		<div class="flex min-w-0 shrink items-center gap-1.5">
			{#if !isSidebarOpen}
				<button
					onclick={toggleSidebar}
					class="rounded-lg p-1.5 transition {iconBtnClass()}"
					aria-label="Toggle menu"
				>
					<Menu class="h-5 w-5" />
				</button>
			{/if}

			{#if !isSidebarOpen}
				<a href="/" onclick={goHome} class="flex min-w-0 items-center">
					<img src={logo} alt="Rokuyomu" class="h-9 w-auto max-w-[110px] sm:h-10 sm:max-w-none" />
				</a>
			{/if}
		</div>

		<!-- Right: actions -->
		<div class="relative flex shrink-0 items-center gap-0.5">
			<!-- Notification bell (dekat dark/light mode) -->
			<a
				href="/notification"
				onclick={(e) => handleNavigate(e, '/notification')}
				class="relative rounded-lg p-1.5 transition {iconBtnClass()}"
				aria-label="Notifikasi"
				title="Notifikasi chapter"
			>
				<Bell class="h-5 w-5" />
				{#if notifUnread > 0}
					<span
						class="absolute top-0.5 right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 text-white px-0.5 text-[9px] font-bold text-white"
					>
						{notifUnread > 99 ? '99+' : notifUnread}
					</span>
				{/if}
			</a>

			<!-- Theme -->
			<button
				onclick={toggleDarkMode}
				class="rounded-lg p-1.5 transition
					{isDarkMode
					? 'text-zinc-300 hover:bg-zinc-800/60 hover:text-amber-300'
					: 'text-zinc-600 hover:bg-zinc-100 hover:text-indigo-600'}"
				aria-label="Toggle theme"
			>
				{#if isDarkMode}
					<Sun class="h-5 w-5" />
				{:else}
					<Moon class="h-5 w-5" />
				{/if}
			</button>

			{#if !isReaderPage}
				<button
					onclick={toggleHistory}
					class="hidden rounded-lg p-1.5 transition xl:flex {iconBtnClass(isHistoryOpen)}"
					aria-label="Toggle history"
					title="Reading History"
				>
					<History class="h-5 w-5" />
				</button>
			{/if}

			<!-- Bookmark dropdown -->
			<div class="relative" data-dropdown>
				<button
					data-dropdown-btn
					onclick={toggleBookmarkPanel}
					class="relative rounded-lg p-1.5 transition {iconBtnClass()}"
					aria-label="Bookmarks"
				>
					<Bookmark class="h-5 w-5" />
					{#if bookmarks.length > 0}
						<span
							class="absolute top-0.5 right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-violet-500 text-white px-0.5 text-[9px] font-bold text-white"
						>
							{bookmarks.length > 99 ? '99+' : bookmarks.length}
						</span>
					{/if}
				</button>

				{#if isBookmarkOpen}
					<div
						class="absolute right-0 z-50 mt-2 max-h-[70vh] w-[min(20rem,calc(100vw-1.25rem))] max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border shadow-2xl
							{isDarkMode ? 'border-zinc-800 bg-zinc-900' : 'border-zinc-200 bg-white'}"
					>
						<div
							class="flex items-center justify-between border-b px-4 py-3
								{isDarkMode ? 'border-zinc-800' : 'border-zinc-200'}"
						>
							<p class="text-sm font-semibold">Bookmarks</p>
							<span class="text-xs text-zinc-500">{bookmarks.length} item</span>
						</div>

						{#if bookmarks.length === 0}
							<p class="px-4 py-8 text-center text-xs text-zinc-500">Belum ada bookmark.</p>
						{:else}
							<div class="max-h-[50vh] overflow-y-auto p-2">
								{#each bookmarks as bm}
									{@const mangaHref = formatMangaHref(bm.sourceId, bm.mangaId)}
									<div
										class="group flex items-center gap-3 rounded-lg p-2 transition
											{isDarkMode ? 'hover:bg-zinc-800/80' : 'hover:bg-zinc-100'}"
									>
										<a
											href={mangaHref}
											onclick={(e) => handleNavigate(e, mangaHref)}
											class="flex min-w-0 flex-1 items-center gap-3"
										>
											<div class="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-zinc-800">
												{#if bm.cover}
													<img
														src={proxyCover(bm.cover, bm.sourceId)}
														data-original={bm.cover}
														data-source={bm.sourceId}
														alt={bm.mangaTitle}
														class="h-full w-full object-cover"
														loading="lazy"
														onerror={onCoverError}
													/>
												{/if}
											</div>
											<div class="min-w-0 flex-1">
												<p class="line-clamp-2 text-xs font-medium">{bm.mangaTitle}</p>
												<p class="mt-0.5 text-[10px] text-zinc-500 capitalize">{bm.sourceId}</p>
											</div>
										</a>
										<button
											onclick={() => handleRemoveBookmark(bm.mangaId)}
											class="shrink-0 rounded-md p-1.5 text-zinc-500 opacity-0 transition
												group-hover:opacity-100 hover:bg-red-500/20 hover:text-red-400"
										>
											<Trash2 class="h-3.5 w-3.5" />
										</button>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Auth dropdown -->
			<div class="relative" data-dropdown>
				<button
					data-dropdown-btn
					onclick={toggleAuth}
					class="rounded-lg p-1.5 transition {iconBtnClass()}"
					aria-label="Account"
				>
					{#if isLoading()}
						<span class="flex h-5 w-5 items-center justify-center text-xs opacity-60">...</span>
					{:else if getUser()}
						{#if getUser()?.photoURL}
							<img
								src={getUser()!.photoURL}
								alt="avatar"
								class="h-5 w-5 rounded-full object-cover ring-1 ring-white/20"
							/>
						{:else}
							<span
								class="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-[10px] font-bold text-white"
							>
								{(getUser()?.displayName?.[0] || getUser()?.email?.[0] || 'U').toUpperCase()}
							</span>
						{/if}
					{:else}
						<!-- Icon login polos, sama style bookmark / theme -->
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-5 w-5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
							<circle cx="12" cy="7" r="4" />
						</svg>
					{/if}
				</button>

				{#if isAuthOpen}
					<div
						class="absolute right-0 z-50 mt-2 w-[min(18rem,calc(100vw-1.25rem))] max-w-[calc(100vw-1rem)] rounded-xl border py-2 shadow-xl
							{isDarkMode ? 'border-zinc-800 bg-zinc-900' : 'border-zinc-200 bg-white'}"
					>
						{#if getUser()}
							<!-- Logged in -->
							<div class="border-b px-4 py-3 {isDarkMode ? 'border-zinc-800' : 'border-zinc-200'}">
								<p class="truncate text-sm font-semibold">{getUser()?.displayName || 'User'}</p>
								<p class="truncate text-xs text-zinc-500">{getUser()?.email}</p>
							</div>
							<div class="p-2">
								<button
									onclick={handleLogout}
									class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition
										{isDarkMode
										? 'text-zinc-300 hover:bg-zinc-800'
										: 'text-zinc-700 hover:bg-zinc-100'}"
								>
									<LogOut class="h-4 w-4" /> Logout
								</button>
							</div>
						{:else}
							<!-- Not logged in -->
							<div class="border-b px-4 py-3 {isDarkMode ? 'border-zinc-800' : 'border-zinc-200'}">
								<p class="text-sm font-semibold">Login to Rokuyomu</p>
								<p class="text-xs text-zinc-500">Sync your bookmarks & history</p>
							</div>

							<div class="space-y-2 p-3">
								<!-- Google -->
								<button
									onclick={async () => {
										try {
											await loginWithGoogle();
											await handleAuthSuccess();
										} catch {}
									}}
									class="flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition
										{isDarkMode
										? 'border-zinc-700 bg-zinc-800 text-white hover:bg-zinc-750'
										: 'border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50'}"
								>
									<svg class="h-4 w-4" viewBox="0 0 24 24">
										<path
											fill="currentColor"
											d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
										/>
										<path
											fill="currentColor"
											d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
										/>
										<path
											fill="currentColor"
											d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
										/>
										<path
											fill="currentColor"
											d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
										/>
									</svg>
									Continue with Google
								</button>

								<!-- GitHub -->
								<button
									onclick={async () => {
										try {
											await loginWithGithub();
											await handleAuthSuccess();
										} catch {}
									}}
									class="flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition
										{isDarkMode
										? 'border-zinc-700 bg-zinc-800 text-white hover:bg-zinc-750'
										: 'border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50'}"
								>
									<Github class="h-4 w-4" />
									Continue with GitHub
								</button>

								<div class="relative my-3">
									<div class="absolute inset-0 flex items-center">
										<div class="w-full border-t {isDarkMode ? 'border-zinc-700' : 'border-zinc-200'}"></div>
									</div>
									<div class="relative flex justify-center text-xs">
										<span class="px-2 {isDarkMode ? 'bg-zinc-900 text-zinc-500' : 'bg-white text-zinc-500'}"
											>or email</span
										>
									</div>
								</div>

								<!-- Email form -->
								<EmailLoginForm onSuccess={handleAuthSuccess} {isDarkMode} />
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	</div>
</header>

			<!-- Page content -->
			<main class="flex-1">
				<div class="min-h-full" onclick={closeOverlays} role="presentation">
					{@render children()}
				</div>
			</main>

			<!-- History Widget Mobile -->
			{#if !isReaderPage}
				<div class="border-t xl:hidden {isDarkMode ? 'border-zinc-800/80' : 'border-zinc-200'}">
					{#if isHistoryOpen}
						<div class="flex h-[min(420px,55vh)] max-h-[420px] flex-col overflow-hidden">
							<HistoryWidget bind:open={isHistoryOpen} {isDarkMode} />
						</div>
					{:else}
						<button
							onclick={toggleHistory}
							class="flex w-full items-center justify-center gap-2 py-3.5 text-sm font-medium transition
								{isDarkMode
								? 'bg-zinc-900/80 text-zinc-300 hover:bg-zinc-800'
								: 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}"
						>
							<History class="h-4 w-4" />
							Show My History
						</button>
					{/if}
				</div>
			{/if}

			<!-- Footer -->
			{#if !isReaderPage}
				<Footer {isDarkMode} />
			{/if}
		</div>

		<!-- History Widget Desktop -->
		{#if !isReaderPage}
			<div
				class="sticky top-0 hidden h-screen shrink-0 overflow-hidden transition-all duration-300 ease-in-out xl:flex
					{isHistoryOpen ? 'w-[280px]' : 'w-0'}"
			>
				<HistoryWidget bind:open={isHistoryOpen} {isDarkMode} />
			</div>
		{/if}
	</div>
</div>