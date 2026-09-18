import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

/**
 * MGKomik (Madara)
 * Domain aktif sering pindah + Cloudflare.
 */
export class MgkomikSource extends BaseSource {
	id = 'mgkomik';
	name = 'MGKomik';
	baseUrl = 'https://web1.mgkomik.cc';

	/** Mirror yang dicoba berurutan jika 403 */
	private readonly MIRRORS = [
		'https://web1.mgkomik.cc',
		'https://id.mgkomik.cc',
		'https://web.mgkomik.cc'
	];

	private readonly PER_PAGE = 24;
	private readonly SUB = 'komik';

	constructor() {
		super();
		this.headers = {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
			Accept:
				'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
			'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
			'Cache-Control': 'no-cache',
			Pragma: 'no-cache'
		};
	}

	/** fetch dengan Referer + fallback mirror */
	protected async fetchHtml(path: string): Promise<string> {
		const rel = path.startsWith('http')
			? path
			: path.startsWith('/')
				? path
				: `/${path}`;

		let lastErr: Error | null = null;
		const bases = path.startsWith('http')
			? ['']
			: [this.baseUrl, ...this.MIRRORS.filter((m) => m !== this.baseUrl)];

		for (const base of bases) {
			const url = path.startsWith('http') ? path : `${base}${rel}`;
			try {
				const res = await fetch(url, {
					headers: {
						...this.headers,
						Referer: `${base || this.baseUrl}/`,
						Origin: base || this.baseUrl
					},
					redirect: 'follow'
				});

				const text = await res.text();

				// Cloudflare challenge
				if (
					!res.ok ||
					/just a moment|cf-browser-verification|challenge-platform/i.test(
						text.slice(0, 2000)
					)
				) {
					lastErr = new Error(
						`Failed to fetch ${url}: ${res.status} ${res.statusText}`
					);
					continue;
				}

				// sukses → kunci baseUrl ke mirror ini
				if (base && base !== this.baseUrl) {
					this.baseUrl = base;
					console.log(`[mgkomik] using mirror ${base}`);
				}
				return text;
			} catch (e: any) {
				lastErr = e instanceof Error ? e : new Error(String(e));
			}
		}

		throw lastErr || new Error('mgkomik fetch failed');
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
		return id.replace(/\/+$/, '') || '/';
	}

	private parseChapterNumber(text: string): number {
		const m = String(text).match(
			/(?:chapter|chap|ch\.?|episode|ep\.?)\s*(\d+(?:\.\d+)?)/i
		);
		if (m) return parseFloat(m[1]);
		const n = String(text).match(/(\d+(?:\.\d+)?)/);
		return n ? parseFloat(n[1]) : 0;
	}

	private imgSrc($el: cheerio.Cheerio<any>): string {
		return (
			$el.attr('data-src') ||
			$el.attr('data-lazy-src') ||
			$el.attr('data-original') ||
			$el.attr('src') ||
			''
		);
	}

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		$(
			'.page-item-detail, .c-tabs-item__content, .bs, .listupd .bs, .manga, .page-listing-item'
		).each((_, el) => {
			const $el = $(el);

			// FIX: tutup attribute selector dengan ]
			const a = $el
				.find(
					`.post-title a, h3 a, h5 a, .tt a, a[href*="/${this.SUB}/"]`
				)
				.first();
			const href = a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			const m = id.match(new RegExp(`^/${this.SUB}/([^/]+)$`));
			if (!m) return;
			if (seen.has(id)) return;
			seen.add(id);

			let title =
				a.attr('title') ||
				a.text() ||
				$el.find('.post-title, .tt, h3, h5').first().text() ||
				'';
			title = title
				.replace(/\s+/g, ' ')
				.replace(/\s*(Chapter|Ch\.?)\s*\d+.*$/i, '')
				.trim();
			if (!title || title.length < 2) return;

			const img = $el.find('img').first();
			let cover = this.imgSrc(img);
			cover = this.absUrl((cover || '').split('?')[0]);

			const chText =
				$el
					.find(
						'.chapter a, .list-chapter a, .epxs, .latest-chap a, .chapter, .btn-link'
					)
					.first()
					.text() || '';
			const latestChapter = this.parseChapterNumber(chText) || undefined;

			let status = 'Ongoing';
			const badge = $el
				.find('.manga-title-badges, .status, .badge')
				.text()
				.toLowerCase();
			if (/complete|selesai|tamat|end/.test(badge)) status = 'Completed';

			let type = 'manga';
			const t = ($el.text() + ' ' + title).toLowerCase();
			if (t.includes('manhwa')) type = 'manhwa';
			else if (t.includes('manhua')) type = 'manhua';

			out.push({
				id,
				sourceId: this.id,
				title,
				cover,
				type,
				status,
				latestChapter
			});
		});

