import { createHmac, randomBytes } from 'crypto';
import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';

/**
 * MangaCopy / 拷贝漫画 (mangacopy.com)
 */
export class MangaCopySource extends BaseSource {
	id = 'mangacopy';
	name = 'MangaCopy';
	baseUrl = 'https://www.mangacopy.com';

	private readonly API_HOSTS = [
		'https://api.copy2000.online',
		'https://api.mangacopy.com',
		'https://api.copy-manga.com'
	];

	private readonly PER_PAGE = 24;
	private activeApi = this.API_HOSTS[0];
	private readonly AUTH_SECRET = Buffer.from(
		'M2FmMDg1OTAzMTEwMzJlZmUwNjYwNTUwYTA1NjNhNTM=',
		'base64'
	);

	private readonly deviceinfo: string;
	private readonly device: string;
	private readonly pseudoid: string;

	constructor() {
		super();
		this.deviceinfo = `${this.randInt(1000000, 9999999)}V-${this.randInt(1000, 9999)}`;
		this.device = this.genDevice();
		this.pseudoid = this.genPseudoid();
	}

	private randInt(min: number, max: number): number {
		return Math.floor(Math.random() * (max - min + 1)) + min;
	}

	private genDevice(): string {
		const A = () => String.fromCharCode(65 + this.randInt(0, 25));
		const D = () => String.fromCharCode(48 + this.randInt(0, 9));
		return `${A()}${A()}${D()}${A()}.${D()}${D()}${D()}${D()}${D()}${D()}.${D()}${D()}${D()}`;
	}

	private genPseudoid(): string {
		const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
		let s = '';
		for (let i = 0; i < 16; i++) s += chars[this.randInt(0, chars.length - 1)];
		return s;
	}

	// ── API helpers ──────────────────────────────────────────────────────────

