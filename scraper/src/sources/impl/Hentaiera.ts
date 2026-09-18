import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails } from '../types';

/**
 * HentaiEra adapter
 *
 * List   : /  |  /?page={n}
 * Lang   : /language/{name}/  |  /language/{name}/?page={n}
 * Type   : /category/{name}/  |  /category/{name}/?page={n}
 * Search : /search/?key=...&page=
 * Detail : /gallery/{id}/
 * Pages  : m{server}.hentaiera.com/{dir}/{id}/{n}.{ext}
 */
export class HentaieraSource extends BaseSource {
	id = 'hentaiera';
	name = 'HentaiEra';
	baseUrl = 'https://hentaiera.com';

	private readonly pageSize = 24;
	private readonly FLAG_TO_ISO: Record<string, string> = {
		us: 'en',
		gb: 'en',
		en: 'en',
		jp: 'ja',
		ja: 'ja',
		cn: 'zh',
		zh: 'zh',
		hk: 'zh-hk',
		kr: 'ko',
		ko: 'ko',
		es: 'es',
		mx: 'es-la',
		fr: 'fr',
		de: 'de',
		ru: 'ru',
		id: 'id',
		br: 'pt-br',
		pt: 'pt',
		th: 'th',
		vn: 'vi',
		vi: 'vi',
		it: 'it',
		pl: 'pl',
		nl: 'nl',
		ar: 'ar',
		tr: 'tr'
	};

	// ── HTTP ─────────────────────────────────────────────────────────────────

	private h(extra?: Record<string, string>): Record<string, string> {
		return {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
			Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			'Accept-Language': 'en-US,en;q=0.9',
			Referer: `${this.baseUrl}/`,
			Origin: this.baseUrl,
			...extra
		};
	}

	private async getHtml(url: string): Promise<string> {
		const res = await fetch(url, {
			headers: this.h(),
			redirect: 'follow'
		});
		if (!res.ok) throw new Error(`HTTP ${res.status} → ${url}`);
		return res.text();
	}

	private async fetchCoverDate(coverUrl: string): Promise<string> {
		if (!coverUrl) return '';
		try {
			const res = await fetch(coverUrl, {
				method: 'HEAD',
				headers: this.h({ Accept: 'image/*,*/*' })
			});
			const lm = res.headers.get('last-modified');
			if (!lm) return '';
			const d = new Date(lm);
			if (Number.isNaN(d.getTime())) return '';
			return d.toISOString().slice(0, 10);
		} catch {
			return '';
		}
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private decodeHtml(s: string): string {
		return s
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#039;/g, "'")
			.replace(/&#x27;/g, "'")
			.replace(/&nbsp;/g, ' ')
			.trim();
	}

	private toId(id: string | number): string {
		return `/${String(id).replace(/\D/g, '')}`;
	}

	private extractId(mangaId: string): string {
		return String(mangaId).replace(/\D/g, '');
	}

	private inputValue(html: string, id: string): string {
		return (
			html.match(new RegExp(`id="${id}"[^>]*value="([^"]*)"`, 'i'))?.[1] ||
			html.match(new RegExp(`value="([^"]*)"[^>]*id="${id}"`, 'i'))?.[1] ||
			''
		);
	}

	private extFromGth(val: string): string {
		switch ((val || 'j')[0]) {
			case 'p':
				return 'png';
			case 'g':
				return 'gif';
			case 'w':
				return 'webp';
			case 'a':
				return 'avif';
			default:
				return 'jpg';
		}
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
			us: 'en',
			gb: 'en',
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
			vn: 'vi',
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
			us: 'english',
			gb: 'english',
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
			vn: 'vietnamese',
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
			mg: 'manga',
			artistcg: 'artistcg',
			'artist cg': 'artistcg',
			acg: 'artistcg',
			gamecg: 'gamecg',
			'game cg': 'gamecg',
			gcg: 'gamecg',
			imageset: 'imageset',
			'image set': 'imageset',
			is: 'imageset',
			western: 'western',
			ws: 'western',
			cosplay: 'cosplay',
			'non-h': 'non-h',
			nonh: 'non-h',
			misc: 'misc'
		};

		return map[raw] || raw.replace(/\s+/g, '-');
	}

	private isoFromFlagClass(flagClass?: string): string | undefined {
		if (!flagClass) return undefined;
		const key = String(flagClass)
			.replace(/^flag-/i, '')
			.trim()
			.toLowerCase();
		return this.FLAG_TO_ISO[key] || this.normalizeLangCode(key);
	}

	private pickInfoTags(html: string, label: string): string[] {
		const sec =
			html.match(
				new RegExp(
					`tags_text'>\\s*${label}\\s*</span>\\s*<div class='info_tags'>([\\s\\S]*?)</div>`,
					'i'
				)
			)?.[1] || '';

		const names: string[] = [];
		const hrefRe =
			/href='\/(?:tag|artist|group|parody|character|language|category)\/([^/]+)\//gi;
		let m: RegExpExecArray | null;
		while ((m = hrefRe.exec(sec)) !== null) {
			const n = this.decodeHtml(m[1].replace(/-/g, ' '));
			if (n) names.push(n);
		}
		if (names.length) return names;

		const textRe = /item_name'>(?:<div[^>]*>[\s\S]*?<\/div>\s*)?([^<]+)/gi;
		while ((m = textRe.exec(sec)) !== null) {
			const n = this.decodeHtml(m[1]);
			if (n) names.push(n);
		}
		return names;
	}

	// ── List ─────────────────────────────────────────────────────────────────

	private parseList(html: string, limit?: number): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		const thumbRe =
			/<div class="thumb"[^>]*>([\s\S]*?)<div class="clear"><\/div>\s*<\/div>\s*<\/div>/gi;

		let block: RegExpExecArray | null;
		const blocks: string[] = [];
		while ((block = thumbRe.exec(html)) !== null) {
			blocks.push(block[0]);
		}

		if (!blocks.length) {
			const loose =
				/<div class="inner_thumb">[\s\S]*?<a href="\/gallery\/(\d+)\/">[\s\S]*?(?:data-src|src)="([^"]+)"[^>]*(?:alt="([^"]*)")?[\s\S]*?<h2 class="gallery_title"><a[^>]*>([^<]*)<\/a>[\s\S]*?(?:lang_pages|g_pages)[\s\S]{0,800}/gi;
			let m: RegExpExecArray | null;
			while ((m = loose.exec(html)) !== null) {
				const id = m[1];
				if (!id || seen.has(id)) continue;
				seen.add(id);

				const chunk = m[0];
				const cover = (m[2] || '').trim();
				const title = this.decodeHtml(m[4] || m[3] || `Gallery ${id}`);

				const flagM = chunk.match(/g_flag\s+flag-([a-z]+)/i);
				const lang = this.isoFromFlagClass(flagM?.[1]);

				const pagesM = chunk.match(/inside_p">\s*(\d+)/i);
				const pages = pagesM ? parseInt(pagesM[1], 10) : 0;

				const catM = chunk.match(/gallery_cat[^>]*>([^<]+)</i);
				const type = catM
					? this.decodeHtml(catM[1]).toLowerCase()
					: 'doujinshi';

				out.push({
					id: this.toId(id),
					sourceId: this.id,
					title,
					cover,
					type,
					status: 'Completed',
					lang,
					latestChapter: pages > 0 ? pages : 1
				});

				if (limit && out.length >= limit) break;
			}
			return out;
		}

		for (const chunk of blocks) {
			const idM = chunk.match(/href="\/gallery\/(\d+)\/"/i);
			const id = idM?.[1];
			if (!id || seen.has(id)) continue;
			seen.add(id);

			const coverM =
				chunk.match(/data-src="([^"]+)"/i) ||
				chunk.match(/<img[^>]+src="(https?:\/\/[^"]+)"/i);
			const cover = (coverM?.[1] || '').trim();

