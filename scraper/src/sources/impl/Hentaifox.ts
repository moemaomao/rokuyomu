
/**
 * HentaiFox adapter
 *
 * List   : /  |  /page/{n}/
 * Lang   : /language/{name}/  |  /language/{name}/page/{n}/
 * Type   : /category/{name}/  |  /category/{name}/page/{n}/
 * Search : /search/?q=
 * Detail : /gallery/{id}/
 * Pages  : thumb → full image (webp) di i*.hentaifox.com
 * ID     : "/{numericId}"
 */

import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class HentaifoxSource extends BaseSource {
	id = 'hentaifox';
	name = 'HentaiFox';
	baseUrl = 'https://hentaifox.com';

	private readonly PER_PAGE = 24;
	private readonly LANG_ID_MAP: Record<number, string> = {
		2: 'en',
		5: 'ja', 
		6: 'zh', 
		4: 'es',
		11: 'ko',
		13: 'fr', 
		17: 'ru'
	};

	private absUrl(href: string): string {
		if (!href) return '';
		if (href.startsWith('http')) return href;
		if (href.startsWith('//')) return `https:${href}`;
		return `${this.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
	}

	private toId(gid: string | number): string {
		const n = String(gid).replace(/\D/g, '');
		return `/${n}`;
	}

	private extractGid(mangaId: string): string {
		return String(mangaId).replace(/\D/g, '');
	}

	private thumbToFull(url: string): string {
		if (!url) return '';
		return url
			.replace(/\/(\d+)t\.(jpg|jpeg|png|webp)$/i, '/$1.webp')
			.replace(/\/thumb\.(jpg|jpeg|png|webp)$/i, '/1.webp')
			.replace(/\/cover\.(jpg|jpeg|png|webp)$/i, '/1.webp');
	}

	private cleanTagText($: cheerio.CheerioAPI, el: any): string {
		return $(el)
			.clone()
			.children()
			.remove()
			.end()
			.text()
			.replace(/\s+/g, ' ')
			.trim();
	}

	private normalizeLangCode(raw?: string): string | undefined {
		if (!raw) return undefined;
		const s = String(raw).trim().toLowerCase();
		if (
			!s ||
			s === 'n/a' ||
			s === 'all' ||
			s === 'any' ||
			s === '*' ||
			s === 'translated'
		) {
			return undefined;
		}

		const map: Record<string, string> = {
			japanese: 'ja',
			english: 'en',
			korean: 'ko',
			chinese: 'zh',
			spanish: 'es',
			french: 'fr',
			russian: 'ru',
			indonesian: 'id',
			indonesia: 'id',
			bahasa: 'id',
			portuguese: 'pt',
			'brazilian portuguese': 'pt-br',
			thai: 'th',
			vietnamese: 'vi',
			german: 'de',
			italian: 'it',
			polish: 'pl',
			dutch: 'nl',
			arabic: 'ar',
			turkish: 'tr',
			ja: 'ja',
			jp: 'ja',
			en: 'en',
			'en-us': 'en',
			ko: 'ko',
			kr: 'ko',
			zh: 'zh',
			cn: 'zh',
			'zh-cn': 'zh',
			'zh-hk': 'zh-hk',
			es: 'es',
			'es-la': 'es-la',
			fr: 'fr',
			ru: 'ru',
			id: 'id',
			pt: 'pt',
			'pt-br': 'pt-br',
			th: 'th',
			vi: 'vi',
			de: 'de',
			it: 'it',
			pl: 'pl',
			nl: 'nl',
			ar: 'ar',
			tr: 'tr'
		};

		if (map[s]) return map[s];
		if (/^[a-z]{2}(-[a-z]{2})?$/.test(s)) return s;
		return undefined;
	}

	private normalizeLangForSearch(lang?: string): string | null {
		const raw = String(lang || '')
			.trim()
			.toLowerCase();
		if (!raw || raw === 'all' || raw === 'any' || raw === '*') return null;

		const map: Record<string, string> = {
			english: 'english',
			en: 'english',
			'en-us': 'english',
			japanese: 'japanese',
			ja: 'japanese',
			jp: 'japanese',
			japan: 'japanese',
			chinese: 'chinese',
			zh: 'chinese',
			cn: 'chinese',
			'zh-cn': 'chinese',
			'zh-hk': 'chinese',
			korean: 'korean',
			ko: 'korean',
			kr: 'korean',
			korea: 'korean',
			spanish: 'spanish',
			es: 'spanish',
			'es-la': 'spanish',
			french: 'french',
			fr: 'french',
			russian: 'russian',
			ru: 'russian',
			german: 'german',
			de: 'german',
			indonesian: 'indonesian',
			indonesia: 'indonesian',
			bahasa: 'indonesian',
			id: 'indonesian',
			portuguese: 'portuguese',
			pt: 'portuguese',
			'pt-br': 'portuguese',
			thai: 'thai',
			th: 'thai',
			vietnamese: 'vietnamese',
			vi: 'vietnamese',
			italian: 'italian',
			it: 'italian',
			polish: 'polish',
			pl: 'polish',
			dutch: 'dutch',
			nl: 'dutch',
			arabic: 'arabic',
			ar: 'arabic',
			turkish: 'turkish',
			tr: 'turkish'
		};

		return map[raw] || raw;
	}

	private normalizeTypeForPath(type?: string): string | null {
		const raw = String(type || '')
			.trim()
			.toLowerCase();
		if (!raw || raw === 'all' || raw === 'any' || raw === '*') return null;

		const map: Record<string, string> = {
			doujinshi: 'doujinshi',
			dj: 'doujinshi',
			manga: 'manga',
			artistcg: 'artistcg',
			'artist cg': 'artistcg',
			acg: 'artistcg',
			gamecg: 'gamecg',
			'game cg': 'gamecg',
			imageset: 'imageset',
			'image set': 'imageset',
			western: 'western',
			cosplay: 'cosplay',
			'non-h': 'non-h',
			nonh: 'non-h'
		};

		return map[raw] || raw.replace(/\s+/g, '-');
	}

	private langFromDataAttr(raw?: string): string | undefined {
		if (!raw) return undefined;
		const ids = String(raw)
			.split(/\s+/)
			.map((x) => parseInt(x, 10))
			.filter((n) => Number.isFinite(n) && n > 1);

		const found = new Set<string>();
		for (const id of ids) {
			const code = this.LANG_ID_MAP[id];
			if (code) found.add(code);
		}

		const priority = ['en', 'zh', 'ja', 'ko', 'es', 'fr', 'ru'];
		for (const p of priority) {
			if (found.has(p)) return p;
		}
		return found.size ? [...found][0] : undefined;
	}

	private langFromTitle(title?: string): string | undefined {
		const text = String(title || '').toLowerCase();
		if (!text) return undefined;
		if (/\[english\]|\beng\b|\[eng\]/.test(text)) return 'en';
		if (/\[chinese\]|中国翻訳|中國翻譯|汉化|漢化|\[cn\]/.test(text)) return 'zh';
		if (/\[korean\]|한국어|\[kr\]/.test(text)) return 'ko';
		if (/\[spanish\]|\[es\]/.test(text)) return 'es';
		if (/\[french\]|\[fr\]/.test(text)) return 'fr';
		if (/\[russian\]|\[ru\]/.test(text)) return 'ru';
		if (/\[japanese\]|日本語|\[jp\]|\[ja\]/.test(text)) return 'ja';
		return undefined;
	}

	private buildListPath(
		page: number,
		opts?: { lang?: string; type?: string }
	): string {
		const p = Math.max(1, Number(page) || 1);
		const langSlug = this.normalizeLangForSearch(opts?.lang);
		const typeSlug = this.normalizeTypeForPath(opts?.type);

		if (langSlug) {
			return p <= 1
				? `/language/${langSlug}/`
				: `/language/${langSlug}/page/${p}/`;
		}
		if (typeSlug) {
			return p <= 1
				? `/category/${typeSlug}/`
				: `/category/${typeSlug}/page/${p}/`;
		}
		return p <= 1 ? '/' : `/page/${p}/`;
	}

	private parseList($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		$('div.thumb').each((_, el) => {
			const $el = $(el);

			const link =
				$el.find('h2.g_title a[href*="/gallery/"]').attr('href') ||
				$el.find('a[href*="/gallery/"]').attr('href') ||
				'';
			const m = link.match(/\/gallery\/(\d+)/);
			if (!m) return;

			const id = this.toId(m[1]);
			if (seen.has(id)) return;
			seen.add(id);

			let title = $el
				.find('h2.g_title a')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			if (!title) {
				title =
					$el.find('.caption a').first().text().replace(/\s+/g, ' ').trim() ||
					`Gallery ${m[1]}`;
			}

			const img = $el.find('.inner_thumb img, img.lazy, img').first();
			let cover =
				img.attr('data-src') ||
				img.attr('data-original') ||
				img.attr('src') ||
				'';
			if (cover.startsWith('data:')) {
				cover = img.attr('data-src') || img.attr('data-original') || '';
			}
			cover = this.absUrl(cover);

			let type =
				this.cleanTagText($, $el.find('.g_cat a, h3.g_cat a').get(0)) ||
				$el
					.find('.g_cat a, h3.g_cat a')
					.first()
					.text()
					.replace(/\d+/g, '')
					.trim() ||
				'doujinshi';
			type = type.toLowerCase() || 'doujinshi';

			const dataLang = $el.attr('data-languages') || '';
			const lang =
				this.langFromDataAttr(dataLang) || this.langFromTitle(title);

			res.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type,
				status: 'Completed',
				lang,
				latestChapter: 1
			});
		});

		return res;
	}

	async getLatestManga(
		page: number,
		opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const path = this.buildListPath(p, opts);

			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			let list = this.parseList($);

			if (list.length < this.PER_PAGE && list.length > 0) {
				try {
					const nextPath = this.buildListPath(p + 1, opts);
					const nextHtml = await this.fetchHtml(nextPath);
					const $next = cheerio.load(nextHtml);
					const nextList = this.parseList($next);
					list = [...list, ...nextList];
				} catch (e) {
					console.error('[hentaifox] failed to fetch extra pagination', e);
				}
			}

			console.log(
				`[hentaifox] latest page=${p} lang=${opts?.lang || 'all'} → ${Math.min(list.length, this.PER_PAGE)}`
			);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[hentaifox] getLatestManga', e);
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
			const params = new URLSearchParams();
			params.set('q', q);
			if (page > 1) params.set('page', String(page));

			const html = await this.fetchHtml(`/search/?${params.toString()}`);
			const $ = cheerio.load(html);
			let list = this.parseList($);

			if (list.length < this.PER_PAGE && list.length > 0) {
				try {
					const nextParams = new URLSearchParams();
					nextParams.set('q', q);
					nextParams.set('page', String(page + 1));
					const nextHtml = await this.fetchHtml(
						`/search/?${nextParams.toString()}`
					);
					const $next = cheerio.load(nextHtml);
					const nextList = this.parseList($next);
					list = [...list, ...nextList];
				} catch (e) {
					console.error('[hentaifox] failed to fetch extra search pagination', e);
				}
			}

			// Filter bahasa client-side (search path tidak selalu support lang)
			const want = this.normalizeLangCode(opts?.lang);
			if (want) {
				const filtered = list.filter((m) => m.lang === want);
				if (filtered.length) list = filtered;
			}

			console.log(`[hentaifox] search "${q}" → ${Math.min(list.length, this.PER_PAGE)}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[hentaifox] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const gid = this.extractGid(mangaId);
		if (!gid) throw new Error(`Invalid HentaiFox id: ${mangaId}`);

		const html = await this.fetchHtml(`/gallery/${gid}/`);
		const $ = cheerio.load(html);

		const title =
			$('div.info h1, .info h1, h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('title')
				.text()
				.replace(/\s*-\s*HentaiFox.*$/i, '')
				.trim() ||
			`Gallery ${gid}`;

		let cover =
			$('div.cover img').attr('src') ||
			$('div.cover img').attr('data-src') ||
			$('meta[property="og:image"]').attr('content') ||
			$('.gallery_thumb img').first().attr('data-src') ||
			$('.gallery_thumb img').first().attr('src') ||
			'';
		cover = this.absUrl(cover);
		if (cover.startsWith('//')) cover = 'https:' + cover;

		const genres: string[] = [];
		$('ul.tags a.tag_btn, ul.tags a').each((_, el) => {
			const t = this.cleanTagText($, el);
			if (t) genres.push(t);
		});

		const authors: string[] = [];
		$('ul.artists a.tag_btn, ul.artists a').each((_, el) => {
			const t = this.cleanTagText($, el);
			if (t) authors.push(t);
		});

		const groups: string[] = [];
		$('ul.groups a.tag_btn, ul.groups a').each((_, el) => {
			const t = this.cleanTagText($, el);
			if (t) groups.push(t);
		});

		const languages: string[] = [];
		$('ul.languages a.tag_btn, ul.languages a').each((_, el) => {
			const t = this.cleanTagText($, el);
			if (t) languages.push(t);
		});

		let type =
			this.cleanTagText($, $('a[href*="/category/"]').get(0)) ||
			$('a[href*="/category/"]')
				.first()
				.text()
				.replace(/\d+/g, '')
				.trim() ||
			'doujinshi';

		let pageCount = 0;
		const pagesMatch = $.root().text().match(/Pages:\s*(\d+)/i);
		if (pagesMatch) pageCount = parseInt(pagesMatch[1], 10);
		if (!pageCount) {
			pageCount = $('div.gallery_thumb a[href*="/g/"]').length;
		}

		let updateDate = '';
		const bodyText = $.root().text();
		const dateMatch = bodyText.match(
			/(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})|([A-Za-z]+\s+\d{1,2},\s+\d{4})/
		);
		if (dateMatch) {
			updateDate = dateMatch[0];
		}

		const languageRaw =
			languages.find((l) => l.toLowerCase() !== 'translated') ||
			languages[0] ||
			'';
		const language =
			this.normalizeLangCode(languageRaw) || this.langFromTitle(title);

		const id = this.toId(gid);
		const descParts = [
			languageRaw && `Language: ${languageRaw}`,
			type && `Type: ${type}`,
			authors.length && `Artists: ${authors.join(', ')}`,
			groups.length && `Groups: ${groups.join(', ')}`,
			pageCount && `Pages: ${pageCount}`,
			updateDate && `Updated: ${updateDate}`
		].filter(Boolean);

		return {
			id,
			sourceId: this.id,
			title,
			cover,
			type: type.toLowerCase(),
			status: 'Completed',
			lang: language,
			latestChapter: pageCount > 0 ? pageCount : 1,
			description: descParts.join('\n'),
			authors: authors.length ? authors : groups,
			genres,
			chapters: [
				{
					id,
					title: 'Read',
					number: 1,
					date: updateDate,
					lang: language
				}
			]
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const gid = this.extractGid(chapterId);
		if (!gid) return [];

		const html = await this.fetchHtml(`/gallery/${gid}/`);
		const $ = cheerio.load(html);

		const pages: string[] = [];
		const seen = new Set<string>();

		$('div.gallery_thumb a img, #append_thumbs img').each((_, img) => {
			let src =
				$(img).attr('data-src') ||
				$(img).attr('data-original') ||
				$(img).attr('src') ||
				'';
			if (!src || src.startsWith('data:')) return;
			src = this.absUrl(src);
			const full = this.thumbToFull(src);
			if (full && !seen.has(full)) {
				seen.add(full);
				pages.push(full);
			}
		});

		if (pages.length) return pages;

		const pagesMatch = $.root().text().match(/Pages:\s*(\d+)/i);
		const count = pagesMatch ? parseInt(pagesMatch[1], 10) : 0;
		const sample =
			$('img[data-src*="hentaifox.com"]').first().attr('data-src') ||
			$('img[src*="hentaifox.com"]').first().attr('src') ||
			$('div.cover img').attr('src') ||
			'';

		const baseMatch =
			sample.match(/(https?:\/\/i\d*\.hentaifox\.com\/\d+\/\d+)\//i) ||
			sample.match(/(\/\/i\d*\.hentaifox\.com\/\d+\/\d+)\//i);

		if (baseMatch && count > 0) {
			let base = baseMatch[1];
			if (base.startsWith('//')) base = 'https:' + base;
			for (let i = 1; i <= count; i++) {
				pages.push(`${base}/${i}.webp`);
			}
		}

		return pages;
	}
}
