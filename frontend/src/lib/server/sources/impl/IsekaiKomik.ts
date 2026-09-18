import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

/**
 * IsekaiKomik adapter (MangaThemesia / mangareader)
 *
 * List/Latest : /  |  /page/{n}/
 * Search      : /?s=
 * Detail      : /manga/{slug}/
 * Chapter     : /{slug}-chapter-{n}/
 * Pages       : ts_reader.run({ sources:[{ images:[] }] })
 *
 * ID format:
 *   manga   : /manga/{slug}
 *   chapter : /{slug}-chapter-{n}
 *
 * Bahasa default: Indonesian
 */
export class IsekaiKomikSource extends BaseSource {
	id = 'isekaikomik';
	name = 'IsekaiKomik';
	baseUrl = 'https://ch1.isekaikomik.site';

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

	private imgSrc($el: cheerio.Cheerio<any>): string {
		return (
			$el.attr('data-src') ||
			$el.attr('data-lazy-src') ||
			$el.attr('data-original') ||
			$el.attr('src') ||
			''
		);
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath = String(path).match(/-chapter-(\d+(?:\.\d+)?)/i);
		if (fromPath) {
			const n = parseFloat(fromPath[1]);
			if (Number.isFinite(n)) return n;
		}
		const m = String(text).match(
			/(?:chapter|chap|ch\.?|episode|ep\.?)\s*(\d+(?:\.\d+)?)/i
		);
		if (m) return parseFloat(m[1]);
		const n = String(text).match(/\b(\d+(?:\.\d+)?)\b/);
		return n ? parseFloat(n[1]) : NaN;
	}

	private mapStatus(raw?: string | null): string {
		const s = String(raw || '').toLowerCase();
		if (/\b(completed|complete|tamat|selesai|end|finish)\b/.test(s))
			return 'Completed';
		if (/\bhiatus\b/.test(s)) return 'Hiatus';
		if (/\b(cancelled|canceled|dropped)\b/.test(s)) return 'Cancelled';
		return 'Ongoing';
	}

	private mapType(raw?: string | null): string {
		const t = String(raw || '').toLowerCase();
		if (t.includes('manhwa')) return 'manhwa';
		if (t.includes('manhua')) return 'manhua';
		if (t.includes('manga')) return 'manga';
		return 'manhwa';
	}

