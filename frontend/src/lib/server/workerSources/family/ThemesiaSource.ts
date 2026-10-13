/**
 * Family base: MangaThemesia / MangaReader (WordPress)
 *
 * Typical paths:
 *   list   /manga/?order=update&page=N
 *   search /?s=q
 *   detail /manga/{slug}/  or  /{slug}/
 *   pages  #readerarea img  or  ts_reader.run({...})
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types-manga';

export abstract class ThemesiaSource extends BaseSource {

	protected perPage = 24;
	protected defaultLang = 'en';

	protected absUrl(url: string): string {
		if (!url) return '';
		if (url.startsWith('http')) return url;
		if (url.startsWith('//')) return `https:${url}`;
		return `${this.baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
	}

	protected cleanId(link: string): string {
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

	protected normalizeTitle(raw: string, siteName?: string): string {
		if (!raw) return '';
		let t = raw.trim().replace(/\s+/g, ' ');
		if (siteName) {
			const re = new RegExp(`\\s*[-|–]\\s*${siteName}.*$`, 'i');
			t = t.replace(re, '');
		}
		return t.trim();
	}

	protected parseChapterNumber(text: string, path = ''): number {
		const fromPath = path.match(
			/(?:chapter|chap|ch)[-_.\s]*(\d+)(?:[.-](\d+))?/i
		);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null && fromPath[2].length <= 2) {
				return parseFloat(`${major}.${fromPath[2]}`);
			}
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

	protected mapStatus(raw: string): string {
		const s = String(raw || '').toLowerCase();
		if (/complete|end|finished|tamat|selesai/.test(s)) return 'Completed';
		if (/hiatus/.test(s)) return 'Hiatus';
		if (/drop|cancel/.test(s)) return 'Dropped';
		return 'Ongoing';
	}

	protected mapType(raw: string): string {
		const t = String(raw || '').toLowerCase();
		if (t.includes('manhwa')) return 'manhwa';
		if (t.includes('manhua')) return 'manhua';
		if (t.includes('comic') || t.includes('western')) return 'comic';
		return 'manga';
	}

	protected preferFullCover(url: string): string {
		if (!url) return '';
		return url.replace(/-\d+x\d+(\.\w+)(\?.*)?$/, '$1$2');
	}

	protected seriesPath = '/manga';
	protected listPath(page: number): string {
		const p = Math.max(1, page || 1);
		return `${this.seriesPath}/?page=${p}&order=update`;
	}
	protected searchPath(query: string, page: number): string {
		const q = encodeURIComponent(query);
		return page <= 1 ? `/?s=${q}` : `/?s=${q}&page=${page}`;
	}

	protected cardSelector =
		'div.listupd div.bsx, .postbody div.bsx, div.bsx, .page-item-detail, .bs';
	protected chapterListSelector =
		'#chapterlist li a, .eplister li a, #chapterlist a, .chbox a';
	protected pageImageSelector =
		'#readerarea img, .readerarea img, .rdminimal img, #reader img, .reading-content img';

	protected parseCards($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		$(this.cardSelector).each((_, el) => {
			const $el = $(el);
			const $a = $el.find('a').first();
			const href = $a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (seen.has(id) || /\/(page|genre|tag|author|project)\//i.test(id)) return;
			seen.add(id);

			const title = this.normalizeTitle(
				$el.find('.tt, .hottitle, h2, h3').first().text() ||
					$a.attr('title') ||
					$a.text() ||
					$el.find('img').attr('alt') ||
					'',
				this.name
			);
			if (!title) return;

			const $img = $el.find('img').first();
			let cover =
				$img.attr('data-src') ||
				$img.attr('data-lazy-src') ||
				$img.attr('src') ||
				'';
			if (cover.startsWith('data:')) cover = '';
			cover = this.preferFullCover(this.absUrl(cover));

			let latestChapter: string | undefined;
			const chText = $el
				.find('.epxs, .chapter, .l').first()
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			if (chText) {
				const n = this.parseChapterNumber(chText);
				if (n > 0) latestChapter = String(n);
			}

			res.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type: this.mapType($el.text()),
				status: 'Ongoing',
				latestChapter,
				lang: this.defaultLang
			});
		});

		return res;
	}

	async getLatestManga(page: number): Promise<Manga[]> {
		const html = await this.fetchHtml(this.listPath(Math.max(1, page || 1)));
		return this.parseCards(cheerio.load(html));
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = Math.max(1, opts?.page || 1);
		const html = await this.fetchHtml(this.searchPath(query, page));
		return this.parseCards(cheerio.load(html));
	}

	protected parseChapterList($: cheerio.CheerioAPI): Chapter[] {
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$(this.chapterListSelector).each((_, a) => {
			const $a = $(a);
			const href = $a.attr('href') || '';
			if (!href) return;
			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			const title = $a.text().replace(/\s+/g, ' ').trim() || id;
			const number = this.parseChapterNumber(title, id);
			const date =
				$a.closest('li').find('.chapterdate, .dt').text().trim() || undefined;

			chapters.push({ id, title, number, date, lang: this.defaultLang });
		});

		return chapters;
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const path = this.cleanId(mangaId);
		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const title = this.normalizeTitle(
			$('h1.entry-title, h1').first().text() || '',
			this.name
		);

		const $img = $('.thumb img, .seriestucontl img, .ims img').first();
		let cover =
			$img.attr('data-src') || $img.attr('data-lazy-src') || $img.attr('src') || '';
		cover = this.preferFullCover(this.absUrl(cover));

		const description = $('.entry-content[itemprop="description"], .seriestuhead .entry-content, .entry-content')
			.first()
			.text()
			.replace(/\s+/g, ' ')
			.trim();

		const genres: string[] = [];
		$('.seriestugenre a, .mgen a, a[rel="tag"]').each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		const authors: string[] = [];
		$('.infotable tr, .fmed').each((_, row) => {
			const t = $(row).text();
			if (/author|artist|pengarang/i.test(t)) {
				const v = $(row).find('td').last().text().replace(/\s+/g, ' ').trim() ||
					$(row).find('span').last().text().replace(/\s+/g, ' ').trim();
				if (v && !authors.includes(v)) authors.push(v);
			}
		});

		let status = 'Ongoing';
		$('.status, .imptdt').each((_, el) => {
			const t = $(el).text();
			if (/status/i.test(t)) status = this.mapStatus(t);
		});

		const chapters = this.parseChapterList($);

		return {
			id: path,
			sourceId: this.id,
			title: title || path.split('/').filter(Boolean).pop() || path,
			cover,
			type: this.mapType($('.infotable, .seriestucont').text()),
			status,
			description,
			authors,
			genres,
			chapters,
			latestChapter: chapters[0] ? String(chapters[0].number) : undefined,
			lang: this.defaultLang
		};
	}

	/** Prefer ts_reader JSON, fallback to img tags */
	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const pages: string[] = [];
		const seen = new Set<string>();

		const push = (src?: string | null) => {
			if (!src || src.startsWith('data:')) return;
			const url = this.absUrl(src.split(/\s+/)[0]);
			if (!url || seen.has(url)) return;
			if (/logo|icon|avatar|emoji|spinner|loading|dummy/i.test(url)) return;
			seen.add(url);
			pages.push(url);
		};

		const m = html.match(/ts_reader\.run\((\{[\s\S]*?\})\);/);
		if (m?.[1]) {
			try {
				const data = JSON.parse(m[1]) as {
					sources?: Array<{ images?: string[] }>;
				};
				for (const src of data.sources || []) {
					for (const img of src.images || []) push(img);
				}
			} catch {
				/* fall through */
			}
		}

		if (pages.length === 0) {
			const $ = cheerio.load(html);
			$(this.pageImageSelector).each((_, img) => {
				const $img = $(img);
				push(
					$img.attr('data-src') ||
						$img.attr('data-lazy-src') ||
						$img.attr('src')
				);
			});
		}

		return pages;
	}
}
