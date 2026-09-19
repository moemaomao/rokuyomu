import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { remoteMangaDetails } from '$lib/server/scraperClient';
import { getCached } from '$lib/server/cache';
import type { Chapter, MangaDetails } from '$lib/server/sources/types';

const DETAIL_CACHE_TTL = 600;
const MAX_LIMIT = 50;

function sortChapters(list: Chapter[], newestFirst: boolean): Chapter[] {
	return [...list].sort((a, b) => (newestFirst ? b.number - a.number : a.number - b.number));
}

/**
 * GET /api/chapters?source=&id=&lang=&offset=&limit=&sort=newest|oldest
 *
 * Membaca full detail dari KV (atau scrape sekali lalu cache),
 * lalu mengembalikan slice chapter saja — hemat payload ke browser.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const source = url.searchParams.get('source')?.trim();
	const rawId = url.searchParams.get('id')?.trim();
	const lang = (url.searchParams.get('lang') || 'all').toLowerCase();
	const sort = (url.searchParams.get('sort') || 'newest').toLowerCase();
	const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
	const limit = Math.min(
		MAX_LIMIT,
		Math.max(1, parseInt(url.searchParams.get('limit') || '30', 10) || 30)
	);

	if (!source || !rawId) {
		throw error(400, 'source and id are required');
	}

	const mangaId = rawId.startsWith('/') ? rawId : `/${rawId.replace(/^\/+/, '')}`;
	const cacheKey = `manga:${source}:${mangaId}:lang=${lang}`;
	const newestFirst = sort !== 'oldest';

	try {
		const full = await getCached<MangaDetails>(
			cacheKey,
			() => remoteMangaDetails(source, mangaId, lang),
			DETAIL_CACHE_TTL,
			locals.kv
		);

		const all = Array.isArray(full?.chapters) ? full.chapters : [];
		const sorted = sortChapters(all, newestFirst);
		const slice = sorted.slice(offset, offset + limit);
		const total = sorted.length;

		return json({
			chapters: slice,
			total,
			offset,
			limit,
			hasMore: offset + slice.length < total,
			sort: newestFirst ? 'newest' : 'oldest'
		});
	} catch (e: any) {
		console.error('[api/chapters]', source, mangaId, e);
		throw error(500, e?.message || 'Failed to load chapters');
	}
};
