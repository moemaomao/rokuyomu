/**
 * AkkNovel (www.akknovel.com) — Astro novel site
 * Path: scraper/src/sources/impl/novel/AkkNovel.ts
 *
 * - List: / + /series + /series/page/{n}
 * - Homepage: 24 titles (Latest Updated / series list)
 * - Detail: /series/{slug}
 * - Chapter: /series/{slug}/chapter-{n}-{padded}
 * - Chapter title → "Chapter N" (clean, no subtitle)
 * - Content: #chapter-content / .prose / article
 * - Prev/Next: a.btn with PREVIOUS / NEXT
 * - Semua chapter free (tidak ada paywall / isLocked)
 * - Search: /series?keyword={q}
 * - Uses fetchWithCf
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

function absUrl(base: string, href: string | undefined): string {
	if (!href) return '';
	if (href.startsWith('//')) return `https:${href}`;
	if (href.startsWith('http')) return href;
	try {
		return new URL(href, base).href;
	} catch {
		return href;
	}
}

function pathOnly(href: string, baseHost = 'https://www.akknovel.com'): string {
	try {
		const u = new URL(
			href.startsWith('http')
				? href
				: `${baseHost}${href.startsWith('/') ? '' : '/'}${href}`
		);
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		return href.startsWith('/') ? href.replace(/\/$/, '') : `/${href}`;
	}
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function decodeEntities(s: string): string {
	return s
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&nbsp;/g, ' ');
}

function parseChapterNumber(text: string, fallback = 0): number {
	const t = (text || '').replace(/\s+/g, ' ').trim();
	const pathM = t.match(/\/chapter-(\d+(?:\.\d+)?)/i);
	if (pathM) {
		const n = parseFloat(pathM[1]);
		if (!Number.isNaN(n)) return n;
	}
	const m =
		t.match(/(?:chapter|ch\.?)\s*[.\-_]?\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\bCh\.?\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function shortChapterTitle(number: number): string {
	if (number > 0) return `Chapter ${number}`;
	return 'Chapter';
}

function isSeriesPath(path: string): boolean {
	return (
		/^\/series\/[a-z0-9][a-z0-9\-]*$/i.test(path) &&
		!/\/chapter-/i.test(path) &&
		!/\/page\//i.test(path)
	);
}

function isChapterPath(path: string): boolean {
	return /^\/series\/[a-z0-9\-]+\/chapter-[\d.]+/i.test(path);
}

function cleanTitle(raw: string): string {
	return decodeEntities((raw || '').replace(/\s+/g, ' ').trim()).slice(0, 200);
}

function isValidTitle(title: string): boolean {
	const t = (title || '').replace(/\s+/g, ' ').trim();
	if (!t || t.length < 3) return false;
	if (
		/^(ongoing|completed|hiatus|series|home|search|read|bookmark|view all|more series|previous|next|all)$/i.test(
			t
		)
	)
		return false;
	return true;
}

export class AkkNovelSource extends BaseSource {
	id = 'akknovel';
	name = 'AkkNovel';
	baseUrl = 'https://www.akknovel.com';

	kind = 'novel' as const;

	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		return fetchWithCf(url, {
			headers: {
				...this.headers,
				Referer: this.baseUrl
			}
		});
	}

	// ─── Latest ──────────────────────────────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		return this.getLatestNovels(page);
	}

	async getLatestNovels(page = 1): Promise<Manga[]> {
		const p = Math.max(1, page);
		const per = 24;
		try {
			if (p <= 1) {
				const list = await this.parseHomeLatestUpdated();
				const slice = list.slice(0, per);
				const enriched = await this.enrichLatestChapters(slice);
				console.log(
					`[akknovel] latest page=1 → ${enriched.length} (with chapter badge: ${enriched.filter((m) => m.latestChapter != null).length})`
				);
				return enriched;
			}
			const list = await this.fetchSeriesPage(p);
			const slice = list.slice(0, per);
			const enriched = await this.enrichLatestChapters(slice);
			console.log(`[akknovel] latest page=${p} → ${enriched.length}`);
			return enriched;
		} catch (e) {
			console.error('[akknovel] latest', e);
			return [];
		}
	}

	private async enrichLatestChapters(items: Manga[]): Promise<Manga[]> {
		if (!items.length) return items;
		const concurrency = 6;
		const out = items.map((m) => ({ ...m }));

		const run = async (start: number) => {
			for (let i = start; i < out.length; i += concurrency) {
				const m = out[i];
				if (m.latestChapter != null && Number(m.latestChapter) > 0) continue;
				try {
					const html = await this.fetchHtml(m.id);
					const m1 = html.match(/Last\s*chapter\s*:\s*Ch\.?\s*(\d+(?:\.\d+)?)/i);
					const m2 = html.match(/\/chapter-(\d+(?:\.\d+)?)[-\/]/i);
					const n = m1
						? parseFloat(m1[1])
						: m2
							? parseFloat(m2[1])
							: 0;
					if (n > 0) out[i] = { ...m, latestChapter: n };
				} catch (e) {
					console.warn(`[akknovel] enrich ${m.id} failed`, String(e));
				}
			}
		};

		await Promise.all(
			Array.from({ length: Math.min(concurrency, out.length) }, (_, k) => run(k))
		);
		return out;
	}

	private dedupeById(items: Manga[]): Manga[] {
		const seen = new Set<string>();
		const out: Manga[] = [];
		for (const m of items) {
			if (seen.has(m.id)) continue;
			seen.add(m.id);
			out.push(m);
		}
		return out;
	}

	private async parseHomeLatestUpdated(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		const list: Manga[] = [];
		const seen = new Set<string>();
		const marker = html.search(/Latest\s*Updated/i);
		const endCandidates = [
			html.search(/About\s*Us/i),
			html.search(/Copyright\s*©/i),
			html.toLowerCase().indexOf('<footer')
		].filter((i) => typeof i === 'number' && i > (marker >= 0 ? marker : 0));
		const cutEnd =
			endCandidates.length > 0
				? Math.min(...endCandidates)
				: marker >= 0
					? marker + 120000
					: html.length;
		const sectionHtml = marker >= 0 ? html.slice(marker, cutEnd) : html;
		const $ = cheerio.load(sectionHtml);

		$('a.line-clamp-2, a[class*="line-clamp"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const path = pathOnly(href, this.baseUrl);
			if (!isSeriesPath(path) || seen.has(path)) return;

			const title = cleanTitle($(a).text());
			if (!isValidTitle(title)) return;

			const row = $(a).closest('.grid');
			let cover =
				row.find('img').first().attr('data-src') ||
				row.find('img').first().attr('src') ||
				'';
			if (!cover || /logo|icon|avatar/i.test(cover)) {
				const parent = $(a).parent().parent();
				cover =
					parent.find('img').first().attr('src') ||
					parent.find('img').first().attr('data-src') ||
					'';
			}
			if (/logo|icon|avatar/i.test(cover || '')) cover = '';

			const badgeText = row.find('.badge').first().text().replace(/\s+/g, ' ').trim();
			let status = 'Ongoing';
			if (/completed/i.test(badgeText)) status = 'Completed';
			else if (/hiatus/i.test(badgeText)) status = 'Hiatus';
			else if (/ongoing/i.test(badgeText)) status = 'Ongoing';

			const timeText = row.find('.opacity-70, [class*="opacity"]').last().text().trim();
			const updatedAt = this.parseRelativeTime(timeText);

			seen.add(path);
			list.push({
				id: path,
				title,
				cover: cover ? absUrl(this.baseUrl, cover.split('?')[0]) : '',
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status,
				...(updatedAt ? { updatedAt } : {})
			});
		});

		if (list.length < 5) {
			$('a[href*="/series/"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const path = pathOnly(href, this.baseUrl);
				if (!isSeriesPath(path) || seen.has(path)) return;

				const row = $(a).closest('.grid, div');
				const title = cleanTitle(
					row.find('a.line-clamp-2, a[class*="line-clamp"]').first().text() ||
						$(a).attr('title') ||
						$(a).text()
				);
				if (!isValidTitle(title)) return;

				const cover =
					row.find('img').first().attr('data-src') ||
					row.find('img').first().attr('src') ||
					$(a).find('img').attr('src') ||
					'';
				const badgeText = row.find('.badge').text();
				let status = 'Ongoing';
				if (/completed/i.test(badgeText)) status = 'Completed';

				seen.add(path);
				list.push({
					id: path,
					title,
					cover: cover ? absUrl(this.baseUrl, cover.split('?')[0]) : '',
					sourceId: this.id,
					type: 'novel',
					lang: 'en',
					status
				});
			});
		}

		console.log(`[akknovel] Latest Updated only → ${list.length}`);
		return list;
	}

	private parseRelativeTime(text: string): number | undefined {
		const t = (text || '').toLowerCase().trim();
		if (!t) return undefined;
		const now = Date.now();
		const m = t.match(
			/(\d+)\s*(minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years|min|hr|h|d|w)\s*ago/i
		);
		if (!m) {
			if (/just now|a moment|seconds?/i.test(t)) return now;
			if (/an hour ago/i.test(t)) return now - 3600_000;
			if (/a day ago|yesterday/i.test(t)) return now - 86400_000;
			return undefined;
		}
		const n = parseInt(m[1], 10);
		const unit = m[2].toLowerCase();
		const mult =
			/min/.test(unit)
				? 60_000
				: /hour|hr|^h$/.test(unit)
					? 3600_000
					: /day|^d$/.test(unit)
						? 86400_000
						: /week|^w$/.test(unit)
							? 604800_000
							: /month/.test(unit)
								? 2592000_000
								: 31536000_000;
		return now - n * mult;
	}

	private async fetchSeriesPage(page: number): Promise<Manga[]> {
		const paths =
			page <= 1
				? ['/series?sort=updatedAt', '/series']
				: [`/series/page/${page}?sort=updatedAt`, `/series/page/${page}`, `/series?sort=updatedAt&page=${page}`];

		for (const path of paths) {
			try {
				const html = await this.fetchHtml(path);
				const $ = cheerio.load(html);
				const list = this.parseSeriesCards($);
				if (list.length) return list;
			} catch {
			}
		}
		return [];
	}

	private parseSeriesCards($: cheerio.CheerioAPI): Manga[] {
		const list: Manga[] = [];
		const seen = new Set<string>();

		const push = (
			id: string,
			title: string,
			cover: string,
			status?: string,
			latest?: number
		) => {
			if (seen.has(id)) return;
			if (!isSeriesPath(id)) return;
			if (!isValidTitle(title)) return;
			seen.add(id);
			list.push({
				id,
				title: cleanTitle(title),
				cover: cover ? absUrl(this.baseUrl, cover.split('?')[0]) : '',
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: status || 'Ongoing',
				...(latest != null && latest > 0 ? { latestChapter: latest } : {})
			});
		};

		$('a.line-clamp-2, a[class*="line-clamp"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const path = pathOnly(href, this.baseUrl);
			if (!isSeriesPath(path)) return;

			const title = cleanTitle($(a).text());
			if (!isValidTitle(title)) return;

			const row = $(a).closest('.grid, [class*="grid"], article, div');
			let cover =
				row.find('img').first().attr('data-src') ||
				row.find('img').first().attr('src') ||
				'';
			if (/logo|icon|avatar/i.test(cover)) cover = '';

			const badgeText = row.find('.badge').first().text().replace(/\s+/g, ' ').trim();
			let status = 'Ongoing';
			if (/completed/i.test(badgeText)) status = 'Completed';
			else if (/hiatus/i.test(badgeText)) status = 'Hiatus';
			const rowText = row.text().replace(/\s+/g, ' ');
			let latest = 0;
			const chM = rowText.match(/(?:Ch\.?|Chapter)\s*(\d+(?:\.\d+)?)/i);
			if (chM) latest = parseFloat(chM[1]) || 0;

			push(path, title, cover, status, latest || undefined);
		});

		if (list.length < 8) {
			$('a[href*="/series/"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const path = pathOnly(href, this.baseUrl);
				if (!isSeriesPath(path) || seen.has(path)) return;

				const $a = $(a);
				const parent = $a.closest('article, .card, li, .grid, div');
				let title =
					$a.find('h2, h3, h4').first().text() ||
					parent.find('a.line-clamp-2, h2, h3, h4').first().text() ||
					$a.attr('title') ||
					$a.find('img').attr('alt') ||
					$a.text();
				title = cleanTitle(title);
				if (!isValidTitle(title)) {
					title = cleanTitle(path.split('/').pop()?.replace(/-/g, ' ') || '');
				}
				if (!isValidTitle(title)) return;

				let cover =
					$a.find('img').attr('data-src') ||
					$a.find('img').attr('src') ||
					parent.find('img').first().attr('data-src') ||
					parent.find('img').first().attr('src') ||
					'';
				if (/logo|icon|avatar/i.test(cover)) cover = '';

				const parentText = parent.text().replace(/\s+/g, ' ');
				let status = 'Ongoing';
				if (/\bCompleted\b/i.test(parentText)) status = 'Completed';
				else if (/\bHiatus\b/i.test(parentText)) status = 'Hiatus';

				let latest = 0;
				const chM = parentText.match(/(?:Ch\.?|Chapter)\s*(\d+(?:\.\d+)?)/i);
				if (chM) latest = parseFloat(chM[1]) || 0;

				push(path, title, cover, status, latest || undefined);
			});
		}

		return list;
	}

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		return this.searchNovels(query, opts);
	}

	async searchNovels(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim();
		if (!q) return this.getLatestNovels(opts?.page ?? 1);

		const page = Math.max(1, opts?.page ?? 1);
		try {
			const params = new URLSearchParams({ keyword: q });
			if (page > 1) params.set('page', String(page));
			const path = `/series?${params.toString()}`;
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list = this.parseSeriesCards($).slice(0, 24);
			const enriched = await this.enrichLatestChapters(list);
			console.log(`[akknovel] search "${q}" page=${page} → ${enriched.length}`);
			return enriched;
		} catch (e) {
			console.error('[akknovel] search', e);
			return [];
		}
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		return this.getNovelDetails(mangaId);
	}

	async getNovelDetails(novelId: string): Promise<MangaDetails> {
		let path = pathOnly(novelId, this.baseUrl);
		if (isChapterPath(path)) {
			path = path.replace(/\/chapter-[\d.]+.*$/i, '');
		}
		if (!path.startsWith('/series/')) {
			path = `/series/${path.replace(/^\//, '')}`;
		}

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title = cleanTitle(
			$('h1').first().text() ||
				$('meta[property="og:title"]').attr('content')?.split(/\s*[|\-–]\s*/)[0] ||
				path.split('/').pop()?.replace(/-/g, ' ') ||
				''
		);

		if (!title || title.length < 2) {
			throw new Error('Novel not found (empty title)');
		}

		let cover =
			$('img[src*="cdn.akknovel"]').first().attr('src') ||
			$('img[src*="cdn.akknovel"]').first().attr('data-src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		if (/logo\.svg|icon\.svg/i.test(cover || '')) {
			cover =
				$('img[src*="cdn.akknovel.com"]').eq(0).attr('src') ||
				$('img[src*="/20"]').first().attr('src') ||
				'';
		}
		cover = absUrl(this.baseUrl, (cover || '').split('?')[0]);

		let status = 'Ongoing';
		const nearTitle = $('h1').first().parent().text().replace(/\s+/g, ' ');
		if (/\bCompleted\b/i.test(nearTitle)) status = 'Completed';
		else if (/\bHiatus\b/i.test(nearTitle)) status = 'Hiatus';
		else if (/\bOnGoing\b/i.test(nearTitle)) status = 'Ongoing';
		else {
			const bodySlice = $('body').text().slice(0, 4000);
			if (/\bCompleted\b/i.test(bodySlice) && /Status/i.test(bodySlice)) {
				status = 'Completed';
			}
		}

		let description =
			$('[id*="description"], [class*="description"], .prose')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('meta[property="og:description"], meta[name="description"]')
				.attr('content')
				?.replace(/\s+/g, ' ')
				.trim() ||
			'';
		description = decodeEntities(description);
		description = description
			.replace(/^(Description|Chapters)\s*/i, '')
			.replace(/\s*All\s+\d+\s+Chapters[\s\S]*$/i, '')
			.trim();
		if (description.length > 4000) description = description.slice(0, 4000) + '…';

		const authors: string[] = [];
		const genres: string[] = [];
		let altTitle = '';
		let release = '';
		let artist = '';

		const labelMap: Array<{ re: RegExp; slot: 'author' | 'artist' | 'genre' | 'alt' | 'release' }> =
			[
				{ re: /^Authors?\s*:?\s*$/i, slot: 'author' },
				{ re: /^Authors?\s*:\s*(.+)/i, slot: 'author' },
				{ re: /^Artists?\s*:?\s*$/i, slot: 'artist' },
				{ re: /^Artists?\s*:\s*(.+)/i, slot: 'artist' },
				{ re: /^Genres?\s*:?\s*$/i, slot: 'genre' },
				{ re: /^Genres?\s*:\s*(.+)/i, slot: 'genre' },
				{ re: /^(Alt\.?\s*Title|Alternative)\s*:?\s*$/i, slot: 'alt' },
				{ re: /^(Alt\.?\s*Title|Alternative)\s*:\s*(.+)/i, slot: 'alt' },
				{ re: /^Release\s*:?\s*$/i, slot: 'release' },
				{ re: /^Release\s*:\s*(.+)/i, slot: 'release' }
			];

		$('dt, th, span, p, div, strong, b, label').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (!t || t.length > 120) return;
			for (const { re, slot } of labelMap) {
				const m = t.match(re);
				if (!m) continue;
				let value = m[1] || m[2] || '';
				if (!value) {
					const next = $(el).next('dd, span, div, p, a');
					value = next.text().replace(/\s+/g, ' ').trim();
					next.find('a').each((__, a) => {
						const g = $(a).text().replace(/\s+/g, ' ').trim();
						if (slot === 'genre' && g && g.length < 40 && !genres.includes(g)) {
							genres.push(g);
						}
						if (slot === 'author' && g && g.length < 80 && !authors.includes(g)) {
							authors.push(g);
						}
					});
				}
				value = value.replace(/\s+/g, ' ').trim();
				if (!value || value.length > 120) continue;
				if (slot === 'author' && !authors.includes(value) && value.length < 80) {
					authors.push(value);
				} else if (slot === 'artist' && !artist) {
					artist = value;
				} else if (slot === 'genre') {
					value.split(/[,|/]/).forEach((g) => {
						const x = g.trim();
						if (x && x.length < 40 && !genres.includes(x)) genres.push(x);
					});
				} else if (slot === 'alt' && !altTitle) {
					altTitle = value;
				} else if (slot === 'release' && !release) {
					release = value;
				}
			}
		});

		$('a[href*="/genre"], a[href*="/tag"], a[rel="tag"]').each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		if (artist && !authors.includes(artist)) {
		}

		const chapters = this.parseChapterList($, path);

		let latestFromHeader = 0;
		$('a[href*="/chapter-"]').each((_, a) => {
			const t = $(a).text().replace(/\s+/g, ' ').trim();
			if (/last\s*chapter/i.test(t) || /Ch\.\s*\d+/i.test(t)) {
				const n = parseChapterNumber(t + ' ' + ($(a).attr('href') || ''), 0);
				if (n > latestFromHeader) latestFromHeader = n;
			}
		});
		const headerText = $('h1').first().parent().text().replace(/\s+/g, ' ');
		const lm = headerText.match(/Last\s*chapter\s*:\s*Ch\.?\s*(\d+)/i);
		if (lm) {
			const n = parseFloat(lm[1]);
			if (!Number.isNaN(n) && n > latestFromHeader) latestFromHeader = n;
		}

		const latestChapter =
			latestFromHeader ||
			chapters[0]?.number ||
			(chapters.length
				? Math.max(...chapters.map((c) => c.number || 0))
				: undefined);

		const metaBits: string[] = [];
		if (altTitle) metaBits.push(`Alt: ${altTitle}`);
		if (artist) metaBits.push(`Artist: ${artist}`);
		if (release) metaBits.push(`Release: ${release}`);
		if (metaBits.length) {
			description = `${description}${description ? '\n\n' : ''}${metaBits.join(' · ')}`.trim();
		}

		console.log(
			`[akknovel] details ${path} → ${chapters.length} ch latest=${latestChapter}`
		);

		return {
			id: path,
			title,
			cover,
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters,
			type: 'novel',
			lang: 'en',
			...(latestChapter != null && latestChapter > 0 ? { latestChapter } : {})
		};
	}

	private parseChapterList($: cheerio.CheerioAPI, seriesPath: string): Chapter[] {
		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		const seriesPrefix = seriesPath.replace(/\/$/, '');

		const roots = $('#chapters .chapter-item a, #chapters a[href*="/chapter-"], .chapter-item a, a[href*="/chapter-"]');
		roots.each((_, a) => {
			const href = $(a).attr('href') || '';
			const full = pathOnly(href, this.baseUrl);
			if (!isChapterPath(full)) return;
			if (!full.startsWith(seriesPrefix + '/')) return;

			const id = full;
			if (seen.has(id)) return;
			seen.add(id);

			const rawText = $(a).text().replace(/\s+/g, ' ').trim();
			const number = parseChapterNumber(id + ' ' + rawText, 0);
			if (number <= 0) return;

			chapters.push({
				id,
				title: shortChapterTitle(number),
				number
			});
		});

		chapters.sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
		return chapters;
	}

	// ─── Chapter content ─────────────────────────────────────────────────

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		let path = pathOnly(chapterId, this.baseUrl);
		if (!path.startsWith('/series/')) {
			path = `/series/${path.replace(/^\//, '')}`;
		}

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const number = parseChapterNumber(path, 0);
		const rawTitle =
			$('h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/\s*[|\-–]\s*/)[0]?.trim() ||
			'';
		const title = shortChapterTitle(number > 0 ? number : parseChapterNumber(rawTitle, 1));

		const contentEl = $('#chapter-content, .prose, article').first();
		contentEl.find('script, style, noscript, iframe, .ads, .ad, .code-block, nav, header, footer').remove();

		let contentHtml = contentEl.html() || '';
		contentHtml = contentHtml
			.replace(/<script[\s\S]*?<\/script>/gi, '')
			.replace(/<style[\s\S]*?<\/style>/gi, '')
			.replace(/on\w+="[^"]*"/gi, '')
			.trim();

		if (!contentHtml || contentHtml.replace(/<[^>]+>/g, '').trim().length < 40) {
			const paras = contentEl
				.find('p')
				.map((_, p) => $(p).text().trim())
				.get()
				.filter((t) => t.length > 5);
			if (paras.length) {
				contentHtml = paras.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
			} else {
				const plain = contentEl.text().replace(/\s+/g, ' ').trim();
				if (plain.length > 40) {
					contentHtml = plain
						.split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z])/)
						.map((p) => p.trim())
						.filter((p) => p.length > 5)
						.map((p) => `<p>${escapeHtml(p)}</p>`)
						.join('\n');
				}
			}
		}

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		$('a').each((_, a) => {
			const text = $(a).text().replace(/\s+/g, ' ').trim().toUpperCase();
			const href = $(a).attr('href') || '';
			const full = pathOnly(href, this.baseUrl);
			if (!isChapterPath(full)) return;
			const cls = ($(a).attr('class') || '').toLowerCase();
			if (text === 'PREVIOUS' || text === 'PREV' || /\bprev\b/.test(cls)) {
				if (!/\bdisabled\b/.test(cls)) prevChapterId = full;
			}
			if (text === 'NEXT' || /\bnext\b/.test(cls)) {
				if (!/\bdisabled\b/.test(cls)) nextChapterId = full;
			}
		});

		if (!prevChapterId || !nextChapterId) {
			const m = path.match(/^(.*\/chapter-)(\d+)(.*)$/i);
			if (m) {
				const n = parseInt(m[2], 10);
				if (!prevChapterId && n > 1) {
					const pad = m[3] || '';
					prevChapterId = `${m[1]}${n - 1}${pad.replace(/^\d+/, String(n - 1).padStart(3, '0'))}`;
					const padMatch = path.match(/\/chapter-(\d+)-(\d+)/i);
					if (padMatch && n > 1) {
						const prevN = n - 1;
						prevChapterId = path.replace(
							/\/chapter-\d+-\d+/i,
							`/chapter-${prevN}-${String(prevN).padStart(3, '0')}`
						);
					}
				}
				if (!nextChapterId) {
					const padMatch = path.match(/\/chapter-(\d+)-(\d+)/i);
					if (padMatch) {
						const nextN = n + 1;
						nextChapterId = path.replace(
							/\/chapter-\d+-\d+/i,
							`/chapter-${nextN}-${String(nextN).padStart(3, '0')}`
						);
					}
				}
			}
		}

		console.log(
			`[akknovel] chapter ${path} → ${contentHtml.length}c prev=${prevChapterId} next=${nextChapterId}`
		);

		return {
			title,
			content: contentHtml || '<p>No content</p>',
			prevChapterId,
			nextChapterId
		};
	}
}

export default AkkNovelSource;
