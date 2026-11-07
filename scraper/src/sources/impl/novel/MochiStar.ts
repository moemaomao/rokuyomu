/**
 * MochiStar Cafe — Fictioneer theme novel source
 * https://mochistar.org/
 *
 * Path: scraper/src/sources/impl/novel/MochiStar.ts
 *
 * - Homepage Latest: section "Recently updated" (.latest-updates / #mochi-updates)
 * - Stories list: /stories/ + /stories/page/{n}/
 * - Story: /story/{slug}/
 * - Chapter: /chapter/{slug}/  OR  /story/{slug}/{id}-c{n}/
 * - Paywall: .chapter-group._group-premium + .chapter-pricing-badge / .fa-lock → isLocked
 * - Chapter titles shortened to "Chapter N" (no long titles)
 * - Target ~24 titles on homepage with chapter badges
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://mochistar.org';

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
		t.match(/\bch\.?\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/[-_/]c(\d+(?:\.\d+)?)(?:\/|$)/i) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
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

function isStoryPath(path: string): boolean {
	const p = path.replace(/\/$/, '');
	return /^\/story\/[^/]+$/.test(p);
}

function isChapterPath(path: string): boolean {
	const p = path.replace(/\/$/, '');
	return (
		/^\/chapter\//.test(p) ||
		/^\/story\/[^/]+\/\d+-c[\d.]+$/i.test(p)
	);
}

export class MochiStarSource extends BaseSource {
	id = 'mochistar';
	name = 'MochiStar';
	baseUrl = BASE;

	async getLatestManga(page = 1): Promise<Manga[]> {
		if (page <= 1) {
			const [home, s1, s2] = await Promise.all([
				this.parseHomeLatest().catch(() => [] as Manga[]),
				this.fetchStoriesPage(1).catch(() => [] as Manga[]),
				this.fetchStoriesPage(2).catch(() => [] as Manga[])
			]);
			return this.dedupeById([...home, ...s1, ...s2]).slice(0, 24);
		}
		return this.fetchStoriesPage(page);
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

		let section = $('section.latest-updates, section.small-card-block.latest-updates').first();
		if (!section.length) {
			section = $('h2#mochi-updates').closest('header').next('section');
		}
		const cardSel = 'li.card._story-update, li.card._small, li.post-card, li.card';
		(section.length ? section.find(cardSel) : $(cardSel)).each((_, el) => {
			push(this.parseCard($, el));
		});

		$('.post-list._latest-chapters .post-list-item, li.post-list-item._latest-chapters, .latest-chapters .post-list-item').each(
			(_, el) => {
				push(this.parseListItem($, el));
			}
		);

		$('section.latest-stories li.card, .small-card-block.latest-stories li.card').each((_, el) => {
			push(this.parseCard($, el));
		});

		if (list.length < 12) {
			$('li.card, article.card, .card._small').each((_, el) => {
				push(this.parseCard($, el));
			});
		}

		return list;
	}

	private parseListItem($: cheerio.CheerioAPI, el: any): Manga | null {
		const storyA = $(el)
			.find('a[href*="/story/"]')
			.filter((_, x) => isStoryPath(pathOnly($(x).attr('href') || '')))
			.first();
		const href = storyA.attr('href') || '';
		if (!href) return null;
		const id = pathOnly(href);
		if (!isStoryPath(id)) return null;

		const title =
			storyA.attr('title') ||
			$(el).find('.post-list-item__title, .post-list-item__title._link, h3, h4').first().text().replace(/\s+/g, ' ').trim() ||
			storyA.text().replace(/\s+/g, ' ').trim();
		if (!title || title.length < 2) return null;

		const cover =
			$(el).find('img').attr('src') ||
			$(el).find('img').attr('data-src') ||
			'';

		const chText =
			$(el).find('a[href*="-c"], a[href*="/chapter/"]').first().text() ||
			$(el).find('.post-list-item__meta, .post-list-item__title').text() ||
			'';
		const latestChapter = extractChapterNum(chText);

		return {
			id,
			title,
			cover: absUrl((cover || '').split('?')[0]),
			sourceId: this.id,
			type: 'novel',
			lang: 'en',
			...(latestChapter != null ? { latestChapter } : {})
		};
	}

	private async fetchStoriesPage(page: number): Promise<Manga[]> {
		const path = page <= 1 ? '/stories/' : `/stories/page/${page}/`;
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();
		$('li.card, article.card, .card._small, li[class*="post-"], .post-list-item').each((_, el) => {
			const item = this.parseCard($, el) || this.parseListItem($, el);
			if (item && !seen.has(item.id)) {
				seen.add(item.id);
				list.push(item);
			}
		});
		return list;
	}

	private parseCard($: cheerio.CheerioAPI, el: any): Manga | null {
		const a =
			$(el).find('a.card__image, a[href*="/story/"]').filter((_, x) => {
				const h = pathOnly($(x).attr('href') || '');
				return isStoryPath(h);
			}).first().length
				? $(el)
						.find('a.card__image, a[href*="/story/"]')
						.filter((_, x) => isStoryPath(pathOnly($(x).attr('href') || '')))
						.first()
				: $(el).find('h3.card__title a, .card__title a, h3 a').first();

		const href = a.attr('href') || '';
		if (!href) return null;
		const id = pathOnly(href);
		if (!isStoryPath(id)) return null;

		const title =
			a.attr('title') ||
			$(el).find('.card__title a, h3.card__title, .card__title').first().text().replace(/\s+/g, ' ').trim() ||
			a.text().replace(/\s+/g, ' ').trim();
		if (!title || title.length < 2) return null;

		const cover =
			$(el).find('img').attr('src') ||
			$(el).find('img').attr('data-src') ||
			$(el).find('img').attr('data-lazy-src') ||
			'';

		const chLinkText =
			$(el).find('.card__link-list-link, .card__link-list a, ol.card__link-list a').first().text() ||
			$(el).find('a[href*="-c"]').first().text() ||
			'';
		const latestChapter = extractChapterNum(chLinkText);

		const statusText =
			$(el).find('.story__status, .status, .card-footer-icon').parent().text().replace(/\s+/g, ' ').trim() ||
			undefined;

		return {
			id,
			title,
			cover: absUrl((cover || '').split('?')[0]),
			sourceId: this.id,
			type: 'novel',
			lang: 'en',
			...(statusText && /ongoing|completed|hiatus|complete/i.test(statusText)
				? { status: statusText.match(/ongoing|completed|hiatus|complete/i)?.[0] }
				: {}),
			...(latestChapter != null ? { latestChapter } : {})
		};
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = encodeURIComponent(query.trim());
		const path =
			page <= 1 ? `/?s=${q}` : `/page/${page}/?s=${q}`;
		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list: Manga[] = [];
			const seen = new Set<string>();

			$('li.card, article.card, .card._small').each((_, el) => {
				const item = this.parseCard($, el);
				if (item && !seen.has(item.id)) {
					seen.add(item.id);
					list.push(item);
				}
			});

			$('a[href*="/story/"]').each((_, el) => {
				const href = $(el).attr('href') || '';
				const id = pathOnly(href);
				if (!isStoryPath(id) || seen.has(id)) return;
				const title = ($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim();
				if (!title || title.length < 2) return;
				seen.add(id);
				const parent = $(el).closest('li, article, div.card, .search-result');
				const cover =
					parent.find('img').attr('src') ||
					parent.find('img').attr('data-src') ||
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

			return list;
		} catch {
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		if (!path.includes('/story/')) {
			path = `/story${path.startsWith('/') ? path : `/${path}`}`;
		}
		path = path.replace(/\/$/, '');
		const chSuffix = path.match(/^(\/story\/[^/]+)\/\d+-c[\d.]+$/i);
		if (chSuffix) path = chSuffix[1];

		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const title =
			$('.story__identity-title').first().text().replace(/\s+/g, ' ').trim() ||
			$('h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/[|\-–]/)[0].trim() ||
			$('title').text().split(/[|\-–]/)[0].trim();

		if (!title || title.length < 2) {
			throw new Error('Story not found (empty title)');
		}

		const cover =
			$('.story__thumbnail img, .story__thumbnail-image').attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			$('meta[name="twitter:image"]').attr('content') ||
			'';

		let description = '';
		const summary = $('.story__summary, .story__summary.content-section').first();
		if (summary.length) {
			description = summary
				.find('p')
				.map((_, p) => $(p).text().replace(/\s+/g, ' ').trim())
				.get()
				.filter(Boolean)
				.join('\n\n');
			if (!description) description = summary.text().replace(/\s+/g, ' ').trim();
		}
		if (!description) {
			description =
				$('meta[property="og:description"]').attr('content') ||
				$('meta[name="description"]').attr('content') ||
				'';
		}

		const authors: string[] = [];
		$('.story__identity-meta a.author, .story__identity-meta a[href*="/author/"], a.author').each(
			(_, a) => {
				const name = $(a).text().replace(/\s+/g, ' ').trim();
				if (name && !authors.includes(name)) authors.push(name);
			}
		);
		if (!authors.length) {
			const byText = $('.story__identity-meta').text().replace(/\s+/g, ' ').trim();
			const m = byText.match(/by\s+(.+?)(?:\s*$|\s*[—–|])/i);
			if (m) {
				const name = m[1].trim();
				if (name) authors.push(name);
			}
		}

		const genres: string[] = [];
		$('.story__taxonomies a.tag-pill, .story__taxonomies a[href*="/genre/"], a._taxonomy-genre').each(
			(_, a) => {
				const g = $(a).text().replace(/\s+/g, ' ').trim();
				if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
			}
		);
	
		$('.story__tags-and-warnings a, a[href*="/tag/"]').each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		let status = 'Ongoing';
		const statusEl = $('.story__status, .story__meta-item.story__status').first();
		if (statusEl.length) {
			const t = statusEl.text().replace(/\s+/g, ' ').trim();
			if (/completed|complete|tamat/i.test(t)) status = 'Completed';
			else if (/hiatus/i.test(t)) status = 'Hiatus';
			else if (/ongoing/i.test(t)) status = 'Ongoing';
			else if (t) status = t;
		}

		let published = '';
		const dateEl = $('.story__date, .story__meta-item.story__date').first();
		if (dateEl.length) {
			published =
				dateEl.find('time').attr('datetime') ||
				dateEl.find('.hide-below-480, span').first().text().replace(/\s+/g, ' ').trim() ||
				dateEl.text().replace(/\s+/g, ' ').trim();
		}

		let rating: string | undefined;
		const ratingEl = $('.story__rating, .story__meta-item.story__rating').first();
		if (ratingEl.length) {
			rating = ratingEl.text().replace(/\s+/g, ' ').trim() || undefined;
		}

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
			type: 'novel',
			lang: 'en',
			...(chapters[0]?.number != null ? { latestChapter: chapters[0].number } : {})
		};

		const extra = details as MangaDetails & {
			artists?: string[];
			altTitles?: string[];
			rating?: string;
			published?: string;
		};
		if (rating) extra.rating = rating;
		if (published) extra.published = published;

		return details;
	}

	private parseChapters($: cheerio.CheerioAPI): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		$('.chapter-group__list-item, li.chapter-group__list-item').each((i, el) => {
			if ($(el).hasClass('_folding-toggle')) return;

			const a = $(el).find('a.chapter-group__list-item-link, a[href*="/chapter/"], a[href*="-c"]').first();
			const href = a.attr('href') || '';
			if (!href) return;
			const id = pathOnly(href);
			if (!isChapterPath(id) && !/\/story\/[^/]+\/\d+-c/i.test(id) && !/\/chapter\//.test(id)) {
				return;
			}
			if (seen.has(id)) return;
			seen.add(id);

			const rawTitle = (a.text() || a.attr('title') || '').replace(/\s+/g, ' ').trim();
			const num = parseChapterNumber(rawTitle || id, i + 1);
			const dateEl = $(el).find('.chapter-group__list-item-date, time').first();
			const date =
				dateEl.find('.list-view').first().text().replace(/\s+/g, ' ').trim() ||
				dateEl.find('.grid-view').first().text().replace(/\s+/g, ' ').trim() ||
				dateEl.clone().children().remove().end().text().replace(/\s+/g, ' ').trim() ||
				dateEl.attr('datetime') ||
				undefined;

			const inPremium =
				$(el).closest('.chapter-group._group-premium, .chapter-group[id*="premium"]').length > 0;
			const hasLock =
				$(el).find('.chapter-pricing-badge, .fa-lock, .fas.fa-lock, i.fa-lock').length > 0;
			const isLocked = inPremium || hasLock;

			out.push({
				id,
				title: `Chapter ${num}`,
				number: num,
				date: date || undefined,
				...(isLocked ? { isLocked: true } : {})
			});
		});

		if (out.length === 0) {
			$('a[href*="/chapter/"], a[href*="-c"]').each((i, el) => {
				const href = $(el).attr('href') || '';
				const id = pathOnly(href);
				if (seen.has(id)) return;
				if (!isChapterPath(id) && !/\/story\/[^/]+\/\d+-c/i.test(id)) return;
				seen.add(id);
				const raw = ($(el).text() || $(el).attr('title') || '').replace(/\s+/g, ' ').trim();
				const num = parseChapterNumber(raw || id, i + 1);
				const parent = $(el).closest('li, div');
				const isLocked =
					parent.find('.fa-lock, .chapter-pricing-badge').length > 0 ||
					parent.closest('._group-premium').length > 0;
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

		const locked =
			$('.chapter-pricing-badge, .fa-lock, .password-form, .mycred-sell-this, [class*="paywall"]').length >
				0 &&
			$('.chapter__content p, .chapter__content .content-section').text().trim().length < 80;
		if (
			locked ||
			/this chapter is locked|unlock this chapter|purchase this chapter|members only/i.test(
				$('.chapter__content, .chapter__article, main').text()
			)
		) {
			throw new Error('Chapter is locked / paywalled');
		}

		const title =
			$('.chapter__title').first().text().replace(/\s+/g, ' ').trim() ||
			$('h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/[|\-–]/)[0].trim() ||
			'Chapter';

		$(
			'.chapter__global-note, .chapter-note-hideable, .infobox.polygon, .consent-banner'
		).remove();

		const contentRoot = $(
			'.chapter__content, .chapter__content.content-section, article.chapter__article .content-section, .chapter__article'
		).first();

		contentRoot
			.find(
				'script, style, .sharedaddy, nav, .chapter__actions, .chapter__support, .chapter__comments, .comment-section, form, .ads, .ad, iframe, .chapter-pricing-badge, .chapter__global-note, .chapter-note-hideable, .infobox'
			)
			.remove();

		const paragraphs: string[] = [];
		contentRoot.find('p').each((_, p) => {
			const t = $(p).text().replace(/\s+/g, ' ').trim();
			if (!t || t.length < 2) return;
			if (/^(previous|next|share|support|comment)/i.test(t) && t.length < 30) return;
			if (
				/^notice\s*:/i.test(t) ||
				/join our discord|officially available on this site|happy reading!?$/i.test(t)
			) {
				return;
			}
			paragraphs.push(t);
		});

		let content = paragraphs.join('\n\n');
		if (!content || content.length < 40) {
			content = contentRoot.text().replace(/\s+/g, ' ').trim();
		}
	
		content = content
			.replace(
				/^Notice:\s*[^\n]*(?:Discord|translation updates|Happy reading!?)[^\n]*\n*/i,
				''
			)
			.trim();

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		$('a._navigation._prev, a.button._navigation._prev, a.micro-menu__prev, a[rel="prev"]').each(
			(_, a) => {
				const href = $(a).attr('href') || '';
				const id = pathOnly(href.replace(/#.*$/, ''));
				if (id && (isChapterPath(id) || /\/chapter\//.test(id) || /-c[\d.]+/i.test(id))) {
					prevChapterId = id;
				}
			}
		);
		$('a._navigation._next, a.button._navigation._next, a.micro-menu__next, a[rel="next"]').each(
			(_, a) => {
				const href = $(a).attr('href') || '';
				const id = pathOnly(href.replace(/#.*$/, ''));
				if (id && (isChapterPath(id) || /\/chapter\//.test(id) || /-c[\d.]+/i.test(id))) {
					nextChapterId = id;
				}
			}
		);

		if (!prevChapterId || !nextChapterId) {
			$('a[href*="/chapter/"], a[href*="-c"]').each((_, a) => {
				const text = ($(a).text() || $(a).attr('title') || '').toLowerCase();
				const href = $(a).attr('href') || '';
				const id = pathOnly(href.replace(/#.*$/, ''));
				if (!id) return;
				if (!prevChapterId && /prev|previous|older/i.test(text)) prevChapterId = id;
				if (!nextChapterId && /next|newer/i.test(text)) nextChapterId = id;
			});
		}

		return {
			title,
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default MochiStarSource;
