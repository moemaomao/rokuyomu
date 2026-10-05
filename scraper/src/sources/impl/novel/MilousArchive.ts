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
 *   /wp-json/wp/v2/posts?slug={chapter-slug}  ← primary for content
 *
 * Chapter title: "Chapter N" (bersih)
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://milousarchive.com';
const API = `${BASE}/wp-json/wp/v2`;
const PER_PAGE = 24;

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

/** "GSMF Chapter 129" / "gsmf-chapter-129" / "TFLF Extra 5" */
function parseChapterNumber(title: string, slug: string): number {
	const t = `${title} ${slug}`;
	let m = t.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i);
	if (m) return parseFloat(m[1]);
	m = t.match(/extra\s*(\d+(?:\.\d+)?)/i);
	if (m) return 10000 + parseFloat(m[1]); // sort extras after main
	m = slug.match(/-(\d+)(?:\/|$)/);
	if (m) return parseFloat(m[1]);
	return 0;
}

function isUtilitySlug(slug: string): boolean {
	return /^(home|login|register|account|user|members|logout|profile|password-reset|terms|privacy|dmca|contact|feed|comments)/i.test(
		slug
	);
}

/** Extract chapter slug from path like /gsmf/gsmf-chapter-129 */
function chapterSlugFromPath(path: string): string {
	const parts = path.replace(/^\//, '').replace(/\/$/, '').split('/');
	return parts[parts.length - 1] || parts[0] || '';
}

/**
 * Parse WP content.rendered HTML into clean <p> paragraphs.
 * Prefer this over live-page scrape (avoids CF on Vercel).
 */
function contentHtmlToParagraphs(html: string): string[] {
	if (!html || !html.trim()) return [];
	const $ = cheerio.load(`<div id="root">${html}</div>`);
	const root = $('#root');
	root
		.find(
			'script, style, .sharedaddy, .comments, #comments, nav, .nav-links, form, .wp-block-embed, iframe, .wordads-ad-wrapper, .wordads-ad, .jp-relatedposts, .sharedaddy'
		)
		.remove();

	const parts: string[] = [];
	root.find('p').each((_, p) => {
		const t = cleanText($(p).text());
		if (!t || t.length < 2) return;
		// skip translator notes / footer / ads
		if (
			/^(support|be a patron|tokki|milou|translator|kofi|ko-fi|patreon|discord|hi! this is|advertisement)/i.test(
				t
			)
		)
			return;
		if (/milousarchive|tokkisarchives|catsemoji|🐈/i.test(t) && t.length < 120)
			return;
		if (/^━+/.test(t) && t.length < 30) return;
		// skip pure emoji separators
		if (/^[\s━─\-🐈⬛🐈‍⬛]+$/.test(t)) return;
		parts.push(`<p>${escapeHtml(t)}</p>`);
	});

	// Fallback: if almost no <p>, take text blocks from divs
	if (parts.length < 3) {
		const full = cleanText(root.text());
		if (full.length > 80) {
			const chunks = full
				.split(/\n{2,}/)
				.map((s) => s.trim())
				.filter((s) => s.length > 20);
			for (const c of chunks) {
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
	/** categoryId → series path (/gsmf) */
	private catToSeries = new Map<
		number,
		{ path: string; title: string; cover?: string; mediaId?: number }
	>();

	private async apiGet<T>(path: string): Promise<T> {
		const url = path.startsWith('http') ? path : `${API}${path}`;
		const res = await fetch(url, {
			headers: { ...this.headers, Accept: 'application/json' }
		});
		if (!res.ok) {
			const t = await res.text().catch(() => '');
			console.error(`[milousarchive] API ${res.status} ${url}: ${t.slice(0, 200)}`);
			throw new Error(`Milou API ${res.status}: ${t.slice(0, 150)}`);
		}
		return (await res.json()) as T;
	}

	private async loadPage(path: string): Promise<string> {
		const url = path.startsWith('http')
			? path
			: `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
		try {
			return await fetchWithCf(url, { headers: this.headers });
		} catch (e) {
			console.warn('[milousarchive] fetchWithCf failed, plain fetch', e);
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
		if (this.catCache && now - this.catCache.at < 30 * 60_000) {
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
		if (this.pageCache && now - this.pageCache.at < 30 * 60_000) {
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

			// fuzzy: page slug contains cat slug or vice versa
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
		try {
			const m = await this.apiGet<{
				source_url?: string;
				media_details?: { sizes?: Record<string, { source_url?: string }> };
			}>(`/media/${mediaId}?_fields=source_url,media_details`);
			return (
				m.media_details?.sizes?.medium?.source_url ||
				m.source_url ||
				''
			);
		} catch {
			return '';
		}
	}

	/**
	 * Latest Update — group recent posts by series category
	 */
	async getLatestManga(page = 1): Promise<Manga[]> {
		const p = Math.max(1, page);
		try {
			await this.ensureSeriesMap();

			const posts = await this.apiGet<WpPost[]>(
				`/posts?per_page=100&page=${p}&orderby=date&order=desc&_fields=id,slug,link,title,date,categories`
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
					const num = parseChapterNumber(
						post.title.rendered,
						post.slug
					);
					if (existing && num > (Number(existing.latestChapter) || 0)) {
						existing.latestChapter = Math.floor(num);
					}
					continue;
				}
				seen.add(id);
				const num = parseChapterNumber(post.title.rendered, post.slug);
				const cover = series.mediaId
					? await this.resolveCover(series.mediaId)
					: '';

				list.push({
					id,
					title: series.title,
					cover,
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

			if (p === 1 && list.length < 12) {
				const cats = await this.getCategories();
				for (const c of cats) {
					const series = this.catToSeries.get(c.id);
					if (!series || seen.has(series.path)) continue;
					seen.add(series.path);
					list.push({
						id: series.path,
						title: series.title,
						cover: series.mediaId
							? await this.resolveCover(series.mediaId)
							: '',
						sourceId: this.id,
						type: 'novel',
						lang: 'en',
						status: 'Ongoing',
						latestChapter: c.count
					});
					if (list.length >= PER_PAGE) break;
				}
			}

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

			for (const c of cats) {
				const series = this.catToSeries.get(c.id);
				if (!series) continue;
				const title = series.title.toLowerCase();
				const qDash = q.replace(/\s+/g, '-');
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
					cover: series.mediaId
						? await this.resolveCover(series.mediaId)
						: '',
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

		// Prefer category description + posts (no CF) for meta & chapters
		await this.ensureSeriesMap();
		const cats = await this.getCategories();
		const cat =
			cats.find(
				(c) =>
					this.catToSeries.get(c.id)?.path === path ||
					c.slug === slug ||
					pathOnly(c.link || '') === path
			) || null;

		let title = '';
		let author = '';
		let altTitle = '';
		let status = 'Ongoing';
		let description = '';
		let cover = '';
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		// Meta from category.description (rich, no HTML scrape needed)
		if (cat?.description) {
			const desc = cat.description.replace(/\\r\\n/g, '\n').replace(/\r\n/g, '\n');
			title = cleanText(cat.name);
			const authorM = desc.match(/Author\s*:\s*([^\n\r]{2,80})/i);
			if (authorM) author = cleanText(authorM[1]);
			const rawM = desc.match(/Raw Title\s*:\s*([^\n\r]{2,120})/i);
			if (rawM) altTitle = cleanText(rawM[1]);
			if (/No\.?\s*Of\s*Chapters\s*:\s*Ongoing/i.test(desc)) status = 'Ongoing';
			else if (/completed|complete/i.test(desc)) status = 'Completed';
			else if (/hiatus/i.test(desc)) status = 'Hiatus';
		}

		const series = cat ? this.catToSeries.get(cat.id) : undefined;
		if (series?.mediaId) {
			cover = await this.resolveCover(series.mediaId);
		}
		if (series?.title) title = series.title;

		// Chapters from WP posts by category (reliable)
		if (cat) {
			try {
				for (let page = 1; page <= 30; page++) {
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
			} catch (e) {
				console.error('[milousarchive] posts by cat', e);
			}
		}

		// HTML fallback for TOC / cover / synopsis if still thin
		if (chapters.length < 3 || !description || !cover) {
			try {
				const html = await this.loadPage(
					path.endsWith('/') ? path : `${path}/`
				);
				const $ = cheerio.load(html);

				if (!title) {
					title =
						cleanText($('h1.entry-title, h1').first().text()) ||
						cleanText($('title').text().split(/[|\-–]/)[0]);
				}

				const bodyText = cleanText(
					$('.entry-content, .wp-block-post-content').text()
				);

				if (!author) {
					const authorM = bodyText.match(/Author\s*:\s*([^\n|]{2,80})/i);
					if (authorM) author = cleanText(authorM[1]);
				}
				if (!altTitle) {
					const rawM = bodyText.match(/Raw Title\s*:\s*([^\n]{2,120})/i);
					if (rawM) altTitle = cleanText(rawM[1]);
				}
				if (/No\.?\s*Of\s*Chapters\s*:\s*Ongoing/i.test(bodyText))
					status = 'Ongoing';
				else if (/completed|complete/i.test(bodyText)) status = 'Completed';
				else if (/hiatus/i.test(bodyText)) status = 'Hiatus';

				if (!cover) {
					cover =
						$('.entry-content img, .wp-block-post-content img, article img')
							.filter((_, el) => {
								const src = $(el).attr('src') || '';
								return (
									/cover|uploads/i.test(src) &&
									!/logo|profile|avatar/i.test(src)
								);
							})
							.first()
							.attr('src') ||
						$('meta[property="og:image"]').attr('content') ||
						'';
					if (cover.startsWith('//')) cover = `https:${cover}`;
				}

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

				if (chapters.length < 3) {
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
						if (/comment|author|login|patreon|ko-fi|discord/i.test(href))
							return;

						const num = parseChapterNumber(text, p);
						if (!num) return;
						const id = p;
						if (seen.has(id)) return;
						seen.add(id);

						const titleLabel =
							num >= 10000
								? `Extra ${num - 10000}`
								: `Chapter ${Math.floor(num)}`;

						chapters.push({
							id,
							title: titleLabel,
							number: num >= 10000 ? num - 10000 + 0.5 : num
						});
					});
				}
			} catch (e) {
				console.error('[milousarchive] HTML series fallback', e);
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
		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		// 1) Primary: WP REST by slug — no Cloudflare, works on Vercel
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
					`[milousarchive] content via API slug=${slug} len=${contentHtml.length}`
				);
			} else {
				console.warn(
					`[milousarchive] API no content for slug=${slug} posts=${posts?.length ?? 0}`
				);
			}
		} catch (e) {
			console.error('[milousarchive] API chapter content', e);
		}

		// 2) Fallback: HTML page (may hit CF — needs Byparr on Vercel)
		if (!contentHtml || contentHtml.length < 50) {
			try {
				const html = await this.loadPage(
					path.endsWith('/') ? path : `${path}/`
				);
				const $ = cheerio.load(html);

				const h = cleanText(
					$('h1.entry-title, h1, h2').first().text()
				);
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
				if (contentEl.length) {
					contentHtml = contentEl.html() || '';
				}

				$('a').each((_, a) => {
					const t = cleanText($(a).text()).toLowerCase();
					const href = $(a).attr('href') || '';
					if (!href || href === '#') return;
					const p = pathOnly(href);
					if (/^prev(ious)?(\s|$)/i.test(t) || t === '←')
						prevChapterId = p;
					if (/^next(\s|$)/i.test(t) || t === '→') nextChapterId = p;
				});
				const relPrev = $('a[rel="prev"]').attr('href');
				const relNext = $('a[rel="next"]').attr('href');
				if (relPrev) prevChapterId = pathOnly(relPrev);
				if (relNext) nextChapterId = pathOnly(relNext);

				console.log(
					`[milousarchive] content via HTML path=${path} len=${contentHtml.length}`
				);
			} catch (e) {
				console.error('[milousarchive] HTML chapter content', e);
			}
		}

		const parts = contentHtmlToParagraphs(contentHtml);
		const content =
			parts.length > 0
				? parts.join('\n')
				: '<p><em>Empty content — API and HTML both failed. Check Vercel logs for [milousarchive].</em></p>';

		return {
			title,
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default MilousArchiveSource;