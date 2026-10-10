/**
 * erisscans.com adapter (Meowing theme)
 *
 * List   : /latest/  (.latest-poster, client-side page 24)
 * Latest : /latest/
 * Search : /?s=QUERY
 * Detail : /series/{id}/
 * Pages  : /chapter/{seriesId}-{chapterId}/  → img.myImage[uid] → cdn.meowing.org/uploads/{uid}
 *
 * ID format:
 *   manga   : "/series/{id}"
 *   chapter : "/chapter/{seriesId}-{chapterId}"
 *
 * Paywall: attribute c="N" on chapter link (c>0 → locked)
 */

import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';

export class ErisScansSource extends BaseSource {
	id = 'erisscans';
	name = 'ErisScans';
	baseUrl = 'https://erisscans.com';

	private readonly PER_PAGE = 24;
	private readonly LIST_LANG = 'en';
	private readonly CDN = 'https://cdn.meowing.org/uploads';

	private absUrl(u?: string | null): string {
		if (!u) return '';
		u = u.trim().replace(/^['"]|['"]$/g, '');
		if (u.startsWith('//')) return `https:${u}`;
		if (u.startsWith('http')) return u;
		return `${this.baseUrl}${u.startsWith('/') ? '' : '/'}${u}`;
	}

	private cleanId(path: string): string {
		const s = String(path).trim();
		if (s.startsWith('http')) {
			try {
				return new URL(s).pathname.replace(/\/+$/, '') || '/';
			} catch {
			}
		}
		return ('/' + s.replace(/^\/+/, '')).replace(/\/+$/, '') || '/';
	}

	private parseSeriesId(mangaId: string): string {
		const m = this.cleanId(mangaId).match(/\/series\/([a-f0-9]+)/i);
		return m?.[1] || '';
	}

	private parseChapterPath(chapterId: string): string {
		const id = this.cleanId(chapterId);
		const m = id.match(/([a-f0-9]+-[a-f0-9]+)\/?$/i);
		return m ? `/chapter/${m[1]}` : id;
	}

	private coverFromEl($: cheerio.CheerioAPI, el: any): string {
		const $el = $(el);
		const style = $el.attr('style') || $el.find('[style*="url"]').attr('style') || '';
		const m = style.match(/url\(([^)]+)\)/);
		if (m) return this.absUrl(m[1]);
		const img = $el.find('img').first();
		return this.absUrl(
			img.attr('data-src') || img.attr('src') || $el.attr('data-src') || ''
		);
	}

	private mapCard(
		$: cheerio.CheerioAPI,
		a: any
	): Manga | null {
		const href = $(a).attr('href') || '';
		const m = href.match(/\/series\/([a-f0-9]+)/i);
		if (!m) return null;
		const sid = m[1];
		const title = (
			$(a).attr('title') ||
			$(a).attr('alt') ||
			$(a).find('img').attr('alt') ||
			$(a).text()
		)
			.replace(/\s+/g, ' ')
			.trim();
		if (!title || title.length < 1) return null;
		const cover = this.coverFromEl($, a);
		return {
			id: `/series/${sid}`,
			sourceId: this.id,
			title,
			cover: cover.replace(/\?w=\d+/, ''),
			type: 'manhwa',
			status: 'Ongoing',
			lang: this.LIST_LANG
		};
	}

	// ── List ─────────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const html = await this.fetchHtml('/latest/');
			const $ = cheerio.load(html);

			const seen = new Set<string>();
			const list: Manga[] = [];

			$('.latest-poster').each((_, el) => {
				const $el = $(el);
				const seriesA = $el.find('a[href*="/series/"]').first();
				const href = seriesA.attr('href') || '';
				const sm = href.match(/\/series\/([a-f0-9]+)/i);
				if (!sm) return;
				const sid = sm[1];
				const id = `/series/${sid}`;
				if (seen.has(id)) return;
				seen.add(id);

				const title = (
					seriesA.attr('title') ||
					seriesA.attr('alt') ||
					''
				)
					.replace(/\s+/g, ' ')
					.trim();
				if (!title) return;

				const style = seriesA.attr('style') || '';
				const bm = style.match(/url\(([^)]+)\)/);
				const cover = this.absUrl(bm?.[1] || '').replace(/\?w=\d+/, '');

				const chA = $el.find('a[href*="/chapter/"]').first();
				const chLabel =
					chA.attr('title') || chA.attr('alt') || chA.text() || '';
				const nm = chLabel.match(/(?:Chapter|Ch\.?)\s*([\d.]+)/i);
				const latestChapter = nm ? parseFloat(nm[1]) : undefined;
				const dateStr = (chA.attr('d') || '').trim();

				list.push({
					id,
					sourceId: this.id,
					title,
					cover,
					type: 'manhwa',
					status: 'Ongoing',
					latestChapter,
					lang: this.LIST_LANG,
					...(dateStr ? { updatedAt: Date.now() } : {})
				});
			});

