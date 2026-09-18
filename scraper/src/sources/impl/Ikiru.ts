import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

/**
 * Ikiru adapter (08.ikiru.wtf)
 *
 * Theme: readerkiru
 * Latest / Project : /project/  &  /project/?the_page=
 * Search           : /?s=
 * Detail           : /manga/{slug}/   (+ JSON-LD ComicSeries)
 * Chapter          : /manga/{slug}/chapter-{num}.{id}/
 * Pages            : #readerarea img / cdn.uqni.net
 *
 * ID format:
 *   manga   : /manga/{slug}
 *   chapter : /manga/{slug}/chapter-{num}.{id}
 */
export class IkiruSource extends BaseSource {
	id = 'ikiru';
	name = 'Ikiru';
	baseUrl = 'https://08.ikiru.wtf';

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

	private normalizeTitle(raw: string): string {
		if (!raw) return '';
		return raw
			.trim()
			.replace(/\s+/g, ' ')
			.replace(/\s*[-|]\s*Ikiru.*$/i, '')
			.replace(/\s*Bahasa Indonesia.*$/i, '')
			.replace(/^Baca\s+/i, '')
			.trim();
	}


private parseChapterNumber(text: string, path = ''): number {
	const fromPath = String(path).match(
		/\/chapter-(\d+)(?:\.(\d+))?(?:\.(\d+))?/i
	);
	if (fromPath) {
		const major = parseInt(fromPath[1], 10);
		const mid = fromPath[2];
		const tail = fromPath[3];

		if (tail != null) {
	
			if (mid != null && mid.length <= 2) {
				return parseFloat(`${major}.${mid}`);
			}
			return major;
		}
		if (mid != null) {
	
			if (mid.length <= 2) {
				return parseFloat(`${major}.${mid}`);
			}
			return major;
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

	private mapStatus(raw?: string | null, isCompleted?: boolean): string {
		if (isCompleted === true) return 'Completed';
		const s = String(raw || '').toLowerCase();
		if (/\b(completed|complete|tamat|selesai|end|finish)\b/.test(s))
			return 'Completed';
		if (/\bhiatus\b/.test(s)) return 'Hiatus';
		if (/\b(cancelled|dropped|canceled)\b/.test(s)) return 'Cancelled';
		return 'Ongoing';
	}

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const mangas: Manga[] = [];
		const seen = new Set<string>();

		let $cards = $('#search-results > div');
		if ($cards.length === 0) {
			$cards = $('div').filter((_, el) => {
				const $el = $(el);
				return (
					$el.find('a[href*="/manga/"]').length > 0 &&
					($el.find('a[href*="/chapter-"]').length > 0 ||
						$el.find('h1, h2, h3, .font-medium').length > 0)
				);
			});
		}

		$cards.each((_, card) => {
			const $card = $(card);

			const $mangaLink = $card
				.find('a[href*="/manga/"]')
				.filter((_, a) => {
					const h = ($(a).attr('href') || '').split('?')[0];
					return /\/manga\/[^/]+\/?$/.test(h);
				})
				.first();

			const href = $mangaLink.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			let title =
				$card.find('h1, h2, h3, .font-medium').first().text() ||
				$mangaLink.attr('title') ||
				$card.find('img.wp-post-image, img').first().attr('alt') ||
				'';
			title = this.normalizeTitle(title);
			if (!title) {
				const slug = id.split('/').filter(Boolean).pop() || '';
				title = slug
					.split('-')
					.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
					.join(' ');
			}
			if (!title) return;

			let cover =
				$card.find('img.wp-post-image').attr('src') ||
				$card.find('img[src*="uploads"]').attr('src') ||
				$card.find('img').first().attr('src') ||
				'';
			cover = this.absUrl(cover);

			const typeAlt = (
				$card
					.find('img[alt="manhwa"], img[alt="manhua"], img[alt="manga"]')
					.attr('alt') || ''
			).toLowerCase();
			let type: 'manga' | 'manhwa' | 'manhua' = 'manhwa';
			if (typeAlt === 'manga') type = 'manga';
			else if (typeAlt === 'manhua') type = 'manhua';

			const cardText = $card.text().toLowerCase();
			let status = 'Ongoing';
			if (/\b(tamat|completed|end|finish|selesai)\b/i.test(cardText)) {
				status = 'Completed';
			}

			let latestChapter: number | undefined;
			const chText =
				$card.find('a[href*="/chapter-"] p, a[href*="/chapter-"]').first().text() ||
				'';
			const chMatch = chText.match(/(\d+(?:\.\d+)?)/);
			if (chMatch) latestChapter = parseFloat(chMatch[1]);

			mangas.push({
				id,
				title,
				cover,
				sourceId: this.id,
				status,
				type,
				latestChapter,
				lang: this.DEFAULT_LANG
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
			const url =
				p <= 1
					? `${this.baseUrl}/project/`
					: `${this.baseUrl}/project/?the_page=${p}`;
			console.log(`[ikiru] project p${p} → ${url}`);
			const html = await this.fetchHtml(url);
			const $ = cheerio.load(html);
			const list = this.parseCards($);
			console.log(
				`[ikiru] ${list.length} manga, ch:`,
				list[0]?.latestChapter,
				list[0]?.title
			);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[ikiru] getLatestManga:', e);
			return [];
		}
	}

	async searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		if (!q) return this.getLatestManga(opts?.page || 1, opts);

		try {
			const path = `/?s=${encodeURIComponent(q)}`;
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list = this.parseCards($).slice(0, this.PER_PAGE);
			console.log(`[ikiru] search "${q}" → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[ikiru] searchManga:', e);
			return [];
		}
	}

	private parseJsonLd(html: string): {
		title?: string;
		description?: string;
		cover?: string;
		authors: string[];
		artists: string[];
		genres: string[];
		status?: string;
		isCompleted?: boolean;
		year?: string;
		rating?: string;
		alt?: string;
		dateModified?: string;
	} {
		const out = {
			authors: [] as string[],
			artists: [] as string[],
			genres: [] as string[]
		};
		const scripts = html.match(
			/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
		);
		if (!scripts) return out;

		for (const block of scripts) {
			const raw = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '').trim();
			let data: any;
			try {
				data = JSON.parse(raw);
			} catch {
				continue;
			}

			const items: any[] = Array.isArray(data)
				? data
				: data?.['@graph']
					? data['@graph']
					: [data];

			for (const item of items) {
				const types = Array.isArray(item?.['@type'])
					? item['@type']
					: [item?.['@type']];
				const isSeries =
					types.includes('ComicSeries') ||
					types.includes('Book') ||
					item?.author ||
					item?.aggregateRating;

				if (!isSeries) continue;

				if (item.name || item.headline) {
					(out as any).title = String(item.name || item.headline).trim();
				}
				if (item.description) {
					(out as any).description = String(item.description)
						.replace(/&#\d+;/g, (m: string) => {
							const n = parseInt(m.slice(2, -1), 10);
							return Number.isFinite(n) ? String.fromCharCode(n) : m;
						})
						.replace(/&hellip;/g, '…')
						.replace(/\s+/g, ' ')
						.trim();
				}
				const img =
					typeof item.image === 'string'
						? item.image
						: item.image?.url || item.thumbnailUrl;
				if (img) (out as any).cover = String(img);

				const pushPerson = (p: any, arr: string[]) => {
					const name =
						typeof p === 'string' ? p : p?.name ? String(p.name) : '';
					const n = name.trim();
					if (n && n !== '-' && !arr.includes(n)) arr.push(n);
				};
				if (item.author) {
					const authors = Array.isArray(item.author)
						? item.author
						: [item.author];
					authors.forEach((a: any) => pushPerson(a, out.authors));
				}
				if (item.illustrator) {
					const arts = Array.isArray(item.illustrator)
						? item.illustrator
						: [item.illustrator];
					arts.forEach((a: any) => pushPerson(a, out.artists));
				}
				if (Array.isArray(item.genre)) {
					for (const g of item.genre) {
						const name = String(g || '').trim();
						if (name && name.length < 40 && !out.genres.includes(name)) {
							out.genres.push(name);
						}
					}
				}
				if (item.creativeWorkStatus) {
					(out as any).status = String(item.creativeWorkStatus);
				}
				if (typeof item.isCompleted === 'boolean') {
					(out as any).isCompleted = item.isCompleted;
				}
				if (item.datePublished) {
					(out as any).year = String(item.datePublished).slice(0, 4);
				}
				if (item.dateModified) {
					(out as any).dateModified = String(item.dateModified);
				}
				const ar = item.aggregateRating;
				if (ar?.ratingValue != null) {
					const v = Number(ar.ratingValue);
					if (!Number.isNaN(v)) {
						(out as any).rating = v.toFixed(1);
					}
				}
				if (item.alternateName) {
					(out as any).alt = Array.isArray(item.alternateName)
						? item.alternateName.filter(Boolean).join(' · ')
						: String(item.alternateName).trim();
				}
			}
		}
		return out;
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const path = this.cleanId(
			mangaId.startsWith('/') ? mangaId : `/${mangaId.replace(/^\//, '')}`
		);
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);
		const ld = this.parseJsonLd(html);

		let title =
			ld.title ||
			$('h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content') ||
			path;
		title = this.normalizeTitle(title);

		let cover =
			ld.cover ||
			$('.thumb img, .imentry img, img.wp-post-image').attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			$('img').first().attr('src') ||
			'';
		cover = this.absUrl(cover);

		let description =
			ld.description ||
			$('.entry-content p, .desc, .summary, [itemprop="description"]')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('meta[name="description"]').attr('content') ||
			'';

		const status = this.mapStatus(ld.status, ld.isCompleted);

		const authors = [...ld.authors];
		// fallback DOM
		if (!authors.length) {
			$('a[href*="/writer/"], a[href*="/author/"]').each((_, a) => {
				const t = $(a).text().trim();
				if (t && !authors.includes(t)) authors.push(t);
			});
		}

		const genres = [...ld.genres];
		if (!genres.length) {
			$('a[href*="/genres/"], a[href*="/genre/"]').each((_, a) => {
				const t = $(a).text().trim();
				if (t && !genres.includes(t) && t.length < 30) genres.push(t);
			});
		}

		let type: 'manga' | 'manhwa' | 'manhua' = 'manhwa';
		const bodyText = $('body').text().toLowerCase();
		if (/\bmanhua\b/i.test(bodyText)) type = 'manhua';
		else if (/\bmanga\b/i.test(bodyText) && !/\bmanhwa\b/i.test(bodyText))
			type = 'manga';

		const chapters: Chapter[] = [];
const seen = new Set<string>();

$('a[href*="/chapter-"]').each((_, a) => {
	const $a = $(a);
	const href = $a.attr('href') || '';
	const id = this.cleanId(href);
	if (seen.has(id) || !/\/chapter-/.test(id)) return;
	seen.add(id);

	let rawText = $a.text().replace(/\s+/g, ' ').trim();

	rawText = rawText
		.replace(
			/\s*\d+\s*(hours?|hrs?|days?|weeks?|months?|years?|jam|hari|minggu|bulan|tahun)\s*ago.*$/i,
			''
		)
		.replace(/\s*\d{1,2}\/\d{1,2}\/\d{2,4}.*$/, '')
		.replace(/\s+[\d.,]+K?\s+\d+\s*$/i, '')
		.trim();

	const number = this.parseChapterNumber(rawText, id);
	const num = Number.isFinite(number) ? number : chapters.length + 1;

	const chapterTitle = `Chapter ${num}`;

	const date =
		$a.parent().find('span, time').not($a).last().text().trim() ||
		$a.closest('li, div').find('span, time').last().text().trim() ||
		'';

	chapters.push({
		id,
		title: chapterTitle,
		number: num,
		date
	});
});


		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const latestChapter =
			chapters.length && chapters[0].number != null
				? String(chapters[0].number)
				: undefined;

		const metaLines = [
			ld.alt && `Alternative: ${ld.alt}`,
			ld.rating && `Rating: ${ld.rating}/10`,
			authors.length && `Author: ${authors.join(' · ')}`,
			ld.artists.length && `Artist: ${ld.artists.join(' · ')}`,
			ld.year && `Year: ${ld.year}`,
			ld.dateModified &&
				`Updated: ${String(ld.dateModified).slice(0, 10)}`,
			`Language: Indonesian`,
			`Type: ${type}`
		].filter(Boolean);

		const fullDescription = [...metaLines, description]
			.filter(Boolean)
			.join('\n');

		const allCreators = [...authors];
		for (const a of ld.artists) {
			if (!allCreators.includes(a)) allCreators.push(a);
		}

		console.log(
			`[ikiru] details ${path} → ch=${chapters.length} rating=${ld.rating} year=${ld.year}`
		);

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			description: fullDescription,
			authors: allCreators,
			genres,
			status,
			chapters,
			type,
			latestChapter
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
			const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
			const res = await fetch(url, {
				headers: {
					'User-Agent':
						'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
					Accept:
						'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
					'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
					Referer: `${this.baseUrl}/`,
					Origin: this.baseUrl,
					'Cache-Control': 'no-cache'
				}
			});

			const html = await res.text();
			const lower = html.toLowerCase();
			if (
				!res.ok ||
				lower.includes('cf-browser-verification') ||
				lower.includes('just a moment') ||
				(lower.includes('challenge-platform') && html.length < 5000)
			) {
				console.warn(
					`[ikiru] chapter blocked/CF attempt=${attempt}`,
					res.status,
					path
				);
				lastErr = new Error(`Ikiru chapter blocked HTTP ${res.status}`);
				await new Promise((r) => setTimeout(r, 500 * attempt));
				continue;
			}

			const $ = cheerio.load(html);
			const images: string[] = [];
			const seen = new Set<string>();

			const push = (src: string) => {
				src = this.absUrl((src || '').trim());
				if (
					!src ||
					seen.has(src) ||
					!/^https?:\/\//i.test(src) ||
					/logo|icon|avatar|spinner|ads|banner|placeholder|gravatar|gtag/i.test(
						src
					) ||
					/\.gif(\?|$)/i.test(src)
				) {
					return;
				}
				seen.add(src);
				images.push(src);
			};

			$(
				'#readerarea img, .readerarea img, .rdminimal img, #chapter_images img, .chapter-image img, .reading-content img'
			).each((_, img) => {
				push(
					$(img).attr('data-src') ||
						$(img).attr('data-lazy-src') ||
						$(img).attr('src') ||
						''
				);
			});

			if (images.length === 0) {
				$('img').each((_, img) => {
					const src =
						$(img).attr('data-src') ||
						$(img).attr('data-lazy-src') ||
						$(img).attr('src') ||
						'';
					if (
						/cdn\.uqni\.net|\/users\//i.test(src) ||
						/\.(jpg|jpeg|png|webp|avif)(\?|$)/i.test(src)
					) {
						push(src);
					}
				});
			}

			if (images.length === 0) {
				const re =
					/https:\/\/cdn\.uqni\.net\/[^"'\\\s<>]+/gi;
				const found = html.match(re) || [];
				for (const u of found) push(u);
			}

			if (images.length === 0) {
				console.warn(
					`[ikiru] 0 pages attempt=${attempt}`,
					path,
					'htmlLen=',
					html.length
				);
				lastErr = new Error('Ikiru chapter has 0 images');
				await new Promise((r) => setTimeout(r, 400 * attempt));
				continue;
			}

			console.log(`[ikiru] ${images.length} pages → ${path}`);
			return images;
		} catch (e) {
			lastErr = e;
			console.error(`[ikiru] getChapterPages attempt=${attempt}`, path, e);
			if (attempt < maxAttempts) {
				await new Promise((r) => setTimeout(r, 500 * attempt));
			}
		}
	}

	console.error('[ikiru] getChapterPages failed', path, lastErr);
	return [];
}
}