/**
 * Kitsune Dawn adapter (kitsunedawn.com)
 *
 * Theme     : Laravel + Livewire (server-rendered HTML) — sister of Art Lapsa
 * Latest    : GET /latest?page=N  (~24 series / page)
 *             Homepage "Latest Chapters" section also yields 24 titles (page 1 fallback)
 * Search    : GET /search?q=&page=N
 * Detail    : GET /series/{uuid}
 * Chapter   : GET /read/{uuid}
 * Pages     : CDN sequential 001.jpg … N.jpg under revisions/
 *             pageCount + first image URL parsed from reader HTML
 *
 * Locked chapters: .chapter-lock-badge / coin price / needsToUnlock → isLocked
 *
 * ID format:
 *   manga   : /series/{seriesUuid}
 *   chapter : /series/{seriesUuid}/read/{chapterUuid}
 *             (legacy /read/{chapterUuid} still accepted)
 */

import { BaseSource } from '../../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import * as cheerio from 'cheerio';

export class KitsuneDawnSource extends BaseSource {
	id = 'kitsunedawn';
	name = 'Kitsune Dawn';
	baseUrl = 'https://kitsunedawn.com';
	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'en';
	private readonly CDN = 'https://cdn.kitsunedawn.com';

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

	private toChapterId(seriesUuid: string, chapterUuid: string): string {
		return `/series/${seriesUuid}/read/${chapterUuid}`;
	}

	private parseChapterParts(chapterId: string): {
		seriesUuid: string;
		chapterUuid: string;
	} {
		const raw = String(chapterId || '');
		const m = raw.match(/\/series\/([0-9a-f-]{36})\/read\/([0-9a-f-]{36})/i);
		if (m) return { seriesUuid: m[1], chapterUuid: m[2] };

		const m2 = raw.match(/\/read\/([0-9a-f-]{36})/i);
		if (m2) return { seriesUuid: '', chapterUuid: m2[1] };

		const only = this.extractUuid(raw);
		return { seriesUuid: '', chapterUuid: only };
	}

	async resolveMangaIdFromChapter(chapterId: string): Promise<string | null> {
		const { seriesUuid, chapterUuid } = this.parseChapterParts(chapterId);
		if (seriesUuid) return this.toMangaId(seriesUuid);

		if (!chapterUuid) return null;
		try {
			const html = await this.fetchHtml(`/read/${chapterUuid}`);
			const $ = cheerio.load(html);
			const href =
				$('a[href*="/series/"]').first().attr('href') ||
				$('meta[property="og:url"]').attr('content') ||
				'';
			const seriesFromOg = (
				href.match(/\/series\/([0-9a-f-]{36})/i) ||
				html.match(/\/series\/([0-9a-f-]{36})/i) ||
				[]
			)[1];
			return seriesFromOg ? this.toMangaId(seriesFromOg) : null;
		} catch {
			return null;
		}
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
		if (s.includes('webtoon')) return 'manhwa';
		if (s.includes('novel')) return 'novel';
		return 'manga';
	}

	private parseChapterNumber(text: string): number {
		const m =
			text.match(/Chapter\s*(\d+(?:\.\d+)?)/i) || text.match(/\b(\d+(?:\.\d+)?)\b/);
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
		const rel = t.match(
			/(\d+)\s*(m|min|mins|minute|minutes|h|hr|hour|hours|d|day|days|w|week|weeks)\s*ago/i
		);
		if (rel) {
			const n = parseInt(rel[1], 10);
			const unit = rel[2].toLowerCase();
			const d = new Date();
			if (/^min/.test(unit) || unit === 'm') d.setMinutes(d.getMinutes() - n);
			else if (/^h/.test(unit)) d.setHours(d.getHours() - n);
			else if (/^d/.test(unit)) d.setDate(d.getDate() - n);
			else if (/^w/.test(unit)) d.setDate(d.getDate() - n * 7);
			return d.toISOString().slice(0, 10);
		}
		return '';
	}

