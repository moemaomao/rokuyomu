/**
 * Rokari Comics adapter (rokaricomics.com)
 *
 * Theme     : WordPress MangaNova / Themesia
 * Latest    : GET /manga/?order=update&page=N  (~36 cards → slice 24)
 * Search    : GET /?s={q}  /  /page/N/?s={q}
 * Detail    : GET /manga/{slug}/
 * Chapter   : GET /{slug}-chapter-{n}/
 * Pages     : #readerarea img[src]
 *
 * List cards: .bsx → title, cover, .epxs chapter badge
 * Chapters  : #chapterlist li a  (title cleaned to "Chapter N")
 * Locked    : none observed (all free)
 *
 * ID format:
 *   manga   : /manga/{slug}
 *   chapter : /{slug}-chapter-{n}
 */

import { BaseSource } from '../../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';
import * as cheerio from 'cheerio';

export class RokariComicsSource extends BaseSource {
	id = 'rokaricomics';
	name = 'Rokari Comics';
	baseUrl = 'https://rokaricomics.com';
	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'en';

	protected override async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const res = await fetch(url, {
			headers: {
				...this.headers,
				Referer: `${this.baseUrl}/`,
				Accept:
					'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
			},
			redirect: 'follow'
		});
		if (!res.ok) {
			throw new Error(`RokariComics HTTP ${res.status} → ${url}`);
		}
		return await res.text();
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private absUrl(href: string): string {
		if (!href) return '';
		if (href.startsWith('http')) return href;
		if (href.startsWith('//')) return `https:${href}`;
		return `${this.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
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
		return id.replace(/\/+$/, '') || '/';
	}

	private extractSlug(mangaId: string): string {
		let p = this.cleanId(mangaId);
		p = p.replace(/-chapter-[\d.]+$/i, '');
		const m = p.match(/^\/manga\/([^/]+)/i);
		if (m?.[1]) return m[1];
		const bare = p.replace(/^\//, '').split('/')[0] || '';
		return bare.replace(/-chapter-[\d.]+$/i, '');
	}

	private parseChapterNumber(text: string): number {
		const s = String(text || '');
		const m =
			s.match(/chapter[\s_-]*(\d+(?:\.\d+)?)/i) ||
			s.match(/\bch\.?\s*(\d+(?:\.\d+)?)/i) ||
			s.match(/(\d+(?:\.\d+)?)/);
		return m ? parseFloat(m[1]) : 0;
	}

	private mapStatus(raw: string): string {
		const s = (raw || '').toLowerCase();
		if (/complet|finished|end/.test(s)) return 'Completed';
		if (/hiatus|pause/.test(s)) return 'Hiatus';
		if (/drop|cancel/.test(s)) return 'Dropped';
		return 'Ongoing';
	}

	private mapType(raw: string): string {
		const s = (raw || '').toLowerCase();
		if (/\bmanhua\b/.test(s)) return 'manhua';
		if (/\bmanga\b/.test(s) && !/\bmanhwa\b/.test(s)) return 'manga';
		if (/\bnovel\b/.test(s)) return 'novel';
		return 'manhwa';
	}

	private parseListCards(html: string): Manga[] {
		const $ = cheerio.load(html);
		const res: Manga[] = [];
		const seen = new Set<string>();

		$('.bsx').each((_, el) => {
			if (res.length >= this.PER_PAGE) return false;
			const $card = $(el);
			const $a = $card.find('a[href*="/manga/"]').first();
			const href = $a.attr('href') || '';
			const id = this.cleanId(href);
			if (!/^\/manga\/[^/]+$/i.test(id)) return;
			if (seen.has(id)) return;
			seen.add(id);

			const title = (
				$a.attr('title') ||
				$card.find('.tt').first().text() ||
				$card.find('img').attr('alt') ||
				''
			)
				.replace(/\s+/g, ' ')
				.trim();
			if (!title || title.length < 2) return;

			const img = $card.find('img').first();
			const cover = this.absUrl(
				img.attr('src') ||
					img.attr('data-src') ||
					(img.attr('srcset') || '').split(/[,\s]/)[0] ||
					''
			);

			const epxs = $card.find('.epxs').first().text().replace(/\s+/g, ' ').trim();
			const chNum = this.parseChapterNumber(epxs);
			const latestChapter = chNum > 0 ? String(chNum) : undefined;

			res.push({
				id,
				sourceId: this.id,
				title,
				cover,
				type: 'manhwa',
				status: 'Ongoing',
				lang: this.DEFAULT_LANG,
				latestChapter
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
			const path =
				p <= 1
					? '/manga/?order=update'
					: `/manga/?page=${p}&order=update`;
			const html = await this.fetchHtml(path);
			const list = this.parseListCards(html);
			console.log(`[rokaricomics] latest page=${p} → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[rokaricomics] getLatestManga', e);
			return [];
		}
	}

	async searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, Number(opts?.page) || 1);
		if (!q) return this.getLatestManga(page);

		try {
			const encoded = encodeURIComponent(q);
			const path =
				page <= 1 ? `/?s=${encoded}` : `/page/${page}/?s=${encoded}`;
			const html = await this.fetchHtml(path);
			const list = this.parseListCards(html);
			console.log(`[rokaricomics] search "${q}" page=${page} → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[rokaricomics] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) throw new Error(`Invalid rokaricomics id: ${mangaId}`);

		const path = `/manga/${slug}/`;
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title = (
			$('h1.entry-title').first().text() ||
			$('h1').first().text() ||
			slug
		)
			.replace(/\s+/g, ' ')
			.trim();

		const cover = this.absUrl(
			$('.thumb img, .seriestucont img, img.wp-post-image').first().attr('src') ||
				$('meta[property="og:image"]').attr('content') ||
				''
		);

		let status = 'Ongoing';
		let type = 'manhwa';
		let altTitle = '';
		const authors: string[] = [];
		const genres: string[] = [];

		$('.infotable tr, table.infotable tr').each((_, tr) => {
			const cells = $(tr).find('td, th');
			if (cells.length < 2) return;
			const label = cells.eq(0).text().replace(/\s+/g, ' ').trim().toLowerCase();
			const value = cells.eq(1).text().replace(/\s+/g, ' ').trim();
			if (!label || !value) return;
			if (label.includes('status')) status = this.mapStatus(value);
			else if (label.includes('type')) type = this.mapType(value);
			else if (label.includes('author')) {
				if (value && !/^unknown$/i.test(value) && !authors.includes(value)) {
					authors.push(value);
				}
			} else if (label.includes('artist')) {
				if (value && !/^unknown$/i.test(value) && !authors.includes(value)) {
					authors.push(value);
				}
			} else if (label.includes('alternative') || label.includes('native')) {
				altTitle = value;
			}
		});

		$('.fmed, .wd-full, .imptdt').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (/^status\s/i.test(t) || /status/i.test(t)) {
				const m = t.match(/status\s*:?\s*(.+)/i);
				if (m) status = this.mapStatus(m[1]);
			}
			if (/^type\s/i.test(t)) {
				const m = t.match(/type\s*:?\s*(.+)/i);
				if (m) type = this.mapType(m[1]);
			}
		});

		$('a[href*="genre"], a[href*="/genres/"], .mgen a, .seriestugenre a').each(
			(_, a) => {
				const g = $(a).text().replace(/\s+/g, ' ').trim();
				if (g && !genres.includes(g) && g.length < 40) genres.push(g);
			}
		);

		const synopsis = (
			$('.entry-content[itemprop="description"]').text() ||
			$('[itemprop="description"]').text() ||
			$('.seriestuhead + div p, .entry-content p').first().text() ||
			$('.desc, .summary').text() ||
			''
		)
			.replace(/\s+/g, ' ')
			.trim();

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('#chapterlist li, .eplister li').each((_, li) => {
			const $li = $(li);
			const $a = $li.find('a').first();
			const href = $a.attr('href') || '';
			if (!href || !/chapter/i.test(href)) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			const raw = $li.text().replace(/\s+/g, ' ').trim();
			const number = this.parseChapterNumber(raw) || this.parseChapterNumber(id);
			if (!number) return;

			let date: string | undefined;
			const dateMatch = raw.match(
				/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i
			);
			if (dateMatch) {
				try {
					date = new Date(dateMatch[0]).toISOString().slice(0, 10);
				} catch {
					date = undefined;
				}
			}

			chapters.push({
				id,
				title: `Chapter ${number}`,
				number,
				date
			});
		});

		chapters.sort((a, b) => (a.number || 0) - (b.number || 0));

		const metaLines = [
			authors[0] && `Author: ${authors[0]}`,
			altTitle && `Alt Title: ${altTitle}`,
			`Type: ${type.charAt(0).toUpperCase() + type.slice(1)}`,
			`Language: English`
		].filter(Boolean);

		const description = [...metaLines, synopsis].filter(Boolean).join('\n');

		return {
			id: `/manga/${slug}`,
			sourceId: this.id,
			title,
			cover,
			type,
			status: this.mapStatus(status),
			description,
			authors,
			genres: [...new Set(genres)],
			chapters,
			latestChapter:
				chapters.length > 0
					? String(chapters[chapters.length - 1].number)
					: undefined
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		let id = this.cleanId(chapterId);
		if (!id || id === '/') {
			console.error('[rokaricomics] getChapterPages → bad id:', chapterId);
			return [];
		}

		if (id.startsWith('/manga/') && /-chapter-[\d.]+$/i.test(id)) {
			id = id.replace(/^\/manga/, '');
		}

		try {
			const path = id.endsWith('/') ? id : `${id}/`;
			const url = `${this.baseUrl}${path}`;
			const res = await fetch(url, {
				headers: {
					...this.headers,
					Referer: `${this.baseUrl}/`
				},
				redirect: 'follow'
			});
			if (!res.ok) {
				console.error(`[rokaricomics] chapter HTTP ${res.status} → ${url}`);
				return [];
			}
			const html = await res.text();

			if (!html || html.length < 500) {
				console.error('[rokaricomics] empty chapter html:', path);
				return [];
			}

			const $ = cheerio.load(html);
			const pages: string[] = [];
			const seen = new Set<string>();

			const push = (src: string) => {
				let u = (src || '').trim().replace(/&amp;/g, '&');
				if (!u) return;
				u = this.absUrl(u);
				if (!/^https?:\/\//i.test(u)) return;
				if (
					/logo|avatar|icon\.|emoji|\/ads?[-_/]|banner|wp-includes|favicon|image\.png$/i.test(
						u
					)
				) {
					return;
				}
				if (seen.has(u)) return;
				seen.add(u);
				pages.push(u);
			};

			$('#readerarea img, .readerarea img, .reading-content img').each(
				(_, img) => {
					const $img = $(img);
					push(
						$img.attr('data-src') ||
							$img.attr('data-lazy-src') ||
							$img.attr('src') ||
							($img.attr('srcset') || '').split(/[,\s]/)[0] ||
							''
					);
				}
			);

			if (pages.length === 0) {
				const re =
					/https?:\/\/[^"'\\\s>]+\/uploads\/manga\/[^"'\\\s>]+\.(?:jpg|jpeg|png|webp|gif)/gi;
				let m: RegExpExecArray | null;
				while ((m = re.exec(html)) !== null) {
					push(m[0]);
				}
			}

			if (pages.length === 0) {
				$('img').each((_, img) => {
					const $img = $(img);
					const src =
						$img.attr('data-src') ||
						$img.attr('src') ||
						($img.attr('srcset') || '').split(/[,\s]/)[0] ||
						'';
					const alt = $img.attr('alt') || '';
					if (
						/\/uploads\/manga\//i.test(src) ||
						/page\s*\d+/i.test(alt) ||
						/chapter\s*\d+/i.test(alt)
					) {
						push(src);
					}
				});
			}

			console.log(`[rokaricomics] ${pages.length} pages → ${path}`);
			return pages;
		} catch (e) {
			console.error('[rokaricomics] getChapterPages failed', chapterId, e);
			return [];
		}
	}

	async resolveMangaIdFromChapter(chapterId: string): Promise<string | null> {
		const id = this.cleanId(chapterId);
		const m = id.match(/^\/(?:manga\/)?(.+)-chapter-[\d.]+$/i);
		if (m?.[1]) return `/manga/${m[1]}`;
		const m2 = id.match(/^(\/manga\/[^/]+)/i);
		if (m2) return m2[1].replace(/-chapter-[\d.]+$/i, '');
		return null;
	}
}
