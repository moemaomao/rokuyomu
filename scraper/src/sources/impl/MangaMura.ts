
/**
 * MangaMura adapter (mangareader theme)
 *
 * Domain  : https://mangamura.me
 * Latest  : /latest-updated/?p=N
 * Search  : /?q={query}
 * Detail  : /manga/{slug}-raw/
 * Chapter : /manga/{slug}/ja/chapter-{n}-raw/
 * Pages   : /json/chapter?id={dataId}&mode=vertical  (HTML berisi .iv-card img)
 *
 * ID format:
 *   manga   : "/manga/{slug}-raw"
 *   chapter : "/manga/{slug}/ja/chapter-{n}-raw"
 *
 * Bahasa default: ja (raw JP)
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class MangaMuraSource extends BaseSource {
	id = 'mangamura';
	name = 'MangaMura';
	baseUrl = 'https://mangamura.me';

	private readonly DEFAULT_LANG = 'ja';

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
		// decode %XX agar id konsisten
		try {
			id = decodeURIComponent(id);
		} catch {
			/* ignore */
		}
		if (!id.startsWith('/')) id = `/${id}`;
		return id.replace(/\/+$/, '').split('?')[0] || '/';
	}

	private normalizeTitle(raw: string): string {
		return String(raw || '')
			.replace(/\s+/g, ' ')
			.replace(/\s*[-|]\s*(raw|mangamura).*$/i, '')
			.replace(/\s+raw$/i, '')
			.trim();
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath = path.match(/chapter[_-]?(\d+)(?:[.-](\d+))?/i);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null && fromPath[2].length <= 2) {
				return parseFloat(`${major}.${fromPath[2]}`);
			}
			return major;
		}
		// 第1189話 / 第67.5話
		const jp = String(text).match(/第\s*(\d+)(?:[.,．](\d+))?\s*話/);
		if (jp) {
			if (jp[2] != null) return parseFloat(`${jp[1]}.${jp[2]}`);
			return parseInt(jp[1], 10);
		}
		const m = String(text).match(
			/(?:chapter|chap|ch\.?|話)\s*(\d+)(?:[.,](\d+))?/i
		);
		if (m) {
			if (m[2] != null) return parseFloat(`${m[1]}.${m[2]}`);
			return parseInt(m[1], 10);
		}
		const n = String(text).match(/\b(\d+(?:\.\d+)?)\b/);
		return n ? parseFloat(n[1]) : 0;
	}

	/** slug dari manga id: "/manga/ワンピース-raw" → "ワンピース" */
	private mangaSlug(mangaId: string): string {
		const id = this.cleanId(mangaId);
		const m = id.match(/\/manga\/(.+?)(?:-raw)?$/i);
		if (m?.[1]) return m[1].replace(/-raw$/i, '');
		const parts = id.split('/').filter(Boolean);
		return (parts[parts.length - 1] || '').replace(/-raw$/i, '');
	}

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		$('.item.flw-item, .flw-item, .item-spc').each((_, el) => {
			const $el = $(el);
			const a =
				$el.find('a.manga-poster').first().length
					? $el.find('a.manga-poster').first()
					: $el
							.find('a[href*="/manga/"]')
							.filter((_, x) => {
								const h = ($(x).attr('href') || '').split('?')[0];
								return /\/manga\/[^/]+-raw\/?$/.test(h);
							})
							.first();

			const href = a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			let title =
				$el.find('.manga-name a, h3.manga-name a').first().attr('title') ||
				$el.find('.manga-name a, h3.manga-name').first().text() ||
				a.attr('title') ||
				$el.find('img').first().attr('alt') ||
				'';
			title = this.normalizeTitle(title);
			if (!title) return;

			const img = $el.find('img.manga-poster-img, img').first();
			let cover =
				img.attr('data-src') ||
				img.attr('data-lazy-src') ||
				img.attr('src') ||
				'';
			if (cover.startsWith('data:')) cover = img.attr('data-src') || '';
			cover = this.absUrl(cover);

			const chText = $el
				.find('.fd-list .chapter a, .fdl-item .chapter a')
				.first()
				.text();
			const latestChapter = chText
				? String(
						this.parseChapterNumber(chText) ||
							chText.replace(/\s+/g, ' ').trim()
					)
				: undefined;

			const langTick = $el
				.find('.tick-lang, .tick.tick-item')
				.first()
				.text()
				.trim()
				.toLowerCase();
			const lang =
				langTick === 'ja' || langTick === 'jp'
					? 'ja'
					: langTick === 'en'
						? 'en'
						: this.DEFAULT_LANG;

			res.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type: 'manga',
				status: 'Ongoing',
				latestChapter,
				lang
			});
		});

		return res;
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const path =
				p > 1 ? `/latest-updated/?p=${p}` : `/latest-updated/`;
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list = this.parseCards($);
			console.log(`[mangamura] latest page=${p} → ${list.length} items`);
			return list;
		} catch (e) {
			console.error('[mangamura] getLatestManga', e);
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
			// SearchAction: /?q={q}
			const path =
				page > 1
					? `/?q=${encodeURIComponent(q)}&page=${page}`
					: `/?q=${encodeURIComponent(q)}`;
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list = this.parseCards($);
			console.log(
				`[mangamura] search "${q}" page=${page} → ${list.length} items`
			);
			return list;
		} catch (e) {
			console.error('[mangamura] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const id = this.cleanId(mangaId);
		// pastikan path detail pakai -raw
		let path = id;
		if (!/-raw$/i.test(path) && !path.includes('/chapter-')) {
			path = `${path}-raw`;
		}
		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);
		const slug = this.mangaSlug(id);

		const title = this.normalizeTitle(
			$('h1.manga-name, h1, .anisc-detail h2, .manga-name').first().text() ||
				$('meta[property="og:title"]').attr('content') ||
				''
		);

		let cover =
			$('.manga-poster img, .anis-poster img, img.manga-poster-img')
				.first()
				.attr('data-src') ||
			$('.manga-poster img, .anis-poster img, img.manga-poster-img')
				.first()
				.attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		if (cover.startsWith('data:')) {
			cover =
				$('.manga-poster img').first().attr('data-src') ||
				$('meta[property="og:image"]').attr('content') ||
				'';
		}
		cover = this.absUrl(cover);

		const description = (
			$('.description, .manga-content .content, .anis-content .description')
				.first()
				.text() || ''
		)
			.replace(/\s+/g, ' ')
			.trim();

		const genres: string[] = [];
		$('a[href*="/genres/"]').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (t && !genres.includes(t)) genres.push(t);
		});

		let status = 'Ongoing';
		const statusText = $('.anisc-info, .manga-info, body').text();
		if (/Completed|完了|完結/i.test(statusText)) status = 'Completed';
		else if (/Hiatus/i.test(statusText)) status = 'Hiatus';

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		// li.item.reading-item.chapter-item[data-id][data-number]
		$('li.chapter-item, li.reading-item, ul.chapters-list-ul li').each(
			(_, li) => {
				const $li = $(li);
				const a = $li.find('a.item-link, a[href*="/chapter-"]').first();
				const href = a.attr('href') || '';
				if (!href) return;

				const chId = this.cleanId(href);
				if (seen.has(chId)) return;
				seen.add(chId);

				const dataNum = $li.attr('data-number') || '';
				const numText =
					$li.find('.name strong, .name').first().text() ||
					a.attr('title') ||
					a.text() ||
					dataNum;

				const number =
					(dataNum ? parseFloat(dataNum) : 0) ||
					this.parseChapterNumber(numText, chId);

				chapters.push({
					id: chId,
					title: numText.replace(/\s+/g, ' ').trim() || `第${number}話`,
					number: number || chapters.length + 1
				});
			}
		);

		// newest first
		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const latestChapter =
			chapters.length > 0 ? String(chapters[0].number) : undefined;

		return {
			id: this.cleanId(path),
			sourceId: this.id,
			title: title || slug,
			cover,
			type: 'manga',
			status,
			latestChapter,
			lang: this.DEFAULT_LANG,
			description,
			authors: [],
			genres,
			chapters
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		try {
			const path = this.cleanId(chapterId);
			const html = await this.fetchHtml(
				path.endsWith('/') ? path : `${path}/`
			);
			const $ = cheerio.load(html);

			// Ambil data-id chapter dari list (match href atau data-number)
			let dataId =
				$('li.chapter-item.active, li.reading-item.active').attr(
					'data-id'
				) || '';

			if (!dataId) {
				const target = path.replace(/\/+$/, '');
				$('li.chapter-item, li.reading-item').each((_, li) => {
					if (dataId) return;
					const $li = $(li);
					const href = this.cleanId(
						$li.find('a').first().attr('href') || ''
					);
					if (href === target || href.endsWith(target) || target.endsWith(href)) {
						dataId = $li.attr('data-id') || '';
					}
				});
			}

			// fallback: data-number dari path
			if (!dataId) {
				const n = this.parseChapterNumber('', path);
				if (n) {
					const $li = $(
						`li.chapter-item[data-number="${n}"], li.reading-item[data-number="${n}"]`
					).first();
					dataId = $li.attr('data-id') || '';
				}
			}

			if (!dataId) {
				console.error('[mangamura] getChapterPages → no data-id for', path);
				return [];
			}

			// API images
			const apiPath = `/json/chapter?id=${encodeURIComponent(dataId)}&mode=vertical`;
			const raw = await this.fetchHtml(apiPath);
			let payload: { status?: number; html?: string };
			try {
				payload = JSON.parse(raw);
			} catch {
				console.error('[mangamura] getChapterPages → invalid JSON', dataId);
				return [];
			}

			const pageHtml = payload?.html || '';
			const $p = cheerio.load(pageHtml);
			const pages: string[] = [];
			const seen = new Set<string>();

			$p('.iv-card img, img.image-vertical, img.lazyload, img').each(
				(_, img) => {
					const $img = $p(img);
					let src =
						$img.attr('data-src') ||
						$img.attr('data-lazy-src') ||
						$img.attr('src') ||
						'';
					if (!src || src.startsWith('data:')) return;
					src = this.absUrl(src.split('?')[0]);
					if (!src || seen.has(src)) return;
					if (/logo|icon|avatar|emoji|ads?|banner/i.test(src)) return;
					seen.add(src);
					pages.push(src);
				}
			);

			console.log(
				`[mangamura] getChapterPages ${path} (id=${dataId}) → ${pages.length} pages`
			);
			return pages;
		} catch (e) {
			console.error('[mangamura] getChapterPages', e);
			return [];
		}
	}
}