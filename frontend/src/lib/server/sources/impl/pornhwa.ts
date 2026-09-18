import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class PornhwaSource extends BaseSource {
	id = 'pornhwa';
	name = 'Pornhwa';
	baseUrl = 'https://pornhwa.me';

	private absUrl(href: string): string {
		if (!href) return '';
		if (href.startsWith('http')) return href;
		if (href.startsWith('//')) return `https:${href}`;
		return `${this.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
	}

	private cleanSlug(mangaId: string): string {
		return mangaId
			.replace(this.baseUrl, '')
			.replace(/^\/read\//, '')
			.replace(/^\/manga\//, '')
			.replace(/\/$/, '')
			.split('/')[0]
			.trim();
	}

	private parseList($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		$('a[href^="/read/"]').each((_, el) => {
			const $a = $(el);
			let href = ($a.attr('href') || '').trim();
			if (!href) return;
			if (/\/chapter-[\d.]+\/?$/i.test(href)) return;

			href = href.replace(/\/$/, '') + '/';
			const slug = this.cleanSlug(href);
			if (!slug || seen.has(slug)) return;
			seen.add(slug);

			let title = $a.text().replace(/\s+/g, ' ').trim();

			if (!title || title.length < 2 || /^\d+(\.\d+)?$/.test(title)) {
				const parent = $a.closest('div');
				const titleCandidate = parent
					.find('a[href^="/read/"]')
					.filter((_, e) => {
						const t = $(e).text().replace(/\s+/g, ' ').trim();
						return t.length > 2 && !/^\d+(\.\d+)?$/.test(t);
					})
					.first()
					.text()
					.replace(/\s+/g, ' ')
					.trim();
				title = titleCandidate || slug;
			}

			title = title
				.replace(/^\d+(\.\d+)?/, '')
				.replace(/(Manhwa|Comic|Manga)\d+[kKmM]?/gi, '')
				.replace(/\d+[kKmM]?$/g, '')
				.replace(/\s+/g, ' ')
				.trim();

			if (!title) title = slug;

			let cover = '';
			const $img =
				$a.find('img').first().length > 0
					? $a.find('img').first()
					: $a.closest('div').find('img').first();

			if ($img.length) {
				cover =
					$img.attr('src') ||
					$img.attr('data-src') ||
					$img.attr('data-lazy-src') ||
					'';
				if (cover.includes(' ')) cover = cover.split(/\s+/)[0];
				cover = this.absUrl(cover);
			}

			res.push({
				id: `/read/${slug}/`,
				title,
				cover,
				sourceId: this.id,
				type: 'manhwa',
				status: 'Ongoing'
			});
		});

		return res;
	}

	async getLatestManga(
        page: number,
        _opts?: { lang?: string; type?: string }
    ): Promise<Manga[]> {
        try {
            const p = Math.max(1, Number(page) || 1);
            const path = p <= 1 ? '/latest-update/' : `/latest-update/${p}/`;
            const html = await this.fetchHtml(path);
            const $ = cheerio.load(html);
         
            return this.parseList($).slice(0, 24);
        } catch (e) {
            console.error('[pornhwa] getLatestManga', e);
            return [];
        }
    }

	async searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page || 1);

		if (!q) return this.getLatestManga(page);

		try {
			const path =
				page <= 1
					? `/search/?q=${encodeURIComponent(q)}`
					: `/search/${page}/?q=${encodeURIComponent(q)}`;

			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			return this.parseList($);
		} catch (e) {
			console.error('[pornhwa] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = this.cleanSlug(mangaId);
		if (!slug) throw new Error(`Invalid Pornhwa id: ${mangaId}`);

		const path = `/read/${slug}/`;
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		// ===== TITLE =====
		let title = '';
		$('h1').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (t && t.toLowerCase() !== 'pornhwa' && t.length > 2) {
				title = t;
				return false;
			}
		});
		if (!title) {
			title =
				$('title')
					.text()
					.replace(/\s*-\s*Pornhwa.*$/i, '')
					.trim() || slug;
		}
		if (!title || title === slug) {
			const h2 = $('h2').first().text().replace(/\s+/g, ' ').trim();
			if (h2.toLowerCase().startsWith('read comic')) {
				title = h2.replace(/^read\s+comic/i, '').trim();
			}
		}

		// ===== COVER =====
		let cover = '';
		const titleLower = title.toLowerCase();
		$('img').each((_, img) => {
			const $img = $(img);
			const alt = ($img.attr('alt') || '').toLowerCase();
			const src = $img.attr('src') || '';
			if (
				!cover &&
				src &&
				!src.includes('140px') &&
				!src.includes('no-image') &&
				!src.includes('logo') &&
				(alt.includes(titleLower.slice(0, 12)) ||
					alt.includes(slug.replace(/-/g, ' ')) ||
					/manhwature|imgkomik|covers/i.test(src))
			) {
				cover = src;
			}
		});
		if (!cover) {
			cover = $('meta[property="og:image"]').attr('content') || '';
		}
		cover = this.absUrl(cover);

		// ===== GENRES =====
		const genres: string[] = [];
		$('a[href*="/genre/"]').each((_, el) => {
			const t = $(el).text().trim();
			if (t && !genres.includes(t)) genres.push(t);
		});

		// ===== STATUS =====
		let status = 'Ongoing';
		const bodyText = $('body').text().toLowerCase();
		if (bodyText.includes('completed') || bodyText.includes('tamat')) {
			status = 'Completed';
		}

		let rating = '0.0';
		const bodyRaw = $('body').text();
		const m1 = bodyRaw.match(/(\d+(?:\.\d+)?)\s*out\s*of\s*5/i);
		if (m1) {
			const val = parseFloat(m1[1]);
			if (val >= 0 && val <= 5) rating = val.toFixed(1);
		} else {

			const m2 = $('.text-4xl, .text-5xl, [class*="tabular-nums"]')
				.first()
				.text()
				.match(/(\d+(?:\.\d+)?)/);
			if (m2) {
				const val = parseFloat(m2[1]);
				if (val >= 0 && val <= 5) rating = val.toFixed(1);
			}
		}

		// ===== DESCRIPTION =====
		let synopsis = '';
		$('div, p').each((_, el) => {
			const txt = $(el).text().replace(/\s+/g, ' ').trim();
			if (
				!synopsis &&
				txt.length > 60 &&
				txt.length < 900 &&
				!/chapter\s*\d+/i.test(txt) &&
				!/sign in|login|register|cookie|privacy|alternative title|status\s*:/i.test(txt) &&
				(/story about|protagonist|manhwa|love|mother|friend/i.test(txt) || txt.length > 100)
			) {
				synopsis = txt;
			}
		});

		const metaLines: string[] = [];
		if (rating !== '0.0') metaLines.push(`Rating: ${rating}`);
		if (status) metaLines.push(`Status: ${status}`);
		if (genres.length) metaLines.push(`Type: Manhwa`);

		const description = [...metaLines, synopsis].filter(Boolean).join('\n');

		// ===== AUTHORS =====
		const authors: string[] = [];

		// ===== CHAPTERS =====
		const chapters: { id: string; title: string; number: number; date: string }[] = [];
		const seenCh = new Set<string>();

		$(`a[href*="/read/${slug}/chapter-"]`).each((_, el) => {
			const $a = $(el);
			const href = ($a.attr('href') || '').trim();
			if (!href || seenCh.has(href)) return;
			seenCh.add(href);

			const rawText = $a.text().replace(/\s+/g, ' ').trim();
			const numMatch = href.match(/chapter-([\d.]+)/i) || rawText.match(/chapter\s*([\d.]+)/i);
			const number = numMatch ? parseFloat(numMatch[1]) : 0;
			const dateMatch = rawText.match(/(\d+[hdwmy]\s*ago)/i);
			const date = dateMatch ? dateMatch[1] : '';

			chapters.push({
				id: href.startsWith('http') ? href.replace(this.baseUrl, '') : href,
				title: `Chapter ${number}`,
				number,
				date
			});
		});

		chapters.sort((a, b) => b.number - a.number);

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			type: 'manhwa',
			status,
			description,
			authors,
			genres,
			chapters
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const pages: string[] = [];
		const seen = new Set<string>();

		$('img').each((_, img) => {
			const $img = $(img);
			let src =
				$img.attr('src') ||
				$img.attr('data-src') ||
				$img.attr('data-lazy-src') ||
				'';

			src = src.replace(/\s+/g, '').trim();
			if (!src || src.startsWith('data:')) return;

			const alt = ($img.attr('alt') || '').toLowerCase();
			if (
				alt.includes('pornhwa') ||
				alt.includes('profile') ||
				src.includes('no-image') ||
				src.includes('140px') ||
				src.includes('favicon') ||
				src.includes('logo')
			) {
				return;
			}

			const isPage =
				/\/chapter-[\d.]+\/\d+/i.test(src) ||
				alt.includes('page') ||
				alt.includes('chapter') ||
				/\.(jpe?g|png|webp)(\?|$)/i.test(src);

			if (!isPage) return;

			src = this.absUrl(src);
			if (!seen.has(src)) {
				seen.add(src);
				pages.push(src);
			}
		});

		pages.sort((a, b) => {
			const numA = parseInt(a.match(/\/(\d+)\.(jpe?g|png|webp)/i)?.[1] || '0', 10);
			const numB = parseInt(b.match(/\/(\d+)\.(jpe?g|png|webp)/i)?.[1] || '0', 10);
			return numA - numB;
		});

		return pages;
	}
}