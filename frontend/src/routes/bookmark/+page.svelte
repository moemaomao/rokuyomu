<script lang="ts">
	import { onMount } from 'svelte';
	import { getBookmarks, removeBookmark, type BookmarkEntry } from '$lib/stores/bookmark.svelte';
	import { Trash2, BookOpen } from 'lucide-svelte';

	let bookmarks = $state<BookmarkEntry[]>([]);

	function loadBookmarks() {
		bookmarks = getBookmarks();
	}

	async function handleRemove(mangaId: string) {
		bookmarks = bookmarks.filter((b) => b.mangaId !== mangaId);
		try {
			await removeBookmark(mangaId);
		} finally {
			loadBookmarks();
		}
	}

	function formatMangaHref(sourceId: string, mangaId: string): string {
		const cleanMangaId = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		return `/manga/${sourceId}${cleanMangaId}`;
	}

	function proxyCover(url: string, sourceId: string, _w = 200, _h = 300): string {
	   if (!url) return '';
	   let u = String(url).trim();
	   if (u.startsWith('//')) u = 'https:' + u;
	   if (!/^https?:\/\//i.test(u)) return '';
	   return `/api/proxy?url=${encodeURIComponent(u)}&source=${sourceId}`;
    }

	function onCoverError(e: Event) {
		const img = e.currentTarget as HTMLImageElement;
		const original = img.dataset.original;
		if (!original || img.dataset.fallback === '1') {
			img.style.opacity = '0';
			return;
		}
		img.dataset.fallback = '1';
		let u = original.startsWith('//') ? 'https:' + original : original;
		img.src = `/api/proxy?url=${encodeURIComponent(u)}&source=${img.dataset.source || ''}`;
	}

	onMount(() => {
		loadBookmarks();
		window.addEventListener('bookmarks-changed', loadBookmarks);
		return () => window.removeEventListener('bookmarks-changed', loadBookmarks);
	});
</script>

<svelte:head>
    <title>Bookmarks | Mikoroku</title>
</svelte:head>

<div class="mx-auto max-w-6xl p-4 md:p-6">
    <div class="mb-6 flex items-center justify-between border-b border-zinc-800 pb-4">
        <h1 class="text-xl font-bold md:text-2xl">Bookmark List</h1>
        <span class="text-sm text-zinc-400">{bookmarks.length} saved manga</span>
    </div>

    {#if bookmarks.length === 0}
        <div class="flex flex-col items-center justify-center py-16 text-center text-zinc-500">
            <BookOpen class="mb-3 h-12 w-12 opacity-40" />
            <p class="text-base font-medium">No bookmarked manga yet.</p>
            <p class="mt-1 text-xs opacity-75">
                Explore manga and click the Bookmark button to save them here.
            </p>
        </div>
    {:else}
        <div class="grid grid-cols-3 gap-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {#each bookmarks as bm (bm.mangaId + bm.sourceId)}
                <div
                    class="group relative flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/10 transition hover:border-zinc-700"
                >
                    <a
                        href={formatMangaHref(bm.sourceId, bm.mangaId)}
                        class="relative aspect-[3/4] w-full overflow-hidden bg-zinc-800"
                    >
                        {#if bm.cover}
                            <img
                                src={proxyCover(bm.cover, bm.sourceId)}
                                data-original={bm.cover}
                                data-source={bm.sourceId}
                                alt={bm.mangaTitle}
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
                            {bm.sourceId}
                        </span>
                    </a>

                    <div class="flex flex-1 flex-col justify-between p-3">
                        <a
                            href={formatMangaHref(bm.sourceId, bm.mangaId)}
                            class="line-clamp-2 text-xs font-semibold hover:text-violet-100"
                        >
                            {bm.mangaTitle}
                        </a>

                        <button
                            onclick={() => handleRemove(bm.mangaId)}
                            class="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-500 hover:text-white"
                        >
                            <Trash2 class="h-3.5 w-3.5" /> Delete
                        </button>
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>