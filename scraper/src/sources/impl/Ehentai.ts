import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types';
import * as cheerio from 'cheerio';

/**
 * E-Hentai Adapter
 * https://e-hentai.org
 *
 * Categories (f_cats bitmask):
 *  Misc=1, Doujinshi=2, Manga=4, Artist CG=8, Game CG=16,
 *  Image Set=32, Cosplay=64, Asian Porn=128, Non-H=256, Western=512
 *  All = 1023
 *
 * - Homepage: 24 item + lang flag badge (Ch.1)
 * - Pages: collect imgkeys → API showpage (bukan scrape HTML per gambar)
 */
export class EhentaiSource extends BaseSource {
	id = 'ehentai';
	name = 'E-Hentai';
	baseUrl = 'https://e-hentai.org';
	private apiUrl = 'https://api.e-hentai.org/api.php';
	private readonly PER_PAGE = 24;
	private static readonly CAT_ALL = 1023;
	private static readonly CAT_BITS: Record<string, number> = {
		misc: 1,
		doujinshi: 2,
		manga: 4,
		artistcg: 8,
		gamecg: 16,
		imageset: 32,
		cosplay: 64,
		asianporn: 128,
		'non-h': 256,
		nonh: 256,
		western: 512
	};

	protected getHeaders(): Record<string, string> {
		return {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
			Accept:
				'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
			'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
			Referer: this.baseUrl + '/',
			'Cache-Control': 'no-cache',
			Pragma: 'no-cache',
			Cookie: 'ipb_member_id=0205118; ipb_pass_hash=cead3ccaa9993b8ecc7074c5a7500c;'
		};
	}

