/**
 * Raven Scans adapter (https://ravenscans.org)
 * Theme: WordPress Themesia / mangareader
 *
 * Latest  : /manga/?page=N&order=update
 * Search  : /?s={query}&page=N
 * Detail  : /manga/{slug}/
 * Chapter : /{slug}-chapter-{n}/   (images inside #readerarea noscript / ts_reader)
 *
 * ID format:
 *   manga   : "/manga/{slug}"
 *   chapter : "/{slug}-chapter-{n}"
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class RavenScansSource extends BaseSource {
	id = 'ravenscans';
	name = 'Raven Scans';
	baseUrl = 'https://ravenscans.org';

	private readonly PER_PAGE = 35;
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
				id = new URL(id).pathname;
			} catch {
				/* ignore */
			}
		}
		if (!id.startsWith('/')) id = `/${id}`;
		return id.replace(/\/+$/, '').split('?')[0] || '/';
	}

	private decodeHtml(s: string): string {
		return String(s || '')
			.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
			.replace(/&#x([0-9a-f]+);/gi, (_, h) =>
				String.fromCharCode(parseInt(h, 16))
			)
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
			.replace(/\s*[-|]\s*Raven\s*Scans.*$/i, '')
			.trim();
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath = path.match(/chapter[_-]?(\d+)(?:[.-](\d+))?/i);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null && fromPath[2].length <= 2) {
				return parseFloat(`${major}.${fromPath[2]}`);
			}
			return major;
		}
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

	private preferFullCover(url: string): string {
		if (!url) return '';
		return url.replace(/-\d+x\d+(\.\w+)(\?.*)?$/, '$1$2');
	}

	private mangaSlug(mangaId: string): string {
		const id = this.cleanId(mangaId);
		const parts = id.split('/').filter(Boolean);

		if (parts[0] === 'manga' && parts[1]) return parts[1];
		return parts[parts.length - 1] || '';
	}

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();
		const cards = $('div.listupd div.bsx, .postbody div.bsx, div.bsx');
		cards.each((_, card) => {
			const $card = $(card);
			const a = $card
				.find('a[href*="/manga/"]')
				.filter((_, el) => {
					const h = ($(el).attr('href') || '').split('?')[0];
					return /\/manga\/[^/]+\/?$/.test(h);
				})
				.first();

			const href = a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			let title =
				a.attr('title') ||
				$card.find('.tt a, .tt').first().text() ||
				$card.find('img').first().attr('alt') ||
				'';
			title = this.normalizeTitle(title);
			if (!title) return;

			const img = $card.find('img').first();
			let cover =
				img.attr('data-src') ||
				img.attr('data-lazy-src') ||
				img.attr('src') ||
				'';
			cover = this.preferFullCover(this.absUrl(cover));

			const epxs = $card.find('.epxs, .fivchap, .chfiv').first().text();
			const latestChapter = epxs
				? String(
						this.parseChapterNumber(epxs) ||
							epxs.replace(/\s+/g, ' ').trim()
					)
				: undefined;

			const typeText = $card.text().toLowerCase();
			let type = 'manhwa';
			if (/\bmanhua\b/.test(typeText)) type = 'manhua';
			else if (/\bmanga\b/.test(typeText) && !/\bmanhwa\b/.test(typeText))
				type = 'manga';

			res.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type,
				status: 'Ongoing',
				latestChapter,
				lang: this.DEFAULT_LANG
			});
		});

		return res;
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const html = await this.fetchHtml(
				`/manga/?page=${p}&order=update`
			);
			const $ = cheerio.load(html);
			const list = this.parseCards($);
			console.log(`[ravenscans] latest page=${p} → ${list.length} items`);
			return list;
		} catch (e) {
			console.error('[ravenscans] getLatestManga', e);
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
					? `/?s=${encodeURIComponent(q)}&page=${page}`
					: `/?s=${encodeURIComponent(q)}`;
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list = this.parseCards($);
			console.log(`[ravenscans] search "${q}" page=${page} → ${list.length} items`);
			return list;
		} catch (e) {
			console.error('[ravenscans] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const id = this.cleanId(mangaId);
		const html = await this.fetchHtml(id.endsWith('/') ? id : `${id}/`);
		const $ = cheerio.load(html);
		const slug = this.mangaSlug(id);

		const title = this.normalizeTitle(
			$('h1.entry-title, h1').first().text() ||
				$('meta[property="og:title"]').attr('content') ||
				''
		);

		let cover =
			$('.thumb img, .seriestuimg img, .infomanga img, img.wp-post-image')
				.first()
				.attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = this.preferFullCover(this.absUrl(cover));

		const description = this.decodeHtml(
			$('.entry-content, .desc, .seriestucontent .entry-content')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim()
		);

		const genres: string[] = [];
		$('a[href*="/genres/"]').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (t && !genres.includes(t)) genres.push(t);
		});

		let status = 'Ongoing';
		$('.imptdt, .infotable tr, .fmed').each((_, el) => {
			const text = $(el).text().replace(/\s+/g, ' ').trim();
			if (/status/i.test(text)) {
				if (/complet/i.test(text)) status = 'Completed';
				else if (/hiatus/i.test(text)) status = 'Hiatus';
				else if (/drop|cancel/i.test(text)) status = 'Dropped';
			}
		});

		const authors: string[] = [];
		$('.fmed, .imptdt, .infotable tr').each((_, el) => {
			const text = $(el).text().replace(/\s+/g, ' ').trim();
			if (/author|artist/i.test(text)) {
				const val = text
					.replace(/author|artist/gi, '')
					.replace(/\s+/g, ' ')
					.trim();
				if (val && val.length < 80) authors.push(val);
			}
		});

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('#chapterlist li, .eplister li, #chapterlist ul li').each((_, li) => {
			const $li = $(li);
			const a = $li.find('a').first();
			const href = (a.attr('href') || '').trim();

			const dataNum = $li.attr('data-num') || '';
			const numText =
				$li.find('.chapternum').text() ||
				a.attr('data-title') ||
				a.text() ||
				dataNum;

			const isPaid =
				$li.find('.fa-coins, .ath-lock, [class*="coin"]').length > 0 ||
				!!a.attr('data-coin') ||
				a.attr('data-bs-target') === '#lockedChapterModal' ||
				/coin|premium|paid/i.test($li.text());

			let chId: string;
			if (href && !href.startsWith('#') && !/javascript:/i.test(href)) {
				chId = this.cleanId(href);
			} else if (slug && (dataNum || numText)) {
				const n = dataNum || String(this.parseChapterNumber(numText));
				const pathNum = String(n).replace(/\./g, '-');
				chId = `/${slug}-chapter-${pathNum}`;
			} else {
				return;
			}

			if (seen.has(chId)) return;
			seen.add(chId);

			const number =
				(dataNum ? parseFloat(dataNum) : 0) ||
				this.parseChapterNumber(numText, chId);

			const date = $li
				.find('.chapterdate')
				.text()
				.replace(/\s+/g, ' ')
				.trim();

			const titleBase =
				(numText || `Chapter ${number}`).replace(/\s+/g, ' ').trim();

			chapters.push({
				id: chId,
				title: isPaid ? `${titleBase} 🔒` : titleBase,
				number: number || chapters.length + 1,
				date: date || undefined
			});
		});

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const latestChapter =
			chapters.length > 0 ? String(chapters[0].number) : undefined;

		return {
			id,
			sourceId: this.id,
			title: title || slug || id,
			cover,
			type: 'manhwa',
			status,
			latestChapter,
			lang: this.DEFAULT_LANG,
			description,
			authors: [...new Set(authors)],
			genres,
			chapters
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		try {
			const path = this.cleanId(chapterId);
			const html = await this.fetchHtml(
				path.endsWith('/') ? path : `${path}/`
			);
			const $ = cheerio.load(html);

			const pages: string[] = [];
			const seen = new Set<string>();

			const push = (src?: string | null) => {
				if (!src) return;
				if (src.startsWith('data:')) return;
				const url = this.absUrl(src.split('?')[0]);
				if (!url || seen.has(url)) return;
				if (/logo|icon|avatar|emoji|favicon|spinner|loading/i.test(url)) return;
				seen.add(url);
				pages.push(url);
			};

			$('#readerarea img, .readerarea img, #reader img, #readerarea noscript img').each(
				(_, img) => {
					const $img = $(img);
					push(
						$img.attr('data-src') ||
							$img.attr('data-lazy-src') ||
							$img.attr('src')
					);
				}
			);

			if (pages.length === 0) {
				const noscript = $('#readerarea noscript').html() || '';
				if (noscript) {
					const $ns = cheerio.load(noscript);
					$ns('img').each((_, img) => {
						push($ns(img).attr('src') || $ns(img).attr('data-src'));
					});
				}
			}

			if (pages.length === 0) {
				const re =
					/(https?:\/\/cdn\d*\.ravenscans\.(?:org|net)\/[^"'\\\s]+\.(?:webp|jpg|jpeg|png|avif))/gi;
				let m: RegExpExecArray | null;
				while ((m = re.exec(html)) !== null) {
					push(m[1]);
				}
			}

			if (pages.length === 0) {
				const re =
					/(https?:\/\/[^"'\\\s]+\/(?:wp-content\/uploads\/manga|cdn)\/[^"'\\\s]+\.(?:webp|jpg|jpeg|png|avif))/gi;
				let m: RegExpExecArray | null;
				while ((m = re.exec(html)) !== null) {
					push(m[1]);
				}
			}

			console.log(
				`[ravenscans] getChapterPages ${path} → ${pages.length} pages`
			);
			return pages;
		} catch (e) {
			console.error('[ravenscans] getChapterPages', e);
			return [];
		}
	}
}
