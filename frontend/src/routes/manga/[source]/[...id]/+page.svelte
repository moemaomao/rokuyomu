<script lang="ts">
	import type { PageData } from './$types';
	import { onMount } from 'svelte';
	import { toggleBookmark, isBookmarked } from '$lib/stores/bookmark.svelte';
	import { downloadChapter, type DownloadProgress } from '$lib/utils/downloadChapter';

	const { data }: { data: PageData } = $props();

	let manga = $derived((data as any).manga);
	let source = $derived((data as any).source as string);
	let canonicalUrl = $derived((data as any).canonicalUrl as string | undefined);

	const VIEW_KEY = 'mikoroku-chapter-view';
	const SORT_KEY = 'mikoroku-chapter-sort';
	const LOAD_MORE_STEP = 30;

	let sortNewest = $state(true);
	let viewMode = $state<'grid-thumb' | 'grid-text' | 'list-thumb'>('grid-text');
	let bookmarked = $state(false);
	let loadMoreEl: HTMLElement | null = $state(null);

	let loadingMore = $state(false);

	let dlState = $state<Record<string, DownloadProgress | { phase: 'idle' }>>({});

	function isDownloading(chapterId: string): boolean {
		const s = dlState[chapterId];
		return !!s && s.phase !== 'idle' && s.phase !== 'done' && s.phase !== 'error';
	}

	function dlLabel(chapterId: string): string {
		const s = dlState[chapterId];
		if (!s || s.phase === 'idle') return '';
		if (s.phase === 'error') return '!';
		if (s.phase === 'done') return '✓';
		if (s.phase === 'images' && 'total' in s && s.total) return `${s.current}/${s.total}`;
		if (s.phase === 'zip') return '…';
		return '…';
	}

	async function handleDownloadChapter(e: MouseEvent, chapter: any) {
		e.preventDefault();
		e.stopPropagation();
		if (!chapter?.id || isDownloading(chapter.id)) return;
		const id = String(chapter.id);
		try {
			await downloadChapter({
				source,
				chapterId: id,
				chapterTitle: chapter.title || `Chapter ${chapter.number}`,
				mangaTitle: manga?.title,
				onProgress: (p) => {
					dlState = { ...dlState, [id]: p };
				}
			});
			setTimeout(() => {
				dlState = { ...dlState, [id]: { phase: 'idle' } };
			}, 1500);
		} catch (err: any) {
			console.error('[download chapter]', err);
			dlState = {
				...dlState,
				[id]: { phase: 'error', current: 0, total: 0, message: err?.message || 'Failed' }
			};
		}
	}


	let loadedChapters = $state<any[]>([]);
	let chapterTotal = $state(0);
	let chapterOffset = $state(0);
	let hasMoreChapters = $state(false);

	let mangaIdPath = $derived((data as any).mangaId as string || manga?.id || '');
	let selectedLang = $derived(((data as any).selectedLang as string) || 'all');

	let displayedChapters = $derived(loadedChapters);
	let remainingChapters = $derived(Math.max(0, chapterTotal - loadedChapters.length));

	$effect(() => {
		const m = manga;
		const total = (data as any).chapterTotal as number | undefined;
		const offset = (data as any).chapterOffset as number | undefined;
		const more = (data as any).hasMoreChapters as boolean | undefined;
		if (!m) return;
		loadedChapters = [...(m.chapters || [])];
		chapterTotal = total ?? loadedChapters.length;
		chapterOffset = offset ?? loadedChapters.length;
		hasMoreChapters = more ?? false;
		sortNewest = true;
	});

	type ChaptersApiResponse = {
		chapters?: any[];
		total?: number;
		offset?: number;
		limit?: number;
		hasMore?: boolean;
		sort?: string;
	};

	async function fetchChapterPage(offset: number, limit: number, newest: boolean, replace = false) {
		if (!source || !mangaIdPath) return;
		loadingMore = true;
		try {
			const params = new URLSearchParams({
				source,
				id: mangaIdPath,
				lang: selectedLang,
				offset: String(offset),
				limit: String(limit),
				sort: newest ? 'newest' : 'oldest'
			});
			const res = await fetch(`/api/chapters?${params}`);
			if (!res.ok) throw new Error(await res.text());
			const json = (await res.json()) as ChaptersApiResponse;
			const batch = Array.isArray(json.chapters) ? json.chapters : [];
			if (replace) {
				loadedChapters = batch;
			} else {
				loadedChapters = [...loadedChapters, ...batch];
			}
			chapterTotal = typeof json.total === 'number' ? json.total : chapterTotal;
			chapterOffset = offset + batch.length;
			hasMoreChapters = Boolean(json.hasMore);
		} catch (e) {
			console.error('[load more chapters]', e);
		} finally {
			loadingMore = false;
		}
	}

	function loadMoreChapters() {
		if (loadingMore || !hasMoreChapters) return;
		fetchChapterPage(chapterOffset, LOAD_MORE_STEP, sortNewest, false);
	}

	async function showAllChapters() {
		if (loadingMore || !hasMoreChapters) return;
		loadingMore = true;
		try {
			while (hasMoreChapters) {
				const params = new URLSearchParams({
					source,
					id: mangaIdPath,
					lang: selectedLang,
					offset: String(chapterOffset),
					limit: String(LOAD_MORE_STEP),
					sort: sortNewest ? 'newest' : 'oldest'
				});
				const res = await fetch(`/api/chapters?${params}`);
				if (!res.ok) break;
				const json = (await res.json()) as ChaptersApiResponse;
				const batch = Array.isArray(json.chapters) ? json.chapters : [];
				if (!batch.length) break;
				loadedChapters = [...loadedChapters, ...batch];
				chapterTotal = typeof json.total === 'number' ? json.total : chapterTotal;
				chapterOffset = chapterOffset + batch.length;
				hasMoreChapters = Boolean(json.hasMore);
				if (!json.hasMore) break;
			}
		} catch (e) {
			console.error('[show all chapters]', e);
		} finally {
			loadingMore = false;
		}
	}

	function parseMeta(desc: string | undefined): Record<string, string> {
		const out: Record<string, string> = {};
		if (!desc) return out;
		for (const line of desc.split(/\n+/)) {
			const m = line.match(/^\s*([^:]+):\s*(.+)\s*$/);
			if (m) out[m[1].trim().toLowerCase()] = m[2].trim();
		}
		return out;
	}

	const META_KEYS =
		/^\s*(alttitle|alt title|alternative(?: title)?|type|language|artists?|groups?|pages|author|publication|published|serialization|demographic|latest(?: update)?|updated|rating|volume|vol)\s*:/i;

	let meta = $derived(parseMeta(manga?.description));
	let altTitle = $derived(
		meta['alttitle'] ||
			meta['alt title'] ||
			meta['alternative'] ||
			meta['alternative title'] ||
			''
	);
	let type = $derived(meta['type'] || manga?.type || 'Manga');
	let language = $derived(meta['language'] || '');
	let artists = $derived(meta['artists'] || meta['artist'] || manga?.authors?.join(', ') || '');
	let groups = $derived(meta['groups'] || meta['serialization'] || '');
	let pages = $derived(meta['pages'] || '');
	let author = $derived(meta['author'] || manga?.authors?.[0] || '');
	let publication = $derived(meta['publication'] || meta['published'] || '');
	let demographic = $derived(meta['demographic'] || '');
	let latestUpdate = $derived(
		meta['latest update'] ||
			meta['latest'] ||
			meta['updated'] ||
			[...(manga?.chapters || [])].sort((a, b) => b.number - a.number)[0]?.date ||
			''
	);
	let rating = $derived(meta['rating'] || '0.0');
	let volume = $derived(meta['volume'] || meta['vol'] || '');
	let synopsis = $derived(
		(manga?.description || '')
			.split(/\n+/)
			.filter((line: string) => !META_KEYS.test(line))
			.join('\n')
			.trim()
	);

	// ── SEO / share card ─────────────────────────────────────────────────────
	let pageTitle = $derived(
		manga?.title ? `${manga.title} - RokuYomu` : 'RokuYomu'
	);
	let pageDesc = $derived(
		(synopsis || manga?.title || 'Baca manga di RokuYomu')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 160)
	);
	let pageImage = $derived(
		manga?.cover && /^https?:\/\//i.test(String(manga.cover).trim())
			? String(manga.cover).trim()
			: ''
	);

	let genreTags = $derived.by(() => {
		const all = manga?.genres || [];
		const normal: string[] = [];
		const female: string[] = [];
		const male: string[] = [];
		for (const raw of all) {
			const t = String(raw || '').trim();
			if (!t) continue;
			const lower = t.toLowerCase();
			if (lower.startsWith('female:')) female.push(t.slice(7).trim() || t);
			else if (lower.startsWith('male:')) male.push(t.slice(5).trim() || t);
			else normal.push(t);
		}
		return { normal, female, male };
	});

	function proxyImage(url: string, _w?: number, _h?: number): string {
		if (!url) return '';
		let u = String(url).trim();
		if (!u || u === '-') return '';
		if (u.startsWith('//')) u = 'https:' + u;
		return `/api/proxy?url=${encodeURIComponent(u)}&source=${source}`;
	}

	function onCoverError(e: Event) {
		const img = e.currentTarget as HTMLImageElement;
		const original = img.dataset.original;
		if (!original) return;
		if (img.dataset.fallback === '1') {
			img.style.opacity = '0';
			return;
		}
		img.dataset.fallback = '1';
		img.src = `/api/proxy?url=${encodeURIComponent(original)}&source=${source}`;
	}

	function formatDateOnly(raw: string | undefined | null): string {
		if (!raw) return '';
		const s = String(raw).trim();
		if (!s) return '';
		const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
		if (iso) return iso[1];
		if (/\b(ago|hour|day|week|month|year|minute|just now|hari|jam|menit)\b/i.test(s)) return s;
		const d = new Date(s);
		if (!isNaN(d.getTime())) {
			const y = d.getFullYear();
			const mo = String(d.getMonth() + 1).padStart(2, '0');
			const day = String(d.getDate()).padStart(2, '0');
			return `${y}-${mo}-${day}`;
		}
		return s;
	}

	function statusClass(status: string) {
		const s = (status || '').toLowerCase();
		if (s.includes('completed') || s.includes('complete')) return 'text-sky-500 dark:text-sky-400';
		if (s.includes('ongoing')) return 'text-emerald-600 dark:text-emerald-400';
		if (s.includes('hiatus')) return 'text-yellow-600 dark:text-yellow-300';
		if (s.includes('dropped')) return 'text-orange-600 dark:text-orange-500';
		return 'text-zinc-600 dark:text-zinc-300';
	}

	async function handleBookmark() {
		if (!manga) return;
		bookmarked = await toggleBookmark({
			mangaId: manga.id,
			mangaSlug: manga.id,
			mangaTitle: manga.title,
			cover: manga.cover || '',
			sourceId: source
		});
	}

	function setViewMode(mode: 'grid-thumb' | 'grid-text' | 'list-thumb') {
		viewMode = mode;
		try {
			localStorage.setItem(VIEW_KEY, mode);
		} catch {
			/* ignore */
		}
	}

	function toggleSort() {
		sortNewest = !sortNewest;
		try {
			localStorage.setItem(SORT_KEY, String(sortNewest));
		} catch {
			/* ignore */
		}

		chapterOffset = 0;
		hasMoreChapters = true;
		fetchChapterPage(0, 20, sortNewest, true);
	}

	function chapterCover(chapter: any): string {
		return chapter?.cover || manga?.cover || '';
	}

	function chapterFlag(lang?: string): string {
		const l = String(lang || '').trim().toLowerCase();
		const map: Record<string, string> = {
			en: 'gb',
			'en-us': 'us',
			id: 'id',
			ja: 'jp',
			'ja-ro': 'jp',
			ko: 'kr',
			'ko-ro': 'kr',
			zh: 'cn',
			'zh-hk': 'hk',
			'zh-ro': 'cn',
			fr: 'fr',
			pl: 'pl',
			es: 'es',
			'es-la': 'mx',
			'pt-br': 'br',
			pt: 'pt',
			ru: 'ru',
			vi: 'vn',
			th: 'th',
			ar: 'sa',
			de: 'de',
			it: 'it',
			tr: 'tr',
			uk: 'ua',
			hi: 'in',
			ms: 'my',
			nl: 'nl'
		};
		return map[l] || '';
	}

	onMount(() => {
		try {
			const savedView = localStorage.getItem(VIEW_KEY) as typeof viewMode | null;
			if (savedView === 'grid-thumb' || savedView === 'grid-text' || savedView === 'list-thumb') {
				viewMode = savedView;
			}
			const savedSort = localStorage.getItem(SORT_KEY);
			if (savedSort === 'true' || savedSort === 'false') {
				sortNewest = savedSort === 'true';
			}
		} catch {
			/* ignore */
		}

		if (manga?.id) bookmarked = isBookmarked(manga.id, source);

		const onChange = () => {
			if (manga?.id) bookmarked = isBookmarked(manga.id, source);
		};
		window.addEventListener('bookmarks-changed', onChange);
		return () => window.removeEventListener('bookmarks-changed', onChange);
	});

	$effect(() => {
		const el = loadMoreEl;
		if (!el || !hasMoreChapters) return;

		let locked = false;
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries[0]?.isIntersecting || locked) return;
				if (window.scrollY < 80) return;
				locked = true;
				observer.unobserve(el);
				loadMoreChapters();
			},
			{ rootMargin: '120px', threshold: 0.15 }
		);
		observer.observe(el);
		return () => observer.disconnect();
	});