	protected override async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const res = await fetch(url, {
			headers: {
				...this.getHeaders(),
				Referer: this.baseUrl + '/'
			}
		});
		if (!res.ok) {
			throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
		}
		return res.text();
	}

	private absUrl(href: string): string {
		if (!href) return '';
		if (href.startsWith('http')) return href;
		if (href.startsWith('//')) return `https:${href}`;
		return `${this.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
	}

	private parseGalleryId(
		mangaId: string
	): { gid: number; token: string; path: string } | null {
		const raw = mangaId.trim();
		const m =
			raw.match(/\/g\/(\d+)\/([0-9a-f]+)\/?/i) ||
			raw.match(/^(\d+)\/([0-9a-f]+)$/i);
		if (!m) return null;
		const gid = parseInt(m[1], 10);
		const token = m[2].toLowerCase();
		return { gid, token, path: `/g/${gid}/${token}/` };
	}

	private normalizeType(cat: string): string {
		const t = (cat || '').toLowerCase().replace(/\s+/g, '');
		if (t.includes('doujin')) return 'doujinshi';
		if (t === 'manga') return 'manga';
		if (t.includes('artist')) return 'artistcg';
		if (t.includes('game')) return 'gamecg';
		if (t.includes('image')) return 'imageset';
		if (t.includes('cosplay')) return 'cosplay';
		if (t.includes('asian')) return 'asianporn';
		if (t.includes('non')) return 'non-h';
		if (t.includes('western')) return 'western';
		if (t.includes('misc')) return 'misc';
		return t || 'manga';
	}

	private normalizeLangCode(raw?: string): string | undefined {
		if (!raw) return undefined;
		let s = String(raw).trim().toLowerCase();
		if (!s || s === 'n/a' || s === 'all' || s === 'speechless' || s === 'textless') {
			return undefined;
		}
		s = s.replace(/^language:\s*/i, '').trim();

		const map: Record<string, string> = {
			japanese: 'ja',
			english: 'en',
			korean: 'ko',
			chinese: 'zh',
			'simplified chinese': 'zh',
			'traditional chinese': 'zh-hk',
			spanish: 'es',
			french: 'fr',
			russian: 'ru',
			indonesian: 'id',
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
			'日本語': 'ja',
			'한국어': 'ko',
			'中文': 'zh',
			ja: 'ja',
			en: 'en',
			'en-us': 'en',
			ko: 'ko',
			zh: 'zh',
			'zh-cn': 'zh',
			'zh-hk': 'zh-hk',
			'zh-tw': 'zh-hk',
			es: 'es',
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

	private extractLangFromText(title: string, tagText = ''): string | undefined {
		const blob = `${title} ${tagText}`;

		const tagLang = blob.match(/language:\s*([a-z][a-z\s-]+)/i);
		if (tagLang) {
			const code = this.normalizeLangCode(tagLang[1]);
			if (code) return code;
		}

		const paren = blob.match(
			/[(\[]\s*(english|japanese|korean|chinese|spanish|french|russian|indonesian|portuguese|thai|vietnamese|german|italian|polish|dutch|arabic|turkish|中文|日本語|한국어)\s*[)\]]/i
		);
		if (paren) {
			const code = this.normalizeLangCode(paren[1]);
			if (code) return code;
		}

		return undefined;
	}

	private typeToDisabledMask(type?: string): number | null {
		if (!type || type === 'all') return null;
		const bit = EhentaiSource.CAT_BITS[type.toLowerCase().replace(/\s+/g, '')];
		if (bit == null) return null;
		return EhentaiSource.CAT_ALL - bit;
	}

	private buildListPath(query?: string, type?: string, next?: string): string {
		const params = new URLSearchParams();

		if (query) params.set('f_search', query);
		params.set('f_s', 'f_pub');
		params.set('f_sf', '1');

		const mask = this.typeToDisabledMask(type);
		if (mask != null) params.set('f_cats', String(mask));
		if (next) params.set('next', next);

		const qs = params.toString();
		return qs ? `/index.php?${qs}` : '/index.php';
	}

	private async postApi<T = any>(body: Record<string, unknown>): Promise<T> {
		const res = await fetch(this.apiUrl, {
			method: 'POST',
			headers: {
				...this.getHeaders(),
				'Content-Type': 'application/json',
				Accept: 'application/json'
			},
			body: JSON.stringify(body)
		});
		if (!res.ok) throw new Error(`EH API ${res.status}`);
		return res.json();
	}

	// ── List parsing ─────────────────────────────────────────────────────────

	private parseList($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		$('table.itg tr').each((_, tr) => {
			const $tr = $(tr);
			if ($tr.find('th').length > 0) return;

			const $a = $tr.find('a[href*="/g/"]').first();
			const href = $a.attr('href') || '';
			const parsed = this.parseGalleryId(href);
			if (!parsed) return;

			const id = parsed.path;
			if (seen.has(id)) return;
			seen.add(id);

			const title =
				$tr.find('.glink').first().text().replace(/\s+/g, ' ').trim() ||
				$a.text().replace(/\s+/g, ' ').trim() ||
				`${parsed.gid}`;

			const $img = $tr.find('img').first();
			let cover =
				$img.attr('data-src') ||
				$img.attr('data-lazy-src') ||
				$img.attr('src') ||
				'';
			if (cover.startsWith('data:')) {
				cover = $img.attr('data-src') || $img.attr('data-lazy-src') || '';
			}
			cover = this.absUrl(cover);

			const catRaw =
				$tr
					.find('.cn, .cs, .gl1c .cn, .gl1e .cn, .glcat .cn')
					.first()
					.text()
					.replace(/\s+/g, ' ')
					.trim() || 'Doujinshi';
			const type = this.normalizeType(catRaw);

			const tagText = $tr
				.find('.gt, .gtl, .gtw, td.gl4c, .gl4e')
				.map((__, el) => $(el).text())
				.get()
				.join(' ');

			const lang =
				this.extractLangFromText(title, tagText) ||
				this.normalizeLangCode(
					$tr.find('a[id^="ta_language"]').first().attr('title') ||
						$tr.find('a[id^="ta_language"]').first().text()
				);

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

	private async enrichWithGdata(list: Manga[]): Promise<Manga[]> {
		if (!list.length) return list;

		const gidlist: [number, string][] = [];
		for (const m of list) {
			const p = this.parseGalleryId(m.id);
			if (p) gidlist.push([p.gid, p.token]);
		}
		if (!gidlist.length) return list;

		try {
			const data = await this.postApi<{
				gmetadata?: Array<Record<string, any>>;
			}>({
				method: 'gdata',
				gidlist: gidlist.slice(0, 25),
				namespace: 1
			});

			const byGid = new Map<number, Record<string, any>>();
			for (const meta of data?.gmetadata || []) {
				if (meta?.gid && !meta.error) byGid.set(Number(meta.gid), meta);
			}

			return list.map((m) => {
				const p = this.parseGalleryId(m.id);
				if (!p) return m;
				const meta = byGid.get(p.gid);
				if (!meta) return m;

				const tags: string[] = Array.isArray(meta.tags)
					? meta.tags.map(String)
					: [];
				const langTag = tags.find((t) => t.startsWith('language:'));
				const lang =
					this.normalizeLangCode(langTag) ||
					this.extractLangFromText(meta.title || m.title, tags.join(' ')) ||
					m.lang;

				return {
					...m,
					lang,
					latestChapter: 1,
					cover: m.cover || this.absUrl(meta.thumb || '')
				};
			});
		} catch (e) {
			console.warn('[ehentai] enrichWithGdata failed', e);
			return list;
		}
	}

	private getNextCursor($: cheerio.CheerioAPI): string | null {
		const href = $('#dnext').attr('href') || '';
		const m = href.match(/[?&]next=(\d+)/);
		return m ? m[1] : null;
	}

	private async fetchListPage(
		startPath: string,
		page: number
	): Promise<cheerio.CheerioAPI> {
		const p = Math.max(1, page);
		let path = startPath;
		let html = await this.fetchHtml(path);
		let $ = cheerio.load(html);

		console.log(
			`[ehentai] fetchListPage "${path}" → ${html.length} bytes | has itg: ${html.includes('table.itg')}`
		);

		for (let i = 1; i < p; i++) {
			const next = this.getNextCursor($);
			if (!next) {
				console.warn(`[ehentai] no next cursor at page ${i}`);
				break;
			}

			const base = startPath.includes('?')
				? startPath.replace(/&?next=\d+/g, '').replace(/\?$/, '')
				: startPath;
			const join = base.includes('?') ? '&' : '?';
			path = `${base}${join}next=${next}`;
			html = await this.fetchHtml(path);
			$ = cheerio.load(html);

			console.log(
				`[ehentai] page ${i + 1} → ${html.length} bytes | has itg: ${html.includes('table.itg')}`
			);
		}
		return $;
	}

	async getLatestManga(
		page: number,
		opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			let query = '';
			if (opts?.lang && opts.lang !== 'all') {
				query = `language:${opts.lang}`;
			}
			const start = this.buildListPath(query || undefined, opts?.type);
			const $ = await this.fetchListPage(start, page);
			let list = this.parseList($);
			list = await this.enrichWithGdata(list);

			console.log(
				`[ehentai] getLatestManga page=${page} → ${list.length} (slice ${this.PER_PAGE})`
			);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[ehentai] getLatestManga error:', e);
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
			let search = q;
			if (opts?.lang && opts.lang !== 'all' && !/language:/i.test(search)) {
				search = `${search} language:${opts.lang}`;
			}
			const start = this.buildListPath(search, opts?.type);
			const $ = await this.fetchListPage(start, page);
			let list = this.parseList($);
			list = await this.enrichWithGdata(list);

			console.log(`[ehentai] searchManga "${q}" page=${page} → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[ehentai] searchManga error:', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const parsed = this.parseGalleryId(mangaId);
		if (!parsed) throw new Error(`Invalid E-Hentai id: ${mangaId}`);

		const { gid, token, path } = parsed;

		let title = `${gid}`;
		let titleJpn = '';
		let cover = '';
		let category = 'doujinshi';
		let rating = '0.0';
		let filecount = 0;
		let tags: string[] = [];
		let uploader = '';
		let posted = '';
		let lang: string | undefined;

		try {
			const data = await this.postApi<{
				gmetadata?: Array<Record<string, any>>;
			}>({
				method: 'gdata',
				gidlist: [[gid, token]],
				namespace: 1
			});

			const meta = data?.gmetadata?.[0];
			if (meta && !meta.error) {
				title = meta.title || title;
				titleJpn = meta.title_jpn || '';
				cover = meta.thumb || '';
				category = this.normalizeType(meta.category || category);
				rating = String(meta.rating || '0');
				filecount = parseInt(String(meta.filecount || '0'), 10) || 0;
				uploader = meta.uploader || '';

				if (Array.isArray(meta.tags)) tags = meta.tags.map(String);

				const langTag = tags.find((t) => t.startsWith('language:'));
				lang =
					this.normalizeLangCode(langTag) ||
					this.extractLangFromText(title, tags.join(' '));

				if (meta.posted) {
					const ts = parseInt(String(meta.posted), 10);
					if (ts > 0) posted = new Date(ts * 1000).toISOString().slice(0, 10);
				}
			}
		} catch (e) {
			console.error('[ehentai] gdata failed:', e);
		}

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		if (!title || title === `${gid}`) {
			title = $('#gn').text().replace(/\s+/g, ' ').trim() || title;
		}
		if (!titleJpn) {
			titleJpn = $('#gj').text().replace(/\s+/g, ' ').trim();
		}
		if (!cover) {
			const style =
				$('#gd1 > div').attr('style') || $('#gd1').attr('style') || '';
			const bm = style.match(/url\(([^)]+)\)/i);
			if (bm) cover = bm[1].replace(/['"]/g, '').trim();
		}
		if (!category || category === 'doujinshi') {
			const catText = $('#gdc .cs, #gdc .cn, #gdc')
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			if (catText) category = this.normalizeType(catText);
		}
		if (rating === '0.0' || rating === '0') {
			const rl = $('#rating_label').text();
			const rm = rl.match(/([\d.]+)/);
			if (rm) rating = rm[1];
		}
		if (filecount <= 0) {
			const lenText = $('#gdd').text();
			const lm = lenText.match(/Length:\s*(\d+)\s*pages/i);
			if (lm) filecount = parseInt(lm[1], 10);
		}
		if (!posted) {
			const postedRow = $('#gdd tr')
				.filter((_, el) => $(el).text().toLowerCase().includes('posted'))
				.first()
				.text();
			const pm = postedRow.match(/Posted:\s*([\d-]+)/i);
			if (pm) posted = pm[1].trim();
		}
		if (tags.length === 0) {
			$('#taglist a').each((_, el) => {
				const t = $(el).text().replace(/\s+/g, ' ').trim();
				if (t) tags.push(t);
			});
		}
		if (!lang) {
			const langTag = tags.find((t) => t.startsWith('language:'));
			lang =
				this.normalizeLangCode(langTag) ||
				this.extractLangFromText(title, tags.join(' '));
		}

		const genres = tags.map((t) => {
			const parts = t.split(':');
			return parts.length > 1 ? parts.slice(1).join(':') : t;
		});

		const authors: string[] = [];
		for (const t of tags) {
			if (t.startsWith('artist:')) authors.push(t.slice(7));
			if (t.startsWith('group:')) authors.push(t.slice(6));
		}

		const description = [
			rating && rating !== '0' ? `Rating: ${parseFloat(rating).toFixed(1)}` : '',
			`Status: Completed`,
			`Type: ${category}`,
			filecount > 0 ? `Pages: ${filecount}` : '',
			lang ? `Language: ${lang}` : '',
			uploader ? `Uploader: ${uploader}` : '',
			posted ? `Posted: ${posted}` : '',
			titleJpn ? `AltTitle: ${titleJpn}` : ''
		]
			.filter(Boolean)
			.join('\n');

		const chapters: Chapter[] = [
			{
				id: path,
				title: filecount > 0 ? `Read (${filecount} pages)` : 'Read',
				number: 1,
				date: posted,
				lang
			}
		];

		return {
			id: path,
			sourceId: this.id,
			title,
			cover: this.absUrl(cover),
			type: category,
			status: 'Completed',
			lang,
			latestChapter: 1,
			description,
			authors,
			genres,
			chapters
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const parsed = this.parseGalleryId(chapterId);
		if (!parsed) throw new Error(`Invalid E-Hentai chapter id: ${chapterId}`);

		const { gid, path } = parsed;

		const html0 = await this.fetchHtml(path);
		const $0 = cheerio.load(html0);

		let totalImages = 0;
		const lenMatch = $0('#gdd').text().match(/Length:\s*(\d+)\s*pages/i);
		if (lenMatch) totalImages = parseInt(lenMatch[1], 10);

		if (!totalImages) {
			const gpc = $0('.gpc').text();
			const m = gpc.match(/of\s+([\d,]+)\s+images/i);
			if (m) totalImages = parseInt(m[1].replace(/,/g, ''), 10);
		}

		const imgkeys = new Map<number, string>();

		const collect = ($: cheerio.CheerioAPI): number => {
			let added = 0;
			$('a[href*="/s/"]').each((_, el) => {
				const href = $(el).attr('href') || '';
				const m = href.match(/\/s\/([0-9a-f]+)\/(\d+)-(\d+)/i);
				if (!m) return;
				if (parseInt(m[2], 10) !== gid) return;
				const page = parseInt(m[3], 10);
				if (!imgkeys.has(page)) {
					imgkeys.set(page, m[1]);
					added++;
				}
			});
			return added;
		};

		collect($0);

		const MAX_THUMB_PAGES = 50;
		for (let p = 1; p < MAX_THUMB_PAGES; p++) {
			if (totalImages > 0 && imgkeys.size >= totalImages) break;

			try {
				const html = await this.fetchHtml(`${path}?p=${p}`);
				const added = collect(cheerio.load(html));
				console.log(
					`[ehentai] thumb p=${p} +${added} (total ${imgkeys.size}/${totalImages || '?'})`
				);
				if (added === 0) break;
			} catch (e) {
				console.warn(`[ehentai] thumb p=${p} failed`, e);
				break;
			}
		}

		console.log(
			`[ehentai] collected ${imgkeys.size} imgkeys (expected ${totalImages || '?'})`
		);
		if (!imgkeys.size) return [];

		const firstPage = Math.min(...imgkeys.keys());
		const firstKey = imgkeys.get(firstPage)!;
		const pageHtml = await this.fetchHtml(`/s/${firstKey}/${gid}-${firstPage}`);
		const sk =
			pageHtml.match(/showkey\s*=\s*["']([0-9a-f-]+)["']/i) ||
			pageHtml.match(/var\s+showkey\s*=\s*["']([^"']+)["']/i);
		const showkey = sk?.[1] || '';

		if (!showkey) {
			console.error('[ehentai] showkey not found — cookie mungkin expired');
			return [];
		}

		const entries = [...imgkeys.entries()].sort((a, b) => a[0] - b[0]);
		const images: string[] = new Array(entries.length).fill('');
		const CONCURRENCY = 10;

		const resolve = async (page: number, imgkey: string, idx: number) => {
			try {
				const data = await this.postApi<{ i3?: string; error?: string }>({
					method: 'showpage',
					gid,
					page,
					imgkey,
					showkey
				});
				if (!data?.i3 || data.error) {
					console.warn(`[ehentai] showpage p=${page}`, data?.error);
					return;
				}
				const m =
					data.i3.match(/id=["']img["'][^>]*src=["']([^"']+)["']/i) ||
					data.i3.match(/src=["']([^"']+)["'][^>]*id=["']img["']/i);
				const src = (m?.[1] || '').replace(/&amp;/g, '&');
				if (src) images[idx] = src;
			} catch (e) {
				console.warn(`[ehentai] showpage p=${page} fail`, e);
			}
		};

		for (let i = 0; i < entries.length; i += CONCURRENCY) {
			const chunk = entries.slice(i, i + CONCURRENCY);
			await Promise.all(
				chunk.map(([page, key], j) => resolve(page, key, i + j))
			);
		}

		const result = images.filter(Boolean);
		console.log(`[ehentai] getChapterPages → ${result.length}/${entries.length}`);
		return result;
	}
}