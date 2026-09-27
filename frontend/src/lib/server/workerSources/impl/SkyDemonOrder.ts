/**
 * Sky Demon Order (skydemonorder.com) — Laravel + Livewire novel site
 * Path: scraper/src/sources/impl/SkyDemonOrder.ts
 *
 * - List: /projects (+ pagination / search)
 * - Detail: /projects/{slug}
 * - Chapters: Livewire component "project.chapter-list" → freeChapters JSON
 * - Content: .prose (HTML)
 * - Banyak chapter premium (Qi) → isLocked / skip di free list
 *
 * WAJIB hybrid Worker (Cloudflare ketat).
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
				: `https://skydemonorder.com${href.startsWith('/') ? '' : '/'}${href}`
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

function extractChapterNum(text: string): number | undefined {
	const t = (text || '').replace(/\s+/g, ' ').trim();
	if (!t) return undefined;
	const m =
		t.match(/(?:chapter|ch\.?|ep\.?|episode|bab)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/(\d+(?:\.\d+)?)/);
	if (!m) return undefined;
	const n = parseFloat(m[1]);
	return Number.isNaN(n) ? undefined : n;
}

function decodeJsString(raw: string): string {
	return raw
		.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
		.replace(/\\'/g, "'")
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, '\\');
}

export class SkyDemonOrderSource extends BaseSource {
	id = 'skydemonorder';
	name = 'Sky Demon Order';
	baseUrl = 'https://skydemonorder.com';

	async getLatestManga(page = 1): Promise<Manga[]> {
  console.log('[SDO] getLatestManga page=', page);
  try {
    const html = await this.fetchHtml('/');
    console.log('[SDO] home status length=', html.length);
    console.log('[SDO] isCF=', /just a moment|cf-browser-verification|challenge-platform/i.test(html));
    console.log('[SDO] preview=', html.slice(0, 300).replace(/\s+/g, ' '));
  } catch (e) {
    console.error('[SDO] fetch home failed', e);
  }

  if (page <= 1) {
    const [home, list] = await Promise.all([
      this.parseHome().catch((e) => { console.error('[SDO] parseHome', e); return [] as Manga[]; }),
      this.fetchProjectsPage(1).catch((e) => { console.error('[SDO] projects', e); return [] as Manga[]; })
    ]);
    console.log('[SDO] home count=', home.length, 'list count=', list.length);
    return this.dedupeById([...home, ...list]).slice(0, 30);
  }
  return this.fetchProjectsPage(page);
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

	private async parseHome(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('a[href*="/projects/"]').each((_, el) => {
			const href = $(el).attr('href') || '';
			const m = href.match(/\/projects\/([^/?#]+)/);
			if (!m) return;
			// skip chapter URLs (lebih dari 1 segment setelah projects)
			if (/\/projects\/[^/]+\/.+/.test(href.replace(this.baseUrl, ''))) return;

			const id = `/projects/${m[1]}`;
			if (seen.has(id)) return;

			const title =
				$(el).attr('title') ||
				$(el).find('img').attr('alt') ||
				$(el).text().replace(/\s+/g, ' ').trim();
			if (!title || title.length < 3) return;

			const img =
				$(el).find('img').attr('src') ||
				$(el).find('img').attr('data-src') ||
				$(el).closest('[class*="card"], article, div').find('img').attr('src') ||
				'';

			seen.add(id);
			list.push({
				id,
				title: title.slice(0, 200).replace(/\s+/g, ' ').trim(),
				cover: absUrl(this.baseUrl, (img || '').split('?')[0]),
				sourceId: this.id,
				type: 'novel',
				lang: 'en'
			});
		});

		return list;
	}

	private async fetchProjectsPage(page: number): Promise<Manga[]> {
		const path =
			page <= 1
				? '/projects?sort=latest_chapter'
				: `/projects?sort=latest_chapter&page=${page}`;
		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list: Manga[] = [];
			const seen = new Set<string>();

			// Card-style links
			$('a[href*="/projects/"]').each((_, el) => {
				const href = $(el).attr('href') || '';
				const m = href.match(/\/projects\/([^/?#]+)/);
				if (!m) return;
				if (/\/projects\/[^/]+\/.+/.test(href.replace(this.baseUrl, ''))) return;

				const id = `/projects/${m[1]}`;
				if (seen.has(id)) return;

				const root = $(el).closest('article, [class*="card"], div, li').length
					? $(el).closest('article, [class*="card"], div, li')
					: $(el);

				const title =
					$(el).attr('title') ||
					root.find('h2, h3, h4, [class*="title"]').first().text().trim() ||
					$(el).find('img').attr('alt') ||
					$(el).text().replace(/\s+/g, ' ').trim();
				if (!title || title.length < 3) return;

				const cover =
					root.find('img').attr('src') ||
					root.find('img').attr('data-src') ||
					$(el).find('img').attr('src') ||
					'';

				const statusText = root.text();
				const status = /complete|completed/i.test(statusText)
					? 'Completed'
					: /dropped|hiatus/i.test(statusText)
						? 'Hiatus'
						: 'Ongoing';

				const chMatch = statusText.match(/(\d+)\s*ch/i);
				const latestChapter = chMatch ? parseInt(chMatch[1], 10) : undefined;

				seen.add(id);
				list.push({
					id,
					title: title.replace(/\s+/g, ' ').trim().slice(0, 200),
					cover: absUrl(this.baseUrl, (cover || '').split('?')[0]),
					sourceId: this.id,
					type: 'novel',
					status,
					lang: 'en',
					...(latestChapter != null ? { latestChapter } : {})
				});
			});

			return list;
		} catch {
			return [];
		}
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = encodeURIComponent(query.trim());
		const path =
			page <= 1
				? `/projects?search=${q}`
				: `/projects?search=${q}&page=${page}`;
		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list: Manga[] = [];
			const seen = new Set<string>();

			$('a[href*="/projects/"]').each((_, el) => {
				const href = $(el).attr('href') || '';
				const m = href.match(/\/projects\/([^/?#]+)/);
				if (!m) return;
				if (/\/projects\/[^/]+\/.+/.test(href.replace(this.baseUrl, ''))) return;

				const id = `/projects/${m[1]}`;
				if (seen.has(id)) return;

				const title =
					$(el).attr('title') ||
					$(el).find('img').attr('alt') ||
					$(el).text().replace(/\s+/g, ' ').trim();
				if (!title || title.length < 3) return;

				const cover =
					$(el).find('img').attr('src') ||
					$(el).find('img').attr('data-src') ||
					'';

				seen.add(id);
				list.push({
					id,
					title: title.replace(/\s+/g, ' ').trim().slice(0, 200),
					cover: absUrl(this.baseUrl, (cover || '').split('?')[0]),
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
		if (!path.includes('/projects/')) {
			path = `/projects/${path.replace(/^\//, '')}`;
		}
		path = path.replace(/\/$/, '');

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			$('h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content')?.split('|')[0]?.trim() ||
			$('title').text().split('|')[0].trim();
		if (!title || title.length < 2) {
			throw new Error('Manga not found (empty title)');
		}

		const cover =
			$(`img[alt="${title}"]`).attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			$('img').first().attr('src') ||
			'';

		let description = '';
		const descEl = $('[class*="description"], [class*="synopsis"], .prose, article p').first();
		if (descEl.length) {
			description = descEl
				.find('p')
				.map((_, p) => $(p).text().trim())
				.get()
				.filter((t) => t.length > 20)
				.join('\n\n');
			if (!description) description = descEl.text().replace(/\s+/g, ' ').trim();
		}

		const genres: string[] = [];
		$('a[href*="/genres/"], a[href*="/genre/"], [class*="genre"] a').each((_, a) => {
			const g = $(a).text().trim();
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		const statusText = $('body').text();
		const status = /complete|completed|premium complete/i.test(statusText)
			? 'Completed'
			: /dropped/i.test(statusText)
				? 'Dropped'
				: 'Ongoing';

		const chapters = await this.fetchChaptersViaLivewire(html, path);

		return {
			id: pathOnly(path),
			title: title.replace(/\s+/g, ' ').trim(),
			cover: absUrl(this.baseUrl, (cover || '').split('?')[0]),
			sourceId: this.id,
			description,
			authors: [],
			status,
			genres,
			chapters,
			type: 'novel',
			lang: 'en'
		};
	}

	/** Livewire lazy chapter-list → freeChapters JSON */
	private async fetchChaptersViaLivewire(html: string, projectPath: string): Promise<Chapter[]> {
		try {
			const $ = cheerio.load(html);

			const csrf = $('meta[name="csrf-token"]').attr('content');
			if (!csrf) return this.parseChapterFallback($, projectPath);

			const lwScript = $('script[src*="livewire"]').attr('src') || '';
			const lwMatch = lwScript.match(/(livewire-[a-f0-9]+)/i);
			if (!lwMatch) return this.parseChapterFallback($, projectPath);

			const livewireUrl = absUrl(this.baseUrl, `/${lwMatch[1]}/update`);

			const lwDiv = $('[wire\\:name="project.chapter-list"]').first();
			const snapshot = lwDiv.attr('wire:snapshot');
			if (!snapshot) return this.parseChapterFallback($, projectPath);

			const res = await fetch(livewireUrl, {
				method: 'POST',
				headers: {
					...this.headers,
					'Content-Type': 'application/json',
					'X-CSRF-TOKEN': csrf,
					'X-Livewire': '',
					Referer: absUrl(this.baseUrl, projectPath),
					Origin: this.baseUrl
				},
				body: JSON.stringify({
					components: [{ snapshot, updates: {}, calls: [] }]
				})
			});

			if (!res.ok) return this.parseChapterFallback($, projectPath);

			const data = (await res.json()) as any;
			const chapterHtml = data?.components?.[0]?.effects?.html;
			if (!chapterHtml) return this.parseChapterFallback($, projectPath);

			const $ch = cheerio.load(chapterHtml);
			const xdataDiv = $ch('div[x-data]').first();
			const xData = xdataDiv.attr('x-data') || '';

			const freeMatch = xData.match(/freeChapters:\s*JSON\.parse\('(.+?)'\)/);
			if (!freeMatch) return this.parseChapterFallback($, projectPath);

			const rawJson = decodeJsString(freeMatch[1]);
			const freeChapters = JSON.parse(rawJson) as Array<{
				slug?: string;
				title?: string;
				number?: number;
				index?: number;
			}>;

			const slugMatch = xData.match(/projectSlug:\s*'([^']+)'/);
			const projectSlug =
				slugMatch?.[1] ||
				projectPath.replace(/^\/projects\//, '').replace(/\/$/, '');

			const out: Chapter[] = [];
			const seen = new Set<string>();

			// freeChapters biasanya oldest → newest; kita reverse ke newest first
			const items = [...freeChapters].reverse();

			for (let i = 0; i < items.length; i++) {
				const item = items[i];
				const chapSlug = item.slug || String(item.number ?? item.index ?? i + 1);
				const id = `/projects/${projectSlug}/${chapSlug}`;
				if (seen.has(id)) continue;
				seen.add(id);

				const num =
					typeof item.number === 'number'
						? item.number
						: extractChapterNum(item.title || '') ?? items.length - i;

				out.push({
					id,
					title: (item.title || `Chapter ${num}`).replace(/\s+/g, ' ').trim(),
					number: num
				});
			}

			out.sort((a, b) => b.number - a.number);
			return out;
		} catch (e) {
			console.error('[SkyDemonOrder] Livewire chapters failed', e);
			const $ = cheerio.load(html);
			return this.parseChapterFallback($, projectPath);
		}
	}

	private parseChapterFallback($: cheerio.CheerioAPI, projectPath: string): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();
		const slug = projectPath.replace(/^\/projects\//, '').replace(/\/$/, '');

		$('a[href*="/projects/"]').each((i, el) => {
			const href = $(el).attr('href') || '';
			const m = href.match(new RegExp(`/projects/${slug}/([^/?#]+)`));
			if (!m) return;

			const id = pathOnly(href);
			if (seen.has(id)) return;
			seen.add(id);

			const title = ($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim();
			if (!title || title.length < 2) return;

			const num = extractChapterNum(title) ?? out.length + 1;
			out.push({ id, title, number: num });
		});

		out.sort((a, b) => b.number - a.number);
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
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const locked =
			$('body').text().toLowerCase().includes('unlock') ||
			$('body').text().toLowerCase().includes('premium') ||
			$('body').text().toLowerCase().includes('qi required') ||
			$('[class*="locked"], [class*="premium"], [class*="paywall"]').length > 0;

		if (locked && !$('.prose').length) {
			throw new Error('Chapter is locked / premium on Sky Demon Order');
		}

		const title =
			$('h1').first().text().trim() ||
			$('title').text().split('|')[0].trim() ||
			'Chapter';

		const prose = $('.prose').first();
		prose.find('script, style, nav, .ads, .ad, [class*="advert"]').remove();
		let contentHtml = prose.html() || '';

		if (!contentHtml) {
			const fallback = $('[class*="chapter-content"], article, .content').first();
			fallback.find('script, style, nav').remove();
			contentHtml = fallback.html() || '';
		}

		let content = contentHtml;
		if (content && !content.includes('<p') && !content.includes('<br')) {
			content = content
				.split(/\n{2,}/)
				.map((p) => `<p>${escapeHtml(p.trim())}</p>`)
				.join('');
		}

		// Prev / next dari link di halaman
		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		$('a[href*="/projects/"]').each((_, el) => {
			const href = $(el).attr('href') || '';
			const text = $(el).text().toLowerCase();
			const id = pathOnly(href);
			if (!id.includes('/projects/')) return;
			if (/prev|previous|←|sebelum/i.test(text)) prevChapterId = id;
			if (/next|lanjut|→|berikut/i.test(text)) nextChapterId = id;
		});

		return {
			title: title.replace(/\s+/g, ' ').trim(),
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default SkyDemonOrderSource;