<script lang="ts">
    import {
        Info,
        AlertTriangle,
        AlertOctagon,
        ChevronDown,
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

    const COLLAPSE_KEY = 'rokuyomu_ann_collapsed';
    let expanded = $state(true);
    let containerRef = $state<HTMLDivElement | null>(null);

    $effect(() => {
        if (!browser || !message) return;
        try {
            const raw = sessionStorage.getItem(COLLAPSE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw) as {
                message?: string;
                updatedAt?: string;
                collapsed?: boolean;
            };
            if (
                parsed.message === message &&
                (parsed.updatedAt || '') === (updatedAt || '') &&
                parsed.collapsed
            ) {
                expanded = false;
            } else {
                expanded = true;
            }
        } catch {
            /* ignore */
        }
    });

    function persist(collapsed: boolean) {
        if (!browser) return;
        try {
            sessionStorage.setItem(
                COLLAPSE_KEY,
                JSON.stringify({ message, updatedAt: updatedAt || '', collapsed })
            );
        } catch {
            /* ignore */
        }
    }

    function collapse() {
        expanded = false;
        persist(true);
    }
    function expand() {
        expanded = true;
        persist(false);
    }

    onMount(() => {
        function handleClickOutside(event: MouseEvent) {
            if (expanded && containerRef && !containerRef.contains(event.target as Node)) {
                collapse();
            }
        }

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    });

    const styles = $derived.by(() => {
        switch (level) {
            case 'danger':
                return {
                    wrap: 'border-red-400 bg-red-100/95 text-red-950 dark:border-red-600/60 dark:bg-red-950/80 dark:text-red-50 backdrop-blur-md',
                    icon: 'text-red-600 dark:text-red-400',
                    chip: 'bg-red-600 text-white'
                };
            case 'warning':
                return {
                    wrap: 'border-amber-400 bg-amber-100/95 text-amber-950 dark:border-amber-600/60 dark:bg-amber-950/80 dark:text-amber-50 backdrop-blur-md',
                    icon: 'text-amber-600 dark:text-amber-400',
                    chip: 'bg-amber-500 text-white'
                };
            default:
                return {
                    wrap: 'border-sky-400 bg-sky-100/95 text-sky-950 dark:border-sky-600/60 dark:bg-sky-950/80 dark:text-sky-50 backdrop-blur-md',
                    icon: 'text-sky-600 dark:text-sky-400',
                    chip: 'bg-sky-600 text-white'
                };
        }
    });

    const preview = $derived(
        message.length > 72 ? message.slice(0, 72).trimEnd() + '…' : message
    );
</script>

{#if message}
    <div class="relative z-[45] w-full" bind:this={containerRef}>
        <div class="h-9 w-full border-b {styles.wrap}" class:opacity-0={expanded} class:pointer-events-none={expanded}>
            <button
                type="button"
                class="flex h-full w-full items-center gap-2 px-3 text-left transition hover:bg-black/5 dark:hover:bg-white/5 sm:px-4"
                aria-label="Show announcement"
                aria-expanded={!expanded}
                onclick={expand}
            >
                <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full {styles.chip}">
                    <Megaphone class="h-3 w-3" />
                </span>
                <span class="min-w-0 flex-1 truncate text-xs font-medium sm:text-sm">
                    Announcement: {preview}
                </span>
                <span class="inline-flex shrink-0 items-center gap-0.5 text-xs opacity-80">
                    <span class="hidden sm:inline">Show</span>
                    <ChevronDown class="h-4 w-4" />
                </span>
            </button>
        </div>

        {#if expanded}
            <div
                class="absolute inset-x-0 top-0 z-[46] border-b px-3 py-2.5 shadow-lg sm:px-4 {styles.wrap}"
                role="status"
                aria-live="polite"
            >
                <div class="relative mx-auto flex max-w-6xl items-start gap-2.5 sm:items-center">
                    <span class="mt-0.5 shrink-0 sm:mt-0 {styles.icon}">
                        {#if level === 'danger'}
                            <AlertOctagon class="h-4 w-4" />
                        {:else if level === 'warning'}
                            <AlertTriangle class="h-4 w-4" />
                        {:else}
                            <Info class="h-4 w-4" />
                        {/if}
                    </span>
                    <p class="min-w-0 flex-1 whitespace-pre-wrap text-sm font-medium leading-snug">{message}</p>
                    <button
                        type="button"
                        class="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-red-600 transition hover:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
                        aria-label="Hide announcement"
                        aria-expanded="true"
                        onclick={collapse}
                    >
                        <X class="h-4 w-4" />
                    </button>
                </div>
            </div>
        {/if}
    </div>
{/if}