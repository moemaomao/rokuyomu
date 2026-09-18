<script lang="ts">
	import type { PageData } from './$types';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto, invalidateAll } from '$app/navigation';
	import {
		ChevronsUp,
		Download,
		Settings,
		CloudDownload
	} from 'lucide-svelte';
	import { saveReading } from '$lib/stores/history';

	const { data }: { data: PageData } = $props();
	let {
		pages,
		source,
		chapterId,
		mangaInfo,
		chapters,
		currentChapter,
		prevChapter,
		nextChapter
	} = $derived(data);

	// ── Reader state ─────────────────────────────────────────────────────────
	let currentPageIndex = $state(0);
	let currentMode = $state<'webtoon' | 'page'>('webtoon');
	let showControls = $state(true);
	let lastScrollY = $state(0);

	let isMenuOpen = $state(false);
	let showChapterList = $state(false);
	let dataSaver = $state(false);
	let imageQuality = $state(600);
	let imgEpoch = $state(0);

	// ── Theme (ikut layout) ──────────────────────────────────────────────────
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

	// ── Helpers ──────────────────────────────────────────────────────────────
	function proxyImage(url: string, forDownload = false): string {
		if (!url) return '';
		let u = url.trim();
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
		showChapterList = false;
		isMenuOpen = false;
		if (!target) return;
		let rawId =
			typeof target === 'object' && target !== null
				? (target as { id?: string; slug?: string }).id ||
					(target as { slug?: string }).slug
				: target;
		if (!rawId) return;
		const cleanId = String(rawId).replace(/^\/+/, '');
		currentPageIndex = 0;
		// Force reload data chapter baru
		await goto(`/reader/${source}/${cleanId}`, { replaceState: true, invalidateAll: true });
		await invalidateAll();
		window.scrollTo(0, 0);
	}

	// ── Download ZIP ─────────────────────────────────────────────────────────
	let jszipReady: Promise<any> | null = null;

	function loadJSZip(): Promise<any> {
		if ((window as any).JSZip) return Promise.resolve((window as any).JSZip);
		if (jszipReady) return jszipReady;
		jszipReady = new Promise((resolve, reject) => {
			const s = document.createElement('script');
			s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
			s.onload = () => resolve((window as any).JSZip);
			s.onerror = () => reject(new Error('Failed to load JSZip'));
			document.head.appendChild(s);
		});
		return jszipReady;
	}

	async function handleDownload() {
		if (isDownloading || !pages?.length) return;
		isDownloading = true;
		downloadBannerActive = true;
		downloadPercent = 0;
		downloadCount = `0/${pages.length}`;
		downloadText = 'Loading JSZip...';

		try {
			const JSZip = await loadJSZip();
			const zip = new JSZip();
			const folderName = (
				`${mangaInfo?.title || 'manga'}_${currentChapter?.title || chapterId}`
			)
				.replace(/[^\w\s.-]/g, '')
				.replace(/\s+/g, '_')
				.slice(0, 80);

			downloadText = 'Downloading images...';
			for (let i = 0; i < pages.length; i++) {
				try {
					const res = await fetch(proxyImage(pages[i], true));
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					const blob = await res.blob();
					const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
					zip.file(`${folderName}/${String(i + 1).padStart(3, '0')}.${ext}`, blob);
				} catch (err) {
					console.warn('Failed to download page', i + 1, err);
				}
				downloadPercent = Math.round(((i + 1) / pages.length) * 100);
				downloadCount = `${i + 1}/${pages.length}`;
				downloadText = `Downloading image ${i + 1} of ${pages.length}...`;
			}

			downloadText = 'Creating ZIP file...';
			const content = await zip.generateAsync({ type: 'blob' });
			const a = document.createElement('a');
			a.href = URL.createObjectURL(content);
			a.download = `${folderName}.zip`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(a.href);
			downloadText = 'Done!';
			downloadPercent = 100;
		} catch (err: any) {
			downloadText = 'Failed: ' + (err?.message || 'unknown');
		}

		setTimeout(() => {
			downloadBannerActive = false;
			isDownloading = false;
		}, 1500);
	}

	// ── Lifecycle ────────────────────────────────────────────────────────────
	onMount(() => {
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

		if (mangaInfo?.id) {
			saveReading({
				mangaId: mangaInfo.id,
				mangaSlug: mangaInfo.slug || '',
				mangaTitle: mangaInfo.title || '',
				cover: mangaInfo.cover || '',
				chapterId: chapterId,
				chapterTitle: currentChapter?.title || `Chapter ${currentChapter?.number || 0}`,
				chapterNumber: currentChapter?.number || 0,
				sourceId: source
			});
		}

		return () => obs.disconnect();
	});
	
	// ── SEO / share card ─────────────────────────────────────────────────────
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

	<!-- Download banner -->
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
		{#if !pages?.length}
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
			onclick={() => prevChapter && goToChapter(prevChapter)}
			disabled={!prevChapter}
			aria-label="Previous chapter"
			title="Previous chapter"
			class="flex min-w-[90px] items-center justify-center gap-1 rounded-[15px] border px-[15px] py-[5px] text-[0.92em] backdrop-blur-md transition disabled:cursor-not-allowed disabled:opacity-30
				{isDarkMode
					? 'border-white/15 bg-purple-600/50 text-white/85 hover:bg-purple-600/70'
					: 'border-zinc-300 bg-purple-600/85 text-white hover:bg-purple-600'}"
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

		<button
			onclick={() => nextChapter && goToChapter(nextChapter)}
			disabled={!nextChapter}
			aria-label="Next chapter"
			title="Next chapter"
			class="flex min-w-[90px] items-center justify-center gap-1 rounded-[15px] border px-[15px] py-[5px] text-[0.92em] backdrop-blur-md transition disabled:cursor-not-allowed disabled:opacity-30
				{isDarkMode
					? 'border-white/15 bg-purple-600/50 text-white/85 hover:bg-purple-600/70'
					: 'border-zinc-300 bg-purple-600/85 text-white hover:bg-purple-600'}"
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
		class="flex h-10 w-10 items-center justify-center rounded-full border-0 bg-[rgba(0,200,120,0.15)] text-[18px] text-[#35d98a] backdrop-blur-md transition hover:scale-108 hover:bg-[rgba(0,200,120,0.25)] disabled:opacity-50"
		title="Download ZIP"
	>
		<Download class="h-5 w-5" />
	</button>

	<div class="relative z-[330]">
		<button
			onclick={() => {
				isMenuOpen = !isMenuOpen;
				if (!isMenuOpen) showChapterList = false;
			}}
			class="flex h-[42px] w-[42px] items-center justify-center rounded-full border-0 bg-transparent text-[21px] text-purple-500 transition hover:rotate-90"
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
					class="w-full rounded-lg border-0 bg-purple-800 px-3 py-2.5 text-left text-[0.87em] font-medium text-white transition hover:bg-purple-700"
				>
					Mode: {currentMode === 'webtoon' ? 'Webtoon' : 'Page'}
				</button>

				<select
					class="w-full cursor-pointer rounded-lg border-0 bg-purple-800 px-3 py-2.5 text-[0.87em] text-white outline-none"
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
					class="w-full rounded-lg border-0 bg-purple-800 px-3 py-2.5 text-left text-[0.87em] font-medium text-white transition hover:bg-purple-700"
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
						? 'bg-purple-500/25 font-medium'
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
						class="h-4 w-4 cursor-pointer accent-purple-600"
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
							class="w-full cursor-pointer accent-purple-600"
						/>
					</div>
				{/if}
			</div>
		{/if}
	</div>
  </div>
</div>