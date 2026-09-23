import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

interface NovelChapterResponse {
	content?: string;
	title?: string;
	novelInfo?: { title?: string; id?: string } | null;
	chapters?: { id: string; title: string; number?: number }[];
	currentChapter?: { id: string; title?: string } | null;
	prevChapterId?: string | null;
	nextChapterId?: string | null;
	prevChapter?: { id: string } | null;
	nextChapter?: { id: string } | null;
}

/**
 * Novel reader load — URL: /novel-reader/[source]/[...id]
 */
export const load: PageServerLoad = async ({ params, fetch }) => {
	const source = params.source ?? '';
	const rawId = params.id;
	const chapterId = Array.isArray(rawId)
		? '/' + rawId.join('/')
		: rawId
			? '/' + String(rawId).replace(/^\/+/, '')
			: '';

	if (!source || !chapterId || chapterId === '/') {
		throw error(400, 'source and chapter required');
	}

	const base = env.SCRAPER_BASE_URL || 'http://localhost:3000';
	const headers: Record<string, string> = {};
	if (env.SCRAPER_API_KEY) headers['x-api-key'] = env.SCRAPER_API_KEY;

	try {
		const res = await fetch(`${base}/${source}/novel-chapter${chapterId}`, {
			headers
		});
		if (!res.ok) {
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			throw error(res.status, body.error || 'Failed to load chapter');
		}
		const data = (await res.json()) as NovelChapterResponse;

		return {
			content: data.content || '',
			title: data.title || 'Chapter',
			source,
			chapterId,
			novelInfo: data.novelInfo ?? null,
			chapters: data.chapters ?? [],
			currentChapter: data.currentChapter ?? null,
			prevChapter: data.prevChapterId
				? { id: data.prevChapterId }
				: data.prevChapter ?? null,
			nextChapter: data.nextChapterId
				? { id: data.nextChapterId }
				: data.nextChapter ?? null
		};
	} catch (e: unknown) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		const msg = e instanceof Error ? e.message : 'Novel chapter load failed';
		throw error(500, msg);
	}
};
