/**
 * Yume Neiji's Works (yumeneijiworks.com)
 * WordPress.com novel translation site
 *
 * Struktur:
 * - List: /  +  /translated-novels/ (+ /page/N/)
 * - Detail/TOC: /category/{slug}/  (paginated articles)
 * - Chapter: /YYYY/MM/DD/{slug}-chapter-N/  → .entry-content
 *
 * Tidak perlu Worker hybrid (WP.com biasanya longgar).
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types';

const BLOCKED_PATH =
	/\/(about|notes|feed|comments|author|tag|page|wp-|xmlrpc|osd|search|contact|privacy|terms|login|signup)(\/|$)/i;

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

/** Normalisasi domain wordpress.com → custom domain, path only */
function pathOnly(href: string): string {
	try {
		const u = new URL(
			href.startsWith('http')
				? href
				: `https://yumeneijiworks.com${href.startsWith('/') ? '' : '/'}${href}`
		);
		// samakan wordpress.com mirror ke custom domain path
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		return href.startsWith('/') ? href : `/${href}`;
	}
}

function decodeEntities(s: string): string {
	return s
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&nbsp;/g, ' ');
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function parseChapterNumber(title: string, fallback: number): number {
	const m =
		title.match(/chapter\s*(\d+(?:\.\d+)?)/i) ||
		title.match(/\bch\.?\s*(\d+(?:\.\d+)?)/i) ||
		title.match(/(\d+(?:\.\d+)?)/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function shortChapterTitle(raw: string, num: number): string {
	const n = Number.isFinite(num) && num > 0 ? num : parseChapterNumber(raw, 0);
	if (n > 0) return `Chapter ${n}`;
	const m = raw.match(/chapter\s*(\d+(?:\.\d+)?)/i);
	if (m) return `Chapter ${m[1]}`;
	return decodeEntities(raw).slice(0, 48);
}

function extractStatus(text: string): string | undefined {
	const t = text.toLowerCase();
	if (/completed|complete/.test(t)) return 'Completed';
	if (/discontinued|dropped|hiatus/.test(t)) return 'Hiatus';
	if (/picked-?up|caught up|ongoing/.test(t)) return 'Ongoing';
	return undefined;
}

export class YumeNeijiWorksSource extends BaseSource {
	id = 'yumeneijiworks';
	name = 'Yume Neiji Works';
	baseUrl = 'https://yumeneijiworks.com';

	async getLatestManga(page = 1): Promise<Manga[]> {
		if (page <= 1) {
			const [home, trans] = await Promise.all([
				this.parseHome().catch(() => [] as Manga[]),
				this.parseTranslatedNovels(1).catch(() => [] as Manga[])
			]);
			return this.dedupeById([...trans, ...home]).slice(0, 24);
		}
		return this.parseTranslatedNovels(page);
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

	/** Homepage: daftar judul novel + status */
	private async parseHome(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		// Link ke category atau intro post
		$('a[href*="/category/"], a[href*="chapter"], a[href]').each((_, el) => {
			const href = $(el).attr('href') || '';
			const p = pathOnly(href);
			if (BLOCKED_PATH.test(p) || p === '/' || p.length < 6) return;

			// Prefer category path sebagai novel id
			let id = p;
			if (p.includes('/category/')) {
				id = p; // /category/slug
			} else if (/chapter/i.test(p) || /\/\d{4}\/\d{2}\/\d{2}\//.test(p)) {
				// skip pure chapter links di home
				return;
			}

			if (seen.has(id)) return;

			const title = decodeEntities(
				($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim()
			);
			if (!title || title.length < 4) return;
			if (/^(novels?|translations?|original|notes|about|menu|home|read more)/i.test(title))
				return;

			const parent = $(el).closest('p, div, li, article, h2, h3, strong').parent();
			const context = parent.text() + ' ' + $(el).parent().text();
			const status = extractStatus(context) || 'Ongoing';

			seen.add(id);
			list.push({
				id,
				title,
				cover: '',
				sourceId: this.id,
				type: 'novel',
				status,
				lang: 'en'
			});
		});

		return list;
	}

	/** /translated-novels/ — punya cover + synopsis */
	private async parseTranslatedNovels(page: number): Promise<Manga[]> {
		const path =
			page <= 1 ? '/translated-novels/' : `/translated-novels/${page}/`;
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		// Jetpack layout grid: image + title + status + read more link
		$('.wp-block-jetpack-layout-grid, .wp-block-group, article, .entry-content > *').each(
			(_, block) => {
				const $b = $(block);
				const img =
					$b.find('img').first().attr('data-src') ||
					$b.find('img').first().attr('src') ||
					'';
				const cover = img && !img.startsWith('data:') ? absUrl(this.baseUrl, img.split('?')[0]) : '';

				// "Read more" / judul link
				const links = $b.find('a[href]');
				let novelHref = '';
				let title = '';

				links.each((__, a) => {
					const href = $(a).attr('href') || '';
					const p = pathOnly(href);
					const t = decodeEntities($(a).text().replace(/\s+/g, ' ').trim());
					if (/read more/i.test(t) || (p.length > 8 && !BLOCKED_PATH.test(p))) {
						if (!novelHref) novelHref = p;
					}
					if (t.length > 8 && !/read more|synopsis|status/i.test(t)) {
						if (!title || t.length > title.length) title = t;
					}
				});

				// Status text
				const blockText = $b.text();
				const status = extractStatus(blockText) || 'Ongoing';

				// Title dari strong/bold di block
				if (!title) {
					title = decodeEntities(
						$b.find('strong, b, h2, h3').first().text().replace(/\s+/g, ' ').trim()
					);
				}

				if (!title || title.length < 4) return;
				if (/^(web novel|translations?|status|synopsis)/i.test(title)) return;

				// Derive category id dari title slug-ish atau dari read-more URL
				let id = novelHref;
				if (!id || BLOCKED_PATH.test(id)) {
					// fallback: buat id dari title
					id = '/category/' + title
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, '-')
						.replace(/^-|-$/g, '')
						.slice(0, 80);
				}

				// Prefer /category/ path jika ada di site
				if (!id.includes('/category/') && novelHref.includes('/category/')) {
					id = novelHref;
				}

				if (seen.has(id)) {
					// update cover jika kosong
					const existing = list.find((x) => x.id === id);
					if (existing && !existing.cover && cover) existing.cover = cover;
					return;
				}
				seen.add(id);

				list.push({
					id,
					title,
					cover,
					sourceId: this.id,
					type: 'novel',
					status,
					lang: 'en'
				});
			}
		);

		// Fallback: semua strong + link di entry-content
		if (!list.length) {
			$('.entry-content a[href], .entry-content strong').each((_, el) => {
				const $el = $(el);
				const href = $el.is('a') ? $el.attr('href') || '' : $el.closest('a').attr('href') || '';
				const p = pathOnly(href);
				const title = decodeEntities($el.text().replace(/\s+/g, ' ').trim());
				if (!title || title.length < 5 || seen.has(p)) return;
				if (BLOCKED_PATH.test(p) && !p.includes('/category/')) return;
				if (/read more|synopsis|status|ongoing|completed/i.test(title)) return;

				const id = p.includes('/category/') ? p : p || `/novel/${title.slice(0, 40)}`;
				if (seen.has(id)) return;
				seen.add(id);

				list.push({
					id,
					title,
					cover: '',
					sourceId: this.id,
					type: 'novel',
					status: extractStatus($el.parent().text()) || 'Ongoing',
					lang: 'en'
				});
			});
		}

		return list;
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = encodeURIComponent(query);
		const path = page <= 1 ? `/?s=${q}` : `/page/${page}/?s=${q}`;
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('article.post, .post, h2.entry-title').each((_, el) => {
			const $el = $(el);
			const a = $el.find('a[href]').first().length
				? $el.find('a[href]').first()
				: $el.is('a')
					? $el
					: $el.find('a').first();
			const href = a.attr('href') || '';
			const p = pathOnly(href);
			if (!p || BLOCKED_PATH.test(p) || seen.has(p)) return;

			const title = decodeEntities(
				(a.attr('title') || a.text() || $el.find('.entry-title').text())
					.replace(/\s+/g, ' ')
					.trim()
			);
			if (!title || title.length < 3) return;

			// Map chapter → category jika memungkinkan
			let id = p;
			const cat = $el.find('a[href*="/category/"]').attr('href');
			if (cat) id = pathOnly(cat);

			if (seen.has(id)) return;
			seen.add(id);

			list.push({
				id,
				title: title.replace(/\s*Chapter\s+\d+.*$/i, '').trim() || title,
				cover: '',
				sourceId: this.id,
				type: 'novel',
				lang: 'en'
			});
		});

		return list;
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		// Normalisasi ke category URL
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		if (!path.includes('/category/')) {
			// coba treat sebagai slug
			const slug = path.replace(/^\//, '').replace(/\/$/, '');
			path = `/category/${slug}/`;
		}
		path = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		// Title dari category header
		let title = decodeEntities(
			$('h1').first().text().replace(/^Category:\s*/i, '').trim() ||
				$('.page-title, .entry-title').first().text().replace(/^Category:\s*/i, '').trim() ||
				$('title').text().split(/[|\-–]/)[0].replace(/Category:\s*/i, '').trim()
		);

		if (!title || title.length < 2) {
			throw new Error('Novel not found (empty title)');
		}

		// Cover: coba dari first image di page / og
		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('article img, .entry-content img').first().attr('src') ||
			'';
		cover = (cover || '').split('?')[0];

		// Description: excerpt chapter pertama atau meta
		let description =
			$('meta[property="og:description"]').attr('content') ||
			$('article .entry-content p').first().text().replace(/\s+/g, ' ').trim() ||
			'';
		description = decodeEntities(description).slice(0, 800);

		const chapters = await this.fetchAllChapters(path, $);

		chapters.sort((a, b) => {
			const na = typeof a.number === 'number' ? a.number : 0;
			const nb = typeof b.number === 'number' ? b.number : 0;
			return nb - na;
		});

		return {
			id: pathOnly(path),
			title,
			cover: absUrl(this.baseUrl, cover),
			sourceId: this.id,
			description,
			authors: ['Yume Neiji'],
			status: 'Ongoing',
			genres: [],
			chapters,
			type: 'novel',
			lang: 'en'
		};
	}

	/** Ambil semua chapter dari category (multi-page) */
	private async fetchAllChapters(
		categoryPath: string,
		$first: cheerio.CheerioAPI
	): Promise<Chapter[]> {
		const seen = new Set<string>();
		const out: Chapter[] = [];

		const ingest = ($: cheerio.CheerioAPI) => {
			$('article.post, article.hentry, .post').each((_, el) => {
				const a = $(el).find('h2.entry-title a, .entry-title a').first();
				const href = a.attr('href') || '';
				if (!href) return;
				const id = pathOnly(href);
				if (seen.has(id) || BLOCKED_PATH.test(id)) return;
				seen.add(id);

				const rawTitle = decodeEntities(
					(a.attr('title') || a.text()).replace(/\s+/g, ' ').trim()
				);
				if (!rawTitle) return;
				const num = parseChapterNumber(rawTitle, out.length + 1);
				const date =
					$(el).find('time.entry-date, .entry-date').attr('datetime') ||
					$(el).find('.entry-date').text().trim() ||
					undefined;

				out.push({
					id,
					title: shortChapterTitle(rawTitle, num),
					number: num,
					...(date ? { date } : {})
				});
			});
		};

		ingest($first);

		// Pagination: /category/slug/page/2/
		let maxPage = 1;
		$first('.nav-links a, .pagination a, a.page-numbers, .nav-previous a, .nav-next a').each(
			(_, el) => {
				const href = $first(el).attr('href') || '';
				const m = href.match(/\/page\/(\d+)/);
				if (m) maxPage = Math.max(maxPage, parseInt(m[1], 10));
				const t = $first(el).text().trim();
				if (/^\d+$/.test(t)) maxPage = Math.max(maxPage, parseInt(t, 10));
			}
		);
		maxPage = Math.min(maxPage, 50);

		if (maxPage > 1) {
			const base = categoryPath.replace(/\/$/, '');
			const jobs: Promise<void>[] = [];
			for (let p = 2; p <= maxPage; p++) {
				jobs.push(
					(async () => {
						try {
							const html = await this.fetchHtml(`${base}/page/${p}/`);
							ingest(cheerio.load(html));
						} catch {
							/* skip */
						}
					})()
				);
			}
			await Promise.all(jobs);
		}

		return out;
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
		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const rawTitle = decodeEntities(
			$('h1.entry-title, h1').first().text().trim() ||
				$('meta[property="og:title"]').attr('content')?.split(/[|\-–]/)[0].trim() ||
				$('title').text().split(/[|\-–]/)[0].trim() ||
				'Chapter'
		);
		const num = parseChapterNumber(rawTitle, 0);
		const title = num > 0 ? shortChapterTitle(rawTitle, num) : rawTitle;

		const el = $('.entry-content').first();
		let contentHtml = '';

		if (el.length) {
			const clone = el.clone();
			clone
				.find(
					'script, style, iframe, .sharedaddy, .jp-relatedposts, .nav-links, form, .comments-area, #comments'
				)
				.remove();

			// Buang baris navigasi "Previous ⚜ Table of Contents ⚜ Next"
			clone.find('p, div').each((_, node) => {
				const t = $(node).text().replace(/\s+/g, ' ').trim();
				if (
					/previous.*table of contents.*next/i.test(t) ||
					/^previous\s*[⚜★*|]/i.test(t) ||
					/this is translated by yume neiji/i.test(t) ||
					/kindly read at/i.test(t)
				) {
					$(node).remove();
				}
			});

			const paras = clone.find('p');
			if (paras.length >= 2) {
				const parts: string[] = [];
				paras.each((_, p) => {
					const t = $(p).text().trim();
					if (!t || t.length < 3) return;
					if (/yumeneiji|yume neiji|wordpress\.com|patreon|ko-fi/i.test(t)) return;
					parts.push(`<p>${escapeHtml(t)}</p>`);
				});
				if (parts.length) contentHtml = parts.join('\n');
			}
			if (!contentHtml) {
				contentHtml = clone.html()?.trim() || '';
			}
		}

		// Prev / Next dari post-navigation atau link text
		const prevHref =
			$('a[rel="prev"]').attr('href') ||
			$('.nav-previous a, .post-navigation .nav-previous a').attr('href') ||
			$('a')
				.filter((_, a) => /^previous/i.test($(a).text().trim()))
				.first()
				.attr('href');

		const nextHref =
			$('a[rel="next"]').attr('href') ||
			$('.nav-next a, .post-navigation .nav-next a').attr('href') ||
			$('a')
				.filter((_, a) => /^next/i.test($(a).text().trim()))
				.first()
				.attr('href');

		return {
			title,
			content:
				contentHtml ||
				'<p><em>Konten kosong — selector berubah atau halaman error.</em></p>',
			prevChapterId: prevHref ? pathOnly(prevHref) : null,
			nextChapterId: nextHref ? pathOnly(nextHref) : null
		};
	}
}

export default YumeNeijiWorksSource;