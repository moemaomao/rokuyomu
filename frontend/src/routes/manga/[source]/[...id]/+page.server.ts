import { remoteMangaDetails } from '$lib/server/scraperClient';
import { getCached } from '$lib/server/cache';
import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';

const LOAD_TIMEOUT_MS = 12000;
const DETAIL_CACHE_TTL = 600; // 10 menit

const INITIAL_CHAPTERS = 20;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error('load_timeout')), ms);
		promise
			.then((v) => {
				clearTimeout(t);
				resolve(v);
			})
			.catch((e) => {
				clearTimeout(t);
				reject(e);
			});
	});
}

function sortChapters<T extends { number: number }>(list: T[], newestFirst: boolean): T[] {
	return [...list].sort((a, b) => (newestFirst ? b.number - a.number : a.number - b.number));
}

export const load: PageServerLoad = async ({ params, url, setHeaders, locals }) => {
	const sourceId = params.source;
	const idParts = Array.isArray(params.id) ? params.id : [params.id];
	const mangaId = '/' + idParts.filter(Boolean).join('/');
	const lang = (url.searchParams.get('lang') || 'all').toLowerCase();

	if (!sourceId || !mangaId || mangaId === '/') {
		throw error(400, 'Invalid manga path');
	}

	const cacheKey = `manga:${sourceId}:${mangaId}:lang=${lang}`;

	try {
		const full = await getCached(
			cacheKey,
			async () => {
				return await withTimeout(remoteMangaDetails(sourceId, mangaId, lang), LOAD_TIMEOUT_MS);
			},
			DETAIL_CACHE_TTL,
			locals.kv
		);

		if (!full || !full.title) {
			throw error(404, 'Manga tidak ditemukan');
		}

		const allChapters = Array.isArray(full.chapters) ? full.chapters : [];
		const sorted = sortChapters(allChapters, true); // default newest first
		const chapterTotal = sorted.length;
		const initial = sorted.slice(0, INITIAL_CHAPTERS);

		setHeaders({
			'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300'
		});

		return {
			manga: {
				...full,
				chapters: initial
			},
			chapterTotal,
			chapterOffset: initial.length,
			hasMoreChapters: chapterTotal > initial.length,
			source: sourceId,
			selectedLang: lang,
			canonicalUrl: url.href,
			mangaId
		};
	} catch (e: any) {
		console.error('[Manga Detail] load failed:', e);
		if (e?.status) throw e;
		throw error(404, 'Manga tidak ditemukan');
	}
};
