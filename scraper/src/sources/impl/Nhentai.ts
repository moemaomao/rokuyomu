/**
 * nhentai.net adapter (API v2)
 *
 * List / Search : /api/v2/galleries  +  /api/v2/search
 * Detail        : /api/v2/galleries/{id}
 * Config        : /api/v2/config  (image / thumb servers)
 *
 * ID format: "/{numericId}"
 */

import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails } from '../types';

export class NhentaiSource extends BaseSource {
	id = 'nhentai';
	name = 'nhentai.net';
	baseUrl = 'https://nhentai.net';

	private readonly api = 'https://nhentai.net/api/v2';
	private readonly LANG_TAG_ID_MAP: Record<number, string> = {
		12227: 'en',
		6346: 'ja',
		29963: 'zh',
		17249: 'zh', 
		35236: 'ko',
		35237: 'es',
		35238: 'fr',
		35239: 'ru',
		35240: 'id',
		35241: 'pt',
		35242: 'th',
		35243: 'vi'
	};

	private readonly CATEGORY_TAG_ID_MAP: Record<number, string> = {
		33172: 'doujinshi',
		33173: 'manga',
		33170: 'artistcg',
		33171: 'gamecg',
		34168: 'imageset',
		33174: 'cosplay',
		33175: 'western',
		33176: 'non-h'
	};

	private imgServers = [
		'https://i1.nhentai.net',
		'https://i2.nhentai.net',
		'https://i3.nhentai.net',
		'https://i4.nhentai.net'
	];
	private thumbServers = [
		'https://t1.nhentai.net',
		'https://t2.nhentai.net',
		'https://t3.nhentai.net',
		'https://t4.nhentai.net'
	];

	private configLoaded = false;

	// ── HTTP ─────────────────────────────────────────────────────────────────

	private h(): Record<string, string> {
		return {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
			Accept: 'application/json, text/plain, */*',
			'Accept-Language': 'en-US,en;q=0.9',
			Referer: 'https://nhentai.net/',
			Origin: 'https://nhentai.net'
		};
	}

	private async getJson<T = any>(url: string): Promise<T> {
		const res = await fetch(url, { headers: this.h() });
		if (!res.ok) {
			throw new Error(`HTTP ${res.status} → ${url}`);
		}
		return res.json() as Promise<T>;
	}

	private async ensureConfig() {
		if (this.configLoaded) return;
		try {
			const cfg = await this.getJson<{
				image_servers?: string[];
				thumb_servers?: string[];
			}>(`${this.api}/config`);

			if (cfg.image_servers?.length) this.imgServers = cfg.image_servers;
			if (cfg.thumb_servers?.length) this.thumbServers = cfg.thumb_servers;
		} catch (e) {
			console.warn('[nhentai] failed to load config, using fallback servers', e);
		}
		this.configLoaded = true;
	}

	private pickImgServer(mediaId: string | number): string {
		const n = Number(String(mediaId).replace(/\D/g, '')) || 0;
		return this.imgServers[n % this.imgServers.length];
	}

