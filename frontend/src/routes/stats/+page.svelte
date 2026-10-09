<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getUser, isLoading } from '$lib/stores/auth.svelte';
	import { getBookmarks } from '$lib/stores/bookmark.svelte';
	import {
		getHistory,
		whenHistoryReady,
		getActivityLog,
		type ReadingEntry,
		type ActivityLogEntry
	} from '$lib/stores/history';
	import { isNovelSource } from '$lib/utils/novelSources';
	import {
		computeTotalXp,
		computeLevelInfo,
		sumChapterMarkers,
		sumChapterProgressXp
	} from '$lib/utils/level';
	import {
		loadLifetimeStats,
		bootstrapLifetimeFromLocal,
		hydrateLifetimeFromLocalStorage,
		getCachedLifetimeStats,
		effectiveXp,
		type LifetimeStats
	} from '$lib/stores/lifetimeXp';
	import {
		Trophy,
		Zap,
		BookOpen,
		Bookmark,
		Flame,
		Library,
		ScrollText,
		Clock,
		Star,
		TrendingUp,
		PieChart,
		LogIn,
		Activity
	} from 'lucide-svelte';

	let ready = $state(false);
	let isDark = $state(true);
	let history = $state<ReadingEntry[]>([]);
	let activityLog = $state<ActivityLogEntry[]>([]);
	let bookmarkCount = $state(0);
	let lifetimeXp = $state(0);

	let comicHistory = $derived(history.filter((h) => !isNovelSource(h.sourceId)));
	let novelHistory = $derived(history.filter((h) => isNovelSource(h.sourceId)));

	let comicTitles = $derived(comicHistory.length);
	let novelTitles = $derived(novelHistory.length);
	let totalTitles = $derived(history.length);

	let comicChapters = $derived(sumChapterMarkers(comicHistory));
	let novelChapters = $derived(sumChapterMarkers(novelHistory));
	let totalChapters = $derived(comicChapters + novelChapters);

	let sourceMap = $derived.by(() => {
		const m = new Map<string, { count: number; isNovel: boolean }>();
		for (const h of history) {
			const id = h.sourceId || 'unknown';
			const cur = m.get(id) || { count: 0, isNovel: isNovelSource(id) };
			cur.count++;
			m.set(id, cur);
		}
		return [...m.entries()]
			.map(([id, v]) => ({ id, ...v }))
			.sort((a, b) => b.count - a.count);
	});

	let topSources = $derived(sourceMap.slice(0, 8));

	function localDateKey(d: Date): string {
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${day}`;
	}

	let activityDays = $derived.by(() => {
		const days: { label: string; count: number; key: string }[] = [];
		const now = new Date();
		for (let i = 13; i >= 0; i--) {
			const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
			const key = localDateKey(d);
			const label =
				i === 0 ? 'Today' : i === 1 ? 'Yday' : d.toLocaleDateString('en', { weekday: 'short' });
			days.push({ label, count: 0, key });
		}
		const map = new Map(days.map((x) => [x.key, x]));
		const source = activityLog.length > 0 ? activityLog : history;
		for (const h of source) {
			const ts = Number(h.timestamp);
			if (!ts) continue;
			const ms = ts < 1e12 ? ts * 1000 : ts;
			const key = localDateKey(new Date(ms));
			const row = map.get(key);
			if (row) row.count++;
		}
		return days;
	});

	let maxActivity = $derived(Math.max(1, ...activityDays.map((d) => d.count)));

	const CHART_H = 120;
	const CHART_PAD_TOP = 16;
	const CHART_PAD_BOT = 4;
	const CHART_USABLE = CHART_H - CHART_PAD_TOP - CHART_PAD_BOT;

	let activityChart = $derived.by(() => {
		const n = activityDays.length || 1;
		const step = 100 / n;
		const points = activityDays.map((d, i) => {
			const x = step * i + step / 2;
			const h = d.count === 0 ? 0 : Math.max(0.08, d.count / maxActivity);
			const y = CHART_PAD_TOP + CHART_USABLE * (1 - h);
			return { x, y, h, count: d.count, key: d.key, label: d.label, i };
		});
		const linePoints = points.map((p) => `${p.x},${(p.y / CHART_H) * 100}`).join(' ');
		const areaPoints =
			`${step / 2},${((CHART_PAD_TOP + CHART_USABLE) / CHART_H) * 100} ` +
			linePoints +
			` ${step * (n - 1) + step / 2},${((CHART_PAD_TOP + CHART_USABLE) / CHART_H) * 100}`;
		const bars = points.map((p) => {
			const x = step * p.i + step * 0.2;
			const barW = step * 0.6;
			const hRatio = p.count === 0 ? 0.015 : Math.max(0.08, p.count / maxActivity);
			const barH = CHART_USABLE * hRatio;
			const y = CHART_PAD_TOP + CHART_USABLE - barH;
			return { x, y, barW, barH, count: p.count, key: p.key, label: p.label };
		});
		return { step, linePoints, areaPoints, bars, points };
	});

	let localXp = $derived(
		computeTotalXp({
			titleCount: totalTitles,
			bookmarkCount,
			sourceCount: sourceMap.length,
			chapterProgressXpSum: sumChapterProgressXp(history)
		})
	);
	
	let totalXp = $derived(Math.max(lifetimeXp, localXp));
	let levelInfo = $derived(computeLevelInfo(totalXp));

	function polar(cx: number, cy: number, r: number, angleDeg: number) {
		const a = ((angleDeg - 90) * Math.PI) / 180;
		return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
	}

	function arcPath(
		cx: number,
		cy: number,
		r: number,
		startAngle: number,
		endAngle: number
	): string {
		if (endAngle - startAngle >= 359.9) {
			const p1 = polar(cx, cy, r, 0);
			const p2 = polar(cx, cy, r, 179.9);
			return `M ${p1.x} ${p1.y} A ${r} ${r} 0 1 1 ${p2.x} ${p2.y} A ${r} ${r} 0 1 1 ${p1.x} ${p1.y}`;
		}
		const start = polar(cx, cy, r, startAngle);
		const end = polar(cx, cy, r, endAngle);
		const large = endAngle - startAngle > 180 ? 1 : 0;
		return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y} Z`;
	}

	let titlePie = $derived.by(() => {
		const total = Math.max(1, totalTitles);
		const comicAngle = (comicTitles / total) * 360;
		return {
			comicPct: Math.round((comicTitles / total) * 100),
			novelPct: Math.round((novelTitles / total) * 100),
			comicPath: comicTitles > 0 ? arcPath(100, 100, 80, 0, comicAngle || 0.1) : '',
			novelPath: novelTitles > 0 ? arcPath(100, 100, 80, comicAngle, 360) : ''
		};
	});

	let chapterPie = $derived.by(() => {
		const total = Math.max(1, totalChapters);
		const comicAngle = (comicChapters / total) * 360;
		return {
			comicPct: Math.round((comicChapters / total) * 100),
			novelPct: Math.round((novelChapters / total) * 100),
			comicPath: comicChapters > 0 ? arcPath(100, 100, 80, 0, comicAngle || 0.1) : '',
			novelPath: novelChapters > 0 ? arcPath(100, 100, 80, comicAngle, 360) : ''
		};
	});

	let recent = $derived(history.slice(0, 10));

	function formatTime(ts: number): string {
		const ms = ts < 1e12 ? ts * 1000 : ts;
		const diff = Date.now() - ms;
		const m = Math.floor(diff / 60000);
		const h = Math.floor(diff / 3600000);
		const d = Math.floor(diff / 86400000);
		if (d > 0) return `${d}d ago`;
		if (h > 0) return `${h}h ago`;
		if (m > 0) return `${m}m ago`;
		return 'Just now';
	}

	async function load() {
		history = getHistory();
		bookmarkCount = getBookmarks().length;
		try {
			activityLog = await getActivityLog(14);
		} catch {
			activityLog = [];
		}
	}

	async function loadLifetime() {
		if (!getUser()) {
			lifetimeXp = 0;
			return;
		}
		// Instant from localStorage
		hydrateLifetimeFromLocalStorage();
		lifetimeXp = getCachedLifetimeStats().totalXp;
		try {
			const titleIds = history.map((h) => h.mangaId);
			const sourceIds = [...new Set(history.map((h) => h.sourceId).filter(Boolean))];
			const stats = await bootstrapLifetimeFromLocal({
				titleCount: history.length,
				bookmarkCount,
				sourceCount: sourceIds.length,
				chapterProgressXpSum: sumChapterProgressXp(history),
				titleIds,
				sourceIds,
				chapterProgress: history.map((h) => ({
					mangaId: h.mangaId,
					chapterNumber: h.chapterNumber
				}))
			});
			lifetimeXp = stats.totalXp;
		} catch (e) {
			console.error('lifetime load failed', e);
			try {
				const s = await loadLifetimeStats();
				lifetimeXp = s.totalXp;
			} catch {}
		}
	}

	onMount(() => {
		const updateTheme = () => {
			isDark = document.documentElement.classList.contains('dark');
		};
		updateTheme();
		const obs = new MutationObserver(updateTheme);
		obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

		// Paint lifetime from LS immediately (before async)
		if (getUser()) {
			hydrateLifetimeFromLocalStorage();
			lifetimeXp = getCachedLifetimeStats().totalXp;
		}

		(async () => {
			await whenHistoryReady();
			await load();
			await loadLifetime();
			ready = true;
		})();
		const onChange = () => {
			void load();
		};
		const onXp = () => {
			lifetimeXp = getCachedLifetimeStats().totalXp;
		};
		window.addEventListener('history-changed', onChange);
		window.addEventListener('bookmarks-changed', onChange);
		window.addEventListener('activity-changed', onChange);
		window.addEventListener('lifetime-xp-changed', onXp);
		return () => {
			obs.disconnect();
			window.removeEventListener('history-changed', onChange);
			window.removeEventListener('bookmarks-changed', onChange);
			window.removeEventListener('activity-changed', onChange);
			window.removeEventListener('lifetime-xp-changed', onXp);
		};
	});

	let card = $derived(
		isDark
			? 'border-zinc-800 bg-zinc-900/50'
			: 'border-zinc-200 bg-white shadow-sm'
	);
	let cardSoft = $derived(
		isDark ? 'border-zinc-800 bg-zinc-900/40' : 'border-zinc-200 bg-white shadow-sm'
	);
	let textMain = $derived(isDark ? 'text-white' : 'text-zinc-900');
	let textMuted = $derived(isDark ? 'text-zinc-500' : 'text-zinc-500');
	let textSub = $derived(isDark ? 'text-zinc-300' : 'text-zinc-700');
	let pieHole = $derived(isDark ? '#18181b' : '#f4f4f5');
	let pieEmpty = $derived(isDark ? '#27272a' : '#e4e4e7');
	let pieText = $derived(isDark ? '#fff' : '#18181b');
	let barTrack = $derived(isDark ? 'bg-zinc-800' : 'bg-zinc-200');
	let divide = $derived(isDark ? 'divide-zinc-800/80' : 'divide-zinc-100');
	let hoverRow = $derived(isDark ? 'hover:bg-zinc-800/40' : 'hover:bg-zinc-50');
