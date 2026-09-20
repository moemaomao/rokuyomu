import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

/**
 * Manhuagui (漫画柜) adapter
 *
 * Domain   : https://www.manhuagui.com
 * Latest   : /update/
 * Search   : /s/{query}.html | /s/{query}_p{page}.html
 * Detail   : /comic/{id}/
 * Chapter  : /comic/{id}/{chapterId}.html
 *
 * ID format:
 *   manga   : /comic/{numericId}
 *   chapter : /comic/{numericId}/{chapterId}.html
 *
 * Image URL dikembalikan mentah (https://...).
 * Frontend image.ts → proxyImage() yang wrap /api/proxy.
 * Pastikan proxy set Referer https://www.manhuagui.com/ untuk hamreus.com & mhgui.com.
 */
export class ManhuaguiSource extends BaseSource {
	id = 'manhuagui';
	name = 'Manhuagui';
	baseUrl = 'https://www.manhuagui.com';

	private readonly PER_PAGE = 30;
	private readonly DEFAULT_LANG = 'zh';
	private readonly IMG_HOST = 'https://us.hamreus.com';

	// ── HTTP ─────────────────────────────────────────────────────────────────

	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const res = await fetch(url, {
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				Accept:
					'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
				'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
				Referer: `${this.baseUrl}/`,
				'Cache-Control': 'no-cache',
				Pragma: 'no-cache'
			},
			redirect: 'follow'
		});
		if (!res.ok) {
			throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
		}
		return await res.text();
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private absUrl(url: string): string {
		if (!url) return '';
		url = url.trim().replace(/&amp;/g, '&');
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

	private extractComicId(mangaId: string): string {
		const m = String(mangaId).match(/\/comic\/(\d+)/i);
		return m ? m[1] : String(mangaId).replace(/\D/g, '');
	}

		private parseChapterNumber(text: string): number {
		const t = String(text || '').trim();

		// 第8.1话 / 第17话 / 第09话
		let m = t.match(/第\s*(\d+)(?:[.,、](\d+))?\s*话/);
		if (m) {
			return m[2] != null ? parseFloat(`${m[1]}.${m[2]}`) : parseFloat(m[1]);
		}

		// 04卷 / 03卷附錄
		m = t.match(/(\d+)\s*卷/);
		if (m) {
			const base = parseFloat(m[1]) * 1000; // volume di belakang 单话
			if (/附錄|附录|番外/.test(t)) return base + 0.5;
			return base;
		}

		// 全一话 / 全1话
		m = t.match(/全\s*([一二三四五六七八九十\d]+)\s*话/);
		if (m) return 1;

		// fallback angka biasa
		m = t.match(/(\d+)(?:[.,](\d+))?/);
		if (m) {
			return m[2] != null ? parseFloat(`${m[1]}.${m[2]}`) : parseFloat(m[1]);
		}

		return 0;
	}

	private mapStatus(raw?: string | null): string {
		const s = String(raw || '').toLowerCase();
		if (/完结|完結|completed|complete|end|finished/.test(s)) return 'Completed';
		if (/hiatus|休刊/.test(s)) return 'Hiatus';
		if (/停更|cancelled|dropped/.test(s)) return 'Cancelled';
		return 'Ongoing';
	}

	// ── List parsing ─────────────────────────────────────────────────────────

	private parseUpdateList(html: string): Manga[] {
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		// <a class="cover" href="/comic/61495/" title="...">
		//   <img src="//cf.mhgui.com/cpic/m/61495.jpg" />
		//   <span class="tt">更新至02卷</span>
		// </a>
		$('a.cover[href*="/comic/"]').each((_, a) => {
			const $a = $(a);
			const href = $a.attr('href') || '';
			const m = href.match(/\/comic\/(\d+)/i);
			if (!m) return;

			const comicId = m[1];
			const id = `/comic/${comicId}`;
			if (seen.has(id)) return;
			seen.add(id);

			const $img = $a.find('img').first();
			let title = ($a.attr('title') || $img.attr('alt') || '')
				.replace(/\s+/g, ' ')
				.trim();

			if (!title) {
				const $titleA = $a
					.parent()
					.find('p.ell a, a[href*="/comic/"]')
					.not($a as any)
					.first();
				title = ($titleA.attr('title') || $titleA.text() || '')
					.replace(/\s+/g, ' ')
					.trim();
			}
			if (!title || title.length < 2) return;

			let cover =
				$img.attr('src') ||
				$img.attr('data-src') ||
				`//cf.mhgui.com/cpic/m/${comicId}.jpg`;
			cover = (cover || '').trim();
			if (cover.startsWith('//')) cover = 'https:' + cover;
			else if (cover.startsWith('/')) cover = 'https://cf.mhgui.com' + cover;
			else if (!cover.startsWith('http')) cover = this.absUrl(cover);

			const tt = $a.find('span.tt').text().replace(/\s+/g, ' ').trim();
			let latestChapter: string | undefined;
			if (tt) {
				const cm = tt.match(/更新至\s*(.+)$/) || tt.match(/(.+)/);
				if (cm) latestChapter = cm[1].trim();
			}

			list.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type: 'manga',
				status: 'Ongoing',
				latestChapter,
				lang: this.DEFAULT_LANG
			});
		});

		return list;
	}

	private parseSearchOrList(html: string): Manga[] {
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		const selectors = [
			'ul#contList li, .book-list li, .comic-list li, .list-comic li',
			'.cover a[href*="/comic/"], .thumb a[href*="/comic/"]',
			'a[href*="/comic/"][title]'
		];

		for (const sel of selectors) {
			$(sel).each((_, el) => {
				const $el = $(el);
				const $a = $el.is('a') ? $el : $el.find('a[href*="/comic/"]').first();
				const href = $a.attr('href') || '';
				const m = href.match(/\/comic\/(\d+)/i);
				if (!m) return;

				const id = `/comic/${m[1]}`;
				if (seen.has(id)) return;
				seen.add(id);

				const title = (
					$a.attr('title') ||
					$a.text() ||
					$el.find('img').attr('alt') ||
					''
				)
					.replace(/\s+/g, ' ')
					.trim();
				if (!title || title.length < 2) return;

				let cover = this.absUrl(
					$el.find('img').attr('src') ||
						$el.find('img').attr('data-src') ||
						$a.find('img').attr('src') ||
						''
				);
				if (!cover) {
					cover = `https://cf.mhgui.com/cpic/m/${m[1]}.jpg`;
				}

				list.push({
					id,
					title,
					cover,
					sourceId: this.id,
					type: 'manga',
					status: 'Ongoing',
					lang: this.DEFAULT_LANG
				});
			});

			if (list.length > 0) break;
		}

		return list;
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const path = p <= 1 ? '/update/' : `/update/?page=${p}`;

			const html = await this.fetchHtml(path);
			const list = this.parseUpdateList(html).slice(0, this.PER_PAGE);

			console.log(`[manhuagui] latest page=${p} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[manhuagui] getLatestManga', e);
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
			const encoded = encodeURIComponent(q);
			const path =
				page <= 1 ? `/s/${encoded}.html` : `/s/${encoded}_p${page}.html`;

			const html = await this.fetchHtml(path);
			const list = this.parseSearchOrList(html).slice(0, this.PER_PAGE);

			console.log(`[manhuagui] search "${q}" page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[manhuagui] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const comicId = this.extractComicId(mangaId);
		if (!comicId) throw new Error(`Manhuagui: invalid mangaId ${mangaId}`);

		const path = `/comic/${comicId}/`;
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		let title =
			$('h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content') ||
			'';
		title = title
			.replace(/\s*漫画.*$/, '')
			.replace(/\s*-\s*看漫画.*$/, '')
			.trim();

		let cover = this.absUrl(
			$('meta[property="og:image"]').attr('content') ||
				$('.hcover img, .cover img, .book-cover img').first().attr('src') ||
				$('.hcover img, .cover img').first().attr('data-src') ||
				''
		);
		if (!cover) {
			cover = `https://cf.mhgui.com/cpic/h/${comicId}.jpg`;
		}

		const description =
			$('.book-intro, .intro, .description, #intro')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('meta[name="description"]').attr('content') ||
			'';

		const statusText =
			$('.detail-list, .book-detail, .status').text() ||
			$('li.status').text() ||
			'';
		const status = this.mapStatus(statusText);

		const authors: string[] = [];
		$('a[href*="/author/"]').each((_, a) => {
			const t = $(a).text().trim();
			if (t && !authors.includes(t)) authors.push(t);
		});

		const genres: string[] = [];
		const pushGenre = (raw: string) => {
			const t = (raw || '').trim();
			if (
				!t ||
				t.length > 20 ||
				genres.includes(t) ||
				/^(全部|日本|韩国|中国|港台|连载|完结|漫画|\d{4}年?|[A-Z0-9]|更早|00年代|90年代|80年代)$/i.test(
					t
				)
			) {
				return;
			}
			genres.push(t);
		};

		$('ul.detail-list li').each((_, li) => {
			const $li = $(li);
			const label = $li.find('strong').first().text().replace(/\s+/g, '');
			if (!/剧情|類型|类型|题材/.test(label)) return;
			$li.find('a[href*="/list/"]').each((__, a) => {
				pushGenre($(a).attr('title') || $(a).text());
			});
		});

		if (genres.length === 0) {
			$('ul.detail-list a[href*="/list/"][title]').each((_, a) => {
				const href = $(a).attr('href') || '';
				if (
					/\/list\/(japan|korea|china|hongkong|taiwan|\d{4}|[a-z]|完结|连载)/i.test(
						href
					)
				) {
					return;
				}
				pushGenre($(a).attr('title') || $(a).text());
			});
		}

						const chapters: Chapter[] = [];
		const seen = new Set<string>();

		const chapterHtml = $('#chapters').html() || $('.chapter').html() || '';
		const $ch = chapterHtml ? cheerio.load(chapterHtml) : $;

		type ChapRow = {
			id: string;
			title: string;
			number: number;
			lang: string;
			sec: number;
			idx: number;
		};
		const rows: ChapRow[] = [];

		const sectionWeight = (name: string): number => {
			if (/单话|連載|连载/.test(name)) return 0;
			if (/单行本|卷/.test(name) && !/番外|附錄|附录/.test(name)) return 1;
			if (/番外|附錄|附录|短篇/.test(name)) return 2;
			return 3;
		};

		const sections: { name: string; sec: number }[] = [];
		$ch('h4').each((_, h4) => {
			const name = $ch(h4).find('span').first().text().replace(/\s+/g, ' ').trim() || '章节';
			sections.push({ name, sec: sectionWeight(name) });
		});

		let globalIdx = 0;
		$ch('a[href*="/comic/"]').each((_, a) => {
			const $a = $ch(a);
			const href = $a.attr('href') || '';
			const m = href.match(/\/comic\/(\d+)\/(\d+)\.html/i);
			if (!m) return;
			if (m[1] !== comicId) return;

			const id = `/comic/${m[1]}/${m[2]}.html`;
			if (seen.has(id)) return;
			seen.add(id);

			let titleText = ($a.attr('title') || '').replace(/\s+/g, ' ').trim();
			if (!titleText) {
				const $span = $a.find('span').first().clone();
				$span.find('i, em').remove();
				titleText = $span.text().replace(/\s+/g, ' ').trim();
			}
			if (!titleText) {
				titleText = $a.text().replace(/\s+/g, ' ').trim();
			}

			// Cari section terdekat (h4 sebelum link ini di DOM)
			let sec = 0;
			let sectionName = '';
			const prevH4 = $a.closest('div.chapter-list').prevAll('h4').first();
			if (prevH4.length) {
				sectionName = prevH4.find('span').first().text().replace(/\s+/g, ' ').trim();
				sec = sectionWeight(sectionName);
			}

			let displayTitle = titleText;
			if (sectionName && /番外|附錄|附录|单行本/.test(sectionName)) {
				if (!titleText.includes(sectionName)) {
					displayTitle = `[${sectionName}] ${titleText}`;
				}
			}

			const number = this.parseChapterNumber(titleText);

			rows.push({
				id,
				title: displayTitle || `Chapter ${number || globalIdx + 1}`,
				number: number || 0,
				lang: this.DEFAULT_LANG,
				sec,
				idx: globalIdx++
			});
		});

		// Fallback: scan seluruh page tapi tetap filter comicId
		if (rows.length === 0) {
			$('a[href*="/comic/"][href$=".html"]').each((_, a) => {
				const $a = $(a);
				const href = $a.attr('href') || '';
				const m = href.match(/\/comic\/(\d+)\/(\d+)\.html/i);
				if (!m || m[1] !== comicId) return;

				const id = `/comic/${m[1]}/${m[2]}.html`;
				if (seen.has(id)) return;
				seen.add(id);

				const titleText = ($a.attr('title') || $a.text() || '')
					.replace(/\s+/g, ' ')
					.trim();
				const number = this.parseChapterNumber(titleText);

				rows.push({
					id,
					title: titleText || `Chapter ${number || globalIdx + 1}`,
					number: number || 0,
					lang: this.DEFAULT_LANG,
					sec: 0,
					idx: globalIdx++
				});
			});
		}

		rows.sort((a, b) => {
			if (a.sec !== b.sec) return a.sec - b.sec;
			if (a.number !== b.number) return a.number - b.number;
			return a.idx - b.idx;
		});

		let autoNum = 0.01;
		for (const r of rows) {
			chapters.push({
				id: r.id,
				title: r.title,
				number: r.number || (autoNum += 0.01),
				lang: r.lang
			});
		}

		return {
			id: `/comic/${comicId}`,
			title,
			cover,
			sourceId: this.id,
			type: 'manga',
			status,
			description,
			authors,
			genres,
			chapters,
			lang: this.DEFAULT_LANG,
			latestChapter: chapters.length
				? String(chapters[chapters.length - 1].number)
				: undefined
		};
	}
	// ── Decoder (packed JS + LZString) ───────────────────────────────────────

	private decompressFromBase64(input: string): string | null {
		if (input == null) return '';
		if (input === '') return null;

		const keyStrBase64 =
			'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
		const baseReverseDic: Record<string, number> = {};
		for (let i = 0; i < keyStrBase64.length; i++) {
			baseReverseDic[keyStrBase64.charAt(i)] = i;
		}

		const f = String.fromCharCode;
		const getNextValue = (index: number) => baseReverseDic[input.charAt(index)];

		const length = input.length;
		const resetValue = 32;

		const dictionary: string[] = [];
		let enlargeIn = 4;
		let dictSize = 4;
		let numBits = 3;
		let entry = '';
		const result: string[] = [];
		let w: string;
		let bits: number;
		let resb: number;
		let maxpower: number;
		let power: number;
		let c: number | string;
		const data = {
			val: getNextValue(0),
			position: resetValue,
			index: 1
		};

		for (let i = 0; i < 3; i += 1) {
			dictionary[i] = String(i);
		}

		bits = 0;
		maxpower = Math.pow(2, 2);
		power = 1;
		while (power !== maxpower) {
			resb = data.val & data.position;
			data.position >>= 1;
			if (data.position === 0) {
				data.position = resetValue;
				data.val = getNextValue(data.index++);
			}
			bits |= (resb > 0 ? 1 : 0) * power;
			power <<= 1;
		}

		switch ((c = bits)) {
			case 0:
				bits = 0;
				maxpower = Math.pow(2, 8);
				power = 1;
				while (power !== maxpower) {
					resb = data.val & data.position;
					data.position >>= 1;
					if (data.position === 0) {
						data.position = resetValue;
						data.val = getNextValue(data.index++);
					}
					bits |= (resb > 0 ? 1 : 0) * power;
					power <<= 1;
				}
				c = f(bits);
				break;
			case 1:
				bits = 0;
				maxpower = Math.pow(2, 16);
				power = 1;
				while (power !== maxpower) {
					resb = data.val & data.position;
					data.position >>= 1;
					if (data.position === 0) {
						data.position = resetValue;
						data.val = getNextValue(data.index++);
					}
					bits |= (resb > 0 ? 1 : 0) * power;
					power <<= 1;
				}
				c = f(bits);
				break;
			case 2:
				return '';
		}

		dictionary[3] = c as string;
		w = c as string;
		result.push(c as string);

		while (true) {
			if (data.index > length) return '';

			bits = 0;
			maxpower = Math.pow(2, numBits);
			power = 1;
			while (power !== maxpower) {
				resb = data.val & data.position;
				data.position >>= 1;
				if (data.position === 0) {
					data.position = resetValue;
					data.val = getNextValue(data.index++);
				}
				bits |= (resb > 0 ? 1 : 0) * power;
				power <<= 1;
			}

			switch ((c = bits)) {
				case 0:
					bits = 0;
					maxpower = Math.pow(2, 8);
					power = 1;
					while (power !== maxpower) {
						resb = data.val & data.position;
						data.position >>= 1;
						if (data.position === 0) {
							data.position = resetValue;
							data.val = getNextValue(data.index++);
						}
						bits |= (resb > 0 ? 1 : 0) * power;
						power <<= 1;
					}
					dictionary[dictSize++] = f(bits);
					c = dictSize - 1;
					enlargeIn--;
					break;
				case 1:
					bits = 0;
					maxpower = Math.pow(2, 16);
					power = 1;
					while (power !== maxpower) {
						resb = data.val & data.position;
						data.position >>= 1;
						if (data.position === 0) {
							data.position = resetValue;
							data.val = getNextValue(data.index++);
						}
						bits |= (resb > 0 ? 1 : 0) * power;
						power <<= 1;
					}
					dictionary[dictSize++] = f(bits);
					c = dictSize - 1;
					enlargeIn--;
					break;
				case 2:
					return result.join('');
			}

			if (enlargeIn === 0) {
				enlargeIn = Math.pow(2, numBits);
				numBits++;
			}

			if (dictionary[c as number]) {
				entry = dictionary[c as number];
			} else {
				if (c === dictSize) {
					entry = w + w.charAt(0);
				} else {
					return null;
				}
			}

			result.push(entry);
			dictionary[dictSize++] = w + entry.charAt(0);
			enlargeIn--;
			w = entry;

			if (enlargeIn === 0) {
				enlargeIn = Math.pow(2, numBits);
				numBits++;
			}
		}
	}

	private packedUnpack(
		functionFrame: string,
		a: number,
		c: number,
		data: string[]
	): any {
		const e = (innerC: number): string =>
			(innerC < a ? '' : e(Math.floor(innerC / a))) +
			(innerC % a > 35
				? String.fromCharCode((innerC % a) + 29)
				: (innerC % a).toString(36));

		const d: Record<string, string> = {};
		let cc = c;
		while (cc--) {
			d[e(cc)] = data[cc] || e(cc);
		}

		const pieces = functionFrame.split(/(\b\w+\b)/);
		const js = pieces
			.map((x) => (d[x] !== undefined ? d[x] : x))
			.join('')
			.replace(/\\'/g, "'");

		const m = js.match(/\((\{[\s\S]*\})\)/);
		if (!m) {
			throw new Error('Manhuagui: failed to extract JSON from packed script');
		}
		return JSON.parse(m[1]);
	}

	private decodeChapterData(html: string): {
		files: string[];
		path: string;
		sl: { e: number; m: string };
	} {
		const m = html.match(
			/\}\(\s*'((?:\\'|[^'])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([A-Za-z0-9+/=]+)'/
		);
		if (!m) {
			const m2 = html.match(
				/function\(p,a,c,k,e,d\)\{[\s\S]*?\}\(\s*'((?:\\'|[^'])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([A-Za-z0-9+/=]+)'/
			);
			if (!m2) {
				throw new Error('Manhuagui: packed script not found');
			}
			const [, functionFrame, aStr, cStr, b64] = m2;
			const decompressed = this.decompressFromBase64(b64);
			if (!decompressed) {
				throw new Error('Manhuagui: LZString decompress failed');
			}
			return this.packedUnpack(
				functionFrame,
				parseInt(aStr, 10),
				parseInt(cStr, 10),
				decompressed.split('|')
			);
		}

		const [, functionFrame, aStr, cStr, b64] = m;
		const decompressed = this.decompressFromBase64(b64);
		if (!decompressed) {
			throw new Error('Manhuagui: LZString decompress failed');
		}

		return this.packedUnpack(
			functionFrame,
			parseInt(aStr, 10),
			parseInt(cStr, 10),
			decompressed.split('|')
		);
	}

	// ── Chapter pages ────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		if (!path.includes('/comic/') || !path.endsWith('.html')) {
			throw new Error(`Manhuagui: invalid chapterId ${chapterId}`);
		}

		try {
			const html = await this.fetchHtml(path);
			const data = this.decodeChapterData(html);

			const e = data.sl?.e ?? '';
			const m = data.sl?.m ?? '';

			const pages = (data.files || []).map((file: string) => {
				const encodedPath = encodeURI(data.path || '');
				
				return `${this.IMG_HOST}${encodedPath}${file}?e=${e}&m=${m}`;
			});

			console.log(`[manhuagui] getChapterPages → ${pages.length} pages`);
			return pages;
		} catch (err) {
			console.error('[manhuagui] getChapterPages', err);
			return [];
		}
	}
}
