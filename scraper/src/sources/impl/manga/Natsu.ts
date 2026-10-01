/**
 * Natsu adapter (natsu.one)
 *
 * Theme: custom (natsu_id / Tailwind)
 * Latest : homepage / → div.project (Project Update + Latest Update)
 * Search : POST /wp-admin/admin-ajax.php?action=search (HTMX)
 * Detail : /manga/{slug}/
 * Chapter: /manga/{slug}/chapter-{num}.{id}/
 * Pages  : img → cdn.uqni.net / wp-content uploads
 *
 * ID format:
 *   manga   : /manga/{slug}
 *   chapter : /manga/{slug}/chapter-{num}.{id}
 *
 * Catatan 2026-10:
 *   /project/, /library/, /wp-json/wp/v2/manga, /?s= → 404
 *   List diambil dari homepage; search lewat admin-ajax.
 */

import { BaseSource } from '../../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../../types';
import * as cheerio from 'cheerio';

export class NatsuSource extends BaseSource {
	id = 'natsu';
	name = 'Natsu';
	baseUrl = 'https://natsu.one';

	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'id';

	// ── Helpers ──────────────────────────────────────────────────────────────

	private absUrl(url: string): string {
		if (!url) return '';
		url = url.trim();
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

	private normalizeTitle(raw: string): string {
		if (!raw) return '';
		return raw
			.trim()
			.replace(/\s+/g, ' ')
			.replace(/\s*[-|]\s*Natsu.*$/i, '')
			.replace(/\s*Bahasa Indonesia.*$/i, '')
			.replace(/^Baca\s+/i, '')
			.trim();
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath = String(path).match(/chapter[_-]?(\d+)(?:[.-](\d+))?/i);
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
			if (m[2] != null && m[2].length <= 2) {
				return parseFloat(`${m[1]}.${m[2]}`);
			}
			return parseInt(m[1], 10);
		}
		const n = String(text).match(/\b(\d+(?:\.\d{1,2})?)\b/);
		return n ? parseFloat(n[1]) : NaN;
	}

	private mapStatus(raw?: string | null): string {
		const s = String(raw || '').toLowerCase();
		if (/\b(completed|complete|tamat|selesai|end|finish)\b/.test(s))
			return 'Completed';
		if (/\bhiatus\b/.test(s)) return 'Hiatus';
		if (/\b(cancelled|dropped|canceled)\b/.test(s)) return 'Cancelled';
		return 'Ongoing';
	}

	private mapType(raw: string): 'manga' | 'manhwa' | 'manhua' {
		const t = String(raw || '').toLowerCase();
		if (t.includes('manhwa')) return 'manhwa';
		if (t.includes('manhua')) return 'manhua';
		if (t.includes('manga')) return 'manga';
		return 'manga';
	}

	// ── Homepage project cards ───────────────────────────────────────────────

	private parseProjectCards($: cheerio.CheerioAPI): Manga[] {
		const mangas: Manga[] = [];
		const seen = new Set<string>();

		$('div.project').each((_, sec) => {
			const $sec = $(sec);

			$sec.find('.grid > div, [class*="col-span"]').each((__, item) => {
				const $item = $(item);

				const $link = $item
					.find('a[href*="/manga/"]')
					.filter((_, a) => {
						const h = $(a).attr('href') || '';
						return /\/manga\/[^/]+\/?$/.test(h) && !/\/chapter/i.test(h);
					})
					.first();

				const href = ($link.attr('href') || '').split('?')[0];
				if (!href) return;

				const id = this.cleanId(href);
				if (!/^\/manga\/[^/]+$/i.test(id) || seen.has(id)) return;
				seen.add(id);

				const title = this.normalizeTitle(
					$item.find('h4').first().text() ||
						$link.attr('title') ||
						$link.find('img').attr('alt') ||
						''
				);
				if (!title || title.length < 2) return;

				let cover =
					$link.find('img').attr('data-src') ||
					$link.find('img').attr('src') ||
					$item.find('img').first().attr('data-src') ||
					$item.find('img').first().attr('src') ||
					'';
				cover = this.absUrl((cover || '').trim().split('?')[0]);
				cover = cover.replace(/-\d+x\d+\.(jpg|jpeg|png|webp)$/i, '.$1');

				let latestChapter: string | undefined;
				let best = NaN;
				$item.find('a[href*="/chapter-"]').each((___, a) => {
					const h = $(a).attr('href') || '';
					const n = this.parseChapterNumber($(a).text(), h);
					if (Number.isFinite(n) && n > 0 && (Number.isNaN(best) || n > best)) {
						best = n;
					}
				});
				if (Number.isFinite(best)) latestChapter = String(best);

				let type: 'manga' | 'manhwa' | 'manhua' = 'manga';
				const badge =
					(
						($item.find('img[alt]').attr('alt') || '') +
						' ' +
						($item.find('img[src*="svg"]').attr('src') || '')
					).toLowerCase();
				if (badge.includes('manhwa')) type = 'manhwa';
				else if (badge.includes('manhua')) type = 'manhua';

				mangas.push({
					id,
					title,
					cover,
					sourceId: this.id,
					status: 'Ongoing',
					type,
					lang: this.DEFAULT_LANG,
					latestChapter
				});
			});
		});

		return mangas;
	}

