<script lang="ts">
	import { onMount, onDestroy, tick, untrack } from 'svelte';
	import { saveReading, getLastRead } from '$lib/stores/history';
	import {
		getReadSets,
		markChapterRead
	} from '$lib/utils/readChapters';
	import { browser } from '$app/environment';
	import { getPreferences, subscribePreferences } from '$lib/stores/preferences';
	import { goto } from '$app/navigation';
	import {
		Settings,
		Play,
		Pause,
		Square,
		Type,
		Volume2,
		ChevronsUp,
		Check,
		X,
		Languages,
		MoreVertical,
		Download,
		BookOpen,
		ChevronDown,
		WifiOff
	} from 'lucide-svelte';
	import { downloadNovelChapterPdf } from '$lib/utils/downloadNovel';
	import {
		getOfflineNovelChapter,
		listOfflineNovelChapters
	} from '$lib/utils/offlineChapter';
import { autoDownloadNovelChapter } from '$lib/utils/autoDownloadOnRead';
	import DownloadFolderOnboarding from '$lib/components/DownloadFolderOnboarding.svelte';
	import DiskPermissionOverlay from '$lib/components/DiskPermissionOverlay.svelte';
	import {
		getOfflineChapterIds,
		ensureLibraryLoaded
	} from '$lib/stores/download.svelte';

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

	let offlineNovelMode = $state(false);
	let offlineContent = $state<string | null>(null);
	let autoDownloadOnRead = $state(getPreferences().autoDownloadOnRead);

	function formatNovelHtml(raw: string | null | undefined): string {
		const s = String(raw || '').trim();
		if (!s) return '<p>No content</p>';
		if (/<[a-z][\s\S]*>/i.test(s)) return s;
		const esc = (t: string) =>
			t
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;');
		return s
			.replace(/\r\n/g, '\n')
			.replace(/\r/g, '\n')
			.split(/\n{2,}/)
			.map((p) => p.trim())
			.filter(Boolean)
			.map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
			.join('\n');
	}


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
	let showChapterList = $state(false);
	let chapterListContainer = $state<HTMLDivElement | null>(null);
	let chapterListElement = $state<HTMLDivElement | null>(null);
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
	let downloadingChapterId = $state('');
	let downloadedChapterIds = $state(new Set<string>());

	let scrollProgress = $state(0);
	let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;
	let lastSavedChapterKey = $state('');
	let readChapterIds = $state(new Set<string>());
	let readChapterNumbers = $state(new Set<number>());

	function novelMangaId(): string {
		const nid = (novelInfo as { id?: string } | null)?.id || '';
		if (!nid) return '';
		return String(nid).startsWith('/')
			? String(nid)
			: `/${String(nid).replace(/^\/+/, '')}`;
	}

	function refreshReadChapters() {
		const mangaId = novelMangaId();
		if (!source || !mangaId) {
			readChapterIds = new Set();
			readChapterNumbers = new Set();
			return;
		}
		const sets = getReadSets(source, mangaId);
		readChapterIds = sets.ids;
		readChapterNumbers = sets.nums;
	}

	function isReadChapter(chapter: Chapter): boolean {
		const id = chapter.id == null ? '' : String(chapter.id);
		if (id && readChapterIds.has(id)) return true;
		const number = parseChapterNumber(chapter.number, chapter.title, id);
		return number > 0 && readChapterNumbers.has(number);
	}

	function chaptersNewestFirst(): Chapter[] {
		return chapters
			.map((chapter, index) => ({
				chapter,
				index,
				number: parseChapterNumber(chapter.number, chapter.title, String(chapter.id ?? ''))
			}))
			.sort((a, b) => b.number - a.number || a.index - b.index)
			.map(({ chapter }) => chapter);
	}

	$effect(() => {
		if (!showChapterList) return;
		const activeChapterId = String(chapterId).replace(/^\/+/, '');
		void tick().then(() => {
			if (!showChapterList || !chapterListElement) return;
			const activeChapter = [...chapterListElement.querySelectorAll<HTMLElement>('[data-chapter-id]')]
				.find((element) => element.dataset.chapterId === activeChapterId);
			activeChapter?.scrollIntoView({ block: 'nearest' });
		});
	});

	function isOfflineChapter(chId: string, offlineSet: Set<string>): boolean {
		const n = String(chId || '');
		if (!n) return false;
		if (offlineSet.has(n)) return true;
		const alt = n.startsWith('/') ? n.slice(1) : `/${n}`;
		if (offlineSet.has(alt)) return true;
		const seg = n.split('/').filter(Boolean).pop();
		return !!(seg && offlineSet.has(seg));
	}

	function parseChapterNumber(raw: unknown, fallbackTitle?: string, fallbackId?: string): number {
		const tryParse = (s: string): number => {
			const t = String(s || '').replace(/\s+/g, ' ').trim();
			if (!t) return 0;
	
			let m = t.match(/(?:^|\/|[-_])(?:chapter|ch\.?|episode|ep\.?|bab)[-_.]?\s*(\d+(?:\.\d+)?)/i);
			if (m) {
				const n = parseFloat(m[1]);
				if (Number.isFinite(n) && n > 0) return Math.round(n * 10) / 10;
			}
		
			m = t.match(/\b(?:chapter|ch\.?|episode|ep\.?|bab|part|arc)\s*[.\-_]?\s*(\d+(?:\.\d+)?)/i);
			if (m) {
				const n = parseFloat(m[1]);
				if (Number.isFinite(n) && n > 0) return Math.round(n * 10) / 10;
			}
		
			m = t.match(/(?:^|[-_/])(\d+(?:\.\d+)?)(?:\s*$|\.[a-z]+$)/i);
			if (m) {
				const n = parseFloat(m[1]);
				if (Number.isFinite(n) && n > 0 && n < 100000) return Math.round(n * 10) / 10;
			}
	
			if (/^\d+(?:\.\d+)?$/.test(t)) {
				const n = parseFloat(t);
				if (Number.isFinite(n) && n > 0) return Math.round(n * 10) / 10;
			}
			return 0;
		};

		const direct = Number(raw);
		if (Number.isFinite(direct) && direct > 0) return Math.round(direct * 10) / 10;

		for (const candidate of [fallbackTitle, fallbackId]) {
			const n = tryParse(String(candidate || ''));
			if (n > 0) return n;
		}
		return 0;
	}


	async function refreshOfflineStatus() {
		if (!browser || !source || !chapterId) {
			downloadedChapterIds = new Set();
			return;
		}
		try {
			await ensureLibraryLoaded();
			const mid = novelMangaId();
			if (!mid) {
				downloadedChapterIds = new Set();
				return;
			}
			const libraryIds = getOfflineChapterIds(source, mid);
			const savedChapters = await listOfflineNovelChapters(source, mid);
			downloadedChapterIds = new Set([
				...libraryIds,
				...savedChapters.map((chapter) => chapter.chapterId)
			]);
		} catch {
			downloadedChapterIds = new Set();
		}
	}

	$effect(() => {
		source;
		chapterId;
		novelInfo;
		if (browser) void refreshOfflineStatus();
	});


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
		showTools = false;
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
		showTools = false;
	}


	function openTranslatePrompt() {
		if (!content || isTranslating) return;
		if (translatedContent && showTranslated) {
			showTranslated = false;
			showTools = false;
			return;
		}
		if (translatedContent && !showTranslated) {
			showTranslated = true;
			showTools = false;
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


	function looksLikeChapterTitle(s: string): boolean {
		const t = String(s || '').trim();
		if (!t) return true;
		if (/^(chapter|ch\.?|bab|episode|ep\.?|part|arc)\s*[-_.]?\s*\d+/i.test(t)) return true;
		if (/^\d+(\.\d+)?$/.test(t)) return true;
		return false;
	}

	async function downloadChapterFile(chapter: Chapter) {
		const selectedChapterId = String(chapter.id ?? '');
		if (isDownloading || !browser || !selectedChapterId || !source) return;

		isDownloading = true;
		downloadingChapterId = selectedChapterId;
		downloadProgress = 5;
		downloadLabel = 'Preparing…';

		try {
			const rawNovelTitle = (novelInfo as { title?: string } | null)?.title || '';
			const chTitle = chapter.title || `Chapter ${chapter.number ?? ''}`;
			const novelTitle =
				rawNovelTitle && !looksLikeChapterTitle(rawNovelTitle) ? rawNovelTitle : undefined;
			const mangaId = (novelInfo as { id?: string } | null)?.id || '';
			const cover = (novelInfo as { cover?: string } | null)?.cover || '';

			await downloadNovelChapterPdf({
				source,
				chapterId: selectedChapterId,
				chapterTitle: chTitle,
				novelTitle,
				mangaId: mangaId ? String(mangaId) : undefined,
				author: (novelInfo as { author?: string } | null)?.author,
				artist: (novelInfo as { artist?: string } | null)?.artist,
				type: (novelInfo as { type?: string } | null)?.type,
				synopsis: (novelInfo as { description?: string } | null)?.description,
				genres: (novelInfo as { genres?: string[] } | null)?.genres,
				cover: cover || undefined,
				onProgress: (p) => {
					if (p.phase === 'fetch') {
						downloadProgress = 15;
						downloadLabel = p.message || 'Fetching…';
					} else if (p.phase === 'pdf' || p.phase === 'epub') {
						downloadProgress = 45;
						downloadLabel = p.message || (p.phase === 'epub' ? 'Building EPUB…' : 'Building PDF…');
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

			downloadedChapterIds = new Set([...downloadedChapterIds, selectedChapterId]);
			await refreshOfflineStatus();
			await new Promise((r) => setTimeout(r, 600));
		} catch (e) {
			console.error('[novel download]', e);
			downloadLabel = e instanceof Error ? e.message : 'Failed';
			await new Promise((r) => setTimeout(r, 1000));
		} finally {
			isDownloading = false;
			downloadingChapterId = '';
			downloadProgress = 0;
			downloadLabel = '';
		}
	}

	async function goChapter(ch: Chapter | null | undefined) {
		if (!ch?.id || !source) return;
		stopTTS();
		flushScrollProgress();
		stopAutoScroll();
		showTools = false;
		showChapterList = false;
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

	function buildHistoryPayload(progress: number) {
		const nid =
			(novelInfo as { id?: string; title?: string; cover?: string } | null)?.id ||
			chapterId ||
			'';
		const ntitle = (novelInfo as { title?: string } | null)?.title || title || 'Novel';
		const ncover = (novelInfo as { cover?: string } | null)?.cover || '';
		if (!nid || !source) return null;
		const mangaId = String(nid).startsWith('/')
			? String(nid)
			: `/${String(nid).replace(/^\/+/, '')}`;
		const chId = chapterId
			? String(chapterId).startsWith('/')
				? String(chapterId)
				: `/${String(chapterId).replace(/^\/+/, '')}`
			: '';
		if (!chId) return null;
		const chTitle =
			(currentChapter as { title?: string } | null)?.title || title || 'Chapter';
		const chNum = parseChapterNumber(
			(currentChapter as { number?: number } | null)?.number,
			chTitle,
			chId
		);
		return {
			mangaId,
			mangaSlug: '',
			mangaTitle: ntitle,
			cover: ncover,
			chapterId: chId,
			chapterTitle: chTitle,
			chapterNumber: chNum,
			sourceId: source,
			scrollProgress: Math.min(100, Math.max(0, Math.round(progress)))
		};
	}

	function persistReadingProgress(progress: number, markRead = false) {
		if (!browser) return;
		try {
			const payload = buildHistoryPayload(progress);
			if (!payload) return;
			if (markRead) {
				markChapterRead(source, payload.mangaId, payload.chapterId, payload.chapterNumber);
			}
			void saveReading(payload);
		} catch (e) {
			console.warn('[novel-reader] save history failed', e);
		}
	}

	function measureScrollProgress(): number {
		if (!browser) return 0;

		const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
		const viewport = window.innerHeight || document.documentElement.clientHeight || 1;
		const docH = Math.max(
			document.documentElement.scrollHeight || 0,
			document.body?.scrollHeight || 0,
			0
		);
		const maxScroll = docH - viewport;

		if (maxScroll < 80) return 0;
		if (scrollTop >= maxScroll - 64) return 100;

		const el = document.getElementById('novel-content');
		if (el) {
			const rect = el.getBoundingClientRect();
			const scrolledPast = Math.max(0, -rect.top);
			const articleHeight = Math.max(el.scrollHeight, el.offsetHeight, 1);
			const readable = Math.max(1, articleHeight - viewport);
			if (readable >= 80) {
				let pct = (scrolledPast / readable) * 100;
				if (pct > 100) pct = 100;
				return Math.round(pct);
			}
		}

		return Math.min(100, Math.max(0, Math.round((scrollTop / maxScroll) * 100)));
	}

	let scrollTrackingArmed = false;
	let lastScrollTopSeen = 0;

	function onScrollProgress() {
		if (!browser) return;
		const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;

		if (!scrollTrackingArmed) {
			if (Math.abs(scrollTop - lastScrollTopSeen) < 12) {
				lastScrollTopSeen = scrollTop;
				return;
			}
			scrollTrackingArmed = true;
		}

		const pct = measureScrollProgress();
		if (pct <= scrollProgress) return;
		scrollProgress = pct;
		if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
		scrollSaveTimer = setTimeout(() => {
			persistReadingProgress(scrollProgress, false);
		}, 200);
	}

	function flushScrollProgress() {
		if (scrollSaveTimer) {
			clearTimeout(scrollSaveTimer);
			scrollSaveTimer = null;
		}
		if (scrollTrackingArmed && scrollProgress > 0) {
			persistReadingProgress(scrollProgress, false);
		}
	}

	$effect(() => {
		if (!browser) return;
		const key = `${source}::${chapterId}`;
		source;
		chapterId;
		novelInfo;
		currentChapter;
		title;
		if (!source || !chapterId) return;
		if (key === lastSavedChapterKey) return;
		lastSavedChapterKey = key;
		scrollProgress = 0;
		scrollTrackingArmed = false;
		lastScrollTopSeen = browser ? window.scrollY || 0 : 0;
		persistReadingProgress(0, true);
	});

	$effect(() => {
		if (!browser) return;
		const src = String(source || '');
		const cid = String(chapterId || '');
		if (!src || !cid) return;

		window.addEventListener('scroll', onScrollProgress, { passive: true });
		window.addEventListener('beforeunload', flushScrollProgress);
		const onVis = () => {
			if (document.visibilityState === 'hidden') flushScrollProgress();
		};
		document.addEventListener('visibilitychange', onVis);

		const restore = () => {
			try {
				const nid =
					(novelInfo as { id?: string } | null)?.id || chapterId || '';
				const mangaId = String(nid).startsWith('/')
					? String(nid)
					: `/${String(nid).replace(/^\/+/, '')}`;
				const last = getLastRead(mangaId);
				const lastCid = String(last?.chapterId || '').replace(/^\/+|\/+$/g, '');
				const curCid = cid.replace(/^\/+|\/+$/g, '');
				const sp = Number(last?.scrollProgress);
				if (
					last &&
					lastCid === curCid &&
					Number.isFinite(sp) &&
					sp > 2 &&
					sp < 98
				) {
					const doc = document.documentElement;
					const body = document.body;
					const scrollHeight = Math.max(doc.scrollHeight, body.scrollHeight);
					const clientHeight = window.innerHeight || doc.clientHeight || 0;
					const maxScroll = scrollHeight - clientHeight;
					if (maxScroll > 40) {
						window.scrollTo({ top: (sp / 100) * maxScroll, behavior: 'auto' });
						scrollProgress = Math.round(sp);
						scrollTrackingArmed = true;
						lastScrollTopSeen = window.scrollY || 0;
					}
				}
			} catch {
				/* ignore */
			}
		};
		requestAnimationFrame(() => {
			restore();
			setTimeout(restore, 350);
		});

		return () => {
			flushScrollProgress();
			window.removeEventListener('scroll', onScrollProgress);
			window.removeEventListener('beforeunload', flushScrollProgress);
			document.removeEventListener('visibilitychange', onVis);
		};
	});

	
	$effect(() => {
		if (!browser) return;
		const src = String(source || '');
		const cid = String(chapterId || '');
		if (!src || !cid) return;
		let cancelled = false;
		(async () => {
			try {
				const row = await getOfflineNovelChapter(src, cid, {
					novelTitle: String(novelInfo?.title || ''),
					chapterTitle: String(currentChapter?.title || title || ''),
					allowDisk: true
				});
				if (cancelled) return;
				if (row?.content && String(row.content).trim()) {
					offlineContent = row.content;
					offlineNovelMode = true;
					if (row.chapterTitle) {
					}
					return;
				}
			} catch (e) {
				console.warn('[novel-reader] offline', e);
			}
			if (!cancelled) {
				offlineContent = null;
				offlineNovelMode = false;
			}
		})();
		return () => {
			cancelled = true;
		};
	});

onMount(() =>
	subscribePreferences((preferences) => {
		autoDownloadOnRead = preferences.autoDownloadOnRead;
	})
);

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
				if (e.key === 'Escape') showChapterList = false;
				if (e.key === 'ArrowLeft') goChapter(prevChapter);
				if (e.key === 'ArrowRight') goChapter(nextChapter);
			};
			const onPointerDown = (e: PointerEvent) => {
				if (
					showChapterList &&
					chapterListContainer &&
					e.target instanceof Node &&
					!chapterListContainer.contains(e.target)
				) {
					showChapterList = false;
				}
			};
			window.addEventListener('keydown', onKey);
			window.addEventListener('pointerdown', onPointerDown);
			const onLibrary = () => void refreshOfflineStatus();
			const onReadChaptersChanged = () => refreshReadChapters();
			window.addEventListener('library-changed', onLibrary);
			window.addEventListener('read-chapters-changed', onReadChaptersChanged);
			refreshReadChapters();
			void refreshOfflineStatus();
			return () => {
				observer.disconnect();
				window.removeEventListener('keydown', onKey);
				window.removeEventListener('pointerdown', onPointerDown);
				window.removeEventListener('library-changed', onLibrary);
				window.removeEventListener('read-chapters-changed', onReadChaptersChanged);
			};
		}
	});

	onDestroy(() => {
		stopAutoScroll();
		stopTTS();
	});

	$effect(() => {
		if (!browser) return;
		if (offlineNovelMode) return;
		if (!autoDownloadOnRead) return;
		const src = String(source || '');
		const cid = String(chapterId || '');
		const html = String(content || '').trim();
		if (!src || !cid || html.length < 40) return;

		void autoDownloadNovelChapter({
			source: src,
			chapterId: cid,
			chapterTitle: String(title || 'Chapter'),
			novelTitle: (novelInfo as { title?: string } | null)?.title || '',
			mangaId: (novelInfo as { id?: string } | null)?.id || '',
			author: (novelInfo as { author?: string } | null)?.author,
			artist: (novelInfo as { artist?: string } | null)?.artist,
			type: (novelInfo as { type?: string } | null)?.type,
			synopsis: (novelInfo as { description?: string } | null)?.description,
			genres: (novelInfo as { genres?: string[] } | null)?.genres,
			cover: (novelInfo as { cover?: string } | null)?.cover || '',
			content: html
		}).then(() => refreshOfflineStatus());
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
	<DownloadFolderOnboarding />
	<DiskPermissionOverlay
		progress={scrollProgress}
		chapterKey={String(chapterId ?? '')}
	/>
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
			{@html formatNovelHtml(offlineContent ?? content)}
		{/if}
	</article>

	<div
		class="fixed right-0 bottom-0 left-0 z-[100] flex items-center justify-center gap-3 border-0 bg-transparent px-5 py-3 pointer-events-none"
		style="padding-bottom: max(0.75rem, env(safe-area-inset-bottom));"
	>
		<button
			type="button"
			class="pointer-events-auto touch-manipulation flex min-w-[72px] items-center justify-center gap-1 rounded-[14px] border px-3.5 py-2 text-[0.88em] transition disabled:cursor-not-allowed disabled:opacity-30 {isDark
				? 'reader-nav-btn reader-nav-btn-dark'
				: 'reader-nav-btn reader-nav-btn-light'}"
			disabled={!prevChapter}
			aria-label="Previous chapter"
			onclick={() => goChapter(prevChapter)}
		>
			<svg
				viewBox="0 0 24 24"
				width="18" height="18"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<path d="M13 5l-7 7 7 7" />
				<path d="M19 5l-7 7 7 7" opacity="0.6" />
			</svg>
		</button>

		<div class="relative pointer-events-auto" bind:this={chapterListContainer}>
			<button
				type="button"
				class="touch-manipulation flex min-w-[76px] max-w-[min(42vw,13rem)] items-center justify-center gap-1 rounded-[14px] border px-2.5 py-2 text-[0.82em] transition
					{isDark
						? 'reader-nav-btn reader-nav-btn-dark'
						: 'reader-nav-btn reader-nav-btn-light'}"
				aria-label="Open chapter list"
				aria-expanded={showChapterList}
				aria-controls="novel-chapter-list"
				onclick={() => (showChapterList = !showChapterList)}
			>
				<BookOpen class="h-4 w-4 shrink-0" />
				<span class="min-w-0 truncate">{title || 'Chapters'}</span>
				<ChevronDown class="h-3.5 w-3.5 shrink-0 transition {showChapterList ? 'rotate-180' : ''}" />
			</button>

			{#if showChapterList}
				<div
					id="novel-chapter-list"
					bind:this={chapterListElement}
					class="absolute bottom-[calc(100%+0.75rem)] left-1/2 z-[120] max-h-[60vh] w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 overflow-y-auto rounded-xl border shadow-xl
						{isDark ? 'border-white/10 bg-zinc-900/95 text-zinc-100' : 'border-zinc-200 bg-white/95 text-zinc-800'}"
				>
					<div class="sticky top-0 flex items-center justify-between gap-2 border-b px-3 py-2 backdrop-blur
						{isDark ? 'border-white/10 bg-zinc-900/95' : 'border-zinc-200 bg-white/95'}"
					>
						<span class="text-xs font-semibold">Chapter list</span>
					</div>
					{#each chaptersNewestFirst() as chapter, i (`${chapter.id ?? chapter.number ?? chapter.title ?? i}`)}
						<div
							class="relative flex items-center overflow-hidden border-b px-2 last:border-b-0 transition
								{isDark
									? isReadChapter(chapter)
										? 'border-white/5 bg-white/[0.035] text-zinc-500'
										: 'border-white/5'
									: isReadChapter(chapter)
										? 'border-zinc-100 bg-zinc-50 text-zinc-400'
										: 'border-zinc-100'}"
						>
							{#if isDownloading && downloadingChapterId === String(chapter.id ?? '')}
								<div class="absolute inset-x-0 top-0 z-10 h-1 overflow-hidden bg-zinc-800/80">
									<div
										class="h-full bg-emerald-500 transition-all duration-300 ease-out"
										style="width: {downloadProgress}%"
									></div>
								</div>
							{/if}
							<button
								type="button"
								class="min-w-0 flex-1 truncate py-2.5 pr-2 text-left text-sm transition
									{isReadChapter(chapter)
										? 'opacity-60'
										: isDark
											? 'hover:text-violet-300'
											: 'hover:text-violet-600'}
									{String(chapter.id ?? '').replace(/^\/+/, '') === String(chapterId).replace(/^\/+/, '')
										? 'font-semibold text-violet-500'
										: ''}"
								data-chapter-id={String(chapter.id ?? '').replace(/^\/+/, '')}
								aria-current={String(chapter.id ?? '').replace(/^\/+/, '') === String(chapterId).replace(/^\/+/, '')
									? 'page'
									: undefined}
								onclick={() => goChapter(chapter)}
							>
								{chapter.title || `Chapter ${chapter.number ?? ''}`}
							</button>
							{#if isOfflineChapter(String(chapter.id ?? ''), downloadedChapterIds)}
								<span
									class="flex h-8 w-8 shrink-0 items-center justify-center text-emerald-500"
									role="status"
									title="Chapter available offline"
									aria-label="Chapter available offline"
								>
									<WifiOff class="h-4 w-4" />
								</span>
							{/if}
							<button
								type="button"
								class="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition
									{isOfflineChapter(String(chapter.id ?? ''), downloadedChapterIds)
										? 'text-violet-500'
										: isDark
											? 'text-zinc-400 hover:bg-white/10 hover:text-emerald-400'
											: 'text-zinc-500 hover:bg-zinc-100 hover:text-emerald-600'}"
								aria-label="{isOfflineChapter(String(chapter.id ?? ''), downloadedChapterIds) ? 'Chapter sudah diunduh offline' : 'Unduh chapter'}: {chapter.title || `Chapter ${chapter.number ?? ''}`}"
								title={downloadingChapterId === String(chapter.id ?? '')
									? downloadLabel || 'Downloading…'
									: isOfflineChapter(String(chapter.id ?? ''), downloadedChapterIds)
										? 'Sudah offline'
										: 'Unduh chapter'}
								disabled={isDownloading || isOfflineChapter(String(chapter.id ?? ''), downloadedChapterIds)}
								onclick={() => downloadChapterFile(chapter)}
							>
								{#if downloadingChapterId === String(chapter.id ?? '')}
									<span class="text-[9px] font-semibold tabular-nums">{downloadProgress}%</span>
								{:else if isOfflineChapter(String(chapter.id ?? ''), downloadedChapterIds)}
									<Check class="h-4 w-4" strokeWidth={3} />
								{:else}
									<Download class="h-4 w-4" />
								{/if}
							</button>
						</div>
					{:else}
						<p class="px-3 py-4 text-center text-xs opacity-60">No chapters available</p>
					{/each}
				</div>
			{/if}
		</div>

		<button
			type="button"
			class="pointer-events-auto touch-manipulation flex min-w-[72px] items-center justify-center gap-1 rounded-[14px] border px-3.5 py-2 text-[0.88em] transition disabled:cursor-not-allowed disabled:opacity-30 {isDark
				? 'reader-nav-btn reader-nav-btn-dark'
				: 'reader-nav-btn reader-nav-btn-light'}"
			disabled={!nextChapter}
			aria-label="Next chapter"
			onclick={() => goChapter(nextChapter)}
		>
			<svg
				viewBox="0 0 24 24"
				width="18" height="18"
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
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="fixed inset-0 z-[490] bg-transparent"
				onclick={() => (showTools = false)}
				aria-hidden="true"
			></div>
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="relative z-[510] flex flex-col items-center gap-2 rounded-2xl border p-2 shadow-xl
					{isDark ? 'border-white/10 bg-zinc-900/95' : 'border-zinc-200 bg-white/95'}"
				onclick={(e) => e.stopPropagation()}
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
							? 'reader-chapter-active'
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

				<select
					class="touch-manipulation h-8 w-11 rounded-lg border-0 text-[10px] text-center outline-none cursor-pointer appearance-none
						{isDark ? 'bg-zinc-800 text-zinc-200' : 'bg-zinc-100 text-zinc-700'}"
					value={targetLang}
					onchange={(e) => {
						changeLang((e.currentTarget as HTMLSelectElement).value);
						showTools = false;
					}}
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
			class="relative z-[510] touch-manipulation flex h-12 w-12 items-center justify-center rounded-full shadow-lg active:scale-95 transition select-none
				{showTools
				? isDark
					? 'bg-zinc-700 text-white'
					: 'bg-zinc-300 text-zinc-800'
				: 'reader-fab text-white'}"
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
					class="reader-spinner h-10 w-10 animate-spin rounded-full border-4 border-t-transparent"
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
										? 'reader-menu-btn text-white font-medium'
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
						class="reader-menu-btn touch-manipulation flex-1 min-w-[120px] py-2.5 rounded-xl text-white font-medium active:scale-[0.98] transition"
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
								? 'reader-chapter-active font-medium'
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
					class="reader-accent-input w-full mb-4"
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
					class="reader-accent-input w-full mb-4"
				/>

				<label class="block text-sm mb-1 opacity-70" for="max-width">Max width: {maxWidth}px</label>
				<input
					id="max-width"
					type="range"
					min="480"
					max="960"
					step="20"
					bind:value={maxWidth}
					class="reader-accent-input w-full mb-4"
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
					class="reader-accent-input w-full mb-4"
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
					class="reader-accent-input w-full mb-4"
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
										class="reader-section-label px-3 py-1.5 text-xs font-bold uppercase tracking-wider opacity-50 rounded-md my-1"
									>
										🌍 Language: {lang}
									</div>
									{#each langVoices as v (v.voiceURI)}
										<button
											type="button"
											class="w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg text-left transition {ttsVoiceURI ===
											v.voiceURI
												? 'reader-menu-btn text-white font-medium'
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
					class="reader-menu-btn touch-manipulation w-full py-2.5 rounded-xl text-white font-medium transition"
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

	.reader-nav-btn {
		background-color: color-mix(in srgb, var(--accent, #9333ea) 85%, transparent) !important;
		border-color: color-mix(in srgb, var(--accent, #9333ea) 40%, transparent) !important;
		color: #fff !important;
	}
	.reader-nav-btn:hover:not(:disabled),
	.reader-nav-btn:active:not(:disabled) {
		background-color: var(--accent, #9333ea) !important;
	}
	.reader-nav-btn-dark {
		background-color: color-mix(in srgb, var(--accent, #9333ea) 50%, transparent) !important;
		border-color: rgba(255, 255, 255, 0.15) !important;
		color: rgba(255, 255, 255, 0.9) !important;
	}
	.reader-nav-btn-dark:hover:not(:disabled),
	.reader-nav-btn-dark:active:not(:disabled) {
		background-color: color-mix(in srgb, var(--accent, #9333ea) 70%, transparent) !important;
	}
	.reader-menu-btn {
		background-color: var(--accent, #7c3aed) !important;
		color: #fff !important;
		border-color: transparent !important;
		box-shadow: 0 4px 14px color-mix(in srgb, var(--accent, #7c3aed) 25%, transparent);
	}
	.reader-menu-btn:hover,
	.reader-menu-btn:active {
		filter: brightness(1.08);
	}
	.reader-fab {
		background-color: var(--accent, #9333ea) !important;
		color: #fff !important;
	}
	.reader-chapter-active {
		background-color: color-mix(in srgb, var(--accent, #a855f7) 25%, transparent) !important;
		border-color: var(--accent, #a855f7) !important;
		color: var(--accent, #a855f7) !important;
	}
	.reader-accent-input { accent-color: var(--accent, #9333ea); }
	.reader-spinner {
		border-color: var(--accent, #8b5cf6);
		border-top-color: transparent;
	}
	.reader-section-label {
		background-color: color-mix(in srgb, var(--accent, #a855f7) 12%, transparent) !important;
	}
</style>
