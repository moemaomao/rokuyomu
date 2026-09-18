import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

/**
 * Pornhwa18 adapter (pornhwa18.com)
 *
 * Stack: Qwik SSR
 * Latest (Project Update) : /  (homepage)
 * Catalog                 : /comic-list/?page={n}  (kumulatif ~18/page)
 * Search                  : /search/{slug}/
 * Detail                  : /comic/{slug}/
 * Chapter                 : /comic/{slug}/chapter-{n}/
 * Pages                   : img di reader (s1.manhwature.com .../chapters/chapter-N/)
 *
 * ID format:
 *   manga   : /comic/{slug}
 *   chapter : /comic/{slug}/chapter-{n}
 */
export class Pornhwa18Source extends BaseSource {
	id = 'pornhwa18';
	name = 'Pornhwa18';
	baseUrl = 'https://pornhwa18.com';

	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'en';

	private absUrl(url: string): string {
		if (!url) return '';
		url = url.trim();
		if (url.includes(' ')) url = url.split(/\s+/)[0];
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
			}
		}
		if (!id.startsWith('/')) id = `/${id}`;
		return id.replace(/\/+$/, '').split('?')[0] || '/';
	}

	private normalizeTitle(raw: string): string {
		if (!raw) return '';
		return raw
			.trim()
			.replace(/\s+/g, ' ')
			.replace(/\s*[-|]\s*Pornhwa.*$/i, '')
			.replace(/\s*[-|]\s*PornHwa18.*$/i, '')
			.trim();
	}

	private slugify(query: string): string {
		return query
			.trim()
			.toLowerCase()
			.replace(/[^\w\s-]/g, '')
			.replace(/\s+/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '');
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath = String(path).match(/chapter[_-]?(\d+)(?:[.-](\d+))?/i);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null && fromPath[2].length <= 2) {
				return parseFloat(`${major}.${fromPath[2]}`);
			}
			return major;
		}
		const m = String(text).match(
			/(?:chapter|chap|ch\.?)\s*(\d+)(?:[.,](\d+))?/i
		);
		if (m) {
			if (m[2] != null && m[2].length <= 2) {
				return parseFloat(`${m[1]}.${m[2]}`);
			}
			return parseInt(m[1], 10);
		}
		const n = String(text).match(/\b(\d+(?:\.\d{1,2})?)\b/);
		return n ? parseFloat(n[1]) : NaN;
	}

	private mapStatus(raw?: string | null): string {
		const s = String(raw || '').toLowerCase();
		if (/\b(completed|complete|end|finish)\b/.test(s)) return 'Completed';
		if (/\bhiatus\b/.test(s)) return 'Hiatus';
		if (/\b(cancelled|dropped|canceled)\b/.test(s)) return 'Cancelled';
		return 'Ongoing';
	}

	private mapType(raw: string): string {
		const t = String(raw || '').toLowerCase();
		if (t.includes('manhwa')) return 'manhwa';
		if (t.includes('manhua')) return 'manhua';
		if (t.includes('manga')) return 'manga';
		return 'manhwa';
	}

	private imgSrc($img: cheerio.Cheerio<any>): string {
		const raw =
			$img.attr('data-src') ||
			$img.attr('data-lazy-src') ||
			$img.attr('src') ||
			'';
		return (raw || '').trim().split(/\s+/)[0];
	}

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const mangas: Manga[] = [];
		const seen = new Set<string>();

		$('a[href*="/comic/"]').each((_, el) => {
			const $a = $(el);
			const href = ($a.attr('href') || '').split('?')[0];
			if (!href || /\/chapter[-/]/i.test(href)) return;
			if (!/\/comic\/[^/]+\/?$/.test(href)) return;

			const id = this.cleanId(href);

			if (
				!/^\/comic\/[^/]+$/i.test(id) ||
				id === '/comic' ||
				id.length < 9 ||
				seen.has(id)
			) {
				return;
			}
	
			const slug = id.split('/').pop() || '';
			if (!slug || slug === '-' || /^\d+$/.test(slug)) return;
			seen.add(id);

			const $img = $a.find('img').first().length
				? $a.find('img').first()
				: $a.closest('div').find('img').first();

			let title =
				$img.attr('alt') ||
				$a.attr('title') ||
				$a.text() ||
				'';
			title = this.normalizeTitle(title)
				.replace(/^(Manhwa|Manga|Manhua)\s*/i, '')
				.replace(/\s*Ch\.\s*\d+.*$/i, '')
				.trim();

			if (!title || title.length < 2 || /^(manhwa|manga|ch\.?)$/i.test(title)) {
				const $card = $a.closest('div').parent();
				const t2 = $card
					.find('a[href*="/comic/"]')
					.filter((__, a) => {
						const t = $(a).text().replace(/\s+/g, ' ').trim();
						return t.length > 2 && !/^ch\.?\s*\d+/i.test(t);
					})
					.first()
					.text();
				title = this.normalizeTitle(t2);
			}

			if (!title || title.length < 2) {
				title = slug
					.split('-')
					.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
					.join(' ');
			}

			let cover = this.imgSrc($img);
			cover = this.absUrl(cover);

			let type = 'manhwa';
			const $card = $a.closest('div').parent().parent();
			const cardText = $card.text().toLowerCase();
			if (cardText.includes('manhua')) type = 'manhua';
			else if (/\bmanga\b/.test(cardText) && !cardText.includes('manhwa'))
				type = 'manga';

			let latestChapter: string | undefined;
			let best = NaN;
			$card.find('a[href*="/chapter-"]').each((__, a) => {
				const h = $(a).attr('href') || '';
				const n = this.parseChapterNumber($(a).text(), h);
				if (Number.isFinite(n) && n > 0 && (Number.isNaN(best) || n > best)) {
					best = n;
				}
			});
			if (Number.isFinite(best)) latestChapter = String(best);

			mangas.push({
				id,
				title,
				cover,
				sourceId: this.id,
				status: 'Ongoing',
				type,
				lang: this.DEFAULT_LANG,
				latestChapter
			});
		});

		return mangas;
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);

			if (p === 1) {
				const homeHtml = await this.fetchHtml('/');
				let list = this.parseCards(cheerio.load(homeHtml));
				console.log(`[pornhwa18] homepage → ${list.length}`);

				if (list.length < this.PER_PAGE) {
					const listHtml = await this.fetchHtml('/comic-list/?page=1');
					const fill = this.parseCards(cheerio.load(listHtml));
					const seen = new Set(list.map((m) => m.id));
					for (const m of fill) {
						if (seen.has(m.id)) continue;
						seen.add(m.id);
						list.push(m);
						if (list.length >= this.PER_PAGE) break;
					}
					console.log(`[pornhwa18] home+fill → ${list.length}`);
				}

				return list.slice(0, this.PER_PAGE);
			}

			const html = await this.fetchHtml(`/comic-list/?page=${p}`);
			const all = this.parseCards(cheerio.load(html));
			const start = (p - 1) * this.PER_PAGE;
			const batch = all.slice(start, start + this.PER_PAGE);
			const list =
				batch.length > 0 ? batch : all.slice(-this.PER_PAGE);
			console.log(
				`[pornhwa18] comic-list page=${p} total=${all.length} → ${list.length}`
			);
			return list;
		} catch (e) {
			console.error('[pornhwa18] getLatestManga', e);
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
			const slug = this.slugify(q);
			if (!slug) return [];
			const html = await this.fetchHtml(`/search/${slug}/`);
			const list = this.parseCards(cheerio.load(html));
			console.log(`[pornhwa18] search "${q}" → ${list.length}`);
			const start = (page - 1) * this.PER_PAGE;
			return list.slice(start, start + this.PER_PAGE);
		} catch (e) {
			console.error('[pornhwa18] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);

		if (/\/chapter[-/]/i.test(path)) {
			const m = path.match(/^(\/comic\/[^/]+)/i);
			if (m) path = m[1];
		}
		if (!path.startsWith('/comic/')) {
			path = `/comic/${path.replace(/^\//, '')}`;
		}
		path = path.replace(/\/+$/, '');

		const html = await this.fetchHtml(path.endsWith('/') ? path : path + '/');
		const $ = cheerio.load(html);

		let title =
			$('meta[property="og:title"]').attr('content') ||
			$('h1').first().text().trim() ||
			path;
		title = this.normalizeTitle(title);

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('img[alt*="' + title.slice(0, 12) + '"]').first().attr('data-src') ||
			$('img').first().attr('data-src') ||
			$('img').first().attr('src') ||
			'';
		cover = this.absUrl((cover || '').trim().split(/\s+/)[0]);

		let description =
			$('meta[property="og:description"]').attr('content') ||
			$('meta[name="description"]').attr('content') ||
			'';
		description = description.replace(/\s+/g, ' ').trim();

		let type = 'manhwa';
		$('a[href*="/type/"]').each((_, el) => {
			const t = this.mapType($(el).text() || $(el).attr('href') || '');
			if (t) type = t;
		});

		const genres: string[] = [];
		$('a[href*="/tax/genre/"]').each((_, el) => {
			const g = $(el).text().trim();
			const href = $(el).attr('href') || '';
			if (
				g &&
				!/^(manhwa|manhua|manga)$/i.test(g) &&
				/\/tax\/genre\//i.test(href) &&
				!genres.includes(g)
			) {
				genres.push(g);
			}
		});

		const authors: string[] = [];

		const status = this.mapStatus(
			$('body').text().match(/\b(Ongoing|Completed|Hiatus)\b/i)?.[1]
		);

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$(`a[href*="${path}/chapter-"], a[href*="/chapter-"]`).each((_, el) => {
			const $a = $(el);
			const href = $a.attr('href') || '';
			if (!href || !/\/chapter[-/]/i.test(href)) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
	
			if (!id.startsWith(path + '/chapter') && !id.includes('/chapter-')) {
				return;
			}
	
			const mangaSlug = path.split('/').pop() || '';
			if (mangaSlug && !id.includes(mangaSlug)) return;

			seen.add(id);

			const number = this.parseChapterNumber($a.text(), id);
			if (!Number.isFinite(number) || number <= 0) return;

			chapters.push({
				id,
				title: `Chapter ${number}`,
				number,
				date: ''
			});
		});

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const latestChapter =
			chapters.length && chapters[0].number != null
				? String(chapters[0].number)
				: undefined;

		const metaLines = [
			`Language: English`,
			`Type: ${type}`,
			chapters.length && `Chapters: ${chapters.length}`
		].filter(Boolean);

		const fullDescription = [...metaLines, description]
			.filter(Boolean)
			.join('\n');

		console.log(
			`[pornhwa18] details ${path} → ch=${chapters.length} type=${type}`
		);

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			description: fullDescription,
			authors,
			genres,
			status,
			chapters,
			type,
			latestChapter,
			lang: this.DEFAULT_LANG
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(
			chapterId.startsWith('/') ? chapterId : `/${chapterId}`
		);

		const maxAttempts = 3;
		let lastErr: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const html = await this.fetchHtml(
					path.endsWith('/') ? path : path + '/'
				);
				const images: string[] = [];
				const seen = new Set<string>();

				const push = (src: string) => {
					src = this.absUrl((src || '').trim().split(/\s+/)[0]);
					if (
						!src ||
						seen.has(src) ||
						!/^https?:\/\//i.test(src) ||
						src.startsWith('data:') ||
						/logo|icon|avatar|spinner|ads|banner|placeholder|gravatar|emoji|cover/i.test(
							src
						) ||
						/\/covers\//i.test(src) ||
						/\.gif(\?|$)/i.test(src)
					) {
						return;
					}
					seen.add(src);
					images.push(src);
				};

				const $ = cheerio.load(html);

				$('img').each((_, img) => {
					const src = this.imgSrc($(img));
					if (
						/\/chapters\/chapter[-/]/i.test(src) ||
						/\/manga\/chapters\//i.test(src) ||
						/manhwature\.com/i.test(src)
					) {
						if (!/\/covers\//i.test(src)) push(src);
					}
				});

				if (images.length === 0) {
					const re =
						/https?:\/\/[^"'\\\s]*manhwature\.com\/[^"'\\\s]+\/chapters\/[^"'\\\s]+\.(?:jpg|jpeg|png|webp)/gi;
					const found = html.match(re) || [];
					for (const u of found) {
						if (!/\/covers\//i.test(u)) push(u);
					}
				}

				if (images.length === 0) {
					$('img').each((_, img) => {
						const src = this.imgSrc($(img));
						if (src && !/\/covers\//i.test(src) && /manhwa/i.test(src)) {
							push(src);
						}
					});
				}

				if (images.length === 0) {
					console.warn(
						`[pornhwa18] 0 pages attempt=${attempt}`,
						path,
						'htmlLen=',
						html.length
					);
					lastErr = new Error('Pornhwa18 chapter has 0 images');
					await new Promise((r) => setTimeout(r, 400 * attempt));
					continue;
				}

				console.log(`[pornhwa18] ${images.length} pages → ${path}`);
				return images;
			} catch (e) {
				lastErr = e;
				console.error(
					`[pornhwa18] getChapterPages attempt=${attempt}`,
					path,
					e
				);
				if (attempt < maxAttempts) {
					await new Promise((r) => setTimeout(r, 500 * attempt));
				}
			}
		}

		console.error('[pornhwa18] getChapterPages failed', path, lastErr);
		return [];
	}
}