</script>

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
	{#if canonicalUrl}
		<meta property="og:url" content={canonicalUrl} />
		<link rel="canonical" href={canonicalUrl} />
	{/if}

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={pageTitle} />
	<meta name="twitter:description" content={pageDesc} />
	{#if pageImage}
		<meta name="twitter:image" content={pageImage} />
	{/if}
</svelte:head>

{#if !manga}
	<div class="py-20 text-center text-zinc-500">Manga not found</div>
{:else}
	<div
          class="detail-page mx-auto w-full max-w-[480px] md:max-w-[720px] md:px-4 md:py-5 lg:max-w-none lg:px-3 lg:py-5 xl:px-4"
         >
		<div
			class="detail-container relative min-h-screen overflow-hidden rounded-none md:min-h-0 md:rounded-2xl md:border md:shadow-2xl lg:rounded-3xl"
		>
			{#if manga.cover}
				<div
					class="detail-bg pointer-events-none absolute inset-0 scale-[1.05] bg-cover bg-center"
					style="background-image: url('{proxyImage(manga.cover, 120, 180)}');"
				></div>
				<div class="detail-overlay absolute inset-0"></div>
			{/if}

			<div class="relative z-10 p-[18px_14px_14px] md:p-[28px_24px_20px] lg:p-[28px_24px_22px] xl:p-[32px_28px_24px]">
				<!-- Cover + Info -->
				<div class="flex items-start gap-3.5 md:gap-7 lg:gap-10">
					<div class="flex w-[100px] shrink-0 flex-col items-center gap-3 md:w-[200px] lg:w-[240px]">
						<div
							class="detail-cover relative h-[150px] w-[100px] overflow-hidden rounded-xl shadow-2xl ring-1 md:h-[280px] md:w-[200px] lg:h-[340px] lg:w-[240px]"
						>
							{#if manga.cover}
								<img
									src={proxyImage(manga.cover, 200, 300)}
									data-original={manga.cover}
									alt="{manga.title} cover"
									class="h-full w-full object-cover"
									onerror={onCoverError}
								/>
							{:else}
								<div class="detail-muted flex h-full items-center justify-center">📚</div>
							{/if}
							{#if volume}
								<span
									class="absolute right-2 bottom-2 flex h-7 w-7 items-center justify-center rounded-md bg-black/75 text-xs font-bold text-white ring-1 ring-white/20"
								>
									{volume}
								</span>
							{/if}
						</div>

						<div class="flex items-center gap-1">
							<div class="flex gap-0.5 text-amber-400">
								{#each Array(5) as _, i}
									<svg
										xmlns="http://www.w3.org/2000/svg"
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill={i < Math.round(parseFloat(rating) / 2) ? 'currentColor' : 'none'}
										stroke="currentColor"
										stroke-width="1.5"
										class={i < Math.round(parseFloat(rating) / 2) ? '' : 'text-zinc-500'}
									>
										<path
											d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
										/>
									</svg>
								{/each}
							</div>
							<span class="detail-muted text-[12px] font-medium">{rating}</span>
						</div>

						<button
							type="button"
							onclick={handleBookmark}
							class="bookmark-btn flex w-full max-w-[80px] items-center justify-center gap-1.5 rounded-lg border-2 px-1 py-1 text-[10px] font-semibold transition md:max-w-[140px] md:px-6 md:py-2.5 md:text-sm {bookmarked
								? 'bookmarked'
								: ''}"
						>
							{#if bookmarked}
								<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5" /></svg>
								Bookmarked
							{:else}
								<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" /></svg>
								Bookmark
							{/if}
						</button>
					</div>

					<div class="min-w-0 flex-1">
						<h1 class="detail-title text-[14px] leading-[1.25] font-bold md:text-lg lg:text-xl">
							{manga.title}
						</h1>
						<div class="detail-divider my-1.5 h-px w-full rounded-sm"></div>
						{#if altTitle}
							<p class="detail-muted text-[11px] leading-relaxed opacity-90 md:text-sm">{altTitle}</p>
						{/if}

						<div class="detail-meta mt-2.5 space-y-1.5 text-[11px] md:mt-3.5 md:space-y-2 md:text-[14px]">
							<div class="mb-1.5 flex items-center gap-2">
								<span
									class="flex h-2.5 w-2.5 shrink-0 rounded-full bg-pink-500 shadow-[0_0_8px_rgba(236,72,153,0.6)]"
								></span>
								<span class="font-bold tracking-wider uppercase {statusClass(manga.status)}">
									{manga.status || 'ONGOING'}
								</span>
							</div>

							{#if type}
								<div class="flex items-center gap-1.5">
									<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="detail-icon w-5 shrink-0"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /></svg>
									<span
										><strong class="detail-label">Type:</strong>
										<span class="detail-value capitalize">{type}</span></span
									>
								</div>
							{/if}

							{#if manga.chapters?.length}
								<div class="flex items-center gap-1.5">
									<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="detail-icon w-5 shrink-0"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>
									<span
										><strong class="detail-label">Chapter:</strong>
										<span class="detail-value">{chapterTotal || manga.chapters?.length || 0} Chapters</span></span
									>
								</div>
							{/if}

							{#if pages}
								<div class="flex items-center gap-1.5">
									<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="detail-icon w-5 shrink-0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
									<span
										><strong class="detail-label">Pages:</strong>
										<span class="detail-value">{pages}</span></span
									>
								</div>
							{/if}

							{#if publication}
								<div class="flex items-center gap-1.5">
									<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="detail-icon w-5 shrink-0"><rect width="18" height="18" x="3" y="4" rx="2" /><line x1="16" x2="16" y1="2" y2="6" /><line x1="8" x2="8" y1="2" y2="6" /><line x1="3" x2="21" y1="10" y2="10" /></svg>
									<span
										><strong class="detail-label">Publication:</strong>
										<span class="detail-value">{publication}</span></span
									>
								</div>
							{/if}

							{#if author}
								<div class="flex items-center gap-1.5">
									<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="detail-icon w-5 shrink-0"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
									<span
										><strong class="detail-label">Author:</strong>
										<span class="detail-value">{author}</span></span
									>
								</div>
							{/if}

							{#if artists}
								<div class="flex items-center gap-1.5">
									<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="detail-icon w-5 shrink-0"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
									<span
										><strong class="detail-label">Artist:</strong>
										<span class="detail-value">{artists}</span></span
									>
								</div>
							{/if}

							{#if groups}
								<div class="flex items-center gap-1.5">
									<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="detail-icon w-5 shrink-0"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
									<span
										><strong class="detail-label">Group:</strong>
										<span class="detail-value">{groups}</span></span
									>
								</div>
							{/if}

							{#if latestUpdate}
								<div class="mb-3 flex items-center gap-1.5">
									<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="detail-icon w-5 shrink-0"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
									<span>
										<strong class="detail-label">Latest Update:</strong>
										<span class="font-semibold text-emerald-600 dark:text-emerald-400"
											>{formatDateOnly(latestUpdate)}</span
										>
									</span>
								</div>
							{/if}

							{#if demographic}
								<div class="flex flex-wrap items-start gap-1">
									<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="detail-icon mt-0.5 w-5 shrink-0"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
									<span class="detail-label"><strong>Demographic:</strong></span>
									<span
										class="rounded-lg bg-red-500/15 px-2.5 py-0.5 text-[10px] font-bold text-red-600 capitalize ring-1 ring-red-500/30 dark:bg-red-500/20 dark:text-red-300 dark:ring-red-500/35"
										>{demographic}</span
									>
								</div>
							{/if}

							{#if language}
								<div class="flex items-center gap-1.5">
									<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="detail-icon w-5 shrink-0"><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></svg>
									<span
										><strong class="detail-label">Language:</strong>
										<span class="detail-value">{language}</span></span
									>
								</div>
							{/if}
						</div>
					</div>
				</div>

				<!-- Genres -->
				{#if genreTags.normal.length}
					<div
						class="mt-5 grid grid-cols-4 gap-2 md:mt-6 md:grid-cols-[repeat(auto-fit,minmax(110px,1fr))] md:gap-2.5"
					>
						{#each genreTags.normal as genre}
							<span
								class="detail-chip truncate rounded-lg border px-2 py-1.5 text-center text-[11px] font-medium capitalize"
								>{genre}</span
							>
						{/each}
					</div>
				{/if}

				{#if genreTags.female.length || genreTags.male.length}
					<section class="detail-card mt-4 rounded-[14px] border px-4 py-4 md:mt-5">
						{#if genreTags.female.length}
							<div class="mb-4 last:mb-0">
								<div class="detail-title mb-2 flex items-center gap-2 text-[14.5px] font-semibold">
									<span class="text-[#ffb2ce]">♀</span><span>Female</span>
								</div>
								<div class="flex flex-wrap gap-1.5">
									{#each genreTags.female as tag}
										<span
											class="rounded-lg border border-[rgba(255,77,141,0.5)] bg-[rgba(255,77,141,0.28)] px-2.5 py-1 text-[11.5px] font-semibold text-[#ffb2ce] capitalize"
											>{tag}</span
										>
									{/each}
								</div>
							</div>
						{/if}
						{#if genreTags.male.length}
							<div>
								<div class="detail-title mb-2 flex items-center gap-2 text-[14.5px] font-semibold">
									<span class="text-[#b5c9ff]">♂</span><span>Male</span>
								</div>
								<div class="flex flex-wrap gap-1.5">
									{#each genreTags.male as tag}
										<span
											class="rounded-lg border border-[rgba(77,125,255,0.5)] bg-[rgba(77,125,255,0.28)] px-2.5 py-1 text-[11.5px] font-semibold text-[#b5c9ff] capitalize"
											>{tag}</span
										>
									{/each}
								</div>
							</div>
						{/if}
					</section>
				{/if}

				{#if synopsis}
					<section class="detail-card mt-4 rounded-[14px] border p-4 md:mt-5 md:p-5">
						<h2 class="detail-title mb-3.5 text-lg font-semibold">Synopsis</h2>
						<p class="detail-value text-[13px] leading-relaxed whitespace-pre-line">{synopsis}</p>
					</section>
				{/if}


				<!-- Controls -->
				<div class="mt-6 flex items-center justify-between gap-2">
					<div class="flex items-center gap-2">
					</div>

					<div class="flex items-center gap-2">
						<button
							type="button"
							class="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border {sortNewest
								? 'border-fuchsia-400 bg-fuchsia-500 text-white'
								: 'border-amber-500 bg-amber-500 text-white'}"
							onclick={toggleSort}
							title={sortNewest ? 'Urutkan dari terlama' : 'Urutkan dari terbaru'}
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="15"
								height="15"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								class={sortNewest ? '' : 'rotate-180'}
							>
								<path d="m3 16 4 4 4-4" /><path d="M7 20V4" /><path d="M11 4h10" /><path d="M11 8h7" /><path d="M11 12h4" />
							</svg>
						</button>
						<button
	type="button"
	class="detail-view-btn flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border {viewMode === 'grid-text'
		? 'border-blue-500 bg-blue-500 text-white'
		: ''}"
	onclick={() => setViewMode('grid-text')}
	title="Tampilan grid teks"
	aria-label="Tampilan grid teks"
>
	<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
		<rect x="3" y="4" width="18" height="4" rx="1" />
		<rect x="3" y="10" width="18" height="4" rx="1" />
		<rect x="3" y="16" width="18" height="4" rx="1" />
	</svg>
</button>

<button
	type="button"
	class="detail-view-btn flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border {viewMode === 'grid-thumb'
		? 'border-red-500 bg-red-500 text-white'
		: ''}"
	onclick={() => setViewMode('grid-thumb')}
	title="Tampilan grid thumbnail"
	aria-label="Tampilan grid thumbnail"
>
	<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
		<rect width="7" height="7" x="3" y="3" rx="1" />
		<rect width="7" height="7" x="14" y="3" rx="1" />
		<rect width="7" height="7" x="14" y="14" rx="1" />
		<rect width="7" height="7" x="3" y="14" rx="1" />
	</svg>
</button>

<button
	type="button"
	class="detail-view-btn flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border {viewMode === 'list-thumb'
		? 'border-green-500 bg-green-500 text-white'
		: ''}"
	onclick={() => setViewMode('list-thumb')}
	title="Tampilan list thumbnail"
	aria-label="Tampilan list thumbnail"
>
	<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
		<line x1="8" x2="21" y1="6" y2="6" />
		<line x1="8" x2="21" y1="12" y2="12" />
		<line x1="8" x2="21" y1="18" y2="18" />
		<line x1="3" x2="3.01" y1="6" y2="6" />
		<line x1="3" x2="3.01" y1="12" y2="12" />
		<line x1="3" x2="3.01" y1="18" y2="18" />
	</svg>
</button>
					</div>
				</div>

				<!-- Chapters -->
				<div class="mt-3 mb-3 flex items-center">
					<div class="detail-divider h-px flex-1"></div>
					<h2 class="detail-title mx-3 text-[15px] font-semibold md:text-xl">Chapters</h2>
					<div class="detail-divider h-px flex-1"></div>
				</div>

								{#if displayedChapters.length || chapterTotal}
					{#if viewMode === 'grid-thumb'}
						<div
							class="grid w-full grid-cols-4 gap-2.5 pb-8 sm:grid-cols-5 md:grid-cols-6 md:gap-3.5 lg:grid-cols-8 lg:gap-4"
						>
							{#each displayedChapters as chapter}
								<a
									href="/reader/{source}{chapter.id}"
									class="detail-chapter-thumb relative aspect-square w-full overflow-hidden rounded-[10px] transition hover:z-[2] hover:scale-105"
								>
									{#if chapterCover(chapter)}
										<img
											src={proxyImage(chapterCover(chapter), 150, 150)}
											data-original={chapterCover(chapter)}
											alt={chapter.title}
											loading="lazy"
											class="h-full w-full object-cover"
											onerror={onCoverError}
										/>
									{/if}
									<button
										type="button"
										class="absolute top-1 right-1 z-10 flex h-6 w-6 items-center justify-center rounded border border-emerald-500/40 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/30 hover:text-emerald-300 disabled:opacity-50"
										title="Download chapter"
										aria-label="Download {chapter.title}"
										disabled={isDownloading(chapter.id)}
										onclick={(e) => handleDownloadChapter(e, chapter)}
									>
										{#if isDownloading(chapter.id) || dlLabel(chapter.id)}
											<span class="text-[8px] font-bold">{dlLabel(chapter.id) || '…'}</span>
										{:else}
											<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
												<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
												<polyline points="7 10 12 15 17 10" />
												<line x1="12" x2="12" y1="15" y2="3" />
											</svg>
										{/if}
									</button>
									<div class="absolute inset-x-0 bottom-0 bg-black/85 px-1 py-1.5 text-center">
										<p
											class="line-clamp-2 flex items-center justify-center gap-1 text-[11px] leading-snug font-bold text-white sm:text-xs"
										>
											{#if chapterFlag(chapter.lang)}
												<span
													class="fi fi-{chapterFlag(chapter.lang)} shrink-0 rounded-[2px] text-[12px]"
												></span>
											{/if}
											<span class="min-w-0">{chapter.title}</span>
										</p>
										{#if chapter.date}
											<p class="mt-0.5 text-[9px] text-white/80">{formatDateOnly(chapter.date)}</p>
										{/if}
									</div>
								</a>
							{/each}
						</div>
					{:else if viewMode === 'grid-text'}
						<div class="grid grid-cols-3 gap-2.5 pb-8 md:grid-cols-4 lg:grid-cols-6">
							{#each displayedChapters as chapter}
								<div class="relative">
									<a
										href="/reader/{source}{chapter.id}"
										class="detail-chapter-text flex min-h-[60px] flex-col justify-center rounded-[10px] border px-3 py-3 pr-9 hover:border-blue-500/40"
									>
										<p class="detail-title flex items-center gap-1.5 text-[12px] leading-tight font-bold">
											{#if chapterFlag(chapter.lang)}
												<span
													class="fi fi-{chapterFlag(chapter.lang)} shrink-0 rounded-[2px] text-[14px]"
												></span>
											{/if}
											<span class="min-w-0">{chapter.title}</span>
										</p>
										{#if chapter.date}
											<p class="detail-muted mt-1 text-[10px] opacity-70">
												{formatDateOnly(chapter.date)}
											</p>
										{/if}
									</a>
									<button
										type="button"
										class="absolute top-1.5 right-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-md border border-emerald-500/40 bg-emerald-500/15 text-emerald-400 transition hover:bg-emerald-500/30 hover:text-emerald-300 disabled:opacity-50"
										title="Download chapter"
										aria-label="Download {chapter.title}"
										disabled={isDownloading(chapter.id)}
										onclick={(e) => handleDownloadChapter(e, chapter)}
									>
										{#if isDownloading(chapter.id) || dlLabel(chapter.id)}
											<span class="text-[9px] font-bold tabular-nums">{dlLabel(chapter.id) || '…'}</span>
										{:else}
											<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
												<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
												<polyline points="7 10 12 15 17 10" />
												<line x1="12" x2="12" y1="15" y2="3" />
											</svg>
										{/if}
									</button>
								</div>
							{/each}
						</div>
					{:else}
						<div class="flex flex-col gap-2.5 pb-8">
							{#each displayedChapters as chapter}
								<a
									href="/reader/{source}{chapter.id}"
									class="detail-chapter-list flex h-20 items-center overflow-hidden rounded-xl border hover:border-green-500/40"
								>
									<div class="h-full w-[90px] shrink-0 overflow-hidden bg-zinc-300 dark:bg-zinc-900">
										{#if chapterCover(chapter)}
											<img
												src={proxyImage(chapterCover(chapter), 150, 150)}
												data-original={chapterCover(chapter)}
												alt={chapter.title}
												loading="lazy"
												class="h-full w-full object-cover"
												onerror={onCoverError}
											/>
										{/if}
									</div>
									<div class="min-w-0 flex-1 px-3 py-3">
										<p class="detail-title flex items-center gap-2 truncate text-sm font-bold">
											{#if chapterFlag(chapter.lang)}
												<span
													class="fi fi-{chapterFlag(chapter.lang)} shrink-0 rounded-[2px] text-[16px]"
												></span>
											{/if}
											<span class="truncate">{chapter.title}</span>
										</p>
										<p class="detail-muted mt-1 text-[11px]">
											{formatDateOnly(chapter.date) || '—'}
										</p>
									</div>
									<button
										type="button"
										class="mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/30 hover:text-emerald-300 disabled:opacity-50"
										title="Download chapter"
										aria-label="Download {chapter.title}"
										disabled={isDownloading(chapter.id)}
										onclick={(e) => handleDownloadChapter(e, chapter)}
									>
										{#if isDownloading(chapter.id) || dlLabel(chapter.id)}
											<span class="text-[10px] font-bold">{dlLabel(chapter.id) || '…'}</span>
										{:else}
											<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
												<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
												<polyline points="7 10 12 15 17 10" />
												<line x1="12" x2="12" y1="15" y2="3" />
											</svg>
										{/if}
									</button>
								</a>
							{/each}
						</div>
					{/if}
				{#if hasMoreChapters}
					<div
						bind:this={loadMoreEl}
						class="flex flex-col items-center gap-3 pb-12 pt-4"
					>
						<div class="load-more-row flex w-full items-center">
							<span class="load-more-line load-more-line-left" aria-hidden="true"></span>
							<button
								type="button"
								onclick={loadMoreChapters}
								disabled={loadingMore}
								class="detail-load-more load-more-btn shrink-0 rounded-xl border px-5 py-2.5 text-sm font-semibold transition hover:border-blue-500/50 disabled:opacity-60"
							>
								{loadingMore ? 'Loading…' : `Load more (+${Math.min(LOAD_MORE_STEP, remainingChapters)}) · ${remainingChapters} left`}
							</button>
							<span class="load-more-line load-more-line-right" aria-hidden="true"></span>
						</div>
						<button
							type="button"
							onclick={showAllChapters}
							class="detail-muted text-xs underline-offset-2 hover:underline"
						>
							Show all {chapterTotal} chapters
						</button>
					</div>
				{/if}
				{:else}
					<p class="detail-muted py-12 text-center text-sm">Belum ada chapter</p>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.detail-container {
		background: #0f0f1e;
		color: #fff;
		border-color: rgba(255, 255, 255, 0.1);
	}
	.detail-bg {
		opacity: 0.50;
	}
	.detail-overlay {
		background: rgba(15, 15, 30, 0.514);
	}
	.detail-title {
		color: #fff;
	}
	.detail-muted {
		color: #a1a1aa;
	}
	.detail-label {
		color: #d4d4d8;
	}
	.detail-value {
		color: #f4f4f5;
	}
	.detail-icon {
		color: #a1a1aa;
	}
	.detail-divider {
		background: rgba(255, 255, 255, 0.35);
	}
	.detail-load-more {
		background: rgba(255, 255, 255, 0.06);
		border-color: rgba(255, 255, 255, 0.28);
		color: #e4e4e7;
		position: relative;
		z-index: 1;
	}
	.detail-load-more:hover {
		background: rgba(59, 130, 246, 0.15);
		border-color: rgba(59, 130, 246, 0.55);
		color: #fff;
	}
	:global(html.light) .detail-load-more {
		background: rgba(0, 0, 0, 0.04);
		border-color: rgba(0, 0, 0, 0.18);
		color: #18181b;
	}
	:global(html.light) .detail-load-more:hover {
		background: rgba(59, 130, 246, 0.12);
		border-color: rgba(59, 130, 246, 0.45);
	}

	.load-more-row {
		gap: 0;
	}
	.load-more-line {
		flex: 1 1 0;
		height: 1px;
		min-width: 24px;
		position: relative;
		background: rgba(255, 255, 255, 0.28);
	}
	.load-more-line-left {
		mask-image: linear-gradient(to right, transparent 0%, #000 18%, #000 100%);
		-webkit-mask-image: linear-gradient(to right, transparent 0%, #000 18%, #000 100%);
	}
	.load-more-line-right {
		mask-image: linear-gradient(to left, transparent 0%, #000 18%, #000 100%);
		-webkit-mask-image: linear-gradient(to left, transparent 0%, #000 18%, #000 100%);
	}
	.load-more-line-left::before,
	.load-more-line-right::after {
		content: '';
		position: absolute;
		top: 50%;
		width: 0;
		height: 0;
		border-style: solid;
		transform: translateY(-50%);
	}
	.load-more-line-left::before {
		left: 0;
		border-width: 3px 8px 3px 0;
		border-color: transparent rgba(255, 255, 255, 0.28) transparent transparent;
	}
	.load-more-line-right::after {
		right: 0;
		border-width: 3px 0 3px 8px;
		border-color: transparent transparent transparent rgba(255, 255, 255, 0.28);
	}

	:global(html.light) .load-more-line {
		background: rgba(0, 0, 0, 0.2);
	}
	:global(html.light) .load-more-line-left::before {
		border-color: transparent rgba(0, 0, 0, 0.2) transparent transparent;
	}
	:global(html.light) .load-more-line-right::after {
		border-color: transparent transparent transparent rgba(0, 0, 0, 0.2);
	}
	.detail-cover {
		background: #18181b;
		--tw-ring-color: rgba(255, 255, 255, 0.15);
	}
	.detail-chip {
		background: rgba(0, 0, 0, 0.35);
		border-color: rgba(255, 255, 255, 0.1);
		color: #f4f4f5;
	}
	.detail-card {
		background: rgba(26, 26, 46, 0.35);
		border-color: rgba(255, 255, 255, 0.1);
	}
	.detail-chapter-thumb {
		background: rgba(0, 0, 0, 0.25);
	}
	.detail-chapter-text {
		background: rgba(0, 0, 0, 0.1);
		border-color: rgba(255, 255, 255, 0.204);
		backdrop-filter: none;
	}
	.detail-chapter-list {
		background: rgba(0, 0, 0, 0.2);
		border-color: rgba(255, 255, 255, 0.1);
	}
	.detail-view-btn:not(.border-blue-500):not(.border-red-500):not(.border-green-500) {
		border-color: rgba(255, 255, 255, 0.15);
		background: rgba(255, 255, 255, 0.05);
		color: #d4d4d8;
	}
	.bookmark-btn {
		background: rgba(255, 255, 255, 0.06);
		border-color: rgba(255, 255, 255, 0.18);
		color: #fff;
	}
	.bookmark-btn:hover {
		background: rgba(0, 0, 0, 0.25);
	}
	.bookmark-btn.bookmarked {
		background: #ffcc00 !important;
		border-color: #ffcc00 !important;
		color: #000 !important;
	}

	:global(html.light) .detail-container {
		background: rgba(255, 255, 255, 0.74);
		color: #050000;
		border-color: rgba(0, 0, 0, 0.1);
	}
	:global(html.light) .detail-bg {
		opacity: 0.22 !important;
	}
	:global(html.light) .detail-overlay {
		background: rgba(126, 125, 125, 0.103) !important;
	}
	:global(html.light) .detail-title {
		color: #111 !important;
	}
	:global(html.light) .detail-muted {
		color: #52525b;
	}
	:global(html.light) .detail-label {
		color: #3f3f46;
	}
	:global(html.light) .detail-value {
		color: #18181b;
	}
	:global(html.light) .detail-icon {
		color: #71717a;
	}
	:global(html.light) .detail-divider {
		background: rgba(0, 0, 0, 0.12);
	}
	:global(html.light) .detail-cover {
		background: #e4e4e7;
		--tw-ring-color: rgba(0, 0, 0, 0.1);
	}
	:global(html.light) .detail-chip {
		background: rgba(0, 0, 0, 0.06);
		border-color: rgba(0, 0, 0, 0.1);
		color: #18181b;
	}
	:global(html.light) .detail-card {
		background: rgba(184, 174, 174, 0.25);
		border-color: rgba(0, 0, 0, 0.1);
	}
	:global(html.light) .detail-chapter-thumb {
		background: rgba(0, 0, 0, 0.06);
	}
	:global(html.light) .detail-chapter-text {
		background: rgba(0, 0, 0, 0.1);
		border-color: rgba(0, 0, 0, 0.14);
		backdrop-filter: none;
	}
	:global(html.light) .detail-chapter-list {
		background: rgba(0, 0, 0, 0.04);
		border-color: rgba(0, 0, 0, 0.1);
	}
	:global(html.light) .detail-view-btn:not(.border-blue-500):not(.border-red-500):not(.border-green-500) {
		border-color: rgba(0, 0, 0, 0.12);
		background: rgba(0, 0, 0, 0.04);
		color: #3f3f46;
	}
	:global(html.light) .bookmark-btn:not(.bookmarked) {
		background: rgba(0, 0, 0, 0.04);
		border-color: rgba(0, 0, 0, 0.15);
		color: #111;
	}
</style>