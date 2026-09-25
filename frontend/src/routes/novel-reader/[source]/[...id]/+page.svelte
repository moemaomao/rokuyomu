<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { saveReading } from '$lib/stores/history';
    import { browser } from '$app/environment';
    import { goto } from '$app/navigation';
    import {
        Settings,
        Play,
        Pause,
        Square,
        Type,
        Volume2,
        ChevronsUp,
        ChevronDown,
        Check
    } from 'lucide-svelte';

    interface Chapter {
        id?: string | number;
        title?: string;
    }

    interface Props {
        data?: {
            content?: string;
            title?: string;
            source?: string;
            chapterId?: string;
            novelInfo?: { title?: string; id?: string; cover?: string };
            chapters?: Chapter[];
            currentChapter?: Chapter;
            prevChapter?: Chapter | null;
            nextChapter?: Chapter | null;
        };
    }

    let { data = {} }: Props = $props();

    let {
        content = '',
        title = '',
        source = '',
        chapterId = '',
        novelInfo = null,
        chapters = [],
        currentChapter = null,
        prevChapter = null,
        nextChapter = null
    } = $derived(data ?? {});

    let fontFamily = $state('serif');
    let fontSize = $state(18);
    let lineHeight = $state(1.7);
    let maxWidth = $state(720);
    let isDark = $state(true);

    let autoScroll = $state(false);
    let scrollSpeed = $state(40);
    let ttsRate = $state(1);
    let ttsVoiceURI = $state('');

    let showSettings = $state(false);
    let showVoiceDropdown = $state(false);
    let isSpeaking = $state(false);
    let isPaused = $state(false);
    let settingsReady = $state(false);

    let scrollInterval: ReturnType<typeof setInterval> | null = null;
    let voices = $state<SpeechSynthesisVoice[]>([]);

    const FONTS: Record<string, string> = {
        serif: 'Georgia, "Times New Roman", serif',
        sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        mono: '"JetBrains Mono", "Fira Code", monospace',
        dyslexic: '"OpenDyslexic", "Comic Sans MS", sans-serif'
    };

    function loadSettings() {
        if (!browser) return;
        try {
            const s = JSON.parse(localStorage.getItem('novelReaderSettings') || '{}');
            if (s.fontFamily) fontFamily = s.fontFamily;
            if (s.fontSize) fontSize = s.fontSize;
            if (s.lineHeight) lineHeight = s.lineHeight;
            if (s.maxWidth) maxWidth = s.maxWidth;
            if (s.scrollSpeed) scrollSpeed = s.scrollSpeed;
            if (s.ttsRate) ttsRate = s.ttsRate;
            if (s.ttsVoiceURI) ttsVoiceURI = s.ttsVoiceURI;
        } catch {
            // Ignore parse errors
        }
    }

    function saveSettings() {
        if (!browser || !settingsReady) return;
        localStorage.setItem(
            'novelReaderSettings',
            JSON.stringify({
                fontFamily,
                fontSize,
                lineHeight,
                maxWidth,
                scrollSpeed,
                ttsRate,
                ttsVoiceURI
            })
        );
    }

    $effect(() => {
        fontFamily; fontSize; lineHeight; maxWidth; scrollSpeed; ttsRate; ttsVoiceURI;
        if (settingsReady) saveSettings();
    });

    function startAutoScroll() {
        stopAutoScroll();
        autoScroll = true;
        scrollInterval = setInterval(() => {
            window.scrollBy(0, scrollSpeed / 10);
            if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 20) {
                stopAutoScroll();
            }
        }, 100);
    }

    function stopAutoScroll() {
        autoScroll = false;
        if (scrollInterval) {
            clearInterval(scrollInterval);
            scrollInterval = null;
        }
    }

    function toggleAutoScroll() {
        if (autoScroll) stopAutoScroll();
        else startAutoScroll();
    }

    function getPlainText(): string {
        if (!browser) return '';
        const el = document.getElementById('novel-content');
        return el?.innerText || el?.textContent || '';
    }

    function loadVoices() {
        if (!browser || !('speechSynthesis' in window)) return;
        const fetchedVoices = window.speechSynthesis.getVoices();
        if (fetchedVoices.length > 0) {
            voices = fetchedVoices;
            if (!ttsVoiceURI && voices.length) {
                const id = voices.find((v) => v.lang.toLowerCase().includes('id'));
                const en = voices.find((v) => v.lang.toLowerCase().includes('en'));
                ttsVoiceURI = (id || en || voices[0]).voiceURI;
            }
        }
    }

    function speak() {
        if (!browser || !('speechSynthesis' in window)) return;

        if (voices.length === 0) {
            loadVoices();
        }

        const text = getPlainText();
        if (!text.trim()) return;

        const u = new SpeechSynthesisUtterance(text);
        u.rate = ttsRate;

        if (voices.length > 0) {
            const voice = voices.find((v) => v.voiceURI === ttsVoiceURI);
            if (voice) u.voice = voice;
        }

        u.onend = () => { isSpeaking = false; isPaused = false; };
        u.onerror = (e) => { 
            console.error('[TTS Error]', e);
            isSpeaking = false; 
            isPaused = false; 
        };

        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);

        if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
        }

        isSpeaking = true;
        isPaused = false;
    }

    function pauseTTS() {
        if (!browser || !('speechSynthesis' in window)) return;
        if (isPaused) {
            window.speechSynthesis.resume();
            isPaused = false;
        } else {
            window.speechSynthesis.pause();
            isPaused = true;
        }
    }

    function stopTTS() {
        if (!browser || !('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        isSpeaking = false;
        isPaused = false;
    }

    let selectedVoiceName = $derived(() => {
        const current = voices.find(v => v.voiceURI === ttsVoiceURI);
        return current ? `${current.name} (${current.lang})` : 'Pilih Suara / Voice...';
    });

    let groupedVoices = $derived(() => {
        const groups: Record<string, SpeechSynthesisVoice[]> = {};
        voices.forEach(v => {
            const langCode = v.lang.split('-')[0].toUpperCase();
            if (!groups[langCode]) groups[langCode] = [];
            groups[langCode].push(v);
        });
        return groups;
    });

    // --- NAVIGATION ---
    async function goChapter(ch: Chapter | null | undefined) {
        if (!ch?.id || !source) return;
        stopTTS();
        stopAutoScroll();
        const cleanId = String(ch.id).replace(/^\/+/, '');
        await goto(`/novel-reader/${source}/${cleanId}`, {
            replaceState: true,
            invalidateAll: true
        });
        window.scrollTo(0, 0);
    }

    function scrollToTop() {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // --- LIFECYCLE ---
    onMount(() => {
        loadSettings();
        settingsReady = true;

        try {
            const nid = (novelInfo as { id?: string; title?: string; cover?: string } | null)?.id
                || chapterId
                || '';
            const ntitle =
                (novelInfo as { title?: string } | null)?.title || title || 'Novel';
            const ncover = (novelInfo as { cover?: string } | null)?.cover || '';
            if (nid && source) {
                const mangaId = String(nid).startsWith('/') ? String(nid) : `/${String(nid).replace(/^\/+/, '')}`;
                const chId = chapterId
                    ? String(chapterId).startsWith('/')
                        ? String(chapterId)
                        : `/${String(chapterId).replace(/^\/+/, '')}`
                    : '';
                saveReading({
                    mangaId,
                    mangaSlug: '',
                    mangaTitle: ntitle,
                    cover: ncover,
                    chapterId: chId,
                    chapterTitle:
                        (currentChapter as { title?: string } | null)?.title || title || 'Chapter',
                    chapterNumber:
                        Number((currentChapter as { number?: number } | null)?.number) || 0,
                    sourceId: source
                });
            }
        } catch (e) {
            console.warn('[novel-reader] save history failed', e);
        }

        if (browser) {
            isDark = document.documentElement.classList.contains('dark');
            const observer = new MutationObserver(() => {
                isDark = document.documentElement.classList.contains('dark');
            });
            observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
            
            if ('speechSynthesis' in window) {
                loadVoices();
                window.speechSynthesis.onvoiceschanged = loadVoices;
                setTimeout(loadVoices, 500);
                setTimeout(loadVoices, 1000);
            }

            const onKey = (e: KeyboardEvent) => {
                if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
                if (e.key === 'ArrowLeft') goChapter(prevChapter);
                if (e.key === 'ArrowRight') goChapter(nextChapter);
            };
            window.addEventListener('keydown', onKey);

            return () => {
                observer.disconnect();
                window.removeEventListener('keydown', onKey);
            };
        }
    });

    onDestroy(() => {
        stopAutoScroll();
        stopTTS();
    });
</script>

<svelte:head>
    <title>{title || 'Novel Reader'} · Rokuyomu</title>
</svelte:head>

<div
    role="presentation"
    class="min-h-screen transition-colors duration-200 {isDark ? 'bg-zinc-950 text-zinc-100' : 'bg-slate-100 text-zinc-900'}"
>
    <!-- CONTENT & SECTION TITLE -->
    <article
        id="novel-content"
        class="mx-auto px-4 pt-20 pb-28 prose max-w-none {isDark ? 'prose-invert' : ''}"
        style:font-family={FONTS[fontFamily] || FONTS.serif}
        style:font-size="{fontSize}px"
        style:line-height={lineHeight}
        style:max-width="{maxWidth}px"
        style:color={isDark ? '#e5e5e5' : '#171717'}
    >
        <div class="mb-6 text-center opacity-75">
            <h1 class="text-xl font-semibold m-0">
                {#if novelInfo?.title}{novelInfo.title}{/if}
                {#if title}{' - '}{title}{/if}
            </h1>
        </div>

        {@html content || '<p>No content</p>'}
    </article>

    <div class="fixed right-0 bottom-0 left-0 z-[100] flex justify-center gap-[18px] px-5 py-3 bg-transparent border-0 pointer-events-none">
        <button
            type="button"
            class="pointer-events-auto touch-manipulation flex min-w-[90px] items-center justify-center gap-1 rounded-[15px] border px-[15px] py-[10px] text-[0.92em] transition disabled:cursor-not-allowed disabled:opacity-30 {isDark ? 'border-white/15 bg-purple-600/50 text-white/85 active:bg-purple-600/70' : 'border-zinc-300 bg-purple-600/85 text-white active:bg-purple-600'}"
            disabled={!prevChapter}
            aria-label="Previous chapter"
            onclick={() => goChapter(prevChapter)}
        >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M13 5l-7 7 7 7" />
                <path d="M19 5l-7 7 7 7" opacity="0.6" />
            </svg>
        </button>

        <button
            type="button"
            class="pointer-events-auto touch-manipulation flex min-w-[90px] items-center justify-center gap-1 rounded-[15px] border px-[15px] py-[10px] text-[0.92em] transition disabled:cursor-not-allowed disabled:opacity-30 {isDark ? 'border-white/15 bg-purple-600/50 text-white/85 active:bg-purple-600/70' : 'border-zinc-300 bg-purple-600/85 text-white active:bg-purple-600'}"
            disabled={!nextChapter}
            aria-label="Next chapter"
            onclick={() => goChapter(nextChapter)}
        >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M11 5l7 7-7 7" />
                <path d="M5 5l7 7-7 7" opacity="0.6" />
            </svg>
        </button>
    </div>

    <div class="fixed right-[15px] bottom-[85px] z-[500] flex flex-col items-center gap-2.5">
        <button
            type="button"
            class="touch-manipulation flex h-11 w-11 items-center justify-center rounded-full border-0 bg-[rgba(0,150,255,0.2)] text-[#4da6ff] active:scale-95 shadow-lg cursor-pointer"
            title="Scroll to top"
            onclick={scrollToTop}
        >
            <ChevronsUp class="h-5 w-5" />
        </button>

        <button
            type="button"
            class="touch-manipulation flex h-11 w-11 items-center justify-center rounded-full border-0 bg-[rgba(0,200,120,0.2)] text-[#35d98a] active:scale-95 shadow-lg cursor-pointer"
            title="Text to Speech"
            onclick={() => (isSpeaking ? stopTTS() : speak())}
        >
            {#if isSpeaking}
                <Square class="h-5 w-5" />
            {:else}
                <Volume2 class="h-5 w-5" />
            {/if}
        </button>

        {#if isSpeaking}
            <button
                type="button"
                class="touch-manipulation flex h-11 w-11 items-center justify-center rounded-full border-0 bg-[rgba(255,180,0,0.2)] text-amber-400 active:scale-95 shadow-lg cursor-pointer"
                title={isPaused ? 'Resume' : 'Pause'}
                onclick={pauseTTS}
            >
                {#if isPaused}
                    <Play class="h-5 w-5" />
                {:else}
                    <Pause class="h-5 w-5" />
                {/if}
            </button>
        {/if}

        <button
            type="button"
            class="touch-manipulation flex h-11 w-11 items-center justify-center rounded-full border-0 active:scale-95 shadow-lg cursor-pointer {autoScroll ? 'bg-purple-600/40 text-purple-300' : 'bg-[rgba(120,80,255,0.2)] text-purple-400'}"
            title="Auto scroll"
            onclick={toggleAutoScroll}
        >
            {#if autoScroll}
                <Pause class="h-5 w-5" />
            {:else}
                <Play class="h-5 w-5" />
            {/if}
        </button>

        <button
            type="button"
            class="touch-manipulation flex h-11 w-11 items-center justify-center rounded-full border-0 bg-zinc-800/40 text-purple-400 active:scale-95 shadow-lg cursor-pointer"
            title="Settings"
            onclick={() => (showSettings = !showSettings)}
        >
            <Settings class="h-6 w-6" strokeWidth={2} />
        </button>
    </div>

    <!-- SETTINGS MODAL -->
    {#if showSettings}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="fixed inset-0 z-[600] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs"
            onclick={() => (showSettings = false)}
        >
            <div
                class="w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 shadow-xl max-h-[80vh] overflow-y-auto {isDark ? 'bg-zinc-900 text-zinc-100' : 'bg-white text-zinc-900'}"
                onclick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                tabindex="-1"
            >
                <h3 class="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Type size={20} /> Reader Settings
                </h3>

                <label class="block text-sm mb-1 opacity-70" for="font-family">Font</label>
                <div class="grid grid-cols-2 gap-2 mb-4">
                    {#each Object.keys(FONTS) as f (f)}
                        <button
                            type="button"
                            class="touch-manipulation py-2 px-3 rounded-lg border text-sm capitalize transition {fontFamily === f ? 'border-purple-500 bg-purple-500/20 text-purple-400 font-medium' : isDark ? 'border-white/15 active:bg-white/5' : 'border-zinc-300 active:bg-zinc-50'}"
                            style:font-family={FONTS[f]}
                            onclick={() => (fontFamily = f)}
                        >
                            {f}
                        </button>
                    {/each}
                </div>

                <label class="block text-sm mb-1 opacity-70" for="font-size">Font size: {fontSize}px</label>
                <input id="font-size" type="range" min="14" max="32" bind:value={fontSize} class="w-full mb-4 accent-purple-600" />

                <label class="block text-sm mb-1 opacity-70" for="line-height">
                    Line height: {lineHeight.toFixed(1)}
                </label>
                <input
                    id="line-height"
                    type="range"
                    min="1.2"
                    max="2.4"
                    step="0.1"
                    bind:value={lineHeight}
                    class="w-full mb-4 accent-purple-600"
                />

                <label class="block text-sm mb-1 opacity-70" for="max-width">Max width: {maxWidth}px</label>
                <input
                    id="max-width"
                    type="range"
                    min="480"
                    max="960"
                    step="20"
                    bind:value={maxWidth}
                    class="w-full mb-4 accent-purple-600"
                />

                <label class="block text-sm mb-1 opacity-70" for="scroll-speed">
                    Auto-scroll: {scrollSpeed} px/s
                </label>
                <input
                    id="scroll-speed"
                    type="range"
                    min="10"
                    max="120"
                    bind:value={scrollSpeed}
                    class="w-full mb-4 accent-purple-600"
                />

                <label class="block text-sm mb-1 opacity-70" for="tts-rate">
                    TTS speed: {ttsRate.toFixed(1)}x
                </label>
                <input
                    id="tts-rate"
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    bind:value={ttsRate}
                    class="w-full mb-4 accent-purple-600"
                />

                <div class="relative mb-4">
                    <span class="block text-sm mb-1 opacity-70">Voice pack</span>
                    <button
                        type="button"
                        class="w-full flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-sm transition outline-none {isDark ? 'bg-zinc-800/80 border-white/15 text-zinc-100 active:bg-zinc-800' : 'bg-white border-zinc-300 text-zinc-900 active:bg-zinc-50'}"
                        onclick={() => (showVoiceDropdown = !showVoiceDropdown)}
                    >
                        <span class="truncate">{selectedVoiceName()}</span>
                        <ChevronDown class="h-4 w-4 opacity-60 transition-transform duration-200 {showVoiceDropdown ? 'rotate-180' : ''}" />
                    </button>

                    {#if showVoiceDropdown}
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <div class="absolute left-0 right-0 mt-2 z-50 rounded-xl border shadow-2xl max-h-60 overflow-y-auto p-1.5 {isDark ? 'bg-zinc-900 border-white/15 text-zinc-100' : 'bg-white border-zinc-200 text-zinc-900'}">
                            {#if voices.length === 0}
                                <div class="p-3 text-center text-sm opacity-60">Memuat suara...</div>
                            {:else}
                                {#each Object.entries(groupedVoices()) as [lang, langVoices]}
                                    <div class="px-3 py-1.5 text-xs font-bold uppercase tracking-wider opacity-50 bg-purple-500/10 rounded-md my-1">
                                        🌍 Language: {lang}
                                    </div>
                                    {#each langVoices as v (v.voiceURI)}
                                        <button
                                            type="button"
                                            class="w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg text-left transition {ttsVoiceURI === v.voiceURI ? 'bg-purple-600 text-white font-medium' : isDark ? 'hover:bg-white/5' : 'hover:bg-zinc-100'}"
                                            onclick={() => {
                                                ttsVoiceURI = v.voiceURI;
                                                showVoiceDropdown = false;
                                            }}
                                        >
                                            <span class="truncate">{v.name}</span>
                                            {#if ttsVoiceURI === v.voiceURI}
                                                <Check class="h-4 w-4 shrink-0 ml-2" />
                                            {/if}
                                        </button>
                                    {/each}
                                {/each}
                            {/if}
                        </div>
                    {/if}
                </div>

                <button
                    type="button"
                    class="touch-manipulation w-full py-2.5 rounded-xl bg-purple-600 text-white font-medium active:bg-purple-500 transition shadow-lg shadow-purple-600/20"
                    onclick={() => (showSettings = false)}
                >
                    Done
                </button>
            </div>
        </div>
    {/if}
</div>

<style>
    :global(#novel-content p) {
        margin-bottom: 1em;
    }
    :global(#novel-content img) {
        max-width: 100%;
        height: auto;
        border-radius: 0.5rem;
    }
    :global(.touch-manipulation) {
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
    }
</style>