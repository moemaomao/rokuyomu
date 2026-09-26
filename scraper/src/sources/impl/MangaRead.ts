/**
 * MangaRead.org adapter (WordPress Madara / WP-Manga)
 *
 * Domain   : https://www.mangaread.org
 * Latest   : GET /manga/?m_orderby=latest  +  /manga/page/{n}/?m_orderby=latest
 * Search   : GET /?s={q}&post_type=wp-manga
 * Detail   : GET /manga/{slug}/
 * Pages    : GET /manga/{slug}/chapter-{n}/  → img.wp-manga-chapter-img
 *
 * ID format:
 *   manga   : "/manga/{slug}"
 *   chapter : "/manga/{slug}/chapter-{n}"
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class MangaReadSource extends BaseSource {
	id = 'mangaread';
	name = 'MangaRead';
	baseUrl = 'https://www.mangaread.org';

	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'en';

	// ── HTTP ─────────────────────────────────────────────────────────────────

	private h(referer?: string): Record<string, string> {
		return {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
			Accept:
				'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
			'Accept-Language': 'en-US,en;q=0.9',
			Referer: referer || `${this.baseUrl}/`
		};
	}

	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const res = await fetch(url, {
			headers: this.h(`${this.baseUrl}/`),
			redirect: 'follow'
		});
		if (!res.ok) throw new Error(`MangaRead HTTP ${res.status} → ${url}`);
		return await res.text();
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private absUrl(url: string): string {
		if (!url) return '';
		let u = url.trim().replace(/&amp;/g, '&').replace(/\s+/g, '');
		if (u.startsWith('http')) return u;
		if (u.startsWith('//')) return `https:${u}`;
		return `${this.baseUrl}${u.startsWith('/') ? '' : '/'}${u}`;
	}

	private toMangaId(slug: string): string {
		const s = String(slug || '')
			.replace(/^\/+/, '')
			.replace(/^manga\//i, '')
			.split('/')[0]
			.replace(/\/+$/, '');
		return `/manga/${s}`;
	}

	private extractSlug(mangaId: string): string {
		const parts = String(mangaId)
			.replace(/^\/+/, '')
			.split('/')
			.filter(Boolean);
		if (parts[0] === 'manga' && parts[1]) return parts[1];
		return parts[0] || '';
	}

	private extractChapterPath(chapterId: string): {
		slug: string;
		chapterPath: string;
	} {
		const parts = String(chapterId)
			.replace(/^\/+/, '')
			.split('/')
			.filter(Boolean);
	
		if (parts[0] === 'manga' && parts[1] && parts[2]) {
			return { slug: parts[1], chapterPath: parts.slice(2).join('/') };
		}
		if (parts[0] && parts[1]) {
			return { slug: parts[0], chapterPath: parts.slice(1).join('/') };
		}
		return { slug: parts[0] || '', chapterPath: parts[parts.length - 1] || '' };
	}

	private toChapterId(slug: string, chapterSlug: string): string {
		const cs = chapterSlug.replace(/^\/+|\/+$/g, '');
		return `/manga/${slug}/${cs}`;
	}

	private parseChapterNumber(text: string): number {
		const t = String(text || '');
		const m = t.match(/(?:chapter|chap|ch\.?)\s*(\d+)(?:[.,](\d+))?/i);
		if (m) {
			if (m[2] != null) return parseFloat(`${m[1]}.${m[2]}`);
			return parseInt(m[1], 10);
		}
		const n = t.match(/(\d+(?:\.\d+)?)/);
		return n ? parseFloat(n[1]) : 0;
	}

	private mapStatus(raw?: string): string {
		const s = String(raw || '').toLowerCase();
		if (s.includes('complete')) return 'Completed';
		if (s.includes('hiatus') || s.includes('on-hold')) return 'Hiatus';
		if (s.includes('cancel') || s.includes('drop')) return 'Dropped';
		return 'Ongoing';
	}

	private parseList(html: string): Manga[] {
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('.page-item-detail, .c-tabs-item__content').each((_, el) => {
			const $el = $(el);
			const a = $el
				.find('h3 a[href*="/manga/"], h5 a[href*="/manga/"], .post-title a[href*="/manga/"]')
				.first();
			const href = a.attr('href') || $el.find('a[href*="/manga/"]').first().attr('href') || '';
			const m = href.match(/\/manga\/([^/?#]+)\/?/i);
			if (!m) return;
			const slug = m[1];
			if (slug === 'page' || slug === 'feed' || seen.has(slug)) return;
			seen.add(slug);

			const title = (a.attr('title') || a.text() || slug).replace(/\s+/g, ' ').trim();
			const img =
				$el.find('img').attr('data-src') ||
				$el.find('img').attr('data-lazy-src') ||
				$el.find('img').attr('src') ||
				'';
		
			let cover = this.absUrl(img);
			cover = cover.replace(/-\d+x\d+(\.\w+)(\?|$)/, '$1$2');

			const chA = $el.find('a[href*="/chapter"]').first();
			const chText = (chA.text() || chA.attr('title') || '').replace(/\s+/g, ' ').trim();
			const chNum = this.parseChapterNumber(chText);

			list.push({
				id: this.toMangaId(slug),
				title,
				cover,
				sourceId: this.id,
				type: 'manga',
				status: 'Ongoing',
				latestChapter: chNum ? String(chNum) : undefined,
				lang: this.DEFAULT_LANG
			});
		});

		return list;
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const SITE_PER = 12;
			const offset = (p - 1) * this.PER_PAGE;
			const firstSite = Math.floor(offset / SITE_PER) + 1;
			const localStart = offset % SITE_PER;

			const seen = new Set<string>();
			const bucket: Manga[] = [];

			for (let sp = firstSite; sp <= firstSite + 2; sp++) {
				const path =
					sp <= 1
						? '/manga/?m_orderby=latest'
						: `/manga/page/${sp}/?m_orderby=latest`;
				try {
					const html = await this.fetchHtml(path);
					const batch = this.parseList(html);
					if (batch.length === 0) break;
					for (const m of batch) {
						if (seen.has(m.id)) continue;
						seen.add(m.id);
						bucket.push(m);
					}
				} catch (e) {
					console.error('[mangaread] site page', sp, e);
					break;
				}
				if (bucket.length >= localStart + this.PER_PAGE) break;
			}

			const out = bucket.slice(localStart, localStart + this.PER_PAGE);
			console.log(`[mangaread] latest page=${p} → ${out.length}`);
			return out;
		} catch (e) {
			console.error('[mangaread] getLatestManga', e);
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
					? `/?s=${encodeURIComponent(q)}&post_type=wp-manga`
					: `/page/${page}/?s=${encodeURIComponent(q)}&post_type=wp-manga`;
			const html = await this.fetchHtml(path);
			const list = this.parseList(html).slice(0, this.PER_PAGE);
			console.log(`[mangaread] search "${q}" → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[mangaread] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) throw new Error(`MangaRead: invalid mangaId ${mangaId}`);

		const html = await this.fetchHtml(`/manga/${slug}/`);
		const $ = cheerio.load(html);

		let title =
			$('.post-title h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('h1').first().text().replace(/\s+/g, ' ').trim() ||
			slug;

		const cover = this.absUrl(
			$('meta[property="og:image"]').attr('content') ||
				$('.summary_image img').attr('data-src') ||
				$('.summary_image img').attr('src') ||
				''
		).replace(/-\d+x\d+(\.\w+)(\?|$)/, '$1$2');

		let status = 'Ongoing';
		const authors: string[] = [];
		const genres: string[] = [];
		let description = '';

		$('.post-content_item, .summary-content, .manga-info').each((_, el) => {
			const label = $(el).find('.summary-heading, h5, .heading').text().toLowerCase();
			const body = $(el).find('.summary-content, .content').text().replace(/\s+/g, ' ').trim();
			if (label.includes('status')) status = this.mapStatus(body);
			if (label.includes('author') || label.includes('artist')) {
				$(el)
					.find('a')
					.each((__, a) => {
						const t = $(a).text().replace(/\s+/g, ' ').trim();
						if (t) authors.push(t);
					});
				if (!authors.length && body) authors.push(body);
			}
			if (label.includes('genre')) {
				$(el)
					.find('a')
					.each((__, a) => {
						const t = $(a).text().replace(/\s+/g, ' ').trim();
						if (t) genres.push(t);
					});
			}
		});

		if (!genres.length) {
			$('.genres-content a, .wp-manga-genres a').each((_, a) => {
				const t = $(a).text().replace(/\s+/g, ' ').trim();
				if (t) genres.push(t);
			});
		}

		description =
			$('.summary__content, .description-summary .summary__content, .manga-excerpt')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			($('meta[name="description"]').attr('content') || '').trim();

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('li.wp-manga-chapter, .listing-chapters_wrap li, ul.main.version-chap li').each(
			(_, li) => {
				const a = $(li).find('a[href*="/manga/"]').first();
				const href = a.attr('href') || '';
				const cm = href.match(/\/manga\/[^/]+\/([^/?#]+)\/?/i);
				if (!cm) return;
				const chapterSlug = cm[1];
				if (seen.has(chapterSlug)) return;
				seen.add(chapterSlug);
				const name = (a.text() || chapterSlug).replace(/\s+/g, ' ').trim();
				const date =
					$(li).find('.chapter-release-date').text().replace(/\s+/g, ' ').trim() ||
					undefined;
				chapters.push({
					id: this.toChapterId(slug, chapterSlug),
					title: name,
					number: this.parseChapterNumber(name) || chapters.length + 1,
					date
				});
			}
		);

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const latestChapter =
			chapters.length > 0 ? String(chapters[0].number) : undefined;

		return {
			id: this.toMangaId(slug),
			sourceId: this.id,
			title,
			cover,
			type: 'manga',
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
			const { slug, chapterPath } = this.extractChapterPath(chapterId);
			if (!slug || !chapterPath) return [];

			const path = `/manga/${slug}/${chapterPath}/`.replace(/\/+/g, '/').replace(
				':/',
				'://'
			);
		
			const cleanPath = `/manga/${slug}/${chapterPath.replace(/\/+$/, '')}/`;
			const html = await this.fetchHtml(cleanPath);
			const $ = cheerio.load(html);

			const pages: string[] = [];
			const seen = new Set<string>();

			$('img.wp-manga-chapter-img, .reading-content img').each((_, img) => {
				const src =
					$(img).attr('data-src') ||
					$(img).attr('data-lazy-src') ||
					$(img).attr('src') ||
					'';
				const url = this.absUrl(src);
				if (!url || !/\.(jpg|jpeg|png|webp|gif)/i.test(url)) return;
				if (/logo|avatar|icon|ads|banner/i.test(url)) return;
				const key = url.split('?')[0];
				if (seen.has(key)) return;
				seen.add(key);
				pages.push(url);
			});

			if (pages.length === 0) {
				const re =
					/(https?:\/\/[^"'\\\s]+\/WP-manga\/data\/[^"'\\\s]+\.(?:jpg|jpeg|png|webp))/gi;
				let m: RegExpExecArray | null;
				while ((m = re.exec(html)) !== null) {
					const url = m[1];
					if (seen.has(url)) continue;
					seen.add(url);
					pages.push(url);
				}
			}

			pages.sort((a, b) => {
				const na = parseInt(a.match(/\/(\d+)\.(?:jpg|jpeg|png|webp)/i)?.[1] || '0', 10);
				const nb = parseInt(b.match(/\/(\d+)\.(?:jpg|jpeg|png|webp)/i)?.[1] || '0', 10);
				return na - nb;
			});

			console.log(
				`[mangaread] getChapterPages ${slug}/${chapterPath} → ${pages.length}`
			);
			return pages;
		} catch (e) {
			console.error('[mangaread] getChapterPages', e);
			return [];
		}
	}
}
