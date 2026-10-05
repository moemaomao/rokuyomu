/**
 * Primodial Translation (primodialtranslation.com)
 * Path: scraper/src/sources/impl/novel/PrimodialTranslation.ts
 *
 * Themesia-style WordPress novel site.
 *
 * Structure:
 *   Homepage Latest Release : .listupd .utao / .uta (series + Ch. N)
 *   All series (paginated)  : /series/?status=&type=&order=update&page=N
 *   Series page             : /series/{slug}/
 *   Chapter                 : /{slug}-chapter-{n}/
 *   Search                  : /?s={query}
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://primodialtranslation.com';
const PER_PAGE = 24;

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
		const u = new URL(
			href.startsWith('http')
				? href
				: `${BASE}${href.startsWith('/') ? '' : '/'}${href}`
		);
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		return href.startsWith('/') ? href.replace(/\/$/, '') || '/' : `/${href}`;
	}
}

function cleanText(s: string): string {
	return (s || '')
		.replace(/&#8217;/g, "'")
		.replace(/&#8216;/g, "'")
		.replace(/&#8220;/g, '"')
		.replace(/&#8221;/g, '"')
		.replace(/&#8230;/g, '…')
		.replace(/&amp;/g, '&')
		.replace(/&nbsp;/g, ' ')
		.replace(/<[^>]+>/g, '')
		.replace(/\u00a0/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function parseChapterNumber(text: string, href = ''): number {
	const t = `${text} ${href}`;
	let m = t.match(/(?:chapter|ch\.?)\s*[.\-_:]?\s*(\d+(?:\.\d+)?)/i);
	if (m) return parseFloat(m[1]);
	m = t.match(/-chapter-(\d+(?:\.\d+)?)(?:-|$|\/)/i);
	if (m) return parseFloat(m[1]);
	m = t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) return parseFloat(m[1]);
	return 0;
}

function chapterTitleFromNum(num: number): string {
	if (num > 0) {
		return Number.isInteger(num) ? `Chapter ${num}` : `Chapter ${num}`;
	}
	return 'Chapter';
}

function seriesIdFromHref(href: string): string | null {
	const p = pathOnly(href);
	const m = p.match(/^\/series\/([a-z0-9-]+)/i);
	return m ? `/series/${m[1]}` : null;
}

function seriesSlugFromId(id: string): string {
	const p = pathOnly(id);
	const m = p.match(/\/series\/([a-z0-9-]+)/i);
	if (m) return m[1];
	return p.replace(/^\//, '').split('/')[0] || '';
}

function adjacentChapterPaths(path: string): {
	prev: string | null;
	next: string | null;
} {
	const p = path.replace(/\/$/, '');
	const m = p.match(/^(.*-chapter-)(\d+(?:\.\d+)?)(?:-side-story.*)?$/i);
	if (m) {
		const n = parseFloat(m[2]);
		const prevN = n > 1 ? (Number.isInteger(n) ? n - 1 : Math.floor(n)) : null;
		const nextN = Number.isInteger(n) ? n + 1 : Math.ceil(n);
		return {
			prev: prevN != null && prevN > 0 ? `${m[1]}${prevN}` : null,
			next: `${m[1]}${nextN}`
		};
	}
	return { prev: null, next: null };
}

function isLockedEl($: cheerio.CheerioAPI, el: any): boolean {
	const root = $(el);
	if (root.find('.lock, .fa-lock, .fas.fa-lock, .premium, .premium-lock, [class*="lock"]').length)
		return true;
	if (root.closest('li').find('.lock, .fa-lock, .premium').length) return true;
	const cls = `${root.attr('class') || ''} ${root.closest('li').attr('class') || ''}`;
	if (/\b(premium|locked|paywall)\b/i.test(cls)) return true;
	return false;
}

function contentToParagraphs(html: string): string[] {
	if (!html?.trim()) return [];
	const $ = cheerio.load(`<div id="root">${html}</div>`);
	const root = $('#root');
	root
		.find(
			'script, style, .sharedaddy, .comments, #comments, nav, .nav-links, form, iframe, .adsbygoogle, .code-block, .ai-viewports, .epheader, .headpost, .chnav, .navi'
		)
		.remove();

	const parts: string[] = [];
	root.find('p').each((_, p) => {
		const t = cleanText($(p).text());
		if (!t || t.length < 2) return;
		if (
			/^(support|patreon|ko-fi|kofi|discord|join us|advertisement|prev|next|all chapter)/i.test(
				t
			)
		)
			return;
		if (/primodial/i.test(t) && t.length < 80) return;
		parts.push(`<p>${escapeHtml(t)}</p>`);
	});

	if (parts.length < 3) {
		const full = cleanText(root.text());
		if (full.length > 80) {
			for (const c of full
				.split(/\n{2,}/)
				.map((s) => s.trim())
				.filter((s) => s.length > 20)) {
				if (/^(support|patreon|prev|next)/i.test(c)) continue;
				parts.push(`<p>${escapeHtml(c)}</p>`);
			}
		}
	}
	return parts;
}

export class PrimodialTranslationSource extends BaseSource {
	id = 'primodialtranslation';
	name = 'Primodial Translation';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept:
			'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		try {
			return await fetchWithCf(url, {
				headers: { ...this.headers, Referer: this.baseUrl }
			});
		} catch (e) {
			console.warn(
				'[primodialtranslation] fetchWithCf failed, plain fetch',
				String(e).slice(0, 100)
			);
			const res = await fetch(url, { headers: this.headers });
			if (!res.ok) {
				const t = await res.text().catch(() => '');
				throw new Error(`fetchHtml ${res.status}: ${t.slice(0, 100)}`);
			}
			return await res.text();
		}
	}

	async getLatestManga(page = 1): Promise<Manga[]> {
		const p = Math.max(1, page);
		try {
			if (p === 1) {
				const seen = new Set<string>();
				const list: Manga[] = [];

				try {
					const fromHome = await this.parseLatestFromHomepage();
					for (const m of fromHome) {
						if (seen.has(m.id)) continue;
						seen.add(m.id);
						list.push(m);
						if (list.length >= PER_PAGE) break;
					}
				} catch (e) {
					console.warn(
						'[primodialtranslation] homepage latest fail',
						String(e).slice(0, 100)
					);
				}

				if (list.length < PER_PAGE) {
					try {
						const html = await this.fetchHtml(
							`/series/?status=&type=&order=update&page=1`
						);
						for (const m of this.parseSeriesCards(html)) {
							if (seen.has(m.id)) continue;
							seen.add(m.id);
							list.push(m);
							if (list.length >= PER_PAGE) break;
						}
					} catch (e) {
						console.warn(
							'[primodialtranslation] series fill fail',
							String(e).slice(0, 100)
						);
					}
				}

				if (list.length < PER_PAGE) {
					try {
						const html = await this.fetchHtml(
							`/series/?status=&type=&order=update&page=2`
						);
						for (const m of this.parseSeriesCards(html)) {
							if (seen.has(m.id)) continue;
							seen.add(m.id);
							list.push(m);
							if (list.length >= PER_PAGE) break;
						}
					} catch {
					}
				}

				console.log(
					`[primodialtranslation] latest page=1 n=${list.length}`
				);
				return list.slice(0, PER_PAGE);
			}

			const html = await this.fetchHtml(
				`/series/?status=&type=&order=update&page=${p}`
			);
			const list = this.parseSeriesCards(html);
			console.log(
				`[primodialtranslation] latest series page=${p} n=${list.length}`
			);
			return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[primodialtranslation] latest', e);
			return [];
		}
	}

	private async parseLatestFromHomepage(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		const $ = cheerio.load(html);
		const seen = new Set<string>();
		const list: Manga[] = [];

		$('.listupd .utao, .listupd .uta, .excstf .utao, .styletree').each(
			(_, el) => {
				const root = $(el);
				const seriesA = root
					.find('a.series[href*="/series/"], a[href*="/series/"]')
					.first();
				const href = seriesA.attr('href') || '';
				const id = seriesIdFromHref(href);
				if (!id || seen.has(id)) {
					if (id && seen.has(id)) {
						const existing = list.find((x) => x.id === id);
						root.find('a[href*="chapter"]').each((_, ca) => {
							const n = parseChapterNumber(
								$(ca).text(),
								$(ca).attr('href') || ''
							);
							if (
								existing &&
								n > (Number(existing.latestChapter) || 0)
							) {
								existing.latestChapter = Math.floor(n);
							}
						});
					}
					return;
				}

				const title =
					cleanText(
						seriesA.attr('oldtitle') ||
							seriesA.attr('title') ||
							root.find('h3, h2, .tt').first().text() ||
							seriesA.find('img').attr('alt') ||
							''
					) || cleanText(seriesA.text());

				if (!title || title.length < 2) return;

				const img = root.find('img').first();
				const cover = absUrl(
					img.attr('data-src') || img.attr('src') || ''
				);

				let latest = 0;
				root.find('a[href*="chapter"], .luf a, ul li a').each((_, ca) => {
					const n = parseChapterNumber(
						$(ca).text(),
						$(ca).attr('href') || ''
					);
					if (n > latest) latest = n;
				});

				seen.add(id);
				list.push({
					id,
					title,
					cover,
					sourceId: this.id,
					type: 'novel',
					lang: 'en',
					status: 'Ongoing',
					...(latest > 0 ? { latestChapter: Math.floor(latest) } : {})
				});
			}
		);

		if (list.length < 8) {
			for (const item of this.parseSeriesCards(html)) {
				if (seen.has(item.id)) continue;
				seen.add(item.id);
				list.push(item);
				if (list.length >= PER_PAGE) break;
			}
		}

		return list.slice(0, PER_PAGE);
	}

	private parseSeriesCards(html: string): Manga[] {
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		const push = (
			id: string,
			title: string,
			cover: string,
			latest?: number,
			status?: string
		) => {
			if (seen.has(id) || !title || title.length < 2) return;
			seen.add(id);
			list.push({
				id,
				title: title.slice(0, 200),
				cover,
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: status || 'Ongoing',
				...(latest != null && latest > 0
					? { latestChapter: Math.floor(latest) }
					: {})
			});
		};

		$('article.maindet, .maindet').each((_, el) => {
			const root = $(el);
			const a = root.find('a[href*="/series/"]').first();
			const href = a.attr('href') || '';
			const id = seriesIdFromHref(href);
			if (!id) return;

			const title =
				cleanText(
					a.attr('oldtitle') ||
						a.attr('title') ||
						root.find('h2, h3, .tt, .mdinfo h2').first().text() ||
						a.find('img').attr('alt') ||
						''
				) || cleanText(a.text());

			const img = root.find('img').first();
			const cover = absUrl(
				img.attr('data-src') || img.attr('src') || ''
			);

			let latest = 0;
			const chText = root.text();
			const chM = chText.match(/Ch\.?\s*(\d+)/i);
			if (chM) latest = parseInt(chM[1], 10);
			root.find('a[href*="chapter"]').each((_, ca) => {
				const n = parseChapterNumber(
					$(ca).text(),
					$(ca).attr('href') || ''
				);
				if (n > latest) latest = n;
			});

			let status = 'Ongoing';
			const st = root.text();
			if (/completed/i.test(st)) status = 'Completed';
			else if (/hiatus/i.test(st)) status = 'Hiatus';

			push(id, title, cover, latest || undefined, status);
		});

		$('.listupd .bs, .bsx, .bs').each((_, el) => {
			const root = $(el);
			const a = root.find('a[href*="/series/"]').first();
			const href = a.attr('href') || '';
			const id = seriesIdFromHref(href);
			if (!id) return;
			const title =
				cleanText(
					root.find('.tt, h2, h3').first().text() ||
						a.attr('title') ||
						a.find('img').attr('alt') ||
						''
				) || cleanText(a.text());
			const img = root.find('img').first();
			const cover = absUrl(
				img.attr('data-src') || img.attr('src') || ''
			);
			let latest = 0;
			const ep = cleanText(root.find('.epxs, .chapter').first().text());
			latest = parseChapterNumber(ep);
			push(id, title, cover, latest || undefined);
		});

		$('h2 a[href*="/series/"], h3 a[href*="/series/"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const id = seriesIdFromHref(href);
			if (!id) return;
			const title = cleanText($(a).text());
			const parent = $(a).closest('article, .post, .result, div');
			const img = parent.find('img').first();
			const cover = absUrl(
				img.attr('data-src') || img.attr('src') || ''
			);
			let latest = 0;
			parent.find('a[href*="chapter"]').each((_, ca) => {
				const n = parseChapterNumber(
					$(ca).text(),
					$(ca).attr('href') || ''
				);
				if (n > latest) latest = n;
			});
			push(id, title, cover, latest || undefined);
		});

		return list;
	}

	async searchManga(
		query: string,
		opts?: { page?: number }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page ?? 1);
		if (!q) return this.getLatestManga(page);

		try {
			const path =
				page <= 1
					? `/?s=${encodeURIComponent(q)}`
					: `/page/${page}/?s=${encodeURIComponent(q)}`;
			const html = await this.fetchHtml(path);
			const list = this.parseSeriesCards(html).filter((m) =>
				m.id.startsWith('/series/')
			);
			console.log(
				`[primodialtranslation] search q="${q}" page=${page} n=${list.length}`
			);
			return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[primodialtranslation] search', e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const path = pathOnly(mangaId);
		const seriesPath = path.includes('/series/')
			? path
			: `/series/${seriesSlugFromId(path)}`;
		const slug = seriesSlugFromId(seriesPath);

		const html = await this.fetchHtml(
			seriesPath.endsWith('/') ? seriesPath : `${seriesPath}/`
		);
		const $ = cheerio.load(html);

		let title =
			cleanText($('h1.entry-title, h1').first().text()) ||
			cleanText($('title').text().split(/[|\-–]/)[0]);

		let cover =
			absUrl(
				$('.thumb img, .series-thumb img, img.wp-post-image')
					.first()
					.attr('src') ||
					$('meta[property="og:image"]').attr('content') ||
					''
			) || '';
		if (cover.startsWith('//')) cover = `https:${cover}`;

		const authors: string[] = [];
		const artists: string[] = [];
		const genres: string[] = [];
		let status = 'Ongoing';
		let altTitle = '';
		let typeLabel = 'Web Novel';
		let released = '';

		const bodyText = cleanText(
			$('.info-desc, .wd-full, .entry-content, article').first().text()
		);

		$('.fmed, .imptdt, .info-item, .spe span, .tsinfo .imptdt').each(
			(_, el) => {
				const t = cleanText($(el).text());
				const lower = t.toLowerCase();
				if (lower.startsWith('author')) {
					const v = t.replace(/^author\s*:?\s*/i, '').trim();
					if (v && !authors.includes(v)) authors.push(v);
				} else if (lower.startsWith('artist')) {
					const v = t.replace(/^artist\s*:?\s*/i, '').trim();
					if (v && !artists.includes(v)) artists.push(v);
				} else if (lower.startsWith('status')) {
					const v = t.replace(/^status\s*:?\s*/i, '').trim();
					if (/complete/i.test(v)) status = 'Completed';
					else if (/hiatus/i.test(v)) status = 'Hiatus';
					else status = 'Ongoing';
				} else if (lower.startsWith('type')) {
					const v = t.replace(/^type\s*:?\s*/i, '').trim();
					if (v) typeLabel = v;
				} else if (
					lower.startsWith('posted') ||
					lower.startsWith('released') ||
					lower.startsWith('year')
				) {
					released = t.replace(/^(posted|released|year)\s*:?\s*/i, '').trim();
				} else if (
					lower.startsWith('alt') ||
					lower.startsWith('native') ||
					lower.startsWith('original')
				) {
					altTitle = t
						.replace(/^(alt(?:ernate)?\s*title|native|original)\s*:?\s*/i, '')
						.trim();
				}
			}
		);

		$('.mgen a, .genxed a, a[rel="tag"], .series-genres a').each((_, a) => {
			const g = cleanText($(a).text());
			if (!g || g.length < 2) return;
			if (/\(TL\)|Web Novel|Light Novel|Published/i.test(g)) return;
			if (!genres.includes(g)) genres.push(g);
		});

		if (/Completed/i.test($('.status, .hot').text() + bodyText.slice(0, 500)))
			status = 'Completed';
		else if (/Hiatus/i.test(bodyText.slice(0, 500))) status = 'Hiatus';

		let description = '';
		const synEl = $(
			'.entry-content, .wd-full, .synops, .series-synops, .desc'
		).first();
		if (synEl.length) {
			const paras: string[] = [];
			synEl.find('p').each((_, p) => {
				const t = cleanText($(p).text());
				if (!t || t.length < 10) return;
				if (/^(status|type|author|artist|genre)/i.test(t)) return;
				paras.push(t);
			});
			description = paras.join('\n\n').slice(0, 4000);
		}
		if (!description) {
			description = cleanText(
				$('meta[name="description"]').attr('content') || ''
			);
		}

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('.eplister a, #chapterlist a, .chbox a, ul.clstyle a').each((_, a) => {
			const href = $(a).attr('href') || '';
			if (!href || href === '#' || href.includes('{{')) return;
			const p = pathOnly(href);
			if (!/chapter/i.test(p) && !/chapter/i.test($(a).text())) return;

			const numText =
				cleanText($(a).find('.epl-num, .chapternum').first().text()) ||
				cleanText($(a).text());
			const num = parseChapterNumber(numText, p);
			if (!num) return;
			if (seen.has(p)) return;
			seen.add(p);

			const date =
				cleanText(
					$(a).find('.epl-date, .chapterdate').first().text()
				) || undefined;

			const locked = isLockedEl($, a);

			chapters.push({
				id: p,
				title: chapterTitleFromNum(num),
				number: num,
				date: date || undefined,
				isLocked: locked || undefined
			});
		});

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		if (!title) title = slug.replace(/-/g, ' ');

		const details: MangaDetails = {
			id: seriesPath.startsWith('/') ? seriesPath : `/${seriesPath}`,
			title,
			cover,
			sourceId: this.id,
			description,
			authors: authors.length
				? authors
				: artists.length
					? artists
					: [],
			status,
			genres,
			chapters,
			type: 'novel',
			lang: 'en',
			...(chapters.length
				? { latestChapter: chapters[0]?.number }
				: {})
		};

		const extra = details as MangaDetails & {
			altTitles?: string[];
			artists?: string[];
			released?: string;
			novelType?: string;
		};
		if (altTitle) extra.altTitles = [altTitle];
		if (artists.length) extra.artists = artists;
		if (released) extra.released = released;
		if (typeLabel) extra.novelType = typeLabel;

		console.log(
			`[primodialtranslation] details ${slug} chapters=${chapters.length} locked=${chapters.filter((c) => c.isLocked).length}`
		);

		return details;
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
		const adj = adjacentChapterPaths(path.replace(/\/$/, ''));
		let prevChapterId: string | null = adj.prev;
		let nextChapterId: string | null = adj.next;

		const html = await this.fetchHtml(
			path.endsWith('/') ? path : `${path}/`
		);
		const $ = cheerio.load(html);

		const h = cleanText($('h1.entry-title, h1').first().text());
		const num = parseChapterNumber(h, path);
		const title = chapterTitleFromNum(num) || h || 'Chapter';

		const contentEl = $('.epcontent, .entry-content, article .entry-content')
			.first();
		let contentHtml = contentEl.length ? contentEl.html() || '' : '';

		if (contentHtml) {
			const $c = cheerio.load(`<div id="c">${contentHtml}</div>`);
			$c('#c')
				.find(
					'.chnav, .navi, .headpost, .epheader, .sharedaddy, script, style, .adsbygoogle'
				)
				.remove();
			contentHtml = $c('#c').html() || contentHtml;
		}

		const parts = contentToParagraphs(contentHtml);
		const content =
			parts.length > 0
				? parts.join('\n')
				: '<p><em>Empty content — selector may have changed or chapter is locked.</em></p>';

		$('a').each((_, a) => {
			const t = cleanText($(a).text()).toLowerCase();
			const href = $(a).attr('href') || '';
			if (!href || href === '#') return;
			const p = pathOnly(href);
			if (t === 'prev' || t === 'previous' || t === '←') prevChapterId = p;
			if (t === 'next' || t === '→') nextChapterId = p;
		});
		const relPrev = $('a[rel="prev"]').attr('href');
		const relNext = $('a[rel="next"]').attr('href');
		if (relPrev) prevChapterId = pathOnly(relPrev);
		if (relNext) nextChapterId = pathOnly(relNext);

		console.log(
			`[primodialtranslation] content path=${path} paras=${parts.length} prev=${prevChapterId} next=${nextChapterId}`
		);

		return { title, content, prevChapterId, nextChapterId };
	}
}

export default PrimodialTranslationSource;
