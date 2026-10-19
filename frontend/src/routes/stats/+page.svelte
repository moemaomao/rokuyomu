<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
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
	import { proxyImage } from '$lib/utils/image';
	import {
		computeTotalXp,
		computeLevelInfo,
		sumChapterMarkers,
		sumChapterProgressXp
	} from '$lib/utils/level';
	import {
		loadLifetimeStats,
		bootstrapLifetimeFromLocal,
		getInstantLifetimeXp
	} from '$lib/stores/lifetimeXp';
	import {
		loadPermanentStats,
		hydratePermanentStats,
		getCachedPermanentStats,
		permanentStatsView,
		bootstrapPermanentFromHistory
	} from '$lib/stores/permanentStats';
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
	let permView = $state<ReturnType<typeof permanentStatsView> | null>(null);

	let comicHistory = $derived(history.filter((h) => !isNovelSource(h.sourceId)));
	let novelHistory = $derived(history.filter((h) => isNovelSource(h.sourceId)));

	let comicTitles = $derived(permView ? permView.comicTitles : comicHistory.length);
	let novelTitles = $derived(permView ? permView.novelTitles : novelHistory.length);
	let totalTitles = $derived(permView ? permView.totalTitles : history.length);

	let comicChapters = $derived(permView ? permView.comicProgress : sumChapterMarkers(comicHistory));
	let novelChapters = $derived(permView ? permView.novelProgress : sumChapterMarkers(novelHistory));
	let totalChapters = $derived(permView ? permView.totalProgress : comicChapters + novelChapters);

	let sourceMap = $derived.by(() => {
		if (permView?.topSources?.length) {
			return permView.topSources;
		}
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

	let activityWindow = $state(7);

	function updateActivityWindow() {
		if (typeof window === 'undefined') return;
		activityWindow = window.matchMedia('(min-width: 640px)').matches ? 14 : 7;
	}

	let activityDays = $derived.by(() => {
		const windowDays = activityWindow;
		const days: { label: string; count: number; key: string }[] = [];
		const now = new Date();
		for (let i = windowDays - 1; i >= 0; i--) {
			const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
			const key = localDateKey(d);
			let label: string;
			if (i === 0) label = 'Today';
			else if (i === 1) label = 'Yday';
			else if (windowDays <= 7) {
				label = d.toLocaleDateString('en', { weekday: 'short' });
			} else {
				label = d.toLocaleDateString('en', { weekday: 'short' });
			}
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

	let liveLocalXp = $derived(
		computeTotalXp({
			titleCount: history.length,
			bookmarkCount,
			sourceCount: new Set(history.map((h) => h.sourceId).filter(Boolean)).size,
			chapterProgressXpSum: sumChapterProgressXp(history)
		})
	);
	let totalXp = $derived(Math.max(lifetimeXp, liveLocalXp));
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

	let recent = $derived(history.slice(0, 12));

	function formatTime(ts: number): string {
		const ms = ts < 1e12 ? ts * 1000 : ts;
		const diff = Date.now() - ms;
		const m = Math.floor(diff / 60000);
		const h = Math.floor(diff / 3600000);
		const d = Math.floor(diff / 86400000);
		if (d > 0) return `${d}d`;
		if (h > 0) return `${h}h`;
		if (m > 0) return `${m}m`;
		return 'now';
	}

	function formatDateShort(ts: number): string {
		const ms = ts < 1e12 ? ts * 1000 : ts;
		const d = new Date(ms);
		const now = new Date();
		const sameYear = d.getFullYear() === now.getFullYear();
		if (sameYear) {
			return d.toLocaleDateString('en', { month: 'short', day: 'numeric' }).toUpperCase();
		}
		return d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: '2-digit' }).toUpperCase();
	}

	async function load() {
		history = getHistory();
		bookmarkCount = getBookmarks().length;
		try {
			activityLog = await getActivityLog(activityWindow);
		} catch {
			activityLog = [];
		}
	}

	async function loadLifetime() {
		if (!getUser()) {
			lifetimeXp = 0;
			return;
		}
		lifetimeXp = getInstantLifetimeXp();
		try {
			const titleIds = history.map((h) => h.mangaId);
			const sourceIds = [...new Set(history.map((h) => h.sourceId).filter(Boolean))];
			const s = await bootstrapLifetimeFromLocal({
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
			lifetimeXp = Math.max(lifetimeXp, s.totalXp);
		} catch (e) {
			console.error('lifetime load failed', e);
			try {
				lifetimeXp = Math.max(lifetimeXp, (await loadLifetimeStats()).totalXp);
			} catch {}
		}
	}

	async function loadPermanent() {
		hydratePermanentStats();
		permView = permanentStatsView(getCachedPermanentStats());
		try {
			let doc = await loadPermanentStats();
			if (history.length > 0 && Object.keys(doc.titles || {}).length === 0) {
				doc = await bootstrapPermanentFromHistory(
					history.map((h) => ({
						mangaId: h.mangaId,
						sourceId: h.sourceId,
						chapterNumber: h.chapterNumber,
						mangaTitle: h.mangaTitle
					}))
				);
			}
			permView = permanentStatsView(doc);
		} catch (e) {
			console.error('permanent stats load failed', e);
		}
	}

	onMount(() => {
		const updateTheme = () => {
			isDark = document.documentElement.classList.contains('dark');
		};
		updateTheme();
		updateActivityWindow();
		const mq = window.matchMedia('(min-width: 640px)');
		const onMq = () => updateActivityWindow();
		mq.addEventListener?.('change', onMq);

		const obs = new MutationObserver(updateTheme);
		obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

		if (getUser()) {
			lifetimeXp = getInstantLifetimeXp();
		}
		hydratePermanentStats();
		permView = permanentStatsView(getCachedPermanentStats());
		history = getHistory();
		bookmarkCount = getBookmarks().length;
		ready = true;

		const onChange = () => {
			void load();
		};
		const onXp = () => {
			lifetimeXp = Math.max(lifetimeXp, getInstantLifetimeXp());
		};
		window.addEventListener('history-changed', onChange);
		window.addEventListener('bookmarks-changed', onChange);
		window.addEventListener('activity-changed', onChange);
		window.addEventListener('permanent-stats-changed', () => {
			permView = permanentStatsView(getCachedPermanentStats());
		});
		window.addEventListener('lifetime-xp-changed', onXp);

		const idle =
			typeof requestIdleCallback === 'function'
				? (cb: () => void) => requestIdleCallback(cb, { timeout: 1200 })
				: (cb: () => void) => setTimeout(cb, 50);

		idle(() => {
			void (async () => {
				try {
					await whenHistoryReady();
					await load();
					await loadLifetime();
					await loadPermanent();
				} catch (e) {
					console.warn('[stats] deferred load failed', e);
				}
			})();
		});

		return () => {
			obs.disconnect();
			mq.removeEventListener?.('change', onMq);
			window.removeEventListener('history-changed', onChange);
			window.removeEventListener('bookmarks-changed', onChange);
			window.removeEventListener('activity-changed', onChange);
			window.removeEventListener('lifetime-xp-changed', onXp);
		};
	});

	let card = $derived(
		isDark
			? 'border-[rgba(109,198,250,0.12)] bg-[rgba(20,22,23,0.85)]'
			: 'border-zinc-200 bg-white shadow-sm'
	);
	let cardSoft = $derived(
		isDark
			? 'border-[rgba(109,198,250,0.10)] bg-[rgba(18,20,21,0.9)]'
			: 'border-zinc-200 bg-white shadow-sm'
	);
	let textMain = $derived(isDark ? 'text-[#e8e6e3]' : 'text-zinc-900');
	let textMuted = $derived(isDark ? 'text-[rgba(232,230,227,0.45)]' : 'text-zinc-500');
	let textSub = $derived(isDark ? 'text-[rgba(232,230,227,0.75)]' : 'text-zinc-700');
	let pieHole = $derived(isDark ? '#141617' : '#f4f4f5');
	let pieEmpty = $derived(isDark ? '#1e2124' : '#e4e4e7');
	let pieText = $derived(isDark ? '#e8e6e3' : '#18181b');
	let barTrack = $derived(isDark ? 'bg-[rgba(255,255,255,0.06)]' : 'bg-zinc-200');
	let divide = $derived(isDark ? 'divide-[rgba(109,198,250,0.08)]' : 'divide-zinc-100');
	let hoverRow = $derived(
		isDark ? 'hover:bg-[rgba(109,198,250,0.06)]' : 'hover:bg-zinc-50'
	);
	let accent = $derived(isDark ? 'text-sky-400' : 'text-sky-600');
</script>

<svelte:head>
	<title>My Stats — RokuYomu</title>
</svelte:head>

<div class="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
	<!-- Header -->
	<div class="border-b pb-4 {isDark ? 'border-[rgba(109,198,250,0.12)]' : 'border-zinc-200'}">
		<h1 class="flex items-center gap-2 text-xl font-bold {accent} md:text-2xl">
			<Trophy class="h-6 w-6" />
			My Stats
		</h1>
		<p class="mt-1 text-sm {textMuted}">Reading progress · Rank · Breakdown</p>
	</div>

	{#if !ready}
		<div class="flex min-h-[40vh] items-center justify-center">
			<div
				class="h-10 w-10 animate-spin rounded-full border-2 border-t-sky-400 {isDark
					? 'border-zinc-700'
					: 'border-zinc-300'}"
			></div>
		</div>
	{:else}
	
		<div
			class="relative overflow-hidden rounded-xl border p-5
				{isDark
				? 'border-[rgba(109,198,250,0.14)] bg-gradient-to-br from-[#141617] via-[#16181a] to-[#0d1a24]'
				: 'border-zinc-200 bg-gradient-to-br from-white via-white to-sky-50 shadow-sm'}"
		>
			<div
				class="pointer-events-none absolute -top-16 -right-10 h-40 w-40 rounded-full blur-3xl {isDark
					? 'bg-sky-500/10'
					: 'bg-sky-400/15'}"
			></div>
			<div class="relative flex flex-wrap items-center gap-4">
				<div class="relative shrink-0">
					{#if getUser()?.photoURL}
						<img
							src={getUser()!.photoURL}
							alt=""
							class="h-16 w-16 rounded-xl object-cover ring-2 ring-sky-400/30"
						/>
					{:else if getUser()}
						<div
							class="flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-to-br from-sky-600 to-cyan-600 text-xl font-black text-white ring-2 ring-sky-400/25"
						>
							{(getUser()?.displayName?.[0] || getUser()?.email?.[0] || 'U').toUpperCase()}
						</div>
					{:else}
						<div
							class="flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-to-br {levelInfo.rankCls} text-2xl font-black text-zinc-900 shadow-lg"
						>
							{levelInfo.lv}
						</div>
					{/if}
					<span
						class="absolute -right-1.5 -bottom-1.5 flex h-7 min-w-[1.75rem] items-center justify-center rounded-md bg-gradient-to-r px-1.5 text-xs font-black text-zinc-900 shadow-md {levelInfo.rankCls}"
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
							class="mt-0.5 flex items-center gap-1 text-[12px] text-sky-400 hover:underline"
						>
							<LogIn class="h-3 w-3" />
							Login for cloud sync
						</button>
					{/if}
					<div class="mt-2 flex items-center justify-between text-[11px]">
						<span class="flex items-center gap-1 font-semibold text-sky-400">
							<Zap class="h-3.5 w-3.5" />
							{levelInfo.totalXp} XP
						</span>
						<span class="{textMuted}"
							>{levelInfo.remaining} / {levelInfo.need} to next</span
						>
					</div>
					<div class="mt-1.5 h-2 overflow-hidden rounded-full {barTrack}">
						<div
							class="h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400 transition-all duration-700"
							style="width: {levelInfo.progress}%"
						></div>
					</div>
				</div>
			</div>
		</div>

		<div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
			{#each [
				{
					icon: BookOpen,
					label: 'Titles',
					value: totalTitles,
					color: 'text-sky-300',
					border: isDark ? 'border-sky-500/35' : 'border-sky-200',
					bg: isDark
						? 'bg-gradient-to-br from-sky-500/20 via-[#141617] to-[#141617]'
						: 'bg-gradient-to-br from-sky-50 to-white',
					glow: 'bg-sky-400/25'
				},
				{
					icon: Bookmark,
					label: 'Bookmarks',
					value: bookmarkCount,
					color: 'text-fuchsia-300',
					border: isDark ? 'border-fuchsia-500/35' : 'border-fuchsia-200',
					bg: isDark
						? 'bg-gradient-to-br from-fuchsia-500/20 via-[#141617] to-[#141617]'
						: 'bg-gradient-to-br from-fuchsia-50 to-white',
					glow: 'bg-fuchsia-400/25'
				},
				{
					icon: Flame,
					label: 'Progress',
					value: totalChapters,
					color: 'text-orange-300',
					border: isDark ? 'border-orange-500/35' : 'border-orange-200',
					bg: isDark
						? 'bg-gradient-to-br from-orange-500/20 via-[#141617] to-[#141617]'
						: 'bg-gradient-to-br from-orange-50 to-white',
					glow: 'bg-orange-400/25'
				},
				{
					icon: Library,
					label: 'Sources',
					value: sourceMap.length,
					color: 'text-emerald-300',
					border: isDark ? 'border-emerald-500/35' : 'border-emerald-200',
					bg: isDark
						? 'bg-gradient-to-br from-emerald-500/20 via-[#141617] to-[#141617]'
						: 'bg-gradient-to-br from-emerald-50 to-white',
					glow: 'bg-emerald-400/25'
				},
				{
					icon: ScrollText,
					label: 'Comics',
					value: comicTitles,
					color: 'text-red-400',
					border: isDark ? 'border-red-500/40' : 'border-red-200',
					bg: isDark
						? 'bg-gradient-to-br from-red-600/25 via-[#141617] to-[#141617]'
						: 'bg-gradient-to-br from-red-50 to-white',
					glow: 'bg-red-500/30'
				},
				{
					icon: BookOpen,
					label: 'Novels',
					value: novelTitles,
					color: 'text-violet-300',
					border: isDark ? 'border-violet-500/35' : 'border-violet-200',
					bg: isDark
						? 'bg-gradient-to-br from-violet-500/20 via-[#141617] to-[#141617]'
						: 'bg-gradient-to-br from-violet-50 to-white',
					glow: 'bg-violet-400/25'
				}
			] as c}
				<div
					class="group relative overflow-hidden rounded-lg border p-3.5 transition-all duration-200
						{c.border} {c.bg}
						hover:brightness-110"
				>
					<div
						class="pointer-events-none absolute -right-4 -top-4 h-16 w-16 rounded-full blur-2xl {c.glow} opacity-60 group-hover:opacity-90 transition-opacity"
					></div>
					<div class="relative">
						<div class="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider {c.color} opacity-90">
							<c.icon class="h-3.5 w-3.5" />
							{c.label}
						</div>
						<p class="mt-1.5 text-2xl font-bold tabular-nums tracking-tight {textMain}">
							{c.value}
						</p>
					</div>
				</div>
			{/each}
		</div>

		<!-- Pie charts -->
		<div class="grid gap-4 md:grid-cols-2">
			<div class="rounded-xl border p-5 {cardSoft}">
				<h2 class="mb-4 flex items-center gap-2 text-sm font-semibold {textSub}">
					<PieChart class="h-4 w-4 text-sky-400" />
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

			<div class="rounded-xl border p-5 {cardSoft}">
				<h2 class="mb-4 flex items-center gap-2 text-sm font-semibold {textSub}">
					<PieChart class="h-4 w-4 text-amber-400" />
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

		<div class="rounded-xl border p-5 {cardSoft}">
			<h2 class="mb-4 flex items-center gap-2 text-sm font-semibold {textSub}">
				<Activity class="h-4 w-4 text-sky-400" />
				Activity — last {activityWindow} days
			</h2>
			<div class="relative w-full" style="height: {CHART_H + 28}px">
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
							stroke={isDark ? 'rgba(109,198,250,0.08)' : '#e4e4e7'}
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
						stroke="#38bdf8"
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
							fill={p.count > 0 ? '#7dd3fc' : isDark ? '#3f3f46' : '#d4d4d8'}
							stroke={isDark ? '#141617' : '#fff'}
							stroke-width="0.7"
							vector-effect="non-scaling-stroke"
						>
							<title>{p.count} reads · {p.key}</title>
						</circle>
					{/each}

					<defs>
						<linearGradient id="activityGrad" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stop-color="#38bdf8" stop-opacity="0.45" />
							<stop offset="100%" stop-color="#38bdf8" stop-opacity="0" />
						</linearGradient>
					</defs>
				</svg>

				<div class="pointer-events-none absolute inset-x-0 top-0 flex" style="height: {CHART_H}px">
					{#each activityChart.points as p}
						<div class="relative flex-1">
							{#if p.count > 0}
								<span
									class="absolute left-1/2 -translate-x-1/2 text-[9px] font-bold tabular-nums text-sky-400"
									style="top: {Math.max(0, (p.y / CHART_H) * CHART_H - 14)}px"
								>
									{p.count}
								</span>
							{/if}
						</div>
					{/each}
				</div>

				<div class="absolute inset-x-0 bottom-0 flex gap-0.5 px-0.5">
					{#each activityDays as day}
						<span
							class="min-w-0 flex-1 truncate text-center text-[10px] leading-tight {textMuted} sm:text-[11px]"
							title={day.key}
						>
							{day.label}
						</span>
					{/each}
				</div>
			</div>
		</div>

		<div class="rounded-xl border p-5 {cardSoft}">
			<h2 class="mb-4 flex items-center gap-2 text-sm font-semibold {textSub}">
				<TrendingUp class="h-4 w-4 text-emerald-400" />
				Top sources
			</h2>
			{#if topSources.length === 0}
				<p class="text-sm {textMuted}">No reading data yet.</p>
			{:else}
				<div class="space-y-2.5">
					{#each topSources as s}
						{@const pct = Math.round((s.count / Math.max(1, topSources[0]?.count || 1)) * 100)}
						<div>
							<div class="mb-1 flex items-center justify-between text-xs">
								<span class="font-medium {textSub}">
									{s.id}
									<span
										class="ml-1.5 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide {s.isNovel
											? isDark
												? 'bg-violet-500/15 text-violet-300'
												: 'bg-violet-100 text-violet-700'
											: isDark
												? 'bg-red-500/15 text-red-300'
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

		<div class="rounded-xl border overflow-hidden {cardSoft}">
			<div class="flex items-center justify-between px-5 pt-4 pb-3">
				<h2 class="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-400/90">
					Recent reads
				</h2>
				<a
					href="/history"
					class="text-[11px] font-medium text-sky-400/70 hover:text-sky-300 transition-colors"
				>
					View all →
				</a>
			</div>

			{#if recent.length === 0}
				<p class="px-5 pb-5 text-sm {textMuted}">Start reading to build your stats.</p>
			{:else}
				<div class="divide-y {isDark ? 'divide-white/[0.04]' : 'divide-zinc-100'}">
					{#each recent as item}
						{@const coverSrc = item.cover
							? proxyImage(item.cover, item.sourceId, 120)
							: ''}
						{@const chTitle = (item.chapterTitle || '').trim()}
						{@const isGenericCh =
							!chTitle ||
							/^chapter\s*\d+/i.test(chTitle) ||
							/^ch\.?\s*\d+/i.test(chTitle) ||
							chTitle === String(item.chapterNumber)}
						{@const primaryTitle = isGenericCh
							? item.mangaTitle || chTitle || 'Untitled'
							: chTitle}
						{@const secondaryLine = isGenericCh
							? `${item.sourceId} · Ch.${item.chapterNumber || '?'}`
							: `${item.mangaTitle || item.sourceId} · Ch.${item.chapterNumber || '?'}`}
						<a
							href="/series/{item.sourceId}{item.mangaId}"
							class="group relative flex items-center gap-3.5 overflow-hidden px-4 py-3.5 transition-colors
								{isDark ? 'bg-[#121415]' : 'bg-white'}"
						>
							{#if coverSrc}
								<img
									src={coverSrc}
									alt=""
									aria-hidden="true"
									class="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover object-[center_25%]
										opacity-[0.35] blur-[5px] saturate-125 brightness-90
										transition-opacity duration-300 group-hover:opacity-[0.48]"
									loading="lazy"
									decoding="async"
								/>
								<div
									class="pointer-events-none absolute inset-0 {isDark
										? 'bg-gradient-to-r from-black/65 via-black/40 to-black/60'
										: 'bg-gradient-to-r from-white/75 via-white/55 to-white/70'}"
								></div>
							{/if}

							<div
								class="relative z-10 h-[56px] w-[42px] shrink-0 overflow-hidden rounded-[4px] shadow-md
									{isDark ? 'ring-1 ring-white/10' : 'ring-1 ring-black/8'} bg-zinc-800"
							>
								{#if coverSrc}
									<img
										src={coverSrc}
										alt=""
										class="h-full w-full object-cover"
										loading="lazy"
										decoding="async"
										onerror={(e) => {
											(e.currentTarget as HTMLImageElement).style.opacity = '0';
										}}
									/>
								{:else}
									<div class="flex h-full w-full items-center justify-center bg-zinc-800">
										<BookOpen class="h-4 w-4 text-zinc-500" />
									</div>
								{/if}
							</div>

							<div class="relative z-10 min-w-0 flex-1">
								<p
									class="truncate text-[14px] font-medium leading-snug tracking-[-0.01em]
										{textMain} drop-shadow-sm group-hover:text-sky-100 transition-colors"
								>
									{primaryTitle}
								</p>
								<p class="mt-0.5 truncate text-[11.5px] {textMuted}">
									{secondaryLine}
								</p>
							</div>

							<span
								class="relative z-10 shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider backdrop-blur-sm
									{isDark
										? 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/25'
										: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200'}"
							>
								{formatDateShort(item.timestamp)}
							</span>
						</a>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
