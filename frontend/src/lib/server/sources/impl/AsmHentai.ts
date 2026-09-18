import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

/**
 * AsmHentai adapter (https://asmhentai.com)
 *
 * List/Latest : /  |  /page/{n}/
 *               /language/{english|japanese|chinese}/  |  .../page/{n}/
 * Search      : /?q=  |  /?q=&page=
 * Detail      : /g/{id}/
 * Pages       : https://images.asmhentai.com/{dir}/{id}/{n}.jpg
 *
 * Site ~20 item/halaman → merge page berikutnya sampai 24.
 *
 * ID: manga "/g/{id}" | chapter "/g/{id}/chapter/1"
 */
export class AsmHentaiSource extends BaseSource {
	id = 'asmhentai';
	name = 'AsmHentai';
	baseUrl = 'https://asmhentai.com';

	private readonly PER_PAGE = 24;

	private reqHeaders(): Record<string, string> {
		return {
			...this.headers,
			Accept:
				'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
			'Accept-Language': 'en-US,en;q=0.9',
			Referer: `${this.baseUrl}/`
		};
	}

	private async getHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const res = await fetch(url, { headers: this.reqHeaders() });
		if (!res.ok) throw new Error(`AsmHentai HTTP ${res.status} ${path}`);
		return await res.text();
	}

	private normalizeLang(lang?: string): string | null {
		const raw = String(lang || '')
			.trim()
			.toLowerCase();
		if (!raw || raw === 'all' || raw === 'any' || raw === '*') return null;
		const aliases: Record<string, string> = {
			en: 'english',
			english: 'english',
			ja: 'japanese',
			jp: 'japanese',
			japanese: 'japanese',
			zh: 'chinese',
			cn: 'chinese',
			chinese: 'chinese',
			'zh-cn': 'chinese',
			'zh-tw': 'chinese'
		};
		if (aliases[raw]) return aliases[raw];
		if (raw === 'english' || raw === 'japanese' || raw === 'chinese') return raw;
		return null;
	}

	private langCodeFromSlug(slug?: string | null): string {
		const s = String(slug || '').toLowerCase();
		if (s.startsWith('en')) return 'en';
		if (s.startsWith('ja') || s === 'jp') return 'ja';
		if (s.startsWith('zh') || s === 'cn' || s.startsWith('ch')) return 'zh';
		return 'ja';
	}

	private absUrl(href: string): string {
		if (!href) return '';
		if (href.startsWith('http')) return href;
		if (href.startsWith('//')) return `https:${href}`;
		return `${this.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
	}

	private toMangaId(gid: string | number): string {
		return `/g/${String(gid).replace(/\D/g, '')}`;
	}

	private extractGid(mangaId: string): string {
		const m = String(mangaId).match(/\/g\/(\d+)/i);
		if (m) return m[1]!;
		return String(mangaId).replace(/\D/g, '');
	}

	private toChapterId(gid: string): string {
		return `/g/${gid}/chapter/1`;
	}

	private extractChapterGid(chapterId: string): string {
		const m = String(chapterId).match(/\/g\/(\d+)/i);
		if (m) return m[1]!;
		return String(chapterId).replace(/\D/g, '');
	}

	private parseList(html: string, fallbackLang?: string | null): Manga[] {
		const $ = cheerio.load(html);
		const res: Manga[] = [];
		const seen = new Set<string>();

		$('.preview_item').each((_, el) => {
			const $el = $(el);
			const href =
				$el.find('.image a[href*="/g/"]').attr('href') ||
				$el.find('a[href*="/g/"]').attr('href') ||
				'';
			const idm = href.match(/\/g\/(\d+)/);
			if (!idm) return;

			const id = this.toMangaId(idm[1]!);
			if (seen.has(id)) return;
			seen.add(id);

			const title =
				$el
					.find('h2.caption, .cpt a, .caption a, .caption')
					.first()
					.text()
					.replace(/\s+/g, ' ')
					.trim() || `Gallery ${idm[1]}`;

			const img = $el.find('.image img.lazy, .image img').first();
			let cover =
				img.attr('data-src') ||
				img.attr('data-original') ||
				img.attr('data-lazy-src') ||
				'';
			if (!cover || cover.startsWith('data:')) {
				const src = img.attr('src') || '';
				if (src && !src.startsWith('data:') && !/\/images\/(en|jp|cn)\.png/i.test(src)) {
					cover = src;
				}
			}
			if (cover.startsWith('//')) cover = `https:${cover}`;
			cover = this.absUrl(cover);
			if (/\/images\/(en|jp|cn)\.png/i.test(cover)) cover = '';
			if (!cover) {
				cover = `https://images.asmhentai.com/019/${idm[1]}/thumb.jpg`;
			}

			const type =
				$el
					.find('.cl h3 a, a[href*="/category/"]')
					.first()
					.text()
					.replace(/\s+/g, ' ')
					.trim() || 'doujinshi';

			const langHref =
				$el.find('a[href*="/language/"]').attr('href') ||
				$el.find('a:has(.flag)').attr('href') ||
				'';
			const langSlug = langHref
				? langHref.replace(/\/$/, '').split('/').pop() || ''
				: fallbackLang || '';
			const lang = this.langCodeFromSlug(langSlug || fallbackLang);

			res.push({
				id,
				sourceId: this.id,
				title,
				cover,
				type: type.toLowerCase() || 'doujinshi',
				status: 'Completed',
				latestChapter: '1',
				lang: lang || 'ja'
			} as Manga & { lang?: string });
		});

		return res;
	}

	private listPaths(page: number, langSlug: string | null): string[] {
		const p = Math.max(1, page);
		if (langSlug) {
			if (p <= 1) return [`/language/${langSlug}/`];
			return [
				`/language/${langSlug}/page/${p}/`,
				`/language/${langSlug}/?page=${p}`
			];
		}
		if (p <= 1) return [`/`];
		return [`/page/${p}/`, `/?page=${p}`];
	}

	private async fetchListPage(
		page: number,
		langSlug: string | null
	): Promise<Manga[]> {
		for (const path of this.listPaths(page, langSlug)) {
			try {
				const html = await this.getHtml(path);
				const list = this.parseList(html, langSlug);
				if (list.length > 0) return list;
			} catch (e) {
				console.error('[asmhentai] path failed', path, e);
			}
		}
		return [];
	}

	private async fillToPerPage(
		list: Manga[],
		page: number,
		fetchNext: (pg: number) => Promise<Manga[]>
	): Promise<Manga[]> {
		if (list.length === 0 || list.length >= this.PER_PAGE) {
			return list.slice(0, this.PER_PAGE);
		}
		try {
			const extra = await fetchNext(page + 1);
			const seen = new Set(list.map((m) => m.id));
			for (const m of extra) {
				if (seen.has(m.id)) continue;
				seen.add(m.id);
				list.push(m);
				if (list.length >= this.PER_PAGE) break;
			}
		} catch (e) {
			console.error('[asmhentai] fill extra page failed', e);
		}
		return list.slice(0, this.PER_PAGE);
	}

	async getLatestManga(
		page: number,
		opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		const p = Math.max(1, Number(page) || 1);
		const langSlug = this.normalizeLang(opts?.lang);

		try {
			let list = await this.fetchListPage(p, langSlug);
			list = await this.fillToPerPage(list, p, (pg) =>
				this.fetchListPage(pg, langSlug)
			);

			console.log(
				`[asmhentai] latest page=${p} lang=${langSlug ?? 'all'} → ${list.length}`
			);
			return list;
		} catch (e) {
			console.error('[asmhentai] getLatestManga', e);
			return [];
		}
	}

	async searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page || 1);
		const langSlug = this.normalizeLang(opts?.lang);

		if (!q) return this.getLatestManga(page, opts);

		try {
			let searchQ = q;
			if (langSlug && !/\blanguage:/i.test(searchQ)) {
				searchQ = `${searchQ} language:${langSlug}`;
			}

			const fetchSearch = async (pg: number) => {
				const params = new URLSearchParams();
				params.set('q', searchQ);
				if (pg > 1) params.set('page', String(pg));
				const html = await this.getHtml(`/?${params.toString()}`);
				return this.parseList(html, langSlug);
			};

			let list = await fetchSearch(page);
			list = await this.fillToPerPage(list, page, fetchSearch);

			console.log(
				`[asmhentai] search "${q}" page=${page} lang=${langSlug ?? 'all'} → ${list.length}`
			);
			return list;
		} catch (e) {
			console.error('[asmhentai] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(
		mangaId: string,
		opts?: { lang?: string }
	): Promise<MangaDetails> {
		const gid = this.extractGid(mangaId);
		if (!gid) throw new Error(`Invalid asmhentai id: ${mangaId}`);

		const html = await this.getHtml(`/g/${gid}/`);
		const $ = cheerio.load(html);

		const title =
			$('h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('.book_page h1, .title').first().text().replace(/\s+/g, ' ').trim() ||
			`Gallery ${gid}`;

		const coverImg = $(
			'.book_page img.lazy, .book_page img, img[data-src*="cover"]'
		).first();
		let cover =
			coverImg.attr('data-src') ||
			coverImg.attr('data-original') ||
			coverImg.attr('src') ||
			'';
		if (!cover || cover.startsWith('data:')) {
			const anyCover = $(
				`img[data-src*="/${gid}/cover"], img[data-src*="/${gid}/thumb"]`
			)
				.first()
				.attr('data-src');
			if (anyCover) cover = anyCover;
		}
		if (cover.startsWith('//')) cover = `https:${cover}`;
		if (cover.startsWith('data:')) cover = '';
		cover = this.absUrl(cover);

		const loadDir =
			$('#load_dir').attr('value') ||
			$('input#load_dir').attr('value') ||
			(cover.match(/images\.asmhentai\.com\/(\d+)\//) || [])[1] ||
			'';
		if (!cover && loadDir) {
			cover = `https://images.asmhentai.com/${loadDir}/${gid}/cover.jpg`;
		}

		const tPagesRaw =
			$('#t_pages').attr('value') || $('input#t_pages').attr('value') || '';
		let pageCount = parseInt(tPagesRaw, 10) || 0;
		if (!pageCount) {
			const m = $.root().text().match(/Pages:\s*(\d+)/i);
			if (m) pageCount = parseInt(m[1]!, 10);
		}
		if (!pageCount) {
			pageCount =
				$(`.preview_thumb a, a[href*="/gallery/${gid}/"]`).length || 1;
		}

		const authors: string[] = [];
		$('a[href*="/artists/"], .tags:contains("Artists") a, a[href*="/artist/"]').each(
			(_, el) => {
				const t = $(el)
					.clone()
					.children()
					.remove()
					.end()
					.text()
					.replace(/\s+/g, ' ')
					.trim();
				if (t && !authors.includes(t)) authors.push(t);
			}
		);

		const genres: string[] = [];
		$('.tag_list a.tag, .tags a.tag, a[href*="/tag/"]').each((_, el) => {
			const t = $(el)
				.clone()
				.children()
				.remove()
				.end()
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			if (t && t.length < 40 && !genres.includes(t)) genres.push(t);
		});

		const type =
			$('a[href*="/category/"]')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() || 'doujinshi';

		const langHref =
			$('a[href*="/language/"]').attr('href') ||
			$('a:has(.flag)').attr('href') ||
			'';
		const langSlug =
			langHref.replace(/\/$/, '').split('/').pop() ||
			this.normalizeLang(opts?.lang) ||
			'japanese';

		const chapters: Chapter[] = [
			{
				id: this.toChapterId(gid),
				title: 'Chapter 1',
				number: 1,
				date: ''
			}
		];

		const metaLines = [
			`Language: ${langSlug}`,
			`Type: ${type.toLowerCase()}`,
			authors[0] && `Author: ${authors.join(', ')}`,
			authors[0] && `Artist: ${authors.join(', ')}`,
			pageCount > 0 && `Pages: ${pageCount}`
		].filter(Boolean);

		console.log(`[asmhentai] details ${gid} pages=${pageCount} dir=${loadDir}`);

		return {
			id: this.toMangaId(gid),
			sourceId: this.id,
			title,
			cover,
			type: type.toLowerCase() || 'doujinshi',
			status: 'Completed',
			description: metaLines.join('\n'),
			authors,
			genres,
			chapters,
			latestChapter: '1'
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const gid = this.extractChapterGid(chapterId);
		if (!gid) {
			console.error('[asmhentai] getChapterPages bad id:', chapterId);
			return [];
		}

		try {
			const html = await this.getHtml(`/g/${gid}/`);
			const $ = cheerio.load(html);

			const loadDir =
				$('#load_dir').attr('value') ||
				$('input#load_dir').attr('value') ||
				'';
			const tPagesRaw =
				$('#t_pages').attr('value') ||
				$('input#t_pages').attr('value') ||
				'';
			let pageCount = parseInt(tPagesRaw, 10) || 0;
			if (!pageCount) {
				const m = $.root().text().match(/Pages:\s*(\d+)/i);
				if (m) pageCount = parseInt(m[1]!, 10);
			}

			if (!loadDir || pageCount < 1) {
				const urls: string[] = [];
				$('img[src*="images.asmhentai.com"], img[data-src*="images.asmhentai.com"]').each(
					(_, el) => {
						const src =
							$(el).attr('data-src') || $(el).attr('src') || '';
						const full = src.replace(
							/(\d+)t\.(jpg|jpeg|png|webp)$/i,
							'$1.$2'
						);
						if (
							full.includes(`/${gid}/`) &&
							!/cover|thumb/i.test(full) &&
							/^https?:\/\//i.test(full)
						) {
							urls.push(full);
						}
					}
				);
				const uniq = [...new Set(urls)];
				console.log(`[asmhentai] pages fallback ${uniq.length} → ${gid}`);
				return uniq;
			}

			const urls: string[] = [];
			for (let i = 1; i <= pageCount; i++) {
				urls.push(`https://images.asmhentai.com/${loadDir}/${gid}/${i}.jpg`);
			}
			console.log(`[asmhentai] ${urls.length} pages → ${gid}`);
			return urls;
		} catch (e) {
			console.error('[asmhentai] getChapterPages failed', gid, e);
			return [];
		}
	}
}
