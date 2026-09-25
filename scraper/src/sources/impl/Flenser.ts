/**
 * Flenser Translations (flenser-tl.nz)
 * Path: scraper/src/sources/impl/Flenser.ts
 *
 * Static Jekyll / Just the Docs:
 *   Index  : /
 *   Series : /docs/{Folder}/{slug}.html
 *   Episode: /docs/{Folder}/.../Episode N.html
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types';

const PAGE_SIZE = 12;

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
				: `https://flenser-tl.nz${href.startsWith('/') ? '' : '/'}${href}`
		);
		return decodeURIComponent(u.pathname) || '/';
	} catch {
		try {
			return decodeURIComponent(href.split('?')[0]);
		} catch {
			return href.startsWith('/') ? href : `/${href}`;
		}
	}
}

function resolveToPath(href: string, pagePath: string): string {
	if (!href || href.startsWith('#') || href.startsWith('mailto:')) return '';
	try {
		const base = `https://flenser-tl.nz${encodePath(pathOnly(pagePath))}`;
		const u = new URL(href, base);
		if (!u.hostname.includes('flenser-tl')) return '';
		return decodeURIComponent(u.pathname) || '/';
	} catch {
		return pathOnly(href);
	}
}

function encodePath(p: string): string {
	return p
		.split('/')
		.map((seg) => (seg ? encodeURIComponent(seg) : ''))
		.join('/');
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function parseEpisodeNum(text: string, path: string, fallback: number): number {
	const fromPath = path.match(/Episode\s*(\d+)/i);
	if (fromPath) {
		const n = parseFloat(fromPath[1]);
		if (!Number.isNaN(n)) return n;
	}
	const t = (text || '').replace(/\s+/g, ' ').trim();
	const m =
		t.match(/(?:final\s+)?episode\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/#\s*(\d+(?:\.\d+)?)/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function seriesFolder(seriesId: string): string {
	const p = pathOnly(seriesId);
	const parts = p.split('/').filter(Boolean);
	if (parts.length >= 2 && parts[0] === 'docs') {
		return `/docs/${parts[1]}`;
	}
	return p.replace(/\/[^/]+\.html$/i, '');
}

export class FlenserSource extends BaseSource {
	id = 'flenser';
	name = 'Flenser';
	baseUrl = 'https://flenser-tl.nz';

	private async getHtml(path: string): Promise<string> {
		const decoded = pathOnly(path);
		return this.fetchHtml(encodePath(decoded));
	}

	private async parseIndex(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		const root = $('#main-content, main, article').first();
		const links = root.length ? root.find('a[href*="/docs/"]') : $('a[href*="/docs/"]');

		links.each((_, el) => {
			const href = $(el).attr('href') || '';
			if (!href) return;
			const p = pathOnly(href);
			if (!/\.html$/i.test(p)) return;
			if (/Episode\s*\d+/i.test(p) || /\/Chapter\s*\d+/i.test(p)) return;
			if (/book-list|tags\.html|ebook/i.test(p)) return;
			const parts = p.split('/').filter(Boolean);
			if (parts.length < 3 || parts[0] !== 'docs') return;

			if (seen.has(p)) return;
			seen.add(p);

			let title = $(el).text().replace(/\s+/g, ' ').trim();
			let status: string | undefined;
			if (title.includes('✅')) {
				status = 'Completed';
				title = title.replace(/✅/g, '').trim();
			} else if (title.includes('❌')) {
				status = 'Dropped';
				title = title.replace(/❌/g, '').trim();
			} else {
				status = 'Ongoing';
			}
			if (!title || title.length < 2) return;

			list.push({
				id: p,
				title,
				cover: '',
				sourceId: this.id,
				type: 'novel',
				status,
				lang: 'en'
			});
		});

		return list;
	}

	private collectEpisodes(
		$: cheerio.CheerioAPI,
		seriesPagePath: string
	): Chapter[] {
		const folder = seriesFolder(seriesPagePath);
		const folderNorm = folder.toLowerCase();
		const byNum = new Map<number, Chapter>();

		$('a[href]').each((_, el) => {
			const href = $(el).attr('href') || '';
			if (!href || href.startsWith('#')) return;

			const p = resolveToPath(href, seriesPagePath);
			if (!p) return;

			if (!p.toLowerCase().startsWith(folderNorm + '/')) return;

			if (!/Episode\s*\d+/i.test(p) && !/Final\s+Episode/i.test(p)) {
				const text = ($(el).text() || '').replace(/\s+/g, ' ').trim();
				if (!/^(?:Final\s+)?Episode\s*\d+/i.test(text)) return;
			}

			const text = ($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim();
			const num = parseEpisodeNum(text, p, 0);
			if (!num || num <= 0) return;

			const existing = byNum.get(num);
			if (!existing) {
				byNum.set(num, {
					id: p,
					title: `Chapter ${num}`,
					number: num
				});
			}
		});

		return Array.from(byNum.values()).sort((a, b) => b.number - a.number);
	}

	private async enrichCard(m: Manga): Promise<Manga> {
		try {
			const html = await this.getHtml(m.id);
			const $ = cheerio.load(html);
			$('script, style, noscript').remove();

			const chapters = this.collectEpisodes($, m.id);
			const maxEp = chapters.length ? chapters[0].number : 0;

			let cover =
				$('meta[property="og:image"]').attr('content') ||
				$('#main-content img, main img, article img').first().attr('src') ||
				'';
			cover = absUrl(this.baseUrl, cover);

			const bodyText = $('#main-content, main').first().text().toLowerCase();
			let status = m.status;
			if (/\bcomplete\b/.test(bodyText)) status = 'Completed';

			return {
				...m,
				cover: cover || m.cover,
				status,
				...(maxEp > 0 ? { latestChapter: maxEp } : {})
			};
		} catch {
			return m;
		}
	}

	async getLatestManga(page = 1): Promise<Manga[]> {
		const all = await this.parseIndex();
		const p = Math.max(1, page);
		const start = (p - 1) * PAGE_SIZE;
		const slice = all.slice(start, start + PAGE_SIZE);
		if (!slice.length) return [];
		return Promise.all(slice.map((m) => this.enrichCard(m)));
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = Math.max(1, opts?.page ?? 1);
		const all = await this.parseIndex();
		const q = (query || '').trim().toLowerCase();
		const filtered = q ? all.filter((m) => m.title.toLowerCase().includes(q)) : all;
		const start = (page - 1) * PAGE_SIZE;
		const slice = filtered.slice(start, start + PAGE_SIZE);
		return Promise.all(slice.map((m) => this.enrichCard(m)));
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const id = pathOnly(mangaId);
		const html = await this.getHtml(id);
		const $ = cheerio.load(html);
		$('script, style, noscript, iframe').remove();

		const h1 =
			$('h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('title').text().split('|')[0].trim() ||
			id;
		const title = h1.replace(/✅|❌/g, '').trim();

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('#main-content img, main img, article img').first().attr('src') ||
			'';
		cover = absUrl(this.baseUrl, cover);

		const mainText = $('#main-content, main, article').first().text().replace(/\s+/g, ' ');

		let altTitle = '';
		const origM = mainText.match(/Original Title\s+(.+?)\s+Description/i);
		if (origM) altTitle = origM[1].trim();
		if (!altTitle) {
			$('#main-content h2, #main-content h3, main h2, main h3').each((_, el) => {
				if (/original title/i.test($(el).text())) {
					const t = $(el).next().text().replace(/\s+/g, ' ').trim();
					if (t && t.length < 120) altTitle = t;
				}
			});
		}

		let description = '';
		const descM = mainText.match(
			/Description\s+([\s\S]+?)(?:\s+(?:slow burn|secret relationship|adult life|The original Japanese|Author:|Table of contents))/i
		);
		if (descM) {
			description = descM[1].replace(/\s+/g, ' ').trim().slice(0, 2500);
		}
		if (!description || description.length < 40) {
			const paras: string[] = [];
			$('#main-content p, main p').each((_, el) => {
				const t = $(el).text().replace(/\s+/g, ' ').trim();
				if (t.length < 50) return;
				if (/flenser|discord|ko-fi|just the docs|kakuyomu/i.test(t) && t.length < 100) return;
				paras.push(t);
			});
			description = paras.slice(0, 5).join('\n\n').slice(0, 2500);
		}

		const authors: string[] = [];
		const authorM = mainText.match(
			/Author:\s*(.+?)(?:\s+Table of contents|\s+Join the|\s+This site|$)/i
		);
		if (authorM) {
			const a = authorM[1].replace(/\s+/g, ' ').trim();
			if (a && a.length < 80) authors.push(a);
		}

		const genres: string[] = [];
		const knownTags = [
			'slow burn',
			'secret relationship',
			'straight to gay',
			'high school',
			'seduction',
			'suggestive',
			'parental neglect',
			'time jump',
			'angst',
			'adult life',
			'explicit',
			'yandere',
			'tsundere',
			'age gap',
			'yuri',
			'romance',
			'comedy',
			'drama',
			'fantasy'
		];
		const lowerBody = mainText.toLowerCase();
		for (const tag of knownTags) {
			if (lowerBody.includes(tag) && !genres.includes(tag)) genres.push(tag);
		}

		let status = 'Ongoing';
		if (/✅/.test(h1) || /\bcomplete\b/i.test(mainText)) status = 'Completed';
		if (/❌/.test(h1) || /\bcancel/i.test(mainText)) status = 'Dropped';

		const chapters = this.collectEpisodes($, id);
		const latestChapter = chapters.length ? chapters[0].number : undefined;

		const metaLines: string[] = [];
		if (altTitle) metaLines.push(`Alt Title: ${altTitle}`);
		if (authors[0]) metaLines.push(`Author: ${authors[0]}`);
		metaLines.push(`Language: English`);
		metaLines.push(`Type: novel`);
		const fullDescription = [...metaLines, description].filter(Boolean).join('\n');

		return {
			id,
			title,
			cover,
			sourceId: this.id,
			description: fullDescription,
			authors,
			status,
			genres,
			chapters,
			type: 'novel',
			lang: 'en',
			...(latestChapter != null ? { latestChapter } : {})
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
		const id = pathOnly(chapterId);
		const html = await this.getHtml(id);
		const $ = cheerio.load(html);

		const title =
			$('h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('title').text().split('|')[0].trim() ||
			'Chapter';

		const root = $('#main-content, main, article').first();
		const scope = root.length ? root : $('body');
		const clone = scope.clone();
		clone.find('script, style, nav, header, footer, .sidebar, .toc, noscript, iframe').remove();

		const parts: string[] = [];
		clone.find('p').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (!t || t.length < 15) return;
			if (/flenser translations|table of contents|©|just the docs/i.test(t)) return;
			parts.push(`<p>${escapeHtml(t)}</p>`);
		});

		const content =
			parts.length >= 1 ? parts.join('\n') : '<p><em>Konten kosong.</em></p>';

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		try {
			const folder = seriesFolder(id);
			const seriesIndex = await this.guessSeriesIndex(folder);
			if (seriesIndex) {
				const details = await this.getMangaDetails(seriesIndex);
				const sorted = [...details.chapters].sort(
					(a, b) => (a.number as number) - (b.number as number)
				);
				const idx = sorted.findIndex((c) => pathOnly(c.id) === id);
				if (idx >= 0) {
					prevChapterId = idx > 0 ? sorted[idx - 1].id : null;
					nextChapterId = idx < sorted.length - 1 ? sorted[idx + 1].id : null;
				}
			}
		} catch {
			/* ignore */
		}

		return { title, content, prevChapterId, nextChapterId };
	}

	private async guessSeriesIndex(folder: string): Promise<string | null> {
		try {
			const all = await this.parseIndex();
			const f = folder.toLowerCase();
			const hit = all.find((m) => pathOnly(m.id).toLowerCase().startsWith(f + '/'));
			return hit ? hit.id : null;
		} catch {
			return null;
		}
	}
}

export default FlenserSource;