	private apiHeaders(): Record<string, string> {
		const ts = Math.floor(Date.now() / 1000).toString();
		const sig = createHmac('sha256', this.AUTH_SECRET).update(ts).digest('hex');
		const now = new Date();
		const dt = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(
			now.getDate()
		).padStart(2, '0')}`;

		return {
			'User-Agent': 'COPY/3.0.6',
			source: 'copyApp',
			platform: '3',
			version: '3.0.6',
			referer: 'com.copymanga.app-3.0.6',
			Accept: 'application/json',
			region: '0',
			dt,
			deviceinfo: this.deviceinfo,
			device: this.device,
			pseudoid: this.pseudoid,
			authorization: 'Token',
			umstring: 'b4c89ca4104ea9a97750314d791520ac',
			'x-auth-timestamp': ts,
			'x-auth-signature': sig
		};
	}

	private async apiGet(path: string): Promise<any> {
		const hosts = [this.activeApi, ...this.API_HOSTS.filter((h) => h !== this.activeApi)];
		let lastErr: unknown;

		for (const host of hosts) {
			const url = path.startsWith('http')
				? path
				: `${host}${path.startsWith('/') ? '' : '/'}${path}`;
			try {
				const res = await fetch(url, {
					headers: this.apiHeaders(),
					redirect: 'follow'
				});
				if (!res.ok) {
					lastErr = new Error(`HTTP ${res.status} ${url}`);
					continue;
				}
				const json: any = await res.json();

				if (json?.code === 210) {
					const msg =
						json.message ||
						'MangaCopy memblokir request (code 210). Tunggu ~1 jam / ganti jaringan / restart server.';
					console.error('[mangacopy] kena ban code 210:', msg);
					throw new Error(msg);
				}

				if (json?.code != null && json.code !== 200 && json.code !== '200') {
					lastErr = new Error(`API code ${json.code}: ${json.message || ''}`);
					continue;
				}
				this.activeApi = host;
				return json;
			} catch (e) {
				lastErr = e;
				if (e instanceof Error && /code 210|memblokir|限制/i.test(e.message)) {
					throw e;
				}
			}
		}
		throw lastErr || new Error('MangaCopy API failed');
	}

	private parseComicItem(raw: any): Manga | null {
	const comic = raw?.comic ?? raw;
	if (!comic) return null;
	const pathWord = comic.path_word || comic.pathWord;
	if (!pathWord) return null;

	const title = comic.name || comic.title || pathWord;
	const cover = comic.cover || comic.img || '';

	// update/newest: raw.name = nama chapter, comic.last_chapter_name juga ada
	// /comics: field chapter biasanya kosong
	let latestRaw: unknown =
		comic.last_chapter_name ??
		raw?.name ?? // chapter name di root (endpoint update/newest)
		comic.last_chapter?.name ??
		comic.last_chapter?.display ??
		raw?.last_chapter_name ??
		undefined;

	let latestChapter: string | number | undefined;
	if (typeof latestRaw === 'number' && !Number.isNaN(latestRaw)) {
		latestChapter = latestRaw;
	} else if (typeof latestRaw === 'string' && latestRaw.trim()) {
		const n = latestRaw.match(/(\d+(?:\.\d+)?)/);
		latestChapter = n ? parseFloat(n[1]) : latestRaw.trim();
	}

	const themeText = Array.isArray(comic.theme)
		? comic.theme.map((t: any) => t?.name || '').join(' ')
		: '';
	const region = (comic.region?.display || comic.region || '').toString().toLowerCase();
	let type: 'manga' | 'manhwa' | 'manhua' = 'manga';
	if (/korea|韩|韓|韩漫/.test(region + themeText)) type = 'manhwa';
	else if (/china|中|国|國|大陆/.test(region + themeText)) type = 'manhua';

	return {
		id: `/comic/${pathWord}`,
		sourceId: this.id,
		title,
		cover,
		type,
		lang: 'zh',
		latestChapter,
		status: comic.status?.display || comic.status || undefined
	};
}

	private pathWordFromId(mangaId: string): string {
		const id = (mangaId || '').replace(/^\/+/, '').replace(/\/+$/, '');
		const m = id.match(/^(?:comic\/)?([^/]+)/i);
		return m?.[1] || id;
	}

	// ── Latest ───────────────────────────────────────────────────────────────

	async getLatestManga(
	page: number,
	_opts?: { lang?: string; type?: string }
): Promise<Manga[]> {
	const p = Math.max(1, Number(page) || 1);
	const offset = (p - 1) * this.PER_PAGE;

	const paths = [
		`/api/v3/update/newest?limit=${this.PER_PAGE}&offset=${offset}&platform=3`,
		`/api/v3/comics?free_type=1&limit=${this.PER_PAGE}&offset=${offset}&ordering=-datetime_updated&_update=true&platform=3`
	];

	for (const path of paths) {
		try {
			const json = await this.apiGet(path);
			const list = json?.results?.list || json?.results || [];
			const arr = Array.isArray(list) ? list : [];
			const mangas = arr
				.map((item: any) => this.parseComicItem(item))
				.filter(Boolean) as Manga[];

			console.log(
				`[mangacopy] ${path} → ${mangas.length}`,
				mangas.slice(0, 3).map((m) => `${m.title} ch=${m.latestChapter}`)
			);
			if (mangas.length > 0) return mangas.slice(0, this.PER_PAGE);
		} catch (e) {
			console.warn('[mangacopy] latest path fail', path, e);
		}
	}
	return [];
}

	async searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page || 1);
		if (!q) return this.getLatestManga(page, opts);

		const offset = (page - 1) * this.PER_PAGE;
		try {
			const json = await this.apiGet(
				`/api/v3/search/comic?limit=${this.PER_PAGE}&offset=${offset}&q=${encodeURIComponent(q)}&q_type=&platform=3`
			);
			const list = json?.results?.list || [];
			return (list as any[])
				.map((item) => this.parseComicItem(item))
				.filter(Boolean)
				.slice(0, this.PER_PAGE) as Manga[];
		} catch (e) {
			console.error('[mangacopy] search', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const pathWord = this.pathWordFromId(mangaId);

		const json = await this.apiGet(
			`/api/v3/comic2/${encodeURIComponent(pathWord)}?platform=3`
		);
		const results = json?.results;
		if (!results?.comic) {
			console.error(
				'[mangacopy] empty comic2 for',
				pathWord,
				JSON.stringify(json)?.slice(0, 300)
			);
			throw new Error(`MangaCopy: detail kosong untuk ${pathWord}`);
		}

		const comic = results.comic;
		const groups = results.groups || {};

		const title = comic.name || pathWord;
		const cover = comic.cover || '';
		const brief = comic.brief || comic.desc || '';
		const authors: string[] = Array.isArray(comic.author)
			? comic.author.map((a: any) => a?.name).filter(Boolean)
			: [];
		const genres: string[] = Array.isArray(comic.theme)
			? comic.theme.map((t: any) => t?.name).filter(Boolean)
			: [];

		let status = 'Ongoing';
		const st = (comic.status?.display || '').toString();
		if (/完結|完结|已完結|已完结|結束/.test(st)) status = 'Completed';
		else if (/連載|连载/.test(st)) status = 'Ongoing';

		const typeText = genres.join(' ') + (comic.region?.display || '');
		let type: 'manga' | 'manhwa' | 'manhua' = 'manga';
		if (/韩|韓|korea/i.test(typeText)) type = 'manhwa';
		else if (/中|国|國|china/i.test(typeText)) type = 'manhua';

		const chapters: Chapter[] = [];
		const groupEntries = Object.entries(groups) as [string, any][];

		for (const [, g] of groupEntries) {
			const gPath = g?.path_word || g?.pathWord || 'default';
			let offset = 0;
			const limit = 100;
			let total = Infinity;

			while (offset < total) {
				try {
					const chJson = await this.apiGet(
						`/api/v3/comic/${encodeURIComponent(pathWord)}/group/${encodeURIComponent(
							gPath
						)}/chapters?limit=${limit}&offset=${offset}&platform=3`
					);
					const list = chJson?.results?.list || [];
					total = chJson?.results?.total ?? list.length;

					for (const ch of list) {
						const uuid = ch.uuid || ch.id;
						if (!uuid) continue;
						const name = ch.name || ch.title || '';
						const numMatch = String(name).match(/(\d+(?:\.\d+)?)/);
						chapters.push({
							id: `/comic/${pathWord}/chapter/${uuid}`,
							title: name || `Chapter ${chapters.length + 1}`,
							number: numMatch ? parseFloat(numMatch[1]) : chapters.length + 1,
							date: ch.datetime_created || ch.create_at || ''
						});
					}
					offset += limit;
					if (!list.length) break;
				} catch (e) {
					console.warn(
						`[mangacopy] gagal ambil chapter group ${gPath} offset ${offset}`,
						e
					);
					break;
				}
			}
		}

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const alt = comic.alias ? `Alternative: ${comic.alias}` : '';
		const description = [alt, brief].filter(Boolean).join('\n\n');

		console.log(`[mangacopy] details ${pathWord} chapters=${chapters.length}`);

		return {
			id: `/comic/${pathWord}`,
			sourceId: this.id,
			title,
			cover,
			type,
			status,
			description,
			authors,
			genres,
			chapters,
			latestChapter: chapters[0]?.number ?? comic.last_chapter?.name
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const cleaned = chapterId.replace(/^\/+/, '');
		const m =
			cleaned.match(/^comic\/([^/]+)\/chapter\/([^/]+)/i) ||
			cleaned.match(/^([^/]+)\/([^/]+)$/);
		if (!m) {
			console.error('[mangacopy] bad chapter id', chapterId);
			return [];
		}
		const pathWord = m[1];
		const uuid = m[2];

		try {
			const json = await this.apiGet(
				`/api/v3/comic/${encodeURIComponent(pathWord)}/chapter2/${encodeURIComponent(
					uuid
				)}?platform=3`
			);
			const chapter = json?.results?.chapter || json?.results || {};
			const contents: { url?: string }[] = chapter.contents || [];
			const words: number[] = chapter.words || [];

			const urls = contents.map((c) => c.url || '').filter(Boolean);
			const ordered = new Array(urls.length).fill('');
			for (let i = 0; i < urls.length; i++) {
				const idx = typeof words[i] === 'number' ? words[i] : i;
				ordered[idx] = urls[i];
			}

			const pages = ordered
				.filter(Boolean)
				.map((u: string) => u.replace(/([./])c\d+x\.[a-zA-Z]+$/i, '$1c1500x.webp'));

			console.log(`[mangacopy] pages ${pathWord}/${uuid} → ${pages.length}`);
			return pages;
		} catch (e) {
			console.error('[mangacopy] getChapterPages', e);
			return [];
		}
	}
}