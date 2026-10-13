<script lang="ts">
    import {
        Info,
        AlertTriangle,
        AlertOctagon,
        X,
        Megaphone
    } from 'lucide-svelte';
    import { browser } from '$app/environment';
    import { onMount } from 'svelte';

    type Level = 'info' | 'warning' | 'danger';

    let {
        message = '',
        level = 'info' as Level,
        updatedAt = '' as string | undefined
    }: {
        message?: string;
        level?: Level;
        updatedAt?: string;
    } = $props();

    const SEEN_KEY = 'rokuyomu_ann_seen';
    let open = $state(false);
    let unreadCount = $state(0);

    $effect(() => {
        if (!browser || !message) {
            unreadCount = 0;
            return;
        }
        try {
            const raw = localStorage.getItem(SEEN_KEY);
            if (!raw) {
                unreadCount = 1;
                return;
            }
            const parsed = JSON.parse(raw) as {
                message?: string;
                updatedAt?: string;
            };
            const isNew =
                parsed.message !== message ||
                (parsed.updatedAt || '') !== (updatedAt || '');
            unreadCount = isNew ? 1 : 0;
        } catch {
            unreadCount = 1;
        }
    });

    function markSeen() {
        if (!browser) return;
        try {
            localStorage.setItem(
                SEEN_KEY,
                JSON.stringify({ message, updatedAt: updatedAt || '' })
            );
            unreadCount = 0;
        } catch {
            /* ignore */
        }
    }

    function openModal() {
        open = true;
        markSeen();
    }

    function closeModal() {
        open = false;
    }

    onMount(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape' && open) closeModal();
        }
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    });

    const styles = $derived.by(() => {
        switch (level) {
            case 'danger':
                return {
                    iconBg: 'bg-red-500/15 text-red-600 dark:text-red-400',
                    border: 'border-red-500/30'
                };
            case 'warning':
                return {
                    iconBg: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                    border: 'border-amber-500/30'
                };
            default:
                return {
                    iconBg: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
                    border: 'border-sky-500/30'
                };
        }
    });
</script>

{#if message}
    <button
        type="button"
        class="fixed bottom-5 right-5 z-[60] flex h-12 w-12 items-center justify-center rounded-full
            bg-violet-600 text-white shadow-lg
            transition hover:scale-105 hover:brightness-110
            focus:outline-none focus:ring-2 focus:ring-offset-2
            dark:focus:ring-offset-zinc-900"
        style="box-shadow: 0 10px 25px -5px color-mix(in srgb, var(--accent, #7c3aed) 40%, transparent);
            --tw-ring-color: var(--accent, #7c3aed);"
        aria-label="Announcement{unreadCount > 0 ? ` (${unreadCount} unread)` : ''}"
        onclick={openModal}
    >
        <Megaphone class="h-5 w-5" />
        {#if unreadCount > 0}
            <span
                class="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center
                    rounded-full bg-red-500 px-1 text-[11px] font-bold leading-none text-white
                    ring-2 ring-white dark:ring-zinc-900"
            >
                {unreadCount > 99 ? '99+' : unreadCount}
            </span>
        {/if}
    </button>

    {#if open}
        <button
            type="button"
            class="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm"
            aria-label="Close announcement"
            onclick={closeModal}
        ></button>

        <div
            class="fixed left-1/2 top-1/2 z-[80] w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2
                rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl
                dark:border-zinc-700 dark:bg-zinc-900"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ann-title"
        >
            <div class="mb-4 flex items-start gap-3">
                <span
                    class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl {styles.iconBg}"
                >
                    {#if level === 'danger'}
                        <AlertOctagon class="h-5 w-5" />
                    {:else if level === 'warning'}
                        <AlertTriangle class="h-5 w-5" />
                    {:else}
                        <Info class="h-5 w-5" />
                    {/if}
                </span>
                <div class="min-w-0 flex-1">
                    <h2 id="ann-title" class="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                        Announcement
                    </h2>
                    <p class="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        From Rokuyomu
                    </p>
                </div>
                <button
                    type="button"
                    class="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700
                        dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    aria-label="Close"
                    onclick={closeModal}
                >
                    <X class="h-4 w-4" />
                </button>
            </div>

            <div
                class="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-xl border {styles.border}
                    bg-zinc-50 px-4 py-3 text-sm leading-relaxed text-zinc-800
                    dark:bg-zinc-800/60 dark:text-zinc-200"
            >
                {message}
            </div>

            <div class="mt-4 flex justify-end">
                <button
                    type="button"
                    class="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white
                        transition hover:brightness-110"
                    onclick={closeModal}
                >
                    Got it
                </button>
            </div>
        </div>
    {/if}
{/if}
