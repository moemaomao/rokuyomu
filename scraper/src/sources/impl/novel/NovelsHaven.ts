/**
 * Novels Haven (novelshaven.com) — Next.js novel site
 * Path: scraper/src/sources/impl/NovelsHaven.ts
 *
 * Stack: Next.js (App Router) + Cloudflare
 *
 * Model:
 *   - Series list: /series?sort=newest&page=
 *   - Series page: /series/{slug}
 *   - Chapter:     /series/{slug}/chapter-{n}
 *   - Body:        div#paragraph-N (SSR HTML)
 *   - Chapter meta (title, is_premium, chapter_num) embedded in RSC payload
 *
 * ID format:
 *   Novel:   /series/{slug}
 *   Chapter: /series/{slug}/chapter-{n}
 */
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const PAGE_SIZE = 24;

const SKIP_BADGE = new Set([
	'ongoing',
	'completed',
	'hiatus',
	'dropped',
	'new',
	'today',
	'trending',
	'bookmarks',
	'views'
]);

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
		.replace(/&#8230;/g, '…')
		.replace(/&nbsp;/g, ' ');
}

function stripHtml(html: string): string {
	return decodeEntities(
		html
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/p>/gi, '\n\n')
			.replace(/<\/div>/gi, '\n')
			.replace(/<[^>]+>/g, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
}

function cleanTitle(raw: string): string {
	return decodeEntities(raw || '')
		.replace(/\s+/g, ' ')
		.replace(/\s*(?:[–—|]|-)\s*Novels?\s*Haven\s*$/i, '')
		.replace(/^Chapter\s+\d+\s*[|·\-–—:]\s*/i, '')
		.trim();
}

function parseChapterNumber(title: string, slug = ''): number {
	const fromSlug = slug.match(/chapter-(\d+)(?:-(\d+))?/i);
	if (fromSlug) {
		if (fromSlug[2]) return parseFloat(`${fromSlug[1]}.${fromSlug[2]}`);
		return parseInt(fromSlug[1], 10);
	}
	const m = title.match(
		/(?:chapter|chap|ch\.?|episode|ep\.?)\s*[:.]?\s*(\d+)(?:[.,](\d+))?/i
	);
	if (m) {
		if (m[2]) return parseFloat(`${m[1]}.${m[2]}`);
		return parseInt(m[1], 10);
	}
	if (/prologue/i.test(title) || /prologue/i.test(slug)) return 0;
	const n = title.match(/\b(\d+(?:\.\d+)?)\b/);
	return n ? parseFloat(n[1]) : 0;
}

function slugFromMangaId(mangaId: string): string {
	const raw = mangaId.replace(/^\/+/, '').replace(/\/+$/, '');
	const parts = raw.split('/').filter(Boolean);
	if (parts[0] === 'series' && parts[1]) return parts[1];
	return parts[0] || raw;
}

function normalizeStatus(html: string): string {
	if (/Status[^<]{0,40}Completed/i.test(html) || /\bCompleted\b/i.test(html)) {
		if (/Status[^<]{0,40}Ongoing/i.test(html)) return 'Ongoing';
		return 'Completed';
	}
	if (/\bDropped\b/i.test(html)) return 'Dropped';
	if (/\bHiatus\b/i.test(html)) return 'Hiatus';
	return 'Ongoing';
}

/** Unescape RSC double-escaped JSON fragments once. */
function unescapeRsc(html: string): string {
	if (!html.includes('\\"')) return html;
	return html.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

export class NovelsHavenSource extends BaseSource {
	id = 'novelshaven';
	name = 'Novels Haven';
	baseUrl = 'https://novelshaven.com';

	protected headers: Record<string, string> = {
	'User-Agent':
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
	Accept:
		'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
	'Accept-Language': 'en-US,en;q=0.9',
	'Accept-Encoding': 'gzip, deflate, br',
	'Cache-Control': 'no-cache',
	Pragma: 'no-cache',
	'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
	'Sec-Ch-Ua-Mobile': '?0',
	'Sec-Ch-Ua-Platform': '"Windows"',
	'Sec-Fetch-Dest': 'document',
	'Sec-Fetch-Mode': 'navigate',
	'Sec-Fetch-Site': 'none',
	'Sec-Fetch-User': '?1',
	'Upgrade-Insecure-Requests': '1',
	Referer: 'https://novelshaven.com/'
};


	private async fetchPage(path: string): Promise<string> {
		return this.fetchHtml(path.startsWith('http') ? path : path);
	}

	/** Parse series cards from list / home HTML */
	private parseSeriesCards(html: string): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		const linkRe = /href="\/series\/([^"/?#]+)"/gi;
		let m: RegExpExecArray | null;
		const positions: Array<{ slug: string; index: number }> = [];

		while ((m = linkRe.exec(html))) {
			const slug = m[1];
			if (
				!slug ||
				slug === 'ranking' ||
				/^ranking/i.test(slug) ||
				/chapter-/i.test(slug)
			) {
				continue;
			}
			if (seen.has(slug)) continue;
			seen.add(slug);
			positions.push({ slug, index: m.index });
		}

		for (const { slug, index } of positions) {
			const around = html.slice(
				Math.max(0, index - 800),
				Math.min(html.length, index + 2500)
			);

			let title = '';
			const titleMatch =
				around.match(
					new RegExp(
						`href="/series/${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>\\s*([\\s\\S]*?)</`,
						'i'
					)
				) || around.match(/alt="([^"]{3,120})"/i);
			if (titleMatch) {
				title = cleanTitle(stripHtml(titleMatch[1]));
			}
			if (!title || /^(read|view all|series)$/i.test(title)) {
				title = slug
					.replace(/-/g, ' ')
					.replace(/\b\w/g, (c) => c.toUpperCase());
			}

			let cover = '';
			const img =
				around.match(
					/(https:\/\/cdn\.novelshaven\.com\/series-covers\/[^"'?\s]+)/i
				) ||
				around.match(
					/<img[^>]+(?:src|data-src)="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i
				);
			if (img) cover = img[1].replace(/&amp;/g, '&');

			// Chapters:</span>75
			let latest: number | undefined;
			const chCount =
				around.match(/Chapters:<\/span>\s*(\d+)/i) ||
				around.match(/Chapters:\s*<\/[^>]+>\s*(\d+)/i) ||
				around.match(/(?:Ch\.?|Chapter)\s*(\d+)/i);
			if (chCount) latest = parseInt(chCount[1], 10);

			out.push({
				id: `/series/${slug}`,
				title,
				cover,
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: 'Ongoing',
				...(latest != null ? { latestChapter: latest } : {})
			});
		}

		return out;
	}

	/**
	 * Prefer RSC payload:
	 *   "title":"...","is_premium":true|false,"chapter_num":N
	 * Fallback: href="/series/{slug}/chapter-N"
	 */
	private parseChapterList(html: string, seriesSlug: string): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		const raw = unescapeRsc(html);
		const objRe =
			/"title":"([^"]*)","is_premium":(true|false),"chapter_num":(\d+)/g;
		let m: RegExpExecArray | null;
		while ((m = objRe.exec(raw))) {
			const chapTitle = cleanTitle(m[1]);
			const isPremium = m[2] === 'true';
			const num = parseInt(m[3], 10);
			const id = `/series/${seriesSlug}/chapter-${num}`;
			if (seen.has(id)) continue;
			seen.add(id);
			out.push({
				id,
				title: chapTitle ? `Chapter ${num}: ${chapTitle}` : `Chapter ${num}`,
				number: num,
				isLocked: isPremium
			});
		}

		if (!out.length) {
			const re = new RegExp(
				`href="(/series/${seriesSlug.replace(
					/[.*+?^${}()|[\]\\]/g,
					'\\$&'
				)}/(chapter-[^"/?#]+))"`,
				'gi'
			);
			while ((m = re.exec(html))) {
				const path = m[1];
				const chapSlug = path.split('/').pop() || '';
				const id = path.startsWith('/') ? path : `/${path}`;
				if (seen.has(id)) continue;
				seen.add(id);
				const num = parseChapterNumber(chapSlug, chapSlug);
				out.push({
					id,
					title: `Chapter ${num || chapSlug.replace(/-/g, ' ')}`,
					number: num,
					isLocked: false
				});
			}
		}

		out.sort((a, b) => {
			if (b.number !== a.number) return b.number - a.number;
			return a.id.localeCompare(b.id);
		});
		return out;
	}

	private parseGenres(html: string): string[] {
		const genres: string[] = [];
		const seen = new Set<string>();
		for (const g of html.matchAll(
			/data-slot="badge"[^>]*>([\s\S]*?)<\/span>/gi
		)) {
			const name = cleanTitle(stripHtml(g[1]));
			if (!name || name.startsWith('#')) continue;
			if (/^ch\.?\s*\d+/i.test(name)) continue;
			if (/\d+\s*(views?|bookmarks?|ch\s*\/\s*day)/i.test(name)) continue;
			if (SKIP_BADGE.has(name.toLowerCase())) continue;
			if (/^\d/.test(name) || name.length > 40) continue;
			const key = name.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			genres.push(name);
		}
		return genres;
	}

	private extractChapterBody(html: string): string {
		const byIdx: Array<{ i: number; html: string }> = [];
		const re =
			/<div[^>]+id="paragraph-(\d+)"[^>]*>([\s\S]*?)<\/div>/gi;
		let m: RegExpExecArray | null;
		while ((m = re.exec(html))) {
			byIdx.push({ i: parseInt(m[1], 10), html: m[2] });
		}
		byIdx.sort((a, b) => a.i - b.i);

		const paras: string[] = [];
		for (const p of byIdx) {
			const text = stripHtml(p.html).replace(/\s+/g, ' ').trim();
			if (!text) continue;
			if (/^(home|series|login|discord|next|previous)$/i.test(text)) continue;
			const inner = decodeEntities(p.html.replace(/<[^>]+>/g, '')).trim();
			if (!inner) continue;
			paras.push(`<p>${inner}</p>`);
		}
		if (paras.length) return paras.join('\n');

		const prose = html.match(
			/class="[^"]*prose[^"]*"[^>]*>([\s\S]*?)<\/div>/i
		);
		if (prose?.[1]) {
			const cleaned = prose[1]
				.replace(/<script[\s\S]*?<\/script>/gi, '')
				.replace(/<style[\s\S]*?<\/style>/gi, '');
			if (stripHtml(cleaned).length > 100) return cleaned;
		}
		return '';
	}

	async getLatestManga(page = 1): Promise<Manga[]> {
		const pageNum = Math.max(1, page);
		try {
			const path =
				pageNum <= 1
					? `/series?sort=newest`
					: `/series?sort=newest&page=${pageNum}`;
			const html = await this.fetchPage(path);
			return this.parseSeriesCards(html).slice(0, PAGE_SIZE);
		} catch (e) {
			console.error('[NovelsHaven] getLatestManga failed', e);
			return [];
		}
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = query.trim().toLowerCase();
		if (!q) return [];
		const page = Math.max(1, opts?.page ?? 1);

		try {
			const html = await this.fetchPage(`/series?sort=newest&page=${page}`);
			const cards = this.parseSeriesCards(html);
			const filtered = cards.filter((m) => {
				const title = (m.title || '').toLowerCase();
				const slug = m.id.toLowerCase();
				return title.includes(q) || slug.includes(q.replace(/\s+/g, '-'));
			});
			if (filtered.length) return filtered.slice(0, PAGE_SIZE);

			const html2 = await this.fetchPage(
				`/series?search=${encodeURIComponent(query)}`
			);
			return this.parseSeriesCards(html2)
				.filter((m) => {
					const title = (m.title || '').toLowerCase();
					const slug = m.id.toLowerCase();
					return title.includes(q) || slug.includes(q.replace(/\s+/g, '-'));
				})
				.slice(0, PAGE_SIZE);
		} catch (e) {
			console.error('[NovelsHaven] searchManga failed', e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = slugFromMangaId(mangaId);
		if (!slug) throw new Error(`Invalid manga id: ${mangaId}`);

		const html = await this.fetchPage(`/series/${slug}`);

		const ogTitle =
			html.match(/property="og:title"[^>]+content="([^"]+)"/i)?.[1] ||
			html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
		const title = cleanTitle(
			ogTitle ? stripHtml(ogTitle) : slug.replace(/-/g, ' ')
		);

		const cover = (
			html.match(/property="og:image"[^>]+content="([^"]+)"/i)?.[1] ||
			html.match(
				/(https:\/\/cdn\.novelshaven\.com\/series-covers\/[^"'?\s]+)/i
			)?.[1] ||
			''
		).replace(/&amp;/g, '&');

		const description = decodeEntities(
			html.match(/property="og:description"[^>]+content="([^"]+)"/i)?.[1] ||
				''
		);

		const genres = this.parseGenres(html);
		const chapters = this.parseChapterList(html, slug);

		return {
			id: `/series/${slug}`,
			title,
			cover,
			sourceId: this.id,
			description,
			authors: [],
			status: normalizeStatus(html),
			genres,
			chapters,
			type: 'novel',
			lang: 'en',
			...(chapters.length ? { latestChapter: chapters[0]?.number } : {})
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
		const match = chapterId.match(
			/\/series\/([^/]+)\/(chapter-[\d.-]+)/i
		);
		if (!match) throw new Error(`Invalid chapter id: ${chapterId}`);
		const [, seriesSlug, chapSlug] = match;
		const path = `/series/${seriesSlug}/${chapSlug}`;

		const html = await this.fetchPage(path);
		const raw = unescapeRsc(html);
		const num = parseChapterNumber(chapSlug, chapSlug);

		// Premium without body
		const hasBody = /id="paragraph-0"/i.test(html);
		const premiumHint =
			/"is_premium":true/.test(raw) ||
			/premium|unlock with|coins?\s+to\s+unlock|login\s+to\s+read/i.test(
				html
			);
		if (premiumHint && !hasBody) {
			throw new Error('Chapter is locked / premium on Novels Haven');
		}

		const ogTitle =
			html.match(/property="og:title"[^>]+content="([^"]+)"/i)?.[1] ||
			html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
		const title = cleanTitle(
			ogTitle ? stripHtml(ogTitle) : chapSlug.replace(/-/g, ' ')
		);

		const body = this.extractChapterBody(html);
		const plain = stripHtml(body).replace(/\s+/g, ' ').trim();
		if (plain.length < 80) {
			throw new Error(
				premiumHint
					? 'Chapter is locked / premium on Novels Haven'
					: 'Chapter body empty or blocked'
			);
		}

		let prevChapterId: string | null =
			num > 1 ? `/series/${seriesSlug}/chapter-${num - 1}` : null;
		let nextChapterId: string | null = `/series/${seriesSlug}/chapter-${num + 1}`;

		const nextLink = html.match(
			new RegExp(
				`href="(/series/${seriesSlug}/chapter-\\d+)"[^>]*>\\s*Next`,
				'i'
			)
		);
		if (nextLink) nextChapterId = nextLink[1];

		const prevLink = html.match(
			new RegExp(
				`href="(/series/${seriesSlug}/chapter-\\d+)"[^>]*>\\s*Prev`,
				'i'
			)
		);
		if (prevLink) prevChapterId = prevLink[1];

		return {
			title,
			content: `<div class="nh-chapter">${body}</div>`,
			prevChapterId,
			nextChapterId
		};
	}
}

export default NovelsHavenSource;