			const titleM =
				chunk.match(
					/<h2 class="gallery_title"><a[^>]*>([^<]*)<\/a>/i
				) || chunk.match(/alt="([^"]*)"/i);
			const title = this.decodeHtml(titleM?.[1] || `Gallery ${id}`);

			const catM = chunk.match(/gallery_cat[^>]*>([^<]+)</i);
			const type = catM
				? this.decodeHtml(catM[1]).toLowerCase()
				: 'doujinshi';

			const flagM =
				chunk.match(/g_flag\s+flag-([a-z]+)/i) ||
				chunk.match(/flag-([a-z]+)/i);
			const lang = this.isoFromFlagClass(flagM?.[1]);

			const pagesM = chunk.match(/inside_p">\s*(\d+)/i);
			const pages = pagesM ? parseInt(pagesM[1], 10) : 0;

			out.push({
				id: this.toId(id),
				sourceId: this.id,
				title,
				cover,
				type,
				status: 'Completed',
				lang,
				latestChapter: pages > 0 ? pages : 1
			});

			if (limit && out.length >= limit) break;
		}

		return out;
	}

	private buildListUrl(
		page: number,
		opts?: { lang?: string; type?: string }
	): string {
		const p = Math.max(1, Number(page) || 1);
		const langSlug = this.normalizeLangForSearch(opts?.lang);
		const typeSlug = this.normalizeTypeForPath(opts?.type);

		if (langSlug) {
			const base = `${this.baseUrl}/language/${langSlug}/`;
			return p <= 1 ? base : `${base}?page=${p}`;
		}
		if (typeSlug) {
			const base = `${this.baseUrl}/category/${typeSlug}/`;
			return p <= 1 ? base : `${base}?page=${p}`;
		}
		return p <= 1 ? `${this.baseUrl}/` : `${this.baseUrl}/?page=${p}`;
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const url = this.buildListUrl(p, opts);
			const html = await this.getHtml(url);
			const list = this.parseList(html, this.pageSize);
			console.log(
				`[hentaiera] latest page=${p} lang=${opts?.lang || 'all'} → ${list.length} items`
			);
			return list;
		} catch (e) {
			console.error('[hentaiera] getLatestManga', e);
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
			
			const langSlug = this.normalizeLangForSearch(opts?.lang);
			let url: string;
			if (langSlug) {
	
				url = `${this.baseUrl}/search/?key=${encodeURIComponent(q)}&page=${page}`;
			} else {
				url = `${this.baseUrl}/search/?key=${encodeURIComponent(q)}&page=${page}`;
			}

			const html = await this.getHtml(url);
			let list = this.parseList(html, this.pageSize);

			const want = this.normalizeLangCode(opts?.lang);
			if (want && list.length) {
				const filtered = list.filter((m) => m.lang === want);
				if (filtered.length) list = filtered;
			}

			console.log(`[hentaiera] search "${q}" → ${list.length} items`);
			return list;
		} catch (e) {
			console.error('[hentaiera] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const id = this.extractId(mangaId);
		if (!id) throw new Error(`Invalid hentaiera id: ${mangaId}`);

		const html = await this.getHtml(`${this.baseUrl}/gallery/${id}/`);

		const titleM = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
		const title = titleM ? this.decodeHtml(titleM[1]) : `Gallery ${id}`;

		const loadId = this.inputValue(html, 'load_id');
		const loadDir = this.inputValue(html, 'load_dir');
		const loadServer = this.inputValue(html, 'load_server') || '1';
		const loadPages = parseInt(this.inputValue(html, 'load_pages') || '0', 10);

		const cover = loadId
			? `https://m${loadServer}.hentaiera.com/${loadDir}/${loadId}/cover.jpg`
			: html.match(
					/data-src="(https?:\/\/m\d+\.hentaiera\.com\/[^"]+\/cover\.jpg)"/i
			  )?.[1] || '';

		const updated = await this.fetchCoverDate(cover);

		const artists = this.pickInfoTags(html, 'Artists');
		const groups = this.pickInfoTags(html, 'Groups');
		const languages = this.pickInfoTags(html, 'Languages');
		const categories = this.pickInfoTags(html, 'Category');
		const tags = this.pickInfoTags(html, 'Tags');
		const parodies = this.pickInfoTags(html, 'Parodies');
		const characters = this.pickInfoTags(html, 'Characters');

		const category = categories[0] || 'doujinshi';
		const languageRaw =
			languages.find((l) => l.toLowerCase() !== 'translated') ||
			languages[0] ||
			'';
		const language = this.normalizeLangCode(languageRaw);

		const genres = [
			...tags,
			...parodies.map((p) => `parody:${p}`),
			...characters.map((c) => `character:${c}`)
		];

		const pageCount =
			loadPages || parseInt(html.match(/(\d+)\s*Pages/i)?.[1] || '0', 10);

		return {
			id: this.toId(id),
			sourceId: this.id,
			title,
			cover,
			type: category,
			status: 'Completed',
			lang: language,
			latestChapter: pageCount > 0 ? pageCount : 1,
			description: [
				languageRaw && `Language: ${languageRaw}`,
				category && `Type: ${category}`,
				artists.length && `Artists: ${artists.join(', ')}`,
				groups.length && `Groups: ${groups.join(', ')}`,
				pageCount && `Pages: ${pageCount}`,
				updated && `Updated: ${updated}`
			]
				.filter(Boolean)
				.join('\n'),
			authors: artists.length ? artists : groups,
			genres,
			chapters:
				pageCount > 0
					? [
							{
								id: this.toId(id),
								title: 'Read',
								number: 1,
								date: updated,
								lang: language
							}
					  ]
					: []
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const id = this.extractId(chapterId);
		if (!id) {
			console.error('[hentaiera] getChapterPages → empty id:', chapterId);
			return [];
		}

		try {
			const html = await this.getHtml(`${this.baseUrl}/gallery/${id}/`);

			const loadId = this.inputValue(html, 'load_id');
			const loadDir = this.inputValue(html, 'load_dir');
			const loadServer = this.inputValue(html, 'load_server') || '1';
			const loadPages = parseInt(this.inputValue(html, 'load_pages') || '0', 10);

			if (!loadId) {
				console.error('[hentaiera] no load_id for', id);
				return [];
			}

			const gthM = html.match(/g_th\s*=\s*\$\.parseJSON\('(\{.*?\})'\)/);
			let gth: Record<string, string> = {};
			if (gthM) {
				try {
					gth = JSON.parse(gthM[1]);
				} catch {
					gth = {};
				}
			}

			const total = loadPages || Object.keys(gth).length || 0;
			if (!total) {
				console.error('[hentaiera] 0 pages for', id);
				return [];
			}

			const base = `https://m${loadServer}.hentaiera.com/${loadDir}/${loadId}`;
			const urls: string[] = [];
			for (let i = 1; i <= total; i++) {
				const ext = this.extFromGth(gth[String(i)] || 'j');
				urls.push(`${base}/${i}.${ext}`);
			}

			console.log(`[hentaiera] ${urls.length} pages → gallery ${id}`);
			return urls;
		} catch (e) {
			console.error('[hentaiera] getChapterPages failed', id, e);
			return [];
		}
	}
}
