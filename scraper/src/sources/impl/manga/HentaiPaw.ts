/**
 * ja.hentaipaw.com adapter (Next.js HTML scrape + CDN images)
 *
 * List   : /  |  /?page={n}          (~40/page → ambil 24)
 * Search : /articles/search?keyword=Q&page={n}
 * Detail : /articles/{id}
 * Viewer : /viewer?articleId={id}&page={n}
 * Cover  : https://cdn.imagedeliveries.com/{id}/thumbnails/cover.webp
 * Pages  : extract dari viewer HTML (CDN imagedeliveries)
 *
 * Satu article = satu gallery (chapter sintetis).
 *
 * ID format:
 *   manga   : "/articles/{id}"
 *   chapter : "/articles/{id}"
 */

import { BaseSource } from '../../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';
import * as cheerio from 'cheerio';

export class HentaiPawSource extends BaseSource {
	id = 'hentaipaw';
	name = 'HentaiPaw';
	baseUrl = 'https://ja.hentaipaw.com';

	private readonly PER_PAGE = 24;
	private readonly LIST_LANG = 'ja';
	private readonly CDN = 'https://cdn.imagedeliveries.com';

	// ── Helpers ──────────────────────────────────────────────────────────────

	private absUrl(url: string): string {
		if (!url) return '';
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
		// /viewer?articleId=123 → /articles/123
		const viewer = id.match(/articleId=(\d+)/i);
		if (viewer) return `/articles/${viewer[1]}`;

		if (!id.startsWith('/')) id = `/${id}`;
		const m = id.match(/^\/articles\/(\d+)/i);
		if (m) return `/articles/${m[1]}`;
		return id.replace(/\/+$/, '') || '/';
	}

	private articleNum(mangaId: string): string | null {
		const m = this.cleanId(mangaId).match(/^\/articles\/(\d+)$/);
		return m?.[1] || null;
	}

	private isMangaPath(id: string): boolean {
		return /^\/articles\/\d+$/.test(this.cleanId(id));
	}

	private coverUrl(num: string): string {
		return `${this.CDN}/${num}/thumbnails/cover.webp`;
	}

	// ── List ─────────────────────────────────────────────────────────────────

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		$('a[href*="/articles/"]').each((_, el) => {
			const $a = $(el);
			const href = $a.attr('href') || '';
			const id = this.cleanId(href);
			if (!this.isMangaPath(id) || seen.has(id)) return;

			// skip nav links like /articles/rank /articles/search
			if (!/\/articles\/\d+/.test(id)) return;
			seen.add(id);

			const num = this.articleNum(id)!;
			const title = (
				$a.find('img').attr('alt') ||
				$a.attr('title') ||
				$a.text() ||
				''
			)
				.replace(/,\s*日本語\s*$/i, '')
				.replace(/,\s*Japanese\s*$/i, '')
				.replace(/\s+/g, ' ')
				.trim();
			if (!title || title.length < 1) return;

			const imgSrc =
				$a.find('img').attr('src') ||
				$a.find('img').attr('data-src') ||
				'';
			let cover = imgSrc;
			if (!cover || /logo|favicon|ad|banner/i.test(cover)) {
				cover = this.coverUrl(num);
			} else {
				cover = this.absUrl(cover.split('?')[0]);
				// unwrap archive / relative
				cover = cover.replace(
					/https?:\/\/web\.archive\.org\/web\/\d+im_\//,
					''
				);
			}

			out.push({
				id,
				sourceId: this.id,
				title,
				cover,
				type: 'manga',
				status: 'Completed',
				latestChapter: 1,
				lang: this.LIST_LANG
			});
		});

