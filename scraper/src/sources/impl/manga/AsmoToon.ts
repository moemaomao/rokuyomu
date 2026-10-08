/**
 * AsmoToon / Asmodeus Scans adapter (asmotoon.com)
 *
 * Theme     : KeyoApp (HTML SPA, Cloudflare protected)
 * Latest    : /latest/
 * Search    : /series?q={query}
 * Catalog   : /series/
 * Detail    : /series/{id}/
 * Chapter   : /chapter/{seriesId}-{chapterId}/
 * Pages     : #pages > img[uid] + CDN host from script (realUrl = `https://{cdn}/...`)
 * Images    : https://{cdn}/uploads/{uid}
 *
 * ID format:
 *   manga   : /series/{id}
 *   chapter : /chapter/{seriesId}-{chapterId}
 *
 * Notes:
 * - fetchHtml via BaseSource (CF / fetchWithCf)
 * - Paid chapters marked isLocked + 🔒
 * - Client-side search on /series (filter buttons)
 */

import { BaseSource } from '../../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';
import * as cheerio from 'cheerio';

export class AsmoToonSource extends BaseSource {
	id = 'asmotoon';
	name = 'AsmoToon';
	baseUrl = 'https://asmotoon.com';

	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'en';

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

	private mapType(text: string): string {
		const t = (text || '').toLowerCase();
		if (/\bmanhua\b/.test(t)) return 'manhua';
		if (/\bmanga\b/.test(t) && !/\bmanhwa\b/.test(t)) return 'manga';
		if (/\bnovel\b/.test(t)) return 'novel';
		return 'manhwa';
	}

	private mapStatus(text: string): string {
		const t = (text || '').toLowerCase();
		if (/complet/.test(t)) return 'Completed';
		if (/hiatus|paused/.test(t)) return 'Hiatus';
		if (/drop|cancel/.test(t)) return 'Dropped';
		return 'Ongoing';
	}

	private parseChapterNumber(text: string): number {
		const m = String(text || '').match(
			/(?:chapter|chap|ch\.?)\s*(\d+(?:\.\d+)?)/i
		);
		if (m) return parseFloat(m[1]);
		const n = String(text).match(/\b(\d+(?:\.\d+)?)\b/);
		return n ? parseFloat(n[1]) : 0;
	}

	/** background-image: url(...) → absolute URL */
	private bgImageUrl(style: string): string {
		const m = String(style || '').match(
			/url\(\s*['"]?([^)'"]+)['"]?\s*\)/i
		);
		if (!m?.[1]) return '';
		const u = m[1].trim();
		// KeyoApp supports dynamic size via ?w=
		if (u.includes('?')) return this.absUrl(u);
		return this.absUrl(u);
	}

	private isNovelEl($el: cheerio.Cheerio<any>): boolean {
		const t = ($el.attr('data-type') || $el.text() || '').toLowerCase();
		return /\bnovel\b/.test(t);
	}

	/**
	 * Parse grid cards from homepage / latest / series.
	 * Selectors based on KeyoApp: div.group, button a, bg-cover
	 */
	private parseCards($: cheerio.CheerioAPI, limit = this.PER_PAGE): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		const candidates = $(
			'div.group a[href*="/series/"], #searched_series_page button a[href*="/series/"], a[href*="/series/"]:has(.bg-cover), a[href*="/series/"]'
		);

