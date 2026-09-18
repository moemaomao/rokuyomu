import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { remoteChapterPages } from '$lib/server/scraperClient';
import { getCached } from '$lib/server/cache';

const PAGES_CACHE_TTL = 1800;

export const GET: RequestHandler = async ({ url }) => {
	const source = url.searchParams.get('source');
	const chapterId = url.searchParams.get('chapterId');
	const start = Math.max(0, parseInt(url.searchParams.get('start') || '0', 10));
	const count = Math.min(Math.max(1, parseInt(url.searchParams.get('count') || '40', 10)), 60);

	if (!source || !chapterId) {
		throw error(400, 'source and chapterId are required');
	}

	const cacheKey = `pages:${source}:${chapterId}:start=${start}:count=${count}`;

	try {
		const result = await getCached(
			cacheKey,
			async () => {
				const allPages = await remoteChapterPages(source, chapterId);
				const sliced = allPages.slice(start, start + count);

				return {
					pages: sliced,
					total: allPages.length,
					hasMore: start + count < allPages.length
				};
			},
			PAGES_CACHE_TTL
		);

		return json(result);
	} catch (e: any) {
		console.error('[api/pages] error:', e);
		throw error(500, e?.message || 'Failed to load pages');
	}
};
