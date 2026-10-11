/**
 * Luna Toons adapter (lunatoons.net)
 *
 * Custom PHP + HTMX site.
 *
 * Latest   : GET /recently-updated?page=N  (~16–20 series / page)
 *            Homepage Featured + Recently Updated used as page-1 fallback (24)
 * Search   : GET /?browse&q=
 * Detail   : GET /{slug}
 * Chapters : GET /?_chapters_html=1&series_uid=&series_slug=  → JSON rows_html
 * Chapter  : GET /{slug}-chapter-{n}
 * Pages    : img.reader-page → https://cdn.meowing.org/uploads/{id}.avif
 * Locked   : data-ch-locked="1" / .ru-row--paid / window.__READER_LOCKED__
 *
 * ID format:
 *   manga   : /{slug}
 *   chapter : /{slug}-chapter-{n}
 */

import { BaseSource } from '../../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import * as cheerio from 'cheerio';

export class LunaToonsSource extends BaseSource {
	id = 'lunatoons';
	name = 'Luna Toons';
	baseUrl = 'https://lunatoons.net';
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

	protected override async fetchJson<T>(path: string): Promise<T> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const body = await fetchWithCf(url, {
			headers: {
				...this.headers,
				Referer: this.baseUrl + '/',
				Accept: 'application/json'
			}
		});
		return JSON.parse(body) as T;
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
		return id.replace(/\/+$/, '') || '/';
	}

	private isChapterPath(path: string): boolean {
		return /\/[^/]+-chapter-\d+(?:\.\d+)?\/?$/i.test(path);
	}

	private isSeriesSlug(slug: string): boolean {
		if (!slug) return false;
		if (
			/^(recently-updated|leaderboard|search|login|assets|components|api|browse)$/i.test(
				slug
			)
		) {
			return false;
		}
		if (/^chapter-\d+/i.test(slug)) return false;
		return /^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(slug) && !/-chapter-\d+$/i.test(slug);
	}

	private slugFromPath(path: string): string {
		const id = this.cleanId(path);
		const seg = id.replace(/^\//, '').split('/')[0] || '';
		return seg;
	}

	private seriesSlugFromChapterPath(path: string): string {
		const id = this.cleanId(path);
		const m = id.match(/^\/(.+)-chapter-(\d+(?:\.\d+)?)\/?$/i);
		return m ? m[1] : '';
	}

	private chapterNumberFromPath(path: string): number {
		const m = this.cleanId(path).match(/-chapter-(\d+(?:\.\d+)?)\/?$/i);
		return m ? parseFloat(m[1]) : NaN;
	}

	private toMangaId(slug: string): string {
		return `/${slug.replace(/^\/+/, '')}`;
	}

	private toChapterId(slug: string, num: number | string): string {
		return `/${slug.replace(/^\/+/, '')}-chapter-${num}`;
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
		if (s.includes('webtoon')) return 'manhwa';
		return 'manga';
	}

	private normalizeCover(cover: string): string {
		let c = (cover || '').trim();
		if (!c || c.startsWith('data:')) return '';
		c = this.absUrl(c);
		c = c.replace(/&amp;/g, '&');
		if (/wsrv\.nl\/\?url=/i.test(c)) {
			// strip tiny thumb params
			c = c.replace(/&w=\d+/gi, '').replace(/&q=\d+/gi, '');
		}
		return c;
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
		const iso = t.match(/\d{4}-\d{2}-\d{2}/);
		if (iso) return iso[0];
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

	private highestChapterFromText(text: string): string | undefined {
		let maxN = -1;
		let latest: string | undefined;
		const re = /Chapter\s*(\d+(?:\.\d+)?)/gi;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) {
			const n = parseFloat(m[1]);
			if (n > maxN) {
				maxN = n;
				latest = String(m[1]);
			}
		}
		return latest;
	}

	// ── Catalog parsers ──────────────────────────────────────────────────────

	private parseRuCards($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		$('article.ru-card').each((_, el) => {
			const $card = $(el);
			const $titleA = $card.find('.ru-title a[href]').first();
			const href = $titleA.attr('href') || $card.find('a.ru-cover').attr('href') || '';
			const slug = this.slugFromPath(href);
			if (!this.isSeriesSlug(slug)) return;

			const id = this.toMangaId(slug);
			if (seen.has(id)) return;
			seen.add(id);

			const title = $titleA.text().replace(/\s+/g, ' ').trim();
			if (!title || title.length < 2) return;

			const img = $card.find('img.ru-cover-img').first();
			const rawCover =
				img.attr('data-src') ||
				img.attr('data-thumb') ||
				img.attr('src') ||
				'';
			const cover = this.normalizeCover(rawCover);

			let latestChapter: string | undefined;
			const firstCh = $card.find('.ru-list .ru-ch, .ru-row .ru-ch').first().text();
			const mCh = firstCh.match(/(\d+(?:\.\d+)?)/);
			if (mCh) {
				latestChapter = mCh[1];
			} else {
				latestChapter = this.highestChapterFromText($card.text());
			}

			res.push({
				id,
				sourceId: this.id,
				title,
				cover,
				lang: this.DEFAULT_LANG,
				type: 'manga',
				status: 'Ongoing',
				latestChapter: latestChapter || undefined
			});
		});

		return res;
	}

	private parseGenericSeriesLinks($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		$('a[href]').each((_, el) => {
			const $a = $(el);
			const href = $a.attr('href') || '';
			const path = this.cleanId(href);
			if (this.isChapterPath(path)) return;
			const slug = this.slugFromPath(path);
			if (!this.isSeriesSlug(slug)) return;

			const id = this.toMangaId(slug);
			if (seen.has(id)) return;

			let title =
				($a.attr('title') || '').trim() ||
				$a.find('h2, h3, h4, .ru-title').first().text().replace(/\s+/g, ' ').trim() ||
				$a.text().replace(/\s+/g, ' ').trim();

			title = title
				.replace(/\s*Chapter\s*\d+(?:\.\d+)?.*$/i, '')
				.replace(/\s+/g, ' ')
				.trim();
			if (!title || title.length < 2 || /^(view all|read|more)$/i.test(title)) return;
			if (title.length > 120) title = title.slice(0, 120).trim();

			seen.add(id);

			const img = $a.find('img').first();
			const rawCover =
				img.attr('data-src') || img.attr('src') || '';
			const cover = this.normalizeCover(rawCover);
			const latestChapter = this.highestChapterFromText($a.text());

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
			const html = await this.fetchHtml(`/recently-updated?page=${p}`);
			const $ = cheerio.load(html);
			let list = this.parseRuCards($);

			if (p === 1 && list.length < this.PER_PAGE) {
				try {
					const home = await this.fetchHtml('/');
					const $h = cheerio.load(home);
					const homeCards = this.parseRuCards($h);
					const seen = new Set(list.map((x) => x.id));
					for (const m of homeCards) {
						if (seen.has(m.id)) continue;
						seen.add(m.id);
						list.push(m);
						if (list.length >= this.PER_PAGE) break;
					}
					if (list.length < this.PER_PAGE) {
						for (const m of this.parseGenericSeriesLinks($h)) {
							if (seen.has(m.id)) continue;
							if (!m.latestChapter) continue;
							seen.add(m.id);
							list.push(m);
							if (list.length >= this.PER_PAGE) break;
						}
					}
				} catch {
				}
			}

			list = list.slice(0, this.PER_PAGE);
			console.log(`[lunatoons] latest page=${p} → ${list.length} (with ch badge: ${list.filter((x) => x.latestChapter).length})`);
			return list;
		} catch (e) {
			console.error('[lunatoons] getLatestManga', e);
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
			const html = await this.fetchHtml(`/?browse&q=${encoded}`);
			const $ = cheerio.load(html);
			let list = this.parseGenericSeriesLinks($);
			list = list.filter(
				(m) =>
					m.title.length >= 2 &&
					!/^(recent|browse|login|search)$/i.test(m.title)
			);
			console.log(`[lunatoons] search "${q}" → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[lunatoons] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		let slug = this.slugFromPath(mangaId);
		const fromChapter = this.seriesSlugFromChapterPath(mangaId);
		if (fromChapter) slug = fromChapter;
		slug = slug.replace(/-chapter-\d+(?:\.\d+)?$/i, '');
		if (!this.isSeriesSlug(slug)) {
			throw new Error(`Invalid lunatoons id: ${mangaId} (slug=${slug})`);
		}

		const path = this.toMangaId(slug);
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			$('h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('title')
				.text()
				.replace(/\s*[|\-–].*Luna Toons.*$/i, '')
				.trim();

		let cover =
			$('img[alt="' + title.replace(/"/g, '\\"') + '"]').attr('data-src') ||
			$('img.ru-cover-img, img[data-src*="meowing"], img[data-src*="uploads"]')
				.first()
				.attr('data-src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		if (!cover) {
			$('img').each((_, el) => {
				const src = $(el).attr('data-src') || $(el).attr('src') || '';
				if (/meowing|uploads/i.test(src) && !/w=20/i.test(src)) {
					cover = src;
					return false;
				}
			});
		}
		cover = this.normalizeCover(cover);

		let statusRaw = 'Ongoing';
		let typeRaw = 'MANHWA';
		$('span, div, p').each((_, el) => {
			const $el = $(el);
			const own = $el.clone().children().remove().end().text().replace(/\s+/g, ' ').trim();
			if (/^Status$/i.test(own)) {
				const sib = $el.parent().text().replace(/\s+/g, ' ').trim();
				const m = sib.match(/Status\s+(\w+)/i);
				if (m) statusRaw = m[1];
			}
			if (/^Type$/i.test(own)) {
				const sib = $el.parent().text().replace(/\s+/g, ' ').trim();
				const m = sib.match(/Type\s+(\w+)/i);
				if (m) typeRaw = m[1];
			}
		});

		const bodyText = $('body').text();
		const st = bodyText.match(/\bStatus\s+(Ongoing|Completed|Hiatus)\b/i);
		if (st) statusRaw = st[1];
		const ty = bodyText.match(/\bType\s+(MANHWA|MANHUA|MANGA|NOVEL)\b/i);
		if (ty) typeRaw = ty[1];

		const genres: string[] = [];
		$('a[href*="browse&tag"], a[href*="tag%5B%5D"], a[href*="tag["]').each((_, el) => {
			const g = $(el).text().replace(/\s+/g, ' ').trim();
			if (g && g.length < 40 && !/browse/i.test(g) && !genres.includes(g)) {
				genres.push(g);
			}
		});

		let description = '';
		$('p').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (t.length > 80 && !description) description = t;
		});
		if (!description) {
			description = $('meta[name="description"]').attr('content')?.trim() || '';
		}

		const seriesUid =
			$('#chapters-list').attr('data-series-uid') ||
			$('[data-series-uid][data-series-slug]').attr('data-series-uid') ||
			$('[data-series-uid]').attr('data-series-uid') ||
			'';
		const seriesSlug =
			$('#chapters-list').attr('data-series-slug') ||
			$('[data-series-slug]').attr('data-series-slug') ||
			slug;

		let chapterCountHint = 0;
		const countText =
			$('#chapter-count-stat-value, #chapters-count-badge').first().text() ||
			'';
		const cm = countText.match(/(\d+)/);
		if (cm) chapterCountHint = parseInt(cm[1], 10) || 0;

		let chapters = await this.fetchChapterList(
			seriesUid,
			seriesSlug,
			html,
			chapterCountHint
		);

		if (chapters.length === 0 && chapterCountHint > 0) {
			for (let i = 1; i <= chapterCountHint; i++) {
				chapters.push({
					id: this.toChapterId(seriesSlug, i),
					title: `Chapter ${i}`,
					number: i
				});
			}
			console.log(`[lunatoons] synthesized ${chapters.length} chapters from count badge`);
		}

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			type: this.mapType(typeRaw),
			status: this.mapStatus(statusRaw),
			description,
			authors: [],
			genres,
			chapters,
			latestChapter:
				chapters.length > 0
					? String(chapters[chapters.length - 1].number)
					: undefined
		};
	}

	private async fetchChapterList(
		seriesUid: string,
		seriesSlug: string,
		seriesHtml?: string,
		chapterCountHint = 0
	): Promise<Chapter[]> {
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		const pushRow = (
			href: string,
			label: string,
			locked: boolean,
			dateStr: string
		) => {
			const path = this.cleanId(href);
			if (!this.isChapterPath(path)) return;
			if (seen.has(path)) return;
			seen.add(path);

			let num = this.chapterNumberFromPath(path);
			if (Number.isNaN(num)) {
				const mm = String(label).match(/(\d+(?:\.\d+)?)/);
				num = mm ? parseFloat(mm[1]) : NaN;
			}
			if (Number.isNaN(num)) return;

			const date = this.parseDateFromText(dateStr) || undefined;
			chapters.push({
				id: path,
				title: `Chapter ${num}`,
				number: num,
				date,
				...(locked ? { isLocked: true } : {})
			});
		};

		const pushFromCheerio = ($root: cheerio.CheerioAPI) => {
			$root('a.chapter-row, a[data-ch-url], a[href*="-chapter-"], a.ru-row').each(
				(_, el) => {
					const $a = $root(el);
					const href = $a.attr('data-ch-url') || $a.attr('href') || '';
					const label =
						$a.attr('data-ch-label') ||
						$a.attr('data-title') ||
						$a.find('.ru-ch').text() ||
						$a.text();
					const locked =
						$a.attr('data-ch-locked') === '1' ||
						$a.attr('data-ch-paid') === '1' ||
						$a.hasClass('ru-row--paid') ||
						$a.find('.ru-gate, [class*="lock"], [class*="coin"]').length > 0;
					const dateStr =
						$a.find('time').attr('datetime') || $a.text() || '';
					pushRow(href, label, locked, dateStr);
				}
			);
		};

		if (seriesUid || seriesSlug) {
			try {
				const params = new URLSearchParams({
					_chapters_html: '1',
					series_uid: seriesUid || '',
					series_slug: seriesSlug || ''
				});
				const data = await this.fetchJson<{
					success?: boolean;
					rows_html?: string;
					chapter_count?: number;
				}>(`/?${params.toString()}`);

				if (typeof data?.chapter_count === 'number' && data.chapter_count > 0) {
					chapterCountHint = Math.max(chapterCountHint, data.chapter_count);
				}

				if (data?.success && data.rows_html) {
					pushFromCheerio(cheerio.load(data.rows_html));
					console.log(
						`[lunatoons] chapters_html → ${chapters.length} (reported ${data.chapter_count ?? '?'})`
					);
				}
			} catch (e) {
				console.warn('[lunatoons] chapters_html failed', e);
			}
		}

		if (chapters.length === 0 && seriesHtml) {
			pushFromCheerio(cheerio.load(seriesHtml));
			console.log(`[lunatoons] chapters from series HTML → ${chapters.length}`);
		}

		if (chapters.length === 0 && chapterCountHint > 0 && seriesSlug) {
			for (let i = 1; i <= chapterCountHint; i++) {
				const path = this.toChapterId(seriesSlug, i);
				if (seen.has(path)) continue;
				seen.add(path);
				chapters.push({
					id: path,
					title: `Chapter ${i}`,
					number: i
				});
			}
			console.log(`[lunatoons] synthesized chapters 1..${chapterCountHint}`);
		}

		chapters.sort((a, b) => (a.number || 0) - (b.number || 0));
		return chapters;
	}

	async resolveMangaIdFromChapter(chapterId: string): Promise<string | null> {
		const slug = this.seriesSlugFromChapterPath(chapterId);
		if (slug && this.isSeriesSlug(slug)) return this.toMangaId(slug);
		return null;
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		if (!this.isChapterPath(path) && !path.includes('-chapter-')) {
			console.error('[lunatoons] getChapterPages → bad id:', chapterId);
			return [];
		}

		try {
			const html = await this.fetchHtml(path);

			if (
				/window\.__READER_LOCKED__\s*=\s*true/.test(html) ||
				/"needsToUnlock"\s*:\s*true/.test(html)
			) {
				console.warn('[lunatoons] chapter locked:', chapterId);
				return [];
			}

			const $ = cheerio.load(html);
			const found: string[] = [];
			const seen = new Set<string>();

			$('img.reader-page, img[class*="reader-page"]').each((_, el) => {
				const src =
					$(el).attr('src') ||
					$(el).attr('data-src') ||
					'';
				if (!src || !/uploads\//i.test(src)) return;
				let abs = this.absUrl(src).replace(/\\/g, '');
				const m = abs.match(
					/(?:wsrv\.nl\/\?url=)?(https?:\/\/cdn\.meowing\.org\/uploads\/[A-Za-z0-9._-]+)/i
				);
				if (m) abs = m[1].replace(/\\/g, '');
				if (seen.has(abs)) return;
				seen.add(abs);
				found.push(abs);
			});

			if (found.length > 0) {
				console.log(`[lunatoons] ${found.length} pages → ${path}`);
				return found;
			}

			const re =
				/https?:\/\/cdn\.meowing\.org\/uploads\/[A-Za-z0-9]+(?:\.(?:avif|jpg|jpeg|png|webp))?/gi;
			let mm: RegExpExecArray | null;
			while ((mm = re.exec(html)) !== null) {
				const abs = mm[0];
				if (!/\.(avif|jpg|jpeg|png|webp)$/i.test(abs)) continue;
				if (seen.has(abs)) continue;
				seen.add(abs);
				found.push(abs);
			}

			console.log(`[lunatoons] fallback ${found.length} pages → ${path}`);
			return found;
		} catch (e) {
			console.error('[lunatoons] getChapterPages failed', chapterId, e);
			return [];
		}
	}
}
