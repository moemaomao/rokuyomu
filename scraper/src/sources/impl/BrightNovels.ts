/**
 * BrightNovels.com — Laravel + Inertia.js novel site
 * Path: scraper/src/sources/impl/BrightNovels.ts
 *
 * - Homepage /series list via Inertia data-page
 * - Chapters: GET /series/{slug}/chapters (JSON, all chapters)
 * - Chapter content: Inertia props.chapter.content (HTML)
 * - Banyak chapter premium (price > 0) — free chapters tetap bisa dibaca
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types';

function absUrl(base: string, href: string | undefined): string {
	if (!href) return '';
	if (href.startsWith('//')) return `https:${href}`;
	if (href.startsWith('http')) return href;
	try {
		return new URL(href, base).href;
	} catch {
		return href;
	}
}

function pathOnly(href: string): string {
	try {
		const u = new URL(
			href.startsWith('http')
				? href
				: `https://brightnovels.com${href.startsWith('/') ? '' : '/'}${href}`
		);
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		return href.startsWith('/') ? href : `/${href}`;
	}
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function stripHtml(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>/gi, '\n\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function parseInertia(html: string): any | null {
	const m =
		html.match(/data-page="([^"]+)"/) ||
		html.match(/data-page='([^']+)'/);
	if (!m) return null;
	try {
		const raw = m[1]
			.replace(/&quot;/g, '"')
			.replace(/&#039;/g, "'")
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>');
		return JSON.parse(raw);
	} catch {
	
		try {
			return JSON.parse(decodeURIComponent(m[1].replace(/\+/g, ' ')));
		} catch {
			return null;
		}
	}
}

function coverUrl(cover: any, base: string): string {
	if (!cover) return '';
	if (typeof cover === 'string') return absUrl(base, cover.split('?')[0]);
	const u =
		cover.url ||
		cover.thumbnail_url ||
		cover.medium_url ||
		(cover.path ? `/storage/${cover.path}` : '');
	return absUrl(base, (u || '').split('?')[0]);
}

function mapSeriesCard(s: any, sourceId: string, base: string): Manga | null {
	if (!s?.slug && !s?.id) return null;
	const slug = s.slug || String(s.id);
	const title = (s.title || '').replace(/\s+/g, ' ').trim();
	if (!title) return null;

	let latestChapter: number | undefined;
	if (s.latestChapter) {
		const m = String(s.latestChapter).match(/(\d+(?:\.\d+)?)/);
		if (m) latestChapter = parseFloat(m[1]);
	} else if (s.chapters_count != null) {
		latestChapter = Number(s.chapters_count) || undefined;
	} else if (s.latest_chapter_number != null) {
		latestChapter = Number(s.latest_chapter_number) || undefined;
	}

	const status =
		s.story_state === 'completed' || s.story_state === 'complete'
			? 'Completed'
			: s.story_state === 'hiatus'
				? 'Hiatus'
				: s.story_state
					? 'Ongoing'
					: undefined;

	return {
		id: `/series/${slug}`,
		title,
		cover: coverUrl(s.cover || s.coverImage, base),
		sourceId,
		type: s.type === 'web_novel' || s.type === 'novel' ? 'novel' : s.type || 'novel',
		status,
		lang: 'en',
		...(latestChapter != null ? { latestChapter } : {})
	};
}

export class BrightNovelsSource extends BaseSource {
	id = 'brightnovels';
	name = 'Bright Novels';
	baseUrl = 'https://brightnovels.com';

	async getLatestManga(page = 1): Promise<Manga[]> {
		if (page <= 1) {
			const [home, list] = await Promise.all([
				this.parseHome().catch(() => [] as Manga[]),
				this.fetchSeriesPage(1).catch(() => [] as Manga[])
			]);
			return this.dedupeById([...home, ...list]).slice(0, 30);
		}
		return this.fetchSeriesPage(page);
	}

	private dedupeById(items: Manga[]): Manga[] {
		const seen = new Set<string>();
		const out: Manga[] = [];
		for (const m of items) {
			if (seen.has(m.id)) continue;
			seen.add(m.id);
			out.push(m);
		}
		return out;
	}

	private async parseHome(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		const inertia = parseInertia(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		const buckets = [
			inertia?.props?.latestUpdates,
			inertia?.props?.featuredNovels,
			inertia?.props?.popularEarningsWeek,
			inertia?.props?.popularEarningsMonth
		];

		for (const bucket of buckets) {
			if (!Array.isArray(bucket)) continue;
			for (const s of bucket) {
				const item = mapSeriesCard(s, this.id, this.baseUrl);
				if (item && !seen.has(item.id)) {
					seen.add(item.id);
					list.push(item);
				}
			}
		}

		if (list.length < 8) {
			const $ = cheerio.load(html);
			$('a[href*="/series/"]').each((_, el) => {
				const href = $(el).attr('href') || '';
				const m = href.match(/\/series\/([^/?#]+)/);
				if (!m || /\/series\/[^/]+\/\d/.test(href) || href.includes('/last') || href.includes('/first'))
					return;
				const id = `/series/${m[1]}`;
				if (seen.has(id)) return;
				const title =
					$(el).attr('title') ||
					$(el).find('img').attr('alt') ||
					$(el).text().replace(/\s+/g, ' ').trim();
				if (!title || title.length < 3 || /read now|latest:/i.test(title)) return;
				const img =
					$(el).find('img').attr('src') ||
					$(el).closest('[class*="card"]').find('img').attr('src') ||
					'';
				seen.add(id);
				list.push({
					id,
					title: title.slice(0, 200),
					cover: absUrl(this.baseUrl, (img || '').split('?')[0]),
					sourceId: this.id,
					type: 'novel',
					lang: 'en'
				});
			});
		}

		return list;
	}

	private async fetchSeriesPage(page: number): Promise<Manga[]> {
		const path = page <= 1 ? '/series' : `/series?page=${page}`;
		const html = await this.fetchHtml(path);
		const inertia = parseInertia(html);
		const seriesList = inertia?.props?.seriesList;
		const data = Array.isArray(seriesList?.data)
			? seriesList.data
			: Array.isArray(seriesList)
				? seriesList
				: [];

		const list: Manga[] = [];
		for (const s of data) {
			const item = mapSeriesCard(s, this.id, this.baseUrl);
			if (item) list.push(item);
		}
		return list;
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = encodeURIComponent(query.trim());
		const path =
			page <= 1
				? `/series?search=${q}`
				: `/series?search=${q}&page=${page}`;
		const html = await this.fetchHtml(path);
		const inertia = parseInertia(html);
		const seriesList = inertia?.props?.seriesList;
		const data = Array.isArray(seriesList?.data)
			? seriesList.data
			: Array.isArray(seriesList)
				? seriesList
				: [];

		const list: Manga[] = [];
		for (const s of data) {
			const item = mapSeriesCard(s, this.id, this.baseUrl);
			if (item) list.push(item);
		}
		return list;
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		if (!path.includes('/series/')) {
			path = `/series/${path.replace(/^\//, '')}`;
		}
		path = path.replace(/\/$/, '');

		const html = await this.fetchHtml(path);
		const inertia = parseInertia(html);
		const series = inertia?.props?.series;
		if (!series?.title) {
			throw new Error('Manga not found (empty series)');
		}

		const slug = series.slug || path.split('/').pop() || '';
		const title = String(series.title).replace(/\s+/g, ' ').trim();
		const cover = coverUrl(series.cover, this.baseUrl);

		let description = '';
		if (series.description) {
			description = stripHtml(String(series.description));
		} else if (series.content) {
			description = stripHtml(String(series.content));
		}

		const authors: string[] = [];
		if (series.user?.name) authors.push(series.user.name);
		else if (typeof series.user === 'string') authors.push(series.user);

		const genres: string[] = [];
		if (Array.isArray(series.genres)) {
			for (const g of series.genres) {
				const name = typeof g === 'string' ? g : g?.name;
				if (name && !genres.includes(name)) genres.push(name);
			}
		}

		const status =
			series.story_state === 'completed' || series.story_state === 'complete'
				? 'Completed'
				: series.story_state === 'hiatus'
					? 'Hiatus'
					: 'Ongoing';

		const chapters = await this.fetchAllChapters(slug);

		return {
			id: `/series/${slug}`,
			title,
			cover,
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters,
			type: 'novel',
			lang: 'en'
		};
	}

	/** All chapters via JSON endpoint */
	private async fetchAllChapters(slug: string): Promise<Chapter[]> {
		try {
			const data = await this.fetchJson<{ chapters: any[] }>(
				`/series/${slug}/chapters`
			);
			const raw = Array.isArray(data?.chapters) ? data.chapters : [];
			const out: Chapter[] = [];
			const seen = new Set<string>();

			for (const c of raw) {
				const num = Number(c.number ?? c.index ?? c.slug);
				if (Number.isNaN(num)) continue;
				const id = `/series/${slug}/${c.slug || num}`;
				if (seen.has(id)) continue;
				seen.add(id);

				const title =
					c.name ||
					(c.title ? `Chapter ${num}: ${c.title}` : `Chapter ${num}`);

				out.push({
					id,
					title: String(title).replace(/\s+/g, ' ').trim(),
					number: num,
					date: c.index_at || c.created_at || undefined
				});
			}

			out.sort((a, b) => b.number - a.number);
			return out;
		} catch {
			return [];
		}
	}

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		const path = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
		const html = await this.fetchHtml(path);
		const inertia = parseInertia(html);
		const chapter = inertia?.props?.chapter;
		const series = inertia?.props?.series;
		const prev = inertia?.props?.prevChapter;
		const next = inertia?.props?.nextChapter;

		if (!chapter && !inertia?.props?.isUnlocked) {
		
			const $ = cheerio.load(html);
			const locked =
				$('body').text().toLowerCase().includes('unlock') ||
				$('body').text().toLowerCase().includes('premium');
			if (locked) {
				throw new Error('Chapter is locked / premium on Bright Novels');
			}
		}

		const title =
			chapter?.name ||
			(chapter?.title
				? `Chapter ${chapter.number}: ${chapter.title}`
				: chapter?.number
					? `Chapter ${chapter.number}`
					: 'Chapter');

		let contentHtml = chapter?.content || '';
		if (!contentHtml) {
			const $ = cheerio.load(html);
			const el = $(
				'[class*="chapter-content"], [class*="prose"], article, .content'
			).first();
			el.find('script, style, nav, .ads, .ad').remove();
			contentHtml = el.html() || '';
		}

		let content = contentHtml;
		if (content && !content.includes('<p') && !content.includes('<br')) {
			content = content
				.split(/\n{2,}/)
				.map((p) => `<p>${escapeHtml(p.trim())}</p>`)
				.join('');
		}

		const slug = series?.slug || path.split('/')[2];
		const prevId = prev
			? `/series/${slug}/${prev.slug || prev.number}`
			: null;
		const nextId = next
			? `/series/${slug}/${next.slug || next.number}`
			: null;

		return {
			title: String(title).replace(/\s+/g, ' ').trim(),
			content,
			prevChapterId: prevId,
			nextChapterId: nextId
		};
	}
}

export default BrightNovelsSource;