import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { remoteNovelChapter, remoteMangaDetails } from '$lib/server/scraperClient';
import { isValidSource } from '$lib/server/sources';
import { isNovelSource } from '$lib/utils/novelSources';

function novelIdFromChapter(chapterId: string): string {
	let path = chapterId.replace(/\/+$/, '');
	if (!path.startsWith('/')) path = '/' + path;
	const parts = path.split('/').filter(Boolean);

	const withSeriesPrefix = (slugOrPath: string): string => {
		const s = slugOrPath.replace(/^\/+/, '');
		if (/^(series|manga|novel|comics|story|book)\//i.test(s)) return `/${s}`;
		return `/series/${s}`;
	};

	const storyIdx = parts.findIndex((p) => /^(chapter|ch|episode|ep|bab)$/i.test(p));
	if (storyIdx > 0 && /^(story|book|series|manga|novel|comics)$/i.test(parts[0])) {
		return '/' + parts.slice(0, storyIdx).join('/');
	}

	if (parts.length >= 2 && /^(series|manga|novel|comics|story|book)$/i.test(parts[0])) {
		const last = parts[parts.length - 1];
		if (
			/^(chapter|ch|episode|ep|bab)[-_.]?\d?/i.test(last) ||
			/^\d+(\.\d+)?$/.test(last) ||
			/[-_]chapter[-_]?\d+/i.test(last) ||
			/^v\d+c\d+/i.test(last) ||
			/[a-z]+-?\d+/i.test(last)
		) {
			return '/' + parts.slice(0, -1).join('/');
		}
		return '/' + parts.join('/');
	}

	if (parts.length >= 2) {
		return withSeriesPrefix(parts[0]);
	}

	if (parts.length === 1) {
		const seg = parts[0];
		if (
			/[-_]chapter[-_]?\d+/i.test(seg) ||
			/[-_]ch[-_]?\d+/i.test(seg) ||
			/[-_]v\d+c\d+/i.test(seg)
		) {
			const slug = seg
				.replace(/[-_](?:chapter|ch)[-_]?\d+.*$/i, '')
				.replace(/[-_]v\d+c\d+.*$/i, '');
			if (slug) return withSeriesPrefix(slug);
		}
	}

	return path;
}

function looksLikeChapterTitle(s: string | undefined | null): boolean {
	const t = String(s || '').trim();
	if (!t) return true;
	if (/^(chapter|ch\.?|bab|episode|ep\.?|part|arc)\s*[-_.]?\s*\d+/i.test(t)) return true;
	if (/^\d+(\.\d+)?$/.test(t)) return true;
	return false;
}

function normalizeCover(cover: string | undefined, sourceId: string): string {
	if (!cover) return '';
	let u = cover.trim();
	if (!u) return '';
	if (u.startsWith('//')) u = 'https:' + u;
	if (/^https?:\/\//i.test(u)) {
		try {
			const parsed = new URL(u);
			if (parsed.hostname && parsed.hostname.includes('.')) return parsed.toString();
		} catch {
			return '';
		}
	}
	if (u.startsWith('/')) return '';
	return '';
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

		const fromScraper =
			(data as { novelId?: string; novelInfo?: { id?: string } }).novelId ||
			data.novelInfo?.id ||
			'';
		const novelPath = fromScraper
			? fromScraper.startsWith('/')
				? fromScraper
				: `/${fromScraper}`
			: novelIdFromChapter(chapterId);

		let novelInfo: { title?: string; id?: string; cover?: string } = {
			...(data.novelInfo ?? {}),
			id: novelPath,
			title: data.novelInfo?.title
		};
		novelInfo.cover = normalizeCover(novelInfo.cover, source);

		const needTitle = !novelInfo.title || looksLikeChapterTitle(novelInfo.title);
		const needCover = !novelInfo.cover;
		const needIdConfirm = true;

		if ((needTitle || needCover || needIdConfirm) && novelPath && novelPath !== '/') {
			try {
				const details = await remoteMangaDetails(source, novelPath);
				if (details) {
					novelInfo = {
						id: details.id || novelInfo.id || novelPath,
						title:
							(details.title && !looksLikeChapterTitle(details.title)
								? details.title
								: novelInfo.title && !looksLikeChapterTitle(novelInfo.title)
									? novelInfo.title
									: details.title) || novelInfo.title,
						cover: normalizeCover(details.cover, source) || novelInfo.cover
					};
				}
			} catch (e) {
				console.warn('[novel-reader] cover/title fetch failed', source, novelPath, e);
			}
		}

		if (!novelInfo.title || looksLikeChapterTitle(novelInfo.title)) {
			const slug = novelPath
				.replace(/^\/+/, '')
				.split('/')
				.filter(Boolean)
				.pop();
			if (slug && !looksLikeChapterTitle(slug)) {
				novelInfo.title = slug
					.replace(/[-_]+/g, ' ')
					.replace(/\b\w/g, (m) => m.toUpperCase());
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
		if (e && typeof e === 'object' && 'status' in e) {
			const st = (e as { status?: number }).status;
			if (st === 302 || st === 301 || st === 307 || st === 308) throw e;
		}
		const msg = e instanceof Error ? e.message : 'Novel chapter load failed';
		console.error('[novel-reader]', source, chapterId, msg);
		return {
			content: '',
			title: 'Offline / unavailable',
			source,
			chapterId,
			novelInfo: { title: '', id: '', cover: '' },
			chapters: [],
			currentChapter: null,
			prevChapter: null,
			nextChapter: null,
			allowOfflineClient: true
		};
	}
};
