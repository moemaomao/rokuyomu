<script lang="ts">
	import { onMount } from 'svelte';
	import {
		getLibrary,
		syncLibraryFromBookmarks,
		removeLibraryEntry,
		clearLibrary,
		chooseLibraryFolder,
		librarySupportsDisk,
		ensureLibraryLoaded,
		isLibraryReady,
		getOfflineChapterIds,
		upsertLibraryEntry,
		type LibraryEntry
	} from '$lib/stores/library.svelte';
	import { downloadChapter } from '$lib/utils/downloadChapter';
	import { downloadNovelChapterPdf } from '$lib/utils/downloadNovelPdf';
	import {
		Library,
		FolderOpen,
		RefreshCw,
		Trash2,
		HardDrive,
		BookOpen,
		Download
	} from 'lucide-svelte';
	import { proxyImage } from '$lib/utils/image';
	import { getOfflineCoverObjectUrl } from '$lib/utils/cacheCover';

	let items = $state<LibraryEntry[]>([]);
	let busy = $state(false);
	let msg = $state('');
	let diskOk = $state(false);
	let coverUrls = $state<Record<string, string>>({});

	let batch = $state<{
		active: boolean;
		title: string;
		current: number;
		total: number;
		chapterLabel: string;
		phase: string;
		errors: number;
		cancelled: boolean;
	}>({
		active: false,
		title: '',
		current: 0,
		total: 0,
		chapterLabel: '',
		phase: '',
		errors: 0,
		cancelled: false
	});

	let warnOpen = $state(false);
	let warnTarget = $state<LibraryEntry | null>(null);

	async function load() {
		diskOk = librarySupportsDisk();
		if (!isLibraryReady()) {
			items = sortedItems(await ensureLibraryLoaded());
		} else {
			items = sortedItems(getLibrary());
		}
		void loadCovers(items);
	}

	async function loadCovers(list: LibraryEntry[]) {
		const next: Record<string, string> = { ...coverUrls };
		for (const e of list) {
			if (next[e.key]) continue;
			try {
				const url = await getOfflineCoverObjectUrl(e.mangaId, e.sourceId);
				if (url) next[e.key] = url;
			} catch {
			}
		}
		coverUrls = next;
	}

	function coverSrc(e: LibraryEntry): string {
		if (coverUrls[e.key]) return coverUrls[e.key];
		if (e.cover) return proxyImage(e.cover, e.sourceId, 200);
		return '';
	}

	async function handleSync() {
		busy = true;
		msg = '';
		try {
			const n = await syncLibraryFromBookmarks();
			await load();
			msg =
				n > 0
					? `Synced ${n} title(s) from bookmarks.`
					: 'Already in sync with bookmarks.';
		} catch (e: any) {
			msg = e?.message || 'Sync failed';
		} finally {
			busy = false;
		}
	}

	async function syncTitleMeta(e: LibraryEntry): Promise<{
		latest: string;
		total: number;
		newCount: number;
		lang: string;
	}> {
		const chapters = await fetchAllChapters(e.sourceId, e.mangaId);
		const offline = getOfflineChapterIds(e.sourceId, e.mangaId);
		let latest = e.latestChapter || '';
		let maxN = -1;
		let lang = e.lang || defaultLangForSource(e.sourceId, e.isNovel);
		let newCount = 0;
		for (const c of chapters) {
			const m = String(c.title || c.number || '').match(/(\d+(?:\.\d+)?)/);
			const n = m ? parseFloat(m[1]) : Number(c.number) || -1;
			if (n >= maxN) {
				maxN = n;
				latest = m ? m[1] : String(c.number ?? c.title ?? '');
			}
			if (c.lang) lang = String(c.lang);
			const id = c.id;
			const alt = id.startsWith('/') ? id.slice(1) : `/${id}`;
			if (!offline.has(id) && !offline.has(alt)) newCount++;
		}
		await upsertLibraryEntry({
			mangaId: e.mangaId,
			mangaTitle: e.mangaTitle,
			cover: e.cover || '',
			sourceId: e.sourceId,
			isNovel: e.isNovel,
			latestChapter: latest || undefined,
			lang: lang || undefined
		});
	
		if (e.cover) {
			try {
				const { cacheLibraryCover } = await import('$lib/utils/cacheCover');
				void cacheLibraryCover({
					mangaId: e.mangaId,
					sourceId: e.sourceId,
					coverUrl: e.cover,
					title: e.mangaTitle,
					isNovel: e.isNovel
				});
			} catch {
			}
		}
		return { latest, total: chapters.length, newCount, lang };
	}

	async function handleSyncOne(e: LibraryEntry) {
		if (busy || batch.active) return;
		busy = true;
		msg = '';
		try {
			const r = await syncTitleMeta(e);
			await load();
			msg =
				r.newCount > 0
					? `"${e.mangaTitle}": latest Ch. ${r.latest} · ${r.newCount} chapter(s) not offline yet.`
					: `"${e.mangaTitle}": up to date (Ch. ${r.latest}, ${r.total} total).`;
		} catch (err: any) {
			msg = err?.message || 'Sync failed';
		} finally {
			busy = false;
		}
	}

	async function handleSyncUpdates() {
		if (busy || batch.active) return;
		const list = items.slice();
		if (!list.length) {
			msg = 'Library is empty — nothing to sync.';
			return;
		}
		busy = true;
		msg = '';
		batch = {
			active: true,
			title: 'Sync updates',
			current: 0,
			total: list.length,
			chapterLabel: 'Checking titles…',
			phase: 'sync',
			errors: 0,
			cancelled: false
		};
		let updated = 0;
		let withNew = 0;
		let errors = 0;
		try {
			for (let i = 0; i < list.length; i++) {
				if (batch.cancelled) break;
				const e = list[i];
				batch = {
					...batch,
					current: i,
					chapterLabel: `${i + 1} / ${list.length} — ${e.mangaTitle}`,
					phase: 'sync'
				};
				try {
					const r = await syncTitleMeta(e);
					updated++;
					if (r.newCount > 0) withNew++;
				} catch (err) {
					console.warn('[sync updates]', e.key, err);
					errors++;
					batch = { ...batch, errors };
				}
			}
			await load();
			msg = batch.cancelled
				? 'Sync updates cancelled.'
				: `Checked ${updated} title(s)${withNew ? ` · ${withNew} have chapters not offline` : ' · all up to date'}${errors ? ` · ${errors} error(s)` : ''}.`;
		} finally {
			busy = false;
			batch = {
				active: false,
				title: '',
				current: 0,
				total: 0,
				chapterLabel: '',
				phase: '',
				errors: 0,
				cancelled: false
			};
		}
	}

	function sortedItems(list: LibraryEntry[]): LibraryEntry[] {
		return [...list].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
	}

	async function handlePickFolder() {
		busy = true;
		msg = '';
		try {
			const ok = await chooseLibraryFolder();
			msg = ok
				? 'OK — RokuyomuLibrary folder is ready. Future downloads go there.'
				: 'Folder picker cancelled or not supported.';
		} finally {
			busy = false;
		}
	}

	async function handleRemove(e: LibraryEntry) {
		items = items.filter((x) => x.key !== e.key);
		try {
			await removeLibraryEntry(e.mangaId, e.sourceId);
		} catch {
			await load();
		}
	}

	async function handleClear() {
		if (!confirm('Clear all library metadata? (Files on disk are not deleted.)')) return;
		await clearLibrary();
		await load();
	}


	function listChapterFlag(lang?: string): string {
		const l = String(lang || '')
			.trim()
			.toLowerCase();
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
			tr: 'tr'
		};
		return map[l] || '';
	}

	function defaultLangForSource(sourceId: string, isNovel?: boolean): string {
		const s = String(sourceId || '').toLowerCase();
		const idLang = new Set([
			'sakuranovel',
			'meionovel',
			'bacalightnovel',
			'noveltoon',
			'lovelyblossoms'
		]);
		if (idLang.has(s)) return 'id';
		const jaLang = new Set(['weloma', 'rawkuma', 'senkuro']);
		if (jaLang.has(s)) return 'ja';
		const koLang = new Set(['asurascans', 'flamecomics', 'reaperscans']);
		if (koLang.has(s)) return 'ko';
		const zhLang = new Set(['manhuaplus', 'mangadex']);
		if (zhLang.has(s)) return 'zh';
		if (isNovel) return 'en';
		return 'en';
	}

	function effectiveLang(e: LibraryEntry): string {
		return (e.lang && String(e.lang).trim()) || defaultLangForSource(e.sourceId, e.isNovel);
	}

	function latestChapterLabel(e: LibraryEntry): string {
		if (e.latestChapter) return String(e.latestChapter);
		let max = 0;
		for (const c of e.chapters || []) {
			const m = String(c.chapterTitle || '').match(/(\d+(?:\.\d+)?)/);
			if (m) max = Math.max(max, parseFloat(m[1]));
		}
		return max > 0 ? String(max) : '';
	}

	function href(e: LibraryEntry) {
		const id = e.mangaId.startsWith('/') ? e.mangaId : `/${e.mangaId}`;
		return `/manga/${e.sourceId}${id}`;
	}

	function onCoverError(ev: Event) {
		const img = ev.currentTarget as HTMLImageElement;
		const original = img.dataset.original;
		if (!original || img.dataset.fallback === '1') {
			img.style.opacity = '0';
			return;
		}
		img.dataset.fallback = '1';
		img.src = `/api/proxy?url=${encodeURIComponent(original)}&source=${img.dataset.source || ''}`;
	}

	type ChapterRow = { id: string; title: string; number?: number; lang?: string };

	async function fetchAllChapters(source: string, mangaId: string): Promise<ChapterRow[]> {
		const out: ChapterRow[] = [];
		let offset = 0;
		const limit = 50;
		let total = Infinity;
		const id = mangaId.startsWith('/') ? mangaId.slice(1) : mangaId;

		while (offset < total) {
			const params = new URLSearchParams({
				source,
				id,
				offset: String(offset),
				limit: String(limit),
				sort: 'oldest'
			});
			const res = await fetch(`/api/chapters?${params}`);
			if (!res.ok) throw new Error(`Failed to load chapters (${res.status})`);
			const j = (await res.json()) as {
				chapters?: any[];
				total?: number;
				hasMore?: boolean;
			};
			if (typeof j.total === 'number') total = j.total;
			const batchList = Array.isArray(j.chapters) ? j.chapters : [];
			for (const c of batchList) {
				if (c?.id == null) continue;
				out.push({
					id: String(c.id),
					title: String(c.title || `Chapter ${c.number ?? ''}`),
					number: c.number,
					lang: c.lang ? String(c.lang) : undefined
				});
			}
			if (!j.hasMore || batchList.length === 0) break;
			offset += batchList.length;
		}
		return out;
	}

	function cancelBatch() {
		batch = { ...batch, cancelled: true };
	}

	function openBatchWarn(e: LibraryEntry) {
		if (batch.active || busy) return;
		warnTarget = e;
		warnOpen = true;
	}

	function closeBatchWarn() {
		warnOpen = false;
		warnTarget = null;
	}

	async function confirmBatchDownload() {
		const e = warnTarget;
		if (!e || batch.active || busy) return;
		warnOpen = false;
		warnTarget = null;

		const offline = getOfflineChapterIds(e.sourceId, e.mangaId);

		batch = {
			active: true,
			title: e.mangaTitle,
			current: 0,
			total: 0,
			chapterLabel: 'Loading chapter list…',
			phase: 'fetch',
			errors: 0,
			cancelled: false
		};

		try {
			const chapters = await fetchAllChapters(e.sourceId, e.mangaId);
			try {
				let latest = '';
				let maxN = -1;
				let lang = e.lang || defaultLangForSource(e.sourceId, e.isNovel);
				for (const c of chapters) {
					const m = String(c.title || c.number || '').match(/(\d+(?:\.\d+)?)/);
					const n = m ? parseFloat(m[1]) : Number(c.number) || -1;
					if (n >= maxN) {
						maxN = n;
						latest = m ? m[1] : String(c.number ?? c.title ?? '');
					}
					if (c.lang) lang = String(c.lang);
				}
				if (latest || lang) {
					const { upsertLibraryEntry } = await import('$lib/stores/library.svelte');
					await upsertLibraryEntry({
						mangaId: e.mangaId,
						mangaTitle: e.mangaTitle,
						cover: e.cover || '',
						sourceId: e.sourceId,
						isNovel: e.isNovel,
						latestChapter: latest || undefined,
						lang: lang || undefined
					});
				}
			} catch (err) {
				console.warn('[library] latestChapter update', err);
			}
			const pending = chapters.filter((c) => {
				const n = c.id;
				const alt = n.startsWith('/') ? n.slice(1) : `/${n}`;
				return !offline.has(n) && !offline.has(alt);
			});

			if (pending.length === 0) {
				msg = `All ${chapters.length} chapter(s) already offline for "${e.mangaTitle}".`;
				batch = { ...batch, active: false };
				await load();
				return;
			}

			batch = {
				...batch,
				total: pending.length,
				chapterLabel: `0 / ${pending.length}`,
				phase: 'download'
			};

			let errors = 0;
			for (let i = 0; i < pending.length; i++) {
				if (batch.cancelled) break;
				const ch = pending[i];
				batch = {
					...batch,
					current: i,
					chapterLabel: `${i + 1} / ${pending.length} — ${ch.title}`,
					phase: 'download'
				};

				try {
					if (e.isNovel) {
						await downloadNovelChapterPdf({
							source: e.sourceId,
							chapterId: ch.id,
							chapterTitle: ch.title,
							novelTitle: e.mangaTitle,
							mangaId: e.mangaId,
							cover: e.cover || '',
							onProgress: (p) => {
								batch = { ...batch, phase: p.phase || 'download' };
							}
						});
					} else {
						await downloadChapter({
							source: e.sourceId,
							chapterId: ch.id,
							chapterTitle: ch.title,
							mangaTitle: e.mangaTitle,
							mangaId: e.mangaId,
							cover: e.cover || '',
							onProgress: (p) => {
								batch = { ...batch, phase: p.phase || 'download' };
							}
						});
					}
				} catch (err) {
					console.error('[batch download]', ch.id, err);
					errors++;
					batch = { ...batch, errors };
				}
			}

			const done = batch.cancelled
				? `Batch cancelled for "${e.mangaTitle}" (${batch.current}/${pending.length}).`
				: `Batch done for "${e.mangaTitle}": ${pending.length - errors} ok, ${errors} failed, ${chapters.length - pending.length} skipped.`;
			msg = done;
			await load();
		} catch (err: any) {
			msg = err?.message || 'Batch download failed';
		} finally {
			batch = {
				active: false,
				title: '',
				current: 0,
				total: 0,
				chapterLabel: '',
				phase: '',
				errors: 0,
				cancelled: false
			};
		}
	}

	onMount(() => {
		void load();
		const onLib = () => {
			void load();
		};
		window.addEventListener('library-changed', onLib);
		const t = setTimeout(() => void load(), 300);
		return () => {
			window.removeEventListener('library-changed', onLib);
			clearTimeout(t);
		};
	});
