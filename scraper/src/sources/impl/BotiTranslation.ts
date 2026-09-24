/**
 * BotiTranslation.com — custom SPA novel site
 * Path: scraper/src/sources/impl/BotiTranslation.ts
 *
 * URL pattern:
 *   Book    : /book/{id}-{slug}
 *   Chapter : /chapter/{id}-chapter-{n}-{title}
 *   Home    : /
 *
 * PERINGATAN:
 * - Cloudflare Turnstile sangat ketat (bukan sekadar JS challenge)
 * - Halaman book/chapter adalah SPA — HTML SSR hampir kosong ("Loading...")
 * - Cheerio saja sering gagal; butuh Worker + kemungkinan reverse-API
 * - Chapter VIP / early-access mungkin tidak bisa diambil
 *
 * Adapter ini mencoba:
 * 1) Parse link /book/ dari homepage (kalau HTML lolos CF)
 * 2) API heuristics umum
 * 3) Parse chapter content dari DOM bila ada
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
				: `https://botitranslation.com${href.startsWith('/') ? '' : '/'}${href}`
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

function parseChapterNumber(title: string, fallback: number): number {
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

function extractChapterNum(text: string): number | undefined {
	const t = (text || '').replace(/\s+/g, ' ').trim();
	if (!t) return undefined;
	const m =
		t.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/(\d+(?:\.\d+)?)/);
	if (!m) return undefined;
	const n = parseFloat(m[1]);
	return Number.isNaN(n) ? undefined : n;
}

/** Ambil numeric book id dari path /book/12345-slug */
function bookIdFromPath(path: string): string | null {
	const m = path.match(/\/book\/(\d+)/);
	return m ? m[1] : null;
}

export class BotiTranslationSource extends BaseSource {
	id = 'botitranslation';
	name = 'BotiTranslation';
	baseUrl = 'https://botitranslation.com';

	async getLatestManga(page = 1): Promise<Manga[]> {
		// Homepage + pagination heuristic
		const paths =
			page <= 1
				? ['/', '/?page=1', '/novels', '/novels?page=1']
				: [`/?page=${page}`, `/page/${page}/`, `/novels?page=${page}`];

		const all: Manga[] = [];
		for (const path of paths) {
			try {
				const html = await this.fetchHtml(path);
				this.assertNotCf(html);
				const list = this.parseBookLinks(html);
				for (const m of list) {
					if (!all.some((x) => x.id === m.id)) all.push(m);
				}
				if (all.length >= 12) break;
			} catch {
				/* next */
			}
		}

		// Coba API list (beberapa SPA expose JSON)
		if (all.length < 8) {
			const apiList = await this.tryApiList(page).catch(() => [] as Manga[]);
			for (const m of apiList) {
				if (!all.some((x) => x.id === m.id)) all.push(m);
			}
		}

		return all.slice(0, 24);
	}

	private assertNotCf(html: string): void {
		const low = html.slice(0, 2500).toLowerCase();
		if (
			(low.includes('just a moment') ||
				low.includes('cf-browser-verification') ||
				low.includes('challenge-platform') ||
				low.includes('turnstile') ||
				low.includes('verify you are human')) &&
			html.length < 30000
		) {
			throw new Error('Cloudflare blocked this request (Turnstile)');
		}
	}