	private pickThumbServer(mediaId: string | number): string {
		const n = Number(String(mediaId).replace(/\D/g, '')) || 0;
		return this.thumbServers[n % this.thumbServers.length];
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private toId(id: number | string): string {
		return `/${String(id).replace(/\D/g, '')}`;
	}

	private extractId(mangaId: string): string {
		return String(mangaId).replace(/\D/g, '');
	}

	private fullUrl(path: string, mediaId: string | number, isThumb = false): string {
		if (!path) return '';

		let clean = path.trim();
		clean = clean.replace(/(\.(?:jpg|jpeg|png|gif|webp))\.\w+$/i, '$1');

		const base = isThumb
			? this.pickThumbServer(mediaId)
			: this.pickImgServer(mediaId);

		return `${base}/${clean}`;
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
			en: 'en',
			'en-us': 'en',
			ko: 'ko',
			zh: 'zh',
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
			japan: 'japanese',
			chinese: 'chinese',
			zh: 'chinese',
			'zh-cn': 'chinese',
			'zh-hk': 'chinese',
			korean: 'korean',
			ko: 'korean',
			korea: 'korean',
			indonesian: 'indonesian',
			indonesia: 'indonesian',
			bahasa: 'indonesian',
			id: 'indonesian',
			spanish: 'spanish',
			es: 'spanish',
			'es-la': 'spanish',
			french: 'french',
			fr: 'french',
			russian: 'russian',
			ru: 'russian',
			portuguese: 'portuguese',
			pt: 'portuguese',
			'pt-br': 'portuguese',
			thai: 'thai',
			th: 'thai',
			vietnamese: 'vietnamese',
			vi: 'vietnamese',
			german: 'german',
			de: 'german',
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

	private langFromTagIds(tagIds: unknown): string | undefined {
		if (!Array.isArray(tagIds)) return undefined;

		const priority = ['en', 'zh', 'ja', 'ko', 'es', 'fr', 'ru', 'id', 'pt', 'th', 'vi'];
		const found = new Set<string>();

		for (const raw of tagIds) {
			const id = Number(raw);
			const code = this.LANG_TAG_ID_MAP[id];
			if (code) found.add(code);
		}

		for (const p of priority) {
			if (found.has(p)) return p;
		}
		return found.size ? [...found][0] : undefined;
	}

	private langFromTitle(...titles: (string | undefined | null)[]): string | undefined {
		const text = titles.filter(Boolean).join(' ').toLowerCase();
		if (!text) return undefined;

		if (
			/\[english\]|\beng\b|\[eng\]/.test(text) ||
			text.includes('[english]')
		) {
			return 'en';
		}
		if (
			/\[chinese\]|中国翻訳|中國翻譯|汉化|漢化|\[cn\]/.test(text)
		) {
			return 'zh';
		}
		if (/\[korean\]|한국어|\[kr\]/.test(text)) return 'ko';
		if (/\[spanish\]|\[es\]/.test(text)) return 'es';
		if (/\[french\]|\[fr\]/.test(text)) return 'fr';
		if (/\[russian\]|\[ru\]/.test(text)) return 'ru';
		if (/\[indonesian\]|bahasa|\[id\]/.test(text)) return 'id';
		if (/\[portuguese\]|\[pt\]|\[pt-br\]/.test(text)) return 'pt';
		if (/\[thai\]|\[th\]/.test(text)) return 'th';
		if (/\[vietnamese\]|\[vi\]/.test(text)) return 'vi';
		if (/\[japanese\]|日本語|\[jp\]|\[ja\]/.test(text)) return 'ja';

		return undefined;
	}

	private categoryFromTagIds(tagIds: unknown): string {
		if (!Array.isArray(tagIds)) return 'doujinshi';
		for (const raw of tagIds) {
			const id = Number(raw);
			const cat = this.CATEGORY_TAG_ID_MAP[id];
			if (cat) return cat;
		}
		return 'doujinshi';
	}

	private mapTags(tags: any[] = []): string[] {
		const out: string[] = [];
		for (const t of tags) {
			const name = String(t?.name || '').trim();
			if (!name) continue;

			const type = String(t?.type || '').toLowerCase();
			if (
				type === 'artist' ||
				type === 'group' ||
				type === 'parody' ||
				type === 'character' ||
				type === 'category' ||
				type === 'language'
			) {
				continue;
			}
			out.push(name);
		}
		return out;
	}

	private pickLanguage(tags: any[] = []): string {
		const lang = tags.find(
			(t) =>
				t?.type === 'language' &&
				String(t.name || '').toLowerCase() !== 'translated'
		);
		return lang?.name || '';
	}

	private pickCategory(tags: any[] = []): string {
		const cat = tags.find((t) => t?.type === 'category');
		return cat?.name || 'doujinshi';
	}

	private pickArtists(tags: any[] = []): string[] {
		return tags
			.filter((t) => t?.type === 'artist')
			.map((t) => t.name)
			.filter(Boolean);
	}

	private pickGroups(tags: any[] = []): string[] {
		return tags
			.filter((t) => t?.type === 'group')
			.map((t) => t.name)
			.filter(Boolean);
	}

	private toMangaFromList(g: any): Manga | null {
		if (!g?.id) return null;

		const mediaId = g.media_id;
		const title =
			g.english_title ||
			g.japanese_title ||
			g.title?.pretty ||
			g.title?.english ||
			g.title?.japanese ||
			`Gallery ${g.id}`;

		const thumbPath =
			typeof g.thumbnail === 'string' ? g.thumbnail : g.thumbnail?.path;

		const cover =
			mediaId && thumbPath ? this.fullUrl(thumbPath, mediaId, true) : '';

		const pageCount =
			Number(g.num_pages) ||
			(Array.isArray(g.pages) ? g.pages.length : 0) ||
			(Array.isArray(g.images?.pages) ? g.images.pages.length : 0) ||
			0;

		let lang: string | undefined;
		if (Array.isArray(g.tags) && g.tags.length) {
			lang = this.normalizeLangCode(this.pickLanguage(g.tags));
		}
		if (!lang) {
			lang = this.langFromTagIds(g.tag_ids);
		}
		if (!lang) {
			lang = this.langFromTitle(
				g.english_title,
				g.japanese_title,
				g.title?.english,
				g.title?.japanese,
				g.title?.pretty,
				title
			);
		}

		let type = 'doujinshi';
		if (Array.isArray(g.tags) && g.tags.length) {
			type = this.pickCategory(g.tags) || type;
		} else {
			type = this.categoryFromTagIds(g.tag_ids);
		}

		return {
			id: this.toId(g.id),
			sourceId: this.id,
			title,
			cover,
			type,
			status: 'Completed',
			lang,
			latestChapter: 1
		};
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			await this.ensureConfig();

			const p = Math.max(1, Number(page) || 1);
			const langTag = this.normalizeLangForSearch(opts?.lang);
			const type = (opts?.type || 'all').toLowerCase();

			const parts: string[] = [];
			if (langTag) parts.push(`language:${langTag}`);
			if (type && type !== 'all') parts.push(`category:${type}`);

			let data: any;
			if (parts.length) {
				const q = encodeURIComponent(parts.join(' '));
				data = await this.getJson(`${this.api}/search?query=${q}&page=${p}`);
			} else {
				data = await this.getJson(`${this.api}/galleries?page=${p}`);
			}

			const list = data?.result || data?.galleries || [];
			return list
				.map((g: any) => this.toMangaFromList(g))
				.filter(Boolean)
				.slice(0, 24) as Manga[];
		} catch (e) {
			console.error('[nhentai] getLatestManga', e);
			return [];
		}
	}

	async searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page || 1);
		const langTag = this.normalizeLangForSearch(opts?.lang);
		const type = (opts?.type || 'all').toLowerCase();