		candidates.each((_, el) => {
			if (res.length >= limit) return false;

			const $a = $(el);
			const href = ($a.attr('href') || '').trim();
			if (!href || !/\/series\/[^/]+/.test(href)) return;

			const id = this.cleanId(href);
			if (seen.has(id) || id === '/series') return;
			seen.add(id);

			const $card = $a.closest('div.group, button, div').length
				? $a.closest('div.group, button, div')
				: $a;

			if (this.isNovelEl($card) || this.isNovelEl($a)) return;

			let title =
				$a.attr('title') ||
				$card.attr('title') ||
				$a.find('h1, h2, h3, span.font-bold, p.font-semibold').first().text() ||
				$a.text();
			title = this.decodeHtml(title).replace(/\s+/g, ' ').trim();
			if (!title || title.length < 2) return;

			// Cover from style background or img
			let cover = '';
			const $bg = $card
				.find('[style*="background-image"], .bg-cover[style], *[style*="photoURL"]')
				.first();
			if ($bg.length) cover = this.bgImageUrl($bg.attr('style') || '');
			if (!cover) {
				const $img = $card.find('img').first();
				cover =
					$img.attr('src') ||
					$img.attr('data-src') ||
					$img.attr('data-lazy-src') ||
					'';
				cover = this.absUrl(cover);
			}

			const cardText = $card.text().toLowerCase();
			let latestChapter: string | undefined;
			const chM = cardText.match(
				/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i
			);
			if (chM) latestChapter = chM[1];

			const type = this.mapType(
				$card.attr('data-type') || $a.attr('data-type') || cardText
			);
			const status = this.mapStatus(
				$card.attr('data-status') || cardText
			);

			res.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type,
				status,
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

			// /latest/ is primary; page 2+ may not paginate — fall back to /series
			const path = p <= 1 ? '/latest/' : `/series/`;
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			let list = this.parseCards($, this.PER_PAGE * p);

			if (list.length === 0 && p === 1) {
				const home = await this.fetchHtml('/');
				list = this.parseCards(cheerio.load(home), this.PER_PAGE);
			}

			const start = (p - 1) * this.PER_PAGE;
			const pageList = list.slice(start, start + this.PER_PAGE);

			console.log(`[asmotoon] latest page=${p} → ${pageList.length}`);
			return pageList;
		} catch (e) {
			console.error('[asmotoon] getLatestManga', e);
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
			const path = `/series?q=${encodeURIComponent(q)}`;
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);

			// Client-side filter: match title containing query
			const all = this.parseCards($, 200);
			const nq = q.toLowerCase();
			const filtered = all.filter((m) =>
				m.title.toLowerCase().includes(nq)
			);

			const start = (page - 1) * this.PER_PAGE;
			const pageList = filtered.slice(start, start + this.PER_PAGE);

			console.log(
				`[asmotoon] search "${q}" page=${page} → ${pageList.length}`
			);
			return pageList;
		} catch (e) {
			console.error('[asmotoon] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const id = this.cleanId(mangaId);
		const path = id.endsWith('/') ? id : `${id}/`;
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title = this.decodeHtml(
			$('div.grid > h1, h1').first().text() ||
				$('meta[property="og:title"]').attr('content') ||
				''
		)
			.replace(/\s+/g, ' ')
			.trim();

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			this.bgImageUrl(
				$('div[class*=photoURL], div[style*=photoURL], *[style*="background-image"]')
					.first()
					.attr('style') || ''
			) ||
			'';
		cover = this.absUrl(cover);

		const synopsis = this.decodeHtml(
			$('#expand_content p, #expand_content, .prose p')
				.first()
				.text() ||
				$('meta[name="description"]').attr('content') ||
				''
		)
			.replace(/\s+/g, ' ')
			.trim();

		const pickLabel = (label: string): string => {
			const $lab = $(
				`div:has(span:containsOwn(${label})), div.font-medium:contains(${label})`
			).first();
			if (!$lab.length) return '';
			const $val = $lab.next('div');
			return ($val.text() || $lab.parent().text())
				.replace(new RegExp(label, 'i'), '')
				.replace(/\s+/g, ' ')
				.trim();
		};

		const status = this.mapStatus(
			pickLabel('Status') || $('body').text()
		);
		const type = this.mapType(pickLabel('Type') || $('body').text());
		const authorRaw = pickLabel('Author');
		const artistRaw = pickLabel('Artist');

		const authors: string[] = [];
		for (const raw of [authorRaw, artistRaw]) {
			if (!raw || raw === '-') continue;
			for (const part of raw.split(/[,&]/)) {
				const a = part.trim();
				if (a && a.length < 50 && !authors.includes(a)) authors.push(a);
			}
		}

		const genres: string[] = [];
		$('a[href*="genre="], a[href*="/genre/"]').each((_, el) => {
			const g = $(el).text().replace(/\s+/g, ' ').trim().replace(/^,|,$/g, '');
			if (g && g.length >= 2 && g.length <= 30 && !genres.includes(g)) {
				genres.push(g);
			}
		});

		const altTitles: string[] = [];
		$(
			'div.font-medium:contains(Alternative) ~ div span, div:contains(Alternative titles) ~ div span'
		).each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (t && t !== 'No alternative titles.' && t !== title) {
				altTitles.push(t);
			}
		});

		// Chapters
		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		const seriesPath = id; // /series/{hex}