	/** Ambil value dari .imptdt (Status / Author / …) */
	private imptdtValue($: cheerio.CheerioAPI, label: RegExp): string {
		let found = '';
		$('.imptdt').each((_, el) => {
			const raw = $(el).text().replace(/\s+/g, ' ').trim();
			const m = raw.match(label);
			if (m) {
				found = (m[1] || '').trim();
				return false;
			}
		});
		return found;
	}

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		$('.listupd .bs .bsx, .bs .bsx, .listupd .bsx').each((_, el) => {
			const $el = $(el);
			const a = $el.find('a[href*="/manga/"]').first();
			const href = a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (!/^\/manga\/[^/]+$/.test(id)) return;
			if (seen.has(id)) return;
			seen.add(id);

			let title =
				a.attr('title') ||
				$el.find('.tt, .title, h2, h3, h4, span.name').first().text() ||
				a.text() ||
				'';
			title = title
				.replace(/\s+/g, ' ')
				.replace(/\s*(Chapter|Ch\.?)\s*\d+.*$/i, '')
				.trim();
			if (!title || title.length < 2) return;

			let cover = this.imgSrc($el.find('img').first());
			cover = this.absUrl((cover || '').split('?')[0]);

			const chText =
				$el.find('.epxs, .lsch a, .lchapter, a[href*="-chapter-"]').first().text() ||
				'';
			const chNum = this.parseChapterNumber(chText);
			const latestChapter =
				Number.isFinite(chNum) && chNum >= 0 ? chNum : undefined;

			let status = 'Ongoing';
			const statusTxt = $el.find('.status, .stts').text().toLowerCase();
			if (/complete|selesai|tamat|end/.test(statusTxt)) status = 'Completed';

			const typeClass =
				$el.find('span.type, .type').attr('class') ||
				$el.find('span.type').text() ||
				'';
			const type = this.mapType(typeClass + ' ' + $el.text());

			out.push({
				id,
				sourceId: this.id,
				title,
				cover,
				type,
				status,
				latestChapter,
				lang: this.DEFAULT_LANG
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
		const path =
			p <= 1
				? '/manga/?order=update'
				: `/manga/?page=${p}&order=update`;
		console.log(`[isekaikomik] latest p${p} → ${path}`);
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);
		const list = this.parseCards($);
		console.log(`[isekaikomik] ${list.length} manga (latest only)`);
		return list.slice(0, this.PER_PAGE);
	} catch (e) {
		console.error('[isekaikomik] getLatestManga', e);
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
			const page = Math.max(1, opts?.page || 1);
			const path =
				page <= 1
					? `/?s=${encodeURIComponent(q)}`
					: `/page/${page}/?s=${encodeURIComponent(q)}`;
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list = this.parseCards($).slice(0, this.PER_PAGE);
			console.log(`[isekaikomik] search "${q}" → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[isekaikomik] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);
		if (!path.startsWith('/manga/')) {
			path = `/manga/${path.replace(/^\//, '')}`;
		}

		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		let title =
			$('h1.entry-title, .entry-title, h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content')?.replace(/\s*[-|].*$/, '').trim() ||
			'Unknown';

		let cover =
			this.imgSrc($('.thumb img, .seriestucontl img, img.wp-post-image').first()) ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = this.absUrl((cover || '').split('?')[0]);

		const status = this.mapStatus(this.imptdtValue($, /Status\s+(.+)$/i));
		const type = this.mapType(this.imptdtValue($, /Type\s+(.+)$/i));
		const yearRaw = this.imptdtValue($, /Released\s+(.+)$/i);
		const year = (yearRaw.match(/\b(20\d{2}|19\d{2})\b/) || [])[1] || '';
		const author = this.imptdtValue($, /Author\s+(.+)$/i);
		const artist = this.imptdtValue($, /Artist\s+(.+)$/i);
		const updated = this.imptdtValue($, /Updated On\s+(.+)$/i);

		const authors: string[] = [];
		for (const name of [author, artist]) {
			if (!name || name === '?' || name === '-') continue;
			for (const part of name.split(/,|&/)) {
				const n = part.trim();
				if (n && !authors.includes(n)) authors.push(n);
			}
		}

		const genres: string[] = [];
		$('.seriestugenre a, a[rel="tag"], .genxed a').each((_, a) => {
			const g = $(a).text().trim();
			if (g && !genres.includes(g) && g.length < 40) genres.push(g);
		});

		const rating =
			$('.numscore').first().text().replace(/\s+/g, ' ').trim() ||
			$('[itemprop="ratingValue"]').first().text().trim() ||
			'';

		const synopsis =
			$('.entry-content[itemprop="description"], .seriestucon .entry-content, .desc, .summary')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('meta[name="description"]').attr('content')?.trim() ||
			'';

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('#chapterlist li, #chapterlist .chbox, .eplister li, .eplister .chbox').each(
			(_, li) => {
				const $li = $(li);
				const a = $li.find('a[href*="-chapter-"]').first();
				const href = a.attr('href') || '';
				if (!href) return;

				const id = this.cleanId(href);
				if (seen.has(id) || !/-chapter-/i.test(id)) return;
				seen.add(id);

				const chNumText = $li.find('.chapternum').text().trim() || a.text().trim();
				const date =
					$li.find('.chapterdate').text().replace(/\s+/g, ' ').trim() || '';

				const dataNum = $li.attr('data-num');
				let number = dataNum ? parseFloat(dataNum) : NaN;
				if (!Number.isFinite(number)) {
					number = this.parseChapterNumber(chNumText, id);
				}
				if (!Number.isFinite(number) || number < 0) {
					number = chapters.length + 1;
				}

				chapters.push({
					id,
					title: `Chapter ${number}`,
					number,
					date
				});
			}
		);

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const latestChapter =
			chapters.length && chapters[0].number != null
				? String(chapters[0].number)
				: undefined;

		const metaLines = [
			rating && `Rating: ${rating}`,
			authors.length && `Author: ${authors.join(' · ')}`,
			year && `Year: ${year}`,
			updated && `Updated: ${updated}`,
			`Language: Indonesian`,
			`Type: ${type}`
		].filter(Boolean);

		const description = [...metaLines, synopsis].filter(Boolean).join('\n');

		console.log(
			`[isekaikomik] details ${path} → ch=${chapters.length} rating=${rating}`
		);

		return {
			id: path.replace(/\/+$/, ''),
			sourceId: this.id,
			title,
			cover,
			type,
			status,
			description,
			authors,
			genres,
			chapters,
			latestChapter
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		if (!/-chapter-/i.test(path)) {
			console.error('[isekaikomik] getChapterPages bad id:', chapterId);
			return [];
		}

		const maxAttempts = 3;
		let lastErr: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const html = await this.fetchHtml(
					path.endsWith('/') ? path : `${path}/`
				);

				// 1) ts_reader.run({...}) — sumber utama MangaThemesia
				const m = html.match(/ts_reader\.run\((\{[\s\S]*?\})\);/);
				if (m) {
					try {
						const data = JSON.parse(m[1]) as {
							sources?: Array<{ source?: string; images?: string[] }>;
						};
						const sources = Array.isArray(data?.sources) ? data.sources : [];
						for (const src of sources) {
							const images = Array.isArray(src?.images) ? src.images : [];
							const urls = images
								.map((u) => String(u || '').trim())
								.filter((u) => /^https?:\/\//i.test(u));
							if (urls.length > 0) {
								console.log(
									`[isekaikomik] ${urls.length} pages (ts_reader/${src.source || 'S1'}) → ${path}`
								);
								return urls;
							}
						}
					} catch (e) {
						console.warn('[isekaikomik] ts_reader JSON parse fail', e);
					}
				}

				// 2) fallback: img di #readerarea
				const $ = cheerio.load(html);
				const urls: string[] = [];
				const seen = new Set<string>();

				$('#readerarea img, .readerarea img').each((_, img) => {
					let src = this.imgSrc($(img));
					if (!src || src.startsWith('data:')) return;
					src = this.absUrl(src.split('?')[0]);
					if (!/^https?:\/\//i.test(src)) return;
					if (
						/logo|icon|avatar|ads|banner|spinner|placeholder|readerarea\.svg/i.test(
							src
						)
					) {
						return;
					}
					if (seen.has(src)) return;
					seen.add(src);
					urls.push(src);
				});

				if (urls.length > 0) {
					console.log(`[isekaikomik] ${urls.length} pages (dom) → ${path}`);
					return urls;
				}

				// 3) fallback: regex CDN
				const cdn = html.match(
					/https:\/\/cdn\.isekaikomik\.com\/[^"'\\\s<>]+/gi
				);
				if (cdn?.length) {
					const unique = [...new Set(cdn.map((u) => u.trim()))];
					console.log(
						`[isekaikomik] ${unique.length} pages (cdn regex) → ${path}`
					);
					return unique;
				}

				lastErr = new Error('0 images');
				console.warn(
					`[isekaikomik] 0 pages attempt=${attempt}`,
					path,
					'htmlLen=',
					html.length
				);
				await new Promise((r) => setTimeout(r, 400 * attempt));
			} catch (e) {
				lastErr = e;
				console.error(
					`[isekaikomik] getChapterPages attempt=${attempt}`,
					path,
					e
				);
				if (attempt < maxAttempts) {
					await new Promise((r) => setTimeout(r, 500 * attempt));
				}
			}
		}

		console.error('[isekaikomik] getChapterPages failed', path, lastErr);
		return [];
	}
}