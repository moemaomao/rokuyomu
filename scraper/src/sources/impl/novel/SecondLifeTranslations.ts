/**
 * Second Life Translations (secondlifetranslations.com)
 * Path: scraper/src/sources/impl/novel/SecondLifeTranslations.ts
 *
 * WordPress novel site (OceanWP-style).
 *
 * URLs:
 *   /                          → homepage (Latest Releases)
 *   /novels/                   → novel index
 *   /novel/{slug}/             → series page (meta, summary, accordion TOC)
 *   /category/{slug}/          → alternate chapter archive
 *   /{seriesSlug}/{chapterSlug}/ → chapter body
 *
 * Chapter body: .entry-content.clr
 * Obfuscation: <span class="jmbl">…</span> uses letter substitution cipher
 *   clear: a-zA-Z
 *   crypt: rhbndjzvqkiexcwsfpogytumalVUQXWSAZKBJNTLEDGIRHCPFOMY
 *
 * Cloudflare: all fetches go through fetchWithCf (set BYPARR_URL when needed).
 */
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';
import { fetchWithCf } from '../../../lib/fetchWithCf';

const PAGE_SIZE = 24;

const CLEAR = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CRYPT = 'rhbndjzvqkiexcwsfpogytumalVUQXWSAZKBJNTLEDGIRHCPFOMY';
const DECRYPT: Record<string, string> = {};
for (let i = 0; i < CLEAR.length; i++) {
	DECRYPT[CRYPT[i]] = CLEAR[i];
}

function decryptJmbl(s: string): string {
	return Array.from(s, (c) => DECRYPT[c] ?? c).join('');
}

