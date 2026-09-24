import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { remoteNovelChapter, remoteMangaDetails } from '$lib/server/scraperClient';
import { isValidSource } from '$lib/server/sources';
import { isNovelSource } from '$lib/utils/novelSources';

function novelIdFromChapter(chapterId: string): string {
	const parts = chapterId
		.replace(/\/+$/, '')
		.split('/')
		.filter(Boolean);
	if (parts.length < 2) {
		return chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
	}
	const last = parts[parts.length - 1];
	
	if (/^(chapter|ch|episode|ep|bab)[-_]?\d?/i.test(last) || /[-_]\d+$/.test(last)) {
		return '/' + parts.slice(0, -1).join('/');
	}
	
	if (/^\d+(\.\d+)?$/.test(last)) {
		return '/' + parts.slice(0, -1).join('/');
	}
	return '/' + parts.slice(0, -1).join('/');
}

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
		throw error(400, 'Not a novel source — use /reader/');
	}

	try {
		const data = await remoteNovelChapter(source, chapterId);

		if (!data?.content) {
			throw error(404, 'Chapter not found or empty');
		}

		const novelPath = novelIdFromChapter(chapterId);
		let novelInfo: {
			title?: string;
			id?: string;
			cover?: string;
		} = {
			...(data.novelInfo ?? {}),
			id: data.novelInfo?.id || novelPath,
			title: data.novelInfo?.title
		};

		if (!novelInfo.cover && novelPath && novelPath !== '/') {
			try {
				const details = await remoteMangaDetails(source, novelPath);
				if (details) {
					novelInfo = {
						id: details.id || novelInfo.id || novelPath,
						title: details.title || novelInfo.title,
						cover: details.cover || ''
					};
				}
			} catch (e) {
				console.warn('[novel-reader] cover fetch failed', source, novelPath, e);
			}
		}

		return {
			content: data.content,
			title: data.title || 'Chapter',
			source,
			chapterId,
			novelInfo,
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
