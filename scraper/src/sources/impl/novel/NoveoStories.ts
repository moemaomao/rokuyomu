/**
 * Noveo Stories / Noveo Novels (noveostories.com) — Themesia WordPress
 * Path: scraper/src/sources/impl/novel/NoveoStories.ts
 *
 * - Latest: homepage "Latest Release" (.listupd .utao)
 * - Series list: /series/?order=update&page={n}
 * - Novel: /series/{slug}/
 * - Chapter: /{slug}/{chapter-slug}/
 * - Content: .entry-content / .epcontent / #readerarea
 * - Chapter title: "Chapter N"
 * - Paywall: .epl-price / lock icon
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://noveostories.com';
const PER_PAGE = 24;

function absUrl(href: string | undefined | null): string {
	if (!href) return '';
	const h = String(href).trim();
	if (!h || h === '#') return '';
	if (h.startsWith('//')) return `https:${h}`;
	if (/^https?:\/\//i.test(h)) return h;
	try {
		return new URL(h.startsWith('/') ? h : `/${h}`, BASE).href;
	} catch {
		return h;
	}
}

function pathOnly(href: string): string {
	try {
		const u = new URL(href.startsWith('http') ? href : absUrl(href));
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		return (href.startsWith('/') ? href : `/${href}`).replace(/\/$/, '') || '/';
	}
}

function cleanText(s: string): string {
	return (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function isSeriesPath(id: string): boolean {
	return /^\/series\/[a-z0-9\-]+$/i.test(id);
}

function parseChapterNumber(text: string): number {
	const m =
		text.match(/(?:ch\.?|chapter)\s*[.:\-]?\s*([\d.]+)/i) ||
		text.match(/[\/\-]ch[ap]*[.\-]?([\d.]+)/i) ||
		text.match(/(\d+(?:\.\d+)?)\s*$/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return 0;
}

function extractImg($el: cheerio.Cheerio<any>): string {
	if (!$el || !$el.find) return '';
	let best = '';
	$el.find('img').each((_: number, el: any) => {
		const a = (el as any).attribs || {};
		for (const key of ['data-src', 'data-lazy-src', 'src']) {
			const v = a[key];
			if (
				v &&
				!String(v).startsWith('data:') &&
				!/logo|icon|sprite|avatar|emoji|gravatar|placeholder/i.test(String(v))
			) {
				const url = absUrl(String(v).split('?')[0]);
				if (/wp-content\/uploads|i\d\.wp\.com/i.test(url)) {
					best = url;
					return false;
				}
				if (!best) best = url;
			}
		}
	});
	return best;
}

function hasPremiumMarker(text: string, html = ''): boolean {
	const s = (text || '') + ' ' + (html || '');
	if (!s.trim()) return false;
	if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(s)) return true;
	if (/\bepl-price\b|\bfa-lock\b|\bicon-lock\b|\bdashicons-lock\b/i.test(s))
		return true;
	if (/\bpremium\b|\blocked\b|\b\d+\s*coins?\b/i.test(s)) return true;
	return false;
}

function parseRelativeDate(text: string): number | undefined {
	const t = text.toLowerCase();
	const m = t.match(
		/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/
	);
	if (!m) {
		const abs = Date.parse(text);
		return Number.isNaN(abs) ? undefined : abs;
	}
	const n = parseInt(m[1], 10);
	const unit = m[2];
	const mult: Record<string, number> = {
		second: 1e3,
		minute: 6e4,
		hour: 36e5,
		day: 864e5,
		week: 6048e5,
		month: 2592e6,
		year: 31536e6
	};
	return Date.now() - n * (mult[unit] || 0);
}

export class NoveoStoriesSource extends BaseSource {
	id = 'noveostories';
	name = 'NoveoStories';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	// ─── Latest ──────────────────────────────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		const pageNum = Math.max(1, page);
		try {
			if (pageNum <= 1) {
				const html = await this.fetchHtml('/');
				const list = this.parseLatestSection(html);
				console.log(`[noveostories] latest page=1 n=${list.length}`);
				return list.slice(0, PER_PAGE);
			}
			const path = `/series/?order=update&page=${pageNum}`;
			const html = await this.fetchHtml(path);
			const list = this.parseSeriesGrid(html);
			console.log(`[noveostories] latest page=${pageNum} n=${list.length}`);
			return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[noveostories] getLatestManga', e);
			return [];
		}
	}

	private parseLatestSection(html: string): Manga[] {
		const $ = cheerio.load(html);
		const ordered: Manga[] = [];
		const seen = new Set<string>();

		let $root: any = $('body');
		$('h2, h3').each((_, h) => {
			if (/latest\s*release/i.test($(h).text())) {
				const $block: any = $(h).closest('.bixbox, .section, div');
				if ($block.find('.utao, .listupd').length) $root = $block;
			}
		});

		$root.find('.listupd .utao, .utao.styletree').each((_: number, el: any) => {
			const $card = $(el);
			const $a = $card.find('a.series[href*="/series/"]').first();
			const href = $a.attr('href') || '';
			const id = pathOnly(href);
			if (!isSeriesPath(id) || seen.has(id)) return;

			const title =
				cleanText($card.find('h3, h4').first().text()) ||
				cleanText($a.attr('title') || '') ||
				cleanText($a.text());
			if (!title || title.length < 2) return;

			const cover = extractImg($card);
			let latestChapter: number | undefined;
			const chText = cleanText(
				$card.find('.luf li a, ul li a').first().text()
			);
			const n = parseChapterNumber(chText);
			if (n > 0) latestChapter = n;

			let updatedAt: number | undefined;
			const dateText = cleanText(
				$card.find('.luf li span, ul li span').first().text()
			);
			if (dateText) updatedAt = parseRelativeDate(dateText);

			seen.add(id);
			ordered.push({
				id,
				title: title.slice(0, 200),
				cover,
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				...(latestChapter != null ? { latestChapter } : {}),
				...(updatedAt != null ? { updatedAt } : {})
			});
		});

		if (ordered.length < 5) {
			return this.parseSeriesGrid(html);
		}
		return ordered;
	}

	private parseSeriesGrid(html: string): Manga[] {
		const $ = cheerio.load(html);
		const ordered: Manga[] = [];
		const seen = new Set<string>();

		const push = (
			id: string,
			title: string,
			cover: string,
			latestChapter?: number,
			status?: string
		) => {
			if (!isSeriesPath(id) || seen.has(id) || !title || title.length < 2)
				return;
			seen.add(id);
			ordered.push({
				id,
				title: title.slice(0, 200),
				cover,
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status,
				...(latestChapter != null ? { latestChapter } : {})
			});
		};

		$('.maindet, .leftseries, .listupd .bs, .listupd .bsx, article.bs, .bsx').each(
			(_, el) => {
				const $card = $(el);
				const $a = $card
					.find('a[href*="/series/"]')
					.filter((__, a) =>
						isSeriesPath(pathOnly($(a).attr('href') || ''))
					)
					.first();
				const href = $a.attr('href') || '';
				const id = pathOnly(href);
				if (!isSeriesPath(id)) return;

				const title =
					cleanText(
						$card.find('h2, h3, h4, .tt, a.series').first().text()
					) ||
					cleanText($a.attr('title') || '') ||
					cleanText($a.text());
				if (!title || title.length < 2) return;
				if (/^(text mode|list mode)$/i.test(title)) return;

				const cover = extractImg($card);
				let latestChapter: number | undefined;
				const ep = cleanText(
					$card.find('.epxs, .nchapter, .luf li a').first().text()
				);
				const n = parseChapterNumber(ep);
				if (n > 0) latestChapter = n;

				let status: string | undefined;
				const st = cleanText($card.find('.status, .statuss').text());
				if (/complet/i.test(st)) status = 'Completed';
				else if (/ongoing/i.test(st)) status = 'Ongoing';

				push(id, title, cover, latestChapter, status);
			}
		);

		if (ordered.length < 5) {
			$('a[href*="/series/"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const id = pathOnly(href);
				if (!isSeriesPath(id) || seen.has(id)) return;
				const title =
					cleanText($(a).attr('title') || '') ||
					cleanText($(a).find('img').attr('alt') || '') ||
					cleanText($(a).text());
				if (!title || title.length < 2) return;
				if (/^(text mode|list mode|series)$/i.test(title)) return;
				const cover =
					absUrl(
						(
							$(a).find('img').attr('data-src') ||
							$(a).find('img').attr('src') ||
							''
						).split('?')[0]
					) || extractImg($(a).parent());
				push(id, title, cover);
			});
		}

		console.log(`[noveostories] parseSeriesGrid n=${ordered.length}`);
		return ordered;
	}

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page ?? 1);
		if (!q) return this.getLatestManga(page);

		const path =
			page <= 1
				? `/?s=${encodeURIComponent(q)}`
				: `/page/${page}/?s=${encodeURIComponent(q)}`;
		try {
			const html = await this.fetchHtml(path);
			const list = this.parseSeriesGrid(html);
			if (list.length) return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[noveostories] search', e);
		}
		const all = await this.getLatestManga(1);
		const qq = q.toLowerCase();
		return all.filter((m) => m.title.toLowerCase().includes(qq));
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = pathOnly(mangaId);
		if (!path.startsWith('/series/')) {
			path = `/series/${path.replace(/^\//, '')}`;
		}
		const fetchPath = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(fetchPath);
		const $ = cheerio.load(html);

		const title =
			cleanText($('h1.entry-title, h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '')
				.replace(/\s*[–\-]\s*Noveo.*$/i, '')
				.trim();
		if (!title) throw new Error('Novel not found');

		let cover =
			$('.thumb img, .seriestucontent img, img.wp-post-image')
				.first()
				.attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = absUrl(String(cover).split('?')[0]);

		let description = '';
		const $syn = $(
			'.entry-content .entry-content, .seriestuhead .entry-content, .entry-content, [itemprop="description"]'
		).first();
		if ($syn.length) {
			$syn.find('script, style, noscript').remove();
			description = cleanText($syn.text()).slice(0, 4000);
		}
		if (description.length < 40) {
			$('p').each((_, el) => {
				const t = cleanText($(el).text());
				if (t.length > 80 && !description) description = t.slice(0, 4000);
			});
		}

		const authors: string[] = [];
		$('a[href*="/writer/"], a[href*="/author/"], .fmed a').each((_, a) => {
			const n = cleanText($(a).text());
			if (
				n &&
				n.length < 80 &&
				!/genre|status|type|released/i.test(n) &&
				!authors.includes(n)
			) {
				authors.push(n);
			}
		});

		const genres: string[] = [];
		$('.mgen a, .genxed a, a[href*="/genre/"]').each((_, a) => {
			const n = cleanText($(a).text());
			if (n && n.length < 40 && !genres.includes(n)) genres.push(n);
		});

		let status = 'Ongoing';
		const infoText = cleanText($('.infotable, .spe, .fmed').text());
		if (/\bCompleted\b/i.test(infoText)) status = 'Completed';
		else if (/\bHiatus\b/i.test(infoText)) status = 'Hiatus';
		else if (/\bOngoing\b/i.test(infoText)) status = 'Ongoing';

		const chapters = this.parseChapterList($);

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
			...(chapters.length ? { latestChapter: chapters[0]?.number } : {})
		};
	}

	private parseChapterList($: cheerio.CheerioAPI): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		const rows = $('#chapterlist li, .eplister li, ul.clstyle li');
		if (rows.length) {
			rows.each((_, li) => {
				const $li = $(li);
				const $a = $li.find('a[href]').first();
				const href = $a.attr('href') || '';
				if (!href || href === '#') return;
				const id = pathOnly(href);
				if (id.startsWith('/series/') || seen.has(id)) return;

				const eplNum = cleanText($li.find('.epl-num').first().text());
				const eplTitle = cleanText($li.find('.epl-title').first().text());
				const eplDate = cleanText($li.find('.epl-date').first().text());
				const label = eplNum || eplTitle || cleanText($a.text());
				const number =
					parseChapterNumber(eplNum) ||
					parseChapterNumber(label) ||
					parseChapterNumber(id);
				if (number <= 0) return;

				const rowHtml = $li.html() || '';
				const rowText = cleanText($li.text());
				const rowClass =
					($li.attr('class') || '') +
					' ' +
					($a.attr('class') || '');
			
				const isLocked = hasPremiumMarker(eplNum, rowHtml) || hasPremiumMarker(rowText);


				let date: string | undefined;
				if (eplDate) {
					const abs = Date.parse(eplDate);
					if (!Number.isNaN(abs)) {
						date = new Date(abs).toISOString();
					} else {
						const rel = parseRelativeDate(eplDate);
						if (rel) date = new Date(rel).toISOString();
						else date = eplDate; // keep raw "August 6, 2026"
					}
				}

				seen.add(id);
				out.push({
					id,
					title: `Chapter ${number}`,
					number,
					...(date ? { date } : {}),
					...(isLocked ? { isLocked: true } : {})
				} as Chapter);
			});
		}

		if (out.length === 0) {
			const selectors = [
				'#chapterlist a',
				'.eplister a',
				'.chapter-list a'
			];
			for (const sel of selectors) {
				$(sel).each((_, el) => {
					const href = $(el).attr('href') || '';
					if (!href || href === '#') return;
					const id = pathOnly(href);
					if (id.startsWith('/series/') || seen.has(id)) return;
					const label = cleanText($(el).text());
					const number =
						parseChapterNumber(label) || parseChapterNumber(id);
					if (number <= 0) return;
					const $row = $(el).closest('li, tr, div');
					const rowHtml = $row.html() || '';
					const rowText = cleanText($row.text());
					const isLocked = hasPremiumMarker(label, rowHtml) || hasPremiumMarker(rowText);

					const eplDate = cleanText(
						$row.find('.epl-date, .chapterdate, time').first().text()
					);
					let date: string | undefined;
					if (eplDate) {
						const abs = Date.parse(eplDate);
						date = !Number.isNaN(abs)
							? new Date(abs).toISOString()
							: eplDate;
					}
					seen.add(id);
					out.push({
						id,
						title: `Chapter ${number}`,
						number,
						...(date ? { date } : {}),
						...(isLocked ? { isLocked: true } : {})
					} as Chapter);
				});
				if (out.length) break;
			}
		}

		out.sort((a, b) => b.number - a.number);
		console.log(
			`[noveostories] chapters=${out.length} locked=${out.filter((c) => (c as any).isLocked).length}`
		);
		return out;
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
		const path = pathOnly(chapterId);
		const fetchPath = path.endsWith('/') ? path : `${path}/`;
		const html = await this.fetchHtml(fetchPath);
		const $ = cheerio.load(html);

		const number = parseChapterNumber(
			cleanText($('h1, .entry-title').first().text()) || path
		);

		const $content = $(
			'.epcontent, .entry-content, #readerarea, .reading-content, .text-left'
		).first();
		$content.find('script, style, noscript, .code-block, .ads').remove();

		const paragraphs: string[] = [];
		$content.find('p').each((_, el) => {
			const t = cleanText($(el).text());
			if (
				t &&
				!/^(previous|next|table of contents|leave a reply)/i.test(t) &&
				!/you cannot copy content/i.test(t)
			) {
				paragraphs.push(t);
			}
		});

		let content = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
		if (!content || content.length < 40) {
			const plain = cleanText($content.text());
			if (plain.length > 40) {
				content = plain
					.split(/\n{2,}/)
					.map((p) => cleanText(p))
					.filter(Boolean)
					.map((p) => `<p>${escapeHtml(p)}</p>`)
					.join('');
			}
		}
		const bodyLower = cleanText($('body').text()).toLowerCase();
		const isPremiumWall =
			/premium content|login to access|login here|register here|members only/i.test(
				bodyLower
			) && paragraphs.length < 8;

		if (!content || content.length < 40 || isPremiumWall) {
			throw new Error(
				number > 0
					? `Chapter ${number} is premium / locked`
					: 'Chapter is premium / locked'
			);
		}

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		$('a[href]').each((_, el) => {
			const href = pathOnly($(el).attr('href') || '');
			if (!href || href.startsWith('/series/')) return;
			const label = cleanText($(el).text()).toLowerCase();
			const cls = ($(el).attr('class') || '').toLowerCase();
			if (!prevChapterId && (/prev/i.test(label) || /prev/i.test(cls))) {
				prevChapterId = href;
			}
			if (!nextChapterId && (/next/i.test(label) || /next/i.test(cls))) {
				nextChapterId = href;
			}
		});

		const $prev = $('a.ch-prev-btn, .prev a, a[rel="prev"]').first();
		const $next = $('a.ch-next-btn, .next a, a[rel="next"]').first();
		if ($prev.length)
			prevChapterId = pathOnly($prev.attr('href') || '') || prevChapterId;
		if ($next.length)
			nextChapterId = pathOnly($next.attr('href') || '') || nextChapterId;

		return {
			title: number > 0 ? `Chapter ${number}` : 'Chapter',
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default NoveoStoriesSource;
