/**
 * Chapter Reader Page - Server Load Function
 * Tidak lagi memakai getSource / adapter lokal.
 */

import { remoteChapterPages, remoteMangaDetails } from '$lib/server/scraperClient';
import { isValidSource } from '$lib/server/sources';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import debug from '$lib/utils/debug';

const ROOT_CHAPTER_PREFIX: Record<string, string> = {
	komiku: '/manga',
	komikindo: '/komik',
	mangaindo: '/manga',
	komikstation: '/manga',
	isekaikomik: '/manga',
	maid: '/manga',
	sektedoujin: '/manga'
};

/** Base URL hardcoded (pengganti adapter.baseUrl) */
const SOURCE_BASE_URL: Record<string, string> = {
	weloma: 'https://weloma.net',
	zonatmo: 'https://zonatmo.org'
};

function parseChapterNum(input: string): number | null {
	const m =
		input.match(/chapter-(\d+)(?:[.-](\d+))?/i) ||
		input.match(/(?:^|\/)(\d+)(?:[.-](\d+))?(?:\/|$)/);
	if (!m) return null;
	if (m[2] != null) return parseFloat(`${m[1]}.${m[2]}`);
	return parseFloat(m[1]);
}

function parseRootChapter(chapterId: string): { slug: string; num: number } | null {
	const m = chapterId.match(
		/^\/(.+?)-chapter-(\d+(?:\.\d+)?)(?:-bahasa-indonesia)?\/?$/i
	);
	if (!m?.[1]) return null;
	const num = parseFloat(m[2]);
	if (!Number.isFinite(num)) return null;
	return { slug: m[1], num };
}

