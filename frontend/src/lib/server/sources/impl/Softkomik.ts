import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

interface SoftkomikSession {
	cookies: Map<string, string>;
	token: string;
	sign: string;
	expires: number;
}

interface SoftkomikPageData {
	slug: string;
	chapter: string;
	chapterDataId: string;
	storageInter2?: string;
	backBS3?: string;
}

export class SoftkomikSource extends BaseSource {
	id = 'softkomik';
	name = 'Softkomik';
	baseUrl = 'https://softkomik.co';

	private readonly coverBase =
		'https://cover.softdevices.my.id/softkomik-cover/';

	private readonly imageApiBase = 'https://api.softkomik.org/komik';

	private readonly defaultCdn = 'https://image.komik.im/softkomik';
	private readonly alternateCdn = 'https://psy1.komik.im';

	private readonly PER_PAGE = 24;

	private readonly USER_AGENT =
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

	private readonly SESSION_TTL = 5 * 60 * 1000;

	/**
	 * Session cache.
	 *
	 * Key:
	 *   slug/chapter/id
	 *
	 * Map hanya cache runtime.
	 * Jangan dianggap sebagai persistent storage.
	 */
	private readonly sessionCache = new Map<
		string,
		SoftkomikSession
	>();

	/**
	 * Menahan request session yang sedang berjalan.
	 *
	 * Ini penting ketika reader meminta banyak gambar
	 * secara bersamaan untuk chapter yang sama.
	 */
	private readonly sessionInflight = new Map<
		string,
		Promise<SoftkomikSession | null>
	>();

	// -------------------------------------------------------------------------
	// Generic helpers
	// -------------------------------------------------------------------------

	private absUrl(url: string): string {
		if (!url) return '';

		if (url.startsWith('http://') || url.startsWith('https://')) {
			return url;
		}

		if (url.startsWith('//')) {
			return `https:${url}`;
		}

		if (url.startsWith('/_next/image')) {
			try {
				const u = new URL(url, this.baseUrl);
				const real = u.searchParams.get('url');

				if (real) {
					return decodeURIComponent(real);
				}
			} catch {
				// Ignore invalid URL.
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
				// Ignore invalid URL.
			}
		}

		if (!id.startsWith('/')) {
			id = `/${id}`;
		}

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
		const fromPath = path.match(
			/\/chapter\/(\d+)(?:[.-](\d+))?/i
		);

		if (fromPath) {
			const major = parseInt(fromPath[1], 10);

			if (fromPath[2] != null) {
				return parseFloat(`${major}.${fromPath[2]}`);
			}

			return major;
		}

		const chapterMatch = String(text).match(
			/(?:chapter|chap|ch\.?)\s*(\d+)(?:[.,](\d+))?/i
		);

		if (chapterMatch) {
			if (chapterMatch[2] != null) {
				return parseFloat(
					`${chapterMatch[1]}.${chapterMatch[2]}`
				);
			}

			return parseInt(chapterMatch[1], 10);
		}

		const numberMatch = String(text).match(
			/\b(\d+(?:\.\d+)?)\b/
		);

		return numberMatch ? parseFloat(numberMatch[1]) : 0;
	}

	private extractNextData(html: string): any {
		const match = html.match(
			/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s
		);

		if (!match) {
			return null;
		}

		try {
			return JSON.parse(match[1]);
		} catch {
			return null;
		}
	}

	private getPageData(next: any, path: string): SoftkomikPageData {
		const data = next?.props?.pageProps?.data || {};

		const pathParts = path.split('/').filter(Boolean);

		const slug =
			data?.komik?.title_slug ||
			pathParts[0] ||
			'';

		const chapter =
			data?.chapter ||
			pathParts[pathParts.length - 1] ||
			'';

		const chapterDataId =
			data?.data?._id ||
			'';

		return {
			slug,
			chapter,
			chapterDataId,
			storageInter2: data?.data?.storageInter2,
			backBS3: data?.data?.backBS3
		};
	}

	// -------------------------------------------------------------------------
	// Manga mapping
	// -------------------------------------------------------------------------

