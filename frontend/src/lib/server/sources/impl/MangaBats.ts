import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

/**
 * mangabats.xyz adapter (HTML scrape)
 *
 * List   : /updated  |  /updated?page={n}   (~30/page)
 * Search : /search?q=QUERY
 * Detail : /manga/{slug}
 * Chapters fragment: /manga/{slug}/chapters  (+ ?offset=)
 * Chapter: /read/{slug}/{lang}/chapter-{n}  |  /read/{slug}/{lang}/{uuid}
 * Pages  : <img src> di halaman chapter (CDN: uploads.mangadex.org / amzim.beer)
 *
 */
export class MangaBatsSource extends BaseSource {
	id = 'mangabats';
	name = 'MangaBats.xyz';
	baseUrl = 'https://mangabats.xyz';

	private readonly PER_PAGE = 24;
	private readonly LIST_LANG = 'en';

	// ── Helpers ──────────────────────────────────────────────────────────────

	private absUrl(url: string): string {
		if (!url) return '';
		if (url.startsWith('http')) return url;
		if (url.startsWith('//')) return `https:${url}`;
		return `${this.baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
	}

	private cleanId(link: string): string {
		let id = (link || '').trim();
		if (id.startsWith('http')) {
			try {
				id = new URL(id).pathname;
			} catch {
				/* ignore */
			}
		}
		if (!id.startsWith('/')) id = `/${id}`;
		return id.replace(/\/+$/, '') || '/';
	}

	private extractSlug(mangaId: string): string {
		const path = this.cleanId(mangaId);
		const m = path.match(/\/manga\/([^/]+)/);
		if (m) return m[1];
		const r = path.match(/\/read\/([^/]+)/);
		return r?.[1] || path.replace(/^\/+/, '');
	}

	private parseChapterNumber(text: string): number {
		const m = String(text).match(
			/(?:chapter|chap|ch\.?)\s*(\d+(?:\.\d+)?)/i
		);
		if (m) return parseFloat(m[1]);
		const n = String(text).match(/(\d+(?:\.\d+)?)/);
		return n ? parseFloat(n[1]) : 0;
	}

	// ── List parser ──────────────────────────────────────────────────────────

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		const process = ($el: cheerio.Cheerio<any>) => {
			const a =
				$el.find('a.cover').first().length
					? $el.find('a.cover').first()
					: $el.find('a.manga-title, h3 a[href*="/manga/"]').first();

			const href =
				a.attr('href') ||
				$el.find('a[href*="/manga/"]').first().attr('href') ||
				'';
			if (!href || !/\/manga\//i.test(href)) return;

			const id = this.cleanId(href);
			if (!/^\/manga\/[^/]+$/.test(id)) return;
			if (seen.has(id)) return;
			seen.add(id);

			let title =
				a.attr('title') ||
				$el.find('a.manga-title, h3 a').first().text() ||
				a.find('img').attr('alt') ||
				'';
			title = title.replace(/\s+/g, ' ').trim();
			if (!title) return;

			let cover =
				$el.find('img').attr('src') || $el.find('img').attr('data-src') || '';
			cover = this.absUrl((cover || '').split('?')[0]);
			if (/no-cover/i.test(cover)) cover = '';

			const chText =
				$el.find('.chapters a, a.sts, .chapter').first().text() ||
				$el.text().match(/chapter\s+\d+(?:\.\d+)?/i)?.[0] ||
				'';
			const latestChapter = this.parseChapterNumber(chText) || undefined;

			out.push({
				id,
				sourceId: this.id,
				title,
				cover,
				type: 'manga',
				status: 'Ongoing',
				latestChapter,
				lang: this.LIST_LANG
			});
		};

		if ($('.itemupdate').length) {
			$('.itemupdate').each((_, el) => process($(el)));
		} else {
			$('a.cover[href*="/manga/"]').each((_, a) => {
				const $a = $(a);
				const parent = $a.parent();
				const block =
					parent.find('.info, .manga-title').length > 0
						? parent
						: parent.parent();
				process(block.length ? block : parent);
			});
		}

		return out;
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const path = p <= 1 ? `/updated` : `/updated?page=${p}`;
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list = this.parseCards($).slice(0, this.PER_PAGE);
			console.log(`[mangabats] latest page=${p} → ${list.length} items`);
			return list;
		} catch (e) {
			console.error('[mangabats] getLatestManga', e);
			return [];
		}
	}

	async searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page || 1);
		if (!q) return this.getLatestManga(page, opts);

		try {
			const path =
				page <= 1
					? `/search?q=${encodeURIComponent(q)}`
					: `/search?q=${encodeURIComponent(q)}&page=${page}`;
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list = this.parseCards($).slice(0, this.PER_PAGE);
			console.log(`[mangabats] search "${q}" → ${list.length} items`);
			return list;
		} catch (e) {
			console.error('[mangabats] searchManga', e);
			return [];
		}
	}

	// ── Chapters (HTML fragment, paginated by offset) ────────────────────────

	private parseChapterListHtml(
		html: string,
		slug: string
	): { chapters: Chapter[]; hasMore: boolean; nextOffset: number } {
		const $ = cheerio.load(html);
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		const meta = $('.chapter-batch-meta').first();
		const hasMore = meta.attr('data-has-more') === 'true';
		const nextOffset = parseInt(meta.attr('data-next-offset') || '0', 10) || 0;

		$('li.row.item a[href*="/read/"], a[href*="/read/"]').each((_, a) => {
			const $a = $(a);
			const href = $a.attr('href') || '';
			if (!href.includes(`/read/${slug}/`)) return;
			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			const li = $a.closest('li.row.item, li.item');
			const dataNum = li.attr('data-number');
			const title =
				$a.attr('title') ||
				$a.text().replace(/\s+/g, ' ').trim() ||
				`Chapter ${dataNum || ''}`;
			const number =
				(dataNum && parseFloat(dataNum)) ||
				this.parseChapterNumber(title) ||
				this.parseChapterNumber(id);
			const date =
				li.find('span').last().text().trim() ||
				li.children('span').eq(2).text().trim() ||
				'';

			chapters.push({
				id,
				title,
				number: number || chapters.length + 1,
				date
			});
		});

		return { chapters, hasMore, nextOffset };
	}

	private async fetchAllChapters(slug: string): Promise<Chapter[]> {
		const all: Chapter[] = [];
		const seen = new Set<string>();
		let offset = 0;
		let guard = 0;

		while (guard < 30) {
			guard++;
			const path =
				offset <= 0
					? `/manga/${slug}/chapters`
					: `/manga/${slug}/chapters?offset=${offset}`;

			const html = await this.fetchHtml(path);
			const { chapters, hasMore, nextOffset } = this.parseChapterListHtml(
				html,
				slug
			);

			for (const ch of chapters) {
				if (seen.has(ch.id)) continue;
				seen.add(ch.id);
				all.push(ch);
			}

			if (!hasMore || !nextOffset || nextOffset <= offset) break;
			offset = nextOffset;
		}

		return all;
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) throw new Error(`Invalid mangabats id: ${mangaId}`);

		const detailPath = `/manga/${slug}`;
		const html = await this.fetchHtml(detailPath);
		const $ = cheerio.load(html);

		let title =
			$('h1, .manga-title, .story-info h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content') ||
			$('title').text().split(/[–|-]/)[0] ||
			slug;
		title = title
			.replace(/\s*Manga Comics.*$/i, '')
			.replace(/\s*[-|].*MangaBat.*$/i, '')
			.trim();

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('.manga-info img, .cover img, .story-info img').first().attr('src') ||
			'';
		cover = this.absUrl((cover || '').split('?')[0]);

		const altParts: string[] = [];
		$('.alternative span, li:contains("Alternative") span').each((_, el) => {
			const t = $(el).text().trim();
			if (t) altParts.push(t);
		});
		let alt = altParts.join(' · ');
		if (!alt) {
			$('li').each((_, li) => {
				const t = $(li).text();
				if (/alternative/i.test(t)) {
					alt = t
						.replace(/alternative\s*:?\s*/i, '')
						.replace(/\s+/g, ' ')
						.trim();
				}
			});
		}

		let status = 'Ongoing';
		let lastUpdate = '';
		$('li').each((_, li) => {
			const t = $(li).text();
			if (/Status\s*:/i.test(t) || /^\s*Status/i.test(t)) {
				const v = t.toLowerCase();
				if (/complete|finished|end/.test(v)) status = 'Completed';
				else if (/ongoing|publishing/.test(v)) status = 'Ongoing';
			}
			if (/last updated/i.test(t)) {
				lastUpdate = t.replace(/last updated\s*:?\s*/i, '').trim();
				if (lastUpdate === '—' || lastUpdate === '-') lastUpdate = '';
			}
		});

		const authors: string[] = [];
		$('a[href*="/author/"], .author a, li:contains("Author") a').each((_, a) => {
			const n = $(a).text().trim();
			if (n && !authors.includes(n)) authors.push(n);
		});

		const genres: string[] = [];
		$('a[href*="/genre/"], .genres a').each((_, a) => {
			const g = $(a).text().trim();
			if (g && !genres.includes(g) && g.length < 40) genres.push(g);
		});

		const synopsis =
			$('.summary, .panel-story-info-description, .description, #summary')
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('meta[name="description"]').attr('content') ||
			'';

		let chapters: Chapter[] = [];
		try {
			chapters = await this.fetchAllChapters(slug);
		} catch (e) {
			console.warn('[mangabats] chapters endpoint failed, fallback DOM', e);
			const seen = new Set<string>();
			$(`a[href*="/read/${slug}/"]`).each((_, a) => {
				const href = $(a).attr('href') || '';
				const id = this.cleanId(href);
				if (seen.has(id)) return;
				seen.add(id);
				const title = $(a).text().replace(/\s+/g, ' ').trim() || id;
				chapters.push({
					id,
					title,
					number: this.parseChapterNumber(title) || this.parseChapterNumber(id),
					date: ''
				});
			});
		}

		const latestChapter = chapters[0]?.number;
		const latestUpdate = lastUpdate || chapters[0]?.date || '';

		const description = [
			alt && `Alternative: ${alt}`,
			latestUpdate && `Latest update: ${latestUpdate}`,
			latestChapter != null && `Latest chapter: ${latestChapter}`,
			synopsis
		]
			.filter(Boolean)
			.join('\n\n');

		return {
			id: `/manga/${slug}`,
			sourceId: this.id,
			title,
			cover,
			type: 'manga',
			status,
			description,
			authors,
			genres,
			chapters,
			latestChapter
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		if (!path.includes('/read/')) {
			console.error(
				'[mangabats] getChapterPages → not a chapter path:',
				chapterId
			);
			return [];
		}

		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const urls: string[] = [];
			const seen = new Set<string>();

			$('img').each((_, img) => {
				let src =
					$(img).attr('src') ||
					$(img).attr('data-src') ||
					$(img).attr('data-original') ||
					'';
				if (!src || src.startsWith('data:')) return;
				src = this.absUrl(src.split('?')[0]);
				if (!/^https?:\/\//i.test(src)) return;
				if (
					/logo|icon|avatar|favicon|no-cover|googletag|fontawesome|sprite/i.test(
						src
					)
				) {
					return;
				}
				if (
					!/(mangadex\.org|amzim\.beer|mangabats|mghub|mkklcdnv|sv\d)/i.test(
						src
					) &&
					!/\.(jpe?g|png|webp)$/i.test(src)
				) {
					return;
				}
				if (seen.has(src)) return;
				seen.add(src);
				urls.push(src);
			});

			console.log(`[mangabats] ${urls.length} pages → ${path}`);
			return urls;
		} catch (e) {
			console.error('[mangabats] getChapterPages failed', path, e);
			return [];
		}
	}
}
