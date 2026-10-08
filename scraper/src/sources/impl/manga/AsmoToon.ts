/**
 * AsmoToon / Asmodeus Scans adapter (asmotoon.com)
 *
 * Theme     : KeyoApp (HTML SPA, Cloudflare Turnstile)
 * Latest    : /latest/  |  fallback /  |  /series/
 * Search    : /series?q={query}  (client-side filter on buttons)
 * Detail    : /series/{id}/
 * Chapter   : /chapter/{seriesId}-{chapterId}/
 * Pages     : #pages img[uid] + CDN from realUrl script
 *
 * Requires BYPARR_URL (first solve can take 60–90s).
 * In scraper/src/lib/byparr.ts set maxTimeout default to 90_000 if AbortError.
 *
 * ID format:
 *   manga   : /series/{id}
 *   chapter : /chapter/{seriesId}-{chapterId}
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

	private bgImageUrl(style: string): string {
		const m = String(style || '').match(
			/url\(\s*['"]?([^)'"]+)['"]?\s*\)/i
		);
		if (!m?.[1]) return '';
		return this.absUrl(m[1].trim());
	}

	private isNovel(text: string, dataType?: string): boolean {
		const t = `${dataType || ''} ${text || ''}`.toLowerCase();
		return /\bnovel\b/.test(t);
	}

	/**
	 * KeyoApp cards: links to /series/{id}, often inside button or div.group
	 * Cover via background-image style or img
	 */
	private parseCards($: cheerio.CheerioAPI, limit = this.PER_PAGE): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		// Collect every /series/{hex-or-slug} link
		$('a[href*="/series/"]').each((_, el) => {
			if (res.length >= limit) return false;

			const $a = $(el);
			const href = ($a.attr('href') || '').trim();
			if (!href) return;

			const id = this.cleanId(href);
			// only /series/{something}
			if (!/^\/series\/[^/]+$/i.test(id)) return;
			if (seen.has(id)) return;
			seen.add(id);

			const $card =
				$a.closest('button, div.group, [class*="group"]').length > 0
					? $a.closest('button, div.group, [class*="group"]')
					: $a.parent();

			const dataType =
				$card.attr('data-type') || $a.attr('data-type') || '';
			const cardText = $card.text() || $a.text() || '';
			if (this.isNovel(cardText, dataType)) return;

			let title =
				$a.attr('title') ||
				$card.attr('title') ||
				$card.find('h1, h2, h3, p, span').first().text() ||
				$a.text();
			title = this.decodeHtml(title).replace(/\s+/g, ' ').trim();
			// strip chapter badge noise from title
			title = title
				.replace(/\s*(chapter|ch\.?)\s*\d+(\.\d+)?\s*$/i, '')
				.trim();
			if (!title || title.length < 2) return;

			let cover = '';
			$card
				.find('[style*="background-image"], [style*="photoURL"]')
				.each((__, bg) => {
					if (cover) return;
					cover = this.bgImageUrl($(bg).attr('style') || '');
				});
			if (!cover) {
				const $img = $card.find('img').first();
				cover = this.absUrl(
					$img.attr('src') ||
						$img.attr('data-src') ||
						$img.attr('data-lazy-src') ||
						''
				);
			}

			let latestChapter: string | undefined;
			const chM = cardText.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i);
			if (chM) latestChapter = chM[1];

			res.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type: this.mapType(dataType || cardText),
				status: this.mapStatus(
					$card.attr('data-status') || cardText
				),
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

			// Prefer /latest/ then homepage then full series list
			const paths =
				p <= 1
					? ['/latest/', '/', '/series/']
					: ['/series/'];

			let list: Manga[] = [];
			for (const path of paths) {
				try {
					const html = await this.fetchHtml(path);
					console.log(
						`[asmotoon] fetched ${path} len=${html.length}`
					);
					if (html.length < 500) continue;
					list = this.parseCards(
						cheerio.load(html),
						this.PER_PAGE * Math.max(p, 2)
					);
					if (list.length > 0) break;
				} catch (e) {
					console.warn(`[asmotoon] path ${path} failed`, e);
				}
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
			console.log(`[asmotoon] search fetch len=${html.length}`);
			const all = this.parseCards(cheerio.load(html), 300);
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
				$(
					'div[class*=photoURL], div[style*=photoURL], [style*="background-image"]'
				)
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

		const labelValue = (label: string): string => {
			// "Status" heading then sibling value
			const nodes = $('div, span').toArray();
			for (const node of nodes) {
				const t = $(node).text().replace(/\s+/g, ' ').trim();
				if (new RegExp(`^${label}$`, 'i').test(t)) {
					const next = $(node).parent().next().text() ||
						$(node).next().text() ||
						$(node).parent().parent().find('div').last().text();
					return next.replace(/\s+/g, ' ').trim();
				}
			}
			return '';
		};

		const statusRaw = labelValue('Status');
		const typeRaw = labelValue('Type');
		const authorRaw = labelValue('Author');
		const artistRaw = labelValue('Artist');

		const status = this.mapStatus(statusRaw || $('body').text());
		const type = this.mapType(typeRaw || $('body').text());

		const authors: string[] = [];
		for (const raw of [authorRaw, artistRaw]) {
			if (!raw || raw === '-') continue;
			for (const part of raw.split(/[,&]/)) {
				const a = part.trim();
				if (a && a.length < 60 && !authors.includes(a)) authors.push(a);
			}
		}

		const genres: string[] = [];
		$('a[href*="genre="], a[href*="genre"]').each((_, el) => {
			const g = $(el)
				.text()
				.replace(/\s+/g, ' ')
				.trim()
				.replace(/^,|,$/g, '');
			if (g && g.length >= 2 && g.length <= 32 && !genres.includes(g)) {
				genres.push(g);
			}
		});

		const altTitles: string[] = [];
		$('div, span').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (/alternative titles/i.test(t) && t.length < 40) {
				$(el)
					.parent()
					.find('span')
					.each((__, s) => {
						const v = $(s).text().replace(/\s+/g, ' ').trim();
						if (
							v &&
							v !== title &&
							!/alternative/i.test(v) &&
							v !== 'No alternative titles.'
						) {
							altTitles.push(v);
						}
					});
			}
		});

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		const pushChapter = (
			href: string,
			name: string,
			dateText?: string,
			locked?: boolean
		) => {
			const chId = this.cleanId(href);
			if (!/\/chapter\//.test(chId) || seen.has(chId)) return;
			seen.add(chId);
			const number = this.parseChapterNumber(name);
			if (/upcoming/i.test(name)) return;
			chapters.push({
				id: chId,
				title: number
					? locked
						? `Chapter ${number} 🔒`
						: `Chapter ${number}`
					: name,
				number: number || chapters.length + 1,
				date: dateText || undefined,
				isLocked: locked || undefined
			});
		};

		$('#chapters a, #chapters > a').each((_, el) => {
			const $el = $(el);
			const href = ($el.attr('href') || '').trim();
			if (!href) return;
			const name =
				$el.find('.text-sm').first().text().replace(/\s+/g, ' ').trim() ||
				$el.text().replace(/\s+/g, ' ').trim();
			const dateText = $el
				.find('.text-xs')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			const locked =
				$el.find('img[alt*="Coin" i], img[alt*="coin"]').length > 0;
			pushChapter(href, name, dateText, locked);
		});

		if (chapters.length === 0) {
			$('a[href*="/chapter/"]').each((_, el) => {
				const href = ($(el).attr('href') || '').trim();
				const name = $(el).text().replace(/\s+/g, ' ').trim();
				pushChapter(href, name);
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

		return {
			id,
			sourceId: this.id,
			title: title || id.split('/').pop() || id,
			cover,
			type,
			status,
			description,
			authors,
			genres,
			chapters,
			latestChapter:
				chapters.length > 0
					? String(chapters[chapters.length - 1].number)
					: undefined
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

			let cdnBase = '';
			const cdnMatch = html.match(
				/realUrl\s*=\s*`[^`]*\/\/([^/`$]+)/
			);
			if (cdnMatch?.[1]) {
				const host = cdnMatch[1].replace(/\$\{[^}]*\}/g, '');
				cdnBase = `https://${host}/uploads`;
			}
			if (!cdnBase) {
				const meow = html.match(
					/https?:\/\/(?:image\.meowing\.org|cdn\d*\.keyoapp\.com)/i
				);
				if (meow) cdnBase = `${meow[0].replace(/\/$/, '')}/uploads`;
			}

			const urls: string[] = [];
			const seen = new Set<string>();

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
