/**
 * ThunderScans EN adapter (en-thunderscans.com)
 *
 * Theme     : Themesia / MangaReader (WordPress)
 * Latest    : /comics/?order=update  |  /comics/page/{n}/?order=update
 * Search    : /?s={query}  |  /page/{n}/?s={query}
 * Detail    : /comics/{slug}/
 * Chapter   : /{seriesSlug}-chapter-{n}/  (free) | locked modal (paywall)
 * Pages     : ts_reader.run({ sources:[{ images:[...] }] })
 *
 * ID format:
 *   manga   : /comics/{slug}
 *   chapter : /{chapter-path}   e.g. /howling-chapter-5
 */

import { BaseSource } from '../../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';
import * as cheerio from 'cheerio';

export class ThunderScansSource extends BaseSource {
	id = 'thunderscans';
	name = 'ThunderScans';
	baseUrl = 'https://en-thunderscans.com';

	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'en';

	// ── Helpers ──────────────────────────────────────────────────────────────

	private absUrl(href: string): string {
		if (!href) return '';
		if (href.startsWith('http')) return href;
		if (href.startsWith('//')) return `https:${href}`;
		return `${this.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
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

	private decodeHtml(s: string): string {
		return String(s || '')
			.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
			.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
			.replace(/&amp;/g, '&')
			.replace(/&quot;/g, '"')
			.replace(/&#039;/g, "'")
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&nbsp;/g, ' ')
			.trim();
	}

	private normalizeTitle(raw: string): string {
		return this.decodeHtml(raw)
			.replace(/\s+/g, ' ')
			.replace(/\s*[-|]\s*Thunder\s*Scans.*$/i, '')
			.trim();
	}

	private mapType(text: string): string {
		const t = (text || '').toLowerCase();
		if (/\bmanhua\b/.test(t)) return 'manhua';
		if (/\bmanga\b/.test(t) && !/\bmanhwa\b/.test(t)) return 'manga';
		if (/\bnovel\b/.test(t)) return 'novel';
		return 'manhwa';
	}

	private mapStatus(text: string): string {
		const t = (text || '').toLowerCase();
		if (/complet/.test(t)) return 'Completed';
		if (/hiatus/.test(t)) return 'Hiatus';
		if (/drop|cancel/.test(t)) return 'Dropped';
		return 'Ongoing';
	}

	private parseChapterNumber(text: string, dataNum?: string): number {
		if (dataNum != null && dataNum !== '') {
			const n = parseFloat(String(dataNum));
			if (!Number.isNaN(n)) return n;
		}
		const m = String(text || '').match(/(?:chapter|chap|ch\.?)\s*(\d+(?:\.\d+)?)/i);
		if (m) return parseFloat(m[1]);
		const n = String(text).match(/\b(\d+(?:\.\d+)?)\b/);
		return n ? parseFloat(n[1]) : 0;
	}

	private extractLatestChapter(cardHtml: string, $card: cheerio.Cheerio<any>): string | undefined {
		const live = $card.find('.epxs').first().text().replace(/\s+/g, ' ').trim();
		let m = live.match(/(?:chapter|chap|ch\.?)?\s*(\d+(?:\.\d+)?)/i);
		if (m) return m[1];

		m = cardHtml.match(/class=["']epxs["'][^>]*>\s*(?:Chapter\s*)?(\d+(?:\.\d+)?)/i);
		if (m) return m[1];

		m = cardHtml.match(/Chapter\s+(\d+(?:\.\d+)?)/i);
		if (m) return m[1];

		return undefined;
	}

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		$('.bsx, .bs .bsx').each((_, el) => {
			const $card = $(el);
			const $a = $card.find('a[href*="/comics/"]').first();
			const href = ($a.attr('href') || '').trim();
			if (!href || /\/comics\/?\?/.test(href) || /\/comics\/page\//.test(href)) return;

			const id = this.cleanId(href);
			if (!id.includes('/comics/') || seen.has(id)) return;
			seen.add(id);

			let title =
				$a.attr('title') ||
				$card.find('.tt').first().text() ||
				$a.find('img').attr('alt') ||
				'';
			title = this.normalizeTitle(title);
			if (!title || title.length < 2) return;

			const $img = $card.find('img').first();
			let cover =
				$img.attr('data-src') ||
				$img.attr('data-lazy-src') ||
				$img.attr('src') ||
				'';
			cover = this.absUrl(cover);

			const cardHtml = $.html($card) || '';
			const latestChapter = this.extractLatestChapter(cardHtml, $card);

			const cardText = $card.text().toLowerCase();
			const type = this.mapType(cardText);

			let status = 'Ongoing';
			if (/complet/.test(cardText)) status = 'Completed';
			else if (/hiatus/.test(cardText)) status = 'Hiatus';

			res.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type,
				status,
				latestChapter,
				lang: this.DEFAULT_LANG
			});
		});

		return res;
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const path =
				p <= 1
					? '/comics/?order=update'
					: `/comics/?page=${p}&order=update`;

			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			let list = this.parseCards($);

			if (list.length === 0 && p === 1) {
				const home = await this.fetchHtml('/');
				list = this.parseCards(cheerio.load(home));
			}

			const pageList = list.slice(0, this.PER_PAGE);
			console.log(`[thunderscans] latest page=${p} → ${pageList.length}`);
			return pageList;
		} catch (e) {
			console.error('[thunderscans] getLatestManga', e);
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
			const list = this.parseCards(cheerio.load(html)).slice(0, this.PER_PAGE);

			console.log(`[thunderscans] search "${q}" page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[thunderscans] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const id = this.cleanId(mangaId);
		const path = id.endsWith('/') ? id : `${id}/`;
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title = this.normalizeTitle(
			$('h1.entry-title, h1').first().text() ||
				$('meta[property="og:title"]').attr('content') ||
				''
		);

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('.thumb img, .seriestucont img, .info-left img')
				.first()
				.attr('src') ||
			$('.thumb img').first().attr('data-src') ||
			'';
		cover = this.absUrl(cover);

		let synopsis = '';
		const $desc = $(
			'.entry-content[itemprop="description"], .entry-content .wd-full p, .seriestucont p, .summary__content'
		).first();
		if ($desc.length) {
			synopsis = this.decodeHtml($desc.text()).replace(/\s+/g, ' ').trim();
		}
		if (!synopsis || synopsis.length < 40) {
			synopsis = this.decodeHtml(
				$('meta[name="description"]').attr('content') || ''
			)
				.replace(/\s*All the comics on this website.*$/i, '')
				.trim();
		}

		const metaMap: Record<string, string> = {};
		$('.imptdt').each((_, el) => {
			const $el = $(el);
			const label = $el.find('h1, b, strong').first().text().replace(/\s+/g, ' ').trim().toLowerCase();
			const value = $el.find('i').first().text().replace(/\s+/g, ' ').trim() ||
				$el.clone().children().remove().end().text().replace(/\s+/g, ' ').trim();
			if (label && value) metaMap[label] = value;
		});

		$('.fmed, .tsinfo .imptdt').each((_, el) => {
			const text = $(el).text().replace(/\s+/g, ' ').trim();
			const m = text.match(/^(Type|Status|Released|Author|Artist|Serialization|Posted On)\s+(.+)$/i);
			if (m) metaMap[m[1].toLowerCase()] = m[2].trim();
		});

		const authors: string[] = [];
		for (const key of ['author', 'artist']) {
			const v = metaMap[key];
			if (v && v !== '-' && v.toLowerCase() !== 'updating') {
				for (const part of v.split(/[,&]/)) {
					const a = part.trim();
					if (a && a.length < 50 && !authors.includes(a)) authors.push(a);
				}
			}
		}

		const type = this.mapType(metaMap['type'] || $('body').text());
		const status = this.mapStatus(metaMap['status'] || $('body').text());
		const release = metaMap['released'] || metaMap['posted on'] || '';

		const genres: string[] = [];
		$('.mgen a, .seriestugenre a, a[href*="/genres/"]').each((_, el) => {
			const g = $(el).text().replace(/\s+/g, ' ').trim();
			if (g && g.length >= 2 && g.length <= 30 && !genres.includes(g)) {
				genres.push(g);
			}
		});

		const altRaw =
			$('.alternative, .seriestualt, span.alternative').first().text() ||
			$('meta[property="og:title"]').attr('content') ||
			'';
		const altTitles = this.decodeHtml(altRaw)
			.replace(title, '')
			.split(/[,;|]/)
			.map((s) => s.trim())
			.filter((s) => s && s.length > 1 && s !== title);

		// Rating
		let rating: string | null = null;
		const ratingText =
			$('.rating .num, .rating-prc, .numscore, [itemprop="ratingValue"]')
				.first()
				.text()
				.trim() ||
			$('body').text().match(/(\d+(?:\.\d+)?)\s*\/\s*10/)?.[1] ||
			'';
		const ratingN = parseFloat(ratingText);
		if (!Number.isNaN(ratingN) && ratingN > 0 && ratingN <= 10) {
			rating = ratingN.toFixed(1);
		}

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('#chapterlist li, .eplister li, #chapterlist ul li').each((_, el) => {
			const $li = $(el);
			const $a = $li.find('a').first();
			const dataNum = $li.attr('data-num') || '';
			const chapternum = $li.find('.chapternum').text().replace(/\s+/g, ' ').trim();
			const chapterdate = $li.find('.chapterdate').text().replace(/\s+/g, ' ').trim();

			const number = this.parseChapterNumber(chapternum || dataNum, dataNum);
			if (!number && !chapternum) return;

			const href = ($a.attr('href') || '').trim();
			const isLocked =
				!!$a.attr('data-bs-target') ||
				!!$a.attr('data-coin') ||
				/lockedChapterModal/i.test($a.attr('data-bs-toggle') || '') ||
				/lockedChapterModal/i.test($a.attr('data-bs-target') || '') ||
				$li.find('.text-gold, [class*="lock"], svg').length > 0 &&
					!href;

			let chId = '';
			if (href && href.startsWith('http') && !href.includes('javascript')) {
				chId = this.cleanId(href);
			} else if (href && href.startsWith('/')) {
				chId = this.cleanId(href);
			} else {
				chId = `${id}/chapter-${number}`;
			}

			if (seen.has(chId)) return;
			seen.add(chId);

			const cleanTitle = isLocked
				? `Chapter ${number} `
				: `Chapter ${number}`;

			chapters.push({
				id: chId,
				title: cleanTitle,
				number: number || chapters.length + 1,
				date: chapterdate || undefined,
				isLocked: isLocked || undefined
			});
		});

		chapters.sort((a, b) => (a.number || 0) - (b.number || 0));

		const metaLines = [
			altTitles.length && `Alternative: ${altTitles.join(' · ')}`,
			rating && `Rating: ${rating}`,
			authors[0] && `Author: ${authors[0]}`,
			metaMap['artist'] && metaMap['artist'] !== authors[0] && `Artist: ${metaMap['artist']}`,
			metaMap['type'] && `Type: ${metaMap['type']}`,
			release && `Release: ${release}`,
			metaMap['serialization'] && `Serialization: ${metaMap['serialization']}`
		].filter(Boolean);

		const description = [...metaLines, synopsis].filter(Boolean).join('\n');

		const latestChapter =
			chapters.length > 0
				? String(chapters[chapters.length - 1].number)
				: undefined;

		return {
			id,
			sourceId: this.id,
			title: title || id.split('/').pop() || id,
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

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		if (!path || path.includes('/comics/') && path.split('/').length <= 3) {
			console.warn('[thunderscans] no real chapter URL:', chapterId);
			return [];
		}

		try {
			const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);

			const runMatch = html.match(/ts_reader\.run\((\{[\s\S]*?\})\);/);
			if (runMatch?.[1]) {
				try {
					const data = JSON.parse(runMatch[1]);
					const sources = data?.sources;
					if (Array.isArray(sources) && sources.length > 0) {
						const images: string[] = sources[0]?.images || [];
						const urls = images
							.map((u: string) => String(u || '').trim())
							.filter((u: string) => /^https?:\/\//i.test(u));
						if (urls.length > 0) {
							console.log(`[thunderscans] ${urls.length} pages (ts_reader) → ${path}`);
							return urls;
						}
					}
				} catch (e) {
					console.warn('[thunderscans] ts_reader JSON parse failed', e);
				}
			}

			const $ = cheerio.load(html);
			const urls: string[] = [];
			const seen = new Set<string>();
			$('#readerarea img, .reader-area img, #reader img').each((_, el) => {
				const src =
					$(el).attr('data-src') ||
					$(el).attr('data-lazy-src') ||
					$(el).attr('src') ||
					'';
				if (!src || src.includes('readerarea.svg') || src.includes('data:')) return;
				const abs = this.absUrl(src);
				if (seen.has(abs)) return;
				seen.add(abs);
				urls.push(abs);
			});

			console.log(`[thunderscans] ${urls.length} pages (html) → ${path}`);
			return urls;
		} catch (e) {
			console.error('[thunderscans] getChapterPages failed', chapterId, e);
			return [];
		}
	}
}