		if (!q) return this.getLatestManga(page, { lang: opts?.lang, type });

		try {
			await this.ensureConfig();

			const parts = [q];
			if (langTag) parts.push(`language:${langTag}`);
			if (type && type !== 'all') parts.push(`category:${type}`);

			const searchQ = encodeURIComponent(parts.join(' '));
			const data = await this.getJson(
				`${this.api}/search?query=${searchQ}&page=${page}`
			);
			const list = data?.result || data?.galleries || [];
			return list
				.map((g: any) => this.toMangaFromList(g))
				.filter(Boolean)
				.slice(0, 24) as Manga[];
		} catch (e) {
			console.error('[nhentai] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const id = this.extractId(mangaId);
		if (!id) throw new Error(`Invalid nhentai id: ${mangaId}`);

		await this.ensureConfig();

		const g = await this.getJson(`${this.api}/galleries/${id}`);

		const mediaId = g.media_id;
		const coverPath = g.cover?.path || g.thumbnail?.path;
		const cover =
			mediaId && coverPath ? this.fullUrl(coverPath, mediaId, true) : '';

		const artists = this.pickArtists(g.tags);
		const groups = this.pickGroups(g.tags);
		const languageRaw = this.pickLanguage(g.tags);
		const language =
			this.normalizeLangCode(languageRaw) ||
			this.langFromTitle(
				g.title?.english,
				g.title?.japanese,
				g.title?.pretty
			);
		const category = this.pickCategory(g.tags);
		const tags = this.mapTags(g.tags);
		const pageCount = g.num_pages || g.pages?.length || 0;

		const title =
			g.title?.pretty ||
			g.title?.english ||
			g.title?.japanese ||
			`Gallery ${id}`;

		const uploadDate = g.upload_date
			? new Date(g.upload_date * 1000).toISOString().slice(0, 10)
			: '';

		return {
			id: this.toId(id),
			sourceId: this.id,
			title,
			cover,
			type: category,
			status: 'Completed',
			lang: language,
			latestChapter: 1,
			description: [
				g.title?.english &&
					g.title.english !== title &&
					`AltTitle: ${g.title.english}`,
				g.title?.japanese && `AltTitle: ${g.title.japanese}`,
				category && `Type: ${category}`,
				languageRaw && `Language: ${languageRaw}`,
				artists.length && `Artists: ${artists.join(', ')}`,
				groups.length && `Groups: ${groups.join(', ')}`,
				pageCount && `Pages: ${pageCount}`
			]
				.filter(Boolean)
				.join('\n'),
			authors: artists.length ? artists : groups,
			genres: tags,
			chapters:
				pageCount > 0
					? [
							{
								id: this.toId(id),
								title: 'Read',
								number: 1,
								date: uploadDate,
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
			console.error('[nhentai] getChapterPages → empty id from:', chapterId);
			return [];
		}

		try {
			await this.ensureConfig();

			const g = await this.getJson(`${this.api}/galleries/${id}`);

			if (!g?.media_id) {
				console.error('[nhentai] getChapterPages → no media_id for', id);
				return [];
			}

			const pages = g.pages || g.images?.pages || [];
			if (!pages.length) {
				console.error('[nhentai] getChapterPages → 0 pages for', id);
				return [];
			}

			const urls = pages.map((p: any) => {
				if (p.path) {
					return this.fullUrl(p.path, g.media_id, false);
				}

				const t = p.t || 'j';
				const ext =
					t === 'p' ? 'png' : t === 'g' ? 'gif' : t === 'w' ? 'webp' : 'jpg';
				const base = this.pickImgServer(g.media_id);
				return `${base}/galleries/${g.media_id}/${p.number || 1}.${ext}`;
			});

			console.log(`[nhentai] loaded ${urls.length} pages for gallery ${id}`);
			return urls;
		} catch (e) {
			console.error('[nhentai] getChapterPages failed for', id, e);
			return [];
		}
	}
}
