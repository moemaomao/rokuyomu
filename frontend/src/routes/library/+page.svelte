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
		type LibraryEntry
	} from '$lib/stores/library.svelte';
	import { Library, FolderOpen, RefreshCw, Trash2, HardDrive, BookOpen } from 'lucide-svelte';
	import { proxyImage } from '$lib/utils/image';

	let items = $state<LibraryEntry[]>([]);
	let busy = $state(false);
	let msg = $state('');
	let diskOk = $state(false);

	async function load() {
		diskOk = librarySupportsDisk();
		if (!isLibraryReady()) {
			items = await ensureLibraryLoaded();
		} else {
			items = getLibrary();
		}
	}

	async function handleSync() {
		busy = true;
		msg = '';
		try {
			const n = await syncLibraryFromBookmarks();
			load();
			msg = n > 0 ? `Synced ${n} title(s) from bookmarks.` : 'Already in sync with bookmarks.';
		} catch (e: any) {
			msg = e?.message || 'Sync failed';
		} finally {
			busy = false;
		}
	}

	async function handlePickFolder() {
		busy = true;
		msg = '';
		try {
			const ok = await chooseLibraryFolder();
			msg = ok
				? 'Library folder linked. Downloads will save there as folders.'
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
			load();
		}
	}

	async function handleClear() {
		if (!confirm('Clear all library metadata? (Files on disk are not deleted.)')) return;
		await clearLibrary();
		load();
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

	onMount(() => {
		void load();
		const onLib = () => {
			void load();
		};
		window.addEventListener('library-changed', onLib);
		// Retry shortly after mount in case IDB was still opening
		const t = setTimeout(() => void load(), 300);
		return () => {
			window.removeEventListener('library-changed', onLib);
			clearTimeout(t);
		};
	});
</script>

<svelte:head>
	<title>Library | Rokuyomu</title>
</svelte:head>

<div class="mx-auto max-w-6xl p-4 md:p-6">
	<div class="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4">
		<div>
			<h1 class="flex items-center gap-2 text-xl font-bold md:text-2xl">
				<Library class="h-6 w-6 text-violet-500" />
				Offline Library
			</h1>
			<p class="mt-1 text-sm text-zinc-400">
				{items.length} title(s) · offline mirror of bookmarks · files on your disk
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
			{#if diskOk}
				<button
					type="button"
					onclick={handlePickFolder}
					disabled={busy}
					class="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-50"
					title="Choose / change library folder on disk"
				>
					<FolderOpen class="h-4 w-4" />
					Folder
				</button>
			{/if}
			<button
				type="button"
				onclick={handleSync}
				disabled={busy}
				class="flex items-center gap-1.5 rounded-lg border border-violet-600/50 bg-violet-600/15 px-3 py-1.5 text-sm text-violet-200 transition hover:bg-violet-600/30 disabled:opacity-50"
			>
				<RefreshCw class="h-4 w-4 {busy ? 'animate-spin' : ''}" />
				Sync Bookmarks
			</button>
			{#if items.length}
				<button
					type="button"
					onclick={handleClear}
					class="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-sm text-red-400 transition hover:bg-red-500/10"
				>
					<Trash2 class="h-4 w-4" />
					Clear
				</button>
			{/if}
		</div>
	</div>

	{#if msg}
		<p class="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-300">
			{msg}
		</p>
	{/if}

	<div
		class="mb-6 flex items-start gap-2 rounded-xl border border-zinc-800 bg-zinc-900/30 p-3 text-xs text-zinc-400"
	>
		<HardDrive class="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
		<div>
			<p class="font-medium text-zinc-300">Cara kerja</p>
			<ul class="mt-1 list-inside list-disc space-y-0.5">
				<li>
					Chrome/Edge: pilih folder library sekali — chapter manga disimpan sebagai
					<code class="text-zinc-300">Judul/Chapter/001.jpg</code> (tanpa ZIP).
				</li>
				<li>Novel: tiap chapter di-convert ke PDF di folder judul.</li>
				<li>Sync Bookmarks hanya menyalin metadata; unduh chapter dari halaman detail manga.</li>
				<li>Firefox/Safari: metadata tetap ada; unduhan memakai ZIP / file tunggal.</li>
			</ul>
		</div>
	</div>

	{#if items.length === 0}
		<div class="flex flex-col items-center justify-center py-16 text-center text-zinc-500">
			<BookOpen class="mb-3 h-12 w-12 opacity-40" />
			<p class="text-base font-medium">Library masih kosong.</p>
			<p class="mt-1 max-w-sm text-xs opacity-75">
				Klik <strong>Sync Bookmarks</strong> atau unduh chapter dari halaman manga — entry akan
				muncul di sini.
			</p>
		</div>
	{:else}
		<div class="grid grid-cols-3 gap-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
			{#each items as e (e.key)}
				<div
					class="group relative flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/10 transition hover:border-zinc-700"
				>
					<a href={href(e)} class="relative aspect-[3/4] w-full overflow-hidden bg-zinc-800">
						{#if e.cover}
							<img
								src={proxyImage(e.cover, e.sourceId, 200)}
								data-original={e.cover}
								data-source={e.sourceId}
								alt={e.mangaTitle}
								class="h-full w-full object-cover transition duration-300 group-hover:scale-105"
								loading="lazy"
								onerror={onCoverError}
							/>
						{:else}
							<div class="flex h-full w-full items-center justify-center">
								<BookOpen class="h-8 w-8 text-zinc-700" />
							</div>
						{/if}
						<span
							class="absolute top-2 left-2 rounded-md bg-black/75 px-2 py-0.5 text-[10px] font-bold capitalize text-white backdrop-blur-md"
						>
							{e.sourceId}
						</span>
						{#if e.isNovel}
							<span
								class="absolute top-2 right-2 rounded-md bg-amber-600/90 px-1.5 py-0.5 text-[9px] font-bold text-white"
							>
								NOVEL
							</span>
						{/if}
						{#if e.chapters?.length}
							<span
								class="absolute bottom-2 right-2 rounded-md bg-violet-600/90 px-1.5 py-0.5 text-[9px] font-bold text-white"
							>
								{e.chapters.length} ch offline
							</span>
						{/if}
					</a>
					<div class="flex flex-1 flex-col justify-between p-3">
						<a href={href(e)} class="line-clamp-2 text-xs font-semibold hover:text-violet-100">
							{e.mangaTitle}
						</a>
						{#if e.localPath}
							<p class="mt-1 truncate text-[10px] text-zinc-500" title={e.localPath}>
								{e.localPath}
							</p>
						{/if}
						<button
							onclick={() => handleRemove(e)}
							class="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-500 hover:text-white"
						>
							<Trash2 class="h-3.5 w-3.5" /> Remove
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