	private mapItem(item: any): Manga | null {
		if (!item?.title_slug) {
			return null;
		}

		const id = `/${item.title_slug}`;
		const title = this.normalizeTitle(item.title || '');

		if (!title) {
			return null;
		}

		let cover = item.gambar || '';

		if (cover && !cover.startsWith('http')) {
			cover = this.absUrl(cover);
		}

		let type: 'manga' | 'manhwa' | 'manhua' = 'manga';

		const rawType = String(item.type || '').toLowerCase();

		if (rawType === 'manhwa') {
			type = 'manhwa';
		} else if (rawType === 'manhua') {
			type = 'manhua';
		}

		let status = 'Ongoing';

		const rawStatus = String(item.status || '').toLowerCase();

		if (/tamat|complete|end|finish/.test(rawStatus)) {
			status = 'Completed';
		}

		const latestChapter =
			item.latestChapter ??
			(item.latest_chapter
				? this.parseChapterNumber(
						String(item.latest_chapter)
					)
				: undefined);

		return {
			id,
			title,
			cover,
			sourceId: this.id,
			status,
			type,
			latestChapter:
				latestChapter && latestChapter > 0
					? latestChapter
					: undefined
		};
	}

	// -------------------------------------------------------------------------
	// Latest manga
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

	// -------------------------------------------------------------------------
	// Search
	// -------------------------------------------------------------------------

	async searchManga(query: string): Promise<Manga[]> {
		const q = (query || '').trim();

		if (!q) {
			return [];
		}

		const searchPath =
			`${this.baseUrl}/komik/list?name=${encodeURIComponent(q)}`;

		const html = await this.fetchHtml(searchPath);
		const next = this.extractNextData(html);

		const list =
			next?.props?.pageProps?.initialData?.data ||
			next?.props?.pageProps?.data ||
			[];

		const mangas = this.mapMangaList(list);

		if (mangas.length > 0) {
			return mangas;
		}

		// Fallback:
		// ambil halaman list kemudian filter title secara lokal.
		const fallbackPath = `${this.baseUrl}/komik/list`;
		const fallbackHtml = await this.fetchHtml(fallbackPath);
		const fallbackNext = this.extractNextData(fallbackHtml);

		const fallbackList =
			fallbackNext?.props?.pageProps?.initialData?.data ||
			[];

		const result: Manga[] = [];
		const seen = new Set<string>();
		const lowerQuery = q.toLowerCase();

		for (const item of fallbackList) {
			const title = String(item?.title || '').toLowerCase();

			if (!title.includes(lowerQuery)) {
				continue;
			}

			const manga = this.mapItem(item);

			if (!manga || seen.has(manga.id)) {
				continue;
			}

			seen.add(manga.id);
			result.push(manga);
		}

		return result.slice(0, this.PER_PAGE);
	}

	// -------------------------------------------------------------------------
	// Manga list helper
	// -------------------------------------------------------------------------

	private mapMangaList(list: any[]): Manga[] {
		const mangas: Manga[] = [];
		const seen = new Set<string>();

		for (const item of list) {
			const manga = this.mapItem(item);

			if (!manga || seen.has(manga.id)) {
				continue;
			}

			seen.add(manga.id);
			mangas.push(manga);

			if (mangas.length >= this.PER_PAGE) {
				break;
			}
		}

		return mangas;
	}

	// -------------------------------------------------------------------------
	// Manga details
	// -------------------------------------------------------------------------

