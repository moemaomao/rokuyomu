/**
 * Demonic Scans / Manga Demon adapter (https://demonicscans.org)
 *
 * Custom PHP site (bukan Madara/Themesia).
 *
 * Latest  : /lastupdates.php?list={page}
 * Search  : /search.php?manga={q}
 * Detail  : /manga/{slug}
 * Chapter : /chaptered.php?manga={id}&chapter={n}
 * Pages   : img.imgholder → cdn.demoniclibs.com / librarydm.com
 *
 * ID format:
 *   manga   : "/manga/{slug}"
 *   chapter : "/chaptered.php?manga={mangaId}&chapter={chapterNum}"
 *
 * SSL: kalau CERT_HAS_EXPIRED di Node scraper, jalankan dengan:
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx src/index.ts
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class DemonicScansSource extends BaseSource {
	id = 'demonicscans';
	name = 'Demonic Scans';
	baseUrl = 'https://demonicscans.org';

	private readonly DEFAULT_LANG = 'en';

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
				const u = new URL(id);
				id = u.pathname + u.search;
			} catch {
				/* ignore */
			}
		}
		if (!id.startsWith('/')) id = `/${id}`;
		return id.replace(/\/+$/, '') || '/';
	}

	private decodeHtml(s: string): string {
		return String(s || '')
			.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
			.replace(/&#x([0-9a-f]+);/gi, (_, h) =>
				String.fromCharCode(parseInt(h, 16))
			)
			.replace(/%2527/gi, "'")
			.replace(/%27/gi, "'")
			.replace(/%2528/gi, '(')
			.replace(/%2529/gi, ')')
			.replace(/%252C/gi, ',')
			.replace(/&amp;/g, '&')
			.replace(/&quot;/g, '"')
			.replace(/&#039;/g, "'")
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&nbsp;/g, ' ')
			.trim();
	}

	private normalizeTitle(raw: string): string {
		if (!raw) return '';
		return this.decodeHtml(raw)
			.replace(/\s+/g, ' ')
			.replace(/\s*[-|]\s*(Demonic\s*Scans|Manga\s*Demon).*$/i, '')
			.trim();
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromQuery = path.match(/[?&]chapter=(\d+(?:\.\d+)?)/i);
		if (fromQuery) return parseFloat(fromQuery[1]);

		const m = String(text).match(
			/(?:chapter|chap|ch\.?)\s*(\d+)(?:[.,](\d+))?/i
		);
		if (m) {
			if (m[2] != null) return parseFloat(`${m[1]}.${m[2]}`);
			return parseInt(m[1], 10);
		}
		const n = String(text).match(/\b(\d+(?:\.\d+)?)\b/);
		return n ? parseFloat(n[1]) : 0;
	}

	private extractMangaNumericId(htmlOrHref: string): string {
		const m =
			htmlOrHref.match(/chaptered\.php\?manga=(\d+)/i) ||
			htmlOrHref.match(/bookMark\((\d+)\)/i) ||
			htmlOrHref.match(/manga[=:](\d+)/i);
		return m?.[1] || '';
	}

	private mapStatus(raw: string): string {
		const s = String(raw || '').toLowerCase();
		if (/complete|end|finished/.test(s)) return 'Completed';
		if (/hiatus/.test(s)) return 'Hiatus';
		if (/drop|cancel/.test(s)) return 'Dropped';
		return 'Ongoing';
	}

	// ── Catalog parsers ──────────────────────────────────────────────────────

	private parseUpdateCards($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		$('.updates-element').each((_, el) => {
			const $el = $(el);
			const $a = $el
				.find('a[href*="/manga/"]')
				.filter((_, a) => {
					const h = ($(a).attr('href') || '').split('?')[0];
					return /\/manga\/[^/]+\/?$/.test(h);
				})
				.first();

			const href = $a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href).split('?')[0];
			if (seen.has(id)) return;
			seen.add(id);

			let title =
				$a.attr('title') ||
				$el.find('h2 a, h2').first().text() ||
				$el.find('img').attr('alt') ||
				'';
			title = this.normalizeTitle(title.split(';;')[0] || title);
			if (!title) return;

			const $img = $el.find('.thumb img, img').first();
			const cover = this.absUrl(
				$img.attr('data-src') || $img.attr('src') || ''
			);

			let latestChapter: string | undefined;
			const chText = $el
				.find('a[href*="chaptered.php"]')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			if (chText) {
				const n = this.parseChapterNumber(chText);
				if (n > 0) latestChapter = String(n);
			}

			res.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type: 'manhwa',
				status: 'Ongoing',
				latestChapter,
				lang: this.DEFAULT_LANG
			});
		});

		return res;
	}

	private parseSearchResults($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		$('a[href*="/manga/"]').each((_, a) => {
			const $a = $(a);
			const href = ($a.attr('href') || '').split('?')[0];
			if (!/\/manga\/[^/]+\/?$/.test(href)) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			let title =
				$a.find('div').first().text() ||
				$a.attr('title') ||
				$a.text() ||
				'';
			title = this.normalizeTitle(title.split(';;')[0] || title);
			if (!title || title.length < 2) return;

			const $img = $a.find('img').first();
			const cover = this.absUrl(
				$img.attr('data-src') || $img.attr('src') || ''
			);

			res.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type: 'manhwa',
				status: 'Ongoing',
				lang: this.DEFAULT_LANG
			});
		});

		return res;
	}

	// ── API methods ──────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const path =
				p <= 1 ? '/lastupdates.php' : `/lastupdates.php?list=${p}`;
			const html = await this.fetchHtml(path);
			const list = this.parseUpdateCards(cheerio.load(html));
			console.log(`[demonicscans] latest page=${p} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[demonicscans] getLatestManga', e);
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
			const html = await this.fetchHtml(
				`/search.php?manga=${encodeURIComponent(q)}`
			);
			const list = this.parseSearchResults(cheerio.load(html));
			console.log(
				`[demonicscans] search "${q}" page=${page} → ${list.length}`
			);
			return list;
		} catch (e) {
			console.error('[demonicscans] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		let path = this.cleanId(mangaId).split('?')[0];
		if (!path.startsWith('/manga/')) {
			path = `/manga/${path.replace(/^\//, '')}`;
		}

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title = this.normalizeTitle(
			$('h1.big-fat-titles, h1').first().text() ||
				$('meta[property="og:title"]').attr('content') ||
				''
		);

		let cover =
			$('#manga-page img, .manga-info-container img, img.border-box')
				.first()
				.attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = this.absUrl(cover);

		let description = '';
		$('#manga-info-container, #manga-page')
			.parent()
			.find('p, div')
			.each((_, el) => {
				const t = $(el).text().replace(/\s+/g, ' ').trim();
				if (
					t.length > description.length &&
					t.length > 40 &&
					t.length < 2000
				) {
					description = t;
				}
			});
		description = this.decodeHtml(description);

		const genres: string[] = [];
		$('a[href*="genre"], a[href*="advanced"]').each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (g && g.length < 30 && !genres.includes(g)) genres.push(g);
		});

		let status = 'Ongoing';
		const bodyText = $.text();
		const statusMatch = bodyText.match(
			/Status\s*[:\-]?\s*(Ongoing|Completed|Hiatus|Dropped)/i
		);
		if (statusMatch) status = this.mapStatus(statusMatch[1]);

		const authors: string[] = [];
		const authorMatch = bodyText.match(
			/Author\s*[:\-]?\s*([^\n|]{2,60})/i
		);
		if (authorMatch) {
			const name = authorMatch[1].replace(/\s+/g, ' ').trim();
			if (name && name.length < 80) authors.push(name);
		}

		const numericId = this.extractMangaNumericId(html);
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('a.chplinks, a[href*="chaptered.php"]').each((_, a) => {
			const $a = $(a);
			const href = ($a.attr('href') || '').trim();
			if (!href || !/chaptered\.php/i.test(href)) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			const rawText = $a.text().replace(/\s+/g, ' ').trim();
			const number = this.parseChapterNumber(rawText || id, id);
			if (!Number.isFinite(number)) return;

			chapters.push({
				id,
				title: rawText || `Chapter ${number}`,
				number
			});
		});

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));
		const latestChapter =
			chapters.length > 0 ? String(chapters[0].number) : undefined;

		console.log(
			`[demonicscans] details ${path} mangaId=${numericId} → ch=${chapters.length}`
		);

		return {
			id: path,
			sourceId: this.id,
			title: title || path.split('/').filter(Boolean).pop() || path,
			cover,
			type: 'manhwa',
			status,
			description,
			authors,
			genres,
			chapters,
			latestChapter,
			lang: this.DEFAULT_LANG
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		try {
			const path = this.cleanId(chapterId);
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);

			const pages: string[] = [];
			const seen = new Set<string>();

			const push = (src?: string | null) => {
				if (!src || src.startsWith('data:')) return;
				let url = this.absUrl(src.split(/\s+/)[0]);
				url = url.replace('demoniclibs.com', 'librarydm.com');
				if (!url || seen.has(url)) return;
				if (
					/logo|icon|avatar|emoji|favicon|free_ads|paypal|userpics|flaticon/i.test(
						url
					)
				)
					return;
				seen.add(url);
				pages.push(url);
			};

			$(
				'img.imgholder, img[class*="imgholder"], #gotopreader ~ img, img[onload*="delay"]'
			).each((_, img) => {
				const $img = $(img);
				push($img.attr('data-src') || $img.attr('src'));
			});

			if (pages.length === 0) {
				const re =
					/(https?:\/\/(?:cdn\.)?(?:demoniclibs|librarydm)\.com\/[^"'\\\s]+\.(?:jpg|jpeg|png|webp|avif))/gi;
				let m: RegExpExecArray | null;
				while ((m = re.exec(html)) !== null) {
					push(m[1]);
				}
			}

			console.log(
				`[demonicscans] getChapterPages ${path} → ${pages.length} pages`
			);
			return pages;
		} catch (e) {
			console.error('[demonicscans] getChapterPages', e);
			return [];
		}
	}
}
