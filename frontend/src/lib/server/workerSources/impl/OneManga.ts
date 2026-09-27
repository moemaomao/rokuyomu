/**
 * 1Manga.co adapter (MangaHub family, source key mn03)
 *
 * GraphQL api.mghcdn.com dilindungi Cloudflare → scrape HTML.
 *
 * List/Latest : /updates/pages/{n}   (~30 item → ambil 24)
 * Search      : /search/page/{n}?q=
 * Detail      : /manga/{slug}
 * Chapter     : /chapter/{slug}/chapter-{num}
 * Pages       : HTML imgx + sequential probe di imgx.mghcdn.com
 *
 * ID format:
 *   manga   : "/manga/{slug}"
 *   chapter : "/manga/{slug}/chapter/{number}"
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class OneMangaSource extends BaseSource {
	id = 'onemanga';
	name = '1Manga';
	baseUrl = 'https://1manga.co';

	private readonly PER_PAGE = 24;
	private readonly THUMB_CDN = 'https://thumb.mghcdn.com';
	private readonly IMG_CDN = 'https://imgx.mghcdn.com';

	private reqHeaders(): Record<string, string> {
		return {
			...this.headers,
			Accept:
				'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
			'Accept-Language': 'en-US,en;q=0.9',
			Referer: `${this.baseUrl}/`
		};
	}

	private async getHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const res = await fetch(url, { headers: this.reqHeaders(), redirect: 'follow' });
		if (!res.ok) throw new Error(`1Manga HTTP ${res.status} ${path}`);
		return await res.text();
	}

	private absUrl(href: string): string {
		if (!href) return '';
		if (href.startsWith('http')) return href;
		if (href.startsWith('//')) return `https:${href}`;
		return `${this.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
	}

	private toMangaId(slug: string): string {
		return `/manga/${String(slug).replace(/^\/+|\/+$/g, '')}`;
	}

	private extractSlug(mangaId: string): string {
		const s = String(mangaId).replace(/^\/+/, '');
		const m = s.match(/^manga\/([^/]+)/i);
		if (m) return m[1]!;
		return s.split('/').filter(Boolean).pop() || '';
	}

	private toChapterId(slug: string, number: number | string): string {
		return `/manga/${slug}/chapter/${number}`;
	}

	private extractChapterParts(chapterId: string): {
		slug: string;
		number: string;
	} {
		const s = String(chapterId).replace(/^\/+/, '');
		const m = s.match(/^manga\/([^/]+)\/chapter\/(.+)$/i);
		if (m) return { slug: m[1]!, number: m[2]! };
		const parts = s.split('/').filter(Boolean);
		return {
			slug: parts[0] === 'manga' ? parts[1] || '' : parts[0] || '',
			number: parts[parts.length - 1] || ''
		};
	}

	private mapStatus(text: string): string {
		const t = text.toLowerCase();
		if (t.includes('complete') || t.includes('finished')) return 'Completed';
		if (t.includes('hiatus')) return 'Hiatus';
		if (t.includes('cancel')) return 'Cancelled';
		return 'Ongoing';
	}

	private parseList(html: string): Manga[] {
		const $ = cheerio.load(html);
		const res: Manga[] = [];
		const seen = new Set<string>();

		$('.media-manga').each((_, el) => {
			const $el = $(el);
			const link =
				$el.find('.media-left a[href*="/manga/"]').attr('href') ||
				$el.find('a[href*="/manga/"]').first().attr('href') ||
				'';
			const sm = link.match(/\/manga\/([^/?#]+)/);
			if (!sm) return;

			const slug = sm[1]!;
			const id = this.toMangaId(slug);
			if (seen.has(id)) return;
			seen.add(id);

			const img = $el.find('img').first();
			let title =
				(img.attr('alt') || '').trim() ||
				$el.find('.media-heading a').first().text().replace(/\s+/g, ' ').trim() ||
				slug.replace(/[-_]/g, ' ');

			const byIdx = title.search(/\sby\s/i);
			if (byIdx > 2) title = title.slice(0, byIdx).trim();

			let cover = img.attr('src') || img.attr('data-src') || '';
			if (cover.startsWith('//')) cover = `https:${cover}`;
			cover = this.absUrl(cover);
			if (!cover) cover = `${this.THUMB_CDN}/mn/${slug.replace(/_\d+$/, '')}.jpg`;

			const body = $el.find('.media-body').text().replace(/\s+/g, ' ');
			let latestChapter: string | undefined;
			const chMatch = body.match(/#\s*([\d.]+)\s*chapters?/i);
			if (chMatch) latestChapter = chMatch[1];

			const status = this.mapStatus(body);

			res.push({
				id,
				sourceId: this.id,
				title,
				cover,
				type: 'manga',
				status,
				latestChapter,
				lang: 'en'
			} as Manga & { lang?: string });
		});

		return res;
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		const p = Math.max(1, Number(page) || 1);
		try {
			const path = `/search/page/${p}?q=&order=LATEST`;
			const html = await this.getHtml(path);
			const list = this.parseList(html);
			console.log(`[onemanga] latest page=${p} → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[onemanga] getLatestManga', e);
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
			const params = new URLSearchParams();
			params.set('q', q);
			const html = await this.getHtml(`/search/page/${page}?${params.toString()}`);
			const list = this.parseList(html);
			console.log(`[onemanga] search "${q}" page=${page} → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[onemanga] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) throw new Error(`Invalid onemanga id: ${mangaId}`);

		const html = await this.getHtml(`/manga/${encodeURIComponent(slug)}`);
		const $ = cheerio.load(html);

		let title =
			$('h1').first().clone().children().remove().end().text().replace(/\s+/g, ' ').trim() ||
			$('h1').first().text().replace(/\s+/g, ' ').trim() ||
			slug;

		const hotIdx = title.indexOf('Hot');
		if (hotIdx > 2) title = title.slice(0, hotIdx).trim();

		let cover =
			$('img.manga-thumb, .manga-thumb img, img[src*="thumb.mghcdn"]')
				.first()
				.attr('src') || '';
		if (cover.startsWith('//')) cover = `https:${cover}`;
		cover = this.absUrl(cover);
		if (!cover) {
			cover = `${this.THUMB_CDN}/mn/${slug.replace(/_\d+$/, '')}.jpg`;
		}

		const bodyText = $('body').text();
		let status = this.mapStatus(bodyText);

		const metaMap: Record<string, string> = {};
		$('span._3SlhO').each((_, el) => {
			const label = $(el).text().replace(/\s+/g, ' ').trim();
			const parentText = $(el)
				.parent()
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			if (!label) return;
			const value = parentText.replace(label, '').trim();
			if (value) metaMap[label.toLowerCase()] = value;
		});

		const authors: string[] = [];
		const authorRaw = metaMap['author'] || metaMap['authors'] || '';
		for (const part of authorRaw.split(/[;,]/)) {
			const t = part.trim();
			if (t && t.length < 60 && !authors.includes(t)) authors.push(t);
		}
		$('a[href*="/author/"], a[href*="?author="]').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (t && t.length < 60 && !authors.includes(t)) authors.push(t);
		});

		const artists: string[] = [];
		const artistRaw = metaMap['artist'] || metaMap['artists'] || '';
		for (const part of artistRaw.split(/[;,]/)) {
			const t = part.trim();
			if (t && t.length < 60 && !artists.includes(t)) artists.push(t);
		}

		const genres: string[] = [];
		$('a[href*="/genre/"], a[href*="?genre="], .label-genre, .genre a').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (t && t.length < 30 && !genres.includes(t)) genres.push(t);
		});

		let description =
			$('.description, #description, .manga-description, meta[name="description"]')
				.first()
				.attr('content') ||
			$('.description, #description, .manga-description').first().text() ||
			'';
		description = description.replace(/\s+/g, ' ').trim();

		const statusFromMeta = metaMap['status'] || '';
		const latestFromMeta = metaMap['latest'] || '';

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('a[href*="/chapter/"]').each((_, el) => {
			const href = $(el).attr('href') || '';
			const m = href.match(/\/chapter\/([^/]+)\/chapter-([\d.]+)/i);
			if (!m) return;
			const chSlug = m[1]!;
			const numStr = m[2]!;
			const num = parseFloat(numStr);
			if (!Number.isFinite(num)) return;

			if (chSlug !== slug) return;

			if (num > 10000) return;

			const key = `${chSlug}/${numStr}`;
			if (seen.has(key)) return;
			seen.add(key);

			const chTitle = `Chapter ${numStr}`;

			chapters.push({
				id: this.toChapterId(chSlug, numStr),
				title: chTitle,
				number: num,
				date: ''
			});
		});

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const latestChapter =
			chapters[0]?.number != null ? String(chapters[0].number) : undefined;

		if (statusFromMeta) status = this.mapStatus(statusFromMeta);

		const artistLine = artists.length
			? artists.join(', ')
			: authors.length
				? authors.join(', ')
				: '';

		const metaLines = [
			authors[0] && `Author: ${authors.join(', ')}`,
			artistLine && `Artist: ${artistLine}`,
			latestFromMeta && `Latest Update: ${latestFromMeta}`,
			`Language: en`,
			`Type: manga`
		].filter(Boolean);

		console.log(`[onemanga] details ${slug} → ch=${chapters.length}`);

		return {
			id: this.toMangaId(slug),
			sourceId: this.id,
			title,
			cover,
			type: 'manga',
			status,
			description: [...metaLines, description].filter(Boolean).join('\n'),
			authors,
			genres,
			chapters,
			latestChapter
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const { slug, number } = this.extractChapterParts(chapterId);
		if (!slug || !number) {
			console.error('[onemanga] getChapterPages bad id:', chapterId);
			return [];
		}

		try {
			const html = await this.getHtml(
				`/chapter/${encodeURIComponent(slug)}/chapter-${encodeURIComponent(number)}`
			);
			const $ = cheerio.load(html);

			const fromHtml: string[] = [];
			const seen = new Set<string>();
			const re = /https:\/\/imgx\.mghcdn\.com\/[^"'\\s>]+/g;
			const all = html.match(re) || [];
			for (const u of all) {
				if (!/\d+\.(jpe?g|png|webp)$/i.test(u)) continue;
				if (seen.has(u)) continue;
				seen.add(u);
				fromHtml.push(u);
			}

			$('img[src*="imgx.mghcdn"], img[data-src*="imgx.mghcdn"]').each((_, el) => {
				const u = $(el).attr('data-src') || $(el).attr('src') || '';
				if (u && !seen.has(u) && /\d+\.(jpe?g|png|webp)$/i.test(u)) {
					seen.add(u);
					fromHtml.push(u);
				}
			});

			let basePrefix = '';
			let maxN = 0;
			let ext = 'jpg';
			for (const u of fromHtml) {
				const m = u.match(
					/^(https:\/\/imgx\.mghcdn\.com\/.+\/)(\d+)\.(jpe?g|png|webp)$/i
				);
				if (!m) continue;
				basePrefix = m[1]!;
				const n = parseInt(m[2]!, 10);
				if (n > maxN) maxN = n;
				ext = m[3]!.toLowerCase();
			}

			if (!basePrefix) {
				console.log(`[onemanga] no img base for ${slug}/${number}`);
				return fromHtml;
			}

			let hi = Math.max(maxN, 1);
			let exists = true;
			while (exists && hi < 500) {
				const next = hi + Math.max(5, Math.floor(hi / 2));
				exists = await this.imageExists(`${basePrefix}${next}.${ext}`);
				if (exists) hi = next;
				else break;
			}

			let lo = maxN;
			let bound = hi + Math.max(5, Math.floor(hi / 2));
			while (lo + 1 < bound && bound - lo > 1) {
				const mid = Math.floor((lo + bound) / 2);
				if (await this.imageExists(`${basePrefix}${mid}.${ext}`)) lo = mid;
				else bound = mid;
			}
		
			while (await this.imageExists(`${basePrefix}${lo + 1}.${ext}`)) lo++;

			const urls: string[] = [];
			for (let i = 1; i <= lo; i++) {
				urls.push(`${basePrefix}${i}.${ext}`);
			}

			console.log(`[onemanga] ${urls.length} pages → ${slug}/${number}`);
			return urls;
		} catch (e) {
			console.error('[onemanga] getChapterPages failed', slug, number, e);
			return [];
		}
	}

	private async imageExists(url: string): Promise<boolean> {
		try {
			const res = await fetch(url, {
				method: 'HEAD',
				headers: {
					'User-Agent': this.headers['User-Agent'] || 'Mozilla/5.0',
					Referer: `${this.baseUrl}/`
				}
			});
			return res.ok;
		} catch {
			return false;
		}
	}
}
