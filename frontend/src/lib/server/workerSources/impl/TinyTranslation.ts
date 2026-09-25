/**
 * TinyTranslation.xyz — WordPress novel translation site
 * Path: scraper/src/sources/impl/TinyTranslation.ts
 *
 * URL pattern:
 *   Series  : /series/{slug}/
 *   Chapter : /{series-slug}/{series-slug}-{n}/  (atau variasi serupa)
 *   List    : /list-novels/
 *   Latest  : /latest-releases/  + /latest-releases/page/{n}
 *
 * Konten = text novel (bukan gambar). getChapterPages → []
 * Pakai getChapterContent untuk reader novel.
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
				: `https://www.tinytranslation.xyz${href.startsWith('/') ? '' : '/'}${href}`
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

function parseChapterNumber(title: string, fallback: number): number {
	const m =
		title.match(/(?:volume|vol\.?)\s*\d+\s*(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i) ||
		title.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i) ||
		title.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function extractChapterNum(text: string): number | undefined {
	const t = (text || '').replace(/\s+/g, ' ').trim();
	if (!t) return undefined;
	const m =
		t.match(/(?:volume|vol\.?)\s*\d+\s*(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/(\d+(?:\.\d+)?)/);
	if (!m) return undefined;
	const n = parseFloat(m[1]);
	return Number.isNaN(n) ? undefined : n;
}

export class TinyTranslationSource extends BaseSource {
	id = 'tinytranslation';
	name = 'TinyTranslation';
	baseUrl = 'https://www.tinytranslation.xyz';

	async getLatestManga(page = 1): Promise<Manga[]> {
		if (page <= 1) {
			const [fromLatest, fromList] = await Promise.all([
				this.parseLatestReleases(1).catch(() => [] as Manga[]),
				this.parseListNovels().catch(() => [] as Manga[])
			]);
			return this.dedupeById([...fromLatest, ...fromList]).slice(0, 30);
		}
		return this.parseLatestReleases(page);
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

	/** Parse /list-novels/ — daftar series On-going / Completed / Dropped */
	private async parseListNovels(): Promise<Manga[]> {
		const html = await this.fetchHtml('/list-novels/');
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('a[href*="/series/"]').each((_, el) => {
			const href = $(el).attr('href') || '';
			if (!href || !/\/series\/[^/]+\/?$/.test(pathOnly(href))) return;
			if (/\/series\/page\//.test(href) || href.endsWith('/series/')) return;

			const id = pathOnly(href);
			if (seen.has(id)) return;
			seen.add(id);

			const title = ($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim();
			if (!title || title.length < 3) return;

			// Status dari section parent (On-going / Completed / Dropped)
			const parentText = $(el).closest('ul, ol, div, section').prev('h2, h3, h4').text() || '';
			let status: string | undefined;
			if (/on[- ]?going/i.test(parentText)) status = 'Ongoing';
			else if (/completed|complete/i.test(parentText)) status = 'Completed';
			else if (/dropped/i.test(parentText)) status = 'Dropped';

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

	/** Parse /latest-releases/ (+ pagination) → group by series */
	private async parseLatestReleases(page: number): Promise<Manga[]> {
		const path =
			page <= 1 ? '/latest-releases/' : `/latest-releases/page/${page}/`;
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);
		const map = new Map<string, Manga>();

		// Struktur umum: item berisi link chapter + link/nama series di kategori
		$('article, .wp-block-post, .post, li, .entry').each((_, el) => {
			const root = $(el);

			// Link series
			let seriesA =
				root.find('a[href*="/series/"]').first().length > 0
					? root.find('a[href*="/series/"]').first()
					: null;

			// Fallback: categories link
			if (!seriesA || !seriesA.length) {
				const cat = root.find('a[rel="category tag"], .cat-links a, .categories a').first();
				if (cat.length && /\/series\//.test(cat.attr('href') || '')) {
					seriesA = cat;
				}
			}

			const seriesHref = seriesA?.attr('href') || '';
			if (!seriesHref || !/\/series\/[^/]+/.test(seriesHref)) return;

			const id = pathOnly(seriesHref);
			const title =
				(seriesA?.attr('title') || seriesA?.text() || '')
					.replace(/\s+/g, ' ')
					.trim() ||
				id.replace(/^\/series\//, '').replace(/-/g, ' ');

			if (!title || title.length < 3) return;

			const chText =
				root.find('a[href*="chapter"], h2 a, h3 a, .entry-title a').first().text() ||
				root.find('h2, h3, .entry-title').first().text() ||
				'';
			const latestChapter = extractChapterNum(chText);

			const cover =
				root.find('img').attr('data-src') ||
				root.find('img').attr('src') ||
				'';

			if (!map.has(id)) {
				map.set(id, {
					id,
					title: title.replace(/\s+/g, ' ').trim(),
					cover: absUrl(this.baseUrl, (cover || '').split('?')[0]),
					sourceId: this.id,
					type: 'novel',
					lang: 'en',
					...(latestChapter != null ? { latestChapter } : {})
				});
			} else if (latestChapter != null) {
				const existing = map.get(id)!;
				const prev =
					typeof existing.latestChapter === 'number'
						? existing.latestChapter
						: extractChapterNum(String(existing.latestChapter ?? '')) ?? 0;
				if (latestChapter > prev) {
					existing.latestChapter = latestChapter;
				}
			}
		});

		// Fallback lebih longgar: semua link /series/
		if (map.size < 5) {
			$('a[href*="/series/"]').each((_, el) => {
				const href = $(el).attr('href') || '';
				if (!href || !/\/series\/[^/]+\/?$/.test(pathOnly(href))) return;
				const id = pathOnly(href);
				if (map.has(id)) return;
				const title = ($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim();
				if (!title || title.length < 3) return;
				map.set(id, {
					id,
					title,
					cover: '',
					sourceId: this.id,
					type: 'novel',
					lang: 'en'
				});
			});
		}

		return Array.from(map.values());
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = encodeURIComponent(query);
		const paths =
			page <= 1
				? [`/?s=${q}`, `/page/1/?s=${q}`]
				: [`/page/${page}/?s=${q}`, `/?s=${q}&paged=${page}`];

		for (const path of paths) {
			try {
				const html = await this.fetchHtml(path);
				const $ = cheerio.load(html);
				const list: Manga[] = [];
				const seen = new Set<string>();

				// Hasil search biasanya post chapter → ambil series-nya
				$('article, .post, .wp-block-post, .entry').each((_, el) => {
					const root = $(el);
					const seriesA = root.find('a[href*="/series/"]').first();
					const href = seriesA.attr('href') || '';
					if (!href || !/\/series\/[^/]+/.test(href)) return;
					const id = pathOnly(href);
					if (seen.has(id)) return;
					seen.add(id);

					const title =
						(seriesA.attr('title') || seriesA.text() || root.find('h2, h3').first().text())
							.replace(/\s+/g, ' ')
							.trim();
					if (!title || title.length < 3) return;

					const cover =
						root.find('img').attr('data-src') || root.find('img').attr('src') || '';

					list.push({
						id,
						title,
						cover: absUrl(this.baseUrl, (cover || '').split('?')[0]),
						sourceId: this.id,
						type: 'novel',
						lang: 'en'
					});
				});

				// Langsung link series di hasil
				$('a[href*="/series/"]').each((_, el) => {
					const href = $(el).attr('href') || '';
					if (!href || !/\/series\/[^/]+\/?$/.test(pathOnly(href))) return;
					const id = pathOnly(href);
					if (seen.has(id)) return;
					seen.add(id);
					const title = ($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim();
					if (!title || title.length < 3) return;
					list.push({
						id,
						title,
						cover: '',
						sourceId: this.id,
						type: 'novel',
						lang: 'en'
					});
				});

				if (list.length) return list;
			} catch {
				/* next */
			}
		}
		return [];
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		if (!path.includes('/series/')) {
			path = `/series${path.startsWith('/') ? path : `/${path}`}`;
		}
		path = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			$('h1.wp-block-post-title, h1.entry-title, h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/[|\-–]/)[0].trim() ||
			$('title').text().split(/[|\-–]/)[0].trim();

		if (!title || title.length < 2) {
			throw new Error('Novel not found (empty title)');
		}

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('meta[name="twitter:image"]').attr('content') ||
			$('.wp-block-post-featured-image img, .post-thumbnail img, article img')
				.first()
				.attr('src') ||
			'';
		cover = (cover || '').split('?')[0];

		// Synopsis
		let description = '';
		const synBlock = $('h5, h4, h3, strong, b')
			.filter((_, el) => /synopsis/i.test($(el).text()))
			.first();
		if (synBlock.length) {
			const parts: string[] = [];
			let node = synBlock.parent().next();
			// kadang synopsis langsung di sibling p
			if (!node.length) node = synBlock.next();
			for (let i = 0; i < 15 && node.length; i++) {
				const tag = (node.prop('tagName') || '').toLowerCase();
				if (/^h[1-6]$/.test(tag) && /chapter|link|detail/i.test(node.text())) break;
				const t = node.text().replace(/\s+/g, ' ').trim();
				if (t.length > 30) parts.push(t);
				node = node.next();
			}
			description = parts.join('\n\n');
		}
		if (!description) {
			description =
				$('meta[property="og:description"]').attr('content') ||
				$('.entry-content p, .wp-block-post-content p')
					.map((_, p) => $(p).text().trim())
					.get()
					.filter((t) => t.length > 40)
					.slice(0, 8)
					.join('\n\n') ||
				'';
		}

		const authors: string[] = [];
		const genres: string[] = [];
		let status = 'Ongoing';

		// Details block: Author: ... Genre: ...
		$('h5, h4, strong, b, p, li').each((_, el) => {
			const text = $(el).text().replace(/\s+/g, ' ').trim();
			const low = text.toLowerCase();
			if (/^author\s*:/i.test(text)) {
				const name = text.replace(/^author\s*:\s*/i, '').trim();
				if (name && name.length < 80 && !authors.includes(name)) authors.push(name);
			} else if (/^genre\s*:/i.test(text)) {
				const raw = text.replace(/^genre\s*:\s*/i, '');
				for (const g of raw.split(/[,/|]/)) {
					const t = g.trim();
					if (t && t.length < 50 && !genres.includes(t)) genres.push(t);
				}
			} else if (/status\s*:/i.test(low)) {
				const s = text.replace(/status\s*:\s*/i, '').trim();
				if (s) status = s;
			}
		});

		// Chapters — list di halaman series
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		// Prefer list setelah heading "Chapter"
		const chapterHeading = $('h5, h4, h3, h2, strong')
			.filter((_, el) => /^chapter/i.test($(el).text().trim()))
			.first();

		const scope = chapterHeading.length
			? chapterHeading.parent().nextAll().addBack()
			: $.root();

		scope.find('a').each((i, el) => {
			const href = $(el).attr('href') || '';
			if (!href) return;
			// Chapter path biasanya bukan /series/
			if (/\/series\//.test(href)) return;
			// Harus same-domain path yang terlihat chapter-like
			const p = pathOnly(href);
			if (p === '/' || p === pathOnly(path)) return;
			// Hindari nav, donate, dll
			if (/\/(notice|donate|category|tag|author|page)\//i.test(p)) return;

			const rawTitle = ($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim();
			if (!rawTitle || rawTitle.length < 2) return;
			if (!/chapter|ch\.?\s*\d|prologue|epilogue|volume/i.test(rawTitle) && i > 5) {
				// longgar di awal, ketat setelahnya
				if (!/\d/.test(rawTitle)) return;
			}

			const num = parseChapterNumber(rawTitle, chapters.length + 1);
			const id = p;
			if (seen.has(id)) return;
			seen.add(id);

			chapters.push({
				id,
				title: rawTitle.length > 80 ? `Chapter ${num}` : rawTitle,
				number: num
			});
		});

		// Fallback: semua link yang path-nya mengandung angka / chapter-like
		if (chapters.length < 3) {
			$('a[href]').each((i, el) => {
				const href = $(el).attr('href') || '';
				const p = pathOnly(href);
				if (!p || /\/series\//.test(p)) return;
				if (!/\/[a-z0-9-]+\/[a-z0-9-]+\d/i.test(p) && !/chapter/i.test(p)) return;
				if (/\/(notice|donate|category|tag|author|page|list-novels|latest)\//i.test(p))
					return;
				const rawTitle = ($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim();
				if (!rawTitle || rawTitle.length < 2) return;
				const num = parseChapterNumber(rawTitle, i + 1);
				if (seen.has(p)) return;
				seen.add(p);
				chapters.push({ id: p, title: rawTitle, number: num });
			});
		}

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
			authors,
			status,
			genres,
			chapters,
			type: 'novel',
			lang: 'en'
		};
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

		const title =
			$('h1.wp-block-post-title, h1.entry-title, h1, h2').first().text().trim() ||
			$('title').text().split(/[|\-–]/)[0].trim() ||
			'Chapter';

		// Hapus noise
		const contentRoot = $(
			'.entry-content, .wp-block-post-content, article .content, .post-content, article'
		).first();
		const clone = contentRoot.length ? contentRoot.clone() : $('body').clone();

		clone
			.find(
				'script, style, iframe, noscript, .ads, .ad, nav, .nav, .sharedaddy, .comments, #comments, .wp-block-comments, form, .donate, .code-block, .post-views, .entry-meta, header, footer, .wp-block-group.has-background'
			)
			.remove();

		const parts: string[] = [];
		clone.find('p').each((_, p) => {
			const t = $(p).text().replace(/\s+/g, ' ').trim();
			if (!t || t.length < 15) return;
			if (
				/tinytranslation|please bookmark|thanks for reading|donate us|post views|edited by|kanaa-senpai|leave a reply|your email address/i.test(
					t
				)
			)
				return;
			parts.push(`<p>${escapeHtml(t)}</p>`);
		});

		let contentHtml = parts.length >= 2 ? parts.join('\n') : '';

		if (!contentHtml || contentHtml.length < 80) {
			// Fallback: ambil text node panjang
			const raw = clone
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			if (raw.length > 200) {
				const paras = raw
					.split(/(?<=[.!?])\s+(?=[A-Z“"])/)
					.filter((s) => s.length > 40)
					.slice(0, 80);
				contentHtml = paras.map((s) => `<p>${escapeHtml(s.trim())}</p>`).join('\n');
			}
		}

		// Prev / Next (WordPress sering pakai rel atau teks)
		const prevHref =
			$('a[rel="prev"]').attr('href') ||
			$('a:contains("Previous"), a:contains("Prev"), a:contains("«")').first().attr('href');
		const nextHref =
			$('a[rel="next"]').attr('href') ||
			$('a:contains("Next"), a:contains("»")').first().attr('href');

		return {
			title,
			content:
				contentHtml ||
				'<p><em>Konten kosong — selector berubah atau halaman terproteksi.</em></p>',
			prevChapterId: prevHref ? pathOnly(prevHref) : null,
			nextChapterId: nextHref ? pathOnly(nextHref) : null
		};
	}
}

export default TinyTranslationSource;