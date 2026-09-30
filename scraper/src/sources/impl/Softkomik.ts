import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

interface SoftkomikSession {
	cookies: Map<string, string>;
	token: string;
	/** Full sign from /api/session — JANGAN potong "|oiq&..." */
	sign: string;
	expires: number;
	contentAccess?: { token?: string; sign?: string } | null;
}

interface SoftkomikPageData {
	slug: string;
	chapter: string;
	chapterDataId: string;
	storageInter2?: boolean;
	backBS3?: string;
}

export class SoftkomikSource extends BaseSource {
	id = 'softkomik';
	name = 'Softkomik';
	baseUrl = 'https://softkomik.co';

	private readonly coverBase = 'https://cover.softdevices.my.id/softkomik-cover/';
	private readonly imageApiBase = 'https://api.softkomik.org/komik';
	/** Primary CDN when storageInter2 === true (browser JS). */
	private readonly defaultCdn = 'https://image.komik.im/softkomik';
	private readonly alternateCdn = 'https://psy1.komik.im';
	private readonly bunnyCdn = 'https://softkomik-img.b-cdn.net/softkomik';

	private readonly PER_PAGE = 24;
	private readonly USER_AGENT =
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
	private readonly SESSION_TTL = 5 * 60 * 1000;

	private readonly sessionCache = new Map<string, SoftkomikSession>();
	private readonly sessionInflight = new Map<string, Promise<SoftkomikSession | null>>();

	// -------------------------------------------------------------------------
	// Generic helpers
	// -------------------------------------------------------------------------