	// ── Search via admin-ajax ────────────────────────────────────────────────

	private extractSearchNonce(html: string): string | null {
		const m =
			html.match(
				/admin-ajax\.php\?nonce=([a-f0-9]+)(?:&amp;|&|#038;)action=search/i
			) || html.match(/nonce=([a-f0-9]{8,})[^"]*action=search/i);
		return m?.[1] || null;
	}

	private parseSearchResults(html: string): Manga[] {
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('#searchResults a[href*="/manga/"], a[href*="/manga/"]').each((_, el) => {
			const $a = $(el);
			const href = ($a.attr('href') || '').split('?')[0];
			if (!href || /\/chapter/i.test(href)) return;
			if (!/\/manga\/[^/]+\/?$/.test(href)) return;

			const id = this.cleanId(href);
			if (!/^\/manga\/[^/]+$/i.test(id) || seen.has(id)) return;
			seen.add(id);

			const title = this.normalizeTitle(
				$a.find('h3').text() ||
					$a.find('img').attr('alt') ||
					$a.attr('title') ||
					''
			);
			if (!title || title.length < 2) return;

			let cover =
				$a.find('img').attr('data-src') ||
				$a.find('img').attr('src') ||
				'';
			cover = this.absUrl((cover || '').trim().split('?')[0]);
			cover = cover.replace(/-\d+x\d+\.(jpg|jpeg|png|webp)$/i, '.$1');

			list.push({
				id,
				title,
				cover,
				sourceId: this.id,
				status: 'Ongoing',
				type: 'manga',
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

			const html = await this.fetchHtml('/');
			const list = this.parseProjectCards(cheerio.load(html));

			const start = (p - 1) * this.PER_PAGE;
			const pageList = list.slice(start, start + this.PER_PAGE);

			console.log(
				`[natsu] homepage projects page=${p} → ${pageList.length} (pool=${list.length})`
			);
			return pageList;
		} catch (e) {
			console.error('[natsu] getLatestManga', e);
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

		if (page > 1) return [];

		try {
			const homeHtml = await this.fetchHtml('/');
			const nonce = this.extractSearchNonce(homeHtml);
			if (!nonce) {
				console.warn('[natsu] search nonce not found');
				return [];
			}

			const url = `${this.baseUrl}/wp-admin/admin-ajax.php?nonce=${encodeURIComponent(nonce)}&action=search`;
			const res = await fetch(url, {
				method: 'POST',
				headers: {
					...this.headers,
					'Content-Type': 'application/x-www-form-urlencoded',
					Origin: this.baseUrl,
					Referer: `${this.baseUrl}/`,
					'HX-Request': 'true',
					Accept: 'text/html, */*'
				},
				body: `query=${encodeURIComponent(q)}`
			});

			if (!res.ok) {
				console.error(`[natsu] search HTTP ${res.status}`);
				return [];
			}

			const html = await res.text();
			const list = this.parseSearchResults(html);
			console.log(`[natsu] search "${q}" → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[natsu] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	private parseJsonLd($: cheerio.CheerioAPI): {
		title?: string;
		description?: string;
		cover?: string;
		authors: string[];
		genres: string[];
		status?: string;
		year?: string;
		alt?: string;
		rating?: string;
		type?: string;
	} {
		const out = {
			authors: [] as string[],
			genres: [] as string[]
		} as any;

		$('script[type="application/ld+json"]').each((_, el) => {
			try {
				const raw = $(el).html() || '';
				const data = JSON.parse(raw);
				const nodes = Array.isArray(data)
					? data
					: data['@graph']
						? data['@graph']
						: [data];
				for (const n of nodes) {
					const types = Array.isArray(n['@type'])
						? n['@type']
						: [n['@type']];
					if (
						!types.some((t: string) =>
							/ComicSeries|Book|Manga/i.test(String(t || ''))
						)
					) {
						continue;
					}
					if (n.name) out.title = n.name;
					if (n.description) out.description = n.description;
					if (n.image) {
						out.cover =
							typeof n.image === 'string'
								? n.image
								: n.image.url || n.image.contentUrl;
					}
					if (n.author) {
						const authors = Array.isArray(n.author) ? n.author : [n.author];
						for (const a of authors) {
							const name = typeof a === 'string' ? a : a.name;
							if (name && !out.authors.includes(name)) out.authors.push(name);
						}
					}
					if (Array.isArray(n.genre)) {
						for (const g of n.genre) {
							if (g && !out.genres.includes(g)) out.genres.push(g);
						}
					}
					if (n.creativeWorkStatus) out.status = n.creativeWorkStatus;
					if (n.datePublished) {
						const y = String(n.datePublished).match(/\b(19|20)\d{2}\b/);
						if (y) out.year = y[0];
					}
					if (n.alternateName) {
						out.alt = Array.isArray(n.alternateName)
							? n.alternateName.join(', ')
							: String(n.alternateName);
					}
					if (n.aggregateRating?.ratingValue)
						out.rating = String(n.aggregateRating.ratingValue);
				}
			} catch {
				/* ignore */
			}
		});

		return out;
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);

		if (/\/chapter[-/]/i.test(path)) {
			const m = path.match(/^(\/manga\/[^/]+)/i);
			if (m) path = m[1];
		}
		if (!path.startsWith('/manga/')) {
			path = `/manga/${path.replace(/^\//, '')}`;
		}
		path = path.replace(/\/+$/, '');

		const html = await this.fetchHtml(path + '/');
		const $ = cheerio.load(html);
		const ld = this.parseJsonLd($);

		let title =
			ld.title ||
			$('h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content') ||
			path;
		title = this.normalizeTitle(title);

		let cover =
			ld.cover ||
			$('meta[property="og:image"]').attr('content') ||
			$('img[alt*="' + title.slice(0, 10) + '"]')
				.first()
				.attr('src') ||
			'';
		cover = this.absUrl((cover || '').trim().split('?')[0]);

		let description =
			ld.description ||
			$('meta[name="description"]').attr('content') ||
			'';
		description = description.replace(/\[&hellip;\]/g, '…').trim();

		const status = this.mapStatus(ld.status);
		const year = ld.year || '';
		const authors = ld.authors || [];
		const genres = (ld.genres || []).filter(
			(g: string) => !/^(manhwa|manhua|manga)$/i.test(g)
		);
		const rating = ld.rating || '';
		const alt = ld.alt || '';

		let type: 'manga' | 'manhwa' | 'manhua' = 'manga';
		const badgeImg = $(
			'img[src*="manhwa"], img[src*="manhua"], img[src*="manga"], img[alt="manhwa"], img[alt="manhua"], img[alt="manga"]'
		).first();
		const badge = (
			(badgeImg.attr('src') || '') +
			' ' +
			(badgeImg.attr('alt') || '')
		).toLowerCase();
		if (badge.includes('manhwa')) type = 'manhwa';
		else if (badge.includes('manhua')) type = 'manhua';
		else if (badge.includes('manga')) type = 'manga';

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('[data-chapter-number], a[href*="/chapter-"]').each((_, el) => {
			const $el = $(el);
			const $a = $el.is('a')
				? $el
				: $el.find('a[href*="/chapter-"]').first();
			const href = $a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (seen.has(id) || !/\/manga\/[^/]+\/chapter-/i.test(id)) return;
			seen.add(id);

			const dataNum =
				$el.attr('data-chapter-number') ||
				$el.closest('[data-chapter-number]').attr('data-chapter-number') ||
				'';
			let number = dataNum ? parseFloat(dataNum) : NaN;
			if (!Number.isFinite(number)) {
				number = this.parseChapterNumber(id, id);
			}
			if (!Number.isFinite(number) || number <= 0) return;

			const spanTitle = $a
				.find('span')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			const chapterTitle =
				spanTitle && /chapter|ch\.?/i.test(spanTitle)
					? spanTitle
					: `Chapter ${number}`;

			const date =
				$a.find('time').first().text().trim() ||
				$el.find('time').first().text().trim() ||
				'';

			chapters.push({
				id,
				title: chapterTitle,
				number,
				date
			});
		});

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const latestChapter =
			chapters.length && chapters[0].number != null
				? String(chapters[0].number)
				: undefined;

		const metaLines = [
			alt && `Alternative: ${alt}`,
			rating && `Rating: ${rating}/10`,
			authors.length && `Author: ${authors.join(' · ')}`,
			year && `Publication: ${year}`,
			chapters[0]?.date && `Updated: ${chapters[0].date}`,
			`Language: Indonesian`,
			`Type: ${type}`
		].filter(Boolean);

		const fullDescription = [...metaLines, description]
			.filter(Boolean)
			.join('\n');

		console.log(
			`[natsu] details ${path} → ch=${chapters.length} status=${status} year=${year}`
		);

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			description: fullDescription,
			authors,
			genres,
			status,
			chapters,
			type,
			latestChapter,
			lang: this.DEFAULT_LANG
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(
			chapterId.startsWith('/') ? chapterId : `/${chapterId}`
		);

		const maxAttempts = 3;
		let lastErr: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const html = await this.fetchHtml(
					path.endsWith('/') ? path : path + '/'
				);
				const $ = cheerio.load(html);
				const images: string[] = [];
				const seen = new Set<string>();

				const push = (src: string) => {
					src = this.absUrl((src || '').trim().split('?')[0]);
					if (
						!src ||
						seen.has(src) ||
						!/^https?:\/\//i.test(src) ||
						src.startsWith('data:') ||
						/logo|icon|avatar|spinner|ads|banner|placeholder|gravatar|emoji/i.test(
							src
						) ||
						/\.gif(\?|$)/i.test(src)
					) {
						return;
					}
					seen.add(src);
					images.push(src);
				};

				$('img').each((_, img) => {
					const src =
						$(img).attr('data-src') ||
						$(img).attr('data-lazy-src') ||
						$(img).attr('src') ||
						'';
					if (/cdn\.uqni\.net|\/users\/|\/uploads\//i.test(src)) {
						push(src);
					}
				});

				if (images.length === 0) {
					const re =
						/https?:\/\/(?:cdn\.uqni\.net|natsu\.one\/wp-content\/uploads)\/[^"'\\\s<>]+/gi;
					const found = html.match(re) || [];
					for (const u of found) push(u);
				}

				if (images.length === 0) {
					console.warn(
						`[natsu] 0 pages attempt=${attempt}`,
						path,
						'htmlLen=',
						html.length
					);
					lastErr = new Error('Natsu chapter has 0 images');
					await new Promise((r) => setTimeout(r, 400 * attempt));
					continue;
				}

				console.log(`[natsu] ${images.length} pages → ${path}`);
				return images;
			} catch (e) {
				lastErr = e;
				console.error(`[natsu] getChapterPages attempt=${attempt}`, path, e);
				if (attempt < maxAttempts) {
					await new Promise((r) => setTimeout(r, 500 * attempt));
				}
			}
		}

		console.error('[natsu] getChapterPages failed', path, lastErr);
		return [];
	}
}