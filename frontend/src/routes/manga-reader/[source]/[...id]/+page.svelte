<script lang="ts">
	import type { PageData } from './$types';
	import { onMount, tick, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { goto, invalidateAll } from '$app/navigation';
	import {
		ChevronsUp,
		Download,
		Settings,
		BookOpen,
		ChevronDown,
		WifiOff
	} from 'lucide-svelte';
	import { saveReading } from '$lib/stores/history';
	import { getReadSets, markChapterRead } from '$lib/utils/readChapters';
	import { downloadChapter } from '$lib/utils/downloadManga';
	import { autoDownloadMangaChapter } from '$lib/utils/autoDownloadOnRead';
	import {
		getOfflineMangaChapter,
		hasOfflineMangaChapter,
		listOfflineMangaChapters,
		mangaPagesToObjectUrls
	} from '$lib/utils/offlineChapter';
	import { getOfflineChapterIds, ensureLibraryLoaded } from '$lib/stores/download.svelte';
	import {
		getPreferences,
		setPreferences,
		subscribePreferences
	} from '$lib/stores/preferences';
	import DownloadFolderOnboarding from '$lib/components/DownloadFolderOnboarding.svelte';

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
	let readChapterIds = $state(new Set<string>());
	let readChapterNumbers = $state(new Set<number>());

function normChapterId(id: unknown): string {
	return String(id ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
}

function chapterIdMatches(a: string, b: string): boolean {
	if (!a || !b) return false;
	if (a === b) return true;
	return a.endsWith(b) || b.endsWith(a);
}

function refreshReadChapters() {
	const mangaId = String(mangaInfo?.id || '');
	if (!source || !mangaId) {
		readChapterIds = new Set();
		readChapterNumbers = new Set();
		return;
	}
	const sets = getReadSets(source, mangaId);
	readChapterIds = sets.ids;
	readChapterNumbers = sets.nums;
}

function isReadChapter(chapter: { id?: string | number; number?: number } | null): boolean {
	if (!chapter) return false;
	const chapterKey = normChapterId(chapter.id);
	if (
		chapterKey &&
		[...readChapterIds].some((readId) =>
			chapterIdMatches(normChapterId(readId), chapterKey)
		)
	) {
		return true;
	}
	const number = Number(chapter.number);
	return Number.isFinite(number) && number > 0 && readChapterNumbers.has(number);
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

	if (untrack(() => pendingChapterId) && !chapterIdMatches(norm, untrack(() => pendingChapterId) || '')) {
		return;
	}

	let cancelled = false;
	const already = untrack(
		() => offlineMode && pages.length > 0
	);
	if (!already) {
		chapterLoading = true;
	}

	(async () => {
		try {
			if (src && cid) {
				const row = await getOfflineMangaChapter(src, cid, {
					mangaTitle: String(mangaInfo?.title || ''),
					mangaId: String(mangaInfo?.id || ''),
					chapterTitle: String(currentChapter?.title || ''),
					allowDisk: true
				});
				if (cancelled) return;
				if (row?.pages?.length) {
					const total = Math.min(row.pages.length, 40);
					const BATCH = 3;
					untrack(() => revokeOfflineUrls());
					const urls: string[] = [];
					for (let i = 0; i < total; i++) {
						if (cancelled) return;
						try {
							urls.push(URL.createObjectURL(row.pages[i].blob));
						} catch (e) {
							console.warn('[reader] objectURL', i, e);
							break;
						}
						if (i === Math.min(BATCH, total) - 1 || i === total - 1) {
							offlineObjectUrls = urls.slice();
							pages = urls.slice();
							offlineMode = true;
							chapterLoading = false;
							pendingChapterId = null;
							if (i === Math.min(BATCH, total) - 1) {
								currentPageIndex = 0;
								imgEpoch += 1;
							}
						}
						if (i < total - 1 && (i + 1) % BATCH === 0) {
							await new Promise((r) => setTimeout(r, 32));
						}
					}
					imgEpoch += 1;
					return;
				}
			}
		} catch (e) {
			console.warn('[reader] offline lookup', e);
		}
		if (cancelled) return;
		if (untrack(() => offlineMode && pages.length > 0) && !(incoming?.length)) {
			chapterLoading = false;
			return;
		}
		untrack(() => revokeOfflineUrls());
		offlineMode = false;
		pages = incoming;
		chapterLoading = false;
		pendingChapterId = null;
	})();

	return () => {
		cancelled = true;
	};
});

	// ── Reader state ─────────────────────────────────────────────────────────
	let currentPageIndex = $state(0);
	let currentMode = $state<'webtoon' | 'page' | 'ltr'>('webtoon');
	let showControls = $state(true);
	let scrollProgress = $state(0);
	let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;
	let scrollTrackingArmed = false;
	let lastScrollY = $state(0);

	let isMenuOpen = $state(false);
	let showChapterList = $state(false);
	let chapterListContainer = $state<HTMLDivElement | null>(null);
	let chapterListElement = $state<HTMLDivElement | null>(null);
	let dataSaver = $state(false);
	let autoDownloadOnRead = $state(getPreferences().autoDownloadOnRead);
	let imageQuality = $state(600);
	let imgEpoch = $state(0);
	let chapterLoading = $state(true);
	let pendingChapterId = $state<string | null>(null);

	onMount(() =>
		subscribePreferences((preferences) => {
			autoDownloadOnRead = preferences.autoDownloadOnRead;
		})
	);

	$effect(() => {
		if (!showChapterList) return;
		const activeChapterId = normChapterId(chapterId);
		void tick().then(() => {
			if (!showChapterList || !chapterListElement) return;
			const activeChapter = [
				...chapterListElement.querySelectorAll<HTMLElement>('[data-chapter-id]')
			].find((element) => element.dataset.chapterId === activeChapterId);
			activeChapter?.scrollIntoView({ block: 'nearest' });
		});
	});

	function handlePointerDown(e: PointerEvent) {
		if (
			showChapterList &&
			chapterListContainer &&
			e.target instanceof Node &&
			!chapterListContainer.contains(e.target)
		) {
			showChapterList = false;
		}
	}

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
	let downloadText = $state('Preparing download...');
	let downloadPercent = $state(0);
	let isOfflineChapter = $state(false);
	let downloadingChapterId = $state('');
	let offlineChapterIds = $state(new Set<string>());

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

		if (currentMode !== 'webtoon') {
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
		if (currentMode !== 'webtoon') {
			if (e.key === 'ArrowLeft') currentMode === 'ltr' ? prevPage() : nextPage();
			if (e.key === 'ArrowRight') currentMode === 'ltr' ? nextPage() : prevPage();
		}
	}

	function closeMenu() {
		isMenuOpen = false;
		showChapterList = false;
	}

	function toggleMode() {
		currentMode =
			currentMode === 'webtoon' ? 'page' : currentMode === 'page' ? 'ltr' : 'webtoon';
		setPreferences({ mangaReaderMode: currentMode });
		currentPageIndex = 0;
	}

	function toggleDataSaver() {
		dataSaver = !dataSaver;
		setPreferences({ mangaDataSaver: dataSaver });
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
		currentPageIndex = 0;
		imgEpoch += 1;
		try { window.scrollTo(0, 0); } catch {}

		try {
			const targetChapter = chapters.find(
				(ch) => chapterIdMatches(normChapterId(ch.id), cleanId)
			);
			const row = await getOfflineMangaChapter(String(source), cleanId, {
				mangaTitle: String(mangaInfo?.title || ''),
				mangaId: String(mangaInfo?.id || ''),
				chapterTitle: String(targetChapter?.title || ''),
				allowDisk: true
			});
			if (row?.pages?.length) {
				revokeOfflineUrls();
				const total = Math.min(row.pages.length, 40);
				const BATCH = 3;
				const urls: string[] = [];
				for (let i = 0; i < total; i++) {
					try {
						urls.push(URL.createObjectURL(row.pages[i].blob));
					} catch {
						break;
					}
					if (i === Math.min(BATCH, total) - 1 || i === total - 1) {
						offlineObjectUrls = urls.slice();
						pages = urls.slice();
						offlineMode = true;
						chapterLoading = false;
					}
					if (i < total - 1 && (i + 1) % BATCH === 0) {
						await new Promise((r) => setTimeout(r, 32));
					}
				}
				try {
					await goto(`/manga-reader/${source}/${cleanId}`, {
						replaceState: true,
						invalidateAll: false,
						noScroll: true
					});
				} catch (e) {
					console.warn('[reader] offline goto', e);
				}
				pendingChapterId = null;
				return;
			}
		} catch (e) {
			console.warn('[reader] offline prefetch', e);
		}

		chapterLoading = true;
		pages = [];

		try {
			await goto(`/manga-reader/${source}/${cleanId}`, {
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

	function isChapterOffline(id: unknown): boolean {
		const chapterId = normChapterId(id);
		return Boolean(
			chapterId &&
				[...offlineChapterIds].some((offlineId) =>
					chapterIdMatches(normChapterId(offlineId), chapterId)
				)
		);
	}

	async function refreshOfflineStatus() {
		if (!browser || !source || !chapterId) {
			isOfflineChapter = false;
			offlineChapterIds = new Set();
			return;
		}
		const cid = String(chapterId ?? '');
		try {
			if (mangaInfo?.id) {
				await ensureLibraryLoaded();
				const ids = getOfflineChapterIds(source, String(mangaInfo.id));
				const savedChapters = await listOfflineMangaChapters(source, String(mangaInfo.id));
				offlineChapterIds = new Set([
					...ids,
					...savedChapters.map((chapter) => chapter.chapterId)
				]);
				const alt = cid.startsWith('/') ? cid.slice(1) : `/${cid}`;
				isOfflineChapter = [...offlineChapterIds].some((id) =>
					chapterIdMatches(normChapterId(id), normChapterId(cid))
				) || ids.has(cid) || ids.has(alt);
				if (!isOfflineChapter && await hasOfflineMangaChapter(String(source), cid)) {
					isOfflineChapter = true;
					offlineChapterIds = new Set([...offlineChapterIds, cid]);
				}
				return;
			}
			isOfflineChapter = await hasOfflineMangaChapter(String(source), cid);
			offlineChapterIds = isOfflineChapter ? new Set([cid]) : new Set();
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
		refreshReadChapters();
		const onReadChaptersChanged = () => refreshReadChapters();
		window.addEventListener('read-chapters-changed', onReadChaptersChanged);
		const onLibrary = () => void refreshOfflineStatus();
		window.addEventListener('library-changed', onLibrary);
		return () => {
			window.removeEventListener('read-chapters-changed', onReadChaptersChanged);
			window.removeEventListener('library-changed', onLibrary);
		};
	});

	async function handleDownload(chapter: { id?: string | number; title?: string } | null = null) {
		const targetChapterId = String(chapter?.id ?? chapterId ?? '');
		if (isDownloading || !targetChapterId || !source) return;
		isDownloading = true;
		downloadingChapterId = targetChapterId;
		downloadPercent = 0;
		downloadText = 'Preparing download…';

		try {
			await downloadChapter({
				source: String(source),
				chapterId: targetChapterId,
				pageUrls:
					chapterIdMatches(normChapterId(targetChapterId), normChapterId(chapterId)) &&
					pages?.length
						? [...pages]
						: undefined,
				useReaderDom: chapterIdMatches(
					normChapterId(targetChapterId),
					normChapterId(chapterId)
				),
				concurrency: 6,
				chapterTitle:
					chapter?.title ||
					(chapterIdMatches(normChapterId(targetChapterId), normChapterId(chapterId))
						? (currentChapter as { title?: string } | null)?.title
						: undefined) ||
					targetChapterId,
				mangaTitle: (mangaInfo as { title?: string } | null)?.title || 'Manga',
				mangaId: (mangaInfo as { id?: string } | null)?.id
					? String((mangaInfo as { id?: string }).id)
					: undefined,
				synopsis: (mangaInfo as { description?: string } | null)?.description,
				genres: (mangaInfo as { genres?: string[] } | null)?.genres,
				author: (mangaInfo as { author?: string } | null)?.author,
				artist: (mangaInfo as { artist?: string } | null)?.artist,
				type: (mangaInfo as { type?: string } | null)?.type,
				cover: (mangaInfo as { cover?: string } | null)?.cover || '',
				onProgress: (p) => {
					if (p.phase === 'pages') {
						downloadText = p.message || 'Fetching pages…';
						downloadPercent = 5;
					} else if (p.phase === 'images') {
						downloadText = p.message || `Downloading ${p.current}/${p.total}`;
						downloadPercent =
							p.total > 0 ? Math.round((p.current / p.total) * 90) : 10;
					} else if (p.phase === 'zip' || p.phase === 'disk') {
						downloadText = p.message || 'Saving…';
						downloadPercent = 95;
					} else if (p.phase === 'done') {
						downloadText = p.message || 'Saved for offline reading';
						downloadPercent = 100;
					} else if (p.phase === 'error') {
						downloadText = p.message || 'Failed';
					}
				}
			});
			offlineChapterIds = new Set([...offlineChapterIds, targetChapterId]);
			if (chapterIdMatches(normChapterId(targetChapterId), normChapterId(chapterId))) {
				await refreshOfflineStatus();
			}
			downloadPercent = 100;
			if (!downloadText || downloadText.startsWith('Downloading')) {
				downloadText = isOfflineChapter ? 'Saved for offline reading' : 'Done!';
			}
		} catch (err: any) {
			downloadText = 'Failed: ' + (err?.message || 'unknown');
		}

		setTimeout(() => {
			isDownloading = false;
			downloadingChapterId = '';
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

		const preferences = getPreferences();
		currentMode = preferences.mangaReaderMode;
		dataSaver = preferences.mangaDataSaver;
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
		if (_mode !== 'webtoon' && _len > 0) {
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
		if (!autoDownloadOnRead) return;
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
			synopsis: (mangaInfo as { description?: string } | null)?.description,
			genres: (mangaInfo as { genres?: string[] } | null)?.genres,
			author: (mangaInfo as { author?: string } | null)?.author,
			artist: (mangaInfo as { artist?: string } | null)?.artist,
			type: (mangaInfo as { type?: string } | null)?.type,
			cover: (mangaInfo as { cover?: string } | null)?.cover || '',
			pageUrls: list.filter(Boolean)
		}).then(() => refreshOfflineStatus());
	});

</script>

<svelte:window onkeydown={handleKeydown} onpointerdown={handlePointerDown} onscroll={handleScroll} />

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
	<DownloadFolderOnboarding />
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

	<!-- Reader -->
	<main id="reader" class="relative mx-auto w-full max-w-[900px] flex-1 pb-20">
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
				onclick={() => (currentMode === 'ltr' ? prevPage() : nextPage())}
				disabled={currentMode === 'ltr'
					? currentPageIndex === 0
					: currentPageIndex >= pages.length - 1}
				class="absolute top-1/2 left-2 z-[200] -translate-y-1/2 border-0 bg-transparent text-[34px] disabled:opacity-20
					{isDarkMode ? 'text-white/80' : 'text-zinc-800/80'}"
			>
				‹
			</button>
			<button
				onclick={() => (currentMode === 'ltr' ? nextPage() : prevPage())}
				disabled={currentMode === 'ltr'
					? currentPageIndex >= pages.length - 1
					: currentPageIndex === 0}
				class="absolute top-1/2 right-2 z-[200] -translate-y-1/2 border-0 bg-transparent text-[34px] disabled:opacity-20
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
		class="fixed right-0 bottom-0 left-0 z-[100] flex justify-center gap-2 border-t px-2 py-3 sm:gap-[18px] sm:px-5
			{isDarkMode ? 'border-white/5' : 'border-transparent'}"
	>
		<button
			onclick={() => prevChapter && !chapterLoading && goToChapter(prevChapter)}
			disabled={!prevChapter || chapterLoading}
			aria-label="Previous chapter"
			title="Previous chapter"
			class="flex min-w-[64px] items-center justify-center gap-1 rounded-[15px] border px-2 py-[5px] text-[0.92em] backdrop-blur-md transition disabled:cursor-not-allowed disabled:opacity-30 sm:min-w-[90px] sm:px-[15px]
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

		<div class="relative pointer-events-auto" bind:this={chapterListContainer}>
			<button
				type="button"
				class="flex min-w-[72px] max-w-[min(42vw,13rem)] items-center justify-center gap-1 rounded-[15px] border px-2 py-[7px] text-[0.82em] transition
					{isDarkMode
						? 'reader-nav-btn reader-nav-btn-dark'
						: 'reader-nav-btn reader-nav-btn-light'}"
				aria-label="Open chapter list"
				aria-expanded={showChapterList}
				aria-controls="manga-chapter-list"
				onclick={() => {
					showChapterList = !showChapterList;
					isMenuOpen = false;
				}}
			>
				<BookOpen class="h-4 w-4 shrink-0" />
				<span class="min-w-0 truncate">
					{currentChapter?.title || `Chapter ${currentChapter?.number ?? ''}`}
				</span>
				<ChevronDown class="h-3.5 w-3.5 shrink-0 transition {showChapterList ? 'rotate-180' : ''}" />
			</button>
			{#if showChapterList}
				<div
					id="manga-chapter-list"
					bind:this={chapterListElement}
					class="absolute bottom-[calc(100%+0.75rem)] left-1/2 z-[120] max-h-[60vh] w-[min(22rem,calc(100vw-1rem))] -translate-x-1/2 overflow-y-auto rounded-xl border shadow-xl
						{isDarkMode
							? 'border-white/10 bg-zinc-900/95 text-zinc-100'
							: 'border-zinc-200 bg-white/95 text-zinc-800'}"
				>
					<div
						class="sticky top-0 border-b px-3 py-2 text-xs font-semibold backdrop-blur
							{isDarkMode ? 'border-white/10 bg-zinc-900/95' : 'border-zinc-200 bg-white/95'}"
					>
						Chapter list
					</div>
					{#each [...(chapters || [])].reverse() as chapter, i (`${chapter.id ?? chapter.title ?? i}`)}
						<div
							class="relative flex items-center overflow-hidden border-b px-2 last:border-b-0 transition
								{isDarkMode
									? isReadChapter(chapter)
										? 'border-white/5 bg-white/[0.035] text-zinc-500'
										: 'border-white/5'
									: isReadChapter(chapter)
										? 'border-zinc-100 bg-zinc-50 text-zinc-400'
										: 'border-zinc-100'}"
						>
							{#if isDownloading && downloadingChapterId === String(chapter.id ?? '')}
								<div class="absolute inset-x-0 top-0 z-10 h-1 overflow-hidden bg-zinc-800/80">
									<div
										class="h-full bg-emerald-500 transition-all duration-300 ease-out"
										style="width: {downloadPercent}%"
									></div>
								</div>
							{/if}
							<button
								type="button"
								class="min-w-0 flex-1 truncate py-2.5 pr-2 text-left text-sm transition
									{isReadChapter(chapter)
										? 'opacity-60'
										: isDarkMode
											? 'hover:bg-white/10'
											: 'hover:bg-zinc-100'}
									{chapterIdMatches(normChapterId(chapter.id), normChapterId(chapterId)) ||
									chapterIdMatches(normChapterId(chapter.id), normChapterId(currentChapter?.id))
										? 'reader-chapter-active font-medium'
										: ''}"
								data-chapter-id={normChapterId(chapter.id)}
								aria-current={chapterIdMatches(normChapterId(chapter.id), normChapterId(chapterId))
									? 'page'
									: undefined}
								onclick={() => goToChapter(chapter)}
							>
								{chapter.title}
							</button>
							{#if isChapterOffline(chapter.id)}
								<span
									class="flex h-8 w-8 shrink-0 items-center justify-center text-emerald-500"
									role="status"
									title="Chapter available offline"
									aria-label="Chapter available offline"
								>
									<WifiOff class="h-4 w-4" />
								</span>
							{/if}
							<button
								type="button"
								class="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition
									{isChapterOffline(chapter.id)
										? 'text-violet-500'
										: isDarkMode
											? 'text-zinc-400 hover:bg-white/10 hover:text-emerald-400'
											: 'text-zinc-500 hover:bg-zinc-100 hover:text-emerald-600'}"
								aria-label="{isChapterOffline(chapter.id) ? 'Chapter sudah diunduh offline' : 'Unduh chapter'}: {chapter.title || 'Chapter'}"
								title={downloadingChapterId === String(chapter.id ?? '')
									? downloadText
									: isChapterOffline(chapter.id)
										? 'Sudah offline'
										: 'Unduh chapter'}
								disabled={isDownloading || isChapterOffline(chapter.id) || !chapter.id}
								onclick={() => handleDownload(chapter)}
							>
								{#if downloadingChapterId === String(chapter.id ?? '')}
									<span class="text-[9px] font-semibold tabular-nums">{downloadPercent}%</span>
								{:else if isChapterOffline(chapter.id)}
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="h-4 w-4"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2.5"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d="M20 6 9 17l-5-5" />
									</svg>
								{:else}
									<Download class="h-4 w-4" />
								{/if}
							</button>
						</div>
					{:else}
						<p class="px-3 py-4 text-center text-xs opacity-60">No chapters available</p>
					{/each}
				</div>
			{/if}
		</div>

		<button
			onclick={() => nextChapter && !chapterLoading && goToChapter(nextChapter)}
			disabled={!nextChapter || chapterLoading}
			aria-label="Next chapter"
			title="Next chapter"
			class="flex min-w-[64px] items-center justify-center gap-1 rounded-[15px] border px-2 py-[5px] text-[0.92em] backdrop-blur-md transition disabled:cursor-not-allowed disabled:opacity-30 sm:min-w-[90px] sm:px-[15px]
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
					Mode: {currentMode === 'webtoon'
						? 'Webtoon'
						: currentMode === 'ltr'
							? 'LTR'
							: 'Page (RTL)'}
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
