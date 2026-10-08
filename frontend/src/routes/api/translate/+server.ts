import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const MODELS = [
	'gemini-3.5-flash-lite',
	'gemini-3.5-flash',
	'gemini-3.8-flash'
];

interface TranslateBody {
	text?: string;
	targetLang?: string;
	cacheKey?: string;
	prompt?: string;
}

interface GeminiResponse {
	candidates?: Array<{
		content?: {
			parts?: Array<{ text?: string }>;
		};
	}>;
	error?: { message?: string; code?: number; status?: string };
}

const LANG_NAMES: Record<string, string> = {
	id: 'Indonesia',
	en: 'English',
	ja: 'Japanese',
	ko: 'Korean',
	zh: 'Chinese (Simplified)',
	es: 'Spanish',
	fr: 'French',
	de: 'German',
	pt: 'Portuguese',
	ru: 'Russian',
	th: 'Thai',
	vi: 'Vietnamese'
};

const DEFAULT_TRANSLATE_PROMPT = `Kamu adalah penerjemah profesional light novel.
Terjemahkan teks berikut ke bahasa {{lang}} dengan gaya natural, enak dibaca, dan tetap menjaga nuansa cerita.
Jangan tambahkan penjelasan, catatan, atau komentar apapun. Hanya kembalikan hasil terjemahan saja.

Teks:
{{text}}`;

function buildPrompt(
	template: string,
	langName: string,
	content: string
): string {
	return template
		.replaceAll('{{lang}}', langName)
		.replaceAll('{{text}}', content);
}

export const POST: RequestHandler = async ({ request, platform }) => {
	let body: TranslateBody;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const { text, targetLang = 'id', cacheKey, prompt: userPrompt } = body;

	if (!text || typeof text !== 'string') {
		throw error(400, 'Text is required');
	}

	const apiKey =
		env.GEMINI_API_KEY ||
		(platform?.env as { GEMINI_API_KEY?: string } | undefined)?.GEMINI_API_KEY;

	if (!apiKey) {
		throw error(500, 'GEMINI_API_KEY not configured');
	}

	const kv = (platform?.env as { MIKOROKU_CACHE?: KVNamespace } | undefined)?.MIKOROKU_CACHE;

	let effectiveCacheKey = cacheKey;
	if (kv && cacheKey && userPrompt && userPrompt !== DEFAULT_TRANSLATE_PROMPT) {
		const h = Array.from(userPrompt)
			.reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)
			.toString(36);
		effectiveCacheKey = `${cacheKey}:p${h}`;
	}

	if (kv && effectiveCacheKey) {
		const cached = await kv.get(`translate:${effectiveCacheKey}`);
		if (cached) {
			return json({ translated: cached, cached: true });
		}
	}

	const maxChars = 14000;
	const content =
		text.length > maxChars ? text.slice(0, maxChars) + '\n\n[...terpotong]' : text;

	const langName = LANG_NAMES[targetLang] || targetLang;
	const template =
		typeof userPrompt === 'string' && userPrompt.trim().length > 0
			? userPrompt
			: DEFAULT_TRANSLATE_PROMPT;

	let prompt = buildPrompt(template, langName, content);
	if (!template.includes('{{text}}')) {
		prompt = `${prompt}\n\nTeks:\n${content}`;
	}

	let lastError = 'Semua model gagal';

	for (const model of MODELS) {
		try {
			const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

			const res = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-goog-api-key': apiKey
				},
				body: JSON.stringify({
					contents: [{ parts: [{ text: prompt }] }],
					generationConfig: {
						temperature: 0.3,
						maxOutputTokens: 8192
					}
				})
			});

			const raw = await res.text();
			let data: GeminiResponse;
			try {
				data = JSON.parse(raw);
			} catch {
				lastError = `Invalid JSON from ${model}`;
				continue;
			}

			if (!res.ok) {
				lastError = data?.error?.message || `${model} error ${res.status}`;
				console.warn(`[translate] ${model} failed:`, lastError);
				await new Promise((r) => setTimeout(r, 800));
				continue;
			}

			const translated = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
			if (!translated) {
				lastError = `${model} returned empty`;
				continue;
			}

			if (kv && effectiveCacheKey) {
				await kv.put(`translate:${effectiveCacheKey}`, translated, {
					expirationTtl: 60 * 60 * 24 * 7
				});
			}

			return json({ translated, model, cached: false });
		} catch (e) {
			lastError = e instanceof Error ? e.message : String(e);
			console.warn(`[translate] ${model} exception:`, lastError);
		}
	}

	throw error(502, lastError);
};
