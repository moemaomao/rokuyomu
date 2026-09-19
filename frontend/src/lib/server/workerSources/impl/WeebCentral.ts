import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

/**
 * Weeb Central adapter (HTMX + SSR)
 *
 * Domain   : https://weebcentral.com
 * Latest   : GET /latest-updates/{page}  (HX-Request)  — paginated
 * Search   : GET /search/data?text=...  (HX-Request)
 * Detail   : GET /series/{seriesId}/...
 * Chapters : GET /series/{seriesId}/full-chapter-list  (HX-Request)
 * Pages    : GET /chapters/{chapterId}/images?reading_style=long_strip  (HX-Request)
 */
export class WeebCentralSource extends BaseSource {
	id = 'weebcentral';
	name = 'Weeb Central';
	baseUrl = 'https://weebcentral.com';

	private readonly PER_PAGE = 32;
	private readonly DEFAULT_LANG = 'en';
	private readonly COVER_CDN = 'https://temp.compsci88.com/cover';

	// ── HTTP ─────────────────────────────────────────────────────────────────

	private hxHeaders(referer?: string): Record<string, string> {
		return {
			...this.headers,
			Accept: '*/*',
			'HX-Request': 'true',
			Referer: referer || `${this.baseUrl}/`,
			'HX-Current-URL': referer || `${this.baseUrl}/`
		};
	}