			const startIdx = (p - 1) * this.PER_PAGE;
			if (startIdx >= list.length) {
				console.log(`[erisscans] latest page=${p} → 0 (end total=${list.length})`);
				return [];
			}
			const sliced = list.slice(startIdx, startIdx + this.PER_PAGE);
			console.log(
				`[erisscans] latest page=${p} → ${sliced.length}/${list.length} (from /latest/)`
			);
			return sliced;
		} catch (e) {
			console.error('[erisscans] getLatestManga', e);
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
			const html = await this.fetchHtml(`/?s=${encodeURIComponent(q)}`);
			const $ = cheerio.load(html);
			const seen = new Set<string>();
			const list: Manga[] = [];

			$('a[href*="/series/"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				if (/\/series\/\?/.test(href)) return;
				const manga = this.mapCard($, a);
				if (!manga || seen.has(manga.id)) return;
				seen.add(manga.id);
				list.push(manga);
			});

			const start = (page - 1) * this.PER_PAGE;
			if (start >= list.length) return [];
			const sliced = list.slice(start, start + this.PER_PAGE);
			console.log(`[erisscans] search "${q}" → ${sliced.length}/${list.length}`);
			return sliced;
		} catch (e) {
			console.error('[erisscans] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const sid = this.parseSeriesId(mangaId);
		if (!sid) throw new Error(`Invalid erisscans id: ${mangaId}`);

		const html = await this.fetchHtml(`/series/${sid}/`);
		const $ = cheerio.load(html);

		const title = (
			$('meta[property="og:title"]').attr('content') ||
			$('h1').first().text() ||
			$('title').text().split('|')[0] ||
			sid
		)
			.replace(/\s+/g, ' ')
			.trim();

		const cover = (
			$('meta[property="og:image"]').attr('content') ||
			''
		).replace(/\?w=\d+/, '');

		const description = (
			$('meta[property="og:description"]').attr('content') ||
			''
		).trim();

		const genres: string[] = [];
		$('a[href*="genre"]').each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		const authors: string[] = [];
		$('a[href*="author"], a[href*="artist"]').each((_, a) => {
			const n = $(a).text().replace(/\s+/g, ' ').trim();
			if (n && !authors.includes(n)) authors.push(n);
		});

		const bodyText = $('body').text();
		let status = 'Ongoing';
		if (/status\s*[:\-]?\s*complete/i.test(bodyText)) status = 'Completed';
		else if (/status\s*[:\-]?\s*hiatus/i.test(bodyText)) status = 'Hiatus';

		const chapters: Chapter[] = [];
		const seenCh = new Set<string>();

		$('#chapters a[href*="/chapter/"], #chapters_panel a[href*="/chapter/"]').each(
			(_, a) => {
				const href = $(a).attr('href') || '';
				const cm = href.match(/\/chapter\/([a-f0-9]+-[a-f0-9]+)/i);
				if (!cm) return;
				const full = cm[1];
				const seriesPart = full.split('-')[0];
				const cid = `/series/${seriesPart}/chapter/${full}`;
				if (seenCh.has(cid)) return;
				seenCh.add(cid);

				const alt = ($(a).attr('alt') || $(a).attr('title') || '').trim();
				const text = $(a).text().replace(/\s+/g, ' ').trim();
				const label = alt || text;
				const nm = label.match(/(?:Chapter|Ch\.?)\s*([\d.]+)/i);
				const number = nm ? parseFloat(nm[1]) : 0;

				const coin = $(a).attr('c');
				const coinN = coin != null ? parseInt(String(coin), 10) : 0;
				const isLocked = !Number.isNaN(coinN) && coinN > 0;

				const dateStr = ($(a).attr('d') || '').trim() || undefined;
				const thumbUid = ($(a).attr('p') || '').trim();
				const cover = thumbUid
					? `${this.CDN}/${thumbUid}`
					: undefined;

				chapters.push({
					id: cid,
					title: nm ? `Chapter ${nm[1]}` : `Chapter ${number}`,
					number: number || 0,
					date: dateStr,
					cover,
					isLocked
				});
			}
		);

		chapters.sort((a, b) => b.number - a.number);

		const latestChapter = chapters.length
			? Math.max(...chapters.map((c) => c.number))
			: undefined;

		console.log(
			`[erisscans] details ${sid} → chapters=${chapters.length} genres=${genres.length}`
		);

		return {
			id: `/series/${sid}`,
			sourceId: this.id,
			title,
			cover,
			type: 'manhwa',
			status,
			description,
			authors,
			genres,
			chapters,
			latestChapter,
			lang: this.LIST_LANG
		};
	}

	async resolveMangaIdFromChapter(chapterId: string): Promise<string | null> {
		const id = this.cleanId(chapterId);
		const embedded = id.match(/\/series\/([a-f0-9]+)/i);
		if (embedded) return `/series/${embedded[1]}`;
		const m = id.match(/\/chapter\/([a-f0-9]+)-[a-f0-9]+/i);
		if (m) return `/series/${m[1]}`;
		const tail = id.match(/([a-f0-9]+)-[a-f0-9]+$/i);
		if (tail) return `/series/${tail[1]}`;
		return null;
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.parseChapterPath(chapterId);
		if (!/\/chapter\/[a-f0-9]+-[a-f0-9]+/i.test(path)) {
			console.error('[erisscans] invalid chapter id', chapterId);
			return [];
		}

		try {
			const html = await this.fetchHtml(`${path}/`);
			const $ = cheerio.load(html);

			const pages: string[] = [];
			const seen = new Set<string>();

			$('#pages img.myImage, #pages_panel img.myImage, img.myImage').each(
				(_, img) => {
					const uid = $(img).attr('uid') || '';
					if (!uid) return;
					const url = `${this.CDN}/${uid}`;
					if (seen.has(url)) return;
					seen.add(url);
					pages.push(url);
				}
			);

			if (!pages.length) {
				$('[uid]').each((_, el) => {
					const uid = $(el).attr('uid') || '';
					if (!uid || !/\.(avif|webp|jpe?g|png)$/i.test(uid) && !/^[a-zA-Z0-9._-]+$/.test(uid))
						return;
					const url = `${this.CDN}/${uid}`;
					if (seen.has(url)) return;
					seen.add(url);
					pages.push(url);
				});
			}

			console.log(`[erisscans] ${path} → ${pages.length} pages`);
			return pages;
		} catch (e) {
			console.error('[erisscans] getChapterPages', path, e);
			return [];
		}
	}
}
