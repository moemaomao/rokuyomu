import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';
import { env } from '$env/dynamic/private';

/**
 * Doujinku (doujinku.org) – MangaThemesia / MangaReader (18+)
 *
 * List   : /manga/?order=update  |  /manga/page/{n}/?order=update
 * Search : /?s=QUERY
 * Detail : /manga/{slug}/
 * Chapter: /{slug}-chapter-{n}/
 * Pages  : ts_reader.run({ sources: [{ images: [...] }] })
 *
 * Opsional env (kalau kena Cloudflare):
 *   DOUJINKU_COOKIE=cf_clearance=...; __cf_bm=...
 *
 * ID:
 *   manga   : "/manga/{slug}"
 *   chapter : "/{slug}-chapter-{n}"
 */
export class DoujinkuSource extends BaseSource {
	id = 'doujinku';
	name = 'Doujinku';
	baseUrl = 'https://doujinku.org';

	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'id';

	private getCookie(): string {
	const raw =
		(typeof process !== 'undefined' ? process.env?.DOUJINKU_COOKIE : undefined) ||
		'';
	return String(raw).trim();
}

	/** Override fetchHtml supaya inject cookie CF bila ada */
	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
		const headers: Record<string, string> = {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
			Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
			Referer: `${this.baseUrl}/`
		};
		const cookie = this.getCookie();
		if (cookie) headers.Cookie = cookie;

		const res = await fetch(url, { headers, redirect: 'follow' });
		const text = await res.text();

