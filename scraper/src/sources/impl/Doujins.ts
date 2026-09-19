import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';
import https from 'node:https';

/**
 * Doujins.com adapter (gallery-style English doujin site)
 *
 * Domain  : https://doujins.com
 * Latest  : /folders?start=&end= (JSON by day window)
 * Search  : /searches?q={query}
 * Detail  : /{series-slug}/{title-slug}-{id}
 * Pages   : images on gallery page (static.doujins.com/n-*.jpg signed URLs)
 *
 * Each gallery is a single work (like nhentai) → one synthetic chapter "Full".
 *
 * ID format:
 *   manga   : "/{series-slug}/{title-slug}-{id}"
 *   chapter : "/{series-slug}/{title-slug}-{id}/full"
 *
 * Note: site SSL sometimes fails Node strict check → insecure https.Agent
 */
export class DoujinsSource extends BaseSource {
	id = 'doujins';
	name = 'Doujins.com';
	baseUrl = 'https://doujins.com';

	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'en';

	private readonly insecureAgent = new https.Agent({
		rejectUnauthorized: false
	});

	// ── HTTP ─────────────────────────────────────────────────────────────────

	private h(): Record<string, string> {
		return {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
			Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			'Accept-Language': 'en-US,en;q=0.9',
			Referer: `${this.baseUrl}/`,
			Origin: this.baseUrl
		};
	}

	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		return new Promise((resolve, reject) => {
			const req = https.get(
				url,
				{ headers: this.h(), agent: this.insecureAgent },
				(res) => {
					if (
						res.statusCode &&
						res.statusCode >= 300 &&
						res.statusCode < 400 &&
						res.headers.location
					) {
						const next = res.headers.location.startsWith('http')
							? res.headers.location
							: `${this.baseUrl}${res.headers.location}`;
						this.fetchHtml(next).then(resolve).catch(reject);
						return;
					}
					if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
						reject(new Error(`HTTP ${res.statusCode} → ${url}`));
						return;
					}
					const chunks: Buffer[] = [];
					res.on('data', (c) => chunks.push(c));
					res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
					res.on('error', reject);
				}
			);
			req.on('error', reject);
			req.setTimeout(30000, () => {
				req.destroy();
				reject(new Error(`Timeout → ${url}`));
			});
		});
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private absUrl(url: string): string {
		if (!url) return '';
		let u = url.trim().replace(/&amp;/g, '&');
		if (u.startsWith('http')) return u;
		if (u.startsWith('//')) return `https:${u}`;
		return `${this.baseUrl}${u.startsWith('/') ? '' : '/'}${u}`;
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

	private extractNumericId(path: string): string {
		const m = String(path).match(/-(\d+)(?:\/|$)/);
		return m?.[1] || '';
	}

	private slugToTitle(path: string): string {
		const parts = String(path)
			.replace(/^\/+|\/+$/g, '')
			.split('/')
			.filter(Boolean);
		const last = parts[parts.length - 1] || '';
		const withoutId = last.replace(/-\d+$/, '');
		return decodeURIComponent(withoutId)
			.replace(/[-_]+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
			.replace(/\b\w/g, (c) => c.toUpperCase());
	}

	private parseGalleryCards($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		$('a[href]').each((_, el) => {
			const href = $(el).attr('href') || '';

			if (!/^\/[^/]+\/[^/]+-\d+\/?$/.test(href.split('?')[0])) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			const img = $(el).find('img').first();
			let cover =
				img.attr('src') ||
				img.attr('data-src') ||
				img.attr('srcset')?.split(/\s+/)[0] ||
				'';
			cover = this.absUrl(cover);

			const title =
				(img.attr('alt') || '').trim() ||
				$(el).attr('title') ||
				this.slugToTitle(id);

			if (!title) return;

			const numId = this.extractNumericId(id);
			const idNum = numId ? parseInt(numId, 10) : 0;
			res.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type: 'doujinshi',
				status: 'Completed',
				latestChapter: numId ? '1' : undefined,
				lang: this.DEFAULT_LANG,
				updatedAt: idNum > 0 ? 1_700_000_000_000 + idNum * 60_000 : undefined
			});
		});

		return res;
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	private parseFoldersJson(html: string): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		try {
			const json = JSON.parse(html);
			const rows: any[] = Array.isArray(json?.data)
				? json.data
				: Array.isArray(json?.premium)
					? json.premium
					: [];
			for (const row of rows) {
				const link =
					row.link ||
					row.url ||
					(row.token && row.name
						? `/${String(row.name)
								.toLowerCase()
								.replace(/[^a-z0-9]+/g, '-')
								.replace(/-+/g, '-')
								.replace(/^-|-$/g, '')}-${row.id}`
						: '');
				if (!link && !row.id) continue;
				const id = this.cleanId(String(link || `/${row.id}`));
				if (seen.has(id)) continue;
				seen.add(id);

				const title =
					row.name ||
					row.title ||
					this.slugToTitle(id);
				const cover = this.absUrl(
					row.thumbnail2 || row.thumbnail || row.thumb || ''
				);
				let updatedAt: number | undefined;
				if (row.date) {
					const parsed = Date.parse(String(row.date));
					if (!Number.isNaN(parsed)) updatedAt = parsed;
				}

				res.push({
					id,
					title: String(title),
					cover,
					sourceId: this.id,
					type: 'doujinshi',
					status: 'Completed',
					latestChapter: '1',
					lang: this.DEFAULT_LANG,
					updatedAt
				});
			}
			if (res.length) return res;
		} catch {
	
		}

		const linkRe = /"link":"([^"]+)"/g;
		const thumbRe = /"thumbnail2":"([^"]+)"/g;
		const dateRe = /"date":"([^"]+)"/g;

		const links: string[] = [];
		const thumbs: string[] = [];
		const dates: string[] = [];

		let m: RegExpExecArray | null;
		while ((m = linkRe.exec(html)) !== null) {
			links.push(m[1].replace(/\\/g, ''));
		}
		while ((m = thumbRe.exec(html)) !== null) {
			thumbs.push(m[1].replace(/\\/g, '').replace(/\s+2x$/i, '').trim());
		}
		while ((m = dateRe.exec(html)) !== null) {
			dates.push(m[1]);
		}

		for (let i = 0; i < links.length; i++) {
			const href = links[i];
			const id = this.cleanId(href);
			if (seen.has(id)) continue;
			seen.add(id);

			const numId = this.extractNumericId(id);
			const idNum = numId ? parseInt(numId, 10) : 0;

			let updatedAt: number | undefined;
			const dateStr = dates[i];
			if (dateStr) {
				const dm = dateStr.match(
					/([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/
				);
				if (dm) {
					const parsed = Date.parse(`${dm[1]} ${dm[2]}, ${dm[3]}`);
					if (!Number.isNaN(parsed)) updatedAt = parsed;
				}
			}
			if (!updatedAt && idNum > 0) {
				updatedAt = 1_700_000_000_000 + idNum * 60_000;
			}

			res.push({
				id,
				title: this.slugToTitle(id),
				cover: this.absUrl(thumbs[i] || ''),
				sourceId: this.id,
				type: 'doujinshi',
				status: 'Completed',
				latestChapter: numId ? '1' : undefined,
				lang: this.DEFAULT_LANG,
				updatedAt
			});
		}

		return res;
	}

	async getLatestManga(
	page: number,
	_opts?: { lang?: string; type?: string }
): Promise<Manga[]> {
	try {
		const p = Math.max(1, Number(page) || 1);
		const need = p * this.PER_PAGE;
		const daySec = 86400;
		const todayStart = Math.floor(Date.now() / 1000 / daySec) * daySec;

		const all: Manga[] = [];
		const seen = new Set<string>();
		const maxDays = 90; 

		for (let daysBack = 0; daysBack < maxDays && all.length < need; daysBack++) {
			const end = todayStart - daysBack * daySec;
			const start = end - daySec;

			const html = await this.fetchHtml(
				`/folders?start=${start}&end=${end}`
			);
			const list = this.parseFoldersJson(html);

			for (const m of list) {
				if (seen.has(m.id)) continue;
				seen.add(m.id);
				all.push(m);
			}
		}

		all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

		const startIdx = (p - 1) * this.PER_PAGE;
		const list = all.slice(startIdx, startIdx + this.PER_PAGE);

		console.log(
			`[doujins] latest page=${p} → ${list.length} items (scanned ${all.length} total)`
		);
		return list;
	} catch (e) {
		console.error('[doujins] getLatestManga', e);
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
			const path =
				page > 1
					? `/searches?q=${encodeURIComponent(q)}&page=${page}`
					: `/searches?q=${encodeURIComponent(q)}`;
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list = this.parseGalleryCards($)
				.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
				.slice(0, this.PER_PAGE);
			console.log(`[doujins] search "${q}" → ${list.length} items`);
			return list;
		} catch (e) {
			console.error('[doujins] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const id = this.cleanId(mangaId).replace(/\/full$/, '');
		const path = id.endsWith('/') ? id : `${id}/`;
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const pageTitle = $('title').first().text() || '';
		let title = pageTitle
			.replace(/\s*\|\s*Doujins\.com.*$/i, '')
			.replace(/\s+/g, ' ')
			.trim();

		if (title.includes(' - ')) {
			const parts = title.split(' - ');
			if (parts.length >= 2) title = parts.slice(1).join(' - ').trim();
		}
		title = title.replace(/\s+by\s+.+$/i, '').trim() || this.slugToTitle(id);

		let cover = $('meta[property="og:image"]').attr('content') || '';
		if (!cover) {
			const firstN =
				$('img[src*="static.doujins.com/n-"]').first().attr('src') ||
				$('img[data-src*="static.doujins.com/n-"]').first().attr('data-src') ||
				'';
			if (firstN) {
				cover = firstN.replace(
					/static\.doujins\.com\/n-/,
					'static.doujins.com/f2-'
				);
			}
		}
		cover = this.absUrl(cover);

		const folderMsg = $('.folder-message, .folder-display')
			.first()
			.text()
			.replace(/\s+/g, ' ')
			.trim();
		let updatedAt: number | undefined;
		let pageCountFromMsg: number | undefined;
		if (folderMsg) {
			const dm = folderMsg.match(
				/([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/
			);
			if (dm) {
				const parsed = Date.parse(`${dm[1]} ${dm[2]}, ${dm[3]}`);
				if (!Number.isNaN(parsed)) updatedAt = parsed;
			}
			const pm = folderMsg.match(/(\d+)\s*images?/i);
			if (pm) pageCountFromMsg = parseInt(pm[1], 10);
		}

		const metaDesc = ($('meta[name="description"]').attr('content') || '')
			.replace(/\s+/g, ' ')
			.trim();

		const genres: string[] = [];
		const tagsMatch = metaDesc.match(/^Tags?:\s*(.+)$/i);
		if (tagsMatch) {
			tagsMatch[1]
				.split(/,|\band\b/i)
				.map((s) => s.trim())
				.filter((s) => s && s.length < 40)
				.forEach((s) => {
					if (!genres.includes(s)) genres.push(s);
				});
		}
		$('a[href*="/tags/"]').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (t && t.length < 40 && !genres.includes(t)) genres.push(t);
		});

		const description = (
			$('.description, .folder-description').first().text() ||
			folderMsg ||
			''
		)
			.replace(/\s+/g, ' ')
			.trim();

		const authors: string[] = [];
		$('a[href*="/artists/"]').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (t && !authors.includes(t)) authors.push(t);
		});

		const byMatch = pageTitle.match(/\sby\s+([^|<]+)/i);
		if (byMatch && !authors.length) {
			authors.push(byMatch[1].trim());
		}

		const pageImgs = new Set<string>();
		$('img[src*="static.doujins.com/n-"]').each((_, img) => {
			const src = $(img).attr('src');
			if (src) pageImgs.add(src.split('?')[0]);
		});
		const pageCount = pageCountFromMsg || pageImgs.size || undefined;

		const dateStr = updatedAt
			? new Date(updatedAt).toISOString().slice(0, 10)
			: undefined;

		const chapters: Chapter[] = [
			{
				id: `${id}/full`,
				title: pageCount ? `Full (${pageCount} pages)` : 'Full',
				number: 1,
				date: dateStr
			}
		];

		return {
			id,
			sourceId: this.id,
			title,
			cover,
			type: 'doujinshi',
			status: 'Completed',
			latestChapter: pageCount ? String(pageCount) : '1',
			lang: this.DEFAULT_LANG,
			updatedAt,
			description,
			authors,
			genres,
			chapters
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		try {
			const path = this.cleanId(chapterId).replace(/\/full$/, '');
			const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
			const $ = cheerio.load(html);

			const pages: string[] = [];
			const seen = new Set<string>();

			$(
				'img[src*="static.doujins.com/n-"], img[data-src*="static.doujins.com/n-"]'
			).each((_, img) => {
				const src = $(img).attr('src') || $(img).attr('data-src') || '';
				const url = this.absUrl(src);
				if (!url) return;
				const key = url.split('?')[0];
				if (seen.has(key)) return;
				seen.add(key);
				pages.push(url);
			});

			if (pages.length === 0) {
				const re =
					/(https?:\/\/static\.doujins\.com\/n-[a-z0-9]+\.jpg[^"'\\\s]*)/gi;
				let m: RegExpExecArray | null;
				while ((m = re.exec(html)) !== null) {
					const url = this.absUrl(m[1]);
					const key = url.split('?')[0];
					if (seen.has(key)) continue;
					seen.add(key);
					pages.push(url);
				}
			}

			console.log(`[doujins] getChapterPages ${path} → ${pages.length} pages`);
			return pages;
		} catch (e) {
			console.error('[doujins] getChapterPages', e);
			return [];
		}
	}
}
