import {
	remoteChapterPages,
	remoteMangaDetails,
	remoteMangaFromChapter
} from '$lib/server/scraperClient';
import { isValidSource } from '$lib/server/sources';
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import debug from '$lib/utils/debug';
import { isNovelSource } from '$lib/utils/novelSources';

const ROOT_CHAPTER_PREFIX: Record<string, string> = {
	komiku: '/manga',
	komikindo: '/komik',
	mangaindo: '/manga',
	komikstation: '/manga',
	isekaikomik: '/manga',
	maid: '/manga',
	sektedoujin: '/manga',
	athreascans: '/manga',
	violetmanga: '/comics',
	thunderscans: '/comics',
	// Themesia manga (chapter at /{slug}-chapter-N, series at /manga/{slug})
	ngomik: '/manga',
	kiryuu: '/manga',
	manhwadesu: '/manga',
	manhwaindo: '/manga',
	siikomik: '/manga',
	areakomik: '/manga',
	softkomik: '/manga',
	bacakomik: '/manga',
	holodek: '/manga',
	lumos: '/manga',
	luvyaa: '/manga',
	crotpedia: '/manga'
};

const NEEDS_REMOTE_MANGA_RESOLVE = new Set([
  'weloma',
  'zonatmo',
  'artlapsa',
  'luacomic',
  'rokaricomics'
]);

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

async function resolveMangaId(
	source: string,
	chapterId: string,
	explicitMangaId?: string | null
): Promise<string> {
	if (explicitMangaId?.trim()) {
		const id = explicitMangaId.trim();
		return id.startsWith('/') ? id : `/${id.replace(/^\/+/, '')}`;
	}

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
				debug.error('[Reader] Shinigami resolve failed:', e);
			}
		}
	}

	if (
		NEEDS_REMOTE_MANGA_RESOLVE.has(source) ||
		chapterId.startsWith('/c/') ||
		chapterId.includes('/view_uploads/') ||
		chapterId.includes('/viewer/')
	) {
		const resolved = await remoteMangaFromChapter(source, chapterId);
		if (resolved) return resolved;
	}

	const rootParsed = parseRootChapter(chapterId);
	if (rootParsed?.slug) {
		const prefix = ROOT_CHAPTER_PREFIX[source];
		if (prefix) return `${prefix}/${rootParsed.slug}`;
		return `/manga/${rootParsed.slug}`;
	}

	return hierarchical.length > 1 ? hierarchical : chapterId;
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

export const load: PageServerLoad = async ({ params, url, setHeaders }) => {
	const { source, id } = params;
	const chapterId = `/${Array.isArray(id) ? id.join('/') : id}`;

	if (!source || !isValidSource(source)) {
		throw error(404, { message: 'Source not found' });
	}

	if (isNovelSource(source)) {
		const path = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
		throw redirect(302, `/novel-reader/${source}${path}`);
	}

	try {
		const explicitManga = url.searchParams.get('manga');
		const mangaId = await resolveMangaId(source, chapterId, explicitManga);
		const mangaSlug = mangaId.startsWith('/') ? mangaId.slice(1) : mangaId;

		const [pages, mangaDetails] = await Promise.all([
			remoteChapterPages(source, chapterId),
			remoteMangaDetails(source, mangaId).catch((e) => {
				debug.error(`[Reader] manga details failed for ${mangaId}:`, e);
				return null;
			})
		]);

		if (!pages || pages.length === 0) {
			throw error(404, { message: 'Chapter not found or has no pages' });
		}

		const chapters = [...(mangaDetails?.chapters || [])].sort(
			(a, b) => (a.number ?? 0) - (b.number ?? 0)
		);

		let currentChapterIndex = findChapterIndex(chapters, chapterId);
		let currentChapter =
			currentChapterIndex >= 0 ? chapters[currentChapterIndex] : null;
		let prevChapter =
			currentChapterIndex > 0 ? chapters[currentChapterIndex - 1] : null;
		let nextChapter =
			currentChapterIndex >= 0 && currentChapterIndex < chapters.length - 1
				? chapters[currentChapterIndex + 1]
				: null;

		if ((!prevChapter && !nextChapter) || currentChapterIndex < 0) {
			const parsed = parseRootChapter(chapterId);
			if (parsed) {
				const { slug, num } = parsed;
				if (!currentChapter) {
					currentChapter = {
						id: chapterId,
						title: `Chapter ${num}`,
						number: num
					};
				}
				if (!prevChapter && num > 1) {
					const prevNum = Number.isInteger(num) ? num - 1 : Math.floor(num);
					const p = num - 1;
					if (p >= 1) {
						prevChapter = {
							id: `/${slug}-chapter-${p}`,
							title: `Chapter ${p}`,
							number: p
						};
					}
				}
				if (!nextChapter) {
					const n = num + 1;
					nextChapter = {
						id: `/${slug}-chapter-${n}`,
						title: `Chapter ${n}`,
						number: n
					};
				}
			}
		}

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
		if (e && typeof e === 'object' && 'status' in e) {
			const st = (e as { status?: number }).status;
			if (st === 302 || st === 301 || st === 307 || st === 308) throw e;
		}
		debug.error(`Failed to fetch chapter ${chapterId} from ${source}:`, e);
		const id = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
		return {
			pages: [] as string[],
			source,
			chapterId: id,
			mangaInfo: {
				id: '',
				title: 'Offline / unavailable',
				cover: '',
				slug: ''
			},
			chapters: [],
			currentChapter: { id, title: 'Chapter', number: 0 },
			prevChapter: null,
			nextChapter: null,
			allowOfflineClient: true
		};
	}
};