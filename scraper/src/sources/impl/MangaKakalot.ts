/**
 * MangaKakalot.gg adapter (HTML + chapters JSON API)
 *
 * Domain   : https://www.mangakakalove.com (mirror; .gg blocked by CF WAF)
 * Latest   : GET /manga-list/latest-manga?page=N  (fallback: /)
 * Search   : GET /search/story/{query}
 * Detail   : GET /manga/{slug}
 * Chapters : GET /api/manga/{slug}/chapters?limit=&offset=
 * Pages    : GET /manga/{slug}/{chapter-slug}
 *
 * ID format:
 *   manga   : "/manga/{slug}"
 *   chapter : "/manga/{slug}/{chapter-slug}"
 *
 * Uses global fetch (works on Node + Cloudflare Workers).
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class MangaKakalotSource extends BaseSource {
	id = 'mangakakalot';
	name = 'MangaKakalot';
	baseUrl = 'https://www.mangakakalove.com';

	private readonly PER_PAGE = 20;
	private readonly DEFAULT_LANG = 'en';

	// ── HTTP ─────────────────────────────────────────────────────────────────

	private browserHeaders(referer?: string): Record<string, string> {
		return {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
			Accept:
				'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
			'Accept-Language': 'en-US,en;q=0.9',
			'Cache-Control': 'no-cache',
			Pragma: 'no-cache',
			'Upgrade-Insecure-Requests': '1',
			'Sec-Fetch-Dest': 'document',
			'Sec-Fetch-Mode': 'navigate',
			'Sec-Fetch-Site': referer ? 'same-origin' : 'none',
			'Sec-Fetch-User': '?1',
			Referer: referer || `${this.baseUrl}/`
		};
	}

	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const res = await fetch(url, {
			headers: this.browserHeaders(`${this.baseUrl}/`),
			redirect: 'follow'
		});
		if (!res.ok) {
			throw new Error(`MangaKakalot HTTP ${res.status} → ${url}`);
		}
		return await res.text();
	}

	private async fetchApiJson<T = any>(path: string): Promise<T> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const res = await fetch(url, {
			headers: {
				...this.browserHeaders(`${this.baseUrl}/`),
				Accept: 'application/json, text/plain, */*',
				'X-Requested-With': 'XMLHttpRequest'
			},
			redirect: 'follow'
		});
		if (!res.ok) {
			throw new Error(`MangaKakalot API ${res.status} → ${url}`);
		}
		return (await res.json()) as T;
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private absUrl(url: string): string {
		if (!url) return '';
		let u = url.trim().replace(/&amp;/g, '&');
		if (u.startsWith('http')) return u;
		if (u.startsWith('//')) return `https:${u}`;
		return `${this.baseUrl}${u.startsWith('/') ? '' : '/'}${u}`;
	}

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
		return parts[0] || '';
	}

	private extractChapterPath(chapterId: string): {
		slug: string;
		chapterSlug: string;
	} {
		const parts = String(chapterId)
			.replace(/^\/+/, '')
			.split('/')
			.filter(Boolean);
		if (parts[0] === 'manga' && parts[1] && parts[2]) {
			return { slug: parts[1], chapterSlug: parts[2] };
		}
		if (parts[0] && parts[1]) {
			return { slug: parts[0], chapterSlug: parts[1] };
		}
		return {
			slug: parts[0] || '',
			chapterSlug: parts[parts.length - 1] || ''
		};
	}

	private toChapterId(slug: string, chapterSlug: string): string {
		return `/manga/${slug}/${chapterSlug}`;
	}

	private parseChapterNumber(text: string): number {
		const t = String(text || '');
		const m = t.match(/(?:chapter|chap|ch\.?)\s*(\d+)(?:[.,](\d+))?/i);
		if (m) {
			if (m[2] != null) return parseFloat(`${m[1]}.${m[2]}`);
			return parseInt(m[1], 10);
		}
		const n = t.match(/\b(\d+(?:\.\d+)?)\b/);
		return n ? parseFloat(n[1]) : 0;
	}

	private formatDate(iso?: string | null): string {
		if (!iso) return '';
		try {
			return new Date(iso).toISOString().slice(0, 10);
		} catch {
			return String(iso).slice(0, 10);
		}
	}

	private mapStatus(raw?: string): string {
		const s = String(raw || '').toLowerCase();
		if (s.includes('complete')) return 'Completed';
		if (s.includes('hiatus')) return 'Hiatus';
		if (s.includes('cancel') || s.includes('drop')) return 'Dropped';
		return 'Ongoing';
	}

	private decodeHtml(s: string): string {
		return s
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#039;/g, "'")
			.replace(/&#x27;/g, "'")
			.trim();
	}

	private parseItemList(html: string): Manga[] {
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('div.item').each((_, el) => {
			const $el = $(el);
			const a = $el.find('h3 a[href*="/manga/"]').first();
			const href = a.attr('href') || '';
			const m = href.match(/\/manga\/([^/?#]+)/i);
			if (!m) return;
			const slug = m[1];
			if (seen.has(slug)) return;
			seen.add(slug);

			const title = (
				a.attr('title') ||
				a.text() ||
				$el.find('img').attr('alt') ||
				slug
			)
				.replace(/\s+/g, ' ')
				.trim();
			const cover = this.absUrl(
				$el.find('img').attr('src') || $el.find('img').attr('data-src') || ''
			);

			const chA = $el.find('a[href*="/chapter"]').first();
			const chText = (chA.attr('title') || chA.text() || '')
				.replace(/\s+/g, ' ')
				.trim();
			const chNum = this.parseChapterNumber(chText);

			list.push({
				id: this.toMangaId(slug),
				title: this.decodeHtml(title),
				cover,
				sourceId: this.id,
				type: 'manga',
				status: 'Ongoing',
				latestChapter: chNum ? String(chNum) : undefined,
				lang: this.DEFAULT_LANG
			});
		});

		return list;
	}

	private parseSearchList(html: string): Manga[] {
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('div.story_item').each((_, el) => {
			const $el = $(el);
			const a = $el.find('h3.story_name a[href*="/manga/"]').first();
			const href =
				a.attr('href') ||
				$el.find('a[href*="/manga/"]').first().attr('href') ||
				'';
			const m = href.match(/\/manga\/([^/?#]+)/i);
			if (!m) return;
			const slug = m[1];
			if (seen.has(slug)) return;
			seen.add(slug);

			const title = (a.text() || $el.find('img').attr('alt') || slug)
				.replace(/\s+/g, ' ')
				.trim();
			const cover = this.absUrl(
				$el.find('img').attr('src') || $el.find('img').attr('data-src') || ''
			);

			const chA = $el.find('em.story_chapter a').first();
			const chText = (chA.attr('title') || chA.text() || '')
				.replace(/\s+/g, ' ')
				.trim();
			const chNum = this.parseChapterNumber(chText);

			list.push({
				id: this.toMangaId(slug),
				title: this.decodeHtml(title),
				cover,
				sourceId: this.id,
				type: 'manga',
				status: 'Ongoing',
				latestChapter: chNum ? String(chNum) : undefined,
				lang: this.DEFAULT_LANG
			});
		});

		return list;
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const path =
				p <= 1
					? '/manga-list/latest-manga'
					: `/manga-list/latest-manga?page=${p}`;

			let list: Manga[] = [];
			try {
				const html = await this.fetchHtml(path);
				list = this.parseItemList(html);
			} catch (e) {
				if (p <= 1) {
					const html = await this.fetchHtml('/');
					list = this.parseItemList(html);
				} else {
					throw e;
				}
			}

			const out = list.slice(0, this.PER_PAGE);
			console.log(`[mangakakalot] latest page=${p} → ${out.length} items`);
			return out;
		} catch (e) {
			console.error('[mangakakalot] getLatestManga', e);
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
			const slug = encodeURIComponent(q);
			const path =
				page > 1
					? `/search/story/${slug}?page=${page}`
					: `/search/story/${slug}`;
			const html = await this.fetchHtml(path);
			const list = this.parseSearchList(html).slice(0, this.PER_PAGE);
			console.log(`[mangakakalot] search "${q}" → ${list.length} items`);
			return list;
		} catch (e) {
			console.error('[mangakakalot] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) {
			throw new Error(`MangaKakalot: invalid mangaId ${mangaId}`);
		}

		console.log(`[mangakakalot] getMangaDetails slug=${slug} id=${mangaId}`);

		const html = await this.fetchHtml(`/manga/${slug}`);
		const $ = cheerio.load(html);

		let title =
			$('h1').first().text().replace(/\s+/g, ' ').trim() ||
			($('meta[property="og:title"]').attr('content') || '')
				.replace(/\s+/g, ' ')
				.trim() ||
			'';

		if (!title) {
			const pageTitle = $('title').first().text() || '';
			title = pageTitle
				.replace(/\s*\|\s*MangaKakalot.*$/i, '')
				.replace(/^Read\s+/i, '')
				.replace(/\s+Latest Chapter.*$/i, '')
				.replace(/\s+Manga Online Free.*$/i, '')
				.replace(/\s+/g, ' ')
				.trim();
		}

		if (!title) title = slug.replace(/[-_]+/g, ' ');

		const cover = this.absUrl(
			$('meta[property="og:image"]').attr('content') ||
				$('.manga-info-pic img, .info-image img, .manga-info img')
					.first()
					.attr('src') ||
				$(`img[src*="${slug}"]`).first().attr('src') ||
				`https://img-r1.2xstorage.com/thumb/${slug}.webp`
		);

		let status = 'Ongoing';
		const authors: string[] = [];
		const genres: string[] = [];
		let description = '';

		// Prefer JSON-LD
		$('script[type="application/ld+json"]').each((_, el) => {
			try {
				const raw = $(el).html() || '';
				const data = JSON.parse(raw);
				const nodes = Array.isArray(data) ? data : [data];
				for (const node of nodes) {
					if (!node || typeof node !== 'object') continue;
					if (Array.isArray(node.genre)) {
						for (const g of node.genre) {
							const t = String(g).trim();
							if (t && !genres.includes(t)) genres.push(t);
						}
					}
					if (node.description && !description) {
						description = String(node.description)
							.replace(/<[^>]+>/g, '')
							.replace(/\s+/g, ' ')
							.trim();
					}
					if (node.author) {
						const auths = Array.isArray(node.author)
							? node.author
							: [node.author];
						for (const a of auths) {
							const n =
								typeof a === 'string'
									? a
									: a?.name || '';
							const t = String(n).trim();
							if (t && !authors.includes(t)) authors.push(t);
						}
					}
				}
			} catch {
				/* ignore bad json-ld */
			}
		});

	
		$('li').each((_, li) => {
			const text = $(li).text().replace(/\s+/g, ' ').trim();
			if (/^Author/i.test(text)) {
				const body = text.replace(/^Author\(s\)\s*:\s*/i, '').trim();
				body.split(/,/).forEach((s) => {
					const t = s.trim();
					if (t && t.toLowerCase() !== 'updating' && !authors.includes(t))
						authors.push(t);
				});
				$(li)
					.find('a')
					.each((__, a) => {
						const t = $(a).text().replace(/\s+/g, ' ').trim();
						if (t && !authors.includes(t)) authors.push(t);
					});
			} else if (/^Status/i.test(text)) {
				status = this.mapStatus(text.replace(/^Status\s*:\s*/i, ''));
			} else if (/^Genres/i.test(text) && genres.length === 0) {
				$(li)
					.find('a[href*="/genre/"]')
					.each((__, a) => {
						const t = $(a).text().replace(/\s+/g, ' ').trim();
						if (t && !genres.includes(t)) genres.push(t);
					});
			}
		});

		if (!description) {
			description =
				$('#noidungm, .manga-info-summary, .panel-story-info-description')
					.first()
					.text()
					.replace(/\s+/g, ' ')
					.trim() ||
				($('meta[name="description"]').attr('content') || '').trim() ||
				'';
		}

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		// 1) JSON API
		try {
			let offset = 0;
			const limit = 100;
			let hasMore = true;
			while (hasMore) {
				const json: any = await this.fetchApiJson(
					`/api/manga/${encodeURIComponent(slug)}/chapters?limit=${limit}&offset=${offset}`
				);
				const rows: any[] = json?.data?.chapters || [];
				for (const row of rows) {
					const chapterSlug = String(row.chapter_slug || '').trim();
					if (!chapterSlug || seen.has(chapterSlug)) continue;
					seen.add(chapterSlug);
					const name = String(row.chapter_name || chapterSlug);
				
					if (/^chapter-0$/i.test(chapterSlug) || chapterSlug === '0') continue;
					let num =
						typeof row.chapter_num === 'number' && !Number.isNaN(row.chapter_num)
							? row.chapter_num
							: this.parseChapterNumber(name);
					if (!num && num !== 0) num = chapters.length + 1;
				
					if (num === 0 && !/chapter\s*0\b/i.test(name)) continue;
					chapters.push({
						id: this.toChapterId(slug, chapterSlug),
						title: name,
						number: num,
						date: this.formatDate(row.updated_at) || undefined
					});
				}
				hasMore =
					Boolean(json?.data?.pagination?.has_more) && rows.length > 0;
				offset += limit;
				if (offset > 5000) break;
			}
		} catch (e) {
			console.error('[mangakakalot] chapters API', e);
		}

		// 2) DOM fallback
		if (chapters.length === 0) {
			$('a[href*="/chapter"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const cm = href.match(/\/manga\/[^/]+\/(chapter-[^/?#]+)/i);
				if (!cm) return;
				const chapterSlug = cm[1];
				if (/^chapter-0$/i.test(chapterSlug)) return;
				if (seen.has(chapterSlug)) return;
				seen.add(chapterSlug);
				const name = ($(a).attr('title') || $(a).text() || chapterSlug)
					.replace(/\s+/g, ' ')
					.trim();
				let num = this.parseChapterNumber(name);
				if (!num && num !== 0) num = chapters.length + 1;
				if (num === 0 && !/chapter\s*0\b/i.test(name)) return;
				chapters.push({
					id: this.toChapterId(slug, chapterSlug),
					title: name,
					number: num
				});
			});
		}

		chapters.sort((a, b) => {
			const na = typeof a.number === 'number' ? a.number : -1;
			const nb = typeof b.number === 'number' ? b.number : -1;
			return nb - na;
		});

		const latestChapter =
			chapters.length > 0 ? String(chapters[0].number) : undefined;

		console.log(
			`[mangakakalot] detail "${title}" chapters=${chapters.length}`
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
			const { slug, chapterSlug } = this.extractChapterPath(chapterId);
			if (!slug || !chapterSlug) return [];

			const path = `/manga/${slug}/${chapterSlug}`;
			const html = await this.fetchHtml(path);

			const pages: string[] = [];
			const seen = new Set<string>();

			const push = (url: string) => {
				if (!url) return;
				const u = this.absUrl(url.split('?')[0]);
				if (!u || seen.has(u)) return;
				if (/thumb\//i.test(u) || /404-avatar|loadingimg|og-image|logo/i.test(u))
					return;
				seen.add(u);
				pages.push(u);
			};

		
			const cdnMatch = html.match(/var\s+cdns\s*=\s*(\[[^\]]+\])/i);
			const imgMatch = html.match(
				/var\s+chapterImages\s*=\s*(\[[^\]]+\])/i
			);
			if (cdnMatch && imgMatch) {
				try {
					const cdns: string[] = JSON.parse(
						cdnMatch[1].replace(/\\'/g, "'")
					);
					const rels: string[] = JSON.parse(
						imgMatch[1].replace(/\\'/g, "'")
					);
					const base = (cdns[0] || '').replace(/\\+/g, '');
					for (const rel of rels) {
						const r = String(rel).replace(/\\+/g, '');
						if (!r) continue;
						if (r.startsWith('http')) push(r);
						else push(base.replace(/\/?$/, '/') + r.replace(/^\//, ''));
					}
				} catch (e) {
					console.error('[mangakakalot] parse cdns/chapterImages', e);
				}
			}

		
			if (pages.length === 0) {
				const $ = cheerio.load(html);
				$('img').each((_, img) => {
					const src =
						$(img).attr('src') ||
						$(img).attr('data-src') ||
						$(img).attr('data-url') ||
						'';
					if (!src || src === '#') return;
					if (
						!/(2xstorage|waitst|mghubcdn|chapter)/i.test(src) &&
						!/\/\d+\.(webp|jpg|png)/i.test(src)
					)
						return;
					push(src);
				});
			}

			if (pages.length === 0) {
				const re =
					/(https?:\/\/(?:storage\d*\.waitst\.com|(?:img-r\d+|imgs-\d+)\.2xstorage\.com)\/[^"'\\\s]+\.(?:webp|jpg|png))/gi;
				let m: RegExpExecArray | null;
				while ((m = re.exec(html)) !== null) {
					push(m[1]);
				}
			}

			
			pages.sort((a, b) => {
				const na = parseInt(
					a.match(/\/(\d+)\.(?:webp|jpg|png)(?:\?|$)/i)?.[1] || '-1',
					10
				);
				const nb = parseInt(
					b.match(/\/(\d+)\.(?:webp|jpg|png)(?:\?|$)/i)?.[1] || '-1',
					10
				);
				return na - nb;
			});

			console.log(
				`[mangakakalot] getChapterPages ${slug}/${chapterSlug} → ${pages.length} pages`
			);
			return pages;
		} catch (e) {
			console.error('[mangakakalot] getChapterPages', e);
			return [];
		}
	}
}

