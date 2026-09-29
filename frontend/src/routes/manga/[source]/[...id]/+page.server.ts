import { remoteMangaDetails } from '$lib/server/scraperClient';
import { getCached } from '$lib/server/cache';
import {
	fallbackMangaDetails,
	toMetaOnly,
	readSourceBackup,
	saveSourceBackup
} from '$lib/server/backupMeta';
import type { PageServerLoad } from './$types';
import type { MangaDetails } from '$lib/server/sources/types';
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

/** Merge metadata detail (description/genres/authors) ke backup JSON besar */
async function mergeDetailIntoBackup(
	sourceId: string,
	full: MangaDetails,
	kv: KVNamespace
) {
	const bak = await readSourceBackup(sourceId, kv);
	const meta = toMetaOnly(full, sourceId);
	if (!bak) {
		await saveSourceBackup(sourceId, [meta], kv);
		return;
	}
	const norm = (s: string) => s.replace(/^\/+/, '').toLowerCase();
	const want = norm(meta.id);
	const idx = bak.items.findIndex((m) => norm(m.id) === want);
	if (idx >= 0) {
		bak.items[idx] = { ...bak.items[idx], ...meta };
	} else {
		bak.items.unshift(meta);
		if (bak.items.length > 200) bak.items = bak.items.slice(0, 200);
	}
	await saveSourceBackup(sourceId, bak.items, kv);
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

		// Merge metadata ke backup (description/genres/authors), tanpa chapters
		if (locals.kv) {
			mergeDetailIntoBackup(sourceId, full, locals.kv).catch(() => {});
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
			mangaId,
			fromBackup: false
		};
	} catch (e: any) {
		console.error('[Manga Detail] load failed:', e);

		// Jangan override error valid selain 404 / network
		if (e?.status && e.status !== 404) throw e;

		const fb = await fallbackMangaDetails(sourceId, mangaId, locals.kv);
		if (fb) {
			console.warn(`[Manga Detail] ${sourceId}${mangaId} using backup`);
			setHeaders({
				'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120'
			});
			return {
				manga: {
					...fb,
					chapters: []
				},
				chapterTotal: 0,
				chapterOffset: 0,
				hasMoreChapters: false,
				source: sourceId,
				selectedLang: lang,
				canonicalUrl: url.href,
				mangaId,
				fromBackup: true
			};
		}

		if (e?.status) throw e;
		throw error(404, 'Manga tidak ditemukan');
	}
};