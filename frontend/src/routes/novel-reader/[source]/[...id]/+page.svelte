<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { saveReading } from '$lib/stores/history';
	import { markChapterRead } from '$lib/utils/readChapters';
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
		Check,
		X,
		Languages,
		MoreVertical,
		Download
	} from 'lucide-svelte';
	import { downloadNovelChapterPdf } from '$lib/utils/downloadNovelPdf';

	interface Chapter {
		id?: string | number;
		title?: string;
		number?: number;
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
	let showTools = $state(false);
	let isSpeaking = $state(false);
	let isPaused = $state(false);
	let settingsReady = $state(false);

	let isTranslating = $state(false);
	let showTranslated = $state(false);
	let translatedContent = $state('');
	let targetLang = $state('id');
	let translateError = $state('');
	let usedModel = $state('');
	let fromCache = $state(false);

	let isDownloading = $state(false);
	let downloadProgress = $state(0);
	let downloadLabel = $state('');

	const DEFAULT_PROMPTS: Record<string, string> = {
		id: `Kamu adalah penerjemah profesional light novel.
Terjemahkan teks berikut ke bahasa {{lang}} dengan gaya natural, enak dibaca, dan tetap menjaga nuansa cerita.
Jangan tambahkan penjelasan, catatan, atau komentar apapun. Hanya kembalikan hasil terjemahan saja.

Teks:
{{text}}`,
		en: `You are a professional light novel translator.
Translate the following text into {{lang}} with a natural, readable style while preserving the story's tone.
Do not add any explanations, notes, or comments. Return only the translation.

Text:
{{text}}`,
		ja: `あなたはプロのライトノベル翻訳者です。
次のテキストを{{lang}}に、自然で読みやすく、物語の雰囲気を保ったまま翻訳してください。
説明・注釈・コメントは一切追加せず、翻訳結果のみを返してください。

本文:
{{text}}`,
		ko: `당신은 전문 라이트 노벨 번역가입니다.
다음 텍스트를 {{lang}}(으)로 자연스럽고 읽기 쉽게, 이야기의 분위기를 유지하며 번역하세요.
설명, 주석, 코멘트를 추가하지 말고 번역 결과만 반환하세요.

본문:
{{text}}`,
		zh: `你是一名专业的轻小说翻译。
请将以下文本翻译成{{lang}}，风格自然、易读，并保持故事氛围。
不要添加任何解释、注释或评论，只返回译文。

正文：
{{text}}`,
		es: `Eres un traductor profesional de novelas ligeras.
Traduce el siguiente texto al {{lang}} con un estilo natural y fácil de leer, manteniendo el tono de la historia.
No agregues explicaciones, notas ni comentarios. Devuelve solo la traducción.

Texto:
{{text}}`,
		fr: `Vous êtes un traducteur professionnel de light novels.
Traduisez le texte suivant en {{lang}} avec un style naturel et fluide, en conservant l'ambiance de l'histoire.
N'ajoutez aucune explication, note ou commentaire. Retournez uniquement la traduction.

Texte :
{{text}}`,
		th: `คุณเป็นนักแปลไลต์โนเวลมืออาชีพ
แปลข้อความต่อไปนี้เป็นภาษา{{lang}} ในสไตล์ที่เป็นธรรมชาติ อ่านง่าย และคงบรรยากาศของเรื่องไว้
อย่าเพิ่มคำอธิบาย หมายเหตุ หรือความเห็นใดๆ ส่งคืนเฉพาะคำแปลเท่านั้น

ข้อความ:
{{text}}`,
		vi: `Bạn là dịch giả light novel chuyên nghiệp.
Hãy dịch đoạn văn sau sang {{lang}} với văn phong tự nhiên, dễ đọc, giữ nguyên sắc thái câu chuyện.
Không thêm giải thích, ghi chú hay bình luận. Chỉ trả về bản dịch.

Nội dung:
{{text}}`
	};

	function defaultPromptFor(lang: string): string {
		return DEFAULT_PROMPTS[lang] || DEFAULT_PROMPTS.en;
	}

	let translatePrompt = $state(defaultPromptFor('id'));
	let showPromptEditor = $state(false);
	let showLangDropdown = $state(false);
	let promptDraft = $state(defaultPromptFor('id'));
	let lastDefaultPrompt = $state(defaultPromptFor('id'));

	const LANG_OPTIONS = [
		{ code: 'id', label: 'Indonesian', native: 'Indonesia' },
		{ code: 'en', label: 'English', native: 'English' },
		{ code: 'ja', label: 'Japanese', native: '日本語' },
		{ code: 'ko', label: 'Korean', native: '한국어' },
		{ code: 'zh', label: 'Chinese', native: '中文' },
		{ code: 'es', label: 'Spanish', native: 'Español' },
		{ code: 'fr', label: 'French', native: 'Français' },
		{ code: 'th', label: 'Thai', native: 'ไทย' },
		{ code: 'vi', label: 'Vietnamese', native: 'Tiếng Việt' }
	];

	let selectedLangLabel = $derived(
		LANG_OPTIONS.find((l) => l.code === targetLang)?.label || targetLang
	);
	let selectedLangNative = $derived(
		LANG_OPTIONS.find((l) => l.code === targetLang)?.native || targetLang
	);

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
			if (s.targetLang) targetLang = s.targetLang;
			const langDefault = defaultPromptFor(s.targetLang || targetLang || 'id');
			lastDefaultPrompt = langDefault;
			if (typeof s.translatePrompt === 'string' && s.translatePrompt.trim()) {
				translatePrompt = s.translatePrompt;
				promptDraft = s.translatePrompt;
			} else {
				translatePrompt = langDefault;
				promptDraft = langDefault;
			}
		} catch {
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
				ttsVoiceURI,
				targetLang,
				translatePrompt
			})
		);
	}

	$effect(() => {
		fontFamily;
		fontSize;
		lineHeight;
		maxWidth;
		scrollSpeed;
		ttsRate;
		ttsVoiceURI;
		targetLang;
		translatePrompt;
		if (settingsReady) saveSettings();
	});

	$effect(() => {
		content;
		translatedContent = '';
		showTranslated = false;
		translateError = '';
		usedModel = '';
		fromCache = false;
		showTools = false;
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
		if (voices.length === 0) loadVoices();
		const text = getPlainText();
		if (!text.trim()) return;
		const u = new SpeechSynthesisUtterance(text);
		u.rate = ttsRate;
		if (voices.length > 0) {
			const voice = voices.find((v) => v.voiceURI === ttsVoiceURI);
			if (voice) u.voice = voice;
		}
		u.onend = () => {
			isSpeaking = false;
			isPaused = false;
		};
		u.onerror = (e) => {
			console.error('[TTS Error]', e);
			isSpeaking = false;
			isPaused = false;
		};
		window.speechSynthesis.cancel();
		window.speechSynthesis.speak(u);
		if (window.speechSynthesis.paused) window.speechSynthesis.resume();
		isSpeaking = true;
		isPaused = false;
	}

	function stopTTS() {
		if (!browser || !('speechSynthesis' in window)) return;
		window.speechSynthesis.cancel();
		isSpeaking = false;
		isPaused = false;
	}

	function toggleTTS(e?: Event) {
		e?.preventDefault();
		e?.stopPropagation();
		if (isSpeaking) stopTTS();
		else speak();
	}


	function openTranslatePrompt() {
		if (!content || isTranslating) return;
		if (translatedContent && showTranslated) {
			showTranslated = false;
			return;
		}
		if (translatedContent && !showTranslated) {
			showTranslated = true;
			return;
		}
		promptDraft = translatePrompt;
		showPromptEditor = true;
		showTools = false;
	}

	function resetPromptToDefault() {
		const d = defaultPromptFor(targetLang);
		promptDraft = d;
		lastDefaultPrompt = d;
	}

	async function confirmTranslate() {
		if (!content || isTranslating) return;
		translatePrompt = promptDraft;
		showPromptEditor = false;
		await runTranslate();
	}

	async function runTranslate() {
		if (!content || isTranslating) return;
		isTranslating = true;
		translateError = '';
		usedModel = '';
		fromCache = false;
		showTools = false;
		try {
			const plainText = content
				.replace(/<br\s*\/?>/gi, '\n')
				.replace(/<\/p>/gi, '\n\n')
				.replace(/<[^>]+>/g, '')
				.replace(/&nbsp;/g, ' ')
				.replace(/&amp;/g, '&')
				.replace(/&lt;/g, '<')
				.replace(/&gt;/g, '>')
				.trim();
			const cacheKey = `${source}:${chapterId}:${targetLang}`;
			const res = await fetch('/api/translate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					text: plainText,
					targetLang,
					cacheKey,
					prompt: translatePrompt
				})
			});
			const data = (await res.json()) as {
				translated?: string;
				model?: string;
				cached?: boolean;
				message?: string;
			};
			if (!res.ok) throw new Error(data.message || 'Translation failed');
			translatedContent = data.translated || '';
			usedModel = data.model || '';
			fromCache = !!data.cached;
			showTranslated = true;
		} catch (err) {
			console.error('[Translate Error]', err);
			translateError = err instanceof Error ? err.message : 'Translation failed';
		} finally {
			isTranslating = false;
		}
	}

	async function translateChapter() {
		openTranslatePrompt();
	}

	function changeLang(code: string) {
		showLangDropdown = false;
		if (code === targetLang) return;
		const nextDefault = defaultPromptFor(code);
		if (
			!translatePrompt.trim() ||
			translatePrompt === lastDefaultPrompt ||
			promptDraft === lastDefaultPrompt
		) {
			translatePrompt = nextDefault;
			promptDraft = nextDefault;
		}
		lastDefaultPrompt = nextDefault;
		targetLang = code;
		translatedContent = '';
		showTranslated = false;
		translateError = '';
		usedModel = '';
		fromCache = false;
	}

	let selectedVoiceName = $derived(() => {
		const current = voices.find((v) => v.voiceURI === ttsVoiceURI);
		return current ? `${current.name} (${current.lang})` : 'Pilih Suara / Voice...';
	});

	let groupedVoices = $derived(() => {
		const groups: Record<string, SpeechSynthesisVoice[]> = {};
		voices.forEach((v) => {
			const langCode = v.lang.split('-')[0].toUpperCase();
			if (!groups[langCode]) groups[langCode] = [];
			groups[langCode].push(v);
		});
		return groups;
	});


	async function downloadChapterFile() {
		if (isDownloading || !browser || !chapterId || !source) return;

		isDownloading = true;
		downloadProgress = 5;
		downloadLabel = 'Preparing…';
		showTools = false;

		try {
			const novelTitle = (novelInfo as { title?: string } | null)?.title || title || 'Novel';
			const chTitle =
				(currentChapter as { title?: string } | null)?.title || title || 'Chapter';
			const mangaId = (novelInfo as { id?: string } | null)?.id || '';
			const cover = (novelInfo as { cover?: string } | null)?.cover || '';

			await downloadNovelChapterPdf({
				source,
				chapterId: String(chapterId),
				chapterTitle: chTitle,
				novelTitle,
				mangaId: mangaId ? String(mangaId) : undefined,
				cover: cover || undefined,
				onProgress: (p) => {
					if (p.phase === 'fetch') {
						downloadProgress = 15;
						downloadLabel = p.message || 'Fetching…';
					} else if (p.phase === 'pdf') {
						downloadProgress = 45;
						downloadLabel = p.message || 'Building PDF…';
					} else if (p.phase === 'disk') {
						downloadProgress = 80;
						downloadLabel = p.message || 'Saving to library…';
					} else if (p.phase === 'done') {
						downloadProgress = 100;
						downloadLabel = p.message || 'Done';
					} else if (p.phase === 'error') {
						downloadLabel = p.message || 'Failed';
					}
				}
			});

			await new Promise((r) => setTimeout(r, 600));
		} catch (e) {
			console.error('[novel download]', e);
			downloadLabel = e instanceof Error ? e.message : 'Failed';
			await new Promise((r) => setTimeout(r, 1000));
		} finally {
			isDownloading = false;
			downloadProgress = 0;
			downloadLabel = '';
		}
	}

	async function goChapter(ch: Chapter | null | undefined) {
		if (!ch?.id || !source) return;
		stopTTS();
		stopAutoScroll();
		showTools = false;
		const cleanId = String(ch.id).replace(/^\/+/, '');
		await goto(`/novel-reader/${source}/${cleanId}`, {
			replaceState: true,
			invalidateAll: true
		});
		window.scrollTo(0, 0);
	}

	function scrollToTop() {
		window.scrollTo({ top: 0, behavior: 'smooth' });
		showTools = false;
	}

	$effect(() => {
		if (!browser) return;
		try {
			const nid =
				(novelInfo as { id?: string; title?: string; cover?: string } | null)?.id ||
				chapterId ||
				'';
			const ntitle = (novelInfo as { title?: string } | null)?.title || title || 'Novel';
			const ncover = (novelInfo as { cover?: string } | null)?.cover || '';
			if (!nid || !source) return;
			const mangaId = String(nid).startsWith('/')
				? String(nid)
				: `/${String(nid).replace(/^\/+/, '')}`;
			const chId = chapterId
				? String(chapterId).startsWith('/')
					? String(chapterId)
					: `/${String(chapterId).replace(/^\/+/, '')}`
				: '';
			if (!chId) return;
			const chTitle =
				(currentChapter as { title?: string } | null)?.title || title || 'Chapter';
			const chNum = Number((currentChapter as { number?: number } | null)?.number) || 0;
			markChapterRead(source, mangaId, chId, chNum);
			saveReading({
				mangaId,
				mangaSlug: '',
				mangaTitle: ntitle,
				cover: ncover,
				chapterId: chId,
				chapterTitle: chTitle,
				chapterNumber: chNum,
				sourceId: source
			});
		} catch (e) {
			console.warn('[novel-reader] save history failed', e);
		}
	});

	onMount(() => {
		loadSettings();
		settingsReady = true;
		if (browser) {
			isDark = document.documentElement.classList.contains('dark');
			const observer = new MutationObserver(() => {
				isDark = document.documentElement.classList.contains('dark');
			});
			observer.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ['class']
			});
			if ('speechSynthesis' in window) {
				loadVoices();
				window.speechSynthesis.onvoiceschanged = loadVoices;
				setTimeout(loadVoices, 500);
				setTimeout(loadVoices, 1000);
			}
			const onKey = (e: KeyboardEvent) => {
				if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
					return;
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
	class="min-h-screen transition-colors duration-200 {isDark
		? 'bg-zinc-950 text-zinc-100'
		: 'bg-slate-100 text-zinc-900'}"
>
	<!-- CONTENT -->
	<article
		id="novel-content"
		class="mx-auto px-4 pt-16 pb-24 prose max-w-none {isDark ? 'prose-invert' : ''}"
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
			{#if showTranslated}
				<p class="text-xs mt-1 text-emerald-400">
					AI translation ({LANG_OPTIONS.find((l) => l.code === targetLang)?.label || targetLang})
					{#if fromCache}
						· cached
					{:else if usedModel}
						· {usedModel}
					{/if}
				</p>
			{/if}
			{#if translateError}
				<p class="text-xs mt-1 text-red-400">{translateError}</p>
			{/if}
		</div>

		{#if showTranslated && translatedContent}
			{@html translatedContent.replace(/\n/g, '<br>')}
		{:else}
			{@html content || '<p>No content</p>'}
		{/if}
	</article>

	<div
		class="fixed right-0 bottom-0 left-0 z-[100] flex justify-center gap-[18px] px-5 py-3 bg-transparent border-0 pointer-events-none"
		style="padding-bottom: max(0.75rem, env(safe-area-inset-bottom));"
	>
		<button
			type="button"
			class="pointer-events-auto touch-manipulation flex min-w-[90px] items-center justify-center gap-1 rounded-[15px] border px-[15px] py-[10px] text-[0.92em] transition disabled:cursor-not-allowed disabled:opacity-30 {isDark
				? 'border-white/15 bg-purple-600/50 text-white/85 active:bg-purple-600/70'
				: 'border-zinc-300 bg-purple-600/85 text-white active:bg-purple-600'}"
			disabled={!prevChapter}
			aria-label="Previous chapter"
			onclick={() => goChapter(prevChapter)}
		>
			<svg
				viewBox="0 0 24 24"
				width="20"
				height="20"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<path d="M13 5l-7 7 7 7" />
				<path d="M19 5l-7 7 7 7" opacity="0.6" />
			</svg>
		</button>

		<button
			type="button"
			class="pointer-events-auto touch-manipulation flex min-w-[90px] items-center justify-center gap-1 rounded-[15px] border px-[15px] py-[10px] text-[0.92em] transition disabled:cursor-not-allowed disabled:opacity-30 {isDark
				? 'border-white/15 bg-purple-600/50 text-white/85 active:bg-purple-600/70'
				: 'border-zinc-300 bg-purple-600/85 text-white active:bg-purple-600'}"
			disabled={!nextChapter}
			aria-label="Next chapter"
			onclick={() => goChapter(nextChapter)}
		>
			<svg
				viewBox="0 0 24 24"
				width="20"
				height="20"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<path d="M11 5l7 7-7 7" />
				<path d="M5 5l7 7-7 7" opacity="0.6" />
			</svg>
		</button>
	</div>

	<div
		class="fixed right-3 z-[500] flex flex-col items-end gap-2"
		style="bottom: max(5.5rem, calc(env(safe-area-inset-bottom) + 4.5rem));"
	>
		{#if showTools}
			<div
				class="flex flex-col items-center gap-2 rounded-2xl border p-2 shadow-xl
					{isDark ? 'border-white/10 bg-zinc-900/95' : 'border-zinc-200 bg-white/95'}"
			>
				<button
					type="button"
					class="touch-manipulation flex h-11 w-11 items-center justify-center rounded-full active:scale-95 select-none
						{isDark ? 'text-sky-400 active:bg-white/10' : 'text-sky-600 active:bg-zinc-100'}"
					title="Scroll to top"
					onclick={scrollToTop}
				>
					<ChevronsUp class="h-5 w-5 pointer-events-none" />
				</button>

				<button
					type="button"
					class="touch-manipulation flex h-11 w-11 items-center justify-center rounded-full active:scale-95 select-none
						{isSpeaking
							? 'bg-red-500/20 text-red-400'
							: isDark
								? 'text-emerald-400 active:bg-white/10'
								: 'text-emerald-600 active:bg-zinc-100'}"
					title={isSpeaking ? 'Stop TTS' : 'Text to Speech'}
					aria-label={isSpeaking ? 'Stop text to speech' : 'Start text to speech'}
					onclick={toggleTTS}
				>
					{#if isSpeaking}
						<Square class="h-4 w-4 pointer-events-none" />
					{:else}
						<Volume2 class="h-5 w-5 pointer-events-none" />
					{/if}
				</button>

				<button
					type="button"
					class="touch-manipulation flex h-11 w-11 items-center justify-center rounded-full active:scale-95 select-none
						{autoScroll
							? 'bg-purple-600/30 text-purple-300'
							: isDark
								? 'text-purple-400 active:bg-white/10'
								: 'text-purple-600 active:bg-zinc-100'}"
					title="Auto scroll"
					onclick={toggleAutoScroll}
				>
					{#if autoScroll}
						<Pause class="h-4 w-4 pointer-events-none" />
					{:else}
						<Play class="h-4 w-4 pointer-events-none" />
					{/if}
				</button>

				<button
					type="button"
					class="touch-manipulation flex h-11 w-11 items-center justify-center rounded-full active:scale-95 select-none
						{isTranslating
							? 'bg-amber-500/20 text-amber-300'
							: showTranslated
								? 'bg-emerald-500/20 text-emerald-300'
								: isDark
									? 'text-orange-400 active:bg-white/10'
									: 'text-orange-600 active:bg-zinc-100'}"
					title={isTranslating
						? 'Translating...'
						: showTranslated
							? 'Show original'
							: `AI Translate (${targetLang.toUpperCase()})`}
					disabled={isTranslating}
					onclick={translateChapter}
				>
					{#if isTranslating}
						<span class="text-[10px] font-bold animate-pulse">...</span>
					{:else if showTranslated}
						<span class="text-[10px] font-bold">{targetLang.toUpperCase()}</span>
					{:else}
						<Languages class="h-4 w-4 pointer-events-none" />
					{/if}
				</button>

				<button
					type="button"
					class="touch-manipulation flex h-11 w-11 items-center justify-center rounded-full active:scale-95 select-none
						{isDownloading
							? 'bg-emerald-500/20 text-emerald-300'
							: isDark
								? 'text-emerald-400 active:bg-white/10'
								: 'text-emerald-600 active:bg-zinc-100'}"
					title={isDownloading ? downloadLabel || 'Downloading…' : 'Download to Offline Library (PDF)'}
					disabled={isDownloading || !content}
					onclick={downloadChapterFile}
				>
					{#if isDownloading}
						<span class="text-[9px] font-bold tabular-nums">{downloadProgress}%</span>
					{:else}
						<Download class="h-4 w-4 pointer-events-none" />
					{/if}
				</button>

				<select
					class="touch-manipulation h-8 w-11 rounded-lg border-0 text-[10px] text-center outline-none cursor-pointer appearance-none
						{isDark ? 'bg-zinc-800 text-zinc-200' : 'bg-zinc-100 text-zinc-700'}"
					value={targetLang}
					onchange={(e) => changeLang((e.currentTarget as HTMLSelectElement).value)}
					title="Target language"
				>
					{#each LANG_OPTIONS as lang}
						<option value={lang.code}>{lang.code.toUpperCase()}</option>
					{/each}
				</select>

				<button
					type="button"
					class="touch-manipulation flex h-11 w-11 items-center justify-center rounded-full active:scale-95 select-none
						{isDark ? 'text-zinc-300 active:bg-white/10' : 'text-zinc-600 active:bg-zinc-100'}"
					title="Settings"
					onclick={() => {
						showTools = false;
						showSettings = true;
					}}
				>
					<Settings class="h-5 w-5 pointer-events-none" />
				</button>
			</div>
		{/if}

		<!-- Main FAB toggle -->
		<button
			type="button"
			class="touch-manipulation flex h-12 w-12 items-center justify-center rounded-full shadow-lg active:scale-95 transition select-none
				{showTools
				? isDark
					? 'bg-zinc-700 text-white'
					: 'bg-zinc-300 text-zinc-800'
				: 'bg-purple-600 text-white'}"
			title={showTools ? 'Tutup menu' : 'Menu tools'}
			onclick={() => (showTools = !showTools)}
		>
			{#if showTools}
				<X class="h-5 w-5 pointer-events-none" />
			{:else}
				<MoreVertical class="h-5 w-5 pointer-events-none" />
			{/if}
		</button>
	</div>

	{#if isDownloading}
		<div class="fixed inset-x-0 top-0 z-[750] h-1 overflow-hidden bg-zinc-800/80">
			<div
				class="h-full bg-emerald-500 transition-all duration-300 ease-out"
				style="width: {downloadProgress}%"
			></div>
		</div>
		<div
			class="fixed left-1/2 top-3 z-[750] -translate-x-1/2 rounded-full border px-3 py-1 text-xs font-medium shadow-lg
				{isDark ? 'border-emerald-500/30 bg-zinc-900/95 text-emerald-300' : 'border-emerald-500/40 bg-white/95 text-emerald-700'}"
		>
			{downloadLabel || 'Downloading…'} · {downloadProgress}%
		</div>
	{/if}

	{#if isTranslating}
		<div
			class="fixed inset-0 z-[700] flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm"
		>
			<div
				class="flex flex-col items-center gap-4 rounded-2xl px-8 py-6 shadow-2xl {isDark
					? 'bg-zinc-900'
					: 'bg-white'}"
			>
				<div
					class="h-10 w-10 animate-spin rounded-full border-4 border-purple-500 border-t-transparent"
				></div>
				<p class="text-sm font-medium">Translating chapter...</p>
				<p class="text-xs opacity-60">
					{LANG_OPTIONS.find((l) => l.code === targetLang)?.label || targetLang} · Gemini AI
				</p>
			</div>
		</div>
	{/if}


	{#if showPromptEditor}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="fixed inset-0 z-[650] flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
			onclick={() => {
				showPromptEditor = false;
				showLangDropdown = false;
			}}
		>
			<div
				class="w-full max-w-md rounded-2xl p-4 shadow-xl max-h-[min(70vh,560px)] overflow-y-auto border
					{isDark
					? 'bg-zinc-900 text-zinc-100 border-white/10'
					: 'bg-white text-zinc-900 border-zinc-200'}"
				onclick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				tabindex="-1"
			>
				<h3 class="text-lg font-semibold mb-1 flex items-center gap-2">
					<Languages size={20} /> AI Translate Prompt
				</h3>
				<p class="text-xs opacity-60 mb-4">
					Edit the prompt before translating. Placeholders:
					<code class="px-1.5 py-0.5 rounded text-[11px] {isDark ? 'bg-zinc-800 text-violet-300' : 'bg-zinc-100 text-violet-700'}">{'{{lang}}'}</code>
					and
					<code class="px-1.5 py-0.5 rounded text-[11px] {isDark ? 'bg-zinc-800 text-violet-300' : 'bg-zinc-100 text-violet-700'}">{'{{text}}'}</code>.
				</p>

				<span class="block text-sm mb-1.5 opacity-70">Target language</span>
				<div class="relative mb-4">
					<button
						type="button"
						class="w-full flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-sm transition outline-none
							{isDark
							? 'bg-zinc-800/80 border-white/10 text-zinc-100 hover:border-violet-500/50 hover:bg-zinc-800'
							: 'bg-zinc-50 border-zinc-200 text-zinc-900 hover:border-violet-400 hover:bg-white'}"
						onclick={() => (showLangDropdown = !showLangDropdown)}
						aria-haspopup="listbox"
						aria-expanded={showLangDropdown}
					>
						<span class="flex items-center gap-2 min-w-0">
							<span class="font-medium">{selectedLangLabel}</span>
							<span class="truncate opacity-50 text-xs">{selectedLangNative}</span>
						</span>
						<ChevronDown
							class="h-4 w-4 shrink-0 opacity-60 transition-transform duration-200 {showLangDropdown
								? 'rotate-180'
								: ''}"
						/>
					</button>

					{#if showLangDropdown}
						<div
							class="absolute left-0 right-0 mt-1.5 z-50 rounded-xl border shadow-2xl overflow-hidden py-1 max-h-56 overflow-y-auto
								{isDark
								? 'bg-zinc-900 border-white/10'
								: 'bg-white border-zinc-200'}"
							role="listbox"
						>
							{#each LANG_OPTIONS as lang}
								<button
									type="button"
									role="option"
									aria-selected={targetLang === lang.code}
									class="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-sm text-left transition
										{targetLang === lang.code
										? 'bg-violet-600 text-white font-medium'
										: isDark
											? 'text-zinc-200 hover:bg-white/5'
											: 'text-zinc-800 hover:bg-zinc-100'}"
									onclick={() => changeLang(lang.code)}
								>
									<span class="flex items-center gap-2 min-w-0">
										<span>{lang.label}</span>
										<span
											class="text-xs truncate {targetLang === lang.code
												? 'text-white/70'
												: 'opacity-45'}">{lang.native}</span
										>
									</span>
									{#if targetLang === lang.code}
										<Check class="h-4 w-4 shrink-0" />
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>

				<label class="block text-sm mb-1.5 opacity-70" for="ai-prompt">Prompt</label>
				<textarea
					id="ai-prompt"
					rows="6"
					class="w-full rounded-xl border px-3.5 py-2.5 text-sm font-mono leading-relaxed outline-none resize-y min-h-[100px] max-h-[28vh] transition
						{isDark
						? 'bg-zinc-800/80 border-white/10 text-zinc-100 focus:border-violet-500/50'
						: 'bg-zinc-50 border-zinc-200 text-zinc-900 focus:border-violet-400 focus:bg-white'}"
					bind:value={promptDraft}
				></textarea>

				<div class="mt-4 flex flex-wrap gap-2">
					<button
						type="button"
						class="touch-manipulation flex-1 min-w-[120px] py-2.5 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-500 active:scale-[0.98] transition shadow-lg shadow-violet-600/20"
						onclick={confirmTranslate}
					>
						Translate
					</button>
					<button
						type="button"
						class="touch-manipulation px-3.5 py-2.5 rounded-xl border text-sm transition
							{isDark
							? 'border-white/10 text-zinc-300 hover:bg-white/5'
							: 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'}"
						onclick={resetPromptToDefault}
					>
						Reset default
					</button>
					<button
						type="button"
						class="touch-manipulation px-3.5 py-2.5 rounded-xl border text-sm transition
							{isDark
							? 'border-white/10 text-zinc-300 hover:bg-white/5'
							: 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'}"
						onclick={() => {
							showPromptEditor = false;
							showLangDropdown = false;
						}}
					>
						Cancel
					</button>
				</div>
			</div>
		</div>
	{/if}


	{#if showSettings}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="fixed inset-0 z-[600] flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
			onclick={() => (showSettings = false)}
		>
			<div
				class="w-full max-w-sm rounded-2xl p-4 shadow-xl max-h-[min(70vh,520px)] overflow-y-auto {isDark
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
							class="touch-manipulation py-2 px-3 rounded-lg border text-sm capitalize transition {fontFamily ===
							f
								? 'border-purple-500 bg-purple-500/20 text-purple-400 font-medium'
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
				<input
					id="font-size"
					type="range"
					min="14"
					max="32"
					bind:value={fontSize}
					class="w-full mb-4 accent-purple-600"
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
						class="w-full flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-sm transition outline-none {isDark
							? 'bg-zinc-800/80 border-white/15 text-zinc-100 active:bg-zinc-800'
							: 'bg-white border-zinc-300 text-zinc-900 active:bg-zinc-50'}"
						onclick={() => (showVoiceDropdown = !showVoiceDropdown)}
					>
						<span class="truncate">{selectedVoiceName()}</span>
						<ChevronDown
							class="h-4 w-4 opacity-60 transition-transform duration-200 {showVoiceDropdown
								? 'rotate-180'
								: ''}"
						/>
					</button>

					{#if showVoiceDropdown}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="absolute left-0 right-0 mt-2 z-50 rounded-xl border shadow-2xl max-h-60 overflow-y-auto p-1.5 {isDark
								? 'bg-zinc-900 border-white/15 text-zinc-100'
								: 'bg-white border-zinc-200 text-zinc-900'}"
						>
							{#if voices.length === 0}
								<div class="p-3 text-center text-sm opacity-60">Memuat suara...</div>
							{:else}
								{#each Object.entries(groupedVoices()) as [lang, langVoices]}
									<div
										class="px-3 py-1.5 text-xs font-bold uppercase tracking-wider opacity-50 bg-purple-500/10 rounded-md my-1"
									>
										🌍 Language: {lang}
									</div>
									{#each langVoices as v (v.voiceURI)}
										<button
											type="button"
											class="w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg text-left transition {ttsVoiceURI ===
											v.voiceURI
												? 'bg-purple-600 text-white font-medium'
												: isDark
													? 'hover:bg-white/5'
													: 'hover:bg-zinc-100'}"
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


				<div class="mb-4">
					<span class="block text-sm mb-1 opacity-70">AI translate prompt</span>
					<button
						type="button"
						class="w-full touch-manipulation py-2.5 rounded-xl border text-sm flex items-center justify-center gap-2 {isDark
							? 'border-white/15 active:bg-white/5'
							: 'border-zinc-300 active:bg-zinc-50'}"
						onclick={() => {
							showSettings = false;
							promptDraft = translatePrompt;
							showPromptEditor = true;
						}}
					>
						<Languages class="h-4 w-4" />
						Edit AI prompt
					</button>
					<p class="mt-1 text-[11px] opacity-50">Prompt is saved on this device and used for every translation.</p>
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
