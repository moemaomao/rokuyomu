import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';

/**
 * MangaTaro.org adapter (MangaPeak theme + custom /auth APIs)
 *
 * Site           : https://mangataro.org
 * Latest         : POST /wp-json/manga/v1/latest-chapters  {page}
 * Search         : POST /wp-json/manga/v1/search  {query,page}
 * Detail meta    : HTML /manga/{slug} + GET /wp-json/wp/v2/manga?slug=
 * Chapters       : GET /auth/manga-chapters?manga_id=&offset=&limit=&order=&_t=&_ts=
 * Pages          : GET /auth/chapter-content?chapter_id=
 *
 * Token (_t): md5(timestamp + "mng_ch_" + YYYYMMDDHH).slice(0, 16)
 *
 * ID format:
 *   manga   : "/manga/{slug}"
 *   chapter : "/read/{slug}/ch{num}-{chapterId}"
 */
export class MangaTaroSource extends BaseSource {
	id = 'mangataro';
	name = 'MangaTaro';
	baseUrl = 'https://mangataro.org';

	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'en';

	// ── HTTP ─────────────────────────────────────────────────────────────────

	private h(json = false): Record<string, string> {
		const headers: Record<string, string> = {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
			Accept: json ? 'application/json' : 'text/html,application/xhtml+xml',
			'Accept-Language': 'en-US,en;q=0.9',
			Referer: `${this.baseUrl}/`,
			Origin: this.baseUrl
		};
		if (json) headers['Content-Type'] = 'application/json';
		return headers;
	}

	private async getJson<T = any>(url: string): Promise<T> {
		const res = await fetch(url, { headers: this.h(true), redirect: 'follow' });
		if (!res.ok) throw new Error(`MangaTaro HTTP ${res.status} → ${url}`);
		return (await res.json()) as T;
	}

	private async postJson<T = any>(url: string, body: object): Promise<T> {
		const res = await fetch(url, {
			method: 'POST',
			headers: this.h(true),
			body: JSON.stringify(body),
			redirect: 'follow'
		});
		if (!res.ok) throw new Error(`MangaTaro HTTP ${res.status} → ${url}`);
		return (await res.json()) as T;
	}