		if (
			!res.ok ||
			/just a moment|cf-challenge|challenge-platform|verify you are human/i.test(text)
		) {
			throw new Error(
				'Doujinku diblok Cloudflare. Set DOUJINKU_COOKIE (cf_clearance) dari browser setelah lolos challenge.'
			);
		}
		return text;
	}

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

	private normalizeTitle(raw: string): string {
		return (raw || '')
			.replace(/\s+/g, ' ')
			.replace(/\s*[-–|].*Doujinku.*$/i, '')
			.replace(/\s*All Chapter.*$/i, '')
			.trim();
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath = path.match(/-chapter-(\d+)(?:[.-](\d+))?/i);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null) return parseFloat(`${major}.${fromPath[2]}`);
			return major;
		}
		const m = String(text).match(/(?:chapter|chap|ch\.?)\s*(\d+)(?:[.,](\d+))?/i);
		if (m) {
			if (m[2] != null) return parseFloat(`${m[1]}.${m[2]}`);
			return parseInt(m[1], 10);
		}
		const n = String(text).match(/\b(\d+(?:\.\d+)?)\b/);
		return n ? parseFloat(n[1]) : 0;
	}

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		$('.listupd .bsx, .bs .bsx, .bsx').each((_, el) => {
			const $el = $(el);
			const a = $el.find('a[href*="/manga/"]').first();
			const href = a.attr('href') || '';
			const id = this.cleanId(href);

			if (!/^\/manga\/[^/]+$/i.test(id) || seen.has(id)) return;
			if (/\/manga\/(page|feed|list-mode)/i.test(id)) return;
			seen.add(id);

			const title = this.normalizeTitle(
				$el.find('.tt').text() || a.attr('title') || $el.find('img').attr('alt') || ''
			);
			if (!title) return;

			const cover =
				$el.find('img').attr('data-src') ||
				$el.find('img').attr('data-lazy-src') ||
				$el.find('img').attr('src') ||
				'';

			const ep = $el.find('.epxs, .epx').text();
			const n = this.parseChapterNumber(ep);

			out.push({
				id,
				sourceId: this.id,
				title,
				cover: this.absUrl((cover || '').split('?')[0]),
				type: 'manga',
				status: 'Ongoing',
				latestChapter: n > 0 ? n : undefined,
				lang: this.DEFAULT_LANG
			} as Manga & { lang?: string });
		});

		return out;
	}

	async getLatestManga(
	page: number,
	_opts?: { lang?: string; type?: string }
): Promise<Manga[]> {
	try {
		const p = Math.max(1, Number(page) || 1);
		const siteStart = (p - 1) * 2 + 1;
		const sitePages = [siteStart, siteStart + 1];

		const seen = new Set<string>();
		const merged: Manga[] = [];

		for (const sitePage of sitePages) {
			if (merged.length >= this.PER_PAGE) break;

			const path =
				sitePage <= 1
					? `/manga/?order=update`
					: `/manga/?order=update&page=${sitePage}`;

			try {
				const html = await this.fetchHtml(path);
				const $ = cheerio.load(html);
				const batch = this.parseCards($);

				console.log(
					`[doujinku] sitePage=${sitePage} path=${path} → ${batch.length}`
				);

				if (!batch.length) {
					console.warn(`[doujinku] empty on ${path}`);
					continue;
				}

				for (const m of batch) {
					if (seen.has(m.id)) continue;
					seen.add(m.id);
					merged.push(m);
					if (merged.length >= this.PER_PAGE) break;
				}
			} catch (e) {
				console.warn(`[doujinku] fail sitePage=${sitePage}`, e);
			}
		}

		console.log(
			`[doujinku] app page=${p} site=${sitePages.join(',')} → ${merged.length} unique`
		);
		return merged.slice(0, this.PER_PAGE);
	} catch (e) {
		console.error('[doujinku] getLatestManga', e);
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
			const $ = cheerio.load(html);
			const list = this.parseCards($);
			console.log(`[doujinku] search "${q}" → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[doujinku] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);

		if (/-chapter-/i.test(path) && !path.startsWith('/manga/')) {
			const slug = path.replace(/^\//, '').replace(/-chapter-[\d.]+.*$/i, '');
			if (slug) path = `/manga/${slug}`;
		}
		if (!path.startsWith('/manga/')) {
			path = `/manga/${path.replace(/^\//, '')}`;
		}

		const html = await this.fetchHtml(path + '/');
		const $ = cheerio.load(html);

		let title =
			$('h1.entry-title, h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content') ||
			path;
		title = this.normalizeTitle(title);

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('.thumbook img, .thumb img, .seriestuimg img').attr('data-src') ||
			$('.thumbook img, .thumb img, .seriestuimg img').attr('src') ||
			'';
		cover = this.absUrl((cover || '').split('?')[0]);

		const description =
			$('.entry-content[itemprop="description"], .seriestucon .entry-content, .wd-full .entry-content')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('.infox .desc, .description, [itemprop="description"]')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			'';

		const authors: string[] = [];
		$('.infox .fmed, .tsinfo .imptdt, .wd-full').each((_, el) => {
			const label = $(el).text().toLowerCase();
			if (/author|artist|pengarang|circle/.test(label)) {
				$(el)
					.find('a, span')
					.each((__, a) => {
						const n = $(a).text().trim();
						if (
							n &&
							n.length < 60 &&
							!/author|artist|pengarang|circle/i.test(n) &&
							!authors.includes(n)
						) {
							authors.push(n);
						}
					});
			}
		});

		let status = 'Ongoing';
		$('.tsinfo .imptdt, .infox .fmed, span').each((_, el) => {
			const t = $(el).text();
			if (/status/i.test(t)) {
				if (/complete|tamat|end|finished/i.test(t)) status = 'Completed';
				else if (/hiatus/i.test(t)) status = 'Hiatus';
			}
		});

		const genres: string[] = [];
		$('.mgen a, .seriestugenre a, a[href*="/genres/"], a[href*="/genre/"]').each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (g && g.length < 40 && !/^genre$/i.test(g) && !genres.includes(g)) {
				genres.push(g);
			}
		});

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('#chapterlist li, .eplister li, #chapterlist .chbox').each((_, el) => {
			const $a = $(el).find('a').first();
			const href = $a.attr('href') || '';
			if (!href) return;
			const id = this.cleanId(href);
			if (seen.has(id)) return;
			if (!/-chapter-/i.test(id) && !/chapter/i.test(id)) return;
			seen.add(id);

			const chapterTitle =
				$a.find('.chapternum').text().replace(/\s+/g, ' ').trim() ||
				$a.text().replace(/\s+/g, ' ').trim() ||
				`Chapter ${chapters.length + 1}`;

			const number =
				this.parseChapterNumber(chapterTitle, id) ||
				parseFloat($(el).attr('data-num') || '') ||
				chapters.length + 1;

			const date =
				$a.find('.chapterdate').text().replace(/\s+/g, ' ').trim() || '';

			chapters.push({ id, title: chapterTitle, number, date });
		});

		if (!chapters.length) {
			$('a[href*="-chapter-"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const id = this.cleanId(href);
				if (seen.has(id) || !/-chapter-/i.test(id)) return;
				seen.add(id);
				const chapterTitle =
					$(a).text().replace(/\s+/g, ' ').trim() || 'Chapter';
				const number =
					this.parseChapterNumber(chapterTitle, id) || chapters.length + 1;
				chapters.push({ id, title: chapterTitle, number, date: '' });
			});
		}

		chapters.sort((a, b) => a.number - b.number);

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			description,
			authors,
			genres,
			status,
			type: 'manga',
			chapters,
			latestChapter: chapters.length
				? chapters[chapters.length - 1].number
				: undefined
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(
			chapterId.startsWith('/') ? chapterId : `/${chapterId}`
		);
		const html = await this.fetchHtml(path);
		const images: string[] = [];
		const seen = new Set<string>();

		const m = html.match(/ts_reader\.run\((\{[\s\S]*?\})\);/);
		if (m) {
			try {
				const data = JSON.parse(m[1]) as {
					sources?: Array<{ images?: string[] }>;
				};
				for (const src of data.sources || []) {
					for (const u of src.images || []) {
						const url = this.absUrl(String(u).replace(/\\\//g, '/'));
						if (url && !seen.has(url)) {
							seen.add(url);
							images.push(url);
						}
					}
					if (images.length) break;
				}
			} catch {
				const re = /"(https?:\\\/\\\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
				let x: RegExpExecArray | null;
				while ((x = re.exec(m[1])) !== null) {
					const url = x[1].replace(/\\\//g, '/');
					if (!seen.has(url)) {
						seen.add(url);
						images.push(url);
					}
				}
			}
		}

		if (!images.length) {
			const $ = cheerio.load(html);
			$('#readerarea img, .reader-area img, .entry-content img').each((_, img) => {
				let src =
					$(img).attr('data-src') ||
					$(img).attr('data-lazy-src') ||
					$(img).attr('src') ||
					'';
				src = this.absUrl(src);
				if (
					src &&
					!seen.has(src) &&
					/\.(jpg|jpeg|png|webp)/i.test(src) &&
					!/logo|icon|avatar|spinner|ads|placeholder|wp-content\/themes/i.test(src)
				) {
					seen.add(src);
					images.push(src);
				}
			});
		}

		console.log(`[doujinku] ${images.length} pages → ${path}`);
		return images;
	}
}