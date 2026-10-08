/**
 * Art Lapsa adapter (artlapsa.com)
 *
 * Theme     : Laravel + Livewire (server-rendered HTML)
 * Latest    : GET /latest?page=N  (~24 series / page)
 * Search    : GET /search?q=
 * Detail    : GET /series/{uuid}
 * Chapter   : GET /read/{uuid}
 * Pages     : CDN sequential 001.jpg … N.jpg under revisions/
 *             pageCount + first image URL parsed from reader HTML
 *
 * Locked chapters: .chapter-lock-badge (coin price) → isLocked
 *
 * ID format:
 *   manga   : /series/{uuid}
 *   chapter : /read/{uuid}
 */

import { BaseSource } from '../../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import * as cheerio from 'cheerio';

export class ArtLapsaSource extends BaseSource {
	id = 'artlapsa';
	name = 'Art Lapsa';
	baseUrl = 'https://artlapsa.com';
	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'en';

	// ── HTTP ─────────────────────────────────────────────────────────────────

	protected override async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		return fetchWithCf(url, {
			headers: {
				...this.headers,
				Referer: this.baseUrl + '/'
			}
		});
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
		return id.replace(/\/+$/, '');
	}

	private extractUuid(path: string): string {
		const m = String(path).match(
			/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
		);
		return m ? m[0] : '';
	}

	private toMangaId(uuid: string): string {
		return `/series/${uuid}`;
	}

	private toChapterId(uuid: string): string {
		return `/read/${uuid}`;
	}

	private mapStatus(raw: string): string {
		const s = (raw || '').toLowerCase();
		if (s.includes('complet')) return 'Completed';
		if (s.includes('hiatus')) return 'Hiatus';
		if (s.includes('drop')) return 'Dropped';
		return 'Ongoing';
	}

	private mapType(raw: string): string {
		const s = (raw || '').toLowerCase();
		if (s.includes('manhwa')) return 'manhwa';
		if (s.includes('manhua')) return 'manhua';
		if (s.includes('novel')) return 'novel';
		return 'manga';
	}

	private parseChapterNumber(text: string): number {
		const m = text.match(/Chapter\s*(\d+(?:\.\d+)?)/i) || text.match(/\b(\d+(?:\.\d+)?)\b/);
		return m ? parseFloat(m[1]) : NaN;
	}

	private parseDateFromText(text: string): string {
		const t = (text || '').replace(/\s+/g, ' ').trim();
		const abs = t.match(
			/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s*\d{4}/i
		);
		if (abs) {
			const d = new Date(abs[0]);
			if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
		}
		const rel = t.match(/(\d+)\s*(m|min|mins|minute|minutes|h|hr|hour|hours|d|day|days|w|week|weeks)\s*ago/i);
		if (rel) {
			const n = parseInt(rel[1], 10);
			const unit = rel[2].toLowerCase();
			const ms =
				unit.startsWith('m') && !unit.startsWith('mi') && unit !== 'm'
					? 0
					: unit.startsWith('m')
						? n * 60_000
						: unit.startsWith('h')
							? n * 3_600_000
							: unit.startsWith('d')
								? n * 86_400_000
								: n * 604_800_000;
			if (unit === 'm' || unit.startsWith('min')) {
				return new Date(Date.now() - n * 60_000).toISOString().slice(0, 10);
			}
			return new Date(Date.now() - ms).toISOString().slice(0, 10);
		}
		return '';
	}

	private getLabeledValue($: cheerio.CheerioAPI, label: string): string {
		let value = '';
		$('dt, span, div, p, strong, b').each((_, el) => {
			const $el = $(el);
			const text = $el.text().replace(/\s+/g, ' ').trim();
			if (text.toLowerCase() !== label.toLowerCase()) return;
			const next = $el.next();
			if (next.length) {
				value = next.text().replace(/\s+/g, ' ').trim();
				return false;
			}
			const parentText = $el.parent().text().replace(/\s+/g, ' ').trim();
			const m = parentText.match(new RegExp(`${label}\\s+(.+?)(?:\\s{2,}|$)`, 'i'));
			if (m) value = m[1].split(/\s{2,}/)[0].trim();
		});
		return value;
	}

	private normalizeCover(cover: string, uuid: string): string {
		let c = (cover || '').trim();
		if (c) {
			c = this.absUrl(c);
			c = c.replace(/\/300x450(\.\w+)$/i, '/600x900$1');
			c = c.replace(/\/600x450(\.\w+)$/i, '/600x900$1');
			return c;
		}
		if (uuid) {
			return `https://cdn.artlapsa.com/series/webtoon/${uuid}/600x900.webp`;
		}
		return '';
	}

	private parseSeriesCards($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		$('a[href*="/series/"]').each((_, el) => {
			const $a = $(el);
			const href = $a.attr('href') || '';
			const uuid = this.extractUuid(href);
			if (!uuid) return;
			if (!/\/series\/[0-9a-f-]{36}\/?$/i.test(href.split('?')[0])) return;

			const id = this.toMangaId(uuid);
			if (seen.has(id)) return;
			seen.add(id);

			const img = $a.find('img').first();
			let title =
				($a.attr('title') || '').trim() ||
				(img.attr('alt') || '').replace(/\s*cover\s*$/i, '').trim() ||
				$a.find('h2, h3, h4, p, span').first().text().replace(/\s+/g, ' ').trim() ||
				$a.text().replace(/\s+/g, ' ').trim();

			title = title
				.replace(/\s*Chapter\s*\d+(?:\.\d+)?.*$/i, '')
				.replace(/\s+/g, ' ')
				.trim();
			if (!title || title.length < 2) return;

			const rawCover =
				img.attr('src') ||
				img.attr('data-src') ||
				(img.attr('srcset') || '').split(/[,\s]/)[0] ||
				'';
			const cover = this.normalizeCover(rawCover, uuid);

			let latestChapter: string | undefined;
			const $card = $a.closest('.latest-poster, article, li, .group').length
				? $a.closest('.latest-poster, article, li, .group')
				: $a.parent();
			const cardText = ($card.text() || $a.parent().text() || '').replace(/\s+/g, ' ');
			const chMatch = cardText.match(/Chapter\s*(\d+(?:\.\d+)?)/i);
			if (chMatch) latestChapter = chMatch[1];

			res.push({
				id,
				sourceId: this.id,
				title,
				cover,
				lang: this.DEFAULT_LANG,
				type: 'manga',
				status: 'Ongoing',
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
			const html = await this.fetchHtml(`/latest?page=${p}`);
			const $ = cheerio.load(html);
			const list = this.parseSeriesCards($).slice(0, this.PER_PAGE);
			console.log(`[artlapsa] latest page=${p} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[artlapsa] getLatestManga', e);
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
			const html = await this.fetchHtml(`/search?q=${encoded}&page=${page}`);
			const $ = cheerio.load(html);
			const list = this.parseSeriesCards($).slice(0, this.PER_PAGE);
			console.log(`[artlapsa] search "${q}" page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[artlapsa] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const uuid = this.extractUuid(mangaId);
		if (!uuid) throw new Error(`Invalid artlapsa id: ${mangaId}`);

		const path = this.toMangaId(uuid);
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			$('h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('title')
				.text()
				.replace(/\s*[-|].*Art Lapsa.*$/i, '')
				.trim();

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('img[src*="cdn.artlapsa.com/series/"]').first().attr('src') ||
			'';
		cover = this.normalizeCover(cover, uuid);

		const synopsis =
			$('[class*="synopsis"], [class*="description"], .summary')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('meta[name="description"]').attr('content')?.trim() ||
			'';

		const author =
			this.getLabeledValue($, 'Author') ||
			$('a[href*="author"]').first().text().trim() ||
			'';
		const artist =
			this.getLabeledValue($, 'Artist') ||
			$('a[href*="artist"]').first().text().trim() ||
			'';
		const statusRaw = this.getLabeledValue($, 'Status') || 'Ongoing';
		const formatRaw =
			this.getLabeledValue($, 'Format') ||
			this.getLabeledValue($, 'Type') ||
			'Manga';

		const authors: string[] = [];
		for (const a of [author, artist]) {
			const v = (a || '').trim();
			if (v && !/^unknown$/i.test(v) && !authors.includes(v)) authors.push(v);
		}

		const genres: string[] = [];
		$('a[href*="/genres/"]').each((_, el) => {
			const g = $(el).text().replace(/\s+/g, ' ').trim();
			if (g && !genres.includes(g)) genres.push(g);
		});

		const altTitles: string[] = [];
		$('h1')
			.first()
			.parent()
			.find('p, span, h2')
			.each((_, el) => {
				const t = $(el).text().replace(/\s+/g, ' ').trim();
				if (
					t &&
					t !== title &&
					t.length < 120 &&
					!/chapter|ongoing|complete|author|artist/i.test(t)
				) {
					if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(t) || t !== title) {
						if (!altTitles.includes(t)) altTitles.push(t);
					}
				}
			});

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('.chapter-card').each((_, card) => {
			const $card = $(card);
			const $a = $card.find('a[href*="/read/"]').first();
			const href = $a.attr('href') || '';
			const chUuid = this.extractUuid(href);
			if (!chUuid) return;

			const id = this.toChapterId(chUuid);
			if (seen.has(id)) return;
			seen.add(id);

			const rawText = $card.text().replace(/\s+/g, ' ').trim();
			const number = this.parseChapterNumber(rawText);
			if (Number.isNaN(number)) return;

			const $badge = $card.find('.chapter-lock-badge').first();
			const locked = $badge.length > 0;

			const date = this.parseDateFromText(rawText);

			chapters.push({
				id,
				title: `Chapter ${number}`,
				number,
				date: date || undefined,
				isLocked: locked ? true : undefined
			});
		});

		if (chapters.length === 0) {
			$('a[href*="/read/"]').each((_, el) => {
				const $a = $(el);
				const href = $a.attr('href') || '';
				const chUuid = this.extractUuid(href);
				if (!chUuid) return;
				const id = this.toChapterId(chUuid);
				if (seen.has(id)) return;
				seen.add(id);
				const raw = $a.text().replace(/\s+/g, ' ').trim();
				if (/start reading|latest chapter/i.test(raw)) return;
				const number = this.parseChapterNumber(raw);
				if (Number.isNaN(number)) return;
				chapters.push({
					id,
					title: `Chapter ${number}`,
					number,
					isLocked: undefined
				});
			});
		}

		chapters.sort((a, b) => (a.number || 0) - (b.number || 0));

		const metaLines = [
			altTitles.length && `Alternative: ${altTitles.join(' · ')}`,
			authors[0] && `Author: ${authors[0]}`,
			artist && artist !== authors[0] && `Artist: ${artist}`,
			formatRaw && `Type: ${formatRaw}`,
			`Language: English`
		].filter(Boolean);

		const description = [...metaLines, synopsis].filter(Boolean).join('\n');

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			type: this.mapType(formatRaw),
			status: this.mapStatus(statusRaw),
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
		const uuid = this.extractUuid(chapterId);
		if (!uuid) {
			console.error('[artlapsa] getChapterPages → bad id:', chapterId);
			return [];
		}

		try {
			const html = await this.fetchHtml(this.toChapterId(uuid));

			if (
				/"needsToUnlock"\s*:\s*true/.test(html) ||
				/needsToUnlock&quot;:true/.test(html)
			) {
				console.warn('[artlapsa] chapter locked:', chapterId);
				return [];
			}

			const pageCountMatch =
				html.match(/pageCount&quot;:(\d+)/) ||
				html.match(/"pageCount"\s*:\s*(\d+)/);
			const pageCount = pageCountMatch ? parseInt(pageCountMatch[1], 10) : 0;

			const baseMatch = html.match(
				/(https:\/\/cdn\.artlapsa\.com\/series\/[^"'\\\s]+\/chapters\/[^"'\\\s]+\/revisions\/[^"'\\\s]+)\/0*1\.(?:jpg|jpeg|png|webp)/i
			);

			if (baseMatch && pageCount > 0) {
				const base = baseMatch[1].replace(/\\/g, '');
				const extMatch = html.match(
					new RegExp(
						base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
							'/0*1\\.(jpg|jpeg|png|webp)',
						'i'
					)
				);
				const ext = (extMatch?.[1] || 'jpg').toLowerCase();
				const urls: string[] = [];
				for (let i = 1; i <= pageCount; i++) {
					const num = String(i).padStart(3, '0');
					urls.push(`${base}/${num}.${ext}`);
				}
				console.log(`[artlapsa] ${urls.length} pages → ${uuid}`);
				return urls;
			}

			const $ = cheerio.load(html);
			const found: string[] = [];
			const seen = new Set<string>();
			$('img').each((_, el) => {
				const src =
					$(el).attr('src') ||
					$(el).attr('data-src') ||
					($(el).attr('srcset') || '').split(/\s/)[0] ||
					'';
				if (!src || !/\/chapters\//i.test(src)) return;
				if (/thumbnail/i.test(src)) return;
				const abs = this.absUrl(src);
				if (seen.has(abs)) return;
				seen.add(abs);
				found.push(abs);
			});
			found.sort();
			console.log(`[artlapsa] fallback ${found.length} pages → ${uuid}`);
			return found;
		} catch (e) {
			console.error('[artlapsa] getChapterPages failed', chapterId, e);
			return [];
		}
	}
}