	private async fetchHx(path: string, referer?: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const res = await fetch(url, { headers: this.hxHeaders(referer) });
		if (!res.ok) {
			throw new Error(`WeebCentral HTTP ${res.status} → ${url}`);
		}
		return await res.text();
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private extractSeriesId(mangaId: string): string {
		const parts = String(mangaId)
			.replace(/^\/+/, '')
			.split('/')
			.filter(Boolean);

		if (parts[0] === 'series' && parts[1]) return parts[1];
		return parts[0] || '';
	}

	private extractChapterId(chapterId: string): string {
		const parts = String(chapterId)
			.replace(/^\/+/, '')
			.split('/')
			.filter(Boolean);

		if (parts[0] === 'series' && parts[2] === 'chapters' && parts[3]) {
			return parts[3];
		}

		if (parts[0] === 'chapters' && parts[1]) return parts[1];
		return parts[parts.length - 1] || '';
	}

	private toMangaId(seriesId: string): string {
		return `/series/${seriesId}`;
	}

	private toChapterId(seriesId: string, chapterId: string): string {
		return `/series/${seriesId}/chapters/${chapterId}`;
	}

	private coverUrl(seriesId: string): string {
		return `${this.COVER_CDN}/normal/${seriesId}.webp`;
	}

	private slugToTitle(slug: string): string {
		return decodeURIComponent(slug || '')
			.replace(/[-_]+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	}

	private parseChapterNumber(text: string): number {
		const t = String(text || '');
		const m = t.match(
			/(?:chapter|chap|ch\.?|episode|ep\.?)\s*(\d+)(?:[.,](\d+))?/i
		);
		if (m) {
			if (m[2] != null) return parseFloat(`${m[1]}.${m[2]}`);
			return parseInt(m[1], 10);
		}
		return 0;
	}

	private extractChapterLabel($art: cheerio.Cheerio<any>): string {
		const full = $art.text().replace(/\s+/g, ' ').trim();
		const m = full.match(
			/(?:Chapter|Ch\.?|Chap|Episode|Ep\.?)\s*\d+(?:\.\d+)?/i
		);
		return m ? m[0].trim() : '';
	}

	private formatDate(iso?: string | null): string {
		if (!iso) return '';
		try {
			return new Date(iso).toISOString().slice(0, 10);
		} catch {
			return String(iso).slice(0, 10);
		}
	}

	private mapType(raw?: string): string {
		const t = String(raw || '').toLowerCase();
		if (t.includes('manhwa')) return 'manhwa';
		if (t.includes('manhua')) return 'manhua';
		if (t.includes('manga')) return 'manga';
		return 'manga';
	}

	private inferTypeFromLabel(label: string): string {
		if (/episode|ep\.?\s*\d/i.test(label)) return 'manhwa';
		return 'manga';
	}

	private mapStatus(raw?: string): string {
		const s = String(raw || '').toLowerCase();
		if (s.includes('complete')) return 'Completed';
		if (s.includes('hiatus')) return 'Hiatus';
		if (s.includes('cancel') || s.includes('drop')) return 'Dropped';
		return 'Ongoing';
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, page || 1);
			const html = await this.fetchHx(
				`/latest-updates/${p}`,
				`${this.baseUrl}/`
			);
			const $ = cheerio.load(html);
			const seen = new Set<string>();
			const list: Manga[] = [];

			$('article').each((_, art) => {
				const $art = $(art);
				const seriesA = $art
					.find('a[href*="/series/"]')
					.filter((_, a) => {
						const h = ($(a).attr('href') || '').toLowerCase();
						return /\/series\/[a-z0-9]+/i.test(h) && !h.includes('/random');
					})
					.first();
				const href = seriesA.attr('href') || '';
				const m = href.match(/\/series\/([A-Z0-9]+)(?:\/([^/?#]*))?/i);
				if (!m) return;
				const seriesId = m[1];
				if (!seriesId || seriesId.toLowerCase() === 'random') return;
				if (seen.has(seriesId)) return;
				seen.add(seriesId);

				const tip = ($art.attr('data-tip') || '').trim();
				const slugTitle = this.slugToTitle(m[2] || '');
				let title =
					tip ||
					$art.find('div.truncate, .font-semibold, .flex-1').first().text() ||
					seriesA.attr('title') ||
					slugTitle;
				title = title.replace(/\s+/g, ' ').trim();
				if (!title || title.length < 2) title = slugTitle || seriesId;

				const chLabel = this.extractChapterLabel($art);
				const chNum = this.parseChapterNumber(chLabel);
				const latestChapter = chNum ? String(chNum) : undefined;
				const type = this.inferTypeFromLabel(chLabel);

				list.push({
					id: this.toMangaId(seriesId),
					title,
					cover: this.coverUrl(seriesId),
					sourceId: this.id,
					type,
					status: 'Ongoing',
					latestChapter,
					lang: this.DEFAULT_LANG
				});
			});

			console.log(`[weebcentral] latest page=${p} → ${list.length} items`);
			return list;
		} catch (e) {
			console.error('[weebcentral] getLatestManga', e);
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
		if (page > 1) return [];

		try {
			const path =
				`/search/data?text=${encodeURIComponent(q)}` +
				`&sort=Best+Match&order=Descending&official=Any&display_mode=Full+Display`;
			const html = await this.fetchHx(path, `${this.baseUrl}/search`);
			const $ = cheerio.load(html);
			const seen = new Set<string>();
			const list: Manga[] = [];

			$('a[href*="/series/"]').each((_, el) => {
				const href = $(el).attr('href') || '';
				const m = href.match(/\/series\/([A-Z0-9]+)(?:\/([^/?#]*))?/i);
				if (!m) return;
				const seriesId = m[1];
				if (!seriesId || seriesId.toLowerCase() === 'random') return;
				if (seen.has(seriesId)) return;
				seen.add(seriesId);

				const slugTitle = this.slugToTitle(m[2] || '');
				let title = ($(el).text() || slugTitle).replace(/\s+/g, ' ').trim();
				if (!title || title.length < 2) title = slugTitle || seriesId;

				list.push({
					id: this.toMangaId(seriesId),
					title,
					cover: this.coverUrl(seriesId),
					sourceId: this.id,
					type: 'manga',
					status: 'Ongoing',
					lang: this.DEFAULT_LANG
				});
			});

			console.log(`[weebcentral] search "${q}" → ${list.length} items`);
			return list;
		} catch (e) {
			console.error('[weebcentral] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const seriesId = this.extractSeriesId(mangaId);
		if (!seriesId) throw new Error('WeebCentral: invalid mangaId');

		const seriesPath = `/series/${seriesId}`;
		const html = await this.fetchHtml(seriesPath);
		const $ = cheerio.load(html);

		const pageTitle = $('title').first().text() || '';
		const title = pageTitle
			.replace(/\s*\|\s*Weeb Central.*$/i, '')
			.replace(/\s+/g, ' ')
			.trim();

		let type = 'manga';
		let status = 'Ongoing';
		const authors: string[] = [];
		const genres: string[] = [];
		let description = '';

		$('li').each((_, li) => {
			const $li = $(li);
			const strong = $li.find('strong').first().text().trim();
			const body = $li
				.clone()
				.children('strong')
				.remove()
				.end()
				.text()
				.replace(/\s+/g, ' ')
				.trim();

			if (/^Author/i.test(strong)) {
				$li.find('a').each((__, a) => {
					const t = $(a).text().replace(/\s+/g, ' ').trim();
					if (t) authors.push(t);
				});
				if (!authors.length && body) {
					body.split(/[,&]/).forEach((s) => {
						const t = s.trim();
						if (t) authors.push(t);
					});
				}
			} else if (/^Tag/i.test(strong)) {
				$li.find('a').each((__, a) => {
					const t = $(a).text().replace(/\s+/g, ' ').trim();
					if (t) genres.push(t);
				});
			} else if (/^Type/i.test(strong)) {
				const linkText = $li.find('a').first().text().replace(/\s+/g, ' ').trim();
				type = this.mapType(linkText || body);
			} else if (/^Status/i.test(strong)) {
				const linkText = $li.find('a').first().text().replace(/\s+/g, ' ').trim();
				status = this.mapStatus(linkText || body);
			} else if (/^Description/i.test(strong)) {
				description = body;
			}
		});

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		try {
			const chHtml = await this.fetchHx(
				`${seriesPath}/full-chapter-list`,
				`${this.baseUrl}${seriesPath}`
			);
			const $ch = cheerio.load(chHtml);

			$ch('a[href*="/chapters/"]').each((_, a) => {
				const $a = $ch(a);
				const href = $a.attr('href') || '';
				const cm = href.match(/\/chapters\/([A-Z0-9]+)/i);
				if (!cm) return;
				const chapterId = cm[1];
				if (seen.has(chapterId)) return;
				seen.add(chapterId);

				const htmlInner = $a.html() || '';
				const labelMatch = htmlInner.match(
					/>\s*((?:Chapter|Ch\.?|Chap|Episode|Ep\.?)\s*\d+(?:\.\d+)?)\s*</i
				);
				const text = labelMatch
					? labelMatch[1].replace(/\s+/g, ' ').trim()
					: $a
							.clone()
							.find('svg, img, time, input, .link-info')
							.remove()
							.end()
							.text()
							.replace(/\s+/g, ' ')
							.replace(/\bLast Read\b/gi, '')
							.trim();

				const number = this.parseChapterNumber(text);
				const time =
					$a.find('time').attr('datetime') ||
					$a.closest('div').find('time').attr('datetime') ||
					'';

				chapters.push({
					id: this.toChapterId(seriesId, chapterId),
					title: text || `Chapter ${number}`,
					number: number || chapters.length + 1,
					date: this.formatDate(time) || undefined
				});
			});
		} catch (e) {
			console.error('[weebcentral] chapter list', e);
		}

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const latestChapter =
			chapters.length > 0 ? String(chapters[0].number) : undefined;

		return {
			id: this.toMangaId(seriesId),
			sourceId: this.id,
			title: title || seriesId,
			cover: this.coverUrl(seriesId),
			type,
			status,
			latestChapter,
			lang: this.DEFAULT_LANG,
			description,
			authors: [...new Set(authors)],
			genres: [...new Set(genres)],
			chapters
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		try {
			const id = this.extractChapterId(chapterId);
			if (!id) return [];

			const referer = `${this.baseUrl}/chapters/${id}`;
			const path =
				`/chapters/${id}/images?is_prev=False&current_page=1&reading_style=long_strip`;
			const html = await this.fetchHx(path, referer);
			const $ = cheerio.load(html);

			const pages: string[] = [];
			const seen = new Set<string>();

			$('img').each((_, img) => {
				const src =
					$(img).attr('src') ||
					$(img).attr('data-src') ||
					$(img).attr('srcset')?.split(/\s+/)[0];
				if (!src || src.startsWith('data:') || src.includes('broken_image'))
					return;
				if (src.includes('/static/images/')) return;
				const url = src.startsWith('http')
					? src
					: `${this.baseUrl}${src.startsWith('/') ? '' : '/'}${src}`;
				if (seen.has(url)) return;
				seen.add(url);
				pages.push(url);
			});

			console.log(`[weebcentral] getChapterPages ${id} → ${pages.length} pages`);
			return pages;
		} catch (e) {
			console.error('[weebcentral] getChapterPages', e);
			return [];
		}
	}
}