</script>

<svelte:head>
	<title>My Stats — RokuYomu</title>
</svelte:head>

<div class="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
	<div class="border-b pb-4 {isDark ? 'border-zinc-800' : 'border-zinc-200'}">
		<h1 class="flex items-center gap-2 text-xl font-bold text-violet-500 md:text-2xl">
			<Trophy class="h-6 w-6" />
			My Stats
		</h1>
		<p class="mt-1 text-sm {textMuted}">Reading progress · Rank · Breakdown</p>
	</div>

	{#if !ready}
		<div class="flex min-h-[40vh] items-center justify-center">
			<div
				class="h-10 w-10 animate-spin rounded-full border-2 border-t-violet-500 {isDark
					? 'border-zinc-700'
					: 'border-zinc-300'}"
			></div>
		</div>
	{:else}
		<div
			class="relative overflow-hidden rounded-2xl border p-5
				{isDark
				? 'border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-900 to-violet-950/40'
				: 'border-zinc-200 bg-gradient-to-br from-white via-white to-violet-50 shadow-sm'}"
		>
			<div
				class="pointer-events-none absolute -top-16 -right-10 h-40 w-40 rounded-full blur-3xl {isDark
					? 'bg-violet-600/20'
					: 'bg-violet-400/15'}"
			></div>
			<div class="relative flex flex-wrap items-center gap-4">
				<div class="relative shrink-0">
					{#if getUser()?.photoURL}
						<img
							src={getUser()!.photoURL}
							alt=""
							class="h-16 w-16 rounded-2xl object-cover ring-2 ring-violet-500/40"
						/>
					{:else if getUser()}
						<div
							class="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-600 text-xl font-black text-white ring-2 ring-violet-400/30"
						>
							{(getUser()?.displayName?.[0] || getUser()?.email?.[0] || 'U').toUpperCase()}
						</div>
					{:else}
						<div
							class="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br {levelInfo.rankCls} text-2xl font-black text-zinc-900 shadow-lg"
						>
							{levelInfo.lv}
						</div>
					{/if}
					<span
						class="absolute -right-1.5 -bottom-1.5 flex h-7 min-w-[1.75rem] items-center justify-center rounded-lg bg-gradient-to-r px-1.5 text-xs font-black text-zinc-900 shadow-md {levelInfo.rankCls}"
					>
						{levelInfo.lv}
					</span>
				</div>

				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-center gap-2">
						{#if getUser()}
							<span class="truncate text-lg font-bold {textMain}">
								{getUser()?.displayName || 'Reader'}
							</span>
						{:else}
							<span class="text-lg font-bold {textMain}">Level {levelInfo.lv}</span>
						{/if}
						<span
							class="inline-flex items-center gap-1 rounded-md bg-gradient-to-r px-2 py-0.5 text-[11px] font-bold text-zinc-900 {levelInfo.rankCls}"
						>
							<Star class="h-3 w-3" />
							{levelInfo.rank}
						</span>
					</div>
					{#if getUser()?.email}
						<p class="mt-0.5 truncate text-[12px] {textMuted}">{getUser()?.email}</p>
					{:else if !getUser()}
						<button
							onclick={() => goto('/')}
							class="mt-0.5 flex items-center gap-1 text-[12px] text-violet-500 hover:underline"
						>
							<LogIn class="h-3 w-3" />
							Login for cloud sync
						</button>
					{/if}
					<div class="mt-2 flex items-center justify-between text-[11px]">
						<span class="flex items-center gap-1 font-semibold text-violet-500">
							<Zap class="h-3.5 w-3.5" />
							{levelInfo.totalXp} XP
						</span>
						<span class="{textMuted}"
							>{levelInfo.remaining} / {levelInfo.need} to next</span
						>
					</div>
					<div class="mt-1.5 h-2.5 overflow-hidden rounded-full {barTrack}">
						<div
							class="h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-amber-400 transition-all duration-700"
							style="width: {levelInfo.progress}%"
						></div>
					</div>
				</div>
			</div>
		</div>

		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
			{#each [
				{ icon: BookOpen, label: 'Titles', value: totalTitles, color: 'text-sky-500' },
				{ icon: Bookmark, label: 'Bookmarks', value: bookmarkCount, color: 'text-rose-500' },
				{ icon: Flame, label: 'Progress', value: totalChapters, color: 'text-orange-500' },
				{ icon: Library, label: 'Sources', value: sourceMap.length, color: 'text-emerald-500' },
				{ icon: ScrollText, label: 'Comics', value: comicTitles, color: 'text-red-500' },
				{ icon: BookOpen, label: 'Novels', value: novelTitles, color: 'text-violet-500' }
			] as c}
				<div class="rounded-2xl border p-3.5 {card}">
					<div class="flex items-center gap-1.5 text-[11px] {textMuted}">
						<c.icon class="h-3.5 w-3.5 {c.color}" />
						{c.label}
					</div>
					<p class="mt-1 text-2xl font-black tabular-nums {textMain}">{c.value}</p>
				</div>
			{/each}
		</div>

		<div class="grid gap-4 md:grid-cols-2">
			<div class="rounded-2xl border p-5 {cardSoft}">
				<h2 class="mb-4 flex items-center gap-2 text-sm font-semibold {textSub}">
					<PieChart class="h-4 w-4 text-violet-500" />
					Titles: Comic vs Novel
				</h2>
				<div class="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
					<svg viewBox="0 0 200 200" class="h-44 w-44 shrink-0">
						{#if totalTitles === 0}
							<circle cx="100" cy="100" r="80" fill={pieEmpty} />
							<text x="100" y="105" text-anchor="middle" fill="#71717a" font-size="12"
								>No data</text
							>
						{:else}
							{#if titlePie.comicPath}
								<path d={titlePie.comicPath} fill="#f87171" />
							{/if}
							{#if titlePie.novelPath}
								<path d={titlePie.novelPath} fill="#a78bfa" />
							{/if}
							<circle cx="100" cy="100" r="48" fill={pieHole} />
							<text
								x="100"
								y="96"
								text-anchor="middle"
								fill={pieText}
								font-size="18"
								font-weight="700">{totalTitles}</text
							>
							<text x="100" y="114" text-anchor="middle" fill="#71717a" font-size="10"
								>titles</text
							>
						{/if}
					</svg>
					<div class="w-full max-w-[200px] space-y-2 text-sm">
						<div class="flex items-center gap-2">
							<span class="h-3 w-3 shrink-0 rounded-full bg-red-400"></span>
							<span class="{textMuted}">Comic / Manga</span>
							<span class="ml-auto font-bold tabular-nums {textMain}"
								>{comicTitles}
								<span class="{textMuted}">({titlePie.comicPct}%)</span></span
							>
						</div>
						<div class="flex items-center gap-2">
							<span class="h-3 w-3 shrink-0 rounded-full bg-violet-400"></span>
							<span class="{textMuted}">Novel</span>
							<span class="ml-auto font-bold tabular-nums {textMain}"
								>{novelTitles}
								<span class="{textMuted}">({titlePie.novelPct}%)</span></span
							>
						</div>
					</div>
				</div>
			</div>

			<div class="rounded-2xl border p-5 {cardSoft}">
				<h2 class="mb-4 flex items-center gap-2 text-sm font-semibold {textSub}">
					<PieChart class="h-4 w-4 text-amber-500" />
					Progress markers: Comic vs Novel
				</h2>
				<div class="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
					<svg viewBox="0 0 200 200" class="h-44 w-44 shrink-0">
						{#if totalChapters === 0}
							<circle cx="100" cy="100" r="80" fill={pieEmpty} />
							<text x="100" y="105" text-anchor="middle" fill="#71717a" font-size="12"
								>No data</text
							>
						{:else}
							{#if chapterPie.comicPath}
								<path d={chapterPie.comicPath} fill="#fb923c" />
							{/if}
							{#if chapterPie.novelPath}
								<path d={chapterPie.novelPath} fill="#2dd4bf" />
							{/if}
							<circle cx="100" cy="100" r="48" fill={pieHole} />
							<text
								x="100"
								y="96"
								text-anchor="middle"
								fill={pieText}
								font-size="18"
								font-weight="700">{totalChapters}</text
							>
							<text x="100" y="114" text-anchor="middle" fill="#71717a" font-size="10"
								>ch.</text
							>
						{/if}
					</svg>
					<div class="w-full max-w-[200px] space-y-2 text-sm">
						<div class="flex items-center gap-2">
							<span class="h-3 w-3 shrink-0 rounded-full bg-orange-400"></span>
							<span class="{textMuted}">Comic progress</span>
							<span class="ml-auto font-bold tabular-nums {textMain}"
								>{comicChapters}
								<span class="{textMuted}">({chapterPie.comicPct}%)</span></span
							>
						</div>
						<div class="flex items-center gap-2">
							<span class="h-3 w-3 shrink-0 rounded-full bg-teal-400"></span>
							<span class="{textMuted}">Novel progress</span>
							<span class="ml-auto font-bold tabular-nums {textMain}"
								>{novelChapters}
								<span class="{textMuted}">({chapterPie.novelPct}%)</span></span
							>
						</div>
					</div>
				</div>
			</div>
		</div>

		<div class="rounded-2xl border p-5 {cardSoft}">
			<h2 class="mb-4 flex items-center gap-2 text-sm font-semibold {textSub}">
				<Activity class="h-4 w-4 text-sky-500" />
				Activity — last 14 days
			</h2>
			<div class="relative w-full" style="height: {CHART_H + 22}px">
				<svg
					viewBox="0 0 100 {CHART_H}"
					preserveAspectRatio="none"
					class="absolute inset-x-0 top-0 w-full"
					style="height: {CHART_H}px"
				>
					{#each [0.25, 0.5, 0.75, 1] as g}
						<line
							x1="0"
							y1={CHART_PAD_TOP + CHART_USABLE * (1 - g)}
							x2="100"
							y2={CHART_PAD_TOP + CHART_USABLE * (1 - g)}
							stroke={isDark ? '#3f3f46' : '#e4e4e7'}
							stroke-width="0.3"
							stroke-dasharray="1.5 1.5"
							vector-effect="non-scaling-stroke"
						/>
					{/each}

					<polygon
						points={activityChart.areaPoints}
						fill="url(#activityGrad)"
						opacity="0.25"
					/>

					<polyline
						points={activityChart.linePoints}
						fill="none"
						stroke="#8b5cf6"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
						vector-effect="non-scaling-stroke"
					/>

					{#each activityChart.points as p}
						<circle
							cx={p.x}
							cy={p.y}
							r={p.count > 0 ? 1.8 : 1.1}
							fill={p.count > 0 ? '#a78bfa' : isDark ? '#52525b' : '#d4d4d8'}
							stroke={isDark ? '#18181b' : '#fff'}
							stroke-width="0.7"
							vector-effect="non-scaling-stroke"
						>
							<title>{p.count} reads · {p.key}</title>
						</circle>
					{/each}

					<defs>
						<linearGradient id="activityGrad" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.45" />
							<stop offset="100%" stop-color="#8b5cf6" stop-opacity="0" />
						</linearGradient>
					</defs>
				</svg>

				<div class="pointer-events-none absolute inset-x-0 top-0 flex" style="height: {CHART_H}px">
					{#each activityChart.points as p}
						<div class="relative flex-1">
							{#if p.count > 0}
								<span
									class="absolute left-1/2 -translate-x-1/2 text-[9px] font-bold tabular-nums text-violet-500"
									style="top: {Math.max(0, (p.y / CHART_H) * CHART_H - 14)}px"
								>
									{p.count}
								</span>
							{/if}
						</div>
					{/each}
				</div>

				<div class="absolute inset-x-0 bottom-0 flex">
					{#each activityDays as day}
						<span class="flex-1 text-center text-[9px] {textMuted} sm:text-[10px]">
							{day.label}
						</span>
					{/each}
				</div>
			</div>
		</div>

		<div class="rounded-2xl border p-5 {cardSoft}">
			<h2 class="mb-4 flex items-center gap-2 text-sm font-semibold {textSub}">
				<TrendingUp class="h-4 w-4 text-emerald-500" />
				Top sources
			</h2>
			{#if topSources.length === 0}
				<p class="text-sm {textMuted}">No reading data yet.</p>
			{:else}
				<div class="space-y-2">
					{#each topSources as s}
						{@const pct = Math.round((s.count / Math.max(1, totalTitles)) * 100)}
						<div>
							<div class="mb-1 flex items-center justify-between text-xs">
								<span class="font-medium {textSub}">
									{s.id}
									<span
										class="ml-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase {s.isNovel
											? isDark
												? 'bg-violet-500/20 text-violet-300'
												: 'bg-violet-100 text-violet-700'
											: isDark
												? 'bg-red-500/20 text-red-300'
												: 'bg-red-100 text-red-700'}"
									>
										{s.isNovel ? 'novel' : 'comic'}
									</span>
								</span>
								<span class="tabular-nums {textMuted}">{s.count} · {pct}%</span>
							</div>
							<div class="h-1.5 overflow-hidden rounded-full {barTrack}">
								<div
									class="h-full rounded-full {s.isNovel ? 'bg-violet-500' : 'bg-red-500'}"
									style="width: {pct}%"
								></div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div class="rounded-2xl border p-5 {cardSoft}">
			<h2 class="mb-4 flex items-center gap-2 text-sm font-semibold {textSub}">
				<Clock class="h-4 w-4 {textMuted}" />
				Recent reads
			</h2>
			{#if recent.length === 0}
				<p class="text-sm {textMuted}">Start reading to build your stats.</p>
			{:else}
				<div class="divide-y {divide}">
					{#each recent as item}
						<a
							href="/manga/{item.sourceId}{item.mangaId}"
							class="flex items-center gap-3 py-2.5 transition {hoverRow}"
						>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium {textSub}">
									{item.mangaTitle || 'Untitled'}
								</p>
								<p class="truncate text-[11px] {textMuted}">
									{item.sourceId} · Ch.{item.chapterNumber || '?'} · {item.chapterTitle || ''}
								</p>
							</div>
							<span
								class="shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase {isNovelSource(
									item.sourceId
								)
									? isDark
										? 'bg-violet-500/15 text-violet-300'
										: 'bg-violet-100 text-violet-700'
									: isDark
										? 'bg-red-500/15 text-red-300'
										: 'bg-red-100 text-red-700'}"
							>
								{isNovelSource(item.sourceId) ? 'novel' : 'comic'}
							</span>
							<span class="shrink-0 text-[11px] {textMuted}">{formatTime(item.timestamp)}</span>
						</a>
					{/each}
				</div>
				<a
					href="/history"
					class="mt-3 inline-block text-xs font-medium text-violet-500 hover:underline"
				>
					View full history →
				</a>
			{/if}
		</div>
	{/if}
</div>
