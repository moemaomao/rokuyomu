/**
 * Deep Search API
 * - Title search (q) across sources
 * - Genre tags: filtered by series genres when available; MangaDex uses official tag UUIDs
 * - tags-only mode: also searches other sources using genre name as keyword query
 *
 * Query params:
 *   q        : title keyword (min 2 chars) — title only, never mixed with tags
 *   tags     : comma-separated genre names
 *   sources  : optional source ids
 *   limit    : default 72, max 200
 *   per      : max per source
 *   type     : all | manga | novel
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Manga } from '$lib/server/sources/types';
import { getSourceList } from '$lib/server/sources';
import { remoteLatest, isWorkerSource } from '$lib/server/scraperClient';
import { readCache } from '$lib/server/cache';
import { NOVEL_SOURCE_IDS, isNovelSource } from '$lib/utils/novelSources';

const DEFAULT_LIMIT = 72;
const MAX_LIMIT = 200;
const DEFAULT_PER = 12;
const MAX_PER = 24;
const CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 6000;

const MANGADEX_TAG_IDS: Record<string, string> = {
	action: '391b0423-d847-456f-aff0-8b0cfc03066b',
	adventure: '87cc87cd-a395-47af-b27a-93258283bbc6',
	comedy: '4d32cc48-9f00-4cca-9b5a-a839f0764984',
	drama: 'b9af3a63-f058-46de-a9a0-e0c13906197a',
	ecchi: '9ab53ae2-2d2d-40ee-a6db-79a46886da45',
	fantasy: 'cdc58593-87dd-415e-bbc0-2ec27bf404cc',
	harem: 'aafb99c1-7f60-43fa-b75f-fc9502ce29c7',
	horror: 'cdad7e68-1419-41dd-bdce-27753074a640',
	isekai: 'ace04997-f6bd-436e-b261-779182193d3d',
	magic: 'a1f53773-c69a-4ce5-8cab-fffcd90b1565',
	'martial arts': '799c202e-7daa-44eb-9cf7-8a3c0441531e',
	mecha: '50880a9d-5440-4732-9afb-8f457127e836',
	mystery: 'ee968100-4191-4968-93d3-f82d72be7e46',
	psychological: '3b60b75c-a2d7-4860-ab56-05f391bb889c',
	romance: '423e2eae-a7a2-4a8b-ac03-a8351462d71d',
	school: 'caaa44eb-cd40-4177-b930-79d3ef2afe87',
	'school life': 'caaa44eb-cd40-4177-b930-79d3ef2afe87',
	'sci-fi': '256c8bd9-4904-4360-bf4f-508a76d67183',
	scifi: '256c8bd9-4904-4360-bf4f-508a76d67183',
	'slice of life': 'e5301a23-ebd9-49dd-a0cb-2add944c7fe9',
	sports: '69964a64-2f90-4d33-beeb-f3ed2875eb4c',
	supernatural: 'eabc5b4c-6aff-42f3-b657-3e90cbd00b75',
	tragedy: 'f8f62932-27da-4fe4-8ee1-6779a8c5edba',
	yuri: 'a3c67850-4684-404e-9b7f-c69850ee5da6',
	'girls love': 'a3c67850-4684-404e-9b7f-c69850ee5da6',
	yaoi: '5920b825-4181-4a17-beeb-9918b0ff7a30',
	"boys' love": '5920b825-4181-4a17-beeb-9918b0ff7a30',
	'boys love': '5920b825-4181-4a17-beeb-9918b0ff7a30'
};

const DEFAULT_MANGA_SOURCES = [
	'mangadex',
	'asura',
	'mangafire',
	'mangakakalot',
	'flamecomics',
	'westmanga',
	'mangabats',
	'komiku',
	'madarascans',
	'omegascans',
	'soulscans',
	'vortexscans',
	'gdscans',
	'ksgroupscans',
	'mangataro',
	'mangasushi',
	'mangaread',
	'komikindo',
	'bacakomik',
	'shinigami'
];

const DEFAULT_NOVEL_SOURCES = [
	'sakuranovel',
	'wetriedtls',
	'dobytranslations',
	'mochistar',
	'raysvault',
	'harishtranslation',
	'nomadtranslations',
	'kaystls',
	'tinytranslation',
	'foxaholic',
	'skydemonorder',
	'storyseedling',
	'novelspyramid',
	'novelshaven',
	'marinetl',
	'rubynovels',
	'lazygirltranslations',
	'redpandatranslations',
	'skynovelvault',
	'fenrirealm',
	'meionovel',
	'noveltoon',
	'bacalightnovel'
];

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error('timeout')), ms);
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

function browseCacheKey(
	sourceId: string,
	page: number,
	q: string,
	lang: string,
	type: string,
	limit: number
): string {
	return `browse:${sourceId}:p${page}:q${q}:l${lang}:t${type}:lim${limit}`;
}

function scoreTitle(title: string, query: string): number {
	const t = (title || '').toLowerCase().trim();
	const q = (query || '').toLowerCase().trim();
	if (!t || !q) return 0;
	if (t === q) return 1000;
	if (t.startsWith(q)) return 800;
	if (t.includes(q)) return 600;
	const qTokens = q.split(/[\s\-_:·,]+/).filter((x) => x.length > 1);
	if (!qTokens.length) return 0;
	let hit = 0;
	let ordered = 0;
	let lastIdx = -1;
	for (const tok of qTokens) {
		const idx = t.indexOf(tok);
		if (idx >= 0) {
			hit++;
			if (idx >= lastIdx) {
				ordered++;
				lastIdx = idx;
			}
		}
	}
	return Math.round((hit / qTokens.length) * 400 + ordered * 20);
}

function normTag(s: string): string {
	return String(s || '')
		.toLowerCase()
		.replace(/^female:\s*/i, '')
		.replace(/^male:\s*/i, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function getItemGenres(m: Manga): string[] {
	const any = m as Manga & { genres?: string[]; tags?: string[] };
	const raw = [...(any.genres || []), ...(any.tags || [])];
	return raw.map(normTag).filter(Boolean);
}

function matchesGenreTag(genres: string[], tag: string): boolean {
	const t = normTag(tag);
	if (!t || !genres.length) return false;
	return genres.some((g) => g === t || g.includes(t) || t.includes(g));
}

function scoreGenres(genres: string[], tags: string[]): number {
	if (!tags.length || !genres.length) return 0;
	let hits = 0;
	for (const tag of tags) {
		if (matchesGenreTag(genres, tag)) hits++;
	}
	return Math.round((hits / tags.length) * 1200 + hits * 80);
}

function resolveMangaDexTagIds(tags: string[]): string[] {
	const ids: string[] = [];
	for (const tag of tags) {
		const key = normTag(tag);
		const id = MANGADEX_TAG_IDS[key];
		if (id && !ids.includes(id)) ids.push(id);
	}
	return ids;
}

async function searchMangaDexByGenres(
	tags: string[],
	titleQuery: string,
	limit: number
): Promise<Manga[]> {
	const tagIds = resolveMangaDexTagIds(tags);
	if (!tagIds.length && !titleQuery) return [];

	const params = new URLSearchParams();
	params.set('limit', String(Math.min(32, Math.max(limit, 12))));
	params.set('offset', '0');
	params.set('order[relevance]', 'desc');
	params.set('contentRating[]', 'safe');
	params.append('contentRating[]', 'suggestive');
	params.append('contentRating[]', 'erotica');
	params.append('includes[]', 'cover_art');
	if (titleQuery) params.set('title', titleQuery);
	for (const id of tagIds) {
		params.append('includedTags[]', id);
	}
	params.set('includedTagsMode', 'AND');

	try {
		const res = await withTimeout(
			fetch(`https://api.mangadex.org/manga?${params.toString()}`, {
				headers: {
					Accept: 'application/json',
					'User-Agent': 'Rokuyomu/1.0'
				}
			}),
			FETCH_TIMEOUT_MS
		);
		if (!res.ok) return [];
		const data = (await res.json()) as { data?: any[] };
		const out: Manga[] = [];
		for (const item of data?.data || []) {
			const attrs = item?.attributes || {};
			const titles = attrs.title || {};
			const title =
				titles.en || titles.ja || titles['ja-ro'] || Object.values(titles)[0] || item.id;
			const tags = (attrs.tags || [])
				.map((t: any) => t?.attributes?.name?.en)
				.filter(Boolean) as string[];
			let cover = '';
			for (const rel of item.relationships || []) {
				if (rel?.type === 'cover_art') {
					const file = rel?.attributes?.fileName;
					if (file) {
						cover = `https://uploads.mangadex.org/covers/${item.id}/${file}.256.jpg`;
					}
				}
			}
			out.push({
				id: `/${item.id}`,
				title: String(title),
				cover,
				sourceId: 'mangadex',
				type: 'manga',
				genres: tags
			} as Manga & { genres: string[] });
		}
		return out;
	} catch (e) {
		console.warn('[deep-search] mangadex genre', e);
		return [];
	}
}

async function searchOneSource(
	sourceId: string,
	query: string,
	per: number,
	kv: KVNamespace | null | undefined
): Promise<Manga[]> {
	const q = query.trim();
	const lang = 'all';
	const type = isNovelSource(sourceId) ? 'novel' : 'all';

	if (isWorkerSource(sourceId)) {
		if (!kv) return [];
		const candidateKeys = [
			browseCacheKey(sourceId, 1, q, lang, type, per),
			browseCacheKey(sourceId, 1, q, lang, type, 6),
			browseCacheKey(sourceId, 1, q, lang, type, 8),
			browseCacheKey(sourceId, 1, q, lang, type, 24),
			browseCacheKey(sourceId, 1, q, 'all', 'all', per),
			browseCacheKey(sourceId, 1, q, 'all', 'all', 24),
			...(q
				? []
				: [
						browseCacheKey(sourceId, 1, '', lang, type, 24),
						browseCacheKey(sourceId, 1, '', 'all', 'all', 24),
						browseCacheKey(sourceId, 1, '', 'all', 'all', 48)
					])
		];
		for (const key of candidateKeys) {
			const cached = await readCache<Manga[]>(key, kv);
			if (Array.isArray(cached) && cached.length > 0) {
				return cached.slice(0, per).map((m) => ({
					...m,
					sourceId: m.sourceId || sourceId,
					type: m.type || (isNovelSource(sourceId) ? 'novel' : m.type)
				}));
			}
		}
		return [];
	}

	try {
		const result = await withTimeout(
			remoteLatest(sourceId, 1, { q: q || undefined, lang, type }),
			FETCH_TIMEOUT_MS
		);
		const list = Array.isArray(result) ? result : [];
		return list.slice(0, per).map((m) => ({
			...m,
			sourceId: m.sourceId || sourceId,
			type: m.type || (isNovelSource(sourceId) ? 'novel' : m.type || 'manga')
		}));
	} catch (e) {
		console.warn(`[deep-search] ${sourceId}:`, e instanceof Error ? e.message : e);
		return [];
	}
}

export const GET: RequestHandler = async ({ url, locals, platform }) => {
	const qRaw = (url.searchParams.get('q') || '').trim();
	const tagsRaw = (url.searchParams.get('tags') || '').trim();
	const sourcesParam = (url.searchParams.get('sources') || '').trim();
	const typeFilter = (url.searchParams.get('type') || 'all').toLowerCase();
	const limit = Math.min(
		MAX_LIMIT,
		Math.max(1, parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
	);
	const per = Math.min(
		MAX_PER,
		Math.max(1, parseInt(url.searchParams.get('per') || String(DEFAULT_PER), 10) || DEFAULT_PER)
	);

	if (qRaw.length < 2 && !tagsRaw) {
		return json(
			{ results: [], meta: { error: 'q or tags required (min 2 chars)' } },
			{ status: 400 }
		);
	}

	const tagParts = tagsRaw
		? tagsRaw
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean)
		: [];
	const query = qRaw.trim();
	const tagsOnly = !query && tagParts.length > 0;

	const allIds = new Set(getSourceList().map((s) => s.id));
	for (const id of NOVEL_SOURCE_IDS) allIds.add(id);

	let sourceIds: string[];
	if (sourcesParam) {
		sourceIds = sourcesParam
			.split(',')
			.map((s) => s.trim())
			.filter((id) => allIds.has(id));
	} else {
		const mangaPreferred = DEFAULT_MANGA_SOURCES.filter((id) => allIds.has(id));
		const novelPreferred = DEFAULT_NOVEL_SOURCES.filter((id) => allIds.has(id));
		const workerIds = [...allIds].filter((id) => isWorkerSource(id));
		if (typeFilter === 'novel') {
			sourceIds = [...new Set([...novelPreferred, ...workerIds.filter((id) => isNovelSource(id))])];
		} else if (typeFilter === 'manga') {
			sourceIds = [
				...new Set([
					...mangaPreferred,
					...workerIds.filter((id) => !isNovelSource(id)).slice(0, 10)
				])
			];
		} else {
			sourceIds = [
				...new Set([
					...novelPreferred.slice(0, 16),
					...mangaPreferred.slice(0, 16),
					...workerIds.slice(0, 10)
				])
			];
		}
	}

	const kv =
		(locals as { kv?: KVNamespace | null })?.kv ??
		(platform?.env as { MIKOROKU_CACHE?: KVNamespace } | undefined)?.MIKOROKU_CACHE ??
		null;

	const lists: Manga[][] = [];

	if (tagParts.length > 0 && typeFilter !== 'novel') {
		const md = await searchMangaDexByGenres(tagParts, query, limit);
		if (md.length) lists.push(md);
	}

	const searchQ = query || (tagsOnly ? tagParts.join(' ') : '');
	if (searchQ || tagsOnly) {
		const ids = sourceIds.filter((id) => id !== 'mangadex' || !tagParts.length);
		for (let i = 0; i < ids.length; i += CONCURRENCY) {
			const batch = ids.slice(i, i + CONCURRENCY);
			const batchResults = await Promise.all(
				batch.map((id) => searchOneSource(id, searchQ, per, kv))
			);
			lists.push(...batchResults);
		}
	}

	const seen = new Set<string>();
	const scored: Array<Manga & { _score: number }> = [];

	for (const list of lists) {
		for (const m of list) {
			const key = `${m.sourceId ?? ''}:${m.id}`;
			if (seen.has(key)) continue;
			seen.add(key);

			const kind = (m.type || (isNovelSource(m.sourceId) ? 'novel' : 'manga')).toLowerCase();
			if (typeFilter === 'novel' && kind !== 'novel') continue;
			if (typeFilter === 'manga' && kind === 'novel') continue;

			const genres = getItemGenres(m);
			const genreScore = scoreGenres(genres, tagParts);
			const titleScore = searchQ ? scoreTitle(m.title || '', searchQ) : 0;

			if (tagParts.length > 0) {
				if (genres.length > 0) {
					const allMatch = tagParts.every((t) => matchesGenreTag(genres, t));
					if (!allMatch) continue;
				} else if (tagsOnly) {
				} else if (query.length >= 2 && titleScore < 200) {
					continue;
				}
			}

			if (searchQ.length >= 2 && titleScore < 40 && genreScore === 0) continue;

			const score =
				genreScore +
				titleScore +
				(m.sourceId === 'mangadex' && genreScore > 0 ? 150 : 0) +
				(tagsOnly && genres.length === 0 ? -300 : 0);

			scored.push({
				...m,
				type: kind === 'novel' ? 'novel' : m.type || 'manga',
				_score: score
			});
		}
	}

	scored.sort((a, b) => b._score - a._score || (a.title || '').localeCompare(b.title || ''));
	const results: Manga[] = scored.slice(0, limit).map(({ _score, ...m }) => m);

	return json(
		{
			results,
			meta: {
				query: query || (tagsOnly ? `(genre: ${tagParts.join(', ')})` : ''),
				tags: tagParts,
				tagsOnly,
				type: typeFilter,
				sourcesTried: sourceIds.length,
				returned: results.length,
				workerKvOnly: true
			}
		},
		{ headers: { 'Cache-Control': 'private, max-age=30' } }
	);
};