</script>

<svelte:head>
	<title>Library | Rokuyomu</title>
	<style>
		.badge-stick {
			display: inline-flex;
			align-items: center;
			padding: 0.12rem 0.35rem;
			font-size: 0.55rem;
			font-weight: 700;
			letter-spacing: 0.02em;
			text-transform: uppercase;
			line-height: 1.1;
			border: 1px solid transparent;
			box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
		}
		.badge-stick-tl {
			border-radius: 0 0 0.3rem 0;
		}
		.badge-stick-bl {
			border-radius: 0 0.3rem 0 0;
		}
		.badge-stick-br {
			border-radius: 0.3rem 0 0 0;
		}
		.badge-type-manga {
			background: rgba(201, 23, 20, 0.78);
			border-color: rgba(248, 113, 113, 0.35);
			color: #fef2f2;
		}
		.badge-type-novel {
			background: rgba(234, 179, 8, 0.82);
			border-color: rgba(250, 204, 21, 0.4);
			color: #1c1917;
		}
		.badge-source {
			background: rgba(147, 51, 234, 0.78);
			border-color: rgba(192, 132, 252, 0.35);
			color: #faf5ff;
			max-width: 55%;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.badge-offline {
			background: rgba(0, 0, 0, 0.82);
			border-color: rgba(63, 63, 70, 0.5);
			color: #fafafa;
		}
		.badge-stick-ch {
			border-radius: 0 0.3rem 0.3rem 0;
			margin-top: 1px;
		}
		.badge-chapter {
			background: rgba(234, 179, 8, 0.82);
			border-color: rgba(250, 204, 21, 0.4);
			color: #1c1917;
			font-weight: 800;
		}
	</style>
</svelte:head>

<div class="mx-auto max-w-6xl p-4 md:p-6">
	<div
		class="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800"
	>
		<div>
			<h1 class="flex items-center gap-2 text-xl font-bold text-zinc-900 md:text-2xl dark:text-zinc-100">
				<Library class="h-6 w-6 text-violet-500" />
				Offline Library
			</h1>
			<p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
				{items.length} title(s) · offline mirror of bookmarks · files on your disk
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
			{#if diskOk}
				<button
					type="button"
					onclick={handlePickFolder}
					disabled={busy || batch.active}
					class="flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-transparent dark:text-zinc-300 dark:hover:bg-zinc-800"
					title="Choose / change library folder on disk"
				>
					<FolderOpen class="h-4 w-4" />
					Folder
				</button>
			{/if}
			<button
				type="button"
				onclick={handleSyncUpdates}
				disabled={busy || batch.active || !items.length}
				class="flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-sm text-sky-700 transition hover:bg-sky-500/20 disabled:opacity-50 dark:border-sky-600/50 dark:bg-sky-600/15 dark:text-sky-200 dark:hover:bg-sky-600/30"
				title="Check all titles for newer chapters and sort by latest update"
			>
				<RefreshCw class="h-4 w-4 {busy && batch.phase === 'sync' ? 'animate-spin' : ''}" />
				Sync Updates
			</button>
			<button
				type="button"
				onclick={handleSync}
				disabled={busy || batch.active}
				class="flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-sm text-violet-700 transition hover:bg-violet-500/20 disabled:opacity-50 dark:border-violet-600/50 dark:bg-violet-600/15 dark:text-violet-200 dark:hover:bg-violet-600/30"
				title="Import bookmark titles into library (metadata only)"
			>
				<RefreshCw class="h-4 w-4 {busy && !batch.active ? 'animate-spin' : ''}" />
				Sync Bookmarks
			</button>
			{#if items.length}
				<button
					type="button"
					onclick={handleClear}
					disabled={batch.active}
					class="flex items-center gap-1.5 rounded-lg border border-red-400/40 bg-red-50 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-100 disabled:opacity-50 dark:border-red-500/30 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-500/10"
				>
					<Trash2 class="h-4 w-4" />
					Clear
				</button>
			{/if}
		</div>
	</div>

	{#if batch.active}
		<div
			class="mb-4 rounded-xl border border-violet-300/50 bg-violet-50 p-3 dark:border-violet-600/40 dark:bg-violet-950/40"
		>
			<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
				<div class="min-w-0">
					<p class="truncate text-sm font-semibold text-violet-900 dark:text-violet-100">
						Batch download · {batch.title}
					</p>
					<p class="mt-0.5 truncate text-xs text-violet-700/80 dark:text-violet-300/80">
						{batch.chapterLabel}
						{#if batch.phase}
							<span class="opacity-70"> · {batch.phase}</span>
						{/if}
						{#if batch.errors}
							<span class="text-red-600 dark:text-red-400"> · {batch.errors} error(s)</span>
						{/if}
					</p>
				</div>
				<button
					type="button"
					onclick={cancelBatch}
					class="shrink-0 rounded-lg border border-violet-400/40 px-2.5 py-1 text-xs font-medium text-violet-800 hover:bg-violet-200/50 dark:text-violet-200 dark:hover:bg-violet-900/50"
				>
					Cancel
				</button>
			</div>
			<div class="h-2 overflow-hidden rounded-full bg-violet-200/80 dark:bg-violet-900/80">
				<div
					class="h-full rounded-full bg-violet-500 transition-all duration-300 dark:bg-violet-400"
					style="width: {batch.total ? Math.min(100, Math.round(((batch.current + 0.25) / batch.total) * 100)) : 5}%"
				></div>
			</div>
			<p class="mt-1.5 text-[10px] text-violet-600 dark:text-violet-400">
				Keep this tab open. Already offline chapters are skipped.
			</p>
		</div>
	{/if}

	{#if msg}
		<p
			class="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300"
		>
			{msg}
		</p>
	{/if}

	<div
		class="mb-6 flex items-start gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-400"
	>
		<HardDrive class="mt-0.5 h-4 w-4 shrink-0 text-violet-500 dark:text-violet-400" />
		<div>
			<p class="font-medium text-zinc-800 dark:text-zinc-300">How it works</p>
			<ul class="mt-1 list-inside list-disc space-y-0.5">
				<li>
					Chrome/Edge: pick a parent folder once — the app creates
					<code
						class="rounded bg-zinc-200/80 px-1 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300"
						>RokuyomuLibrary/Manga|Novel/Title/…</code
					>
					automatically.
				</li>
				<li>Manga chapters save as image folders; novels convert each chapter to PDF.</li>
				<li>
					<strong>Download</strong> batch-downloads remaining chapters;
					<strong>Sync</strong> (per card or Sync Updates) refreshes latest chapter and sorts by
					newest update.
				</li>
				<li>Firefox/Safari: metadata only; downloads fall back to ZIP / single file.</li>
			</ul>
		</div>
	</div>

	{#if items.length === 0}
		<div
			class="flex flex-col items-center justify-center py-16 text-center text-zinc-500 dark:text-zinc-500"
		>
			<BookOpen class="mb-3 h-12 w-12 opacity-40" />
			<p class="text-base font-medium text-zinc-700 dark:text-zinc-400">Library is empty.</p>
			<p class="mt-1 max-w-sm text-xs text-zinc-500 opacity-80">
				Click <strong>Sync Bookmarks</strong> or download a chapter from a title page — entries
				will show up here.
			</p>
		</div>
	{:else}
		<div class="grid grid-cols-3 gap-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
			{#each items as e (e.key)}
				<div
					class="group relative flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/10 dark:shadow-none dark:hover:border-zinc-700"
				>
					<a
						href={href(e)}
						class="relative aspect-[3/4] w-full overflow-hidden bg-zinc-100 dark:bg-zinc-800"
					>
						{#if coverSrc(e)}
							<img
								src={coverSrc(e)}
								data-original={e.cover}
								data-source={e.sourceId}
								alt={e.mangaTitle}
								class="h-full w-full object-cover transition duration-300 group-hover:scale-105"
								loading="lazy"
								onerror={onCoverError}
							/>
						{:else}
							<div class="flex h-full w-full items-center justify-center">
								<BookOpen class="h-8 w-8 text-zinc-300 dark:text-zinc-700" />
							</div>
						{/if}

						<span class="badge-stick badge-stick-tl badge-source absolute top-0 left-0 z-20">
							{e.sourceId}
						</span>

						{#if latestChapterLabel(e)}
							<span
								class="badge-stick badge-stick-ch badge-chapter absolute top-[14px] left-0 z-20 flex items-center gap-0.5 sm:top-[17px]"
							>
								{#if listChapterFlag(effectiveLang(e))}
									<span
										class="fi fi-{listChapterFlag(effectiveLang(e))} shrink-0 text-[8px] leading-none sm:text-[9px]"
										title={effectiveLang(e)}
									></span>
								{/if}
								<span>Ch. {latestChapterLabel(e)}</span>
							</span>
						{/if}

						<span
							class="badge-stick badge-stick-bl absolute bottom-0 left-0 z-20 {e.isNovel
								? 'badge-type-novel'
								: 'badge-type-manga'}"
						>
							{e.isNovel ? 'NOVEL' : 'MANGA'}
						</span>

						{#if e.chapters?.length}
							<span class="badge-stick badge-stick-br badge-offline absolute right-0 bottom-0 z-20">
								{e.chapters.length} ch offline
							</span>
						{/if}
					</a>
					<div class="flex flex-1 flex-col justify-between p-3">
						<a
							href={href(e)}
							class="line-clamp-2 text-xs font-semibold text-zinc-800 hover:text-violet-700 dark:text-zinc-100 dark:hover:text-violet-200"
						>
							{e.mangaTitle}
						</a>
						{#if e.localPath}
							<p
								class="mt-1 truncate text-[10px] text-zinc-400 dark:text-zinc-500"
								title={e.localPath}
							>
								{e.localPath}
							</p>
						{/if}
						<div class="mt-3 flex items-center justify-center gap-2">
							<button
								type="button"
								onclick={() => openBatchWarn(e)}
								disabled={batch.active || busy}
								class="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 transition hover:bg-emerald-500 hover:text-white disabled:opacity-50 dark:text-emerald-400"
								title="Download all remaining chapters"
								aria-label="Download all"
							>
								<Download class="h-4 w-4" />
							</button>
							<button
								type="button"
								onclick={() => handleSyncOne(e)}
								disabled={batch.active || busy}
								class="flex h-8 w-8 items-center justify-center rounded-lg border border-sky-500/40 bg-sky-500/10 text-sky-700 transition hover:bg-sky-500 hover:text-white disabled:opacity-50 dark:text-sky-400"
								title="Check for new chapters (this title only)"
								aria-label="Sync updates"
							>
								<RefreshCw class="h-4 w-4" />
							</button>
							<button
								type="button"
								onclick={() => handleRemove(e)}
								disabled={batch.active || busy}
								class="flex h-8 w-8 items-center justify-center rounded-lg border border-red-400/40 bg-red-50 text-red-600 transition hover:bg-red-500 hover:text-white disabled:opacity-50 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400"
								title="Remove from library"
								aria-label="Remove"
							>
								<Trash2 class="h-4 w-4" />
							</button>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Modern batch warning modal -->
	{#if warnOpen && warnTarget}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
			role="dialog"
			aria-modal="true"
			aria-labelledby="batch-warn-title"
		>
			<button
				type="button"
				class="absolute inset-0 bg-black/50 backdrop-blur-sm"
				aria-label="Close"
				onclick={closeBatchWarn}
			></button>
			<div
				class="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
			>
				<div class="border-b border-zinc-100 bg-gradient-to-r from-violet-500/10 to-emerald-500/10 px-5 py-4 dark:border-zinc-800">
					<div class="flex items-start gap-3">
						<div
							class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
						>
							<Download class="h-5 w-5" />
						</div>
						<div class="min-w-0">
							<h2 id="batch-warn-title" class="text-base font-bold text-zinc-900 dark:text-zinc-50">
								Batch download
							</h2>
							<p class="mt-0.5 line-clamp-2 text-sm text-zinc-500 dark:text-zinc-400">
								{warnTarget.mangaTitle}
							</p>
						</div>
					</div>
				</div>
				<div class="space-y-3 px-5 py-4 text-sm text-zinc-600 dark:text-zinc-300">
					<p>
						This will download <strong class="text-zinc-900 dark:text-zinc-100">all chapters</strong>
						for this title into your library folder. Chapters already offline will be skipped.
					</p>
					<ul class="space-y-2 rounded-xl border border-amber-200/80 bg-amber-50/80 p-3 text-xs text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/40 dark:text-amber-100">
						<li class="flex gap-2">
							<span class="mt-0.5 shrink-0">⚠</span>
							<span>Large titles can take a long time and use a lot of disk space.</span>
						</li>
						<li class="flex gap-2">
							<span class="mt-0.5 shrink-0">⚠</span>
							<span>Keep this tab open until the progress bar finishes.</span>
						</li>
						<li class="flex gap-2">
							<span class="mt-0.5 shrink-0">ℹ</span>
							<span>Chrome / Edge recommended for saving folders on disk.</span>
						</li>
					</ul>
				</div>
				<div class="flex gap-2 border-t border-zinc-100 px-5 py-4 dark:border-zinc-800">
					<button
						type="button"
						onclick={closeBatchWarn}
						class="flex-1 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
					>
						Cancel
					</button>
					<button
						type="button"
						onclick={() => confirmBatchDownload()}
						class="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500"
					>
						<Download class="h-4 w-4" />
						Start download
					</button>
				</div>
			</div>
		</div>
	{/if}

</div>
