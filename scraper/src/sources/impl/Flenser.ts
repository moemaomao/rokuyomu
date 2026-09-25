/**
 * Flenser Translations (flenser-tl.nz)
 * Path: scraper/src/sources/impl/Flenser.ts
 *
 * Static Jekyll / Just the Docs:
 *   Index  : /
 *   Series : /docs/{Folder}/{slug}.html
 *   Episode: /docs/{Folder}/.../Episode N.html
 *
 * Meta di series page: Original Title, Author, Description, tag list
 * Novel text → getChapterPages() = []
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

function parseEpisodeNum(text: string, fallback: number): number {
	const t = (text || '').replace(/\s+/g, ' ').trim();
	const m =
		t.match(/(?:final\s+)?episode\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/#\s*(\d+(?:\.\d+)?)/) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
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
		const enc = encodePath(decoded);
		return this.fetchHtml(enc);
	}

	/** Semua novel dari homepage (tanpa enrich) */
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
			if (/\/episode\s*\d+/i.test(p) || /\/chapter\s*\d+/i.test(p)) return;
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

	/**
	 * Enrich cover + latestChapter dari halaman series
	 * (episode count / cover image / status tag)
	 */
	private async enrichCard(m: Manga): Promise<Manga> {
		try {
			const html = await this.getHtml(m.id);
			const $ = cheerio.load(html);
			$('script, style, noscript').remove();

			const folder = seriesFolder(m.id);
			const folderNorm = folder.toLowerCase();

			let maxEp = 0;
			$('a[href]').each((_, el) => {
				const href = $(el).attr('href') || '';
				const p = pathOnly(href);
				if (!p.toLowerCase().startsWith(folderNorm + '/')) return;
				const text = ($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim();
				const isEp =
					/episode\s*\d+/i.test(text) ||
					/episode\s*\d+/i.test(p) ||
					/final\s+episode/i.test(text);
				if (!isEp) return;
				const n = parseEpisodeNum(text + ' ' + p, 0);
				if (n > maxEp) maxEp = n;
			});

			let cover =
				$('meta[property="og:image"]').attr('content') ||
				$('#main-content img, main img, article img').first().attr('src') ||
				'';
			cover = absUrl(this.baseUrl, cover);

			// status dari tag "complete" di body
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

		// Parallel enrich untuk badge + cover
		return Promise.all(slice.map((m) => this.enrichCard(m)));
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = Math.max(1, opts?.page ?? 1);
		const all = await this.parseIndex();
		const q = (query || '').trim().toLowerCase();
		const filtered = q
			? all.filter((m) => m.title.toLowerCase().includes(q))
			: all;
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

		// Original Title → alt title
		let altTitle = '';
		const origM = mainText.match(/Original Title\s+(.+?)\s+Description/i);
		if (origM) altTitle = origM[1].trim();
		// fallback: text after "Original Title" heading
		if (!altTitle) {
			$('#main-content h2, #main-content h3, main h2, main h3').each((_, el) => {
				if (/original title/i.test($(el).text())) {
					const next = $(el).next();
					const t = next.text().replace(/\s+/g, ' ').trim();
					if (t && t.length < 120) altTitle = t;
				}
			});
		}

		// Description
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
				if (/flenser|discord|ko-fi|just the docs|kakuyomu/i.test(t) && t.length < 100)
					return;
				paras.push(t);
			});
			description = paras.slice(0, 5).join('\n\n').slice(0, 2500);
		}

		// Author
		const authors: string[] = [];
		const authorM =
			mainText.match(/Author:\s*([^\n]+?)(?:\s+Table of contents|\s+Join the|$)/i) ||
			mainText.match(/Author:\s*(.+?)(?:\s{2,}|$)/i);
		if (authorM) {
			// Bisa "桃田ロウ" atau "Hainiwa Tama 灰庭たま"
			let a = authorM[1].replace(/\s+/g, ' ').trim();
			a = a.split(/Table of contents|Join the|This site/i)[0].trim();
			if (a && a.length < 80) authors.push(a);
		}
		// Dari heading Author
		if (!authors.length) {
			$('#main-content, main').find('p, li, div').each((_, el) => {
				const t = $(el).text().replace(/\s+/g, ' ').trim();
				const m = t.match(/^Author:\s*(.+)$/i);
				if (m && m[1].length < 80) {
					authors.push(m[1].trim());
					return false;
				}
			});
		}

		// Genres / tags — daftar kata di antara Description dan "The original Japanese" / Author
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
			'complete',
			'adult life',
			'explicit',
			'yandere',
			'tsundere',
			'age gap',
			'yuri',
			'bl',
			'gl',
			'romance',
			'comedy',
			'drama',
			'fantasy',
			'school',
			'office',
			'mature'
		];
		const lowerBody = mainText.toLowerCase();
		for (const tag of knownTags) {
			if (tag === 'complete') continue;
			// word boundary-ish
			if (lowerBody.includes(tag) && !genres.includes(tag)) {
				// hindari false positive di description panjang: tag biasanya berdiri sendiri di list
				genres.push(tag);
			}
		}
		// Parse tag list lebih ketat dari struktur: baris pendek antara description dan kakuyomu
		const tagBlock = mainText.match(
			/🫶\s*([\s\S]*?)(?:The original Japanese|Author:)/i
		) || mainText.match(
			/Description[\s\S]{20,800}?((?:(?:slow burn|secret relationship|straight to gay|high school|seduction|suggestive|parental neglect|time jump|angst|complete|adult life|explicit|yandere|tsundere|age gap)[\s]*)+)/i
		);
		if (tagBlock) {
			const block = tagBlock[1].toLowerCase();
			for (const tag of knownTags) {
				if (tag === 'complete') continue;
				if (block.includes(tag) && !genres.includes(tag)) genres.push(tag);
			}
		}

		let status = 'Ongoing';
		if (/✅/.test(h1) || /\bcomplete\b/i.test(mainText)) status = 'Completed';
		if (/❌/.test(h1) || /\bcancel/i.test(mainText)) status = 'Dropped';

		// Chapters
		const folder = seriesFolder(id);
		const folderNorm = folder.toLowerCase();
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('a[href]').each((_, el) => {
			const href = $(el).attr('href') || '';
			if (!href) return;
			const p = pathOnly(href);
			if (!p.toLowerCase().startsWith(folderNorm + '/')) return;
			if (p === id || p.toLowerCase() === id.toLowerCase()) return;

			const text = ($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim();
			if (!text) return;

			const isEpisode =
				/episode\s*\d+/i.test(text) ||
				/episode\s*\d+/i.test(p) ||
				/final\s+episode/i.test(text);
			const isChapterToc = /\/chapter[- ]?\d+/i.test(p) && !/episode/i.test(p);
			if (!isEpisode && isChapterToc) return;
			if (!isEpisode && !/\d/.test(text)) return;

			if (seen.has(p)) return;
			seen.add(p);

			const num = parseEpisodeNum(text + ' ' + p, chapters.length + 1);
			chapters.push({
				id: p,
				title: `Chapter ${num}`,
				number: num
			});
		});

		chapters.sort((a, b) => b.number - a.number);
		const latestChapter = chapters.length ? chapters[0].number : undefined;

		// Meta lines untuk UI (alt title, author) — format yang diparse frontend
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
			if (/flenser translations|table of contents|©|all rights reserved|just the docs/i.test(t))
				return;
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