	async getMangaDetails(
		mangaId: string
	): Promise<MangaDetails> {
		const path = this.cleanId(
			mangaId.startsWith('/')
				? mangaId
				: `/${mangaId.replace(/^\/+/, '')}`
		);

		const html = await this.fetchHtml(path);
		const next = this.extractNextData(html);
		const data = next?.props?.pageProps?.data || {};

		const title =
			this.normalizeTitle(data.title || path);

		// Cover
		let cover = data.gambar || '';

		if (cover && !cover.startsWith('http')) {
			cover = this.absUrl(cover);
		}

		if (!cover) {
			const $ = cheerio.load(html);

			cover = this.absUrl(
				$('meta[property="og:image"]').attr('content') ||
					$('img').first().attr('src') ||
					''
			);
		}

		// Description
		let description = String(
			data.sinopsis || ''
		)
			.replace(/\s+/g, ' ')
			.trim();

		if (!description) {
			const $ = cheerio.load(html);

			description =
				$('meta[name="description"]').attr('content') ||
				$(
					'[class*="sinopsis"], [class*="info"]'
				)
					.text()
					.replace(/\s+/g, ' ')
					.trim() ||
				'';
		}

		// Status
		let status = 'Ongoing';

		const rawStatus =
			String(data.status || '').toLowerCase();

		if (/tamat|complete|end|finish/.test(rawStatus)) {
			status = 'Completed';
		}

		// Authors
		const authors: string[] = [];

		if (data.author) {
			String(data.author)
				.split(/,|\//)
				.forEach((author: string) => {
					const value = author.trim();

					if (value) {
						authors.push(value);
					}
				});
		}

		// Genres
		const genres: string[] =
			Array.isArray(data.Genre)
				? data.Genre
				: [];

		// Type
		let type: 'manga' | 'manhwa' | 'manhua' =
			'manga';

		const rawType =
			String(data.type || '').toLowerCase();

		if (rawType === 'manhwa') {
			type = 'manhwa';
		} else if (rawType === 'manhua') {
			type = 'manhua';
		}

		// Chapters
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		const $ = cheerio.load(html);

		$('a[href*="/chapter/"]').each((_, element) => {
			const href =
				$(element).attr('href') || '';

			const id = this.cleanId(href);

			if (
				seen.has(id) ||
				!id.includes('/chapter/')
			) {
				return;
			}

			seen.add(id);

			const chapterTitle =
				$(element)
					.text()
					.replace(/\s+/g, ' ')
					.trim() ||
				`Chapter ${chapters.length + 1}`;

			const number =
				this.parseChapterNumber(
					chapterTitle,
					id
				) ||
				chapters.length + 1;

			chapters.push({
				id,
				title: chapterTitle,
				number,
				date: ''
			});
		});

		// Fallback:
		// generate chapters when the page exposes very few links.
		const latestRaw =
			data.latest_chapter ||
			data.latestChapter;

		const latestNum =
			this.parseChapterNumber(
				String(latestRaw || '0')
			);

		if (
			chapters.length < 2 &&
			latestNum > 0
		) {
			chapters.length = 0;
			seen.clear();

			for (
				let i = 1;
				i <= Math.floor(latestNum);
				i++
			) {
				const padded =
					String(i).padStart(3, '0');

				const id =
					`${path}/chapter/${padded}`;

				if (seen.has(id)) {
					continue;
				}

				seen.add(id);

				chapters.push({
					id,
					title: `Chapter ${i}`,
					number: i,
					date: ''
				});
			}

			// Example: 10.3
			if (latestNum % 1 !== 0) {
				const major =
					Math.floor(latestNum);

				const minor =
					String(latestNum).split('.')[1];

				const padded =
					`${String(major).padStart(3, '0')}.${minor}`;

				const id =
					`${path}/chapter/${padded}`;

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

		chapters.sort(
			(a, b) => a.number - b.number
		);

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

	async getChapterPages(
		chapterId: string
	): Promise<string[]> {
		try {
			const path = this.cleanId(
				chapterId.startsWith('/')
					? chapterId
					: `/${chapterId}`
			);

			// -------------------------------------------------------------
			// 1. Fetch chapter page
			// -------------------------------------------------------------

			const pageResponse =
				await this.fetchChapterPage(path);

			const jar = new Map<string, string>();

			this.collectCookies(
				pageResponse,
				jar
			);

			const html =
				await pageResponse.text();

			const next =
				this.extractNextData(html);

			const pageData =
				this.getPageData(next, path);

			if (
				!pageData.slug ||
				!pageData.chapter ||
				!pageData.chapterDataId
			) {
				console.warn(
					'[softkomik] missing chapter data',
					{
						slug: pageData.slug,
						chapter: pageData.chapter,
						chapterDataId:
							pageData.chapterDataId
					}
				);

				return [];
			}

			// -------------------------------------------------------------
			// 2. Warm homepage / cookies
			// -------------------------------------------------------------

			await this.warmHomepage(jar);

			// -------------------------------------------------------------
			// 3. Session
			// -------------------------------------------------------------

			const sessionKey =
				this.createSessionKey(
					pageData
				);

			const session =
				await this.getSession(
					sessionKey,
					jar
				);

			if (!session) {
				console.warn(
					'[softkomik] failed to create session'
				);

				return [];
			}

			// -------------------------------------------------------------
			// 4. Images API
			// -------------------------------------------------------------

			const imageList =
				await this.fetchImageList(
					pageData,
					session
				);

			if (!imageList.length) {
				console.log(
					`[softkomik] pages 0 → ${path}`
				);

				return [];
			}

			// -------------------------------------------------------------
			// 5. Convert image paths to CDN URLs
			// -------------------------------------------------------------

			const pages =
				this.buildImageUrls(
					imageList,
					pageData
				);

			console.log(
				`[softkomik] ${pages.length} pages → ${path}`
			);

			return pages;
		} catch (error) {
			console.error(
				'[softkomik] getChapterPages fatal:',
				error
			);

			return [];
		}
	}

	// -------------------------------------------------------------------------
	// Chapter page request
	// -------------------------------------------------------------------------

	private async fetchChapterPage(
		path: string
	): Promise<Response> {
		return fetch(
			`${this.baseUrl}${path}`,
			{
				headers: {
					'User-Agent':
						this.USER_AGENT,
					Accept:
						'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
					'Accept-Language':
						'en-US,en;q=0.9',
					Referer:
						`${this.baseUrl}/`
				}
			}
		);
	}

	// -------------------------------------------------------------------------
	// Cookie handling
	// -------------------------------------------------------------------------

	private collectCookies(
		response: Response,
		jar: Map<string, string>
	): void {
		const headers = response.headers as Headers & {
			getSetCookie?: () => string[];
		};

		const lines: string[] = [];

		// Cloudflare / modern runtimes
		if (
			typeof headers.getSetCookie ===
			'function'
		) {
			try {
				lines.push(
					...headers.getSetCookie()
				);
			} catch {
				// Ignore.
			}
		}

		// Fallback
		response.headers.forEach(
			(value, key) => {
				if (
					key.toLowerCase() ===
					'set-cookie'
				) {
					lines.push(value);
				}
			}
		);

		const single =
			response.headers.get('set-cookie');

		if (
			single &&
			!lines.includes(single)
		) {
			lines.push(single);
		}

		for (const line of lines) {
			const match =
				String(line).match(
					/^([^=;]+)=([^;]*)/
				);

			if (!match) {
				continue;
			}

			const name =
				match[1].trim();

			const value =
				match[2].trim();

			if (!name) {
				continue;
			}

			jar.set(name, value);
		}
	}

	private cookieHeader(
		jar: Map<string, string>
	): string {
		return [...jar.entries()]
			.map(
				([name, value]) =>
					`${name}=${value}`
			)
			.join('; ');
	}

	// -------------------------------------------------------------------------
	// Homepage warm-up
	// -------------------------------------------------------------------------

	private async warmHomepage(
		jar: Map<string, string>
	): Promise<void> {
		try {
			const response =
				await fetch(
					`${this.baseUrl}/`,
					{
						headers: {
							'User-Agent':
								this.USER_AGENT,
							Accept:
								'text/html',
							Referer:
								`${this.baseUrl}/`,
							Cookie:
								this.cookieHeader(jar)
						}
					}
				);

			this.collectCookies(
				response,
				jar
			);
		} catch {
			// Homepage warm-up is optional.
		}
	}

	// -------------------------------------------------------------------------
	// Session
	// -------------------------------------------------------------------------

	private createSessionKey(
		pageData: SoftkomikPageData
	): string {
		return [
			pageData.slug,
			pageData.chapter,
			pageData.chapterDataId
		].join('/');
	}

	private async getSession(
		key: string,
		initialCookies: Map<string, string>
	): Promise<SoftkomikSession | null> {
		// -------------------------------------------------------------
		// Existing valid cache
		// -------------------------------------------------------------

		const cached =
			this.sessionCache.get(key);

		if (
			cached &&
			cached.expires > Date.now()
		) {
			return cached;
		}

		if (cached) {
			this.sessionCache.delete(key);
		}

		// -------------------------------------------------------------
		// Existing request in progress
		// -------------------------------------------------------------

		const inflight =
			this.sessionInflight.get(key);

		if (inflight) {
			return inflight;
		}

		// -------------------------------------------------------------
		// Create only one session request
		// -------------------------------------------------------------

		const promise =
			this.createSession(
				initialCookies
			);

		this.sessionInflight.set(
			key,
			promise
		);

		try {
			const session =
				await promise;

			if (session) {
				this.sessionCache.set(
					key,
					session
				);
			}

			return session;
		} finally {
			this.sessionInflight.delete(
				key
			);
		}
	}

	private async createSession(
		jar: Map<string, string>
	): Promise<SoftkomikSession | null> {
		try {
			const response =
				await fetch(
					`${this.baseUrl}/api/session/chapter/oaisos`,
					{
						headers: {
							'User-Agent':
								this.USER_AGENT,
							Accept:
								'application/json, text/plain, */*',
							Origin:
								this.baseUrl,
							Referer:
								`${this.baseUrl}/`,
							Cookie:
								this.cookieHeader(jar)
						}
					}
				);

			this.collectCookies(
				response,
				jar
			);

			if (!response.ok) {
				console.warn(
					'[softkomik] session failed',
					response.status,
					'cookies',
					jar.size
				);

				return null;
			}

			const data: any =
				await response.json();

			const token =
				String(data?.token || '');

			let sign =
				String(data?.sign || '');

			/**
			 * Softkomik kadang memberikan sign
			 * dengan suffix seperti:
			 *
			 * xxx|oiq&...
			 *
			 * Yang dipakai hanya bagian sebelum
			 * separator tersebut.
			 */
			if (sign.includes('|oiq&')) {
				sign =
					sign.split('|oiq&')[0];
			}

			if (!token || !sign) {
				console.warn(
					'[softkomik] session missing token/sign'
				);

				return null;
			}

			return {
				cookies: new Map(jar),
				token,
				sign,
				expires:
					Date.now() +
					this.SESSION_TTL
			};
		} catch (error) {
			console.error(
				'[softkomik] session error:',
				error
			);

			return null;
		}
	}

	// -------------------------------------------------------------------------
	// Images API
	// -------------------------------------------------------------------------

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
			const response =
				await fetch(apiUrl, {
					headers: {
						'User-Agent':
							this.USER_AGENT,
						Accept:
							'application/json, text/plain, */*',
						Origin:
							this.baseUrl,
						Referer:
							`${this.baseUrl}/`,
						'X-Token':
							session.token,
						'X-Sign':
							session.sign,
						Cookie:
							this.cookieHeader(
								session.cookies
							)
					}
				});

			if (!response.ok) {
				console.warn(
					`[softkomik] imgs API status ${response.status} → ${apiUrl}`
				);

				return [];
			}

			const json: any =
				await response.json();

			const list =
				json?.imageSrc ||
				json?.data?.imageSrc ||
				[];

			if (!Array.isArray(list)) {
				return [];
			}

			return list.filter(
				(value: unknown): value is string =>
					typeof value === 'string' &&
					value.length > 0
			);
		} catch (error) {
			console.error(
				'[softkomik] images API error:',
				error
			);

			return [];
		}
	}

	// -------------------------------------------------------------------------
	// CDN URL builder
	// -------------------------------------------------------------------------

	private buildImageUrls(
		list: string[],
		pageData: SoftkomikPageData
	): string[] {
		const useDefaultCdn =
			Boolean(pageData.storageInter2) ||
			!pageData.backBS3;

		const cdnBase =
			useDefaultCdn
				? this.defaultCdn
				: this.alternateCdn;

		return list
			.map((src) => {
				if (!src) {
					return '';
				}

				if (
					src.startsWith(
						'http://'
					) ||
					src.startsWith(
						'https://'
					)
				) {
					return src;
				}

				return `${cdnBase}/${src.replace(
					/^\/+/,
					''
				)}`;
			})
			.filter(Boolean);
	}
}