async function resolveMangaId(source: string, chapterId: string): Promise<string> {
	const prefix = ROOT_CHAPTER_PREFIX[source];
	if (prefix) {
		const parsed = parseRootChapter(chapterId);
		if (parsed) return `${prefix}/${parsed.slug}`;

		const fallback = chapterId.replace(/-chapter-\d+(?:[.-]\d+)?\/?$/i, '');
		if (fallback !== chapterId && fallback.length > 1) {
			return `${prefix}/${fallback.replace(/^\//, '')}`;
		}
	}

	const hierarchical = chapterId.replace(
		/\/(chapter|ch|episode|ep)[-/_]?[\d.-]*\/?$/i,
		''
	);
	if (hierarchical !== chapterId && hierarchical.length > 1) {
		return hierarchical;
	}

	// Shinigami: resolve via API
	if (source === 'shinigami' || chapterId.startsWith('/chapter/')) {
		const cid = chapterId.replace(/^\/chapter\//, '').replace(/^\//, '');
		if (cid && /^[a-f0-9-]{36}$/i.test(cid)) {
			try {
				const res = await fetch(
					`https://api.shngm.io/v1/chapter/detail/${encodeURIComponent(cid)}`,
					{
						headers: {
							Accept: 'application/json',
							Origin: 'https://app.shinigami.asia',
							Referer: 'https://app.shinigami.asia/'
						}
					}
				);
				if (res.ok) {
					const json = (await res.json()) as { data?: { manga_id?: string } };
					const mid = json?.data?.manga_id;
					if (mid) return `/series/${mid}`;
				}
			} catch (e) {
				debug.error('[Reader] Failed to resolve Shinigami mangaId:', e);
			}
		}
	}

	// Weloma: fetch HTML chapter page untuk ambil link manga
	if (source === 'weloma' || chapterId.startsWith('/c/')) {
		try {
			const base = SOURCE_BASE_URL.weloma;
			const path = chapterId.startsWith('http') ? chapterId : `${base}${chapterId}`;
			const res = await fetch(path, {
				headers: {
					'User-Agent':
						'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
					Referer: base
				}
			});
			if (res.ok) {
				const html = await res.text();
				const m = html.match(/href="(\/m\/[A-Za-z0-9]+)"/i);
				if (m?.[1]) return m[1];
			}
		} catch (e) {
			debug.error('[Reader] Failed to resolve Weloma mangaId from chapter:', e);
		}
	}

	// ZonaTMO: fetch HTML untuk ambil /library/manga/...
	if (
		source === 'zonatmo' ||
		chapterId.includes('/view_uploads/') ||
		chapterId.includes('/viewer/')
	) {
		try {
			const base = SOURCE_BASE_URL.zonatmo;
			const path = chapterId.startsWith('http')
				? chapterId
				: `${base}${chapterId.startsWith('/') ? '' : '/'}${chapterId}`;

			const res = await fetch(path, {
				headers: {
					'User-Agent':
						'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
					Referer: base,
					'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
				},
				redirect: 'follow'
			});

			if (res.ok) {
				const html = await res.text();
				const m =
					html.match(
						/href=["']((?:https?:\/\/[^"']*)?\/library\/manga\/\d+\/[^"'?#]+)/i
					) || html.match(/["'](\/library\/manga\/\d+\/[^"'?#]+)["']/i);
				if (m?.[1]) {
					let mid = m[1];
					if (mid.startsWith('http')) {
						try {
							mid = new URL(mid).pathname;
						} catch {
							/* keep */
						}
					}
					if (!mid.startsWith('/')) mid = `/${mid}`;
					return mid.split('?')[0].replace(/\/+$/, '');
				}
			}
		} catch (e) {
			debug.error('[Reader] Failed to resolve ZonaTMO mangaId from chapter:', e);
		}
	}

	return hierarchical;
}

function findChapterIndex(
	chapters: { id: string; number?: number }[],
	chapterId: string
): number {
	if (!chapters.length) return -1;

	const norm = (s: string) =>
		`/${(s || '').replace(/^\/+/, '').replace(/\/+$/, '').split('?')[0]}`;

	const target = norm(chapterId);

	let idx = chapters.findIndex((ch) => norm(ch.id) === target);
	if (idx !== -1) return idx;

	idx = chapters.findIndex((ch) => {
		const a = norm(ch.id);
		return a === target || a.endsWith(target) || target.endsWith(a);
	});
	if (idx !== -1) return idx;

	const uploadId = target.match(/\/view_uploads\/(\d+)/i)?.[1];
	if (uploadId) {
		idx = chapters.findIndex((ch) =>
			norm(ch.id).includes(`/view_uploads/${uploadId}`)
		);
		if (idx !== -1) return idx;
	}

	const n = parseChapterNum(chapterId);
	if (n == null) return -1;
	return chapters.findIndex((ch) => Math.abs((ch.number ?? 0) - n) < 0.001);
}

export const load: PageServerLoad = async ({ params, setHeaders }) => {
	const { source, id } = params;
	const chapterId = `/${id}`;

	if (!source || !isValidSource(source)) {
		throw error(404, { message: 'Source not found' });
	}

	try {
		const mangaId = await resolveMangaId(source, chapterId);
		const mangaSlug = mangaId.startsWith('/') ? mangaId.slice(1) : mangaId;

		const [pages, mangaDetails] = await Promise.all([
			remoteChapterPages(source, chapterId),
			remoteMangaDetails(source, mangaId).catch((e) => {
				debug.error(`[Reader] Failed to fetch manga details for ${mangaId}:`, e);
				return null;
			})
		]);

		if (!pages || pages.length === 0) {
			throw error(404, { message: 'Chapter not found or has no pages' });
		}

		const chapters = [...(mangaDetails?.chapters || [])].sort(
			(a, b) => (a.number ?? 0) - (b.number ?? 0)
		);

		const currentChapterIndex = findChapterIndex(chapters, chapterId);
		const currentChapter =
			currentChapterIndex >= 0 ? chapters[currentChapterIndex] : null;
		const prevChapter =
			currentChapterIndex > 0 ? chapters[currentChapterIndex - 1] : null;
		const nextChapter =
			currentChapterIndex >= 0 && currentChapterIndex < chapters.length - 1
				? chapters[currentChapterIndex + 1]
				: null;

		setHeaders({
			'Cache-Control':
				'public, max-age=3600, s-maxage=86400, stale-while-revalidate=300'
		});

		return {
			pages,
			source,
			chapterId,
			mangaInfo: mangaDetails
				? {
						id: mangaDetails.id,
						title: mangaDetails.title,
						cover: mangaDetails.cover,
						slug: mangaSlug
					}
				: {
						id: mangaId,
						title: mangaSlug.replace(/-/g, ' '),
						cover: '',
						slug: mangaSlug
					},
			chapters,
			currentChapter,
			prevChapter,
			nextChapter
		};
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		debug.error(`Failed to fetch chapter ${chapterId} from ${source}:`, e);
		throw error(404, { message: 'Chapter not found' });
	}
};