	private getLabeledValue($: cheerio.CheerioAPI, label: string): string {
		let value = '';
		$('dt').each((_, el) => {
			const $el = $(el);
			const lab = $el.text().replace(/\s+/g, ' ').trim();
			if (!new RegExp(`^${label}$`, 'i').test(lab)) return;
			const next = $el.next('dd');
			if (next.length) {
				value = next.text().replace(/\s+/g, ' ').trim();
				return false;
			}
		});
		if (value) return value;

		$('dt, th, span, div, p, li').each((_, el) => {
			const $el = $(el);
			const text = $el.text().replace(/\s+/g, ' ').trim();
			if (!new RegExp(`^${label}\\b`, 'i').test(text) && text.toLowerCase() !== label.toLowerCase()) {
				return;
			}
			if (text.toLowerCase() === label.toLowerCase() || new RegExp(`^${label}$`, 'i').test(text)) {
				const next = $el.next();
				if (next.length) {
					value = next.text().replace(/\s+/g, ' ').trim();
					return false;
				}
				const parentText = $el.parent().text().replace(/\s+/g, ' ').trim();
				const m = parentText.match(new RegExp(`${label}\\s+(.+?)(?:\\s{2,}|$)`, 'i'));
				if (m) value = m[1].split(/\s{2,}/)[0].trim();
			}
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
			return `${this.CDN}/series/webtoon/${uuid}/600x900.webp`;
		}
		return '';
	}

	private isChapterLocked($card: cheerio.Cheerio<any>): boolean {
		if ($card.find('.chapter-lock-badge, [class*="lock-badge"], [class*="chapter-lock"]').length) {
			return true;
		}
		const html = $card.html() || '';
		if (/needsToUnlock\s*[:=]\s*true/i.test(html)) return true;
		if (/\b(coin|premium|subscriber|paywall)\b/i.test(html) && /lock/i.test(html)) return true;
		const text = $card.text();
		if (/\b\d+\s*coins?\b/i.test(text)) return true;
		return false;
	}

	private parseSeriesCards($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		const pushFromPoster = ($poster: cheerio.Cheerio<any>) => {
			const $a =
				$poster.is('a') && ($poster.attr('href') || '').includes('/series/')
					? $poster
					: $poster.find('a[href*="/series/"]').first();
			const href = $a.attr('href') || '';
			const uuid = this.extractUuid(href);
			if (!uuid) return;

			const id = this.toMangaId(uuid);
			if (seen.has(id)) return;
			seen.add(id);

			const img = $poster.find('img[src*="series/"], img').first();
			let title =
				($a.attr('title') || '').trim() ||
				($poster.attr('title') || '').trim() ||
				(img.attr('alt') || '').replace(/\s*cover\s*$/i, '').trim() ||
				'';

			title = title
				.replace(/\s*\[Webtoon\].*$/i, '')
				.replace(/\s*\[Japanese\].*$/i, '')
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
			const posterText = $poster.text().replace(/\s+/g, ' ');
			let latestChapter: string | undefined;
			let maxN = -1;
			const re = /Chapter\s*(\d+(?:\.\d+)?)/gi;
			let mm: RegExpExecArray | null;
			while ((mm = re.exec(posterText)) !== null) {
				const n = parseFloat(mm[1]);
				if (n > maxN) {
					maxN = n;
					latestChapter = String(mm[1]);
				}
			}

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
		};

		$('.latest-poster').each((_, el) => {
			pushFromPoster($(el));
		});

		if (res.length < this.PER_PAGE) {
			$('a[href*="/series/"]').each((_, el) => {
				const $a = $(el);
				const href = $a.attr('href') || '';
				const uuid = this.extractUuid(href);
				if (!uuid) return;
				const id = this.toMangaId(uuid);
				if (seen.has(id)) return;

				const $poster = $a.closest('.latest-poster');
				if ($poster.length) {
					pushFromPoster($poster);
					return;
				}

				seen.add(id);
				const img = $a.find('img').first();
				let title =
					($a.attr('title') || '').trim() ||
					(img.attr('alt') || '').replace(/\s*cover\s*$/i, '').trim() ||
					$a.text().replace(/\s+/g, ' ').trim();
				title = title
					.replace(/\s*\[Webtoon\].*$/i, '')
					.replace(/\s*Chapter\s*\d+(?:\.\d+)?.*$/i, '')
					.replace(/\s+/g, ' ')
					.trim();
				if (!title || title.length < 2) return;

				const rawCover =
					img.attr('src') || img.attr('data-src') || '';
				const cover = this.normalizeCover(rawCover, uuid);

				const cardText = $a.text().replace(/\s+/g, ' ');
				const chMatch = cardText.match(/Chapter\s*(\d+(?:\.\d+)?)/i);

				res.push({
					id,
					sourceId: this.id,
					title,
					cover,
					lang: this.DEFAULT_LANG,
					type: 'manga',
					status: 'Ongoing',
					latestChapter: chMatch ? chMatch[1] : undefined
				});
			});
		}

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
			let list = this.parseSeriesCards($).slice(0, this.PER_PAGE);

			if (list.length === 0 && p === 1) {
				const home = await this.fetchHtml('/');
				const $h = cheerio.load(home);
				list = this.parseSeriesCards($h).slice(0, this.PER_PAGE);
			}

			console.log(`[kitsunedawn] latest page=${p} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[kitsunedawn] getLatestManga', e);
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
			console.log(`[kitsunedawn] search "${q}" page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[kitsunedawn] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const uuid = this.extractUuid(mangaId);
		if (!uuid) throw new Error(`Invalid kitsunedawn id: ${mangaId}`);

		const path = this.toMangaId(uuid);
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			$('h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('title')
				.text()
				.replace(/\s*[-|].*Kitsune Dawn.*$/i, '')
				.trim();

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('img[src*="cdn.kitsunedawn.com/series/"]').first().attr('src') ||
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
			$('a[href*="/authors/"]').first().text().trim() ||
			'';
		const artist =
			this.getLabeledValue($, 'Artist') ||
			$('a[href*="/artists/"]').first().text().trim() ||
			'';
		const statusRaw = this.getLabeledValue($, 'Status') || 'Ongoing';
		const formatRaw =
			this.getLabeledValue($, 'Format') ||
			this.getLabeledValue($, 'Type') ||
			'Manga';
		const released =
			this.getLabeledValue($, 'Released') ||
			this.getLabeledValue($, 'Published') ||
			this.getLabeledValue($, 'Release') ||
			'';

		const authors: string[] = [];
		for (const a of [author, artist]) {
			const v = (a || '').trim();
			if (v && !/^unknown$/i.test(v) && !authors.includes(v)) authors.push(v);
		}

		const genres: string[] = [];
		$('a[href*="/genres/"]').each((_, el) => {
			const g = $(el).text().replace(/\s+/g, ' ').trim();
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		const altTitles: string[] = [];
		$('body *').each((_, el) => {
			const $el = $(el);
			const own = $el.clone().children().remove().end().text().replace(/\s+/g, ' ').trim();
			if (!/^Alternative titles?$/i.test(own)) return;
			$el.parent()
				.find('span, li, p')
				.each((__, s) => {
					const t = $(s).text().replace(/\s+/g, ' ').trim();
					if (
						!t ||
						/^Alternative titles?$/i.test(t) ||
						/^\d+$/.test(t) ||
						t === title ||
						t.length > 120 ||
						/ongoing|complete|chapter|romance|josei|manga|japanese/i.test(t)
					) {
						return;
					}
					if (!altTitles.includes(t)) altTitles.push(t);
				});
			return false;
		});

		if (altTitles.length === 0) {
			$('h1')
				.first()
				.parent()
				.find('p, span, h2, li')
				.each((_, el) => {
					const t = $(el).text().replace(/\s+/g, ' ').trim();
					if (
						t &&
						t !== title &&
						t.length < 120 &&
						!/chapter|ongoing|complete|author|artist|alternative/i.test(t) &&
						(/[\u3040-\u30ff\u4e00-\u9fff]/.test(t) || /[A-Za-z].*\s/.test(t))
					) {
						if (!altTitles.includes(t)) altTitles.push(t);
					}
				});
		}

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('.chapter-card').each((_, card) => {
			const $card = $(card);
			const $a = $card.find('a[href*="/read/"]').first();
			const href = $a.attr('href') || '';
			const chUuid = this.extractUuid(href);
			if (!chUuid) return;

			const id = this.toChapterId(uuid, chUuid);
			if (seen.has(id)) return;
			seen.add(id);

			const rawText = $card.text().replace(/\s+/g, ' ').trim();
			const number = this.parseChapterNumber(
				$a.attr('aria-label') || $a.attr('title') || rawText
			);
			if (Number.isNaN(number)) return;

			const locked = this.isChapterLocked($card);
			const date = this.parseDateFromText(rawText);

			chapters.push({
				id,
				title: `Chapter ${number}`,
				number,
				date: date || undefined,
				...(locked ? { isLocked: true } : {})
			});
		});

		if (chapters.length === 0) {
			$('a[href*="/read/"]').each((_, el) => {
				const $a = $(el);
				const href = $a.attr('href') || '';
				const chUuid = this.extractUuid(href);
				if (!chUuid) return;
				const id = this.toChapterId(uuid, chUuid);
				if (seen.has(id)) return;
				seen.add(id);
				const raw = ($a.attr('aria-label') || $a.attr('title') || $a.text())
					.replace(/\s+/g, ' ')
					.trim();
				if (/start reading|latest chapter/i.test(raw)) return;
				const number = this.parseChapterNumber(raw);
				if (Number.isNaN(number)) return;
				const $card = $a.closest('.chapter-card, li, div');
				const locked = $card.length ? this.isChapterLocked($card) : false;
				chapters.push({
					id,
					title: `Chapter ${number}`,
					number,
					...(locked ? { isLocked: true } : {})
				});
			});
		}

		chapters.sort((a, b) => (a.number || 0) - (b.number || 0));

		const metaLines = [
			altTitles.length && `Alternative: ${altTitles.join(' · ')}`,
			authors[0] && `Author: ${authors[0]}`,
			artist && artist !== authors[0] && `Artist: ${artist}`,
			formatRaw && `Type: ${formatRaw}`,
			released && `Released: ${released}`,
			`Language: English`
		].filter(Boolean);

		const description = [...metaLines, synopsis].filter(Boolean).join('\n');

		const details: MangaDetails = {
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

		const extra = details as MangaDetails & {
			artists?: string[];
			altTitles?: string[];
			published?: string;
		};
		if (artist) extra.artists = [artist];
		if (altTitles.length) extra.altTitles = altTitles;
		if (released) extra.published = released;

		return details;
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const { chapterUuid } = this.parseChapterParts(chapterId);
		if (!chapterUuid) {
			console.error('[kitsunedawn] getChapterPages → bad id:', chapterId);
			return [];
		}

		try {
			const html = await this.fetchHtml(`/read/${chapterUuid}`);

			if (
				/"needsToUnlock"\s*:\s*true/.test(html) ||
				/needsToUnlock&quot;:true/.test(html)
			) {
				console.warn('[kitsunedawn] chapter locked:', chapterId);
				return [];
			}

			const pageCountMatch =
				html.match(/pageCount&quot;:(\d+)/) || html.match(/"pageCount"\s*:\s*(\d+)/);
			const pageCount = pageCountMatch ? parseInt(pageCountMatch[1], 10) : 0;

			const baseMatch = html.match(
				/(https:\/\/cdn\.kitsunedawn\.com\/series\/[^"'\\\s]+\/chapters\/[^"'\\\s]+\/revisions\/[^"'\\\s]+)\/0*1\.(?:jpg|jpeg|png|webp)/i
			);

			if (baseMatch && pageCount > 0) {
				const base = baseMatch[1].replace(/\\/g, '');
				const extMatch = html.match(
					new RegExp(
						base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/0*1\\.(jpg|jpeg|png|webp)',
						'i'
					)
				);
				const ext = (extMatch?.[1] || 'jpg').toLowerCase();
				const urls: string[] = [];
				for (let i = 1; i <= pageCount; i++) {
					const num = String(i).padStart(3, '0');
					urls.push(`${base}/${num}.${ext}`);
				}
				console.log(`[kitsunedawn] ${urls.length} pages → ${chapterUuid}`);
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
			console.log(`[kitsunedawn] fallback ${found.length} pages → ${chapterUuid}`);
			return found;
		} catch (e) {
			console.error('[kitsunedawn] getChapterPages failed', chapterId, e);
			return [];
		}
	}
}
