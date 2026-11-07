/**
 * SaiHiroto (saihiroto.blogspot.com) — Blogger custom theme (novel)
 * Path: scraper/src/sources/impl/novel/SaiHiroto.ts
 *
 * Labels:
 *   Project  → novel detail posts
 *   Chapter  → chapter posts (also tagged with novel title label)
 *
 * Feeds (JSON):
 *   /feeds/posts/default/-/Project?alt=json&max-results=N
 *   /feeds/posts/default/-/Chapter?alt=json&max-results=N&start-index=
 *   /feeds/posts/default/-/{NovelTitle}?alt=json&max-results=150
 *   /feeds/posts/default?alt=json&q={query}
 *
 * Page:
 *   Novel   : /YYYY/MM/{slug}.html  (Project post)
 *   Chapter : /YYYY/MM/cN-...html or chapter-N-...html
 *   Reader  : .l7-reader-content , #l7PrevChapter , #l7NextChapter
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const PAGE_SIZE = 24;

const META_LABELS = new Set([
	'chapter',
	'project',
	'series',
	'ongoing',
	'completed',
	'hiatus',
	'dropped',
	'complete'
]);

type BloggerEntry = {
	id?: { $t?: string };
	published?: { $t?: string };
	updated?: { $t?: string };
	title?: { $t?: string };
	summary?: { $t?: string };
	content?: { $t?: string };
	category?: Array<{ term?: string }>;
	link?: Array<{ rel?: string; href?: string; type?: string }>;
	'media$thumbnail'?: { url?: string };
};

type BloggerFeed = {
	feed?: {
		entry?: BloggerEntry | BloggerEntry[];
		'openSearch$totalResults'?: { $t?: string };
	};
	entry?: BloggerEntry;
};

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
		const u = new URL(href.startsWith('http') ? href : `https://saihiroto.blogspot.com${href}`);
		return u.pathname;
	} catch {
		return href.startsWith('/') ? href : `/${href}`;
	}
}

function entriesOf(data: BloggerFeed): BloggerEntry[] {
	if (data.entry && !data.feed) return [data.entry];
	const e = data.feed?.entry;
	if (!e) return [];
	return Array.isArray(e) ? e : [e];
}

function entryLink(e: BloggerEntry): string {
	const alt = (e.link || []).find((l) => l.rel === 'alternate');
	return alt?.href || '';
}

function entryCats(e: BloggerEntry): string[] {
	return (e.category || []).map((c) => c.term || '').filter(Boolean);
}

function upgradeThumb(url: string | undefined): string {
	if (!url) return '';
	return url.replace(/\/s\d+(-[a-z])?\//i, '/s400/').replace(/=s\d+(-[a-z])?/i, '=s400');
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
		.replace(/&#8211;/g, '–')
		.replace(/&#8217;/g, "'")
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function parseChapterNumber(title: string, fallback: number): number {
	const m =
		title.match(/chapter\s*(\d+(?:\.\d+)?)/i) ||
		title.match(/\bc\s*(\d+(?:\.\d+)?)\b/i) ||
		title.match(/(\d+(?:\.\d+)?)/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function novelTitleFromChapter(title: string, cats: string[]): string {
	const pipe = title.split('|')[0]?.trim();
	if (pipe && !/^chapter\s*\d/i.test(pipe)) return pipe;
	const novelCat = cats.find(
		(c) => !META_LABELS.has(c.toLowerCase()) && !/^chapter\s*\d/i.test(c)
	);
	return novelCat || pipe || title;
}

function genresFromCats(cats: string[], novelTitle?: string): string[] {
	const skip = new Set([...META_LABELS]);
	if (novelTitle) skip.add(novelTitle.toLowerCase());
	const out: string[] = [];
	for (const c of cats) {
		const low = c.toLowerCase();
		if (skip.has(low)) continue;
		if (novelTitle && c === novelTitle) continue;
		if (!out.includes(c)) out.push(c);
	}
	return out;
}

function statusFromCats(cats: string[]): string {
	const low = cats.map((c) => c.toLowerCase());
	if (low.some((c) => c === 'completed' || c === 'complete')) return 'Completed';
	if (low.some((c) => c === 'hiatus')) return 'Hiatus';
	if (low.some((c) => c === 'dropped')) return 'Dropped';
	return 'Ongoing';
}

function formatDate(iso?: string): string | undefined {
	if (!iso) return undefined;
	try {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return undefined;
		return d.toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	} catch {
		return undefined;
	}
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export class SaiHirotoSource extends BaseSource {
	id = 'saihiroto';
	name = 'SaiHiroto';
	baseUrl = 'https://saihiroto.blogspot.com';

	private async feedJson(path: string): Promise<BloggerFeed> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const text = await fetchWithCf(url, {
			headers: {
				...this.headers,
				Accept: 'application/json, text/javascript, */*',
				Referer: this.baseUrl + '/'
			}
		});
		return JSON.parse(text) as BloggerFeed;
	}

	private mapProject(e: BloggerEntry): Manga | null {
		const title = (e.title?.$t || '').replace(/\s+/g, ' ').trim();
		const href = entryLink(e);
		if (!title || !href) return null;
		const cats = entryCats(e);
		const thumb = upgradeThumb(e['media$thumbnail']?.url);
		const cover =
			thumb ||
			(() => {
				const html = e.content?.$t || e.summary?.$t || '';
				const m = html.match(/src="(https:\/\/[^"]+)"/i);
				return m ? upgradeThumb(m[1]) : '';
			})();

		return {
			id: pathOnly(href),
			title,
			cover: absUrl(this.baseUrl, cover),
			sourceId: this.id,
			type: 'novel',
			lang: 'en',
			status: statusFromCats(cats),
			...(e.updated?.$t ? { updatedAt: Date.parse(e.updated.$t) || undefined } : {})
		};
	}

	async getLatestManga(page = 1): Promise<Manga[]> {
		const p = Math.max(1, page);
		try {
			const start = (p - 1) * PAGE_SIZE + 1;
			const data = await this.feedJson(
				`/feeds/posts/default/-/Chapter?alt=json&max-results=${PAGE_SIZE * 3}&start-index=${start}`
			);
			const list: Manga[] = [];
			const seen = new Set<string>();

			for (const e of entriesOf(data)) {
				const title = e.title?.$t || '';
				const cats = entryCats(e);
				const novelName = novelTitleFromChapter(title, cats);
				if (!novelName) continue;
				const key = novelName.toLowerCase();
				if (seen.has(key)) continue;
				seen.add(key);

				const chLink = entryLink(e);
				const num = parseChapterNumber(title, 0);
				const thumb = upgradeThumb(e['media$thumbnail']?.url);

				list.push({
					id: `/label/${encodeURIComponent(novelName)}`,
					title: novelName,
					cover: absUrl(this.baseUrl, thumb),
					sourceId: this.id,
					type: 'novel',
					lang: 'en',
					status: 'Ongoing',
					...(num ? { latestChapter: num } : {}),
					...(e.published?.$t ? { updatedAt: Date.parse(e.published.$t) || undefined } : {})
				});
				if (list.length >= PAGE_SIZE) break;
			}

			if (list.length) {
				const projects = await this.getAllProjects();
				const byTitle = new Map(projects.map((m) => [m.title.toLowerCase(), m]));
				return list.map((m) => {
					const hit = byTitle.get(m.title.toLowerCase());
					if (!hit) return m;
					return {
						...m,
						id: hit.id,
						cover: hit.cover || m.cover,
						status: hit.status || m.status
					};
				});
			}
		} catch {
		}

		return this.listProjects(page);
	}

	private projectCache: { at: number; data: Manga[] } | null = null;

	private async getAllProjects(): Promise<Manga[]> {
		const now = Date.now();
		if (this.projectCache && now - this.projectCache.at < 5 * 60 * 1000) {
			return this.projectCache.data;
		}
		const data = await this.feedJson(
			`/feeds/posts/default/-/Project?alt=json&max-results=50`
		);
		const list = entriesOf(data)
			.map((e) => this.mapProject(e))
			.filter((m): m is Manga => !!m);
		this.projectCache = { at: now, data: list };
		return list;
	}

	private async listProjects(page: number): Promise<Manga[]> {
		const all = await this.getAllProjects();
		const start = (Math.max(1, page) - 1) * PAGE_SIZE;
		return all.slice(start, start + PAGE_SIZE);
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = query.trim();
		if (!q) return [];

		const all = await this.getAllProjects();
		const low = q.toLowerCase();
		const hits = all.filter((m) => m.title.toLowerCase().includes(low));
		if (hits.length) {
			const start = (Math.max(1, page) - 1) * PAGE_SIZE;
			return hits.slice(start, start + PAGE_SIZE);
		}

		const data = await this.feedJson(
			`/feeds/posts/default?alt=json&max-results=${PAGE_SIZE}&q=${encodeURIComponent(q)}`
		);
		const seen = new Set<string>();
		const out: Manga[] = [];
		for (const e of entriesOf(data)) {
			const cats = entryCats(e);
			const title = e.title?.$t || '';
			if (cats.some((c) => c.toLowerCase() === 'project')) {
				const m = this.mapProject(e);
				if (m && !seen.has(m.id)) {
					seen.add(m.id);
					out.push(m);
				}
				continue;
			}
			if (cats.some((c) => c.toLowerCase() === 'chapter')) {
				const novelName = novelTitleFromChapter(title, cats);
				const key = novelName.toLowerCase();
				if (seen.has(key)) continue;
				seen.add(key);
				out.push({
					id: `/label/${encodeURIComponent(novelName)}`,
					title: novelName,
					cover: absUrl(this.baseUrl, upgradeThumb(e['media$thumbnail']?.url)),
					sourceId: this.id,
					type: 'novel',
					lang: 'en'
				});
			}
		}
		return out.slice(0, PAGE_SIZE);
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		let novelTitle = '';
		let project: BloggerEntry | null = null;

		const labelMatch = path.match(/^\/label\/(.+)$/);
		if (labelMatch) {
			novelTitle = decodeURIComponent(labelMatch[1]);
			const projects = await this.getAllProjects();
			const hit = projects.find((p) => p.title.toLowerCase() === novelTitle.toLowerCase());
			if (hit) path = hit.id;
		}

		if (path.includes('.html') || /\/\d{4}\/\d{2}\//.test(path)) {
			const url = absUrl(this.baseUrl, path.startsWith('http') ? path : path);
			const html = await this.fetchHtml(url);
			const $ = cheerio.load(html);
			novelTitle =
				$('h1').first().text().replace(/\s+/g, ' ').trim() ||
				$('title').text().split(/[|\-–]/)[0].trim();

			const all = await this.feedJson(
				`/feeds/posts/default/-/Project?alt=json&max-results=50`
			);
			project =
				entriesOf(all).find((e) => pathOnly(entryLink(e)) === pathOnly(url)) || null;
		} else if (novelTitle) {
			const all = await this.feedJson(
				`/feeds/posts/default/-/Project?alt=json&max-results=50`
			);
			project =
				entriesOf(all).find(
					(e) => (e.title?.$t || '').toLowerCase() === novelTitle.toLowerCase()
				) || null;
			if (project) {
				path = pathOnly(entryLink(project));
			}
		}

		if (!project && path.includes('.html')) {
			const all = await this.feedJson(
				`/feeds/posts/default/-/Project?alt=json&max-results=50`
			);
			project =
				entriesOf(all).find((e) => pathOnly(entryLink(e)) === pathOnly(path)) || null;
		}

		if (!novelTitle && project) novelTitle = project.title?.$t || '';
		if (!novelTitle) throw new Error('Novel not found');

		const cats = project ? entryCats(project) : [];
		const description = stripHtml(project?.content?.$t || project?.summary?.$t || '');
		let cover = upgradeThumb(project?.['media$thumbnail']?.url || '');
		if (!cover && project) {
			const html = project.content?.$t || project.summary?.$t || '';
			const m = html.match(/src="(https:\/\/[^"]+)"/i);
			if (m) cover = upgradeThumb(m[1]);
		}

		const chFeed = await this.feedJson(
			`/feeds/posts/default/-/${encodeURIComponent(novelTitle)}?alt=json&max-results=150`
		);
		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		for (const e of entriesOf(chFeed)) {
			const eCats = entryCats(e);
			if (!eCats.some((c) => c.toLowerCase() === 'chapter')) continue;
			const href = entryLink(e);
			if (!href) continue;
			const id = pathOnly(href);
			if (seen.has(id)) continue;
			seen.add(id);
			const rawTitle = e.title?.$t || '';
			const num = parseChapterNumber(rawTitle, chapters.length + 1);
			chapters.push({
				id,
				title: `Chapter ${num}`,
				number: num,
				date: formatDate(e.published?.$t)
			});
		}
		chapters.sort((a, b) => b.number - a.number);

		const details: MangaDetails = {
			id: pathOnly(path),
			title: novelTitle,
			cover: absUrl(this.baseUrl, cover),
			sourceId: this.id,
			description,
			authors: ['Sai Hiroto'],
			status: statusFromCats(cats),
			genres: genresFromCats(cats, novelTitle),
			chapters,
			type: 'novel',
			lang: 'en'
		};

		return details;
	}

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	private isChapterHref(href: string | undefined): boolean {
		if (!href) return false;
		const h = href.trim();
		if (!h || h === '#' || h.startsWith('javascript')) return false;
		if (!/\/\d{4}\/\d{2}\//.test(h) && !h.includes('.html')) return false;

		return true;
	}

	private async resolveNeighbors(
		currentPath: string,
		novelTitle: string
	): Promise<{ prev: string | null; next: string | null }> {
		try {
			const chFeed = await this.feedJson(
				`/feeds/posts/default/-/${encodeURIComponent(novelTitle)}?alt=json&max-results=150`
			);
			const list: { id: string; number: number }[] = [];
			const seen = new Set<string>();
			for (const e of entriesOf(chFeed)) {
				const eCats = entryCats(e);
				if (!eCats.some((c) => c.toLowerCase() === 'chapter')) continue;
				const href = entryLink(e);
				if (!href || !this.isChapterHref(href)) continue;
				const id = pathOnly(href);
				if (seen.has(id)) continue;
				seen.add(id);
				const num = parseChapterNumber(e.title?.$t || '', list.length + 1);
				list.push({ id, number: num });
			}
			list.sort((a, b) => a.number - b.number);

			const cur = pathOnly(currentPath);
			const idx = list.findIndex((c) => c.id === cur);
			if (idx < 0) {
				const m = cur.match(/(?:c|chapter-?)(\d+)/i);
				if (m) {
					const n = parseFloat(m[1]);
					const byNum = list.findIndex((c) => c.number === n);
					if (byNum >= 0) {
						return {
							prev: byNum > 0 ? list[byNum - 1].id : null,
							next: byNum < list.length - 1 ? list[byNum + 1].id : null
						};
					}
				}
				return { prev: null, next: null };
			}
			return {
				prev: idx > 0 ? list[idx - 1].id : null,
				next: idx < list.length - 1 ? list[idx + 1].id : null
			};
		} catch {
			return { prev: null, next: null };
		}
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		const path = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
		const html = await this.fetchHtml(path.endsWith('.html') ? path : `${path}`);
		const $ = cheerio.load(html);

		const title =
			$('h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('.l7-reader-head').first().text().replace(/\s+/g, ' ').trim() ||
			$('title').text().split(/[|\-–]/)[0].trim() ||
			'Chapter';

		const novelTitle =
			$('.l7-reader-novel').first().text().replace(/\s+/g, ' ').trim() ||
			title.split('|')[0]?.trim() ||
			'';

		const container = $('.l7-reader-content').first();
		let contentHtml = '';
		if (container.length) {
			const clone = container.clone();
			clone.find('script, style, iframe, .ads, .ad, noscript').remove();
			const paras = clone.find('p');
			if (paras.length) {
				const parts: string[] = [];
				paras.each((_, p) => {
					const t = $(p).text().trim();
					if (!t) return;
					if (/ko-fi|watch ad|saihiroto|buy me a coffee/i.test(t)) return;
					parts.push(`<p>${escapeHtml(t)}</p>`);
				});
				contentHtml = parts.join('\n');
			}
			if (!contentHtml) contentHtml = clone.html()?.trim() || '';
		}

		if (!contentHtml || contentHtml.length < 40) {
			const parts: string[] = [];
			$('body p').each((_, p) => {
				const t = $(p).text().trim();
				if (t.length < 20) return;
				if (/ko-fi|watch ad|cookie|privacy|sai hiroto/i.test(t)) return;
				parts.push(`<p>${escapeHtml(t)}</p>`);
			});
			contentHtml = parts.join('\n');
		}

		let prevHref = $('#l7PrevChapter').attr('href') || $('a[id*="Prev"]').attr('href') || '';
		let nextHref = $('#l7NextChapter').attr('href') || $('a[id*="Next"]').attr('href') || '';
		if (!this.isChapterHref(prevHref)) prevHref = '';
		if (!this.isChapterHref(nextHref)) nextHref = '';

		let prevChapterId: string | null = prevHref ? pathOnly(prevHref) : null;
		let nextChapterId: string | null = nextHref ? pathOnly(nextHref) : null;

		if ((!prevChapterId || !nextChapterId) && novelTitle) {
			const nb = await this.resolveNeighbors(path, novelTitle);
			if (!prevChapterId) prevChapterId = nb.prev;
			if (!nextChapterId) nextChapterId = nb.next;
		}

		if (!prevChapterId) prevChapterId = null;
		if (!nextChapterId) nextChapterId = null;

		return {
			title,
			content:
				contentHtml ||
				'<p><em>Konten kosong — selector berubah atau post hanya summary.</em></p>',
			prevChapterId,
			nextChapterId
		};
	}
}

export default SaiHirotoSource;
