<script lang="ts">
	import type { PageData } from './$types';
	import { onMount, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { goto, invalidateAll } from '$app/navigation';
	import {
		ChevronsUp,
		Download,
		Settings,
		CloudDownload
	} from 'lucide-svelte';
	import { saveReading } from '$lib/stores/history';
	import { markChapterRead } from '$lib/utils/readChapters';
	import { downloadChapter } from '$lib/utils/downloadChapter';
import { autoDownloadMangaChapter } from '$lib/utils/autoDownloadOnRead';
	import {
		getOfflineMangaChapter,
		hasOfflineMangaChapter,
		mangaPagesToObjectUrls
	} from '$lib/utils/offlineChapter';
	import { getOfflineChapterIds, ensureLibraryLoaded } from '$lib/stores/library.svelte';

	const { data }: { data: PageData } = $props();
let {
	pages: rawPages,
	source,
	chapterId,
	mangaInfo,
	chapters,
	currentChapter,
	prevChapter,
	nextChapter
} = $derived(data);

let pages = $state<string[]>([]);
	let offlineMode = $state(false);
	let offlineObjectUrls = $state<string[]>([]);

function normChapterId(id: unknown): string {
	return String(id ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
}

function chapterIdMatches(a: string, b: string): boolean {
	if (!a || !b) return false;
	if (a === b) return true;
	return a.endsWith(b) || b.endsWith(a);
}

function revokeOfflineUrls() {
	const prev = untrack(() => offlineObjectUrls);
	for (const u of prev) {
		try {
			URL.revokeObjectURL(u);
		} catch {
			/* ignore */
		}
	}
	offlineObjectUrls = [];
}

$effect(() => {
	if (!browser) return;
	const src = String(source || '');
	const cid = String(chapterId ?? '');
	const incoming = rawPages ?? [];
	const norm = normChapterId(cid);

	if (pendingChapterId && !chapterIdMatches(norm, pendingChapterId)) return;

	let cancelled = false;
	// Keep spinner until offline or network pages are ready — never flash "Images not available"
	chapterLoading = true;
	(async () => {
		try {
			if (src && cid) {
				const row = await getOfflineMangaChapter(src, cid);
				if (cancelled) return;
				if (row?.pages?.length) {
					revokeOfflineUrls();
					const urls = mangaPagesToObjectUrls(row);
					offlineObjectUrls = urls;
					pages = urls;
					offlineMode = true;
					chapterLoading = false;
					pendingChapterId = null;
					currentPageIndex = 0;
					imgEpoch += 1;
					return;
				}
			}
		} catch (e) {
			console.warn('[reader] offline lookup', e);
		}
		if (cancelled) return;
		revokeOfflineUrls();
		offlineMode = false;
		pages = incoming;
		// If server still has no pages, stay in loading only briefly; empty state after
		chapterLoading = false;
		if (pendingChapterId && chapterIdMatches(norm, pendingChapterId)) {
			pendingChapterId = null;
			currentPageIndex = 0;
			imgEpoch += 1;
		}
	})();

	return () => {
		cancelled = true;
	};
});

	// ── Reader state ─────────────────────────────────────────────────────────
	let currentPageIndex = $state(0);
	let currentMode = $state<'webtoon' | 'page'>('webtoon');
	let showControls = $state(true);
	let scrollProgress = $state(0);
	let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;
	let scrollTrackingArmed = false;
	let lastScrollY = $state(0);

	let isMenuOpen = $state(false);
	let showChapterList = $state(false);
	let dataSaver = $state(false);
	let imageQuality = $state(600);
	let imgEpoch = $state(0);
	let chapterLoading = $state(true);
	let pendingChapterId = $state<string | null>(null);

	// ── Theme ──────────────────────────────────────────────────
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

	// ── Download ─────────────────────────────────────────────────────────────
	let isDownloading = $state(false);
	let downloadBannerActive = $state(false);
	let downloadText = $state('Preparing download...');
	let downloadCount = $state('0/0');
	let downloadPercent = $state(0);
	let isOfflineChapter = $state(false);

	// ── Helpers ──────────────────────────────────────────────────────────────
	function proxyImage(url: string, forDownload = false): string {
		if (!url) return '';
		let u = url.trim();
		if (u.startsWith('blob:') || u.startsWith('data:')) return u;
		if (u.startsWith('//')) u = `https:${u}`;
		else if (u.startsWith('/')) u = `https://weloma.net${u}`;

		let filename = 'image.jpg';
		try {
			const path = new URL(u).pathname;
			const last = path.split('/').pop() || '';
			if (last) filename = decodeURIComponent(last);
		} catch {}

		filename = filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'image.jpg';
		if (!/\.[a-zA-Z0-9]{2,5}$/.test(filename)) filename += '.jpg';

		let proxy = `/api/proxy?url=${encodeURIComponent(u)}&source=${source}&filename=${encodeURIComponent(filename)}`;

		if (forDownload) return proxy;

		if (dataSaver && !/ihlv1\.xyz/i.test(u)) {
			proxy += `&w=${imageQuality}`;
		}
		return proxy;
	}

	function measureMangaProgress(): number {
		if (!browser) return 0;
		const total = pages?.length || 0;

		if (currentMode === 'page') {
			if (total <= 1) return total === 1 ? 100 : 0;
			const idx = Math.max(0, Math.min(currentPageIndex, total - 1));
			if (idx >= total - 1) return 100;
			return Math.min(99, Math.round(((idx + 1) / total) * 100));
		}

		const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
		const viewport = window.innerHeight || 1;
		const docH = Math.max(
			document.documentElement.scrollHeight || 0,
			document.body?.scrollHeight || 0,
			0
		);
		const maxScroll = docH - viewport;
		if (maxScroll < 80) return 0;
		if (scrollTop >= maxScroll - 64) return 100;
		return Math.min(100, Math.max(0, Math.round((scrollTop / maxScroll) * 100)));
	}

	function persistMangaProgress(force = false) {
		if (!browser) return;
		const mid = mangaInfo?.id;
		const cid = chapterId;
		const src = source;
		if (!mid || !cid || !src) return;
		if (!force && scrollProgress <= 0) return;
		const title = currentChapter?.title || `Chapter ${currentChapter?.number || 0}`;
		const num = currentChapter?.number || 0;
		try {
			void saveReading({
				mangaId: mid,
				mangaSlug: mangaInfo?.slug || '',
				mangaTitle: mangaInfo?.title || '',
				cover: mangaInfo?.cover || '',
				chapterId: cid,
				chapterTitle: title,
				chapterNumber: num,
				sourceId: src,
				scrollProgress: Math.min(100, Math.max(0, Math.round(scrollProgress)))
			});
		} catch (e) {
			console.warn('[reader] save progress', e);
		}
	}

	function onReadingProgress() {
		const pct = measureMangaProgress();
		if (pct > scrollProgress) {
			scrollProgress = pct;
			scrollTrackingArmed = true;
			if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
			scrollSaveTimer = setTimeout(() => persistMangaProgress(), 300);
		}
	}

	function flushMangaProgress() {
		if (scrollSaveTimer) {
			clearTimeout(scrollSaveTimer);
			scrollSaveTimer = null;
		}
		if (scrollTrackingArmed && scrollProgress > 0) {
			persistMangaProgress(true);
		}
	}

	function handleScroll() {
		const y = window.scrollY;
		if (y > lastScrollY && y > 80) {
			showControls = false;
			isMenuOpen = false;
			showChapterList = false;
		} else {
			showControls = true;
		}
		lastScrollY = y;
		onReadingProgress();
	}

	function handleMouseMove() {
		showControls = true;
	}

	function prevPage() {
		if (currentPageIndex > 0) currentPageIndex--;
	}

	function nextPage() {
		if (currentPageIndex < pages.length - 1) currentPageIndex++;
	}

	function goToPage(index: number) {
		if (index < 0 || index >= pages.length) return;
		currentPageIndex = index;
		if (currentMode === 'webtoon') {
			const imgs = document.querySelectorAll('#reader img');
			imgs[index]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
	}

	function onPageSelect(e: Event) {
		const val = parseInt((e.target as HTMLSelectElement).value, 10);
		goToPage(val);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			isMenuOpen = false;
			showChapterList = false;
		}
		if (currentMode === 'page') {
			if (e.key === 'ArrowLeft') prevPage();
			if (e.key === 'ArrowRight') nextPage();
		}
	}

	function closeMenu() {
		isMenuOpen = false;
		showChapterList = false;
	}

	function toggleMode() {
		currentMode = currentMode === 'webtoon' ? 'page' : 'webtoon';
		localStorage.setItem('readerMode', currentMode);
		currentPageIndex = 0;
	}

	function toggleDataSaver() {
		dataSaver = !dataSaver;
		localStorage.setItem('dataSaver', String(dataSaver));
		imgEpoch++;
		currentPageIndex = 0;
		if (currentMode === 'webtoon') window.scrollTo(0, 0);
	}

	function updateQuality(e: Event) {
		imageQuality = parseInt((e.target as HTMLInputElement).value, 10);
		localStorage.setItem('imageQuality', String(imageQuality));
		if (dataSaver) {
			imgEpoch++;
			currentPageIndex = 0;
			if (currentMode === 'webtoon') window.scrollTo(0, 0);
		}
	}

	function scrollToTop() {
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	async function goToChapter(target: unknown) {
		flushMangaProgress();
		showChapterList = false;
		isMenuOpen = false;
		if (!target) return;
		let rawId =
			typeof target === 'object' && target !== null
				? (target as { id?: string; slug?: string }).id ||
					(target as { slug?: string }).slug
				: target;
		if (!rawId) return;
		const cleanId = normChapterId(rawId);
		if (!cleanId) return;
		if (chapterIdMatches(cleanId, normChapterId(chapterId)) && pages.length > 0) return;

		pendingChapterId = cleanId;
		chapterLoading = true;
		pages = [];
		currentPageIndex = 0;
		imgEpoch += 1;
		try { window.scrollTo(0, 0); } catch {}

		try {
			await goto(`/reader/${source}/${cleanId}`, {
				replaceState: true,
				invalidateAll: true
			});
		} catch (e) {
			console.error('[reader] goToChapter failed', e);
			pendingChapterId = null;
			chapterLoading = false;
		}

		const asked = cleanId;
		setTimeout(() => {
			if (pendingChapterId === asked) {
				pendingChapterId = null;
				chapterLoading = false;
				pages = rawPages ?? [];
			}
		}, 12000);
	}

	async function refreshOfflineStatus() {
		if (!browser || !source || !chapterId) {
			isOfflineChapter = false;
			return;
		}
		const cid = String(chapterId ?? '');
		try {
		
			if (await hasOfflineMangaChapter(String(source), cid)) {
				isOfflineChapter = true;
				return;
			}
	
			if (mangaInfo?.id) {
				await ensureLibraryLoaded();
				const ids = getOfflineChapterIds(source, String(mangaInfo.id));
				const alt = cid.startsWith('/') ? cid.slice(1) : `/${cid}`;
				isOfflineChapter =
					ids.has(cid) || ids.has(alt) || ids.has(cid.replace(/^\/+/, ''));
				return;
			}
			isOfflineChapter = false;
		} catch {
			isOfflineChapter = false;
		}
	}

	$effect(() => {
		chapterId;
		mangaInfo;
		source;
		if (browser) void refreshOfflineStatus();
	});

	$effect(() => {
		if (!browser) return;
		const onLibrary = () => void refreshOfflineStatus();
		window.addEventListener('library-changed', onLibrary);
		return () => window.removeEventListener('library-changed', onLibrary);
	});

	async function handleDownload() {
		if (isDownloading || !chapterId || !source) return;
		isDownloading = true;
		downloadBannerActive = true;
		downloadPercent = 0;
		downloadCount = '0/0';
		downloadText = 'Preparing download…';

		try {
			await downloadChapter({
				source: String(source),
				chapterId: String(chapterId),
				pageUrls: pages?.length ? [...pages] : undefined,
				useReaderDom: true,
				concurrency: 6,
				chapterTitle:
					(currentChapter as { title?: string } | null)?.title ||
					String(chapterId),
				mangaTitle: (mangaInfo as { title?: string } | null)?.title || 'Manga',
				mangaId: (mangaInfo as { id?: string } | null)?.id
					? String((mangaInfo as { id?: string }).id)
					: undefined,
				cover: (mangaInfo as { cover?: string } | null)?.cover || '',
				onProgress: (p) => {
					if (p.phase === 'pages') {
						downloadText = p.message || 'Fetching pages…';
						downloadPercent = 5;
					} else if (p.phase === 'images') {
						downloadText = p.message || `Downloading ${p.current}/${p.total}`;
						downloadCount = `${p.current}/${p.total}`;
						downloadPercent =
							p.total > 0 ? Math.round((p.current / p.total) * 90) : 10;
					} else if (p.phase === 'zip' || p.phase === 'disk') {
						downloadText = p.message || 'Saving…';
						downloadPercent = 95;
					} else if (p.phase === 'done') {
						downloadText = p.message || 'Saved to Offline Library';
						downloadPercent = 100;
					} else if (p.phase === 'error') {
						downloadText = p.message || 'Failed';
					}
				}
			});
			await refreshOfflineStatus();
			downloadPercent = 100;
			if (!downloadText || downloadText.startsWith('Downloading')) {
				downloadText = isOfflineChapter ? 'Saved to Offline Library' : 'Done!';
			}
		} catch (err: any) {
			downloadText = 'Failed: ' + (err?.message || 'unknown');
		}

		setTimeout(() => {
			downloadBannerActive = false;
			isDownloading = false;
		}, 1500);
	}

	onMount(() => {
		if (typeof window !== 'undefined') {
			const u = new URL(window.location.href);
			if (u.searchParams.has('server')) {
				u.searchParams.delete('server');
				const clean = u.pathname + (u.search ? u.search : '') + u.hash;
				history.replaceState(history.state, '', clean);
			}
		}
		syncTheme();
		const obs = new MutationObserver(syncTheme);
		obs.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class']
		});

		const savedMode = localStorage.getItem('readerMode');
		if (savedMode === 'page' || savedMode === 'webtoon') currentMode = savedMode;
		dataSaver = localStorage.getItem('dataSaver') === 'true';
		imageQuality = parseInt(localStorage.getItem('imageQuality') || '600', 10);

		return () => obs.disconnect();
	});

	$effect(() => {
		if (!browser) return;
		const mid = mangaInfo?.id;
		const cid = chapterId;
		const src = source;
		if (!mid || !cid) return;
		const title = currentChapter?.title || `Chapter ${currentChapter?.number || 0}`;
		const num = currentChapter?.number || 0;
		markChapterRead(src, mid, cid, num);
		scrollProgress = 0;
		scrollTrackingArmed = false;
		saveReading({
			mangaId: mid,
			mangaSlug: mangaInfo?.slug || '',
			mangaTitle: mangaInfo?.title || '',
			cover: mangaInfo?.cover || '',
			chapterId: cid,
			chapterTitle: title,
			chapterNumber: num,
			sourceId: src,
			scrollProgress: 0
		});
	});

	$effect(() => {
		const _mode = currentMode;
		const _idx = currentPageIndex;
		const _len = pages?.length || 0;
		if (_mode === 'page' && _len > 0) {
			onReadingProgress();
		}
	});

	$effect(() => {
		if (!browser) return;
		const onVis = () => {
			if (document.visibilityState === 'hidden') flushMangaProgress();
		};
		window.addEventListener('beforeunload', flushMangaProgress);
		document.addEventListener('visibilitychange', onVis);
		return () => {
			flushMangaProgress();
			window.removeEventListener('beforeunload', flushMangaProgress);
			document.removeEventListener('visibilitychange', onVis);
		};
	});
	
	let pageTitle = $derived(
		mangaInfo?.title
			? `${mangaInfo.title} - ${currentChapter?.title || 'Chapter'} | RokuYomu`
			: 'Reader | RokuYomu'
	);
	let pageDesc = $derived(
		mangaInfo?.title
			? `Baca ${mangaInfo.title}${currentChapter?.title ? ` — ${currentChapter.title}` : ''} di RokuYomu`
			: 'Baca chapter manga di RokuYomu'
	);
	let pageImage = $derived(
		mangaInfo?.cover && /^https?:\/\//i.test(String(mangaInfo.cover).trim())
			? String(mangaInfo.cover).trim()
			: ''
	);

	$effect(() => {
		if (!browser || offlineMode) return;
		const src = String(source || '');
		const cid = String(chapterId ?? '');
		const list = pages;
		if (!src || !cid || !Array.isArray(list) || list.length === 0) return;
		if (list.some((u) => String(u).startsWith('blob:'))) return;

		const chTitle =
			(currentChapter && typeof currentChapter === 'object' && 'title' in currentChapter
				? String((currentChapter as { title?: string }).title || '')
				: '') || 'Chapter';
		void autoDownloadMangaChapter({
			source: src,
			chapterId: cid,
			chapterTitle: chTitle,
			mangaTitle: (mangaInfo as { title?: string } | null)?.title || 'Manga',
			mangaId: (mangaInfo as { id?: string } | null)?.id || '',
			cover: (mangaInfo as { cover?: string } | null)?.cover || '',
			pageUrls: list.filter(Boolean)
		}).then(() => refreshOfflineStatus());
	});

</script>

<svelte:window onkeydown={handleKeydown} onscroll={handleScroll} />

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={pageDesc} />

	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="RokuYomu" />
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={pageDesc} />
	{#if pageImage}
		<meta property="og:image" content={pageImage} />
	{/if}

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={pageTitle} />
	<meta name="twitter:description" content={pageDesc} />
	{#if pageImage}
		<meta name="twitter:image" content={pageImage} />
	{/if}
</svelte:head>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="relative flex min-h-screen flex-col font-['Kodchasan',sans-serif]
		{isDarkMode ? 'bg-black text-zinc-100' : 'bg-zinc-100 text-zinc-900'}"
	onmousemove={handleMouseMove}
>
	<!-- Title bar -->
	<div class="relative z-10 px-4 py-3 text-center">
		<p
			class="m-0 text-[1.02em] font-medium opacity-85
				{isDarkMode ? 'text-zinc-200' : 'text-zinc-700'}"
		>
			{#if mangaInfo?.title}{mangaInfo.title}{/if}
			{#if currentChapter?.title}
				{' '}{currentChapter.title}
			{:else}
				Loading chapter...
			{/if}
		</p>
	</div>

	{#if downloadBannerActive}
		<div class="sticky top-0 z-[90] mx-auto mb-1.5 w-full max-w-[900px] px-3">
			<div
				class="flex items-center gap-2.5 rounded-xl border px-3 py-2 backdrop-blur-md
					{isDarkMode
					? 'border-emerald-500/25 bg-black/50'
					: 'border-emerald-500/40 bg-white/80'}"
			>
				<div class="text-emerald-500 {isDownloading ? 'animate-spin' : ''}">
					<CloudDownload class="h-4 w-4" />
				</div>
				<div class="min-w-0 flex-1">
					<p
						class="mb-1 truncate text-[0.76rem] font-medium
							{isDarkMode ? 'text-zinc-200' : 'text-zinc-800'}"
					>
						{downloadText}
					</p>
					<div
						class="h-1 w-full overflow-hidden rounded-full
							{isDarkMode ? 'bg-white/10' : 'bg-zinc-200'}"
					>
						<div
							class="h-full rounded-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all"
							style="width: {downloadPercent}%"
						></div>
					</div>
				</div>
				<span
					class="min-w-[40px] text-right text-[0.72rem] font-semibold
						{isDarkMode ? 'text-zinc-400' : 'text-zinc-500'}"
				>
					{downloadCount}
				</span>
			</div>
		</div>
	{/if}

	<!-- Reader -->
	<main id="reader" class="mx-auto w-full max-w-[900px] flex-1 pb-20">
		{#if chapterLoading}
			<div
				class="flex min-h-[50vh] flex-col items-center justify-center gap-3 py-16 text-center
					{isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}"
			>
				<div
					class="reader-spinner h-9 w-9 animate-spin rounded-full border-2 border-t-transparent"
				></div>
				<p class="text-sm">Loading chapter…</p>
			</div>
		{:else if !pages?.length}
			<div
				class="py-16 text-center
					{isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}"
			>
				Images not available
			</div>
		{:else if currentMode === 'webtoon'}
			{#each pages as pageUrl, i (imgEpoch + '-' + i)}
				<div class="w-full leading-none">
					<img
						src={proxyImage(pageUrl)}
						alt="Page {i + 1}"
						class="block w-full"
						loading={i < 4 ? 'eager' : 'lazy'}
						decoding="async"
						referrerpolicy="no-referrer"
					/>
				</div>
			{/each}
		{:else}
			<div class="flex h-[calc(100vh-140px)] w-full items-center justify-center">
				{#key imgEpoch + '-' + currentPageIndex}
					<img
						src={proxyImage(pages[currentPageIndex])}
						alt="Page {currentPageIndex + 1}"
						class="max-h-full max-w-full object-contain"
						referrerpolicy="no-referrer"
					/>
				{/key}
			</div>
			<button
				onclick={prevPage}
				disabled={currentPageIndex === 0}
				class="fixed top-1/2 left-2 z-[200] -translate-y-1/2 border-0 bg-transparent text-[34px] disabled:opacity-20
					{isDarkMode ? 'text-white/80' : 'text-zinc-800/80'}"
			>
				‹
			</button>
			<button
				onclick={nextPage}
				disabled={currentPageIndex >= pages.length - 1}
				class="fixed top-1/2 right-2 z-[200] -translate-y-1/2 border-0 bg-transparent text-[34px] disabled:opacity-20
					{isDarkMode ? 'text-white/80' : 'text-zinc-800/80'}"
			>
				›
			</button>
		{/if}
	</main>

	{#if isMenuOpen}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div
			class="fixed inset-0 z-[305]"
			onclick={closeMenu}
		></div>
	{/if}

	<div
		class="fixed right-0 bottom-0 left-0 z-[100] flex justify-center gap-[18px] border-t px-5 py-3
			{isDarkMode ? 'border-white/5' : 'border-zinc-300/60 bg-white/70 backdrop-blur-md'}"
	>
		<button
			onclick={() => prevChapter && !chapterLoading && goToChapter(prevChapter)}
			disabled={!prevChapter || chapterLoading}
			aria-label="Previous chapter"
			title="Previous chapter"
			class="flex min-w-[90px] items-center justify-center gap-1 rounded-[15px] border px-[15px] py-[5px] text-[0.92em] backdrop-blur-md transition disabled:cursor-not-allowed disabled:opacity-30
				{isDarkMode
					? 'reader-nav-btn reader-nav-btn-dark'
					: 'reader-nav-btn reader-nav-btn-light'}"
		>
			<svg
				viewBox="0 0 24 24"
				width="20"
				height="20"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<path d="M13 5l-7 7 7 7" />
				<path d="M19 5l-7 7 7 7" opacity="0.6" />
			</svg>
		</button>

		{#if offlineMode}
			<span
				class="flex min-w-[72px] items-center justify-center self-center rounded-full bg-emerald-600/90 px-3 py-1.5 text-[10px] font-bold tracking-wide text-white shadow-sm"
				title="Reading from offline storage"
			>
				OFFLINE
			</span>
		{/if}

		<button
			onclick={() => nextChapter && !chapterLoading && goToChapter(nextChapter)}
			disabled={!nextChapter || chapterLoading}
			aria-label="Next chapter"
			title="Next chapter"
			class="flex min-w-[90px] items-center justify-center gap-1 rounded-[15px] border px-[15px] py-[5px] text-[0.92em] backdrop-blur-md transition disabled:cursor-not-allowed disabled:opacity-30
				{isDarkMode
					? 'reader-nav-btn reader-nav-btn-dark'
					: 'reader-nav-btn reader-nav-btn-light'}"
		>
			<svg
				viewBox="0 0 24 24"
				width="20"
				height="20"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<path d="M11 5l7 7-7 7" />
				<path d="M5 5l7 7-7 7" opacity="0.6" />
			</svg>
		</button>
	</div>

	<div class="fixed right-[15px] bottom-[78px] z-[320] flex flex-col items-center gap-2.5">
	<button
		onclick={scrollToTop}
		class="flex h-10 w-10 items-center justify-center rounded-full border-0 bg-[rgba(0,150,255,0.15)] text-[18px] text-[#4da6ff] backdrop-blur-md transition hover:scale-108 hover:bg-[rgba(0,150,255,0.25)]"
		title="Scroll to top"
	>
		<ChevronsUp class="h-5 w-5" />
	</button>

	<button
		onclick={handleDownload}
		disabled={isDownloading || !pages?.length}
		class="flex h-10 w-10 items-center justify-center rounded-full border-0 backdrop-blur-md transition hover:scale-108 disabled:opacity-50
			{isOfflineChapter
				? 'bg-[rgba(139,92,246,0.25)] text-[#c4b5fd] hover:bg-[rgba(139,92,246,0.35)]'
				: 'bg-[rgba(0,200,120,0.15)] text-[#35d98a] hover:bg-[rgba(0,200,120,0.25)]'}"
		title={isOfflineChapter ? 'Sudah di Offline Library (download ulang)' : 'Download ke Offline Library'}
	>
		{#if isOfflineChapter}
			<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
				<path d="M20 6 9 17l-5-5" />
			</svg>
		{:else}
			<Download class="h-5 w-5" />
		{/if}
	</button>

	<div class="relative z-[330]">
		<button
			onclick={() => {
				isMenuOpen = !isMenuOpen;
				if (!isMenuOpen) showChapterList = false;
			}}
			class="reader-gear flex h-[42px] w-[42px] items-center justify-center rounded-full border-0 bg-transparent text-[21px] transition hover:rotate-90"
			title="Settings"
		>
			<Settings class="h-6 w-6" strokeWidth={2} />
		</button>

		{#if isMenuOpen}
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
			<div
				class="absolute right-0 bottom-[52px] z-[340] flex max-h-[65vh] w-[210px] flex-col gap-2 overflow-y-auto rounded-xl px-3.5 py-3 shadow-[0_6px_25px_rgba(0,0,0,0.35)]
					{isDarkMode ? 'bg-black/85' : 'border border-zinc-200 bg-white/95'}"
				onclick={(e) => e.stopPropagation()}
			>
				<button
					onclick={toggleMode}
					class="reader-menu-btn w-full rounded-lg border-0 px-3 py-2.5 text-left text-[0.87em] font-medium text-white transition"
				>
					Mode: {currentMode === 'webtoon' ? 'Webtoon' : 'Page'}
				</button>

				<select
					class="reader-menu-btn w-full cursor-pointer rounded-lg border-0 px-3 py-2.5 text-[0.87em] text-white outline-none"
					value={currentPageIndex}
					onchange={onPageSelect}
				>
					{#each pages as _, i}
						<option value={i} class="bg-zinc-900 text-white">
							Page {i + 1} / {pages.length}
						</option>
					{/each}
				</select>

				<button
					onclick={() => (showChapterList = !showChapterList)}
					class="reader-menu-btn w-full rounded-lg border-0 px-3 py-2.5 text-left text-[0.87em] font-medium text-white transition"
				>
					Chapter List
				</button>

				{#if showChapterList}
	<div
		class="max-h-[280px] overflow-y-auto rounded-lg py-1
			{isDarkMode ? 'bg-[rgba(25,25,25,0.8)]' : 'bg-zinc-100'}"
	>
		{#each [...(chapters || [])].reverse() as chapter}
			<button
				onclick={() => goToChapter(chapter)}
				class="w-full border-b px-3 py-2 text-left text-[0.84em] transition last:border-b-0
					{isDarkMode
						? 'border-zinc-600/80 text-white hover:bg-white/10'
						: 'border-zinc-200 text-zinc-800 hover:bg-zinc-200/80'}
					{chapter.id === chapterId || chapter.id === currentChapter?.id
						? 'reader-chapter-active font-medium'
						: ''}"
			>
				{chapter.title}
			</button>
		{/each}
		{#if !chapters?.length}
			<p
				class="px-3 py-2 text-center text-[0.84em]
					{isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}"
			>
				Empty
			</p>
		{/if}
	</div>
{/if}

				<div
					class="flex items-center justify-between px-0.5 py-1 text-[0.87em]
						{isDarkMode ? 'text-white' : 'text-zinc-800'}"
				>
					<span>Data Saver</span>
					<input
						type="checkbox"
						checked={dataSaver}
						onchange={toggleDataSaver}
						class="reader-accent-input h-4 w-4 cursor-pointer"
					/>
				</div>

				{#if dataSaver}
					<div
						class="flex flex-col gap-1.5
							{isDarkMode ? 'text-white' : 'text-zinc-800'}"
					>
						<label for="image-quality" class="text-[0.8em]">
							Quality:
							<span class="font-semibold text-emerald-500">{imageQuality}</span>px
						</label>
						<input
							id="image-quality"
							type="range"
							min="600"
							max="1200"
							step="100"
							value={imageQuality}
							oninput={updateQuality}
							class="reader-accent-input w-full cursor-pointer"
						/>
					</div>
				{/if}
			</div>
		{/if}
	</div>
  </div>
</div>

<style>
	.reader-nav-btn {
		background-color: color-mix(in srgb, var(--accent, #9333ea) 85%, transparent) !important;
		border-color: color-mix(in srgb, var(--accent, #9333ea) 40%, transparent) !important;
		color: #fff !important;
	}
	.reader-nav-btn:hover:not(:disabled) {
		background-color: var(--accent, #9333ea) !important;
		filter: brightness(1.05);
	}
	.reader-nav-btn-dark {
		background-color: color-mix(in srgb, var(--accent, #9333ea) 50%, transparent) !important;
		border-color: rgba(255, 255, 255, 0.15) !important;
		color: rgba(255, 255, 255, 0.9) !important;
	}
	.reader-nav-btn-dark:hover:not(:disabled) {
		background-color: color-mix(in srgb, var(--accent, #9333ea) 70%, transparent) !important;
	}
	.reader-menu-btn {
		background-color: var(--accent, #6b21a8) !important;
		color: #fff !important;
	}
	.reader-menu-btn:hover {
		filter: brightness(1.1);
	}
	.reader-gear {
		color: var(--accent, #a855f7) !important;
	}
	.reader-chapter-active {
		background-color: color-mix(in srgb, var(--accent, #a855f7) 25%, transparent) !important;
	}
	.reader-accent-input {
		accent-color: var(--accent, #9333ea);
	}
	.reader-spinner {
		border-color: var(--accent, #8b5cf6);
		border-top-color: transparent;
	}
</style>
