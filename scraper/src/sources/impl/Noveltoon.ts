/**
 * Example Novel source adapter (template).
 * Adjust baseUrl + CSS selectors for the real novel site you want.
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../BaseSource.js';
import type {
	Novel,
	NovelDetails,
	NovelChapterContent,
	INovelSource
} from '../types-novel.js';
import type { Manga, MangaDetails } from '../types.js';

export class Noveltoon extends BaseSource implements INovelSource {
	id = 'noveltoon';
	name = 'Noveltoon';
	baseUrl = 'https://www.noveltoon.mobi';
	kind = 'novel' as const;

	async getLatestNovels(page = 1): Promise<Novel[]> {
		const html = await this.fetchHtml(`/library?page=${page}`);
		const $ = cheerio.load(html);
		const list: Novel[] = [];
		$('.novel-item, .book-item, .series-item').each((_, el) => {
			const a = $(el).find('a').first();
			const href = a.attr('href') || '';
			const id = href.startsWith('http') ? new URL(href).pathname : href;
			const title = a.attr('title') || $(el).find('.title, h3, .name').text().trim();
			const cover =
				$(el).find('img').attr('data-src') || $(el).find('img').attr('src') || '';
			if (id && title) {
				list.push({
					id,
					title,
					cover: cover.startsWith('//') ? `https:${cover}` : cover,
					sourceId: this.id,
					type: 'novel',
					lang: 'en'
				});
			}
		});
		return list;
	}

	async searchNovels(query: string, opts?: { page?: number }): Promise<Novel[]> {
		const page = opts?.page ?? 1;
		const html = await this.fetchHtml(
			`/search?keyword=${encodeURIComponent(query)}&page=${page}`
		);
		const $ = cheerio.load(html);
		const list: Novel[] = [];
		$('.novel-item, .book-item, .search-item').each((_, el) => {
			const a = $(el).find('a').first();
			const href = a.attr('href') || '';
			const id = href.startsWith('http') ? new URL(href).pathname : href;
			const title = a.attr('title') || $(el).find('.title, h3').text().trim();
			const cover =
				$(el).find('img').attr('data-src') || $(el).find('img').attr('src') || '';
			if (id && title) {
				list.push({
					id,
					title,
					cover: cover.startsWith('//') ? `https:${cover}` : cover,
					sourceId: this.id,
					type: 'novel'
				});
			}
		});
		return list;
	}

	async getNovelDetails(novelId: string): Promise<NovelDetails> {
		const path = novelId.startsWith('/') ? novelId : `/${novelId}`;
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			$('h1.title, .novel-title, .book-title').first().text().trim() ||
			$('title').text().split('|')[0].trim();
		const cover =
			$('.cover img, .novel-cover img').attr('data-src') ||
			$('.cover img, .novel-cover img').attr('src') ||
			'';
		const description = $('.description, .synopsis, #synopsis').text().trim();

		const authors: string[] = [];
		$('.author a, .authors a, [itemprop="author"]').each((_, el) => {
			authors.push($(el).text().trim());
		});

		const genres: string[] = [];
		$('.genres a, .tags a, .genre a').each((_, el) => {
			genres.push($(el).text().trim());
		});

		const status = $('.status, .novel-status').text().trim() || 'Ongoing';

		const chapters: NovelDetails['chapters'] = [];
		$('.chapter-list a, .chapters a, #chapter-list a').each((i, el) => {
			const href = $(el).attr('href') || '';
			const cid = href.startsWith('http') ? new URL(href).pathname : href;
			const ctitle = $(el).text().trim();
			if (cid && ctitle) {
				chapters.push({ id: cid, title: ctitle, number: i + 1 });
			}
		});

		return {
			id: novelId,
			title,
			cover: cover.startsWith('//') ? `https:${cover}` : cover,
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters,
			type: 'novel'
		};
	}

	async getChapterContent(chapterId: string): Promise<NovelChapterContent> {
		const path = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			$('h1.chapter-title, .chapter-title, h1').first().text().trim() || 'Chapter';

		let contentEl = $('.chapter-content, #chapter-content, .content, article').first();
		if (!contentEl.length) contentEl = $('body');
		contentEl.find('script, style, .ads, .ad').remove();
		const content = contentEl.html() || contentEl.text() || '';

		const prevHref = $('a.prev, .prev-chapter').attr('href');
		const nextHref = $('a.next, .next-chapter').attr('href');

		return {
			title,
			content,
			prevChapterId: prevHref
				? prevHref.startsWith('http')
					? new URL(prevHref).pathname
					: prevHref
				: null,
			nextChapterId: nextHref
				? nextHref.startsWith('http')
					? new URL(nextHref).pathname
					: nextHref
				: null
		};
	}

	// ── Manga interface stubs (required by BaseSource) ───────────────────────
	async getLatestManga(_page: number, _opts?: { lang?: string; type?: string }): Promise<Manga[]> {
		return [];
	}

	async searchManga(
		_query: string,
		_opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		return [];
	}

	async getMangaDetails(
		_mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		throw new Error('Noveltoon is a novel source, not manga');
	}

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}
}

export default Noveltoon;