function decodeEntities(s: string): string {
	return (s || '')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#8217;/g, "'")
		.replace(/&#8216;/g, "'")
		.replace(/&#8220;/g, '"')
		.replace(/&#8221;/g, '"')
		.replace(/&#8211;/g, '–')
		.replace(/&#8230;/g, '…')
		.replace(/&nbsp;/g, ' ');
}

function stripHtml(html: string): string {
	return decodeEntities(
		html
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/p>/gi, '\n\n')
			.replace(/<[^>]+>/g, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
}

function cleanTitle(raw: string): string {
	return decodeEntities(raw || '')
		.replace(/\s+/g, ' ')
		.replace(/\s*(?:[–—|]|-)\s*Second\s*Life\s*Translations?\s*$/i, '')
		.trim();
}

function parseChapterNumber(title: string, slug = ''): number {
	const fromSlug = slug.match(/(?:chapter|ch)[-_]?(\d+)(?:[-_.](\d+))?/i);
	if (fromSlug) {
		const major = parseInt(fromSlug[1], 10);
		if (fromSlug[2]) return parseFloat(`${major}.${fromSlug[2]}`);
		return major;
	}
	const m = title.match(
		/(?:chapter|chap|ch\.?|episode|ep\.?)\s*(\d+)(?:[.,](\d+))?/i
	);
	if (m) {
		if (m[2]) return parseFloat(`${m[1]}.${m[2]}`);
		return parseInt(m[1], 10);
	}

	const dotted = title.match(/^(\d+)\.(\d+)\b/);
	if (dotted) return parseFloat(`${dotted[1]}.${dotted[2]}`);
	const plain = title.match(/^(\d+)\b/);
	if (plain) return parseInt(plain[1], 10);
	if (/prologue/i.test(title) || /prologue/i.test(slug)) return 0;
	if (/epilogue|extra|finale/i.test(title)) {
		const n = title.match(/(\d+(?:\.\d+)?)/);
		return n ? 9000 + parseFloat(n[1]) : 9999;
	}
	const n = title.match(/\b(\d+(?:\.\d+)?)\b/);
	return n ? parseFloat(n[1]) : 0;
}

function cleanChapterTitle(raw: string, number: number): string {
	const t = cleanTitle(raw);
	if (/prologue/i.test(t)) return 'Prologue';
	if (/epilogue/i.test(t) && !/\d/.test(t)) return 'Epilogue';
	if (/^extra\b/i.test(t) || /\bextra\s*\d/i.test(t)) {
		const n = t.match(/(\d+(?:\.\d+)?)/);
		return n ? `Extra ${n[1]}` : 'Extra';
	}
	if (Number.isFinite(number) && number > 0) {
		const str =
			Math.abs(number - Math.floor(number)) > 1e-9
				? String(number)
				: String(Math.floor(number));
		return `Chapter ${str}`;
	}
	return t.replace(/\s*[–—:|:]\s*.+$/, '').trim() || t;
}

function pathFromHref(href: string): string {
	try {
		const u = new URL(href, 'https://secondlifetranslations.com');
		let p = u.pathname.replace(/\/+$/, '') || '/';
		if (!p.startsWith('/')) p = `/${p}`;
		return p;
	} catch {
		let p = (href || '').split('?')[0].split('#')[0];
		if (!p.startsWith('/')) p = `/${p}`;
		return p.replace(/\/+$/, '') || '/';
	}
}

function normalizeChapterId(id: string): string {
	return pathFromHref(id);
}

function absUrl(src: string, base = 'https://secondlifetranslations.com'): string {
	if (!src) return '';
	if (src.startsWith('//')) return 'https:' + src;
	if (src.startsWith('http')) return src;
	if (src.startsWith('/')) return base + src;
	return `${base}/${src}`;
}

function metaContent(html: string, prop: string): string {
	const re = new RegExp(
		`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
		'i'
	);
	const re2 = new RegExp(
		`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
		'i'
	);
	return decodeEntities(html.match(re)?.[1] || html.match(re2)?.[1] || '');
}

function decryptChapterHtml(raw: string): string {
	let html = raw || '';
	html = html.replace(
		/<span[^>]*class=["'][^"']*jmbl[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi,
		(_, inner: string) => decryptJmbl(stripHtml(inner) || inner.replace(/<[^>]+>/g, ''))
	);
	html = html.replace(/<[^>]*class=["'][^"']*jmbl-disclaimer[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, '');
	return html.trim();
}

const SKIP_PATHS = new Set([
	'novels',
	'novel',
	'category',
	'tag',
	'author',
	'page',
	'wp-admin',
	'wp-content',
	'wp-json',
	'feed',
	'comments',
	'login',
	'register',
	'shop',
	'donate',
	'discord',
	'about',
	'contact',
	'support'
]);

export class SecondLifeTranslationsSource extends BaseSource {
	id = 'secondlifetranslations';
	name = 'Second Life Translations';
	baseUrl = 'https://secondlifetranslations.com';

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept:
			'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: 'https://secondlifetranslations.com/',
		Origin: 'https://secondlifetranslations.com'
	};

	private async fetchPage(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const body = await fetchWithCf(url, {
			headers: {
				...this.headers,
				Referer: this.baseUrl
			}
		});
		const head = (body || '').slice(0, 2500);
		if (
			/just a moment|checking your browser|request is being verified|cf-browser-verification/i.test(
				head
			)
		) {
			throw new Error(
				`Cloudflare challenge on ${url} — set BYPARR_URL and restart scraper`
			);
		}
		return body;
	}

	private parseListing(html: string): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		const novelRe =
			/<a[^>]+href=["'](https?:\/\/(?:www\.)?secondlifetranslations\.com\/novel\/([a-z0-9][a-z0-9-]*)\/?|\/novel\/([a-z0-9][a-z0-9-]*)\/?)["'][^>]*>([\s\S]*?)<\/a>/gi;
		let m: RegExpExecArray | null;
		while ((m = novelRe.exec(html)) !== null) {
			const slug = (m[2] || m[3] || '').toLowerCase();
			if (!slug || SKIP_PATHS.has(slug)) continue;
			const id = `/novel/${slug}`;
			if (seen.has(id)) continue;
			seen.add(id);

			const inner = m[4] || '';
			const img =
				inner.match(/<img[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["']/i)?.[1] ||
				'';
			const titleText =
				cleanTitle(stripHtml(inner).split('\n')[0] || '') ||
				slug
					.split('-')
					.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
					.join(' ');

			out.push({
				id,
				title: titleText,
				cover: absUrl(img),
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: 'Ongoing'
			});
		}

		const hRe =
			/<a[^>]+href=["'](https?:\/\/(?:www\.)?secondlifetranslations\.com\/novel\/([a-z0-9-]+)\/?)["'][^>]*>\s*([^<]{3,120})\s*<\/a>/gi;
		while ((m = hRe.exec(html)) !== null) {
			const slug = (m[2] || '').toLowerCase();
			if (!slug || SKIP_PATHS.has(slug)) continue;
			const id = `/novel/${slug}`;
			if (seen.has(id)) continue;
			seen.add(id);
			out.push({
				id,
				title: cleanTitle(m[3]),
				cover: '',
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: 'Ongoing'
			});
		}

		return out;
	}

	async getLatestManga(page = 1): Promise<Manga[]> {
		const pageNum = Math.max(1, page);
		const seen = new Set<string>();
		const out: Manga[] = [];

		const paths =
			pageNum <= 1
				? ['/', '/novels/']
				: [`/novels/page/${pageNum}/`, `/novels/?page=${pageNum}`];

		for (const path of paths) {
			try {
				const html = await this.fetchPage(path);
				for (const item of this.parseListing(html)) {
					if (seen.has(item.id)) continue;
					seen.add(item.id);
					out.push(item);
				}
				if (out.length >= PAGE_SIZE) break;
			} catch (e) {
				console.error(`[SecondLifeTranslations] list ${path} failed`, e);
			}
		}

		const need = out.filter((m) => !m.cover).slice(0, 12);
		await Promise.all(
			need.map(async (item) => {
				try {
					const html = await this.fetchPage(item.id + '/');
					const ogImg = metaContent(html, 'og:image');
					const ogTitle = metaContent(html, 'og:title');
					if (ogImg) item.cover = absUrl(ogImg);
					if (ogTitle) item.title = cleanTitle(ogTitle);
					if (/Completed/i.test(html)) item.status = 'Completed';
				} catch {
					/* ignore */
				}
			})
		);

		const start = (pageNum - 1) * PAGE_SIZE;
		if (pageNum <= 1) return out.slice(0, PAGE_SIZE);
		return out.slice(0, PAGE_SIZE).length ? out.slice(0, PAGE_SIZE) : out.slice(start, start + PAGE_SIZE);
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = query.trim();
		if (!q) return [];

		const seen = new Set<string>();
		const out: Manga[] = [];

		const paths = [
			`/?s=${encodeURIComponent(q)}`,
			`/novels/?s=${encodeURIComponent(q)}`
		];

		for (const path of paths) {
			try {
				const html = await this.fetchPage(path);
				for (const item of this.parseListing(html)) {
					if (seen.has(item.id)) continue;
					seen.add(item.id);
					out.push(item);
				}
			} catch (e) {
				console.error('[SecondLifeTranslations] search failed', e);
			}
		}

		if (out.length === 0) {
			try {
				const html = await this.fetchPage(`/novels/`);
				const all = this.parseListing(html);
				const ql = q.toLowerCase();
				for (const item of all) {
					if (
						item.title.toLowerCase().includes(ql) ||
						item.id.toLowerCase().includes(ql)
					) {
						if (seen.has(item.id)) continue;
						seen.add(item.id);
						out.push(item);
					}
				}
			} catch {
				/* ignore */
			}
		}

		const start = (Math.max(1, page) - 1) * PAGE_SIZE;
		return out.slice(start, start + PAGE_SIZE);
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = mangaId
			.replace(/^\/+/, '')
			.replace(/\/+$/, '')
			.replace(/^novel\//, '')
			.split('/')
			.filter(Boolean)[0];
		if (!slug) throw new Error(`Invalid manga id: ${mangaId}`);

		const path = `/novel/${slug}/`;
		const html = await this.fetchPage(path);

		const title =
			cleanTitle(metaContent(html, 'og:title')) ||
			cleanTitle(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '') ||
			slug;

		const cover = absUrl(metaContent(html, 'og:image'));

		let description = '';
		const summaryBlock =
			html.match(/##?\s*Summary[\s\S]{0,50}?(?:<p[^>]*>)([\s\S]*?)(?:<\/p>)/i) ||
			html.match(
				/<div[^>]*class=["'][^"']*novelcontent[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
			);
		if (summaryBlock) {
			description = stripHtml(summaryBlock[1]).slice(0, 3000);
		}
		if (!description) {
			description = metaContent(html, 'og:description').slice(0, 2000);
		}

		const authors: string[] = [];
		const authorM =
			html.match(/Author\s*:\s*<\/?(?:strong|b|span)[^>]*>\s*([^<]+)/i) ||
			html.match(/<strong>\s*Author\s*:\s*<\/strong>\s*([^<]+)/i) ||
			html.match(/Author\s*:\s*([^\n<]+)/i);
		if (authorM) authors.push(cleanTitle(authorM[1]));

		const genres: string[] = [];
		const genreBlock = html.match(/Genres?\s*:\s*([\s\S]{0,400}?)<\//i);
		if (genreBlock) {
			const bits = stripHtml(genreBlock[1])
				.split(/[,|/]/)
				.map((g) => cleanTitle(g))
				.filter((g) => g.length > 1 && g.length < 40);
			genres.push(...bits);
		}

		for (const tm of html.matchAll(
			/href=["'][^"']*\/tag\/[^"']+["'][^>]*>([^<]+)</gi
		)) {
			const g = cleanTitle(tm[1]);
			if (g && !genres.includes(g)) genres.push(g);
		}

		let status = 'Ongoing';
		if (/Translation\s*Status\s*:\s*Completed/i.test(html) || />\s*Completed\s*</i.test(html)) {
			status = 'Completed';
		} else if (/Hiatus/i.test(html)) {
			status = 'Hiatus';
		}

		const altTitles: string[] = [];
		const rawTitle = html.match(/Raw\s*Title[^:]*:\s*([^<\n]+)/i);
		if (rawTitle) altTitles.push(cleanTitle(rawTitle[1]));

		let chapters = this.parseChaptersFromSeriesHtml(html, slug);
		if (chapters.length < 3) {
			try {
				const catHtml = await this.fetchPage(`/category/${slug}/`);
				const more = this.parseChaptersFromCategoryHtml(catHtml, slug);
				if (more.length > chapters.length) chapters = more;
			} catch {
			}
		}
	
		chapters = this.finalizeChapters(chapters);

		const latestNum = chapters.length ? chapters[0].number : undefined;

		return {
			id: `/novel/${slug}`,
			title,
			cover,
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters,
			type: 'novel',
			lang: 'en',
			...(latestNum != null ? { latestChapter: latestNum } : {})
		};
	}

	private finalizeChapters(raw: Chapter[]): Chapter[] {
		const list = [...raw];

		list.sort((a, b) => {
			if (a.number !== b.number) return a.number - b.number;
			return a.id.localeCompare(b.id);
		});

		let seq = 0;
		for (const ch of list) {
			if (!ch.number || ch.number <= 0) {
				seq += 1;
				ch.number = seq;
			} else {
				seq = Math.max(seq, Math.floor(ch.number));
			}
			ch.id = normalizeChapterId(ch.id);
			ch.title = cleanChapterTitle(ch.title, ch.number);
			if (ch.isLocked == null) ch.isLocked = false;
		}
		list.sort((a, b) => {
			if (b.number !== a.number) return b.number - a.number;
			return a.id.localeCompare(b.id);
		});
		return list;
	}

	private parseChaptersFromSeriesHtml(html: string, seriesSlug: string): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		const linkRe =
			/<a[^>]+href=["'](https?:\/\/(?:www\.)?secondlifetranslations\.com\/[^"']+|\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
		let m: RegExpExecArray | null;
		while ((m = linkRe.exec(html)) !== null) {
			const path = normalizeChapterId(m[1] || '');
			const text = cleanTitle(stripHtml(m[2] || ''));
			if (!path || path === `/novel/${seriesSlug}`) continue;
			const isChapter =
				/chapter|extra|prologue|epilogue|finale/i.test(path + ' ' + text) ||
				new RegExp(`/${seriesSlug}/`, 'i').test(path);
			if (!isChapter) continue;
			if (/\/novel\//i.test(path) && !/chapter/i.test(path)) continue;
			if (seen.has(path)) continue;
			seen.add(path);

			const num = parseChapterNumber(text, path.split('/').pop() || '');
			out.push({
				id: path,
				title: text || `Chapter ${num}`,
				number: num,
				isLocked: false
			});
		}

		return this.finalizeChapters(out);
	}

	private parseChaptersFromCategoryHtml(html: string, seriesSlug: string): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		const artRe =
			/<a[^>]+href=["'](https?:\/\/(?:www\.)?secondlifetranslations\.com\/[^"']+|\/[^"']+)["'][^>]*>\s*([^<]{2,150})\s*<\/a>/gi;
		let m: RegExpExecArray | null;
		while ((m = artRe.exec(html)) !== null) {
			const path = normalizeChapterId(m[1] || '');
			const text = cleanTitle(m[2] || '');
			if (!path || seen.has(path)) continue;
			if (
				!new RegExp(seriesSlug, 'i').test(path) &&
				!/chapter|extra|prologue|epilogue/i.test(text)
			) {
				continue;
			}
			if (/\/novel\//i.test(path) && !/chapter/i.test(path)) continue;
			seen.add(path);
			const num = parseChapterNumber(text, path.split('/').pop() || '');
			out.push({
				id: path,
				title: text || `Chapter ${num}`,
				number: num,
				isLocked: false
			});
		}

		return this.finalizeChapters(out);
	}

	private async loadSeriesChapters(seriesSlug: string): Promise<Chapter[]> {
		try {
			const html = await this.fetchPage(`/novel/${seriesSlug}/`);
			let chs = this.parseChaptersFromSeriesHtml(html, seriesSlug);
			if (chs.length < 3) {
				const catHtml = await this.fetchPage(`/category/${seriesSlug}/`);
				const more = this.parseChaptersFromCategoryHtml(catHtml, seriesSlug);
				if (more.length > chs.length) chs = more;
			}
			return chs;
		} catch {
			return [];
		}
	}

	private seriesSlugFromChapterPath(path: string): string | null {
		const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);
		if (parts.length >= 1) {
			const first = parts[0].toLowerCase();
			if (!SKIP_PATHS.has(first) && first !== 'novel' && first !== 'category') {
				return first;
			}
		}
		return null;
	}

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	private extractChapterBody(html: string): string {
		const startRe =
			/<div[^>]+class=["'][^"']*\bentry-content\b[^"']*["'][^>]*>/i;
		const start = html.search(startRe);
		if (start >= 0) {
			const openTag = html.slice(start).match(startRe)![0];
			let i = start + openTag.length;
			let depth = 1;
			while (i < html.length && depth > 0) {
				const nextOpen = html.indexOf('<div', i);
				const nextClose = html.indexOf('</div>', i);
				if (nextClose < 0) break;
				if (nextOpen >= 0 && nextOpen < nextClose) {
					depth++;
					i = nextOpen + 4;
				} else {
					depth--;
					if (depth === 0) {
						return html.slice(start + openTag.length, nextClose);
					}
					i = nextClose + 6;
				}
			}
		}

		const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
		const scope = articleMatch?.[1] || html;
		const paras: string[] = [];
		const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
		let pm: RegExpExecArray | null;
		while ((pm = pRe.exec(scope)) !== null) {
			const inner = pm[1] || '';
			const text = stripHtml(inner);
			if (text.length < 20) continue;
			if (
				/^(previous|next|share|advertisements?|related posts?|leave a reply|you may also)/i.test(
					text
				)
			) {
				continue;
			}
			paras.push(`<p>${inner}</p>`);
		}
		if (paras.length >= 3) return paras.join('\n');
		return '';
	}

	private cleanChapterBody(raw: string): string {
		let html = raw || '';
		html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
		html = html.replace(/<style[\s\S]*?<\/style>/gi, '');
		html = html.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
		html = html.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
		for (let n = 0; n < 4; n++) {
			html = html.replace(
				/<div[^>]+class=["'][^"']*(?:adsbygoogle|code-block|sharedaddy|jp-relatedposts|ad-container|\bads\b|advertisement|wpcnt|sd-content)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
				''
			);
		}
		html = html.replace(/<p[^>]*>\s*Advertisements?\s*<\/p>/gi, '');
		html = html.replace(/<h[1-6][^>]*>\s*Advertisements?\s*<\/h[1-6]>/gi, '');
		html = html.replace(
			/(?:<hr[^>]*>\s*)?(?:<div[^>]+class=["'][^"']*(?:sharedaddy|jp-|support)[^"']*["'][\s\S]*)$/i,
			''
		);
		return html.trim();
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		const path = normalizeChapterId(chapterId);
		const html = await this.fetchPage(path.endsWith('/') ? path : `${path}/`);

		const rawTitle =
			cleanTitle(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '') ||
			cleanTitle(metaContent(html, 'og:title')) ||
			'Chapter';
		const num = parseChapterNumber(rawTitle, path.split('/').pop() || '');
		const title = cleanChapterTitle(rawTitle, num);

		let body = this.extractChapterBody(html);
		body = this.cleanChapterBody(body);

		if (!body.trim() || stripHtml(body).length < 80) {
			throw new Error('Chapter body is empty or truncated');
		}

		if (
			/members?\s+only|login\s+to\s+read|premium|subscribe\s+to\s+unlock/i.test(body) &&
			stripHtml(body).length < 200
		) {
			throw new Error('Chapter is locked / members-only on Second Life Translations');
		}

		const content = `<div class="slt-chapter">${decryptChapterHtml(body)}</div>`;

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		const seriesSlug = this.seriesSlugFromChapterPath(path);
		if (seriesSlug) {
			try {
				const chs = await this.loadSeriesChapters(seriesSlug);
				const idx = chs.findIndex(
					(c) =>
						normalizeChapterId(c.id) === path ||
						normalizeChapterId(c.id) === path.replace(/\/+$/, '')
				);
				if (idx >= 0) {
					prevChapterId = chs[idx + 1]?.id ?? null;
					nextChapterId = chs[idx - 1]?.id ?? null;
				}
			} catch {
			}
		}

		if (!prevChapterId || !nextChapterId) {
			const navRe =
				/<a[^>]+href=["']([^"']+)["'][^>]*rel=["'](prev|next)["'][^>]*>/gi;
			let nm: RegExpExecArray | null;
			while ((nm = navRe.exec(html)) !== null) {
				const id = normalizeChapterId(nm[1]);
				if (nm[2] === 'prev' && !prevChapterId) prevChapterId = id;
				if (nm[2] === 'next' && !nextChapterId) nextChapterId = id;
			}
			if (!prevChapterId) {
				const p = html.match(
					/<a[^>]+href=["']([^"']+)["'][^>]*>\s*(?:«|Previous|Prev)\s*</i
				);
				if (p) prevChapterId = normalizeChapterId(p[1]);
			}
			if (!nextChapterId) {
				const n = html.match(
					/<a[^>]+href=["']([^"']+)["'][^>]*>\s*(?:Next|»)\s*</i
				);
				if (n) nextChapterId = normalizeChapterId(n[1]);
			}
		}

		return {
			title,
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default SecondLifeTranslationsSource;
