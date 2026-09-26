/**
 * Noromax adapter (noromax02.my.id)
 *
 * Theme: Themesia MangaReader
 * Catalog utama (page 1): /project/  (section "Project Update")
 *   → dilengkapi sampai 24 judul dari /manga/?order=update bila < 24
 * Page 2+               : /manga/?order=update&page={n}
 * Search                : /?s={query}
 * Detail                : /manga/{slug}/
 * Chapter               : /{slug}-chapter-{n}/  atau  /{slug}-chapter-{n}-bahasa-indonesia/
 * Pages                 : ts_reader.run({ sources: [{ images }] })  |  #readerarea img
 *
 * ID format:
 *   manga   : /manga/{slug}
 *   chapter : /{slug}-chapter-{n}...
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class NoromaxSource extends BaseSource {
	id = 'noromax';
	name = 'Noromax';
	baseUrl = 'https://noromax02.my.id';

	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'id';

	private absUrl(url: string): string {
		if (!url) return '';
		url = url.trim();
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
			.replace(/\s*[-|]\s*Noromax.*$/i, '')
			.replace(/\s*Bahasa Indonesia\s*$/i, '')
			.replace(/^Baca\s+/i, '')
			.trim();
	}

	private parseChapterNumber(text: string, path = ''): number {
		const cleaned = String(text)
			.replace(/[🔒🔐]/g, '')
			.replace(/\s+/g, ' ')
			.trim();
		const fromPath = String(path).match(
			/chapter[_-]?(\d+)(?:[.-](\d+))?/i
		);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null && fromPath[2].length <= 2) {
				return parseFloat(`${major}.${fromPath[2]}`);
			}
			return major;
		}
		const m = cleaned.match(
			/(?:chapter|chap|ch\.?)\s*(\d+)(?:[.,](\d+))?/i
		);
		if (m) {
			if (m[2] != null && m[2].length <= 2) {
				return parseFloat(`${m[1]}.${m[2]}`);
			}
			return parseInt(m[1], 10);
		}
		const n = cleaned.match(/\b(\d+(?:\.\d{1,2})?)\b/);
		return n ? parseFloat(n[1]) : NaN;
	}

	private mapStatus(raw?: string | null): string {
		const s = String(raw || '').toLowerCase();
		if (/\b(completed|complete|tamat|selesai|end|finish)\b/.test(s))
			return 'Completed';
		if (/\bhiatus\b/.test(s)) return 'Hiatus';
		if (/\b(cancelled|dropped|canceled)\b/.test(s)) return 'Cancelled';
		return 'Ongoing';
	}

	private mapType(raw: string): 'manga' | 'manhwa' | 'manhua' {
		const t = String(raw || '').toLowerCase();
		if (t.includes('manhwa')) return 'manhwa';
		if (t.includes('manhua')) return 'manhua';
		if (t.includes('manga')) return 'manga';
		return 'manga';
	}

	private imgSrc($img: cheerio.Cheerio<any>): string {
		return (
			$img.attr('data-src') ||
			$img.attr('data-lazy-src') ||
			$img.attr('data-pagespeed-lazy-src') ||
			$img.attr('data-original') ||
			$img.attr('src') ||
			''
		);
	}

	private parseBsxCards($: cheerio.CheerioAPI): Manga[] {
		const mangas: Manga[] = [];
		const seen = new Set<string>();

		$('.listupd .bsx, .bsx, .bs .bsx').each((_, el) => {
			const $card = $(el);
			const $a = $card
				.find('a[href*="/manga/"]')
				.filter((_, a) => {
					const h = ($(a).attr('href') || '').split('?')[0];
					return /\/manga\/[^/]+\/?$/.test(h) && !/chapter/i.test(h);
				})
				.first();

			const href = ($a.attr('href') || '').split('?')[0];
			if (!href) return;

			const id = this.cleanId(href);
			if (!/^\/manga\/[^/]+$/i.test(id) || seen.has(id)) return;
			seen.add(id);

			const $img = $card.find('img').first();
			let title =
				$a.attr('title') ||
				$img.attr('alt') ||
				$img.attr('title') ||
				$card.find('.tt').first().text() ||
				'';
			title = this.normalizeTitle(title);
			if (!title || title.length < 2) {
				const slug = id.split('/').filter(Boolean).pop() || '';
				title = slug
					.split('-')
					.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
					.join(' ')
					.replace(/\s*Bahasa\s*Indonesia.*/i, '')
					.trim();
			}

			let cover = this.imgSrc($img);
			if (
				/pagespeed|data:image|svg\+xml|1\.JiBnMqyl6S/i.test(cover) ||
				!cover
			) {
				cover =
					$img.attr('data-src') ||
					$img.attr('data-lazy-src') ||
					$img.attr('data-pagespeed-lazy-src') ||
					'';
			}
			cover = this.absUrl((cover || '').trim().split('?')[0]);
			cover = cover.replace(/-\d+x\d+\.(jpg|jpeg|png|webp)$/i, '.$1');

			let type: 'manga' | 'manhwa' | 'manhua' = 'manga';
			const typeEl = $card.find('span.type').first();
			const typeText = (
				(typeEl.attr('class') || '') +
				' ' +
				typeEl.text()
			).toLowerCase();
			if (/manhwa/.test(typeText)) type = 'manhwa';
			else if (/manhua/.test(typeText)) type = 'manhua';
			else if (/manga/.test(typeText)) type = 'manga';

			let latestChapter: string | undefined;
			const epxs = $card
				.find('.epxs')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			if (epxs) {
				const n = this.parseChapterNumber(epxs);
				if (Number.isFinite(n) && n > 0) latestChapter = String(n);
			}

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

	private parseUtaoCards($: cheerio.CheerioAPI): Manga[] {
		const mangas: Manga[] = [];
		const seen = new Set<string>();

		$('.utao, .uta').each((_, el) => {
			const $card = $(el);
			const $a = $card
				.find('a.series[href*="/manga/"], a[href*="/manga/"]')
				.filter((_, a) => {
					const h = ($(a).attr('href') || '').split('?')[0];
					return /\/manga\/[^/]+\/?$/.test(h);
				})
				.first();

			const href = ($a.attr('href') || '').split('?')[0];
			if (!href) return;

			const id = this.cleanId(href);
			if (!/^\/manga\/[^/]+$/i.test(id) || seen.has(id)) return;
			seen.add(id);

			const $img = $card.find('img').first();
			let title =
				$a.attr('title') ||
				$card.find('h3, h4, .tt').first().text() ||
				$img.attr('alt') ||
				'';
			title = this.normalizeTitle(title);

			let cover = this.imgSrc($img);
			if (/pagespeed|data:image|svg\+xml/i.test(cover) || !cover) {
				cover = $img.attr('data-src') || $img.attr('data-lazy-src') || '';
			}
			cover = this.absUrl((cover || '').trim().split('?')[0]);
			cover = cover.replace(/-\d+x\d+\.(jpg|jpeg|png|webp)$/i, '.$1');

			let type: 'manga' | 'manhwa' | 'manhua' = 'manga';
			const ulClass = ($card.find('ul').attr('class') || '').toLowerCase();
			if (/manhwa/.test(ulClass)) type = 'manhwa';
			else if (/manhua/.test(ulClass)) type = 'manhua';

			let latestChapter: string | undefined;
			$card.find('ul li a, a[href*="chapter"]').each((__, a) => {
				const t = $(a).text().replace(/\s+/g, ' ').trim();
				const hrefCh = $(a).attr('href') || '';
				const n = this.parseChapterNumber(t, hrefCh);
				if (Number.isFinite(n) && n > 0) {
					latestChapter = String(n);
					return false;
				}
			});

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

	private parseAllCards($: cheerio.CheerioAPI): Manga[] {
		const seen = new Set<string>();
		const out: Manga[] = [];
		for (const m of [...this.parseUtaoCards($), ...this.parseBsxCards($)]) {
			if (seen.has(m.id)) continue;
			seen.add(m.id);
			out.push(m);
		}
		return out;
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);

			if (p === 1) {
				const projectHtml = await this.fetchHtml('/project/');
				const $project = cheerio.load(projectHtml);
				let list = this.parseAllCards($project);
				console.log(`[noromax] project-update → ${list.length}`);

				if (list.length < this.PER_PAGE) {
					const fillHtml = await this.fetchHtml('/manga/?order=update');
					const fill = this.parseBsxCards(cheerio.load(fillHtml));
					const seen = new Set(list.map((m) => m.id));
					for (const m of fill) {
						if (seen.has(m.id)) continue;
						seen.add(m.id);
						list.push(m);
						if (list.length >= this.PER_PAGE) break;
					}
					console.log(
						`[noromax] project+fill → ${list.length} (filled from latest)`
					);
				}

				return list.slice(0, this.PER_PAGE);
			}

			// Page 2+ = latest update catalog
			const path = `/manga/?order=update&page=${p}`;
			const html = await this.fetchHtml(path);
			const list = this.parseBsxCards(cheerio.load(html));
			console.log(`[noromax] latest page=${p} → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[noromax] getLatestManga', e);
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
			const params = new URLSearchParams({ s: q });
			if (page > 1) params.set('page', String(page));
			const html = await this.fetchHtml(`/?${params.toString()}`);
			const list = this.parseAllCards(cheerio.load(html));
			console.log(`[noromax] search "${q}" page=${page} → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[noromax] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);

		if (/chapter[_-]/i.test(path) && !path.startsWith('/manga/')) {
			const slug = path
				.replace(/^\//, '')
				.replace(/-chapter-[\d.]+.*$/i, '')
				.replace(/\/+$/, '');
			path = `/manga/${slug}`;
		}
		if (!path.startsWith('/manga/')) {
			path = `/manga/${path.replace(/^\//, '')}`;
		}
		path = path.replace(/\/+$/, '');

		const html = await this.fetchHtml(path.endsWith('/') ? path : path + '/');
		const $ = cheerio.load(html);

		let title =
			$('h1.entry-title, h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content') ||
			path;
		title = this.normalizeTitle(title);

		let cover =
			$('.thumb img, .seriestuimg img, .info-desc img').first().attr('data-src') ||
			$('.thumb img, .seriestuimg img').first().attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = this.absUrl((cover || '').trim().split('?')[0]);

		let description =
			$(
				'.entry-content[itemprop="description"], .entry-content .entry-content-single, .seriestuentry, .desc, .summary__content'
			)
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('meta[name="description"]').attr('content') ||
			'';
		description = description.replace(/\[&hellip;\]/g, '…').trim();

		const infoMap: Record<string, string> = {};
		$('.imptdt, .fmed, .wd-full').each((_, el) => {
			const $el = $(el);
			const raw = $el.text().replace(/\s+/g, ' ').trim();
			const m = raw.match(
				/^(Status|Type|Author|Artist|Released|Serialization)\s+(.+)$/i
			);
			if (m) infoMap[m[1].toLowerCase()] = m[2].trim();
			const label = $el
				.find('b, strong, h1, h2, h3')
				.first()
				.text()
				.trim()
				.toLowerCase();
			const val = $el
				.find('i, a, span')
				.not('b, strong')
				.first()
				.text()
				.trim();
			if (label && val) infoMap[label] = val;
		});

		const status = this.mapStatus(
			infoMap['status'] ||
				$('.imptdt:contains("Status") i').first().text()
		);

		const type = this.mapType(
			infoMap['type'] ||
				$('.imptdt:contains("Type") a, span.type').first().text() ||
				$('a[href*="type="]').first().text()
		);

		const authors: string[] = [];
		const authorRaw =
			infoMap['author'] ||
			$('.imptdt:contains("Author") i').text();
		if (authorRaw) {
			for (const a of authorRaw.split(/[,&]/)) {
				const name = a.replace(/\[Add.*?\]/gi, '').trim();
				if (name && !authors.includes(name)) authors.push(name);
			}
		}

		// Hanya genre di info manga (.mgen), jangan ambil link /genres/ dari menu/sidebar
		const genres: string[] = [];
		$('.infox .mgen a, .wd-full .mgen a, span.mgen a[rel="tag"], .mgen a[rel="tag"]').each(
			(_, el) => {
				const g = $(el).text().trim();
				if (
					g &&
					!/^(manhwa|manhua|manga)$/i.test(g) &&
					!genres.includes(g)
				) {
					genres.push(g);
				}
			}
		);

		const year =
			infoMap['released'] ||
			$('.imptdt:contains("Released") i').text().trim() ||
			'';

		const alt =
			$('.alternative, .seriestualt, span.alternative')
				.text()
				.replace(/\s+/g, ' ')
				.trim() || '';

		const rating =
			$('.rating .numscore, .numscore').first().text().trim() || '';

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('#chapterlist li, #chapterlist ul li, .eplister li').each((_, el) => {
			const $li = $(el);
			const $a = $li.find('a').first();
			const href = $a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (seen.has(id) || !/chapter[_-]/i.test(id)) return;
			seen.add(id);

			const dataNum = String($li.attr('data-num') || '').replace(
				/[🔒🔐]/g,
				''
			);
			let number = dataNum ? parseFloat(dataNum) : NaN;
			if (!Number.isFinite(number)) {
				number = this.parseChapterNumber(
					$a.find('.chapternum').text() || $a.text(),
					id
				);
			}
			if (!Number.isFinite(number) || number <= 0) return;

			const chapterTitle =
				$a.find('.chapternum').first().text().replace(/\s+/g, ' ').trim() ||
				`Chapter ${number}`;

			const date =
				$a.find('.chapterdate').first().text().replace(/\s+/g, ' ').trim() ||
				'';

			chapters.push({
				id,
				title: chapterTitle,
				number,
				date
			});
		});

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const latestChapter =
			chapters.length && chapters[0].number != null
				? String(chapters[0].number)
				: undefined;

		const metaLines = [
			alt && `Alternative: ${alt}`,
			rating && `Rating: ${rating}`,
			authors.length && `Author: ${authors.join(' · ')}`,
			year && `Publication: ${year}`,
			chapters[0]?.date && `Updated: ${chapters[0].date}`,
			`Language: Indonesian`,
			`Type: ${type}`
		].filter(Boolean);

		const fullDescription = [...metaLines, description]
			.filter(Boolean)
			.join('\n');

		console.log(
			`[noromax] details ${path} → ch=${chapters.length} status=${status} type=${type}`
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
					src = this.absUrl((src || '').trim().split('?')[0]);
					if (
						!src ||
						seen.has(src) ||
						!/^https?:\/\//i.test(src) ||
						src.startsWith('data:') ||
						/logo|icon|avatar|spinner|ads|banner|placeholder|gravatar|emoji|pagespeed|svg\+xml/i.test(
							src
						) ||
						/\.gif(\?|$)/i.test(src)
					) {
						return;
					}
					seen.add(src);
					images.push(src);
				};

				// Primary: ts_reader.run
				const tsMatch = html.match(/ts_reader\.run\((\{[\s\S]*?\})\);/);
				if (tsMatch) {
					try {
						const data = JSON.parse(tsMatch[1]);
						const sources = data?.sources;
						if (Array.isArray(sources)) {
							for (const src of sources) {
								if (Array.isArray(src?.images)) {
									for (const u of src.images) push(String(u));
								}
							}
						}
					} catch {
						/* ignore */
					}
				}

				if (images.length === 0) {
					const $ = cheerio.load(html);
					$('#readerarea img, .reader-area img, .rdminimal img').each(
						(_, img) => {
							push(this.imgSrc($(img)));
						}
					);
				}

				if (images.length === 0) {
					const re =
						/https?:\/\/(?:noromax02\.my\.id|[^"'\\\s]*cdn[^"'\\\s]*)\/[^"'\\\s<>]+\.(?:jpg|jpeg|png|webp)/gi;
					const found = html.match(re) || [];
					for (const u of found) push(u);
				}

				if (images.length === 0) {
					console.warn(
						`[noromax] 0 pages attempt=${attempt}`,
						path,
						'htmlLen=',
						html.length
					);
					lastErr = new Error('Noromax chapter has 0 images');
					await new Promise((r) => setTimeout(r, 400 * attempt));
					continue;
				}

				console.log(`[noromax] ${images.length} pages → ${path}`);
				return images;
			} catch (e) {
				lastErr = e;
				console.error(
					`[noromax] getChapterPages attempt=${attempt}`,
					path,
					e
				);
				if (attempt < maxAttempts) {
					await new Promise((r) => setTimeout(r, 500 * attempt));
				}
			}
		}

		console.error('[noromax] getChapterPages failed', path, lastErr);
		return [];
	}
}
