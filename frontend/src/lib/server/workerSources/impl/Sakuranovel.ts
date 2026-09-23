/**
 * Sakuranovel.id — hybrid worker adapter (Cloudflare Worker)
 * Path: frontend/src/lib/server/workerSources/impl/Sakuranovel.ts
 *
 * Worker hanya butuh interface manga (BaseSource).
 * Jangan import types-novel — file itu hanya di scraper.
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types';

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

function pathOnly(href: string): string {
	try {
		const u = new URL(
			href.startsWith('http')
				? href
				: `https://sakuranovel.id${href.startsWith('/') ? '' : '/'}${href}`
		);
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		return href.startsWith('/') ? href : `/${href}`;
	}
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export class SakuranovelSource extends BaseSource {
	id = 'sakuranovel';
	name = 'Sakuranovel';
	baseUrl = 'https://sakuranovel.id';

	async getLatestManga(page = 1): Promise<Manga[]> {
		const path = page <= 1 ? '/series/' : `/series/page/${page}/`;
		const html = await this.fetchHtml(path);
		return this.parseSeriesCards(html);
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		try {
			const body = new URLSearchParams({
				action: 'data_fetch',
				keyword: query
			});
			const res = await fetch(`${this.baseUrl}/wp-admin/admin-ajax.php`, {
				method: 'POST',
				headers: {
					...this.headers,
					'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
					'X-Requested-With': 'XMLHttpRequest',
					Referer: this.baseUrl + '/',
					Origin: this.baseUrl
				},
				body: body.toString()
			});
			if (res.ok) {
				const html = await res.text();
				const $ = cheerio.load(html);
				const list: Manga[] = [];
				$('.searchbox').each((_, el) => {
					const a = $(el).find('a').first();
					const href = a.attr('href') || '';
					const title = a.attr('title') || a.text().trim();
					const cover = $(el).find('img').attr('src') || '';
					const status = $(el).find('.status').text().trim() || undefined;
					if (href && title) {
						list.push({
							id: pathOnly(href),
							title,
							cover: absUrl(this.baseUrl, cover.split('?')[0]),
							sourceId: this.id,
							type: 'novel',
							status,
							lang: 'id'
						});
					}
				});
				if (list.length) return list;
			}
		} catch {
			/* fall through */
		}

		const page = opts?.page ?? 1;
		const q = encodeURIComponent(query);
		const html = await this.fetchHtml(`/advanced-search/?title=${q}&page=${page}`);
		return this.parseSeriesCards(html);
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const root = $('.series .container .series-flex');
		const left = root.find('.series-flexleft');
		const right = root.find('.series-flexright');

		const title =
			left.find('.series-titlex h2').text().trim() ||
			$('h1').first().text().trim() ||
			$('title').text().split('|')[0].trim();

		const cover =
			left.find('img').attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';

		const description = right
			.find('.series-synops p')
			.map((_, el) => $(el).text().trim())
			.get()
			.filter(Boolean)
			.join('\n\n');

		const authors: string[] = [];
		left.find('ul.series-infolist li').each((_, el) => {
			const label = $(el).find('b').text().toLowerCase();
			if (label.includes('author') || label.includes('penulis') || label.includes('artist')) {
				$(el)
					.find('a, span')
					.each((_, a) => {
						const t = $(a).text().trim();
						if (t && !authors.includes(t)) authors.push(t);
					});
			}
		});

		const genres: string[] = [];
		right.find('.series-genres a').each((_, el) => {
			const g = $(el).text().trim();
			if (g) genres.push(g);
		});

		let status = 'Ongoing';
		left.find('.series-infoz.block span').each((_, el) => {
			const cls = ($(el).attr('class') || '').toLowerCase();
			const t = $(el).text().trim();
			if (cls.includes('status') || /ongoing|completed|tamat|hiatus/i.test(t)) {
				status = t || status;
			}
		});

		const chapters: Chapter[] = [];
		right.find('ul.series-chapterlists li').each((i, el) => {
			const a = $(el).find('a').first();
			const href = a.attr('href') || '';
			const ctitle = a.attr('title') || a.text().trim();
			const date = $(el).find('span.date').text().trim() || undefined;
			if (href && ctitle) {
				chapters.push({
					id: pathOnly(href),
					title: ctitle,
					number: i + 1,
					date
				});
			}
		});

		return {
			id: pathOnly(path),
			title,
			cover: absUrl(this.baseUrl, cover),
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters,
			type: 'novel',
			lang: 'id'
		};
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

	const bodyText = $('body').text();
	if (
		/just a moment|cf-browser-verification|challenge-platform|verify you are human/i.test(
			html
		) &&
		bodyText.length < 500
	) {
		throw new Error('Cloudflare blocked this request');
	}

	const title =
		$('h2.title-chapter').first().text().trim() ||
		$('h1').first().text().trim() ||
		$('title').text().split('|')[0].trim() ||
		'Chapter';

	const containers = [
		'main .content .asdasd',
		'main .content',
		'.entry-content',
		'.reading-content',
		'#chapter-content',
		'.chapter-content',
		'article .content',
		'article',
		'.post-content',
		'#content'
	];

	let contentHtml = '';
	for (const sel of containers) {
		const el = $(sel).first();
		if (!el.length) continue;

		const clone = el.clone();
		clone.find('script, style, iframe, .ads, .ad, nav, .nav, .reader-settings, .comments').remove();

		const paras = clone.find('p');
		if (paras.length >= 2) {
			const parts: string[] = [];
			paras.each((_, p) => {
				const t = $(p).text().trim();
				if (!t) return;
				if (/sakuranovel\.id/i.test(t)) return;
				if (/^daftar isi$/i.test(t)) return;
				parts.push(`<p>${escapeHtml(t)}</p>`);
			});
			if (parts.length >= 2) {
				contentHtml = parts.join('\n');
				break;
			}
		}

		const inner = clone.html()?.trim() || '';
		if (inner.length > 200) {
			contentHtml = inner;
			break;
		}
	}

	if (!contentHtml || contentHtml.length < 50) {
		const parts: string[] = [];
		$('body p').each((_, p) => {
			const t = $(p).text().trim();
			if (t.length < 20) return;
			if (/sakuranovel|cloudflare|cookie|privacy/i.test(t)) return;
			parts.push(`<p>${escapeHtml(t)}</p>`);
		});
		if (parts.length) contentHtml = parts.join('\n');
	}

	const prevHref =
		$('a[rel="prev"]').attr('href') ||
		$('a.prev, .nav-previous a, a:contains("Sebelumnya")').first().attr('href');
	const nextHref =
		$('a[rel="next"]').attr('href') ||
		$('a.next, .nav-next a, a:contains("Selanjutnya")').first().attr('href');

	return {
		title,
		content: contentHtml || '<p><em>Konten kosong — kemungkinan diblokir Cloudflare atau selector berubah.</em></p>',
		prevChapterId: prevHref ? pathOnly(prevHref) : null,
		nextChapterId: nextHref ? pathOnly(nextHref) : null
	};
}

	private parseSeriesCards(html: string): Manga[] {
		const $ = cheerio.load(html);
		const list: Manga[] = [];

		const cards = $(
			'.series-card, .listupd .bs, .listupd .bsx, article.series, .flexbox .series, .series-item, .list-series .item'
		);

		if (cards.length) {
			cards.each((_, el) => {
				const a = $(el).find('a').first();
				const href = a.attr('href') || '';
				const title =
					a.attr('title') ||
					$(el).find('.tt, .title, h2, h3, .series-title').first().text().trim() ||
					a.text().trim();
				const cover =
					$(el).find('img').attr('data-src') || $(el).find('img').attr('src') || '';
				const status =
					$(el).find('.status, .status-series').text().trim() || undefined;
				if (href && title && /\/series\//.test(href)) {
					list.push({
						id: pathOnly(href),
						title,
						cover: absUrl(this.baseUrl, cover.split('?')[0]),
						sourceId: this.id,
						type: 'novel',
						status,
						lang: 'id'
					});
				}
			});
		}

		if (!list.length) {
			$('a[href*="/series/"]').each((_, el) => {
				const href = $(el).attr('href') || '';
				if (!href || href.endsWith('/series/') || /\/series\/page\//.test(href)) return;
				const title = $(el).attr('title') || $(el).text().trim();
				if (!title || title.length < 2) return;
				const parent = $(el).closest('div, article, li');
				const cover =
					parent.find('img').attr('data-src') || parent.find('img').attr('src') || '';
				const id = pathOnly(href);
				if (list.some((x) => x.id === id)) return;
				list.push({
					id,
					title,
					cover: absUrl(this.baseUrl, cover.split('?')[0]),
					sourceId: this.id,
					type: 'novel',
					lang: 'id'
				});
			});
		}

		return list;
	}
}

export default SakuranovelSource;