	private parseBookLinks(html: string): Manga[] {
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('a[href*="/book/"]').each((_, el) => {
			const href = $(el).attr('href') || '';
			if (!href || !/\/book\/\d+/.test(href)) return;
			// Skip chapter-like
			if (/\/chapter\//.test(href)) return;

			const id = pathOnly(href);
			if (seen.has(id)) return;
			seen.add(id);

			const title =
				($(el).attr('title') || $(el).text() || '')
					.replace(/\s+/g, ' ')
					.trim() ||
				id.replace(/^\/book\/\d+-?/, '').replace(/-/g, ' ');
			if (!title || title.length < 2) return;

			const parent = $(el).closest('div, article, li, a');
			const cover =
				parent.find('img').attr('data-src') ||
				parent.find('img').attr('src') ||
				$(el).find('img').attr('src') ||
				'';

			const chText =
				parent.find('a[href*="/chapter/"]').first().text() ||
				parent.text().match(/Chapter\s*\d+/i)?.[0] ||
				'';
			const latestChapter = extractChapterNum(chText);

			list.push({
				id,
				title,
				cover: absUrl(this.baseUrl, (cover || '').split('?')[0]),
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				...(latestChapter != null ? { latestChapter } : {})
			});
		});

		return list;
	}

	/** Heuristic API endpoints — mungkin berubah */
	private async tryApiList(page: number): Promise<Manga[]> {
		const candidates = [
			`/api/books?page=${page}`,
			`/api/novels?page=${page}`,
			`/api/v1/books?page=${page}`,
			`/api/book/list?page=${page}`,
			`/api/novel/list?page=${page}`
		];
		for (const path of candidates) {
			try {
				const res = await fetch(absUrl(this.baseUrl, path), {
					headers: {
						...this.headers,
						Accept: 'application/json',
						'X-Requested-With': 'XMLHttpRequest'
					}
				});
				if (!res.ok) continue;
				const ct = res.headers.get('content-type') || '';
				if (!ct.includes('json')) continue;
				const data = await res.json();
				const items = this.normalizeApiList(data);
				if (items.length) return items;
			} catch {
				/* next */
			}
		}
		return [];
	}

	private normalizeApiList(data: any): Manga[] {
		const arr =
			(Array.isArray(data) && data) ||
			data?.data ||
			data?.books ||
			data?.novels ||
			data?.results ||
			data?.items ||
			[];
		if (!Array.isArray(arr)) return [];
		const out: Manga[] = [];
		for (const item of arr) {
			const idNum = item.id ?? item.book_id ?? item.novel_id;
			const slug = item.slug ?? item.slug_name ?? item.name_slug ?? '';
			const title = item.title ?? item.name ?? item.book_name ?? '';
			if (!idNum || !title) continue;
			const id = `/book/${idNum}${slug ? `-${slug}` : ''}`;
			const cover = item.cover ?? item.cover_url ?? item.image ?? item.thumbnail ?? '';
			const latestChapter =
				extractChapterNum(String(item.latest_chapter ?? item.last_chapter ?? item.chapter_count ?? '')) ??
				undefined;
			out.push({
				id,
				title: String(title),
				cover: absUrl(this.baseUrl, cover),
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				...(latestChapter != null ? { latestChapter } : {})
			});
		}
		return out;
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = encodeURIComponent(query);

		// HTML search
		const htmlPaths = [`/?s=${q}`, `/search?q=${q}`, `/search?keyword=${q}&page=${page}`];
		for (const path of htmlPaths) {
			try {
				const html = await this.fetchHtml(path);
				this.assertNotCf(html);
				const list = this.parseBookLinks(html);
				if (list.length) return list;
			} catch {
				/* next */
			}
		}

		// API search
		const apiPaths = [
			`/api/books/search?q=${q}&page=${page}`,
			`/api/search?keyword=${q}&page=${page}`,
			`/api/v1/search?q=${q}`
		];
		for (const path of apiPaths) {
			try {
				const res = await fetch(absUrl(this.baseUrl, path), {
					headers: { ...this.headers, Accept: 'application/json' }
				});
				if (!res.ok) continue;
				const data = await res.json();
				const items = this.normalizeApiList(data);
				if (items.length) return items;
			} catch {
				/* next */
			}
		}
		return [];
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		if (!path.includes('/book/')) {
			path = `/book${path.startsWith('/') ? path : `/${path}`}`;
		}
		path = path.endsWith('/') ? path.slice(0, -1) : path;

		const html = await this.fetchHtml(path);
		this.assertNotCf(html);
		const $ = cheerio.load(html);

		// SPA shell detection
		const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
		const looksEmpty =
			bodyText.length < 200 ||
			/^loading/i.test(bodyText) ||
			bodyText.toLowerCase().includes('sign in');

		const title =
			$('h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/[|\-–]/)[0].trim() ||
			$('title').text().split(/[|\-–]/)[0].trim() ||
			path.replace(/^\/book\/\d+-?/, '').replace(/-/g, ' ');

		if (!title || title.length < 2) {
			throw new Error('Manga not found (empty title — SPA/CF?)');
		}

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('meta[name="twitter:image"]').attr('content') ||
			$('img').first().attr('src') ||
			'';
		cover = (cover || '').split('?')[0];

		let description =
			$('meta[property="og:description"]').attr('content') ||
			$('[class*="synopsis"], [class*="summary"], [class*="description"]')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			'';

		// Chapters dari HTML (TOC)
		let chapters = this.parseChapterLinks($, path);

		// API fallback untuk chapters
		if (!chapters.length) {
			const bid = bookIdFromPath(path);
			if (bid) {
				chapters = await this.tryApiChapters(bid).catch(() => []);
			}
		}

		chapters.sort((a, b) => {
			const na = typeof a.number === 'number' ? a.number : 0;
			const nb = typeof b.number === 'number' ? b.number : 0;
			return nb - na;
		});

		if (looksEmpty && !chapters.length) {
			throw new Error(
				'SPA content not in HTML — Cloudflare/API required. Deploy via hybrid Worker and reverse the site API if needed.'
			);
		}

		return {
			id: pathOnly(path),
			title,
			cover: absUrl(this.baseUrl, cover),
			sourceId: this.id,
			description,
			authors: [],
			status: 'Ongoing',
			genres: [],
			chapters,
			type: 'novel',
			lang: 'en'
		};
	}

	private parseChapterLinks($: cheerio.CheerioAPI, bookPath: string): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		$('a[href*="/chapter/"]').each((i, el) => {
			const href = $(el).attr('href') || '';
			if (!href) return;
			const rawTitle = ($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim();
			if (!rawTitle || rawTitle.length < 2) return;
			const num = parseChapterNumber(rawTitle, i + 1);
			const id = pathOnly(href);
			if (seen.has(id)) return;
			seen.add(id);
			out.push({ id, title: `Chapter ${num}`, number: num });
		});

		return out;
	}

	private async tryApiChapters(bookId: string): Promise<Chapter[]> {
		const candidates = [
			`/api/book/${bookId}/chapters`,
			`/api/books/${bookId}/chapters`,
			`/api/v1/book/${bookId}/chapters`,
			`/api/novel/${bookId}/chapters`,
			`/api/chapters?book_id=${bookId}`
		];
		for (const path of candidates) {
			try {
				const res = await fetch(absUrl(this.baseUrl, path), {
					headers: { ...this.headers, Accept: 'application/json' }
				});
				if (!res.ok) continue;
				const data = await res.json();
				const arr =
					(Array.isArray(data) && data) ||
					data?.data ||
					data?.chapters ||
					data?.results ||
					[];
				if (!Array.isArray(arr) || !arr.length) continue;
				const out: Chapter[] = [];
				arr.forEach((c: any, i: number) => {
					const cid = c.id ?? c.chapter_id;
					const title = c.title ?? c.name ?? `Chapter ${c.number ?? i + 1}`;
					const num = parseChapterNumber(String(title), Number(c.number ?? c.index ?? i + 1));
					const slug = c.slug ?? String(title).toLowerCase().replace(/\s+/g, '-');
					const id = cid
						? `/chapter/${cid}-chapter-${num}-${slug}`.replace(/-+/g, '-').slice(0, 120)
						: pathOnly(c.url || c.link || '');
					if (!id) return;
					out.push({ id, title: `Chapter ${num}`, number: num });
				});
				if (out.length) return out;
			} catch {
				/* next */
			}
		}
		return [];
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
		const html = await this.fetchHtml(path.endsWith('/') ? path : path);
		this.assertNotCf(html);
		const $ = cheerio.load(html);

		const title =
			$('h1, h2.chapter-title, .chapter-title').first().text().trim() ||
			$('title').text().split(/[|\-–]/)[0].trim() ||
			'Chapter';

		const containers = [
			'.chapter-content',
			'#chapter-content',
			'.reading-content',
			'.content',
			'article',
			'[class*="chapter"]',
			'main'
		];

		let contentHtml = '';
		for (const sel of containers) {
			const el = $(sel).first();
			if (!el.length) continue;
			const clone = el.clone();
			clone.find('script, style, iframe, .ads, nav, .unlock, .vip, .paywall').remove();
			const paras = clone.find('p');
			if (paras.length >= 2) {
				const parts: string[] = [];
				paras.each((_, p) => {
					const t = $(p).text().trim();
					if (!t) return;
					if (/botitranslation|sign in|vip|patreon/i.test(t)) return;
					parts.push(`<p>${escapeHtml(t)}</p>`);
				});
				if (parts.length >= 2) {
					contentHtml = parts.join('\n');
					break;
				}
			}
			const inner = clone.html()?.trim() || '';
			if (inner.length > 300) {
				contentHtml = inner;
				break;
			}
		}

		// API content fallback
		if (!contentHtml || contentHtml.length < 80) {
			const m = path.match(/\/chapter\/(\d+)/);
			if (m) {
				const apiContent = await this.tryApiChapterContent(m[1]).catch(() => '');
				if (apiContent) contentHtml = apiContent;
			}
		}

		if (!contentHtml || contentHtml.length < 50) {
			contentHtml =
				'<p><em>Konten kosong — situs SPA + Cloudflare Turnstile. HTML tidak berisi teks chapter. Perlu reverse-engineer API internal atau browser automation.</em></p>';
		}

		return {
			title,
			content: contentHtml,
			prevChapterId: null,
			nextChapterId: null
		};
	}

	private async tryApiChapterContent(chapterId: string): Promise<string> {
		const candidates = [
			`/api/chapter/${chapterId}`,
			`/api/chapters/${chapterId}`,
			`/api/v1/chapter/${chapterId}`,
			`/api/chapter/content?id=${chapterId}`
		];
		for (const path of candidates) {
			try {
				const res = await fetch(absUrl(this.baseUrl, path), {
					headers: { ...this.headers, Accept: 'application/json' }
				});
				if (!res.ok) continue;
				const data = await res.json();
				const text =
					data?.content ||
					data?.data?.content ||
					data?.chapter?.content ||
					data?.text ||
					'';
				if (typeof text === 'string' && text.length > 50) {
					// Jika plain text → wrap p
					if (!text.includes('<')) {
						return text
							.split(/\n{2,}/)
							.map((p: string) => `<p>${escapeHtml(p.trim())}</p>`)
							.join('\n');
					}
					return text;
				}
			} catch {
				/* next */
			}
		}
		return '';
	}
}

export default BotiTranslationSource;
