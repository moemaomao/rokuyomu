<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import {
		Settings,
		Play,
		Pause,
		Square,
		Type,
		Volume2,
		ChevronsUp
	} from 'lucide-svelte';

	const { data } = $props();
	let {
		content,
		title,
		source,
		chapterId,
		novelInfo,
		chapters,
		currentChapter,
		prevChapter,
		nextChapter
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

	let showControls = $state(true);
	let showSettings = $state(false);
	let isSpeaking = $state(false);
	let isPaused = $state(false);
	let settingsReady = $state(false);
	let scrollInterval: ReturnType<typeof setInterval> | null = null;
	let voices = $state<SpeechSynthesisVoice[]>([]);

	// Kunci: jangan hide controls seketika setelah user interaksi
	let controlsLockedUntil = 0;

	const FONTS: Record<string, string> = {
		serif: 'Georgia, "Times New Roman", serif',
		sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
		mono: '"JetBrains Mono", "Fira Code", monospace',
		dyslexic: '"OpenDyslexic", "Comic Sans MS", sans-serif'
	};

	function lockControls(ms = 800) {
		controlsLockedUntil = Date.now() + ms;
		showControls = true;
	}

	function loadSettings() {
		if (!browser) return;
		try {
			const s = JSON.parse(localStorage.getItem('novelReaderSettings') || '{}');
			if (s.fontFamily) fontFamily = s.fontFamily;
			if (s.fontSize) fontSize = s.fontSize;
			if (s.lineHeight) lineHeight = s.lineHeight;
			if (s.maxWidth) maxWidth = s.maxWidth;
			if (typeof s.isDark === 'boolean') isDark = s.isDark;
			if (s.scrollSpeed) scrollSpeed = s.scrollSpeed;
			if (s.ttsRate) ttsRate = s.ttsRate;
			if (s.ttsVoiceURI) ttsVoiceURI = s.ttsVoiceURI;
		} catch {
			/* ignore */
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
				isDark,
				scrollSpeed,
				ttsRate,
				ttsVoiceURI
			})
		);
	}

	$effect(() => {
		fontFamily;
		fontSize;
		lineHeight;
		maxWidth;
		isDark;
		scrollSpeed;
		ttsRate;
		ttsVoiceURI;
		if (!settingsReady) return;
		saveSettings();
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
		lockControls();
		if (autoScroll) stopAutoScroll();
		else startAutoScroll();
	}

	function getPlainText(): string {
		if (!browser) return '';
		const el = document.getElementById('novel-content');
		return el?.innerText || el?.textContent || '';
	}

	function loadVoices() {
		if (!browser || !window.speechSynthesis) return;
		voices = window.speechSynthesis.getVoices();
		if (!ttsVoiceURI && voices.length) {
			const id = voices.find((v) => v.lang.startsWith('id'));
			const en = voices.find((v) => v.lang.startsWith('en'));
			ttsVoiceURI = (id || en || voices[0]).voiceURI;
		}
	}

	function speak() {
		if (!browser || !window.speechSynthesis) return;
		lockControls();
		window.speechSynthesis.cancel();
		const text = getPlainText();
		if (!text.trim()) return;
		const u = new SpeechSynthesisUtterance(text);
		u.rate = ttsRate;
		const voice = voices.find((v) => v.voiceURI === ttsVoiceURI);
		if (voice) u.voice = voice;
		u.onend = () => {
			isSpeaking = false;
			isPaused = false;
		};
		u.onerror = () => {
			isSpeaking = false;
			isPaused = false;
		};
		window.speechSynthesis.speak(u);
		isSpeaking = true;
		isPaused = false;
	}

	function pauseTTS() {
		if (!browser || !window.speechSynthesis) return;
		lockControls();
		if (isPaused) {
			window.speechSynthesis.resume();
			isPaused = false;
		} else {
			window.speechSynthesis.pause();
			isPaused = true;
		}
	}

	function stopTTS() {
		if (!browser || !window.speechSynthesis) return;
		lockControls();
		window.speechSynthesis.cancel();
		isSpeaking = false;
		isPaused = false;
	}

	async function goChapter(ch: { id?: string } | null | undefined) {
		if (!ch?.id || !source) return;
		lockControls();
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
		lockControls();
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	function toggleTap(e: MouseEvent | TouchEvent) {
		const t = e.target as HTMLElement;
		// Jangan toggle kalau klik di kontrol / dialog
		if (t.closest('button, a, input, select, label, [role="dialog"], [data-controls]')) return;
		showControls = !showControls;
		if (showControls) lockControls(1200);
	}

	onMount(() => {
		loadSettings();
		settingsReady = true;

		loadVoices();
		if (browser && window.speechSynthesis) {
			window.speechSynthesis.onvoiceschanged = loadVoices;
		}

		const onKey = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
				return;
			if (e.key === 'ArrowLeft') goChapter(prevChapter);
			if (e.key === 'ArrowRight') goChapter(nextChapter);
		};
		window.addEventListener('keydown', onKey);

		let lastY = window.scrollY;
		let ticking = false;

		const onScroll = () => {
			if (ticking) return;
			ticking = true;
			requestAnimationFrame(() => {
				const y = window.scrollY;
				// Jangan hide kalau baru saja user interaksi
				if (Date.now() < controlsLockedUntil) {
					lastY = y;
					ticking = false;
					return;
				}
				// Threshold lebih besar biar tidak sensitif di mobile
				if (y > lastY + 40 && y > 100) {
					showControls = false;
				} else if (y < lastY - 20) {
					showControls = true;
				}
				lastY = y;
				ticking = false;
			});
		};
		window.addEventListener('scroll', onScroll, { passive: true });

		return () => {
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('scroll', onScroll);
		};
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
	class="min-h-screen transition-colors duration-200 {isDark
		? 'bg-zinc-950 text-zinc-100'
		: 'bg-amber-50 text-zinc-900'}"
	onclick={toggleTap}
>
	<!-- HEADER -->
	<header
		data-controls
		class="fixed top-0 inset-x-0 z-[100] px-4 py-3 text-center backdrop-blur-md transition-transform duration-300 pointer-events-auto {showControls
			? 'translate-y-0'
			: '-translate-y-full'} {isDark
			? 'bg-zinc-900/85 border-b border-white/5'
			: 'bg-white/85 border-b border-zinc-200'}"
	>
		<p class="m-0 text-[1.02em] font-medium opacity-85 truncate">
			{#if novelInfo?.title}{novelInfo.title}{/if}
			{#if title}
				{' '}{title}
			{/if}
		</p>
	</header>

	<article
		id="novel-content"
		class="mx-auto px-4 pt-16 pb-28 prose max-w-none {isDark ? 'prose-invert' : ''}"
		style:font-family={FONTS[fontFamily] || FONTS.serif}
		style:font-size="{fontSize}px"
		style:line-height={lineHeight}
		style:max-width="{maxWidth}px"
		style:color={isDark ? '#e5e5e5' : '#171717'}
	>
		{@html content || '<p>No content</p>'}
	</article>

	<!-- BOTTOM NAV (prev / next) -->
	<div
		data-controls
		class="fixed right-0 bottom-0 left-0 z-[100] flex justify-center gap-[18px] border-t px-5 py-3 transition-transform duration-300 pointer-events-auto {showControls
			? 'translate-y-0'
			: 'translate-y-full'} {isDark
			? 'border-white/5 bg-zinc-950/80 backdrop-blur-md'
			: 'border-zinc-300/60 bg-white/70 backdrop-blur-md'}"
	>
		<button
			type="button"
			class="touch-manipulation flex min-w-[90px] items-center justify-center gap-1 rounded-[15px] border px-[15px] py-[10px] text-[0.92em] backdrop-blur-md transition disabled:cursor-not-allowed disabled:opacity-30
				{isDark
					? 'border-white/15 bg-purple-600/50 text-white/85 active:bg-purple-600/70'
					: 'border-zinc-300 bg-purple-600/85 text-white active:bg-purple-600'}"
			disabled={!prevChapter}
			aria-label="Previous chapter"
			onclick={(e) => {
				e.stopPropagation();
				goChapter(prevChapter);
			}}
		>
			<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
				<path d="M13 5l-7 7 7 7" />
				<path d="M19 5l-7 7 7 7" opacity="0.6" />
			</svg>
		</button>

		<button
			type="button"
			class="touch-manipulation flex min-w-[90px] items-center justify-center gap-1 rounded-[15px] border px-[15px] py-[10px] text-[0.92em] backdrop-blur-md transition disabled:cursor-not-allowed disabled:opacity-30
				{isDark
					? 'border-white/15 bg-purple-600/50 text-white/85 active:bg-purple-600/70'
					: 'border-zinc-300 bg-purple-600/85 text-white active:bg-purple-600'}"
			disabled={!nextChapter}
			aria-label="Next chapter"
			onclick={(e) => {
				e.stopPropagation();
				goChapter(nextChapter);
			}}
		>
			<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
				<path d="M11 5l7 7-7 7" />
				<path d="M5 5l7 7-7 7" opacity="0.6" />
			</svg>
		</button>
	</div>

	<!-- SIDE FLOATING BUTTONS -->
	<div
		data-controls
		class="fixed right-[15px] bottom-[78px] z-[320] flex flex-col items-center gap-2.5 transition-opacity duration-200 pointer-events-auto {showControls
			? 'opacity-100'
			: 'opacity-0 pointer-events-none'}"
	>
		<button
			type="button"
			class="touch-manipulation flex h-11 w-11 items-center justify-center rounded-full border-0 bg-[rgba(0,150,255,0.2)] text-[#4da6ff] backdrop-blur-md active:scale-95"
			title="Scroll to top"
			onclick={(e) => {
				e.stopPropagation();
				scrollToTop();
			}}
		>
			<ChevronsUp class="h-5 w-5" />
		</button>

		<button
			type="button"
			class="touch-manipulation flex h-11 w-11 items-center justify-center rounded-full border-0 bg-[rgba(0,200,120,0.2)] text-[#35d98a] backdrop-blur-md active:scale-95"
			title="Text to Speech"
			onclick={(e) => {
				e.stopPropagation();
				isSpeaking ? stopTTS() : speak();
			}}
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
				class="touch-manipulation flex h-11 w-11 items-center justify-center rounded-full border-0 bg-[rgba(255,180,0,0.2)] text-amber-400 backdrop-blur-md active:scale-95"
				title={isPaused ? 'Resume' : 'Pause'}
				onclick={(e) => {
					e.stopPropagation();
					pauseTTS();
				}}
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
			class="touch-manipulation flex h-11 w-11 items-center justify-center rounded-full border-0 backdrop-blur-md active:scale-95 {autoScroll
				? 'bg-emerald-600/40 text-emerald-300'
				: 'bg-[rgba(120,80,255,0.2)] text-purple-400'}"
			title="Auto scroll"
			onclick={(e) => {
				e.stopPropagation();
				toggleAutoScroll();
			}}
		>
			{#if autoScroll}
				<Pause class="h-5 w-5" />
			{:else}
				<Play class="h-5 w-5" />
			{/if}
		</button>

		<button
			type="button"
			class="touch-manipulation flex h-11 w-11 items-center justify-center rounded-full border-0 bg-transparent text-purple-500 active:scale-95"
			title="Settings"
			onclick={(e) => {
				e.stopPropagation();
				lockControls();
				showSettings = !showSettings;
			}}
		>
			<Settings class="h-6 w-6" strokeWidth={2} />
		</button>
	</div>

	{#if showSettings}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="fixed inset-0 z-[400] flex items-end sm:items-center justify-center bg-black/50"
			onclick={(e) => {
				e.stopPropagation();
				showSettings = false;
			}}
			role="presentation"
		>
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 shadow-xl max-h-[80vh] overflow-y-auto {isDark
					? 'bg-zinc-900 text-zinc-100'
					: 'bg-white text-zinc-900'}"
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
							class="touch-manipulation py-2 px-3 rounded-lg border text-sm capitalize transition
								{fontFamily === f
								? 'border-emerald-500 bg-emerald-500/20'
								: isDark
									? 'border-white/15 active:bg-white/5'
									: 'border-zinc-300 active:bg-zinc-50'}"
							style:font-family={FONTS[f]}
							onclick={() => (fontFamily = f)}
						>
							{f}
						</button>
					{/each}
				</div>

				<label class="block text-sm mb-1 opacity-70" for="font-size">Font size: {fontSize}px</label>
				<input id="font-size" type="range" min="14" max="32" bind:value={fontSize} class="w-full mb-4" />

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
					class="w-full mb-4"
				/>

				<label class="block text-sm mb-1 opacity-70" for="max-width">Max width: {maxWidth}px</label>
				<input
					id="max-width"
					type="range"
					min="480"
					max="960"
					step="20"
					bind:value={maxWidth}
					class="w-full mb-4"
				/>

				<label class="flex items-center justify-between mb-4">
					<span class="text-sm">Dark mode</span>
					<input type="checkbox" bind:checked={isDark} />
				</label>

				<label class="block text-sm mb-1 opacity-70" for="scroll-speed">
					Auto-scroll: {scrollSpeed} px/s
				</label>
				<input
					id="scroll-speed"
					type="range"
					min="10"
					max="120"
					bind:value={scrollSpeed}
					class="w-full mb-4"
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
					class="w-full mb-4"
				/>

				{#if voices.length}
					<label class="block text-sm mb-1 opacity-70" for="tts-voice">Voice</label>
					<select
						id="tts-voice"
						class="w-full rounded-lg border px-3 py-2 mb-4 outline-none
							{isDark
							? 'bg-zinc-800 border-white/15 text-zinc-100'
							: 'bg-white border-zinc-300 text-zinc-900'}"
						bind:value={ttsVoiceURI}
					>
						{#each voices as v (v.voiceURI)}
							<option
								value={v.voiceURI}
								class={isDark ? 'bg-zinc-800 text-zinc-100' : 'bg-white text-zinc-900'}
							>
								{v.name} ({v.lang})
							</option>
						{/each}
					</select>
				{/if}

				<button
					type="button"
					class="touch-manipulation w-full py-2.5 rounded-xl bg-emerald-600 text-white font-medium active:bg-emerald-500 transition"
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

	/* Hilangkan delay 300ms di mobile */
	:global(.touch-manipulation) {
		touch-action: manipulation;
		-webkit-tap-highlight-color: transparent;
	}
</style>