import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

/**
 * Areakomik adapter (https://areakomik.com)
 * Komik dewasa Indo — custom theme (bukan Madara/Themesia murni)
 *
 * Latest  : /  |  /page/{n}/
 * Search  : /?s={q}
 * Detail  : /series/{slug}/
 * Chapter : /chapter/{slug}-chapter-{n}/
 * Pages   : img.chapter-img
 *
 * ID format:
 *   manga   : /series/{slug}
 *   chapter : /chapter/{slug}-chapter-{n}
 */
export class AreakomikSource extends BaseSource {
	id = 'areakomik';
	name = 'Areakomik';
	baseUrl = 'https://areakomik.com';

	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'id';

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
		return id.replace(/\/+$/, '').split('?')[0] || '/';
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath = path.match(/chapter[_-]?(\d+(?:\.\d+)?)(?:[_-]end)?/i);
		if (fromPath) return parseFloat(fromPath[1]);

		const m = String(text).match(
			/(?:chapter|chap|ch\.?)\s*(\d+)(?:[.,](\d+))?/i
		);
		if (m) {
			if (m[2] != null) return parseFloat(`${m[1]}.${m[2]}`);
			return parseInt(m[1], 10);
		}
		const n = String(text).match(/\b(\d+(?:\.\d+)?)\b/);
		return n ? parseFloat(n[1]) : 0;
	}

	private mapStatus(raw: string): string {
		const s = String(raw || '').toLowerCase();
		if (/complet|tamat|end|finished/.test(s)) return 'Completed';
		if (/hiatus/.test(s)) return 'Hiatus';
		if (/drop|cancel/.test(s)) return 'Dropped';
		return 'Ongoing';
	}

	private detectType(text: string): string {
		const t = (text || '').toLowerCase();
		if (/\bmanhwa\b/.test(t)) return 'manhwa';
		if (/\bmanhua\b/.test(t)) return 'manhua';
		if (/\btoon\b/.test(t)) return 'manhwa';
		if (/\blokal\b/.test(t)) return 'manga';
		return 'manga';
	}

	private preferFullCover(url: string): string {
		if (!url) return '';
		return url.replace(/-\d+x\d+(\.\w+)(\?.*)?$/, '$1$2');
	}

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		const push = (
			href: string,
			title: string,
			cover: string,
			typeText = '',
			statusText = '',
			chText = ''
		) => {
			const id = this.cleanId(href);
			if (!/^\/series\/[^/]+$/i.test(id)) return;
			if (seen.has(id)) return;
			seen.add(id);

			title = (title || '').replace(/\s+/g, ' ').trim();
			if (!title || title.length < 2) return;

			const n = this.parseChapterNumber(chText);
			out.push({
				id,
				sourceId: this.id,
				title,
				cover: this.preferFullCover(this.absUrl((cover || '').split('?')[0])),
				type: this.detectType(typeText),
				status: this.mapStatus(statusText),
				latestChapter: n > 0 ? String(n) : undefined,
				lang: this.DEFAULT_LANG
			});
		};

		// Kartu utama homepage / list
		$('article.komik-card, .komik-card').each((_, el) => {
			const $el = $(el);
			const a =
				$el.find('h3.card-title a[href*="/series/"]').first().length
					? $el.find('h3.card-title a[href*="/series/"]').first()
					: $el.find('a[href*="/series/"]').first();
			const href = a.attr('href') || '';
			const title =
				a.text() ||
				a.attr('title') ||
				$el.find('img').attr('alt') ||
				'';
			const cover =
				$el.find('img').attr('src') ||
				$el.find('img').attr('data-src') ||
				'';
			const typeText =
				$el.find('.type-badge').text() ||
				$el.find('[class*="type-"]').first().attr('class') ||
				'';
			const statusText =
				$el.find('.status-badge').text() ||
				$el.find('[class*="status"]').first().text() ||
				'';
			const chText =
				$el.find('a.chapter-link, .chapter-row a, a[href*="/chapter/"]')
					.first()
					.text() || '';
			push(href, title, cover, typeText, statusText, chText);
		});

		// Fallback: semua link /series/
		if (!out.length) {
			$('a[href*="/series/"]').each((_, el) => {
				const $a = $(el);
				const href = $a.attr('href') || '';
				if (!/\/series\/[^/]+\/?$/i.test(href.split('?')[0])) return;
				const title = ($a.attr('title') || $a.text() || '')
					.replace(/\s+/g, ' ')
					.trim();
				if (!title || title.length < 3) return;
				const $parent = $a.closest(
					'article, .komik-card, .card, li, div'
				);
				const cover =
					$parent.find('img').attr('src') ||
					$parent.find('img').attr('data-src') ||
					$a.find('img').attr('src') ||
					'';
				push(href, title, cover);
			});
		}

		return out;
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const path = p <= 1 ? `/` : `/page/${p}/`;
			const html = await this.fetchHtml(path);
			const list = this.parseCards(cheerio.load(html)).slice(
				0,
				this.PER_PAGE
			);
			console.log(`[areakomik] latest page=${p} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[areakomik] getLatestManga', e);
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
			const html = await this.fetchHtml(path);
			const list = this.parseCards(cheerio.load(html)).slice(
				0,
				this.PER_PAGE
			);
			console.log(`[areakomik] search "${q}" page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[areakomik] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);

		// Resolve dari chapter path → series
		if (/^\/chapter\//i.test(path)) {
			const m = path.match(
				/^\/chapter\/(.+?)-chapter-[\d.]+(?:-end)?$/i
			);
			if (m?.[1]) path = `/series/${m[1]}`;
		}

		if (!/^\/series\/[^/]+$/i.test(path)) {
			throw new Error(`Invalid areakomik id: ${mangaId}`);
		}

		const html = await this.fetchHtml(path + '/');
		const $ = cheerio.load(html);

		let title =
			$('h1, .series-title, .entry-title').first().text().trim() ||
			$('meta[property="og:title"]').attr('content') ||
			path;
		title = title
			.replace(/\s*[-|].*areakomik.*$/i, '')
			.replace(/\s*Bahasa Indonesia.*$/i, '')
			.replace(/\s+/g, ' ')
			.trim();

		let cover =
			$('.series-thumb img, .thumb img').first().attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = this.preferFullCover(this.absUrl((cover || '').split('?')[0]));

		const metaText = $('.series-meta, .series-info, .meta-item')
			.text()
			.replace(/\s+/g, ' ');

		let type = this.detectType(metaText);
		const typeMatch = metaText.match(/Type\s*:\s*(\w+)/i);
		if (typeMatch) type = this.detectType(typeMatch[1]);

		let status = this.mapStatus(metaText);
		const statusMatch = metaText.match(/Status\s*:\s*(\w+)/i);
		if (statusMatch) status = this.mapStatus(statusMatch[1]);

		const authors: string[] = [];
		$('a[href*="/author/"]').each((_, a) => {
			const n = $(a).text().replace(/\s+/g, ' ').trim();
			if (n && !authors.includes(n)) authors.push(n);
		});
		const authorMatch = metaText.match(/Author\s*:\s*([^]+?)(?:Genre|Total|$)/i);
		if (authorMatch && !authors.length) {
			authorMatch[1]
				.split(/,|\//)
				.map((s) => s.trim())
				.filter(Boolean)
				.forEach((n) => {
					if (!authors.includes(n)) authors.push(n);
				});
		}

		const genres: string[] = [];
		$('a[href*="/genre/"], .genre-list a').each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		const synopsis =
			$('.series-sinopsis, .sinopsis, .entry-content')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() || '';

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('a.chapter-link, .chapter-row a[href*="/chapter/"], a[href*="/chapter/"]').each(
			(_, a) => {
				const $a = $(a);
				const href = $a.attr('href') || '';
				if (!/\/chapter\//i.test(href)) return;
				if (/\/series\//i.test(href)) return;

				const cid = this.cleanId(href);
				if (seen.has(cid)) return;
				seen.add(cid);

				const text = $a.text().replace(/\s+/g, ' ').trim();
				const number =
					this.parseChapterNumber(cid) || this.parseChapterNumber(text);
				if (!number && !/chapter|ch\./i.test(text)) return;

				let date = '';
				const $row = $a.closest('.chapter-row, li, tr, div');
				const dateEl = $row
					.find('.update-time, .chapter-date, time')
					.text()
					.trim();
				if (dateEl) date = dateEl;
				else {
					const parentText = $row.text().replace(/\s+/g, ' ').trim();
					const dm = parentText.match(/\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}/);
					if (dm) date = dm[0];
				}

				chapters.push({
					id: cid,
					title: text || `Chapter ${number}`,
					number: number || 0,
					date: date || undefined
				});
			}
		);

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));
		const latestChapter =
			chapters.length > 0 ? String(chapters[0].number) : undefined;

		const description = [
			authors.length && `Author: ${authors.join(', ')}`,
			`Type: ${type}`,
			`Status: ${status}`,
			synopsis
		]
			.filter(Boolean)
			.join('\n');

		console.log(`[areakomik] details ${path} → ch=${chapters.length}`);

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			type,
			status,
			description,
			authors,
			genres,
			chapters,
			latestChapter,
			lang: this.DEFAULT_LANG
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		if (!/^\/chapter\//i.test(path)) {
			console.error('[areakomik] not a chapter path:', chapterId);
			return [];
		}

		try {
			const html = await this.fetchHtml(path + '/');
			const $ = cheerio.load(html);
			const urls: string[] = [];
			const seen = new Set<string>();

			const pick = (src: string) => {
				if (!src || src.startsWith('data:')) return;
				src = this.absUrl(src.split(/\s+/)[0].split('?')[0]);
				if (!/^https?:\/\//i.test(src)) return;
				if (
					/logo|icon|avatar|donasi|gravatar|banner|ads|betcoin|katsu|premium|gif$/i.test(
						src
					)
				)
					return;
				if (seen.has(src)) return;
				seen.add(src);
				urls.push(src);
			};

			// Primary: class chapter-img
			$('img.chapter-img').each((_, img) => {
				const $img = $(img);
				pick($img.attr('src') || $img.attr('data-src') || '');
			});

			if (!urls.length) {
				$(
					'#readerarea img, .readerarea img, .entry-content img, .reading-content img, article img'
				).each((_, img) => {
					const $img = $(img);
					pick($img.attr('src') || $img.attr('data-src') || '');
				});
			}

			// Prefer CDN chapter images
			const cdn = urls.filter((u) =>
				/gudangkomik|pic\.|cdn\.|r2\.dev/i.test(u)
			);
			const finalUrls = cdn.length ? cdn : urls;

			console.log(`[areakomik] ${finalUrls.length} pages → ${path}`);
			return finalUrls;
		} catch (e) {
			console.error('[areakomik] getChapterPages failed', path, e);
			return [];
		}
	}
}