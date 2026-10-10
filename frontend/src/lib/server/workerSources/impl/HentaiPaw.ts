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
 * ID format:
 *   manga   : "/articles/{id}"
 *   chapter : "/articles/{id}"
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types-manga';
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

		const authors: string[] = [];
		const genres: string[] = [];

		const pushUnique = (arr: string[], v: string) => {
			v = v.replace(/\s+/g, ' ').trim();
			if (v && v.length < 60 && !arr.includes(v) && !/^n\/?a$/i.test(v)) {
				arr.push(v);
			}
		};

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

		let maxPage = 0;
		$('a[href*="viewer"][href*="articleId"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const m = href.match(/[?&]page=(\d+)/i);
			if (m) maxPage = Math.max(maxPage, parseInt(m[1], 10));
		});
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

	private normalizeCdnUrl(u: string): string {
		return u
			.replace(/https?:\/\/web\.archive\.org\/web\/\d+im_\//, '')
			.replace(/\\u0026/g, '&')
			.replace(/\\\//g, '/')
			.split('?')[0]
			.trim();
	}

	private extractViewerImage(html: string, num: string, page: number): string | null {
		const decoded = html
			.replace(/\\u002f/gi, '/')
			.replace(/\\\//g, '/')
			.replace(/\\u0026/g, '&');

		const reFull = new RegExp(
			`https?://cdn\\.imagedeliveries\\.com/${num}/([a-f0-9]{32,64})/(${page})\\.(webp|jpg|jpeg|png)`,
			'i'
		);
		const m1 = decoded.match(reFull);
		if (m1) return this.normalizeCdnUrl(m1[0]);

		const reHashNearPage = new RegExp(
			`["']([a-f0-9]{40})["'][^]{0,80}["']?(?:page|p|n)["']?\\s*[:=]\\s*${page}\\b` +
				`|` +
				`(?:page|p|n)\\s*[:=]\\s*${page}\\b[^]{0,80}["']([a-f0-9]{40})["']`,
			'i'
		);
		const m2 = decoded.match(reHashNearPage);
		if (m2) {
			const hash = m2[1] || m2[2];
			if (hash) return `${this.CDN}/${num}/${hash}/${page}.webp`;
		}

		const reAll = new RegExp(
			`https?://cdn\\.imagedeliveries\\.com/${num}/([a-f0-9]{32,64})/(\\d+)\\.(webp|jpg|jpeg|png)`,
			'gi'
		);
		let match: RegExpExecArray | null;
		while ((match = reAll.exec(decoded)) !== null) {
			if (parseInt(match[2], 10) === page) {
				return this.normalizeCdnUrl(match[0]);
			}
		}

		const $ = cheerio.load(html);
		const candidates: string[] = [];
		const push = (u?: string) => {
			if (!u || u.startsWith('data:')) return;
			u = this.normalizeCdnUrl(this.absUrl(u));
			if (!/^https?:\/\//i.test(u)) return;
			if (/logo|favicon|icon|avatar|banner|ad[-_]|pixel|thumbnail/i.test(u))
				return;
			candidates.push(u);
		};
		push($('meta[property="og:image"]').attr('content'));
		$('img').each((_, img) => {
			const $img = $(img);
			push(
				$img.attr('data-src') ||
					$img.attr('data-full') ||
					$img.attr('data-original') ||
					$img.attr('src')
			);
		});
		const full = candidates.find(
			(u) =>
				u.includes(`imagedeliveries.com/${num}/`) &&
				!/\/thumbnails\//i.test(u)
		);
		if (full) return full;

		const reAny = new RegExp(
			`https?://cdn\\.imagedeliveries\\.com/${num}/(?!thumbnails/)[a-f0-9]{32,64}/\\d+\\.(?:webp|jpg|jpeg|png)`,
			'i'
		);
		const m5 = decoded.match(reAny);
		if (m5) return this.normalizeCdnUrl(m5[0]);

		return null;
	}

	private extractAllFullPages(html: string, num: string): Map<number, string> {
		const map = new Map<number, string>();
		const decoded = html
			.replace(/\\u002f/gi, '/')
			.replace(/\\\//g, '/')
			.replace(/\\u0026/g, '&');

		const re = new RegExp(
			`https?://cdn\\.imagedeliveries\\.com/${num}/([a-f0-9]{32,64})/(\\d+)\\.(webp|jpg|jpeg|png)`,
			'gi'
		);
		let m: RegExpExecArray | null;
		while ((m = re.exec(decoded)) !== null) {
			const page = parseInt(m[2], 10);
			if (!map.has(page)) map.set(page, this.normalizeCdnUrl(m[0]));
		}
		return map;
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		const num = this.articleNum(path);
		if (!num) {
			console.error('[hentaipaw] invalid chapter id', chapterId);
			return [];
		}

		try {
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
			const fromDetail = this.extractAllFullPages(detailHtml, num);
			for (const p of fromDetail.keys()) maxPage = Math.max(maxPage, p);
			if (maxPage < 1) maxPage = 1;

			const limit = Math.min(maxPage, 200);
			const byPage = new Map<number, string>(fromDetail);

			for (let p = 1; p <= limit; p++) {
				if (byPage.has(p)) continue;
				try {
					const vHtml = await this.fetchHtml(
						`/viewer?articleId=${num}&page=${p}`
					);
					const batch = this.extractAllFullPages(vHtml, num);
					for (const [bp, url] of batch) {
						if (!byPage.has(bp)) byPage.set(bp, url);
					}
					if (!byPage.has(p)) {
						const img = this.extractViewerImage(vHtml, num, p);
						if (img && !/\/thumbnails\//i.test(img)) {
							byPage.set(p, img);
						}
					}
				} catch (e) {
					console.warn(`[hentaipaw] viewer page ${p} failed`, e);
				}
			}

			const urls: string[] = [];
			for (let p = 1; p <= limit; p++) {
				const u = byPage.get(p);
				if (u && !/\/thumbnails\//i.test(u)) urls.push(u);
			}

			console.log(
				`[hentaipaw] ${urls.length}/${limit} full pages → ${path}`
			);
			return urls;
		} catch (e) {
			console.error('[hentaipaw] getChapterPages', path, e);
			return [];
		}
	}
}
