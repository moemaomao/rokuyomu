<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import {
		ChevronLeft,
		ChevronRight,
		Settings,
		Play,
		Pause,
		Square,
		Type,
		Volume2
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
			if (typeof s.isDark === 'boolean') isDark = s.isDark;
			if (s.scrollSpeed) scrollSpeed = s.scrollSpeed;
			if (s.ttsRate) ttsRate = s.ttsRate;
			if (s.ttsVoiceURI) ttsVoiceURI = s.ttsVoiceURI;
		} catch {
			/* ignore */
		}
	}

	function saveSettings() {
		if (!browser) return;
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
		window.speechSynthesis.cancel();
		isSpeaking = false;
		isPaused = false;
	}

	function goChapter(ch: { id: string } | null | undefined) {
		if (!ch?.id || !source) return;
		stopTTS();
		stopAutoScroll();
		const id = String(ch.id).replace(/^\//, '');
		goto(`/novel-reader/${source}/${encodeURIComponent(id)}`);
	}

	onMount(() => {
		loadSettings();
		loadVoices();
		if (browser && window.speechSynthesis) {
			window.speechSynthesis.onvoiceschanged = loadVoices;
		}
		let lastY = 0;
		const onScroll = () => {
			const y = window.scrollY;
			showControls = y < lastY || y < 80;
			lastY = y;
		};
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
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
	class="min-h-screen transition-colors duration-200 {isDark
		? 'bg-zinc-950 text-zinc-100'
		: 'bg-amber-50 text-zinc-900'}"
>
	<header
		class="fixed top-0 inset-x-0 z-40 flex items-center justify-between gap-2 px-3 py-2 backdrop-blur-md transition-transform duration-300 {showControls
			? 'translate-y-0'
			: '-translate-y-full'} {isDark ? 'bg-zinc-900/80' : 'bg-white/80'}"
	>
		<button
			type="button"
			class="p-2 rounded-lg hover:bg-white/10"
			onclick={() => history.back()}
			aria-label="Back"
		>
			<ChevronLeft size={22} />
		</button>
		<div class="flex-1 min-w-0 text-center">
			<p class="text-sm font-medium truncate">{novelInfo?.title || ''}</p>
			<p class="text-xs opacity-70 truncate">{title}</p>
		</div>
		<button
			type="button"
			class="p-2 rounded-lg hover:bg-white/10"
			onclick={() => (showSettings = !showSettings)}
			aria-label="Settings"
		>
			<Settings size={22} />
		</button>
	</header>

	<article
		id="novel-content"
		class="mx-auto px-4 pt-20 pb-28 prose max-w-none {isDark ? 'prose-invert' : ''}"
		style:font-family={FONTS[fontFamily] || FONTS.serif}
		style:font-size="{fontSize}px"
		style:line-height={lineHeight}
		style:max-width="{maxWidth}px"
	>
		{@html content || '<p>No content</p>'}
	</article>

	<footer
		class="fixed bottom-0 inset-x-0 z-40 flex items-center justify-between gap-2 px-3 py-3 backdrop-blur-md transition-transform duration-300 {showControls
			? 'translate-y-0'
			: 'translate-y-full'} {isDark ? 'bg-zinc-900/90' : 'bg-white/90'}"
	>
		<button
			type="button"
			class="flex items-center gap-1 px-3 py-2 rounded-lg text-sm disabled:opacity-40"
			disabled={!prevChapter}
			onclick={() => goChapter(prevChapter)}
		>
			<ChevronLeft size={18} /> Prev
		</button>

		<div class="flex items-center gap-2">
			<button
				type="button"
				class="p-2 rounded-full hover:bg-white/10"
				onclick={isSpeaking ? stopTTS : speak}
				title="Text to Speech"
			>
				{#if isSpeaking}
					<Square size={20} />
				{:else}
					<Volume2 size={20} />
				{/if}
			</button>
			{#if isSpeaking}
				<button type="button" class="p-2 rounded-full hover:bg-white/10" onclick={pauseTTS}>
					{#if isPaused}
						<Play size={20} />
					{:else}
						<Pause size={20} />
					{/if}
				</button>
			{/if}

			<button
				type="button"
				class="p-2 rounded-full hover:bg-white/10 {autoScroll ? 'bg-emerald-600/30' : ''}"
				onclick={toggleAutoScroll}
				title="Auto scroll"
			>
				{#if autoScroll}
					<Pause size={20} />
				{:else}
					<Play size={20} />
				{/if}
			</button>
		</div>

		<button
			type="button"
			class="flex items-center gap-1 px-3 py-2 rounded-lg text-sm disabled:opacity-40"
			disabled={!nextChapter}
			onclick={() => goChapter(nextChapter)}
		>
			Next <ChevronRight size={18} />
		</button>
	</footer>

	{#if showSettings}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div
			class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50"
			onclick={() => (showSettings = false)}
			role="presentation"
		>
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
			<div
				class="w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 shadow-xl {isDark
					? 'bg-zinc-900'
					: 'bg-white'}"
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
							class="py-2 px-3 rounded-lg border text-sm capitalize {fontFamily === f
								? 'border-emerald-500 bg-emerald-500/20'
								: ''}"
							style:font-family={FONTS[f]}
							onclick={() => (fontFamily = f)}
						>
							{f}
						</button>
					{/each}
				</div>

				<label class="block text-sm mb-1 opacity-70" for="font-size">
					Font size: {fontSize}px
				</label>
				<input
					id="font-size"
					type="range"
					min="14"
					max="32"
					bind:value={fontSize}
					class="w-full mb-4"
				/>

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

				<label class="block text-sm mb-1 opacity-70" for="max-width">
					Max width: {maxWidth}px
				</label>
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
					Auto-scroll speed: {scrollSpeed} px/s
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
						class="w-full rounded-lg border px-3 py-2 mb-4 bg-transparent"
						bind:value={ttsVoiceURI}
					>
						{#each voices as v (v.voiceURI)}
							<option value={v.voiceURI}>{v.name} ({v.lang})</option>
						{/each}
					</select>
				{/if}

				<button
					type="button"
					class="w-full py-2.5 rounded-xl bg-emerald-600 text-white font-medium"
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
</style>
