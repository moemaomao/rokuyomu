<script lang="ts">
    import { onMount } from 'svelte';
    import {
        getNotifications,
        removeNotification,
        markAsRead,
        markAllAsRead,
        checkForNewChapters,
        isCheckingNotifications,
        type NotificationEntry
    } from '$lib/stores/notification.svelte';
    import { Bell, BellOff, BookOpen, RefreshCw, CheckCheck } from 'lucide-svelte';

    let items = $state<NotificationEntry[]>([]);
    let checking = $state(false);

    function load() {
        items = getNotifications();
        checking = isCheckingNotifications();
    }

    function formatMangaHref(sourceId: string, mangaId: string): string {
        const clean = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
        return `/manga/${sourceId}${clean}`;
    }

    function proxyCover(url: string, sourceId: string): string {
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

    async function handleRemove(mangaId: string, sourceId: string) {
        await removeNotification(mangaId, sourceId);
        load();
    }

    async function handleMarkRead(mangaId: string, sourceId: string) {
        await markAsRead(mangaId, sourceId);
        load();
    }

    async function handleMarkAll() {
        await markAllAsRead();
        load();
    }

    async function handleRefresh() {
        checking = true;
        await checkForNewChapters({ force: true });
        load();
        checking = false;
    }

    onMount(() => {
        load();
        window.addEventListener('notifications-changed', load);
        checkForNewChapters().then(() => load());
        return () => window.removeEventListener('notifications-changed', load);
    });

    // Mengurutkan items agar yang memiliki chapter baru (hasNew: true) berada di posisi paling atas
    let sortedItems = $derived(() => {
        return [...items].sort((a, b) => {
            if (a.hasNew && !b.hasNew) return -1; // a didahulukan
            if (!a.hasNew && b.hasNew) return 1;  // b didahulukan
            return 0;
        });
    });

    let unread = $derived(items.filter((i) => i.hasNew).length);
</script>

<svelte:head>
    <title>Notifications | Rokuyomu</title>
</svelte:head>

<div class="mx-auto max-w-6xl p-4 md:p-6">
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4">
        <div>
            <h1 class="text-xl font-bold md:text-2xl">Chapter Notifications</h1>
            <p class="mt-1 text-xs text-zinc-500">
                Manga you are tracking — a badge appears in the header when a new chapter is out.
            </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm text-zinc-400">
                {items.length} tracked{#if unread > 0}
                    · <span class="font-semibold text-orange-400">{unread} new</span>
                {/if}
            </span>
            <button
                type="button"
                onclick={handleRefresh}
                disabled={checking}
                class="flex items-center gap-1.5 rounded-lg border border-zinc-500 bg-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-600 hover:text-white disabled:opacity-50"
                title="Check for latest chapters"
            >
                <RefreshCw class="h-3.5 w-3.5 {checking ? 'animate-spin' : ''}" />
                Refresh
            </button>
            {#if unread > 0}
                <button
                    type="button"
                    onclick={handleMarkAll}
                    class="flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-300 transition hover:bg-violet-500/20"
                >
                    <CheckCheck class="h-3.5 w-3.5" />
                    Mark all as read
                </button>
            {/if}
        </div>
    </div>

    {#if items.length === 0}
        <div class="flex flex-col items-center justify-center py-16 text-center text-zinc-500">
            <Bell class="mb-3 h-12 w-12 opacity-40" />
            <p class="text-base font-medium">No manga is being tracked yet.</p>
            <p class="mt-1 max-w-sm text-xs opacity-75">
                Open a manga detail page and click the bell button (next to Bookmark) to enable new chapter
                notifications.
            </p>
        </div>
    {:else}
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {#each sortedItems() as n (n.sourceId + '::' + n.mangaId)}
                <div
                    class="group relative flex gap-3 overflow-hidden rounded-xl border p-3 transition
                        {n.hasNew
                        ? 'border-orange-500/50 bg-orange-500/5'
                        : 'border-zinc-800 bg-zinc-900/10 hover:border-zinc-700'}"
                >
                    <a
                        href={formatMangaHref(n.sourceId, n.mangaId)}
                        class="h-24 w-16 shrink-0 overflow-hidden rounded-lg bg-zinc-800"
                        onclick={() => {
                            if (n.hasNew) handleMarkRead(n.mangaId, n.sourceId);
                        }}
                    >
                        {#if n.cover}
                            <img
                                src={proxyCover(n.cover, n.sourceId)}
                                data-original={n.cover}
                                data-source={n.sourceId}
                                alt={n.mangaTitle}
                                class="h-full w-full object-cover"
                                loading="lazy"
                                onerror={onCoverError}
                            />
                        {:else}
                            <div class="flex h-full w-full items-center justify-center">
                                <BookOpen class="h-6 w-6 text-zinc-700" />
                            </div>
                        {/if}
                    </a>

                    <div class="min-w-0 flex-1">
                        <a
                            href={formatMangaHref(n.sourceId, n.mangaId)}
                            class="line-clamp-2 text-sm font-semibold hover:text-violet-300"
                            onclick={() => {
                                if (n.hasNew) handleMarkRead(n.mangaId, n.sourceId);
                            }}
                        >
                            {n.mangaTitle}
                        </a>
                        <p class="mt-0.5 text-[10px] capitalize text-zinc-500">{n.sourceId}</p>

                        {#if n.hasNew}
                            <p class="mt-2 line-clamp-2 text-xs font-medium text-orange-400">
                                New chapter: {n.newChapterTitle || `Ch. ${n.newChapterNumber}`}
                            </p>
                        {:else if n.lastChapterTitle}
                            <p class="mt-2 line-clamp-1 text-xs text-zinc-500">
                                Latest: {n.lastChapterTitle}
                            </p>
                        {:else}
                            <p class="mt-2 text-xs text-zinc-600">Waiting for chapter check…</p>
                        {/if}

                        <div class="mt-3 flex flex-wrap gap-1.5">
                            {#if n.hasNew}
                                <button
                                    type="button"
                                    onclick={() => handleMarkRead(n.mangaId, n.sourceId)}
                                    class="rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-[10px] font-medium text-violet-300 transition hover:bg-violet-500/20"
                                >
                                    Mark as read
                                </button>
                            {/if}
                            <button
                                type="button"
                                onclick={() => handleRemove(n.mangaId, n.sourceId)}
                                class="flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-400 transition hover:bg-red-500 hover:text-white"
                            >
                                <BellOff class="h-3 w-3" />
                                Turn off
                            </button>
                        </div>
                    </div>

                    {#if n.hasNew}
                        <span
                            class="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-orange-500 ring-2 ring-orange-500/30"
                        ></span>
                    {/if}
                </div>
            {/each}
        </div>
    {/if}
</div>