		return out;
	}

	private async fetchListPage(path: string): Promise<Manga[]> {
		try {
			const html = await this.fetchHtml(path);
			if (!html || html.length < 500) {
				console.warn('[hentaipaw] empty html', path);
				return [];
			}
			// Cloudflare challenge?
			if (/just a moment|cf-browser-verification|attention required/i.test(html.slice(0, 3000))) {
				console.warn('[hentaipaw] CF challenge', path);
				return [];
			}
			const $ = cheerio.load(html);
			const list = this.parseCards($);
			console.log(`[hentaipaw] ${path} → ${list.length}`);
			return list;
		} catch (e) {
			console.warn('[hentaipaw] fetchListPage', path, e);
			return [];
		}
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const path = p <= 1 ? `/` : `/?page=${p}`;
			const list = await this.fetchListPage(path);
			const sliced = list.slice(0, this.PER_PAGE);
			console.log(`[hentaipaw] latest page=${p} → ${sliced.length}`);
			return sliced;
		} catch (e) {
			console.error('[hentaipaw] getLatestManga', e);
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
			const path = `/articles/search?keyword=${encodeURIComponent(q)}&page=${page}`;
			const list = await this.fetchListPage(path);
			console.log(`[hentaipaw] search "${q}" page=${page} → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[hentaipaw] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const path = this.cleanId(mangaId);
		const num = this.articleNum(path);
		if (!num) throw new Error(`Invalid hentaipaw id: ${mangaId}`);

		const html = await this.fetchHtml(`/articles/${num}`);
		const $ = cheerio.load(html);

		let title =
			$('h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content') ||
			$('title').text().trim() ||
			num;
		title = title
			.replace(/\s*[-|].*エロモフ.*$/i, '')
			.replace(/\s*[-|].*HentaiPaw.*$/i, '')
			.replace(/\s+/g, ' ')
			.trim();

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$(`img[src*="/${num}/thumbnails/cover"]`).attr('src') ||
			this.coverUrl(num);
		cover = this.absUrl((cover || '').split('?')[0]).replace(
			/https?:\/\/web\.archive\.org\/web\/\d+im_\//,
			''
		);

		// Meta fields (JP labels)
		const authors: string[] = [];
		const genres: string[] = [];

		const pushUnique = (arr: string[], v: string) => {
			v = v.replace(/\s+/g, ' ').trim();
			if (v && v.length < 60 && !arr.includes(v) && !/^n\/?a$/i.test(v)) {
				arr.push(v);
			}
		};

		// Parse label : value blocks from text + links
		$('a[href*="/artists/"]').each((_, a) => {
			pushUnique(authors, $(a).text());
		});
		$('a[href*="/circles/"], a[href*="/groups/"]').each((_, a) => {
			pushUnique(authors, $(a).text());
		});
		$('a[href*="/tags/"]').each((_, a) => {
			pushUnique(genres, $(a).text());
		});
		$('a[href*="/categories/"], a[href*="/category/"]').each((_, a) => {
			pushUnique(genres, $(a).text());
		});
		$('a[href*="/parodies/"], a[href*="/characters/"]').each((_, a) => {
			pushUnique(genres, $(a).text());
		});

		// Fallback text parse
		const bodyText = $('body').text().replace(/\s+/g, ' ');
		const langMatch = bodyText.match(
			/(?:作品言語|Language)\s*[:：]\s*([^\s:：]+)/i
		);
		const language = langMatch?.[1]?.trim() || '日本語';

		const catMatch = bodyText.match(
			/(?:カテゴリー|Category)\s*[:：]\s*([^\n]+?)(?=\s*(?:読む|Read|Artists|作者|$))/i
		);
		if (catMatch) pushUnique(genres, catMatch[1]);

		let description =
			$('meta[name="description"]').attr('content') ||
			$('meta[property="og:description"]').attr('content') ||
			'';
		description = description.replace(/\s+/g, ' ').trim();

		const metaLines: string[] = [];
		if (authors.length) metaLines.push(`Artist: ${authors.join(', ')}`);
		if (language) metaLines.push(`Language: ${language}`);
		if (metaLines.length) {
			description = [description, metaLines.join('\n')]
				.filter(Boolean)
				.join('\n\n');
		}

		// Page count dari viewer links di detail
		let maxPage = 0;
		$('a[href*="viewer"][href*="articleId"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const m = href.match(/[?&]page=(\d+)/i);
			if (m) maxPage = Math.max(maxPage, parseInt(m[1], 10));
		});
		// juga dari thumbnail numbering
		$(`img[src*="/${num}/thumbnails/"]`).each((_, img) => {
			const src = $(img).attr('src') || '';
			const m = src.match(/thumbnails\/(\d+)\./i);
			if (m) maxPage = Math.max(maxPage, parseInt(m[1], 10));
		});
		if (maxPage < 1) maxPage = 1;

		const chapters: Chapter[] = [
			{
				id: path,
				title: 'Chapter 1',
				number: 1,
				isLocked: false
			}
		];

		console.log(
			`[hentaipaw] details ${path} → pages≈${maxPage} genres=${genres.length} authors=${authors.length}`
		);

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			type: 'manga',
			status: 'Completed',
			description,
			authors,
			genres,
			chapters,
			latestChapter: 1,
			lang: this.LIST_LANG
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	private extractViewerImage(html: string, num: string): string | null {
		const $ = cheerio.load(html);

		const candidates: string[] = [];
		const push = (u?: string) => {
			if (!u || u.startsWith('data:')) return;
			u = this.absUrl(u.split('?')[0]).replace(
				/https?:\/\/web\.archive\.org\/web\/\d+im_\//,
				''
			);
			if (!/^https?:\/\//i.test(u)) return;
			if (/logo|favicon|icon|avatar|banner|ad[-_]|pixel/i.test(u)) return;
			candidates.push(u);
		};

		push($('meta[property="og:image"]').attr('content'));
		$('img').each((_, img) => {
			const $img = $(img);
			push(
				$img.attr('data-src') ||
					$img.attr('data-full') ||
					$img.attr('src')
			);
		});

		// Prefer non-thumbnail CDN for this article
		const full = candidates.find(
			(u) =>
				u.includes(`imagedeliveries.com/${num}/`) &&
				!/\/thumbnails\//i.test(u)
		);
		if (full) return full;

		const anyCdn = candidates.find((u) =>
			u.includes(`imagedeliveries.com/${num}/`)
		);
		if (anyCdn) return anyCdn;

		// Regex fallback
		const re = new RegExp(
			`https?://cdn\\.imagedeliveries\\.com/${num}/(?!thumbnails/)[^"'\\s]+`,
			'i'
		);
		const m = html.match(re);
		if (m) return m[0].replace(/\\u0026/g, '&').split('?')[0];

		const reThumb = new RegExp(
			`https?://cdn\\.imagedeliveries\\.com/${num}/thumbnails/\\d+\\.(?:webp|jpg|jpeg|png)`,
			'i'
		);
		const m2 = html.match(reThumb);
		if (m2) return m2[0];

		return null;
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		const num = this.articleNum(path);
		if (!num) {
			console.error('[hentaipaw] invalid chapter id', chapterId);
			return [];
		}

		try {
			// 1) Hitung total page dari detail
			const detailHtml = await this.fetchHtml(`/articles/${num}`);
			const $d = cheerio.load(detailHtml);
			let maxPage = 0;
			$d('a[href*="viewer"][href*="articleId"]').each((_, a) => {
				const href = $d(a).attr('href') || '';
				const m = href.match(/[?&]page=(\d+)/i);
				if (m) maxPage = Math.max(maxPage, parseInt(m[1], 10));
			});
			$d(`img[src*="/${num}/thumbnails/"]`).each((_, img) => {
				const src = $d(img).attr('src') || '';
				const m = src.match(/thumbnails\/(\d+)\./i);
				if (m) maxPage = Math.max(maxPage, parseInt(m[1], 10));
			});
			if (maxPage < 1) maxPage = 1;

			// 2) Ambil gambar per halaman viewer (max 200 biar aman)
			const limit = Math.min(maxPage, 200);
			const urls: string[] = [];
			const seen = new Set<string>();

			for (let p = 1; p <= limit; p++) {
				try {
					const vHtml = await this.fetchHtml(
						`/viewer?articleId=${num}&page=${p}`
					);
					const img = this.extractViewerImage(vHtml, num);
					if (img && !seen.has(img)) {
						seen.add(img);
						urls.push(img);
					} else if (!img) {
						// fallback thumbnail
						const thumb = `${this.CDN}/${num}/thumbnails/${p}.webp`;
						if (!seen.has(thumb)) {
							seen.add(thumb);
							urls.push(thumb);
						}
					}
				} catch (e) {
					console.warn(`[hentaipaw] viewer page ${p} failed`, e);
					// fallback thumbnail
					const thumb = `${this.CDN}/${num}/thumbnails/${p}.webp`;
					if (!seen.has(thumb)) {
						seen.add(thumb);
						urls.push(thumb);
					}
				}
			}

			console.log(`[hentaipaw] ${urls.length} pages → ${path}`);
			return urls;
		} catch (e) {
			console.error('[hentaipaw] getChapterPages', path, e);
			return [];
		}
	}
}
