/**
 * Dobytranslations.com — Themesia novel theme
 * https://dobytranslations.com/
 *
 * Path: scraper/src/sources/impl/novel/DobyTranslations.ts
 *
 * - Homepage Latest Release: .listupd .utao / .epic-card
 * - Series list: /series/?status=&type=&order=update (+ ?page=N)
 * - Novel: /series/{slug}/
 * - Chapter: /{slug}-{n}/  (root path, not under /series/)
 * - Paywall: .chapter-link.is-premium / .premium-star / .coin-price-pill → isLocked
 * - Chapter titles shortened to "Chapter N"
 * - Target ~24 titles from Latest Release
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://dobytranslations.com';

function absUrl(href: string | undefined): string {
	if (!href) return '';
	if (href.startsWith('//')) return `https:${href}`;
	if (href.startsWith('http')) return href;
	try {
		return new URL(href, BASE).href;
	} catch {
		return href;
	}
}

function pathOnly(href: string): string {
	try {
		const u = new URL(href.startsWith('http') ? href : absUrl(href));
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		return href.startsWith('/') ? href.replace(/\/$/, '') || '/' : `/${href}`;
	}
}

function parseChapterNumber(text: string, fallback = 0): number {
	const t = (text || '').replace(/\s+/g, ' ').trim();
	const m =
		t.match(/chapter\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\bch\.?\s*(\d+(?:\.\d+)?(?:p\d+)?)/i) ||
		t.match(/(\d+(?:\.\d+)?)(?:p\d+)?/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function extractChapterNum(text: string): number | undefined {
	const n = parseChapterNumber(text, NaN);
	return Number.isNaN(n) ? undefined : n;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function isSeriesPath(path: string): boolean {
	const p = path.replace(/\/$/, '');
	return /^\/series\/[^/]+$/.test(p) && !/\/series\/(page|list-mode|feed)/i.test(p);
}

function isChapterPath(path: string): boolean {
	const p = path.replace(/\/$/, '');
	if (/^\/series\//.test(p)) return false;
	return /^\/[a-z0-9-]+-\d+(?:p\d+)?$/i.test(p);
}

export class DobyTranslationsSource extends BaseSource {
	id = 'dobytranslations';
	name = 'DobyTranslations';
	baseUrl = BASE;

	async getLatestManga(page = 1): Promise<Manga[]> {
		if (page <= 1) {
			const [home, s1, s2] = await Promise.all([
				this.parseHomeLatest().catch(() => [] as Manga[]),
				this.fetchSeriesPage(1).catch(() => [] as Manga[]),
				this.fetchSeriesPage(2).catch(() => [] as Manga[])
			]);
			return this.dedupeById([...home, ...s1, ...s2]).slice(0, 24);
		}
		return this.fetchSeriesPage(page);
	}

	private dedupeById(items: Manga[]): Manga[] {
		const seen = new Set<string>();
		const out: Manga[] = [];
		for (const m of items) {
			if (!m.id || seen.has(m.id)) continue;
			seen.add(m.id);
			out.push(m);
		}
		return out;
	}

	private async parseHomeLatest(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		const push = (item: Manga | null) => {
			if (!item || seen.has(item.id)) return;
			seen.add(item.id);
			list.push(item);
		};

		$('.listupd .utao, .listupd .epic-card, .utao.styletree, .excstf .utao').each((_, el) => {
			push(this.parseLatestCard($, el));
		});

		if (list.length < 12) {
			$('a.series-cover-link, a[href*="/series/"]').each((_, el) => {
				const href = $(el).attr('href') || '';
				const id = pathOnly(href);
				if (!isSeriesPath(id) || seen.has(id)) return;
				const parent = $(el).closest('.utao, .epic-card, .bs, .bsx, div');
				push(this.parseLatestCard($, parent.length ? parent.get(0) : el));
			});
		}

		return list;
	}

	private parseLatestCard($: cheerio.CheerioAPI, el: any): Manga | null {
		const seriesA =
			$(el).find('a.series-cover-link, a[href*="/series/"]').filter((_, x) => {
				return isSeriesPath(pathOnly($(x).attr('href') || ''));
			}).first().length
				? $(el)
						.find('a.series-cover-link, a[href*="/series/"]')
						.filter((_, x) => isSeriesPath(pathOnly($(x).attr('href') || '')))
						.first()
				: $(el).find('a.series-link, h3 a, .epic-title').closest('a').first();

		const href = seriesA.attr('href') || $(el).find('a[href*="/series/"]').first().attr('href') || '';
		if (!href) return null;
		const id = pathOnly(href);
		if (!isSeriesPath(id)) return null;

		const title =
			seriesA.attr('title') ||
			$(el).find('.epic-title, h3, .tt, .ntt').first().text().replace(/\s+/g, ' ').trim() ||
			seriesA.text().replace(/\s+/g, ' ').trim();
		if (!title || title.length < 2) return null;

		const cover =
			$(el).find('img').attr('src') ||
			$(el).find('img').attr('data-src') ||
			$(el).find('img').attr('data-lazy-src') ||
			'';

		const chText =
			$(el).find('.chapter-link, .chapter-row a, a.chap-text, .nchapter a').first().text() ||
			$(el).find('a[href*="-"]').filter((_, a) => isChapterPath(pathOnly($(a).attr('href') || ''))).first().text() ||
			'';
		const latestChapter = extractChapterNum(chText);

		const statusText =
			$(el).find('.epic-status, .status').first().text().replace(/\s+/g, ' ').trim() || undefined;
		const typeText =
			$(el).find('.epic-badge, .badge-yuri, .badge-male, .typez').first().text().replace(/\s+/g, ' ').trim() ||
			'novel';

		return {
			id,
			title,
			cover: absUrl((cover || '').split('?')[0]),
			sourceId: this.id,
			type: typeText || 'novel',
			lang: 'en',
			...(statusText && /ongoing|completed|hiatus|complete/i.test(statusText)
				? { status: statusText.match(/ongoing|completed|hiatus|complete/i)?.[0] }
				: {}),
			...(latestChapter != null ? { latestChapter } : {})
		};
	}

	private async fetchSeriesPage(page: number): Promise<Manga[]> {
		const path =
			page <= 1
				? '/series/?status=&type=&order=update'
				: `/series/?page=${page}&status=&type=&order=update`;
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('.listupd .bs, .listupd .bsx, .bs .bsx, .utao, article, .leftseries').each((_, el) => {
			const a = $(el)
				.find('a[href*="/series/"]')
				.filter((_, x) => isSeriesPath(pathOnly($(x).attr('href') || '')))
				.first();
			const href = a.attr('href') || '';
			if (!href) return;
			const id = pathOnly(href);
			if (seen.has(id)) return;
			seen.add(id);

			const title =
				a.attr('title') ||
				$(el).find('.tt, h2, h3, .ntt').first().text().replace(/\s+/g, ' ').trim() ||
				a.text().replace(/\s+/g, ' ').trim();
			if (!title || title.length < 2) return;

			const cover =
				$(el).find('img').attr('src') ||
				$(el).find('img').attr('data-src') ||
				'';
			const chText =
				$(el).find('.epxs, .chapter, a[href*="-"]').first().text() ||
				$(el).text().match(/Ch\.?\s*\d+/i)?.[0] ||
				'';
			const latestChapter = extractChapterNum(chText);

			list.push({
				id,
				title,
				cover: absUrl((cover || '').split('?')[0]),
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				...(latestChapter != null ? { latestChapter } : {})
			});
		});

		return list;
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = encodeURIComponent(query.trim());
		const path =
			page <= 1
				? `/?s=${q}`
				: `/page/${page}/?s=${q}`;
		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list: Manga[] = [];
			const seen = new Set<string>();

			$('.listupd .bs, .bsx, .utao, article, .leftseries').each((_, el) => {
				const a = $(el)
					.find('a[href*="/series/"]')
					.filter((_, x) => isSeriesPath(pathOnly($(x).attr('href') || '')))
					.first();
				const href = a.attr('href') || '';
				if (!href) return;
				const id = pathOnly(href);
				if (seen.has(id)) return;
				seen.add(id);
				const title =
					a.attr('title') ||
					$(el).find('.tt, h2, h3').first().text().replace(/\s+/g, ' ').trim() ||
					a.text().replace(/\s+/g, ' ').trim();
				if (!title || title.length < 2) return;
				const cover =
					$(el).find('img').attr('src') ||
					$(el).find('img').attr('data-src') ||
					'';
				list.push({
					id,
					title,
					cover: absUrl((cover || '').split('?')[0]),
					sourceId: this.id,
					type: 'novel',
					lang: 'en'
				});
			});

			if (!list.length) {
				$('a[href*="/series/"]').each((_, el) => {
					const href = $(el).attr('href') || '';
					const id = pathOnly(href);
					if (!isSeriesPath(id) || seen.has(id)) return;
					const title = ($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim();
					if (!title || title.length < 2) return;
					seen.add(id);
					list.push({
						id,
						title,
						cover: '',
						sourceId: this.id,
						type: 'novel',
						lang: 'en'
					});
				});
			}

			return list;
		} catch {
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		if (!path.includes('/series/')) {
			path = `/series${path.startsWith('/') ? path : `/${path}`}`;
		}
		path = path.replace(/\/$/, '');

		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const title =
			$('h1.entry-title').first().text().replace(/\s+/g, ' ').trim() ||
			$('.seriestuheader h1, .sertoinfo h1, h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/[|\-–]/)[0].trim() ||
			$('title').text().split(/[|\-–]/)[0].trim();

		if (!title || title.length < 2) {
			throw new Error('Series not found (empty title)');
		}

		const cover =
			$('.sertothumb img, .thumbook img, .ts-post-image').attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			$('.seriestucont img, .bigcontent img').first().attr('src') ||
			'';

		let description = '';
		const syn = $(
			'.entry-content.custom-synopsis-content, .sersysn, .seriestucontent, .entry-content, .desc, .summary'
		).first();
		if (syn.length) {
			description = syn
				.find('p')
				.map((_, p) => $(p).text().replace(/\s+/g, ' ').trim())
				.get()
				.filter(Boolean)
				.join('\n\n');
			if (!description) description = syn.text().replace(/\s+/g, ' ').trim();
		}
		if (!description) {
			description =
				$('meta[property="og:description"]').attr('content') ||
				$('meta[name="description"]').attr('content') ||
				'';
		}

		const authors: string[] = [];
		const artists: string[] = [];
		let altTitle = '';
		let status = 'Ongoing';
		let published = '';
		let typeLabel = 'novel';

		$('.infox .spe span, .sertoinfo span, .info-left span, .fmed').each((_, el) => {
			const raw = $(el).text().replace(/\s+/g, ' ').trim();
			const label = $(el).find('b, strong').first().text().toLowerCase().trim() || raw.split(':')[0]?.toLowerCase() || '';
			const links: string[] = [];
			$(el)
				.find('a')
				.each((_, a) => {
					const t = $(a).text().trim();
					if (t) links.push(t);
				});
			const valueText = $(el)
				.clone()
				.children('b, strong')
				.remove()
				.end()
				.text()
				.replace(/^[:\s]+/, '')
				.replace(/\s+/g, ' ')
				.trim();

			if (/author|penulis|writer/i.test(label)) {
				for (const n of links.length ? links : valueText ? [valueText] : []) {
					if (n && !authors.includes(n)) authors.push(n);
				}
			} else if (/artist|ilustrator/i.test(label)) {
				for (const n of links.length ? links : valueText ? [valueText] : []) {
					if (n && !artists.includes(n)) artists.push(n);
				}
			} else if (/alternative|native|other name/i.test(label)) {
				altTitle = links.join(', ') || valueText;
			} else if (/status/i.test(label)) {
				status = links[0] || valueText || status;
			} else if (/type|tipe/i.test(label)) {
				typeLabel = links[0] || valueText || typeLabel;
			} else if (/released|year|published/i.test(label)) {
				const y = valueText.match(/\b(19|20)\d{2}\b/);
				published = y ? y[0] : valueText.slice(0, 20);
			}
		});

		const genres: string[] = [];
		$('.sertogenre a, .genxed a, .mgen a, a[href*="/genre/"]').each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		if (!authors.length && artists.length) authors.push(...artists);

		const statusBadge = $('.epic-status, .status, .hot').first().text().replace(/\s+/g, ' ').trim();
		if (/completed|complete/i.test(statusBadge)) status = 'Completed';
		else if (/hiatus/i.test(statusBadge)) status = 'Hiatus';
		else if (/ongoing/i.test(statusBadge)) status = 'Ongoing';

		const chapters = this.parseChapters($);
		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const details: MangaDetails = {
			id: pathOnly(path),
			title,
			cover: absUrl((cover || '').split('?')[0]),
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters,
			type: typeLabel || 'novel',
			lang: 'en',
			...(chapters[0]?.number != null ? { latestChapter: chapters[0].number } : {})
		};

		const extra = details as MangaDetails & {
			artists?: string[];
			altTitles?: string[];
			published?: string;
		};
		if (artists.length) extra.artists = artists;
		if (altTitle) extra.altTitles = [altTitle];
		if (published) extra.published = published;

		return details;
	}

	private parseChapters($: cheerio.CheerioAPI): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		$('.eplister li, .eplisterfull li, .ep-chapter-list li, ul.clstyle li').each((i, el) => {
			const a = $(el).find('a').first();
			const href = a.attr('href') || '';
			if (!href) return;
			const id = pathOnly(href);
			if (seen.has(id)) return;
			if (!isChapterPath(id) && !/-\d+(?:p\d+)?\/?$/i.test(id)) return;
			seen.add(id);

			const rawTitle =
				$(el).find('.epl-title, .chapternum, .epl-num').first().text().replace(/\s+/g, ' ').trim() ||
				a.text().replace(/\s+/g, ' ').trim() ||
				a.attr('title') ||
				'';
			const num = parseChapterNumber(rawTitle || id, i + 1);
			const date =
				$(el).find('.epl-date, .chapterdate, .epl-update').first().text().replace(/\s+/g, ' ').trim() ||
				undefined;

			const isLocked =
				$(el).find('.coin-price-pill, .premium-star, .is-premium, .icon-holder.premium-star').length > 0 ||
				$(el).find('a.chapter-link.is-premium').length > 0 ||
				/coin-price|premium/i.test($(el).attr('class') || '') ||
				$(el).find('.price-val').length > 0;

			out.push({
				id,
				title: `Chapter ${num}`,
				number: num,
				date: date || undefined,
				...(isLocked ? { isLocked: true } : {})
			});
		});

		if (!out.length) {
			$('a[href]').each((i, el) => {
				const href = $(el).attr('href') || '';
				const id = pathOnly(href);
				if (!isChapterPath(id) || seen.has(id)) return;
				seen.add(id);
				const raw = ($(el).text() || $(el).attr('title') || '').replace(/\s+/g, ' ').trim();
				const num = parseChapterNumber(raw || id, i + 1);
				const parent = $(el).closest('li, div');
				const isLocked =
					parent.find('.coin-price-pill, .premium-star').length > 0 ||
					$(el).hasClass('is-premium');
				out.push({
					id,
					title: `Chapter ${num}`,
					number: num,
					...(isLocked ? { isLocked: true } : {})
				});
			});
		}

		return out;
	}

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		const path = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const bodyText = $('.epcontent, .entry-content, main').text();
		if (
			$('.coin-price-pill, .premium-star, #unlock-selected-btn, .dg-popup').length &&
			bodyText.replace(/\s+/g, ' ').trim().length < 100
		) {
			throw new Error('Chapter is locked / paywalled (coins)');
		}
		if (/unlock this chapter|buy coins|premium chapter|login to unlock/i.test(bodyText) && bodyText.length < 400) {
			throw new Error('Chapter is locked / paywalled');
		}

		const title =
			$('h1.entry-title, .entry-title, h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/[|\-–]/)[0].trim() ||
			'Chapter';

		let contentRoot = $('.ln-clean-content').first();
		if (!contentRoot.length) {
			contentRoot = $('.epcontent.entry-content, .epcontent, .entry-content, .reader-content').first();
		}

		const clone = contentRoot.clone();
		clone
			.find(
				'script, style, .sharedaddy, nav, .naveps, .bottomnav, .ads, .ad, iframe, .code-block, form, .coin-price-pill, ins, .adsbygoogle'
			)
			.remove();

		const parts: string[] = [];
		clone.find('p').each((_, p) => {
			const t = $(p).text().replace(/\s+/g, ' ').trim();
			if (!t || t.length < 2) return;
			if (/^(prev|next|share|support|comment|buy coins)/i.test(t) && t.length < 40) return;
			parts.push(`<p>${escapeHtml(t)}</p>`);
		});

		let content = parts.join('\n');
		if (!content || content.length < 40) {
			const raw = clone.text().replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
			const chunks = raw
				.split(/\n\s*\n/)
				.map((s) => s.replace(/\s+/g, ' ').trim())
				.filter((s) => s.length > 2);
			if (chunks.length >= 2) {
				content = chunks.map((s) => `<p>${escapeHtml(s)}</p>`).join('\n');
			} else if (raw.length > 40) {
				content = `<p>${escapeHtml(raw)}</p>`;
			}
		}

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		$('a[rel="prev"], .naveps a, .bottomnav a, .ch-prev-btn, a').each((_, a) => {
			const href = $(a).attr('href') || '';
			const text = ($(a).text() || $(a).attr('title') || '').toLowerCase();
			const rel = ($(a).attr('rel') || '').toLowerCase();
			const id = pathOnly(href.replace(/#.*$/, ''));
			if (!id || id === '/' || /^\/series\//.test(id)) return;
			if (!isChapterPath(id) && !/-\d+(?:p\d+)?\/?$/i.test(id)) return;

			if (rel === 'prev' || /prev|previous|older/i.test(text)) prevChapterId = id;
			if (rel === 'next' || /next|newer/i.test(text)) nextChapterId = id;
		});

		return {
			title,
			content:
				content ||
				'<p><em>Empty content — chapter may be locked or selector changed.</em></p>',
			prevChapterId,
			nextChapterId
		};
	}
}

export default DobyTranslationsSource;
