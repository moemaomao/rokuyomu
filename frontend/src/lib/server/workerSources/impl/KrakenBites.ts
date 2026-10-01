/**
 * Kraken Bites Translations — WordPress.com novel TL
 * https://krakenbites.wordpress.com/
 *
 * - Novel hub pages: /{slug}/ (TOC + description)
 * - Chapters: /YYYY/MM/DD/{slug}-chapter-N/ or /{prefix}-chapter-N/
 * - Latest: homepage links + /feed/
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types';

const BASE = 'https://krakenbites.wordpress.com';

const NOVEL_HUBS: Array<{ path: string; title: string }> = [
	{ path: '/lord-starting-with-the-hunter-card', title: 'LORD: Starting with the Hunter Card' },
	{ path: '/overbearing-tyrant', title: 'Overbearing Tyrant' },
	{ path: '/skeletons-path-to-kingship', title: "Skeleton's Path to Kingship" },
	{ path: '/the-strongest-sect-across-all-realms', title: 'The Strongest Sect Across All Realms' }
];

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

function parseChapterNumber(title: string, fallback = 0): number {
	const m =
		title.match(/chapter\s*(\d+(?:\.\d+)?)/i) ||
		title.match(/\bch\.?\s*(\d+(?:\.\d+)?)/i) ||
		title.match(/(\d+(?:\.\d+)?)/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function isChapterPath(path: string): boolean {
	return /chapter[-_\s]?\d/i.test(path) || /\/\d{4}\/\d{2}\/\d{2}\//.test(path);
}

function isNovelHubPath(path: string): boolean {
	const p = path.replace(/\/$/, '');
	if (isChapterPath(p)) return false;
	if (p === '' || p === '/') return false;
	if (/^\/(category|tag|author|page|feed|wp-|about|privacy)/i.test(p)) return false;
	return NOVEL_HUBS.some((h) => h.path === p) || /^\/[a-z0-9-]+$/i.test(p);
}

export class KrakenBitesSource extends BaseSource {
	id = 'krakenbites';
	name = 'Kraken Bites';
	baseUrl = BASE;

	protected async fetchHtml(path: string): Promise<string> {
	const url = path.startsWith('http')
		? path
		: `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

	const res = await fetch(url, {
		headers: {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
			Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			'Accept-Language': 'en-US,en;q=0.9',
			Referer: this.baseUrl + '/'
		},
		signal: AbortSignal.timeout(20000)
	});

	if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
	return res.text();
}

	async getLatestManga(page = 1): Promise<Manga[]> {
	const fromHubs: Manga[] = NOVEL_HUBS.map((h) => ({
		id: h.path,
		title: h.title,
		cover: '',
		sourceId: this.id,
		type: 'novel',
		lang: 'en'
	}));

	if (page > 1) {
		const extra = await this.parseFeedPage(page).catch(() => [] as Manga[]);
		return this.dedupe([...fromHubs, ...extra]).slice(0, 24);
	}

	const timed = <T>(p: Promise<T>, ms: number) =>
		Promise.race([
			p,
			new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
		]);

	const [fromHome, fromFeed] = await Promise.all([
		timed(this.parseHomeLatest(), 12000).catch(() => [] as Manga[]),
		timed(this.parseFeedPage(1), 12000).catch(() => [] as Manga[])
	]);

	return this.dedupe([...fromHubs, ...fromHome, ...fromFeed]).slice(0, 24);
}
	private dedupe(items: Manga[]): Manga[] {
		const seen = new Set<string>();
		const out: Manga[] = [];
		for (const m of items) {
			const key = m.id;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(m);
		}
		return out;
	}

	private async parseHomeLatest(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		// Menu / nav novel links
		$('a[href]').each((_, el) => {
			const href = $(el).attr('href') || '';
			if (!href.includes('krakenbites.wordpress.com') && !href.startsWith('/')) return;
			const id = pathOnly(href);
			if (!isNovelHubPath(id) || seen.has(id)) return;
			seen.add(id);
			const title = ($(el).text() || '').replace(/\s+/g, ' ').trim();
			if (!title || title.length < 3) return;
			list.push({
				id,
				title,
				cover: '',
				sourceId: this.id,
				type: 'novel',
				lang: 'en'
			});
		});

		// Latest chapter posts → expose as activity on known hubs only (not as separate novels)
		return list;
	}

	private async parseFeedPage(page: number): Promise<Manga[]> {
		// RSS: /feed/ or /feed/?paged=N
		const path = page <= 1 ? '/feed/' : `/feed/?paged=${page}`;
		try {
			const xml = await this.fetchHtml(path);
			const $ = cheerio.load(xml, { xmlMode: true });
			const list: Manga[] = [];
			const seen = new Set<string>();

			$('item').each((_, item) => {
				const cats = $(item)
					.find('category')
					.map((__, c) => $(c).text().trim())
					.get();
				const title = $(item).find('title').first().text().trim();
				const link = $(item).find('link').first().text().trim() || $(item).find('guid').first().text().trim();
				if (!link) return;

				let hub = NOVEL_HUBS.find((h) =>
					cats.some((c) => h.title.toLowerCase().includes(c.toLowerCase()) || c.toLowerCase().includes(h.title.split(':')[0].toLowerCase().slice(0, 12)))
				);
				if (!hub && /lswthc/i.test(title)) {
					hub = NOVEL_HUBS.find((h) => h.path.includes('hunter-card'));
				}
				if (!hub) return;

				if (seen.has(hub.path)) return;
				seen.add(hub.path);
				const chNum = parseChapterNumber(title);
				list.push({
					id: hub.path,
					title: hub.title,
					cover: '',
					sourceId: this.id,
					type: 'novel',
					lang: 'en',
					...(chNum ? { latestChapter: chNum } : {})
				});
			});
			return list;
		} catch {
			return [];
		}
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = (query || '').trim().toLowerCase();
		if (!q) return this.getLatestManga(page);

		const local = NOVEL_HUBS.filter(
			(h) => h.title.toLowerCase().includes(q) || h.path.includes(q.replace(/\s+/g, '-'))
		).map((h) => ({
			id: h.path,
			title: h.title,
			cover: '',
			sourceId: this.id,
			type: 'novel' as const,
			lang: 'en'
		}));

		const path = page <= 1 ? `/?s=${encodeURIComponent(query)}` : `/page/${page}/?s=${encodeURIComponent(query)}`;
		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const fromSearch: Manga[] = [];
			const seen = new Set(local.map((x) => x.id));

			$('article a[href], .entry-title a, h2 a, h3 a').each((_, el) => {
				const href = $(el).attr('href') || '';
				const id = pathOnly(href);
				if (!isNovelHubPath(id) || seen.has(id)) return;
				if (isChapterPath(id)) return;
				seen.add(id);
				const title = ($(el).text() || '').replace(/\s+/g, ' ').trim();
				if (!title || title.length < 3) return;
				fromSearch.push({
					id,
					title,
					cover: '',
					sourceId: this.id,
					type: 'novel',
					lang: 'en'
				});
			});

			return this.dedupe([...local, ...fromSearch]);
		} catch {
			return local;
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		path = path.replace(/\/$/, '');
		if (isChapterPath(path)) {
			throw new Error('Expected novel hub path, got chapter path');
		}

		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const title =
			$('h1.entry-title, h1.wp-block-post-title, h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/[|\-–]/)[0].trim() ||
			NOVEL_HUBS.find((h) => h.path === path)?.title ||
			path.replace(/^\//, '').replace(/-/g, ' ');

		const cover =
			$('meta[property="og:image"]').attr('content') ||
			$('article img, .entry-content img, .wp-block-image img').first().attr('src') ||
			$('img').first().attr('src') ||
			'';

		let description = '';
		const descHeader = $('h2, h3, strong, p').filter((_, el) => /description/i.test($(el).text())).first();
		if (descHeader.length) {
			const parts: string[] = [];
			let n = descHeader.next();
			for (let i = 0; i < 12 && n.length; i++) {
				const t = n.text().replace(/\s+/g, ' ').trim();
				if (/^chapters$/i.test(t) || /^author:/i.test(t)) break;
				if (t.length > 40) parts.push(t);
				n = n.next();
			}
			description = parts.join('\n\n');
		}
		if (!description) {
			description =
				$('meta[property="og:description"]').attr('content') ||
				$('.entry-content p, article p')
					.map((_, p) => $(p).text().replace(/\s+/g, ' ').trim())
					.get()
					.filter((t) => t.length > 60)
					.slice(0, 6)
					.join('\n\n');
		}

		const authors: string[] = [];
		const bodyText = $('article, .entry-content, main').text();
		const authorMatch = bodyText.match(/Author:\s*([^\n(]+)/i);
		if (authorMatch) {
			const a = authorMatch[1].replace(/\s+/g, ' ').trim();
			if (a) authors.push(a);
		}

		const chapters = this.parseToc($);
		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		return {
			id: pathOnly(path),
			title,
			cover: absUrl((cover || '').split('?')[0]),
			sourceId: this.id,
			description,
			authors,
			status: 'Ongoing',
			genres: [],
			chapters,
			type: 'novel',
			lang: 'en',
			...(chapters[0]?.number != null ? { latestChapter: chapters[0].number } : {})
		};
	}

	private parseToc($: cheerio.CheerioAPI): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		$('a[href]').each((i, el) => {
			const href = $(el).attr('href') || '';
			if (!href.includes('krakenbites') && !href.startsWith('/')) return;
			const id = pathOnly(href);
			if (!isChapterPath(id)) return;
			if (seen.has(id)) return;
			seen.add(id);

			const raw = ($(el).text() || $(el).attr('title') || '').replace(/\s+/g, ' ').trim();
			if (!raw || raw.length < 2) return;
			const num = parseChapterNumber(raw, i + 1);
			out.push({
				id,
				title: raw.length > 80 ? `Chapter ${num}` : raw,
				number: num
			});
		});

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

		const title =
			$('h1.entry-title, h1.wp-block-post-title, h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/[|\-–]/)[0].trim() ||
			'Chapter';

		const contentRoot = $('.entry-content, .wp-block-post-content, article .post, article').first();

		contentRoot.find('script, style, .sharedaddy, .jp-relatedposts, nav, .navigation, form, .wp-block-jetpack-subscriptions-subscribe').remove();

		const paragraphs: string[] = [];
		contentRoot.find('p').each((_, p) => {
			const t = $(p).text().replace(/\s+/g, ' ').trim();
			if (!t) return;
			if (/^(days|hours|minutes|seconds|until|next chapter|system wiki)$/i.test(t)) return;
			if (t.length < 3) return;
			paragraphs.push(t);
		});

		let cut = paragraphs.findIndex((t) => /^system wiki$/i.test(t));
		if (cut < 0) cut = paragraphs.findIndex((t) => /^card grades/i.test(t));
		const body = (cut > 5 ? paragraphs.slice(0, cut) : paragraphs).join('\n\n');
		
		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		$('a[href*="chapter"], a[rel="prev"], a[rel="next"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const text = $(a).text().toLowerCase();
			const id = pathOnly(href);
			if (!isChapterPath(id)) return;
			if (/prev|previous|older/i.test(text) || $(a).attr('rel') === 'prev') prevChapterId = id;
			if (/next|newer/i.test(text) || $(a).attr('rel') === 'next') nextChapterId = id;
		});

		return {
			title,
			content: body || contentRoot.text().replace(/\s+/g, ' ').trim(),
			prevChapterId,
			nextChapterId
		};
	}
}

export default KrakenBitesSource;