		$('#chapters a, #chapters > a, #chapters div a').each((_, el) => {
			const $el = $(el);
			const href = ($el.attr('href') || $el.find('a').attr('href') || '').trim();
			if (!href || !/\/chapter\//.test(href)) return;

			const chId = this.cleanId(href);
			if (seen.has(chId)) return;
			seen.add(chId);

			const name =
				$el.find('.text-sm').first().text().replace(/\s+/g, ' ').trim() ||
				$el.text().replace(/\s+/g, ' ').trim();

			const isUpcoming = /upcoming/i.test(name) || /upcoming/i.test($el.text());
			if (isUpcoming) return;

			const isLocked =
				$el.find('img[alt*="Coin" i], img[alt*="coin" i], .text-gold').length >
					0 ||
				/🔒|coin|paid|locked/i.test($el.html() || '');

			const number = this.parseChapterNumber(name);
			const dateText = $el
				.find('.text-xs')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim();

			const cleanTitle = isLocked
				? `Chapter ${number || name} `
				: `Chapter ${number || name}`;

			chapters.push({
				id: chId,
				title: number ? cleanTitle : name,
				number: number || chapters.length + 1,
				date: dateText || undefined,
				isLocked: isLocked || undefined
			});
		});

		// Fallback: any /chapter/ links on page
		if (chapters.length === 0) {
			$('a[href*="/chapter/"]').each((_, el) => {
				const href = ($(el).attr('href') || '').trim();
				const chId = this.cleanId(href);
				if (seen.has(chId) || !/\/chapter\//.test(chId)) return;
				seen.add(chId);
				const name = $(el).text().replace(/\s+/g, ' ').trim();
				const number = this.parseChapterNumber(name);
				chapters.push({
					id: chId,
					title: number ? `Chapter ${number}` : name,
					number: number || chapters.length + 1
				});
			});
		}

		chapters.sort((a, b) => (a.number || 0) - (b.number || 0));

		const metaLines = [
			altTitles.length && `Alternative: ${altTitles.join(' · ')}`,
			authors[0] && `Author: ${authors[0]}`,
			artistRaw && artistRaw !== authors[0] && `Artist: ${artistRaw}`,
			type && `Type: ${type}`,
			status && `Status: ${status}`
		].filter(Boolean);

		const description = [...metaLines, synopsis].filter(Boolean).join('\n');

		const latestChapter =
			chapters.length > 0
				? String(chapters[chapters.length - 1].number)
				: undefined;

		return {
			id: seriesPath,
			sourceId: this.id,
			title: title || id.split('/').pop() || id,
			cover,
			type,
			status,
			description,
			authors,
			genres,
			chapters,
			latestChapter
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		if (!path || !/\/chapter\//.test(path)) {
			console.warn('[asmotoon] invalid chapter id:', chapterId);
			return [];
		}

		try {
			const html = await this.fetchHtml(
				path.endsWith('/') ? path : `${path}/`
			);
			const $ = cheerio.load(html);

			// CDN host: realUrl = `https://{host}/...`
			let cdnBase = '';
			const cdnMatch = html.match(
				/realUrl\s*=\s*`[^`]*\/\/([^/`$]+)/
			);
			if (cdnMatch?.[1]) {
				const host = cdnMatch[1].replace(/\$\{[^}]*\}/g, '');
				cdnBase = `https://${host}/uploads`;
			}
			// Fallback common Keyo CDN
			if (!cdnBase) {
				const meow = html.match(
					/https?:\/\/(?:image\.meowing\.org|cdn\d*\.keyoapp\.com)/i
				);
				if (meow) cdnBase = `${meow[0].replace(/\/$/, '')}/uploads`;
			}

			const urls: string[] = [];
			const seen = new Set<string>();

			// Primary: #pages > img[uid]
			$('#pages img, #pages > img, img.myImage').each((_, el) => {
				const uid = ($(el).attr('uid') || '').trim();
				if (uid && cdnBase) {
					const u = `${cdnBase}/${uid}`.replace(
						/([^:]\/)\/+/g,
						'$1'
					);
					if (!seen.has(u)) {
						seen.add(u);
						urls.push(u);
					}
					return;
				}
				const src =
					$(el).attr('data-src') ||
					$(el).attr('src') ||
					$(el).attr('data-lazy-src') ||
					'';
				if (!src || src.startsWith('data:')) return;
				const abs = this.absUrl(src);
				if (
					/keyoapp|meowing|uploads|\.(jpg|jpeg|png|webp)/i.test(abs) &&
					!seen.has(abs)
				) {
					seen.add(abs);
					urls.push(abs);
				}
			});

			console.log(`[asmotoon] ${urls.length} pages → ${path}`);
			return urls;
		} catch (e) {
			console.error('[asmotoon] getChapterPages failed', chapterId, e);
			return [];
		}
	}
}
