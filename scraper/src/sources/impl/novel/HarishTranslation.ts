/**
 * translation.harish.id — Web Novel Translation (ASP.NET MVC)
 * https://translation.harish.id/
 *
 * Path: scraper/src/sources/impl/novel/HarishTranslation.ts
 *
 * URL pattern:
 *   Latest   : /  (series blocks + Latest: N*)
 *   Series   : /webnovel/{slug}
 *   Chapter  : /webnovel/{slug}/{n}-{title}  or /webnovel/{slug}/{n}
 *   Search   : client filter homepage (site has no search API)
 *
 * Early access chapters marked with * / text-danger → isLocked
 * BaseSource.fetchHtml → fetchWithCf
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';
import { fetchWithCf } from '../../../lib/fetchWithCf';

const BASE = 'https://translation.harish.id';

function absUrl(href: string | undefined | null): string {
	if (!href) return '';
	const h = String(href).trim();
	if (!h) return '';
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
		const p = href.startsWith('/') ? href : `/${href}`;
		return p.replace(/\/$/, '') || '/';
	}
}

function cleanText(s: string): string {
	return (s || '')
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

function parseChapterNumber(text: string, fallback = 0): number {
	const t = cleanText(text);
	if (!t) return fallback;
	const m =
		t.match(/chapter\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\/(\d+(?:_\d+)?)(?:-|$)/) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1].replace('_', '.'));
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function isSeriesPath(path: string): boolean {
	const p = path.replace(/\/$/, '');
	return /^\/webnovel\/[^/]+$/.test(p);
}

function isChapterPath(path: string): boolean {
	const p = path.replace(/\/$/, '');
	return /^\/webnovel\/[^/]+\/[^/]+$/.test(p) && !/\/feed$/i.test(p);
}

export class HarishTranslationSource extends BaseSource {
	id = 'harishtranslation';
	name = 'Harish Translation';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		return fetchWithCf(url, {
			headers: {
				...this.headers,
				Referer: this.baseUrl
			}
		});
	}

	async getLatestManga(page = 1): Promise<Manga[]> {
		if (page > 1) return [];
		return this.parseHome();
	}

	private async parseHome(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('.content.reading-font, div.content').each((_, el) => {
			const a = $(el)
				.find('h4 a[href*="/webnovel/"], a[href*="/webnovel/"]')
				.filter((_, x) => isSeriesPath(pathOnly($(x).attr('href') || '')))
				.first();
			const href = a.attr('href') || '';
			const id = pathOnly(href);
			if (!isSeriesPath(id) || seen.has(id)) return;

			const title = cleanText(a.text());
			if (!title || title.length < 2) return;

			const alt = cleanText($(el).find('small').first().text());
			const author = cleanText(
				$(el).find('.col-sm.small').first().text()
			).replace(/^author:?\s*/i, '');

			const latestText = cleanText($(el).text());
			const latestMatch = latestText.match(/Latest:\s*([\d._]+)/i);
			const latestChapter = latestMatch
				? parseFloat(latestMatch[1].replace('_', '.'))
				: undefined;

			const dateMatch = latestText.match(/\((\d{1,2}\s+\w+\s+\d{4})\)/);
			let updatedAt: number | undefined;
			if (dateMatch) {
				const ts = Date.parse(dateMatch[1]);
				if (!Number.isNaN(ts)) updatedAt = ts;
			}

			seen.add(id);
			list.push({
				id,
				title: title.slice(0, 200),
				cover: '',
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: 'Ongoing',
				...(latestChapter != null && !Number.isNaN(latestChapter)
					? { latestChapter }
					: {}),
				...(updatedAt != null ? { updatedAt } : {}),
				...(alt
					? ({ altTitles: [alt] } as any)
					: {}),
				...(author && author.length < 60 && !/latest/i.test(author)
					? ({ authors: [author] } as any)
					: {})
			});
		});

		if (list.length < 3) {
			$('a[href*="/webnovel/"]').each((_, el) => {
				const id = pathOnly($(el).attr('href') || '');
				if (!isSeriesPath(id) || seen.has(id)) return;
				const title = cleanText($(el).text());
				if (!title || title.length < 2) return;
				seen.add(id);
				list.push({
					id,
					title: title.slice(0, 200),
					cover: '',
					sourceId: this.id,
					type: 'novel',
					lang: 'en',
					status: 'Ongoing'
				});
			});
		}

		return list;
	}

	async searchManga(query: string, _opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim().toLowerCase();
		if (!q) return this.getLatestManga(1);
		const all = await this.parseHome();
		return all.filter(
			(m) =>
				m.title.toLowerCase().includes(q) ||
				((m as any).altTitles || []).some((t: string) =>
					String(t).toLowerCase().includes(q)
				)
		);
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = pathOnly(mangaId);
		if (!path.startsWith('/webnovel/')) {
			path = `/webnovel/${path.replace(/^\/+/, '')}`;
		}
		path = path.replace(/\/$/, '');

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			cleanText($('h1.reading-font, h1.h2, h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '')
				.split(/\s*[|\-–—]\s*/)[0]
				.trim() ||
			path.split('/').pop()?.replace(/-/g, ' ') ||
			'';

		const altTitle = cleanText($('.reading-font.h4, h1 + div.reading-font').first().text());

		const description =
			cleanText($('#content.general-info p, #content p').first().text()) ||
			cleanText($('meta[name="description"]').attr('content') || '') ||
			'';

		const authors: string[] = [];
		$('#content .mb-3, #content .h6').each((_, el) => {
			const label = cleanText($(el).find('.h6').first().text() || $(el).text());
			if (!/author/i.test(label)) return;
			const val = cleanText(
				$(el).find('div').not('.h6').first().text() ||
					$(el).next().text() ||
					$(el)
						.clone()
						.children()
						.remove()
						.end()
						.text()
			);
			const sibling = $(el).next('div').text();
			const name = cleanText(sibling) || val.replace(/^author:?\s*/i, '');
			if (name && name.length < 80 && !authors.includes(name)) authors.push(name);
		});

		$('.h6').each((_, el) => {
			if (!/author/i.test(cleanText($(el).text()))) return;
			const name = cleanText($(el).next().text());
			if (name && name.length < 80 && !authors.includes(name)) authors.push(name);
		});

		const altTitles: string[] = [];
		if (altTitle && altTitle !== title) altTitles.push(altTitle);
	
		$('.h6').each((_, el) => {
			if (!/original|raw/i.test(cleanText($(el).text()))) return;
			const t = cleanText($(el).next().find('a').attr('title') || $(el).next().text());
			if (t && t.length < 120 && !altTitles.includes(t)) altTitles.push(t);
		});

		const chapters = this.parseChapterList($, path);

		const details: MangaDetails & {
			altTitles?: string[];
		} = {
			id: path,
			title: title.slice(0, 200),
			cover: '',
			description: description.slice(0, 4000),
			authors,
			genres: [],
			status: 'Ongoing',
			type: 'novel',
			sourceId: this.id,
			lang: 'en',
			chapters,
			...(chapters.length
				? { latestChapter: chapters[chapters.length - 1].number }
				: {})
		};
		if (altTitles.length) details.altTitles = altTitles;
		return details;
	}

	private parseChapterList($: cheerio.CheerioAPI, seriesPath: string): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		$('#chapterList .chapter-item, .chapter-item, #chapterList a').each((_, el) => {
			const $el = $(el);
			const $a = $el.is('a') ? $el : $el.find('a').first();
			const href = $a.attr('href') || '';
			const text = cleanText($a.text() || $el.text());
			const isEarly =
				$a.find('.text-danger').length > 0 ||
				/\*/.test($a.find('.text-light, .text-start').first().text()) ||
				!href;

			const number = parseChapterNumber(text, 0);
			if (!number && !href) return;

			let id = href ? pathOnly(href) : '';
			if (!id && number) {
				id = `${seriesPath}/${number}`;
			}
			if (!isChapterPath(id) && !id.startsWith(seriesPath)) return;
			if (seen.has(id)) return;
			seen.add(id);

			const date =
				cleanText($a.find('.text-end.small, .small').last().text()) || undefined;

			out.push({
				id,
				title: number > 0 ? `Chapter ${number}` : text.slice(0, 80) || 'Chapter',
				number: number || out.length + 1,
				date,
				...(isEarly || !href ? { isLocked: true } : {})
			});
		});

		$('a[href*="/webnovel/"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const id = pathOnly(href);
			if (!isChapterPath(id) || seen.has(id)) return;
			if (!id.startsWith(seriesPath + '/')) return;
			seen.add(id);
			const number = parseChapterNumber(id + ' ' + cleanText($(a).text()), 0);
			out.push({
				id,
				title: number > 0 ? `Chapter ${number}` : cleanText($(a).text()).slice(0, 80),
				number: number || out.length + 1
			});
		});

		out.sort((a, b) => (a.number || 0) - (b.number || 0));
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
		const html = await this.fetchHtml(path.endsWith('/') ? path.slice(0, -1) : path);
		const $ = cheerio.load(html);

		const title =
			cleanText($('h1.reading-font, h1.h2, h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '')
				.split(/\s*[|\-–—]\s*/)[0]
				.trim() ||
			'Chapter';

		const bodyText = cleanText($('#content, main').text());
		if (
			(/early access only|members? only|login to (read|continue)|become a (member|patron)/i.test(
				bodyText
			) &&
				$('#content p').length < 3) ||
			(!$('#content p').length && /early access/i.test(bodyText))
		) {
			throw new Error('Chapter is locked / early access only');
		}

		const contentRoot = $('#content').first();
		const clone = contentRoot.clone();
		clone
			.find(
				'script, style, .disclaimer, nav, .btn-group, .breadcrumb, iframe, .sharedaddy'
			)
			.remove();

		const parts: string[] = [];
		clone.find('p, h2, h3, h4, h5, h6').each((_, el) => {
			const tag = ((el as any).tagName || (el as any).name || 'p').toLowerCase();
			const t = cleanText($(el).text());
			if (!t || t.length < 1) return;
			if (/^disclaimer:/i.test(t)) return;
			if (tag.startsWith('h')) {
				parts.push(`<p><strong>${escapeHtml(t)}</strong></p>`);
			} else {
				parts.push(`<p>${escapeHtml(t)}</p>`);
			}
		});

		let content = parts.join('\n');
		if (!content || content.length < 40) {
			const raw = cleanText(clone.text());
			if (raw.length > 40) {
				content = raw
					.split(/\n\s*\n/)
					.map((s) => cleanText(s))
					.filter((s) => s.length > 2)
					.map((s) => `<p>${escapeHtml(s)}</p>`)
					.join('\n');
			}
		}

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		$('a[href*="/webnovel/"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const id = pathOnly(href);
			if (!isChapterPath(id)) return;
			const text = cleanText($(a).text()).toLowerCase();
			if (/prev|previous|older|«|←/i.test(text)) prevChapterId = id;
			if (/next|newer|»|→/i.test(text)) nextChapterId = id;
		});

		return {
			title,
			content:
				content ||
				'<p><em>Empty content — chapter may be early-access locked.</em></p>',
			prevChapterId,
			nextChapterId
		};
	}
}

export default HarishTranslationSource;
