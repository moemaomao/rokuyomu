import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

/**
 * pixhentai.com adapter (WordPress HTML scrape)
 *
 * List   : /  |  /page/{n}/   (~8/page → ambil 3 page utk 24)
 * Search : /?s=QUERY
 * Detail : /{slug}/
 * Pages  : .entry-content img (img.openhentai.net)
 *
 * Satu post = satu komik (tanpa multi-chapter).
 * Chapter sintetis: id sama dengan manga id.
 *
 * ID format:
 *   manga   : "/{slug}"
 *   chapter : "/{slug}"
 */
export class PixHentaiSource extends BaseSource {
	id = 'pixhentai';
	name = 'PixHentai';
	baseUrl = 'https://pixhentai.com';

	private readonly PER_PAGE = 24;
	private readonly SITE_PER_PAGE = 8;

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

	private isMangaPath(id: string): boolean {
		if (!id || id === '/') return false;
		if (
			/^\/(page|genre|category|tag|feed|wp-|author|comments)\b/i.test(id)
		)
			return false;
		return /^\/[a-z0-9][a-z0-9-]{1,200}$/i.test(id);
	}

	// ── List ─────────────────────────────────────────────────────────────────

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		$('article.post, article.grid-entry, article').each((_, el) => {
			const $el = $(el);
			const a =
				$el.find('a.thumbnail-link').first().length
					? $el.find('a.thumbnail-link').first()
					: $el.find('.entry-title a, h2 a, h3 a').first().length
						? $el.find('.entry-title a, h2 a, h3 a').first()
						: $el.find('a[href*="pixhentai.com/"]').first();

			const href = a.attr('href') || '';
			const id = this.cleanId(href);
			if (!this.isMangaPath(id) || seen.has(id)) return;
			seen.add(id);

			const title = (
				$el.find('.entry-title a, h2 a, h3 a').first().text() ||
				a.attr('title') ||
				$el.find('img').attr('alt') ||
				''
			)
				.replace(/\s+/g, ' ')
				.trim();
			if (!title || title.length < 2) return;

			const cover =
				$el.find('img').attr('data-src') ||
				$el.find('img').attr('src') ||
				'';

			out.push({
				id,
				sourceId: this.id,
				title,
				cover: this.absUrl((cover || '').split('?')[0]),
				type: 'manga',
				status: 'Completed'
			});
		});

		return out;
	}

	private async fetchListPage(path: string): Promise<Manga[]> {
		try {
			const html = await this.fetchHtml(path);
			if (!html || html.length < 500) return [];
			const $ = cheerio.load(html);
			const list = this.parseCards($);
			console.log(`[pixhentai] ${path} → ${list.length}`);
			return list;
		} catch (e) {
			console.warn('[pixhentai] fetchListPage', path, e);
			return [];
		}
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const pagesNeeded = Math.ceil(this.PER_PAGE / this.SITE_PER_PAGE);
			const startSite = (p - 1) * pagesNeeded + 1;

			const seen = new Set<string>();
			const merged: Manga[] = [];

			for (let i = 0; i < pagesNeeded + 1 && merged.length < this.PER_PAGE; i++) {
				const sitePage = startSite + i;
				const path = sitePage <= 1 ? `/` : `/page/${sitePage}/`;
				const batch = await this.fetchListPage(path);
				if (!batch.length) break;
				for (const m of batch) {
					if (seen.has(m.id)) continue;
					seen.add(m.id);
					merged.push(m);
					if (merged.length >= this.PER_PAGE) break;
				}
			}

			console.log(`[pixhentai] latest page=${p} → ${merged.length}`);
			return merged.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[pixhentai] getLatestManga', e);
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
					? `/?s=${encodeURIComponent(q)}`
					: `/page/${page}/?s=${encodeURIComponent(q)}`;
			const list = await this.fetchListPage(path);
			console.log(`[pixhentai] search "${q}" → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[pixhentai] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const path = this.cleanId(mangaId);
		if (!this.isMangaPath(path)) {
			throw new Error(`Invalid pixhentai id: ${mangaId}`);
		}

		const html = await this.fetchHtml(path + '/');
		const $ = cheerio.load(html);

		let title =
			$('h1.entry-title, h1.single-post-title, h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content') ||
			path.slice(1);
		title = title
			.replace(/\s*[-|].*PixHentai.*$/i, '')
			.replace(/\s+/g, ' ')
			.trim();

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('img.wp-post-image').attr('src') ||
			$('.entry-content img').first().attr('src') ||
			'';
		cover = this.absUrl((cover || '').split('?')[0]);

const genres: string[] = [];
$('li.meta-cat a[rel="category tag"], .meta-cat a[rel="category tag"]').each(
	(_, a) => {
		const g = $(a).text().replace(/\s+/g, ' ').trim();
		if (
			g &&
			g.length < 40 &&
			!genres.includes(g) &&
			!/^(uncategorized|genre|post category)$/i.test(g)
		) {
			genres.push(g);
		}
	}
);

if (!genres.length) {
	$('a[rel="category tag"]').each((_, a) => {
		
		const $a = $(a);
		if ($a.closest('nav, .menu, .navbar, #menu, .main-menu, .sidebar-menu').length)
			return;
		const g = $a.text().replace(/\s+/g, ' ').trim();
		if (
			g &&
			g.length < 40 &&
			!genres.includes(g) &&
			!/^(uncategorized|genre)$/i.test(g)
		) {
			genres.push(g);
		}
	});
}

		let synopsis = '';
		$('.entry-content p, .single-content p').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (t.length > 40 && !synopsis) synopsis = t;
		});

		const chapters: Chapter[] = [
			{
				id: path,
				title: 'Chapter 1',
				number: 1
			}
		];

		const description = [
			genres.length && `Genres: ${genres.join(', ')}`,
			synopsis
		]
			.filter(Boolean)
			.join('\n\n');

		console.log(
			`[pixhentai] details ${path} → genres=${genres.length}`
		);

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			type: 'manga',
			status: 'Completed',
			description,
			authors: [],
			genres,
			chapters,
			latestChapter: 1
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		if (!this.isMangaPath(path)) {
			console.error('[pixhentai] invalid chapter id', chapterId);
			return [];
		}

		try {
			const html = await this.fetchHtml(path + '/');
			const $ = cheerio.load(html);
			const urls: string[] = [];
			const seen = new Set<string>();

			const pick = (src: string) => {
				if (!src || src.startsWith('data:')) return;
				src = this.absUrl(src.split('?')[0]);
				if (!/^https?:\/\//i.test(src)) return;
				if (
					/logo|icon|avatar|emoji|banner|wp-content\/uploads\/2019|pixhentai-logo/i.test(
						src
					)
				)
					return;
				
				if (seen.has(src)) return;
				seen.add(src);
				urls.push(src);
			};

			$(
				'.entry-content img, .single-content img, article .entry img'
			).each((_, img) => {
				const $img = $(img);
				const src =
					$img.attr('data-full-url') ||
					$img.attr('data-large_image') ||
					$img.attr('data-src') ||
					$img.attr('src') ||
					'';
			
				if ($img.hasClass('wp-post-image') && urls.length > 0) return;
				pick(src);
			});

		
			const cdn = urls.filter((u) => /openhentai\.net|img\./i.test(u));
			const finalUrls = cdn.length >= Math.min(3, urls.length) ? cdn : urls;

			console.log(`[pixhentai] ${finalUrls.length} pages → ${path}`);
			return finalUrls;
		} catch (e) {
			console.error('[pixhentai] getChapterPages', path, e);
			return [];
		}
	}
}
