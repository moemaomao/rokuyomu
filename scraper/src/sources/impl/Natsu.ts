/**
 * Natsu adapter (natsu.one)
 *
 * Theme: custom (natsu_id / Tailwind)
 * Latest (Project Update) : /project/ 
 * Search                  : /wp-json/wp/v2/manga?search=
 * Detail                  : /manga/{slug}/
 * Chapter                 : /manga/{slug}/chapter-{num}.{id}/
 * Pages                   : section img → cdn.uqni.net
 *
 * ID format:
 *   manga   : /manga/{slug}
 *   chapter : /manga/{slug}/chapter-{num}.{id}
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class NatsuSource extends BaseSource {
	id = 'natsu';
	name = 'Natsu';
	baseUrl = 'https://natsu.one';

	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'id';

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
		const m = String(text).match(/(?:chapter|chap|ch\.?)\s*(\d+)(?:[.,](\d+))?/i);
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
		if (/\b(completed|complete|tamat|selesai|end|finish)\b/.test(s)) return 'Completed';
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

	private extractLatestChapter($: cheerio.CheerioAPI, $root: cheerio.Cheerio<any>): string | undefined {
		let best = NaN;

		$root.find('a[href*="/chapter-"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const n = this.parseChapterNumber(href, href);
			if (Number.isFinite(n) && n > 0 && (Number.isNaN(best) || n > best)) {
				best = n;
			}
		});

		if (!Number.isFinite(best)) {
			$root.find('p, span, a').each((_, el) => {
				const t = $(el).text().replace(/\s+/g, ' ').trim();
				const m = t.match(/^(?:chapter|ch\.?)\s*(\d+(?:\.\d{1,2})?)$/i);
				if (m) {
					const n = parseFloat(m[1]);
					if (Number.isFinite(n) && n > 0 && (Number.isNaN(best) || n > best)) {
						best = n;
					}
				}
			});
		}

		return Number.isFinite(best) ? String(best) : undefined;
	}

	private parseProjectCards($: cheerio.CheerioAPI): Manga[] {
		const mangas: Manga[] = [];
		const seen = new Set<string>();

		$('a[href*="/manga/"]').each((_, el) => {
			const $a = $(el);
			const href = ($a.attr('href') || '').split('?')[0];
			if (!href || /\/chapter[-/]/i.test(href)) return;
			if (!/\/manga\/[^/]+\/?$/.test(href)) return;

			const id = this.cleanId(href);
			if (!/^\/manga\/[^/]+$/i.test(id) || seen.has(id)) return;
			seen.add(id);

			const $img = $a.find('img').first();
			let title =
				$img.attr('alt') ||
				$a.attr('title') ||
				$a.text() ||
				'';
	
			if (!title || title.length < 2) {
				const parent = $a.parent().parent();
				title =
					parent.find('a[href*="/manga/"]').not($a).first().text() ||
					parent.text() ||
					'';
			}
			title = this.normalizeTitle(title)
				.replace(/Chapter\s*\d+.*$/i, '')
				.replace(/\d+\s*(hours?|days?|ago|jam|hari).*$/i, '')
				.trim();
			if (!title || title.length < 2) {
				const slug = id.split('/').filter(Boolean).pop() || '';
				title = slug
					.split('-')
					.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
					.join(' ');
			}

			let cover =
				$img.attr('data-src') ||
				$img.attr('data-lazy-src') ||
				$img.attr('src') ||
				'';
			cover = this.absUrl((cover || '').trim().split('?')[0]);
			cover = cover.replace(/-\d+x\d+\.(jpg|jpeg|png|webp)$/i, '.$1');

			let type: 'manga' | 'manhwa' | 'manhua' = 'manga';
			const $badge = $a
				.closest('div')
				.parent()
				.find('img[alt], img[src*="svg"]')
				.filter((_, img) => {
					const s = (($(img).attr('src') || '') + ' ' + ($(img).attr('alt') || '')).toLowerCase();
					return /manhwa|manhua|manga/.test(s);
				})
				.first();
			const badgeSrc = (($badge.attr('src') || '') + ' ' + ($badge.attr('alt') || '')).toLowerCase();
			if (badgeSrc.includes('manhwa')) type = 'manhwa';
			else if (badgeSrc.includes('manhua')) type = 'manhua';
			else if (badgeSrc.includes('manga')) type = 'manga';

			const $card =
				$a.closest('div').parent().parent().length
					? $a.closest('div').parent().parent()
					: $a.closest('div').parent();

			const latestChapter = this.extractLatestChapter($, $card);

			let status = 'Ongoing';
			const cardText = $card.text().toLowerCase();
			if (/\b(completed|complete|tamat|selesai)\b/.test(cardText)) status = 'Completed';
			else if (/\bhiatus\b/.test(cardText)) status = 'Hiatus';

			mangas.push({
				id,
				title,
				cover,
				sourceId: this.id,
				status,
				type,
				lang: this.DEFAULT_LANG,
				latestChapter
			});
		});

		return mangas;
	}

	private async fetchMangaApi(page: number, search?: string): Promise<Manga[]> {
		const params = new URLSearchParams({
			per_page: String(this.PER_PAGE),
			page: String(page),
			orderby: 'modified',
			order: 'desc',
			_embed: '1'
		});
		if (search) params.set('search', search);

		const html = await this.fetchHtml(`/wp-json/wp/v2/manga?${params.toString()}`);
		let data: any[];
		try {
			data = JSON.parse(html);
		} catch {
			return [];
		}
		if (!Array.isArray(data)) return [];

		const list: Manga[] = [];
		for (const item of data) {
			const slug = item.slug || '';
			if (!slug) continue;
			const id = `/manga/${slug}`;
			const title = this.normalizeTitle(
				(item.title?.rendered || item.title || slug).replace(/<[^>]+>/g, '')
			);
			let cover = '';
			const emb = item._embedded?.['wp:featuredmedia']?.[0];
			if (emb?.source_url) cover = emb.source_url;
			else if (emb?.media_details?.sizes?.medium?.source_url)
				cover = emb.media_details.sizes.medium.source_url;

			let type: 'manga' | 'manhwa' | 'manhua' = 'manga';
			const types = item._embedded?.['wp:term']?.flat?.() || [];
			for (const t of types) {
				const name = String(t?.name || t?.slug || '').toLowerCase();
				if (name === 'manhwa') type = 'manhwa';
				else if (name === 'manhua') type = 'manhua';
				else if (name === 'manga') type = 'manga';
			}

			let latestChapter: string | undefined;
			const meta = item.meta?.meta || item.meta || {};
			const candidates = [
				meta.latest_chapter,
				meta.last_chapter,
				meta.chapter,
				item.latest_chapter,
				item.acf?.latest_chapter
			];
			for (const c of candidates) {
				if (c != null && String(c).trim() !== '') {
					const n = this.parseChapterNumber(String(c));
					if (Number.isFinite(n) && n > 0) {
						latestChapter = String(n);
						break;
					}
				}
			}

			list.push({
				id,
				title,
				cover: this.absUrl(cover),
				sourceId: this.id,
				status: 'Ongoing',
				type,
				lang: this.DEFAULT_LANG,
				latestChapter
			});
		}
		return list;
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);

			if (p === 1) {
				const html = await this.fetchHtml('/project/');
				const list = this.parseProjectCards(cheerio.load(html));
				console.log(`[natsu] project-update → ${list.length}`);
				return list.slice(0, this.PER_PAGE);
			}

			const list = await this.fetchMangaApi(p);
			console.log(`[natsu] api latest page=${p} → ${list.length}`);
			return list;
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

		try {
			const list = await this.fetchMangaApi(page, q);
			console.log(`[natsu] search "${q}" page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[natsu] searchManga', e);
			return [];
		}
	}

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
						const authors = Array.isArray(n.author)
							? n.author
							: [n.author];
						for (const a of authors) {
							const name = typeof a === 'string' ? a : a.name;
							if (name && !out.authors.includes(name))
								out.authors.push(name);
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
			$('img[alt*="' + title.slice(0, 10) + '"]').first().attr('src') ||
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
		const badge = ((badgeImg.attr('src') || '') + ' ' + (badgeImg.attr('alt') || '')).toLowerCase();
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

			const spanTitle = $a.find('span').first().text().replace(/\s+/g, ' ').trim();
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

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(
			chapterId.startsWith('/') ? chapterId : `/${chapterId}`
		);

		const maxAttempts = 3;
		let lastErr: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const html = await this.fetchHtml(path.endsWith('/') ? path : path + '/');
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
					if (/cdn\.uqni\.net|\/users\//i.test(src)) {
						push(src);
					}
				});

				if (images.length === 0) {
					const re = /https?:\/\/cdn\.uqni\.net\/[^"'\\\s<>]+/gi;
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