		return out;
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);

			const candidates =
				p <= 1
					? [
							`/tags/project/`,
							`/${this.SUB}-tag/project/`,
							`/${this.SUB}/?m_orderby=latest`
						]
					: [
							`/tags/project/page/${p}/`,
							`/${this.SUB}-tag/project/page/${p}/`,
							`/${this.SUB}/page/${p}/?m_orderby=latest`
						];

			for (const path of candidates) {
				try {
					const html = await this.fetchHtml(path);
					const $ = cheerio.load(html);
					const list = this.parseCards($);
					if (list.length) {
						console.log(
							`[mgkomik] latest page=${p} via ${path} → ${list.length}`
						);
						return list.slice(0, this.PER_PAGE);
					}
				} catch (e) {
					console.warn(`[mgkomik] path failed ${path}`, e);
				}
			}

			console.log(`[mgkomik] latest page=${p} → 0 items`);
			return [];
		} catch (e) {
			console.error('[mgkomik] getLatestManga', e);
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
			const $ = cheerio.load(html);
			const list = this.parseCards($);
			console.log(`[mgkomik] search "${q}" → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[mgkomik] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);
		if (!path.includes(`/${this.SUB}/`)) {
			path = `/${this.SUB}/${path.replace(/^\//, '')}`;
		}

		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const title =
			$('.post-title h1, .manga-title, h1')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('meta[property="og:title"]')
				.attr('content')
				?.replace(/\s*[-|].*$/, '')
				.trim() ||
			'Unknown';

		let cover =
			this.imgSrc(
				$('.summary_image img, .manga-thumb img, .thumb img, img.wp-post-image').first()
			) ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = this.absUrl((cover || '').split('?')[0]);

		let status = 'Ongoing';
		$('.post-content_item, .summary-content, .imptdt').each((_, el) => {
			const t = $(el).text().toLowerCase();
			if (/status/.test(t)) {
				if (/complete|selesai|tamat|end|finished/.test(t)) status = 'Completed';
				else if (/hiatus/.test(t)) status = 'Hiatus';
			}
		});

		let type = 'manga';
		$('.post-content_item, .summary-content, .imptdt').each((_, el) => {
			const t = $(el).text().toLowerCase();
			if (/type|tipe|jenis/.test(t)) {
				if (t.includes('manhwa')) type = 'manhwa';
				else if (t.includes('manhua')) type = 'manhua';
			}
		});

		const authors: string[] = [];
		$('.author-content a, .artist-content a, a[href*="manga-author"]').each(
			(_, a) => {
				const name = $(a).text().trim();
				if (name && !authors.includes(name)) authors.push(name);
			}
		);

		const genres: string[] = [];
		$('.genres-content a, .mgen a, .genres a').each((_, a) => {
			const g = $(a).text().trim();
			if (g && !genres.includes(g) && g.length < 40) genres.push(g);
		});

		const synopsis =
			$('.description-summary .summary__content, .summary__content, .manga-excerpt')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('meta[name="description"]').attr('content')?.trim() ||
			'';

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('li.wp-manga-chapter a, .listing-chapters_wrap a, .version-chap a').each(
			(_, a) => {
				const $a = $(a);
				const href = $a.attr('href') || '';
				if (!href) return;
				const id = this.cleanId(href);
				if (seen.has(id)) return;
				seen.add(id);

				let chTitle = $a.text().replace(/\s+/g, ' ').trim() || 'Chapter';
				const date =
					$a.find('.chapter-release-date').text().trim() ||
					$a.parent().find('.chapter-release-date, i').text().trim() ||
					'';
				chTitle = chTitle.replace(date, '').replace(/\s+/g, ' ').trim();
				const number = this.parseChapterNumber(chTitle) || chapters.length + 1;

				chapters.push({
					id,
					title: chTitle || `Chapter ${number}`,
					number,
					date
				});
			}
		);

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		return {
			id: path.replace(/\/+$/, ''),
			sourceId: this.id,
			title,
			cover,
			type,
			status,
			description: synopsis,
			authors,
			genres,
			chapters,
			latestChapter: chapters[0]?.number
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		try {
			const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
			const $ = cheerio.load(html);
			const urls: string[] = [];
			const seen = new Set<string>();

			for (const sel of [
				'.reading-content img',
				'#readerarea img',
				'.page-break img',
				'.entry-content img'
			]) {
				$(sel).each((_, img) => {
					let src = this.imgSrc($(img));
					if (!src || src.startsWith('data:')) return;
					src = this.absUrl(src.split('?')[0]);
					if (!/^https?:\/\//i.test(src)) return;
					if (/logo|icon|avatar|ads|banner|spinner|placeholder/i.test(src))
						return;
					if (seen.has(src)) return;
					seen.add(src);
					urls.push(src);
				});
				if (urls.length) break;
			}

			console.log(`[mgkomik] ${urls.length} pages → ${path}`);
			return urls;
		} catch (e) {
			console.error('[mgkomik] getChapterPages', path, e);
			return [];
		}
	}
}