/**
 * MilousArchive.com — WordPress (Kadence / Retrospect)
 * Path: scraper/src/sources/impl/novel/MilousArchive.ts
 *
 * Structure:
 *   Homepage Recent Updates : chapter links grouped by series
 *   All novels              : WP categories + pages
 *   Series page             : /{slug}/  (TOC + meta)
 *   Chapter                 : /{series}/{series}-chapter-{n}/
 *
 * WP REST:
 *   /wp-json/wp/v2/posts?orderby=date
 *   /wp-json/wp/v2/categories
 *   /wp-json/wp/v2/pages
 *   /wp-json/wp/v2/posts?categories={id}&per_page=100
 *   /wp-json/wp/v2/media/{id}
 *   /wp-json/wp/v2/posts?slug={chapter-slug}
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://milousarchive.com';
const API = `${BASE}/wp-json/wp/v2`;
const PER_PAGE = 24;
const CACHE_MS = 60 * 60_000; // 1h

type WpCategory = {
	id: number;
	count: number;
	name: string;
	slug: string;
	link?: string;
	description?: string;
};

type WpPage = {
	id: number;
	slug: string;
	link: string;
	title: { rendered: string };
	featured_media?: number;
	content?: { rendered: string };
};

type WpPost = {
	id: number;
	slug: string;
	link: string;
	date?: string;
	title: { rendered: string };
	content?: { rendered: string };
	categories?: number[];
};

function pathOnly(href: string): string {
	try {
		const u = new URL(
			href.startsWith('http')
				? href
				: `${BASE}${href.startsWith('/') ? '' : '/'}${href}`
		);
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		return href.startsWith('/') ? href.replace(/\/$/, '') || '/' : `/${href}`;
	}
}

function cleanText(s: string): string {
	return (s || '')
		.replace(/&#8217;/g, "'")
		.replace(/&#8220;/g, '"')
		.replace(/&#8221;/g, '"')
		.replace(/&amp;/g, '&')
		.replace(/&nbsp;/g, ' ')
		.replace(/<[^>]+>/g, '')
		.replace(/\u00a0/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function decodeHtml(s: string): string {
	return cleanText(s);
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

function parseChapterNumber(title: string, slug: string): number {
	const t = `${title} ${slug}`;
	let m = t.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i);
	if (m) return parseFloat(m[1]);
	m = t.match(/extra\s*(\d+(?:\.\d+)?)/i);
	if (m) return 10000 + parseFloat(m[1]);
	m = slug.match(/-(\d+)(?:\/|$)/);
	if (m) return parseFloat(m[1]);
	return 0;
}

function isUtilitySlug(slug: string): boolean {
	return /^(home|login|register|account|user|members|logout|profile|password-reset|terms|privacy|dmca|contact|feed|comments)/i.test(
		slug
	);
}

function chapterSlugFromPath(path: string): string {
	const parts = path.replace(/^\//, '').replace(/\/$/, '').split('/');
	return parts[parts.length - 1] || parts[0] || '';
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function adjacentChapterPaths(path: string): {
	prev: string | null;
	next: string | null;
} {
	const p = path.replace(/\/$/, '');
	let m = p.match(/^(.*-chapter-)(\d+)$/i);
	if (m) {
		const n = parseInt(m[2], 10);
		return {
			prev: n > 1 ? `${m[1]}${n - 1}` : null,
			next: `${m[1]}${n + 1}`
		};
	}
	m = p.match(/^(.*-extra-)(\d+)$/i);
	if (m) {
		const n = parseInt(m[2], 10);
		return {
			prev: n > 1 ? `${m[1]}${n - 1}` : null,
			next: `${m[1]}${n + 1}`
		};
	}
	return { prev: null, next: null };
}

function contentHtmlToParagraphs(html: string): string[] {
	if (!html || !html.trim()) return [];
	const $ = cheerio.load(`<div id="root">${html}</div>`);
	const root = $('#root');
	root
		.find(
			'script, style, .sharedaddy, .comments, #comments, nav, .nav-links, form, .wp-block-embed, iframe, .wordads-ad-wrapper, .wordads-ad, .jp-relatedposts'
		)
		.remove();

	const parts: string[] = [];
	root.find('p').each((_, p) => {
		const t = cleanText($(p).text());
		if (!t || t.length < 2) return;
		if (
			/^(support|be a patron|tokki|milou|translator|kofi|ko-fi|patreon|discord|hi! this is|advertisement)/i.test(
				t
			)
		)
			return;
		if (/milousarchive|tokkisarchives|catsemoji/i.test(t) && t.length < 120)
			return;
		if (/^━+/.test(t) && t.length < 30) return;
		if (/^[\s━─\-🐈⬛]+$/.test(t)) return;
		parts.push(`<p>${escapeHtml(t)}</p>`);
	});

	if (parts.length < 3) {
		const full = cleanText(root.text());
		if (full.length > 80) {
			for (const c of full
				.split(/\n{2,}/)
				.map((s) => s.trim())
				.filter((s) => s.length > 20)) {
				if (/^(support|tokki|milou|advertisement)/i.test(c)) continue;
				parts.push(`<p>${escapeHtml(c)}</p>`);
			}
		}
	}
	return parts;
}

export class MilousArchiveSource extends BaseSource {
	id = 'milousarchive';
	name = "Milou's Archive";
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'application/json, text/html, */*',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	private catCache: { at: number; cats: WpCategory[] } | null = null;
	private pageCache: { at: number; pages: WpPage[] } | null = null;
	private coverCache = new Map<number, string>();
	private catToSeries = new Map<
		number,
		{ path: string; title: string; mediaId?: number }
	>();

	private lastApiAt = 0;
	private static readonly API_GAP_MS = 400;

	private async apiGet<T>(path: string, retries = 3): Promise<T> {
		const url = path.startsWith('http') ? path : `${API}${path}`;

		for (let attempt = 0; attempt <= retries; attempt++) {
			const gap = Date.now() - this.lastApiAt;
			if (gap < MilousArchiveSource.API_GAP_MS) {
				await sleep(MilousArchiveSource.API_GAP_MS - gap);
			}
			this.lastApiAt = Date.now();

			const res = await fetch(url, {
				headers: { ...this.headers, Accept: 'application/json' }
			});

			if (res.status === 429) {
				const ra = res.headers.get('retry-after');
				const waitSec =
					ra && /^\d+$/.test(ra) ? parseInt(ra, 10) : Math.min(8, 1 + attempt * 2);
				const waitMs = waitSec * 1000 + Math.floor(Math.random() * 400);
				console.warn(
					`[milousarchive] 429 on ${path} → wait ${waitMs}ms (try ${attempt + 1}/${retries + 1})`
				);
				await res.text().catch(() => '');
				if (attempt === retries) {
					throw new Error(`Milou API 429 after ${retries + 1} tries: ${path}`);
				}
				await sleep(waitMs);
				continue;
			}

			if (!res.ok) {
				const t = await res.text().catch(() => '');
				console.error(
					`[milousarchive] API ${res.status} ${path}: ${t.slice(0, 120)}`
				);
				throw new Error(`Milou API ${res.status}: ${t.slice(0, 150)}`);
			}

			return (await res.json()) as T;
		}
		throw new Error(`Milou API failed: ${path}`);
	}

	private async loadPage(path: string): Promise<string> {
		const url = path.startsWith('http')
			? path
			: `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
		try {
			return await fetchWithCf(url, { headers: this.headers });
		} catch (e) {
			console.warn(
				'[milousarchive] fetchWithCf failed, plain fetch',
				String(e).slice(0, 120)
			);
			const res = await fetch(url, { headers: this.headers });
			if (!res.ok) {
				const t = await res.text().catch(() => '');
				throw new Error(`loadPage ${res.status}: ${t.slice(0, 100)}`);
			}
			return await res.text();
		}
	}

	private async getCategories(): Promise<WpCategory[]> {
		const now = Date.now();
		if (this.catCache && now - this.catCache.at < CACHE_MS) {
			return this.catCache.cats;
		}
		const cats = await this.apiGet<WpCategory[]>(
			'/categories?per_page=100&hide_empty=true'
		);
		const filtered = (cats || []).filter(
			(c) => c.slug !== 'uncategorized' && c.count > 0
		);
		this.catCache = { at: now, cats: filtered };
		return filtered;
	}

	private async getNovelPages(): Promise<WpPage[]> {
		const now = Date.now();
		if (this.pageCache && now - this.pageCache.at < CACHE_MS) {
			return this.pageCache.pages;
		}
		const pages = await this.apiGet<WpPage[]>(
			'/pages?per_page=100&_fields=id,slug,link,title,featured_media'
		);
		const filtered = (pages || []).filter(
			(p) => p.slug && !isUtilitySlug(p.slug)
		);
		this.pageCache = { at: now, pages: filtered };
		return filtered;
	}

	private async ensureSeriesMap(): Promise<void> {
		if (this.catToSeries.size > 0) return;
		const [cats, pages] = await Promise.all([
			this.getCategories(),
			this.getNovelPages()
		]);

		const pageBySlug = new Map(pages.map((p) => [p.slug.toLowerCase(), p]));
		const pageByTitle = new Map(
			pages.map((p) => [decodeHtml(p.title.rendered).toLowerCase(), p])
		);

		for (const c of cats) {
			const slug = c.slug.toLowerCase();
			let page =
				pageBySlug.get(slug) || pageByTitle.get(c.name.toLowerCase());

			if (!page) {
				page = pages.find(
					(p) =>
						p.slug.toLowerCase().includes(slug) ||
						slug.includes(p.slug.toLowerCase()) ||
						decodeHtml(p.title.rendered)
							.toLowerCase()
							.includes(c.name.toLowerCase().slice(0, 20))
				);
			}

			const path = page ? pathOnly(page.link) : `/${c.slug}`;
			const title = page
				? decodeHtml(page.title.rendered)
				: cleanText(c.name);

			this.catToSeries.set(c.id, {
				path,
				title,
				mediaId: page?.featured_media || undefined
			});
		}
	}

	private async resolveCover(mediaId?: number): Promise<string> {
		if (!mediaId) return '';
		if (this.coverCache.has(mediaId)) return this.coverCache.get(mediaId)!;
		try {
			const m = await this.apiGet<{
				source_url?: string;
				media_details?: { sizes?: Record<string, { source_url?: string }> };
			}>(`/media/${mediaId}?_fields=source_url,media_details`);
			const url =
				m.media_details?.sizes?.medium?.source_url || m.source_url || '';
			this.coverCache.set(mediaId, url);
			return url;
		} catch {
			return '';
		}
	}

	private async getLatestFromHomepage(): Promise<Manga[]> {
		const html = await this.loadPage('/');
		const $ = cheerio.load(html);
		const seen = new Set<string>();
		const list: Manga[] = [];
		const coverByPath = new Map<string, string>();

		$('a[href]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const p = pathOnly(href).replace(/\/$/, '');
			if (!/^\/[a-z0-9-]+$/i.test(p)) return;
			const img = $(a).find('img').first();
			const src =
				img.attr('src') ||
				img.attr('data-src') ||
				img.attr('data-lazy-src') ||
				'';
			if (!src || /logo|emoji|avatar|gravatar/i.test(src)) return;
			if (!/uploads|wp-content|cover/i.test(src)) return;
			let cover = src.startsWith('//') ? `https:${src}` : src;
			cover = cover.replace(/-\d+x\d+(\.\w+)(\?.*)?$/, '$1$2');
			if (!coverByPath.has(p)) coverByPath.set(p, cover);
		});

		$('a[href]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const text = cleanText($(a).text());
			if (!href || !text) return;
			const p = pathOnly(href);
			const m = p.match(
				/^\/([a-z0-9-]+)\/([a-z0-9-]+(?:-chapter-\d+|-extra-\d+)?)$/i
			);
			if (!m) return;
			const seriesSlug = m[1].toLowerCase();
			if (isUtilitySlug(seriesSlug)) return;
			if (!/chapter|extra/i.test(text) && !/chapter|extra/i.test(m[2])) return;

			const seriesPath = `/${seriesSlug}`;
			if (seen.has(seriesPath)) {
				const existing = list.find((x) => x.id === seriesPath);
				const num = parseChapterNumber(text, m[2]);
				if (
					existing &&
					num > (Number(existing.latestChapter) || 0) &&
					num < 10000
				) {
					existing.latestChapter = Math.floor(num);
				}
				return;
			}
			seen.add(seriesPath);
			const num = parseChapterNumber(text, m[2]);
			list.push({
				id: seriesPath,
				title: seriesSlug.toUpperCase(),
				cover: coverByPath.get(seriesPath) || '',
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: 'Ongoing',
				...(num > 0 && num < 10000
					? { latestChapter: Math.floor(num) }
					: {})
			});
		});

		$('a[href]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const text = cleanText($(a).text());
			if (!href || !text || text.length < 3) return;
			const p = pathOnly(href).replace(/\/$/, '');
			if (!/^\/[a-z0-9-]+$/i.test(p)) return;
			const slug = p.slice(1).toLowerCase();
			if (isUtilitySlug(slug)) return;

			if (seen.has(p)) {
				const existing = list.find((x) => x.id === p);
				if (existing) {
					if (
						existing.title === existing.id.slice(1).toUpperCase() ||
						existing.title.length < text.length
					) {
						existing.title = text;
					}
					if (!existing.cover) {
						existing.cover = coverByPath.get(p) || '';
					}
				}
				return;
			}
			if (list.length >= PER_PAGE) return;
			seen.add(p);
			list.push({
				id: p,
				title: text,
				cover: coverByPath.get(p) || '',
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: 'Ongoing'
			});
		});

		for (const item of list) {
			if (!item.cover) item.cover = coverByPath.get(item.id) || '';
		}

		return list.slice(0, PER_PAGE);
	}

	async getLatestManga(page = 1): Promise<Manga[]> {
		const p = Math.max(1, page);
		try {
			if (p === 1) {
				try {
					const fromHome = await this.getLatestFromHomepage();
					if (fromHome.length >= 3) {
						try {
							await this.ensureSeriesMap();
							for (const item of fromHome) {
								for (const [, s] of this.catToSeries) {
									if (s.path === item.id) {
										item.title = s.title;
										break;
									}
								}
							}
						} catch (e) {
							console.warn(
								'[milousarchive] series map enrich skip',
								String(e).slice(0, 80)
							);
						}
						console.log(
							`[milousarchive] latest from homepage n=${fromHome.length}`
						);
						return fromHome;
					}
				} catch (e) {
					console.warn(
						'[milousarchive] homepage latest failed',
						String(e).slice(0, 120)
					);
				}
			}

			await this.ensureSeriesMap();
			const posts = await this.apiGet<WpPost[]>(
				`/posts?per_page=50&page=${p}&orderby=date&order=desc&_fields=id,slug,link,title,date,categories`
			);

			const seen = new Set<string>();
			const list: Manga[] = [];

			for (const post of posts || []) {
				const catId = post.categories?.[0];
				if (!catId) continue;
				const series = this.catToSeries.get(catId);
				if (!series) continue;
				const id = series.path;
				if (seen.has(id)) {
					const existing = list.find((x) => x.id === id);
					const num = parseChapterNumber(post.title.rendered, post.slug);
					if (
						existing &&
						num > (Number(existing.latestChapter) || 0) &&
						num < 10000
					) {
						existing.latestChapter = Math.floor(num);
					}
					continue;
				}
				seen.add(id);
				const num = parseChapterNumber(post.title.rendered, post.slug);
				list.push({
					id,
					title: series.title,
					cover: '',
					sourceId: this.id,
					type: 'novel',
					lang: 'en',
					status: 'Ongoing',
					...(num > 0 && num < 10000
						? { latestChapter: Math.floor(num) }
						: {})
				});
				if (list.length >= PER_PAGE) break;
			}

			console.log(`[milousarchive] latest from API page=${p} n=${list.length}`);
			return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[milousarchive] latest', e);
			return [];
		}
	}

	async searchManga(
		query: string,
		opts?: { page?: number }
	): Promise<Manga[]> {
		const q = (query || '').trim().toLowerCase();
		const page = Math.max(1, opts?.page ?? 1);
		if (!q) return this.getLatestManga(page);

		try {
			await this.ensureSeriesMap();
			const cats = await this.getCategories();
			const hits: Manga[] = [];
			const seen = new Set<string>();
			const qDash = q.replace(/\s+/g, '-');

			for (const c of cats) {
				const series = this.catToSeries.get(c.id);
				if (!series) continue;
				const title = series.title.toLowerCase();
				if (
					!title.includes(q) &&
					!c.slug.includes(qDash) &&
					!series.path.toLowerCase().includes(qDash)
				)
					continue;
				if (seen.has(series.path)) continue;
				seen.add(series.path);
				hits.push({
					id: series.path,
					title: series.title,
					cover: '',
					sourceId: this.id,
					type: 'novel',
					lang: 'en',
					status: 'Ongoing',
					latestChapter: c.count
				});
			}

			const start = (page - 1) * PER_PAGE;
			return hits.slice(start, start + PER_PAGE);
		} catch (e) {
			console.error('[milousarchive] search', e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const path = pathOnly(mangaId);
		const slug = path.replace(/^\//, '').split('/')[0];

		const html = await this.loadPage(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		let title =
			cleanText($('h1.entry-title, h1').first().text()) ||
			cleanText($('title').text().split(/[|\-–]/)[0]);

		const bodyText = cleanText(
			$('.entry-content, .wp-block-post-content').text()
		);
		let author = '';
		let altTitle = '';
		let status = 'Ongoing';

		const authorM = bodyText.match(/Author\s*:\s*([^\n|]{2,80})/i);
		if (authorM) author = cleanText(authorM[1]);

		const rawM = bodyText.match(/Raw Title\s*:\s*([^\n]{2,120})/i);
		if (rawM) altTitle = cleanText(rawM[1]);

		if (/No\.?\s*Of\s*Chapters\s*:\s*Ongoing/i.test(bodyText))
			status = 'Ongoing';
		else if (/completed|complete/i.test(bodyText)) status = 'Completed';
		else if (/hiatus/i.test(bodyText)) status = 'Hiatus';

		let cover =
			$('.entry-content img, .wp-block-post-content img, article img')
				.filter((_, el) => {
					const src = $(el).attr('src') || '';
					return (
						/cover|uploads/i.test(src) && !/logo|profile|avatar/i.test(src)
					);
				})
				.first()
				.attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		if (cover.startsWith('//')) cover = `https:${cover}`;

		let description = '';
		const synIdx = bodyText.search(/SYNOPSYS|SYNOPSIS|Synopsis/i);
		if (synIdx >= 0) {
			description = bodyText
				.slice(synIdx)
				.replace(/^(SYNOPSYS|SYNOPSIS|Synopsis)\s*:?\s*/i, '')
				.split(/TABLE OF CONTENTS|━━━━|━━ 🐈/i)[0]
				.trim()
				.slice(0, 4000);
		}
		if (!description) {
			description = cleanText(
				$('meta[name="description"]').attr('content') || ''
			);
		}

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		$('.entry-content a, .wp-block-post-content a').each((_, a) => {
			const href = $(a).attr('href') || '';
			const text = cleanText($(a).text());
			if (!href || !text) return;
			const p = pathOnly(href);
			if (
				!p.startsWith(`/${slug}/`) &&
				!p.includes(`/${slug}-`) &&
				!p.match(new RegExp(`/${slug}/`, 'i'))
			)
				return;
			if (/comment|author|login|patreon|ko-fi|discord/i.test(href)) return;

			const num = parseChapterNumber(text, p);
			if (!num) return;
			if (seen.has(p)) return;
			seen.add(p);

			chapters.push({
				id: p,
				title:
					num >= 10000
						? `Extra ${num - 10000}`
						: `Chapter ${Math.floor(num)}`,
				number: num >= 10000 ? num - 10000 + 0.5 : num
			});
		});

		if (chapters.length < 5) {
			try {
				await this.ensureSeriesMap();
				const cats = await this.getCategories();
				const cat = cats.find(
					(c) =>
						this.catToSeries.get(c.id)?.path === path || c.slug === slug
				);
				if (cat) {
					for (let page = 1; page <= 5; page++) {
						const posts = await this.apiGet<WpPost[]>(
							`/posts?categories=${cat.id}&per_page=100&page=${page}&orderby=date&order=asc&_fields=id,slug,link,title,date`
						);
						if (!posts?.length) break;
						for (const post of posts) {
							const id = pathOnly(post.link);
							if (seen.has(id)) continue;
							seen.add(id);
							const num = parseChapterNumber(
								post.title.rendered,
								post.slug
							);
							if (!num) continue;
							chapters.push({
								id,
								title:
									num >= 10000
										? `Extra ${num - 10000}`
										: `Chapter ${Math.floor(num)}`,
								number: num >= 10000 ? num - 10000 + 0.5 : num,
								date: formatDate(post.date)
							});
						}
						if (posts.length < 100) break;
					}
				}
			} catch (e) {
				console.error('[milousarchive] posts fallback', e);
			}
		}

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));
		if (!title) title = slug;

		const details: MangaDetails = {
			id: path,
			title,
			cover,
			sourceId: this.id,
			description,
			authors: author ? [author] : [],
			status,
			genres: [],
			chapters,
			type: 'novel',
			lang: 'en'
		};

		const extra = details as MangaDetails & { altTitles?: string[] };
		if (altTitle) extra.altTitles = [altTitle];
		return details;
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
		const slug = chapterSlugFromPath(path);

		let title = 'Chapter';
		let contentHtml = '';

		const adj = adjacentChapterPaths(path.replace(/\/$/, ''));
		let prevChapterId: string | null = adj.prev;
		let nextChapterId: string | null = adj.next;

		try {
			const posts = await this.apiGet<WpPost[]>(
				`/posts?slug=${encodeURIComponent(slug)}&_fields=id,slug,link,title,content`
			);
			const post = posts?.[0];
			if (post?.content?.rendered) {
				contentHtml = post.content.rendered;
				const h = decodeHtml(post.title?.rendered || '');
				const num = parseChapterNumber(h, post.slug || slug);
				title =
					num > 0 && num < 10000
						? `Chapter ${Math.floor(num)}`
						: num >= 10000
							? `Extra ${num - 10000}`
							: h || 'Chapter';
				console.log(
					`[milousarchive] content API slug=${slug} len=${contentHtml.length}`
				);
			}
		} catch (e) {
			console.error('[milousarchive] API chapter', e);
		}

		if (!contentHtml || contentHtml.length < 50) {
			try {
				const html = await this.loadPage(
					path.endsWith('/') ? path : `${path}/`
				);
				const $ = cheerio.load(html);
				const h = cleanText($('h1.entry-title, h1, h2').first().text());
				const num = parseChapterNumber(h, path);
				title =
					num > 0 && num < 10000
						? `Chapter ${Math.floor(num)}`
						: num >= 10000
							? `Extra ${num - 10000}`
							: h || title;

				const contentEl = $(
					'.entry-content, .wp-block-post-content, article .content, .post-content'
				).first();
				if (contentEl.length) contentHtml = contentEl.html() || '';

				const relPrev =
					$('a[rel="prev"]').attr('href') ||
					$('.post-navigation-link-previous a').attr('href');
				const relNext =
					$('a[rel="next"]').attr('href') ||
					$('.post-navigation-link-next a').attr('href');
				if (relPrev) prevChapterId = pathOnly(relPrev);
				if (relNext) nextChapterId = pathOnly(relNext);

				console.log(
					`[milousarchive] content HTML path=${path} len=${contentHtml.length}`
				);
			} catch (e) {
				console.error('[milousarchive] HTML chapter', e);
			}
		}

		const parts = contentHtmlToParagraphs(contentHtml);
		const content =
			parts.length > 0
				? parts.join('\n')
				: '<p><em>Empty content — API/HTML gagal. Cek log [milousarchive].</em></p>';

		console.log(
			`[milousarchive] nav prev=${prevChapterId} next=${nextChapterId}`
		);

		return { title, content, prevChapterId, nextChapterId };
	}
}

export default MilousArchiveSource;