	private absUrl(url: string): string {
		if (!url) return '';
		if (url.startsWith('http://') || url.startsWith('https://')) return url;
		if (url.startsWith('//')) return `https:${url}`;
		if (url.startsWith('/_next/image')) {
			try {
				const u = new URL(url, this.baseUrl);
				const real = u.searchParams.get('url');
				if (real) return decodeURIComponent(real);
			} catch {
				/* ignore */
			}
		}
		if (
			url.includes('cover') ||
			url.includes('image-') ||
			url.includes('members/') ||
			url.includes('uploads-')
		) {
			return `${this.coverBase}${url.replace(/^\/+/, '')}`;
		}
		return `${this.baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
	}

	private cleanId(link: string): string {
		let id = (link || '').trim();
		if (id.startsWith('http://') || id.startsWith('https://')) {
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
			.replace(/\s*[-|]\s*Softkomik.*$/i, '')
			.replace(/\s*Bahasa Indonesia.*$/i, '')
			.trim();
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath = path.match(/\/chapter\/(\d+)(?:[.-](\d+))?/i);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null) return parseFloat(`${major}.${fromPath[2]}`);
			return major;
		}
		const chapterMatch = String(text).match(
			/(?:chapter|chap|ch\.?)\s*(\d+)(?:[.,](\d+))?/i
		);
		if (chapterMatch) {
			if (chapterMatch[2] != null) {
				return parseFloat(`${chapterMatch[1]}.${chapterMatch[2]}`);
			}
			return parseInt(chapterMatch[1], 10);
		}
		const numberMatch = String(text).match(/\b(\d+(?:\.\d+)?)\b/);
		return numberMatch ? parseFloat(numberMatch[1]) : 0;
	}

	private extractNextData(html: string): any {
		const match = html.match(
			/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s
		);
		if (!match) return null;
		try {
			return JSON.parse(match[1]);
		} catch {
			return null;
		}
	}

	private getPageData(next: any, path: string): SoftkomikPageData {
		const data = next?.props?.pageProps?.data || {};
		const pathParts = path.split('/').filter(Boolean);
		const slug = data?.komik?.title_slug || pathParts[0] || '';
		const chapter = String(data?.chapter || pathParts[pathParts.length - 1] || '');
		const chapterDataId = data?.data?._id || '';
		return {
			slug,
			chapter,
			chapterDataId,
			storageInter2: Boolean(data?.data?.storageInter2),
			backBS3: data?.data?.backBS3
		};
	}

	/** Promo / interstitial paths Softkomik sisipkan di imageSrc */
	private isPromoImagePath(src: string): boolean {
		const s = String(src || '').toLowerCase();
		if (!s) return true;
		if (s.includes('00-hello')) return true;
		if (s.includes('baca-image')) return true;
		if (s.includes('baca di web')) return true;
		if (s.includes('img-file/00-')) return true;
		if (/\/promo\//.test(s)) return true;
		if (/softkomik\.org/.test(s) && /baca/.test(s)) return true;
		return false;
	}

	// -------------------------------------------------------------------------
	// Manga mapping
	// -------------------------------------------------------------------------

	private mapItem(item: any): Manga | null {
		if (!item?.title_slug) return null;
		const id = `/${item.title_slug}`;
		const title = this.normalizeTitle(item.title || '');
		if (!title) return null;

		let cover = item.gambar || '';
		if (cover && !cover.startsWith('http')) cover = this.absUrl(cover);

		let type: 'manga' | 'manhwa' | 'manhua' = 'manga';
		const rawType = String(item.type || '').toLowerCase();
		if (rawType === 'manhwa') type = 'manhwa';
		else if (rawType === 'manhua') type = 'manhua';

		let status = 'Ongoing';
		const rawStatus = String(item.status || '').toLowerCase();
		if (/tamat|complete|end|finish/.test(rawStatus)) status = 'Completed';

		const latestChapter =
			item.latestChapter ??
			(item.latest_chapter
				? this.parseChapterNumber(String(item.latest_chapter))
				: undefined);

		return {
			id,
			title,
			cover,
			sourceId: this.id,
			status,
			type,
			latestChapter: latestChapter && latestChapter > 0 ? latestChapter : undefined
		};
	}

	private mapMangaList(list: any[]): Manga[] {
		const mangas: Manga[] = [];
		const seen = new Set<string>();
		for (const item of list) {
			const manga = this.mapItem(item);
			if (!manga || seen.has(manga.id)) continue;
			seen.add(manga.id);
			mangas.push(manga);
			if (mangas.length >= this.PER_PAGE) break;
		}
		return mangas;
	}

	// -------------------------------------------------------------------------
	// Latest / search
	// -------------------------------------------------------------------------

	async getLatestManga(page: number): Promise<Manga[]> {
		const path =
			page <= 1
				? `${this.baseUrl}/komik/update`
				: `${this.baseUrl}/komik/update?page=${page}`;
		const html = await this.fetchHtml(path);
		const next = this.extractNextData(html);
		const list =
			next?.props?.pageProps?.initialData?.data ||
			next?.props?.pageProps?.data ||
			[];
		return this.mapMangaList(list);
	}

	async searchManga(query: string): Promise<Manga[]> {
		const q = (query || '').trim();
		if (!q) return [];

		const searchPath = `${this.baseUrl}/komik/list?name=${encodeURIComponent(q)}`;
		const html = await this.fetchHtml(searchPath);
		const next = this.extractNextData(html);
		const list =
			next?.props?.pageProps?.initialData?.data ||
			next?.props?.pageProps?.data ||
			[];
		const mangas = this.mapMangaList(list);
		if (mangas.length > 0) return mangas;

		const fallbackHtml = await this.fetchHtml(`${this.baseUrl}/komik/list`);
		const fallbackNext = this.extractNextData(fallbackHtml);
		const fallbackList = fallbackNext?.props?.pageProps?.initialData?.data || [];
		const result: Manga[] = [];
		const seen = new Set<string>();
		const lowerQuery = q.toLowerCase();
		for (const item of fallbackList) {
			const title = String(item?.title || '').toLowerCase();
			if (!title.includes(lowerQuery)) continue;
			const manga = this.mapItem(item);
			if (!manga || seen.has(manga.id)) continue;
			seen.add(manga.id);
			result.push(manga);
		}
		return result.slice(0, this.PER_PAGE);
	}

	// -------------------------------------------------------------------------
	// Details
	// -------------------------------------------------------------------------

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const path = this.cleanId(
			mangaId.startsWith('/') ? mangaId : `/${mangaId.replace(/^\/+/, '')}`
		);
		const html = await this.fetchHtml(path);
		const next = this.extractNextData(html);
		const data = next?.props?.pageProps?.data || {};

		const title = this.normalizeTitle(data.title || path);

		let cover = data.gambar || '';
		if (cover && !cover.startsWith('http')) cover = this.absUrl(cover);
		if (!cover) {
			const $ = cheerio.load(html);
			cover = this.absUrl(
				$('meta[property="og:image"]').attr('content') ||
					$('img').first().attr('src') ||
					''
			);
		}

		let description = String(data.sinopsis || '')
			.replace(/\s+/g, ' ')
			.trim();
		if (!description) {
			const $ = cheerio.load(html);
			description =
				$('meta[name="description"]').attr('content') ||
				$('[class*="sinopsis"], [class*="info"]')
					.text()
					.replace(/\s+/g, ' ')
					.trim() ||
				'';
		}

		let status = 'Ongoing';
		if (/tamat|complete|end|finish/.test(String(data.status || '').toLowerCase())) {
			status = 'Completed';
		}

		const authors: string[] = [];
		if (data.author) {
			String(data.author)
				.split(/,|\//)
				.forEach((author: string) => {
					const value = author.trim();
					if (value) authors.push(value);
				});
		}

		const genres: string[] = Array.isArray(data.Genre) ? data.Genre : [];

		let type: 'manga' | 'manhwa' | 'manhua' = 'manga';
		const rawType = String(data.type || '').toLowerCase();
		if (rawType === 'manhwa') type = 'manhwa';
		else if (rawType === 'manhua') type = 'manhua';

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		const $ = cheerio.load(html);
		$('a[href*="/chapter/"]').each((_, element) => {
			const href = $(element).attr('href') || '';
			const id = this.cleanId(href);
			if (seen.has(id) || !id.includes('/chapter/')) return;
			seen.add(id);
			const chapterTitle =
				$(element).text().replace(/\s+/g, ' ').trim() ||
				`Chapter ${chapters.length + 1}`;
			const number =
				this.parseChapterNumber(chapterTitle, id) || chapters.length + 1;
			chapters.push({ id, title: chapterTitle, number, date: '' });
		});

		const latestRaw = data.latest_chapter || data.latestChapter;
		const latestNum = this.parseChapterNumber(String(latestRaw || '0'));
		if (chapters.length < 2 && latestNum > 0) {
			chapters.length = 0;
			seen.clear();
			for (let i = 1; i <= Math.floor(latestNum); i++) {
				const padded = String(i).padStart(3, '0');
				const id = `${path}/chapter/${padded}`;
				if (seen.has(id)) continue;
				seen.add(id);
				chapters.push({ id, title: `Chapter ${i}`, number: i, date: '' });
			}
			if (latestNum % 1 !== 0) {
				const major = Math.floor(latestNum);
				const minor = String(latestNum).split('.')[1];
				const padded = `${String(major).padStart(3, '0')}.${minor}`;
				const id = `${path}/chapter/${padded}`;
				if (!seen.has(id)) {
					chapters.push({
						id,
						title: `Chapter ${latestNum}`,
						number: latestNum,
						date: ''
					});
				}
			}
		}

		chapters.sort((a, b) => a.number - b.number);

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			description,
			authors,
			genres,
			status,
			chapters,
			type,
			latestChapter: chapters.length
				? chapters[chapters.length - 1].number
				: latestNum || undefined
		};
	}

	// -------------------------------------------------------------------------
	// Chapter pages
	// -------------------------------------------------------------------------

	async getChapterPages(chapterId: string): Promise<string[]> {
		try {
			const path = this.cleanId(
				chapterId.startsWith('/') ? chapterId : `/${chapterId}`
			);

			const pageResponse = await this.fetchChapterPage(path);
			const jar = new Map<string, string>();
			this.collectCookies(pageResponse, jar);
			const html = await pageResponse.text();
			const next = this.extractNextData(html);
			const pageData = this.getPageData(next, path);

			if (!pageData.slug || !pageData.chapter || !pageData.chapterDataId) {
				console.warn('[softkomik] missing chapter data', pageData);
				return [];
			}

			await this.warmHomepage(jar);

			const sessionKey = this.createSessionKey(pageData);
			const session = await this.getSession(sessionKey, jar);
			if (!session) {
				console.warn('[softkomik] failed to create session');
				return [];
			}

			await this.trackVisit(pageData.slug, pageData.chapter, session);

			const imageList = await this.fetchImageList(pageData, session);
			if (!imageList.length) {
				console.log(`[softkomik] pages 0 → ${path}`);
				return [];
			}

			const pages = this.buildImageUrls(imageList, pageData);
			console.log(`[softkomik] ${pages.length} pages → ${path}`);
			return pages;
		} catch (error) {
			console.error('[softkomik] getChapterPages fatal:', error);
			return [];
		}
	}

	private async fetchChapterPage(path: string): Promise<Response> {
		return fetch(`${this.baseUrl}${path}`, {
			headers: {
				'User-Agent': this.USER_AGENT,
				Accept:
					'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
				Referer: `${this.baseUrl}/`
			}
		});
	}

	private collectCookies(response: Response, jar: Map<string, string>): void {
		const headers = response.headers as Headers & {
			getSetCookie?: () => string[];
		};
		const lines: string[] = [];
		if (typeof headers.getSetCookie === 'function') {
			try {
				lines.push(...headers.getSetCookie());
			} catch {
				/* ignore */
			}
		}
		response.headers.forEach((value, key) => {
			if (key.toLowerCase() === 'set-cookie') lines.push(value);
		});
		const single = response.headers.get('set-cookie');
		if (single && !lines.includes(single)) lines.push(single);

		for (const line of lines) {
			const match = String(line).match(/^([^=;]+)=([^;]*)/);
			if (!match) continue;
			const name = match[1].trim();
			const value = match[2].trim();
			if (name) jar.set(name, value);
		}
	}

	private cookieHeader(jar: Map<string, string>): string {
		return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
	}

	private async warmHomepage(jar: Map<string, string>): Promise<void> {
		try {
			const response = await fetch(`${this.baseUrl}/`, {
				headers: {
					'User-Agent': this.USER_AGENT,
					Accept: 'text/html',
					Referer: `${this.baseUrl}/`,
					Cookie: this.cookieHeader(jar)
				}
			});
			this.collectCookies(response, jar);
		} catch {
			/* optional */
		}
	}

	private createSessionKey(pageData: SoftkomikPageData): string {
		return [pageData.slug, pageData.chapter, pageData.chapterDataId].join('/');
	}

	private async getSession(
		key: string,
		initialCookies: Map<string, string>
	): Promise<SoftkomikSession | null> {
		const cached = this.sessionCache.get(key);
		if (cached && cached.expires > Date.now()) return cached;
		if (cached) this.sessionCache.delete(key);

		const inflight = this.sessionInflight.get(key);
		if (inflight) return inflight;

		const promise = this.createSession(initialCookies);
		this.sessionInflight.set(key, promise);
		try {
			const session = await promise;
			if (session) this.sessionCache.set(key, session);
			return session;
		} finally {
			this.sessionInflight.delete(key);
		}
	}

	private async createSession(
		jar: Map<string, string>
	): Promise<SoftkomikSession | null> {
		try {
			const response = await fetch(`${this.baseUrl}/api/session/chapter/oaisos`, {
				headers: {
					'User-Agent': this.USER_AGENT,
					Accept: 'application/json, text/plain, */*',
					Origin: this.baseUrl,
					Referer: `${this.baseUrl}/`,
					Cookie: this.cookieHeader(jar)
				}
			});
			this.collectCookies(response, jar);
			if (!response.ok) {
				console.warn(
					'[softkomik] session failed',
					response.status,
					'cookies',
					jar.size
				);
				return null;
			}

			const data: any = await response.json();
			const token = String(data?.token || '');
			// PENTING: pakai sign utuh (termasuk suffix |oiq&...). Memotong → API 404 / list kosong.
			const sign = String(data?.sign || '');
			if (!token || !sign) {
				console.warn('[softkomik] session missing token/sign');
				return null;
			}

			return {
				cookies: new Map(jar),
				token,
				sign,
				contentAccess: data?.contentAccess || null,
				expires: Date.now() + this.SESSION_TTL
			};
		} catch (error) {
			console.error('[softkomik] session error:', error);
			return null;
		}
	}

	private async trackVisit(
		slug: string,
		chapter: string,
		session: SoftkomikSession
	): Promise<void> {
		try {
			const url = new URL('https://api.softkomik.org/visit');
			url.searchParams.set('slug', slug);
			url.searchParams.set('chapter', chapter);
			await fetch(url.toString(), {
				headers: {
					'User-Agent': this.USER_AGENT,
					Accept: 'application/json, text/plain, */*',
					Origin: this.baseUrl,
					Referer: `${this.baseUrl}/`,
					Cookie: this.cookieHeader(session.cookies)
				}
			});
		} catch {
			/* optional */
		}
	}

	private async fetchImageList(
		pageData: SoftkomikPageData,
		session: SoftkomikSession
	): Promise<string[]> {
		const apiUrl =
			`${this.imageApiBase}/` +
			`${encodeURIComponent(pageData.slug)}` +
			`/chapter/${encodeURIComponent(pageData.chapter)}` +
			`/imgs/${encodeURIComponent(pageData.chapterDataId)}`;

		try {
			const headers: Record<string, string> = {
				'User-Agent': this.USER_AGENT,
				Accept: 'application/json, text/plain, */*',
				Origin: this.baseUrl,
				Referer: `${this.baseUrl}/`,
				'X-Token': session.token,
				'X-Sign': session.sign,
				Cookie: this.cookieHeader(session.cookies)
			};
			const ca = session.contentAccess;
			if (ca?.token && ca?.sign) {
				headers['X-Content-Token'] = String(ca.token);
				headers['X-Content-Sign'] = String(ca.sign);
			}

			const response = await fetch(apiUrl, { headers });
			if (!response.ok) {
				console.warn(
					`[softkomik] imgs API status ${response.status} → ${apiUrl}`
				);
				return [];
			}

			const json: any = await response.json();
			const list = json?.imageSrc || json?.data?.imageSrc || json?._doc?.imageSrc || [];
			if (!Array.isArray(list)) return [];

			return list
				.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)
				.filter((src: string) => !this.isPromoImagePath(src));
		} catch (error) {
			console.error('[softkomik] images API error:', error);
			return [];
		}
	}

	private buildImageUrls(list: string[], pageData: SoftkomikPageData): string[] {
		// Mirror browser: storageInter2 → image.komik.im/softkomik, else psy1
		const useDefaultCdn = Boolean(pageData.storageInter2) || !pageData.backBS3;
		const cdnBase = useDefaultCdn ? this.defaultCdn : this.alternateCdn;

		return list
			.map((src) => {
				if (!src) return '';
				if (src.startsWith('http://') || src.startsWith('https://')) {
					if (this.isPromoImagePath(src)) return '';
					return src;
				}
				const path = src.replace(/^\/+/, '');
				if (this.isPromoImagePath(path)) return '';
				return `${cdnBase}/${path}`;
			})
			.filter(Boolean);
	}
}
