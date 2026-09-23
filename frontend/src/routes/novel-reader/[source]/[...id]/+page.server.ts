import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { remoteNovelChapter } from '$lib/server/scraperClient';
import { isValidSource } from '$lib/server/sources';
import { isNovelSource } from '$lib/utils/novelSources';

export const load: PageServerLoad = async ({ params }) => {
	const source = params.source ?? '';
	const rawId = params.id;
	const chapterId = Array.isArray(rawId)
		? '/' + rawId.filter(Boolean).join('/')
		: rawId
			? '/' + String(rawId).replace(/^\/+/, '')
			: '';

	if (!source || !isValidSource(source)) {
		throw error(404, 'Source not found');
	}
	if (!chapterId || chapterId === '/') {
		throw error(400, 'Chapter id required');
	}
	if (!isNovelSource(source)) {
		// Non-novel should use /reader/
		throw error(400, 'Not a novel source — use /reader/');
	}

	try {
		const data = await remoteNovelChapter(source, chapterId);

		if (!data?.content) {
			throw error(404, 'Chapter not found or empty');
		}

		return {
			content: data.content,
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
		console.error('[novel-reader]', source, chapterId, msg);
		throw error(404, msg);
	}
};