	private async getHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const res = await fetch(url, { headers: this.h(false), redirect: 'follow' });
		if (!res.ok) throw new Error(`MangaTaro HTTP ${res.status} → ${url}`);
		return await res.text();
	}

	/** Chapter-list anti-bot token used by the site JS */
	private generateToken(): { token: string; timestamp: number } {
		const timestamp = Math.floor(Date.now() / 1000);
		// matches: new Date().toISOString().slice(0,13).replace(/[-T:]/g,'')
		const hour = new Date().toISOString().slice(0, 13).replace(/[-T:]/g, '');
		const secret = `mng_ch_${hour}`;
		const token = createHash('md5')
			.update(`${timestamp}${secret}`)
			.digest('hex')
			.substring(0, 16);
		return { token, timestamp };
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private toMangaId(slug: string): string {
		const s = String(slug || '')
			.replace(/^\/+/, '')
			.replace(/^manga\//i, '')
			.split('/')[0];
		return `/manga/${s}`;
	}

	private extractSlug(mangaId: string): string {
		const parts = String(mangaId)
			.replace(/^\/+/, '')
			.split('/')
			.filter(Boolean);
		if (parts[0] === 'manga' && parts[1]) return parts[1];
		if (parts[0] === 'read' && parts[1]) return parts[1];
		return parts[0] || '';
	}

	/** /read/{slug}/ch{num}-{id} */
	private extractChapter(
		chapterId: string
	): { slug: string; chapterDbId: string; number: number } {
		const raw = String(chapterId).replace(/^\/+/, '');
		const m = raw.match(
			/(?:read\/)?([^/]+)\/(?:ch)?(\d+(?:\.\d+)?)-(\d+)/i
		);
		if (m) {
			return {
				slug: m[1],
				number: parseFloat(m[2]),
				chapterDbId: m[3]
			};
		}
		// fallback: last segment is numeric id
		const parts = raw.split('/').filter(Boolean);
		return {
			slug: parts[0] === 'read' ? parts[1] || '' : parts[0] || '',
			number: 0,
			chapterDbId: parts[parts.length - 1]?.replace(/\D/g, '') || ''
		};
	}

	private toChapterId(slug: string, num: string | number, dbId: string): string {
		return `/read/${slug}/ch${num}-${dbId}`;
	}

	private mapStatus(raw?: string): string {
		const s = String(raw || '').toLowerCase();
		if (s.includes('complete')) return 'Completed';
		if (s.includes('hiatus')) return 'Hiatus';
		return 'Ongoing';
	}

	private parseChapterNumber(text: string): number {
		const t = String(text || '');
		const m = t.match(/(?:ch\.?|chapter)\s*(\d+(?:\.\d+)?)/i);
		if (m) return parseFloat(m[1]);
		const n = t.match(/(\d+(?:\.\d+)?)/);
		return n ? parseFloat(n[1]) : 0;
	}

	private slugFromUrl(url: string): string {
		const m = String(url).match(/\/manga\/([^/?#]+)/i);
		return m ? m[1] : '';
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			// API returns ~18 unique titles per page; fetch enough API pages
			// to fill PER_PAGE (24) unique manga for this app page.
			const list: Manga[] = [];
			const seen = new Set<string>();
			const apiStart = (p - 1) * 2 + 1; // approx 2 API pages ≈ 24 items

			for (let apiPage = apiStart; apiPage <= apiStart + 2; apiPage++) {
				const json: any = await this.postJson(
					`${this.baseUrl}/wp-json/manga/v1/latest-chapters`,
					{ page: apiPage }
				);
				const rows: any[] = json?.data || json || [];
				if (!rows.length) break;

				for (const row of rows) {
					const slug =
						this.slugFromUrl(row.manga_permalink || row.permalink || '') ||
						String(row.slug || '');
					if (!slug || seen.has(slug)) continue;
					seen.add(slug);
					const chText = String(row.chapter || '');
					const chNum = this.parseChapterNumber(chText);
					list.push({
						id: this.toMangaId(slug),
						title: String(row.title || slug),
						cover: String(row.cover || ''),
						sourceId: this.id,
						type: String(row.manga_type || 'manga').toLowerCase(),
						status: this.mapStatus(row.manga_status),
						latestChapter: chNum ? String(chNum) : undefined,
						lang: this.DEFAULT_LANG
					});
					if (list.length >= this.PER_PAGE) break;
				}
				if (list.length >= this.PER_PAGE) break;
			}

			console.log(`[mangataro] latest page=${p} → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[mangataro] getLatestManga', e);
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
			const json: any = await this.postJson(
				`${this.baseUrl}/wp-json/manga/v1/search`,
				{ query: q, page }
			);
			const rows: any[] = Array.isArray(json) ? json : json?.data || [];
			const list: Manga[] = [];
			const seen = new Set<string>();

			for (const row of rows) {
				const slug =
					String(row.slug || '') ||
					this.slugFromUrl(row.permalink || row.url || '');
				if (!slug || seen.has(slug)) continue;
				seen.add(slug);
				list.push({
					id: this.toMangaId(slug),
					title: String(row.title || slug),
					cover: String(row.thumbnail || row.cover || ''),
					sourceId: this.id,
					type: String(row.type || 'manga').toLowerCase(),
					status: this.mapStatus(row.status),
					lang: this.DEFAULT_LANG
				});
				if (list.length >= this.PER_PAGE) break;
			}

			console.log(`[mangataro] search "${q}" → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[mangataro] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) throw new Error(`MangaTaro: invalid mangaId ${mangaId}`);

		let title = slug.replace(/-/g, ' ');
		let cover = '';
		let status = 'Ongoing';
		let description = '';
		const authors: string[] = [];
		const genres: string[] = [];
		const altTitles: string[] = [];
		let mangaDbId = '';

		// HTML detail — author, genres, status, cover
		try {
			const html = await this.getHtml(`/manga/${slug}`);
			const $ = cheerio.load(html);

			title =
				$('h1').first().text().replace(/\s+/g, ' ').trim() || title;

			cover =
				$('meta[property="og:image"]').attr('content') ||
				$('[data-manga-cover]').attr('data-manga-cover') ||
				$('img[src*="content/media"]').first().attr('src') ||
				'';

			mangaDbId =
				$('.chapter-list').attr('data-manga-id') ||
				$('[data-manga-id]').first().attr('data-manga-id') ||
				'';

			const st = $('.chapter-list').attr('data-status');
			if (st) status = this.mapStatus(st);

			// Author & Artist block: name sits just above the "Author & Artist" label
			$('div').each((_, el) => {
				const label = $(el).text().replace(/\s+/g, ' ').trim();
				if (/^Author\s*&\s*Artist$/i.test(label) || /^Author$/i.test(label)) {
					const parent = $(el).parent();
					const name = parent
						.find('div')
						.first()
						.text()
						.replace(/\s+/g, ' ')
						.trim();
					if (name && !/^Author/i.test(name)) {
						name.split(/[,&]/).forEach((p) => {
							const t = p.trim();
							if (t && !authors.includes(t)) authors.push(t);
						});
					}
				}
			});

			// Genre chips: /tag/ links near top + Genres section spans
			$('a[href*="/tag/"]').each((_, a) => {
				const t = $(a).text().replace(/\s+/g, ' ').trim();
				const skip = /^(manga|manhwa|manhua|novel|comic)$/i.test(t);
				if (t && !skip && !genres.includes(t)) genres.push(t);
			});
			$('.mal-genres-section span, [class*="genres"] span').each((_, sp) => {
				const t = $(sp).text().replace(/\s+/g, ' ').trim();
				if (t && t.length < 40 && !genres.includes(t)) genres.push(t);
			});

			description =
				$('meta[name="description"]').attr('content') ||
				$('.synopsis, .description, [class*="synopsis"]')
					.first()
					.text()
					.replace(/\s+/g, ' ')
					.trim() ||
				'';
		} catch (e) {
			console.warn('[mangataro] detail HTML', e);
		}

		// WP REST for id + tags
		try {
			const posts: any[] = await this.getJson(
				`${this.baseUrl}/wp-json/wp/v2/manga?slug=${encodeURIComponent(slug)}&_embed`
			);
			const post = posts?.[0];
			if (post) {
				if (!mangaDbId) mangaDbId = String(post.id);
				const t = post.title?.rendered || post.title;
				if (t) title = String(t).replace(/<[^>]+>/g, '');
				const c = post.content?.rendered || '';
				if (c && (!description || description.length < 40)) {
					description = String(c)
						.replace(/<[^>]+>/g, ' ')
						.replace(/\s+/g, ' ')
						.trim();
				}
				const embTags = post._embedded?.['wp:term'] || [];
				for (const group of embTags) {
					if (!Array.isArray(group)) continue;
					for (const term of group) {
						const name = String(term?.name || '').trim();
						const tax = String(term?.taxonomy || '');
						if (!name) continue;
						if (tax === 'manga_author' || tax === 'author') {
							if (!authors.includes(name)) authors.push(name);
						} else if (tax === 'post_tag' || tax === 'genre') {
							if (
								!/^(manga|manhwa|manhua)$/i.test(name) &&
								!genres.includes(name)
							)
								genres.push(name);
						}
					}
				}
			}
		} catch (e) {
			console.warn('[mangataro] wp/v2 manga', e);
		}

		// Search API often has authors + alt_titles
		try {
			const search: any = await this.postJson(
				`${this.baseUrl}/wp-json/manga/v1/search`,
				{ query: title || slug, page: 1 }
			);
			const rows: any[] = Array.isArray(search) ? search : search?.data || [];
			const hit =
				rows.find(
					(r) =>
						String(r.slug || '') === slug ||
						String(r.title || '').toLowerCase() === title.toLowerCase()
				) || rows[0];
			if (hit && (String(hit.slug || '') === slug || rows.length === 1)) {
				if (Array.isArray(hit.authors)) {
					for (const a of hit.authors) {
						const t = String(a).trim();
						if (t && !authors.includes(t)) authors.push(t);
					}
				}
				if (Array.isArray(hit.alt_titles)) {
					for (const a of hit.alt_titles) {
						const t = String(a).trim();
						if (t && t.toLowerCase() !== title.toLowerCase() && !altTitles.includes(t))
							altTitles.push(t);
					}
				}
				if (hit.status) status = this.mapStatus(hit.status);
				if (hit.thumbnail && !cover) cover = String(hit.thumbnail);
				if (hit.description && (!description || description.length < 40)) {
					description = String(hit.description)
						.replace(/<[^>]+>/g, ' ')
						.replace(/\s+/g, ' ')
						.trim();
				}
			}
		} catch (e) {
			console.warn('[mangataro] search meta', e);
		}

		if (!mangaDbId) {
			throw new Error(`MangaTaro: could not resolve manga id for ${slug}`);
		}

		// Chapters via signed auth API
		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		try {
			const { token, timestamp } = this.generateToken();
			const params = new URLSearchParams({
				manga_id: String(mangaDbId),
				offset: '0',
				limit: '500',
				order: 'DESC',
				_t: token,
				_ts: String(timestamp)
			});
			const data: any = await this.getJson(
				`${this.baseUrl}/auth/manga-chapters?${params}`
			);
			const rows: any[] = data?.chapters || [];
			for (const ch of rows) {
				const dbId = String(ch.id || '');
				if (!dbId || seen.has(dbId)) continue;
				seen.add(dbId);
				const num =
					typeof ch.chapter === 'number'
						? ch.chapter
						: parseFloat(String(ch.chapter)) ||
							this.parseChapterNumber(String(ch.title || ''));
				chapters.push({
					id: this.toChapterId(slug, num, dbId),
					title: String(ch.title || `Chapter ${num}`),
					number: num || chapters.length + 1,
					date: ch.date ? String(ch.date) : undefined
				});
			}
		} catch (e) {
			console.error('[mangataro] manga-chapters', e);
		}

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const latestChapter =
			chapters.length > 0 ? String(chapters[0].number) : undefined;

		// Types only have description — prefix alternative titles there
		if (altTitles.length) {
			const altLine = `Alternative: ${altTitles.join(', ')}`;
			description = description
				? `${altLine}\n\n${description}`
				: altLine;
		}

		console.log(
			`[mangataro] detail "${title}" authors=${authors.length} genres=${genres.length} alt=${altTitles.length} chapters=${chapters.length}`
		);

		return {
			id: this.toMangaId(slug),
			sourceId: this.id,
			title,
			cover,
			type: 'manga',
			status,
			latestChapter,
			lang: this.DEFAULT_LANG,
			description,
			authors: [...new Set(authors)],
			genres: [...new Set(genres)],
			chapters
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		try {
			const { chapterDbId } = this.extractChapter(chapterId);
			if (!chapterDbId) {
				console.error('[mangataro] empty chapter id from', chapterId);
				return [];
			}

			const data: any = await this.getJson(
				`${this.baseUrl}/auth/chapter-content?chapter_id=${encodeURIComponent(chapterDbId)}`
			);
			if (!data?.success || !Array.isArray(data.images)) {
				console.error('[mangataro] chapter-content failed', data?.message);
				return [];
			}

			const pages = (data.images as string[])
				.map((u) => String(u).trim())
				.filter((u) => /^https?:\/\//i.test(u));

			console.log(
				`[mangataro] getChapterPages ${chapterDbId} → ${pages.length}`
			);
			return pages;
		} catch (e) {
			console.error('[mangataro] getChapterPages', e);
			return [];
		}
	}
}
