/**
 * Story Seedling (storyseedling.com) — Laravel + Livewire novel site
 * Path: scraper/src/sources/impl/StorySeedling.ts
 *
 * Endpoints:
 *   POST /ajax  action=search&query=           → search series
 *   POST /ajax  action=series_toc&id=&post=    → chapter list (post hash global)
 *   GET  /series/{id}/                        → series page (cover, genres, desc)
 *   GET  /series/{id}/{slug}/                 → chapter page (nonce in HTML)
 *   POST /series/{id}/{slug}/content          → chapter body (X-Nonce required)
 *        Header: X-Nonce: <from loadChapter()>
 *        Body HTML: decoy spans (CSS absolute -9999) + Kangxi-radical cipher text
 *
 * Cipher: CJK radicals ⽂…⿕ mapped ke Latin (lihat decodeRadicalText).
 * TOC post hash & content nonce tampak global di site (fallback hardcoded).
 */
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types';

const PAGE_SIZE = 24;
const TOC_POST_HASH = 'e8c4f5fd2f';
const CONTENT_NONCE = 'b85b354119';

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
		.replace(/\s*(?:[–—|]|-)\s*Story Seedling\s*$/i, '')
		.trim();
}

function decodeRadicalChar(c: string): string {
	const o = c.charCodeAt(0);
	if (o >= 0x2f42 && o <= 0x2f5b) {
		return String.fromCharCode(o - 0x2f42 + 'A'.charCodeAt(0));
	}
	if (o >= 0x2f5c && o <= 0x2f5f) {
		return String.fromCharCode(o - 0x2f5c + 'a'.charCodeAt(0));
	}
	if (o >= 0x2f60 && o <= 0x2f79) {
		return String.fromCharCode(((o - 0x2f60 + 4) % 26) + 'a'.charCodeAt(0));
	}
	return c;
}

function decodeRadicalText(s: string): string {
	return Array.from(s, decodeRadicalChar).join('');
}

function cleanChapterHtml(raw: string): string {
	let html = raw || '';
	const hidden = new Set<string>();
	const styleRe = /\.(cls[a-f0-9]+)\s*\{\s*position:\s*absolute/gi;
	let m: RegExpExecArray | null;
	while ((m = styleRe.exec(html))) {
		hidden.add(m[1].toLowerCase());
	}
	html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

	for (const h of hidden) {
		const re = new RegExp(
			`<span\\s+class="[^"]*${h}[^"]*"[^>]*>[^<]*</span>`,
			'gi'
		);
		html = html.replace(re, '');
	}

	html = html.replace(
		/<span[^>]*>\s*cls[a-f0-9]+\s*<\/span>/gi,
		''
	);

	html = html.replace(/>([^<]+)</g, (_, text: string) => {
		const decoded = decodeRadicalText(decodeEntities(text));
		return `>${decoded}<`;
	});

	return html.trim();
}

function parseChapterNumber(title: string, slug = ''): number {
	const fromSlug = slug.match(/^(\d+)(?:\.(\d+))?$/);
	if (fromSlug) {
		if (fromSlug[2]) return parseFloat(`${fromSlug[1]}.${fromSlug[2]}`);
		return parseInt(fromSlug[1], 10);
	}
	const m = title.match(
		/(?:chapter|chap|ch\.?|episode|ep\.?)\s*(\d+)(?:[.,](\d+))?/i
	);
	if (m) {
		if (m[2]) return parseFloat(`${m[1]}.${m[2]}`);
		return parseInt(m[1], 10);
	}
	if (/prologue/i.test(title)) return 0;
	const n = title.match(/\b(\d+(?:\.\d+)?)\b/);
	return n ? parseFloat(n[1]) : 0;
}

function seriesIdFromUrl(url: string): string | null {
	const m = url.match(/\/series\/(\d+)/);
	return m ? m[1] : null;
}

type SsSearchItem = {
	id: number;
	title?: string;
	url?: string;
	thumb?: string;
};

type SsTocItem = {
	title?: string;
	url?: string;
	slug?: string;
	is_locked?: boolean;
	price?: string | number;
	bought?: boolean;
	date?: string;
};

export class StorySeedlingSource extends BaseSource {
	id = 'storyseedling';
	name = 'Story Seedling';
	baseUrl = 'https://storyseedling.com';

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'application/json, text/html, */*',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: 'https://storyseedling.com/',
		Origin: 'https://storyseedling.com'
	};

	private async postAjax<T = unknown>(
		action: string,
		fields: Record<string, string>
	): Promise<T> {
		const body = new URLSearchParams({ action, ...fields });
		const res = await fetch(`${this.baseUrl}/ajax`, {
			method: 'POST',
			headers: {
				...this.headers,
				'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
				'X-Requested-With': 'XMLHttpRequest',
				Accept: 'application/json, text/javascript, */*'
			},
			body: body.toString()
		});
		if (!res.ok) {
			throw new Error(`ajax ${action} failed: ${res.status}`);
		}
		return (await res.json()) as T;
	}

	private mapSearchItem(n: SsSearchItem): Manga | null {
		const sid = String(n.id || seriesIdFromUrl(n.url || '') || '');
		if (!sid) return null;
		return {
			id: `/series/${sid}`,
			title: cleanTitle(n.title || sid),
			cover: n.thumb || '',
			sourceId: this.id,
			type: 'novel',
			lang: 'en',
			status: 'Ongoing'
		};
	}

	async getLatestManga(page = 1): Promise<Manga[]> {
		const pageNum = Math.max(1, page);
		const seen = new Set<string>();
		const out: Manga[] = [];

		try {
			const html = await this.fetchHtml('/');
			const ids = [
				...html.matchAll(/href="(?:https?:\/\/storyseedling\.com)?\/series\/(\d+)\/?"/g)
			].map((m) => m[1]);
			for (const id of ids) {
				const key = `/series/${id}`;
				if (seen.has(key)) continue;
				seen.add(key);
				out.push({
					id: key,
					title: id,
					cover: '',
					sourceId: this.id,
					type: 'novel',
					lang: 'en',
					status: 'Ongoing'
				});
			}
		} catch (e) {
			console.error('[StorySeedling] homepage parse failed', e);
		}

		if (out.length < pageNum * PAGE_SIZE) {
			const seeds = ['a', 'the', 'of', 'in', 'my', 're'];
			for (const q of seeds) {
				try {
					const res = await this.postAjax<{
						success?: boolean;
						data?: SsSearchItem[];
					}>('search', { query: q });
					if (!res?.success || !Array.isArray(res.data)) continue;
					for (const n of res.data) {
						const m = this.mapSearchItem(n);
						if (!m || seen.has(m.id)) continue;
						seen.add(m.id);
						out.push(m);
					}
				} catch {
					/* ignore */
				}
			}
		}

		const needMeta = out.filter((m) => !m.cover || m.title === m.id.replace('/series/', ''));
		if (needMeta.length) {
			await Promise.all(
				needMeta.slice(0, 30).map(async (item) => {
					try {
						const sid = seriesIdFromUrl(item.id);
						if (!sid) return;
						const html = await this.fetchHtml(`/series/${sid}/`);
						const t = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
						if (t) item.title = cleanTitle(t[1]);
						const cov = html.match(
							/(https:\/\/i2\.wp\.com\/storyseedling\.com\/public\/images\/[^"&\s]+)/i
						);
						if (cov) item.cover = cov[1].replace(/&amp;/g, '&');
					} catch {
						/* ignore */
					}
				})
			);
		}

		const start = (pageNum - 1) * PAGE_SIZE;
		return out.slice(start, start + PAGE_SIZE);
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = query.trim();
		if (!q) return [];

		const res = await this.postAjax<{ success?: boolean; data?: SsSearchItem[] }>(
			'search',
			{ query: q }
		);
		if (!res?.success || !Array.isArray(res.data)) return [];

		const mapped = res.data
			.map((n) => this.mapSearchItem(n))
			.filter((m): m is Manga => !!m);

		const start = (Math.max(1, page) - 1) * PAGE_SIZE;
		return mapped.slice(start, start + PAGE_SIZE);
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const sid = seriesIdFromUrl(mangaId) || mangaId.replace(/\D/g, '');
		if (!sid) throw new Error(`Invalid manga id: ${mangaId}`);

		const html = await this.fetchHtml(`/series/${sid}/`);
		const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
		const title = cleanTitle(titleMatch?.[1] || `Series ${sid}`);

		const coverMatch = html.match(
			/(https:\/\/i2\.wp\.com\/storyseedling\.com\/public\/images\/[^"&\s]+)/i
		);
		const cover = (coverMatch?.[1] || '').replace(/&amp;/g, '&');

		const genres = [
			...html.matchAll(
				/href="[^"]*includeGenres[^"]*"[^>]*>\s*([^<]+?)\s*</gi
			)
		]
			.map((m) => cleanTitle(m[1]))
			.filter(Boolean);

		let description = '';
		const prose = html.match(
			/class="[^"]*prose[^"]*"[^>]*>([\s\S]*?)<\/div>/i
		);
		if (prose) {
			description = stripHtml(prose[1]).slice(0, 2000);
		}
		if (!description) {
			const og = html.match(
				/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i
			);
			if (og) description = decodeEntities(og[1]);
		}

		let status = 'Ongoing';
		if (/Completed/i.test(html)) status = 'Completed';
		else if (/Hiatus/i.test(html)) status = 'Hiatus';

		const authorMatch = html.match(
			/Written by\s*<[^>]+>([^<]+)/i
		) || html.match(/Author[^<]*<[^>]+>([^<]+)/i);
		const authors = authorMatch ? [cleanTitle(authorMatch[1])] : [];

		const tocHash =
			html.match(/toc\(\s*['"]\d+['"]\s*,\s*['"]([a-f0-9]+)['"]\s*\)/i)?.[1] ||
			TOC_POST_HASH;

		const chapters = await this.fetchChapters(sid, tocHash);

		return {
			id: `/series/${sid}`,
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
			...(chapters.length ? { latestChapter: chapters[0]?.number } : {})
		};
	}

	private async fetchChapters(
		seriesId: string,
		postHash: string
	): Promise<Chapter[]> {
		const res = await this.postAjax<{
			success?: boolean;
			data?: SsTocItem[];
		}>('series_toc', { id: seriesId, post: postHash });

		if (!res?.success || !Array.isArray(res.data)) {
			return [];
		}

		const out: Chapter[] = [];
		const seen = new Set<string>();

		for (const c of res.data) {
			const slug = (c.slug || '').toString();
			if (!slug) continue;
			const id = `/series/${seriesId}/${slug}`;
			if (seen.has(id)) continue;
			seen.add(id);

			const title = cleanTitle(c.title || `Chapter ${slug}`);
			const locked =
				!!c.is_locked ||
				(typeof c.price === 'number' && c.price > 0) ||
				(typeof c.price === 'string' && parseFloat(c.price) > 0 && !c.bought);

			out.push({
				id,
				title,
				number: parseChapterNumber(title, slug),
				date: c.date || undefined,
				isLocked: locked
			});
		}

		// newest first
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
		const m = chapterId.match(/\/series\/(\d+)\/([^/]+)/);
		if (!m) throw new Error(`Invalid chapter id: ${chapterId}`);
		const [, seriesId, slug] = m;
		const path = `/series/${seriesId}/${slug}`;
		const pageHtml = await this.fetchHtml(`${path}/`);
		const nonce =
			pageHtml.match(
				/loadChapter\s*\(\s*['"][^'"]+['"]\s*,\s*['"]([a-f0-9]+)['"]\s*\)/i
			)?.[1] || CONTENT_NONCE;

		const titleMatch = pageHtml.match(/<h1[^>]*>([^<]+)<\/h1>/i);
		const title = cleanTitle(titleMatch?.[1] || `Chapter ${slug}`);

		if (
			/is_locked|chapter is locked|purchase this chapter/i.test(pageHtml) &&
			!/loadChapter/i.test(pageHtml)
		) {
			throw new Error('Chapter is locked / premium on Story Seedling');
		}

		const contentUrl = `${this.baseUrl}${path}/content`;
		const res = await fetch(contentUrl, {
			method: 'POST',
			headers: {
				...this.headers,
				'Content-Type': 'application/json',
				'X-Nonce': nonce,
				Referer: `${this.baseUrl}${path}/`,
				Accept: 'text/html, application/json, */*'
			},
			body: JSON.stringify({})
		});

		if (!res.ok) {
			const errText = await res.text().catch(() => '');
			if (/locked|premium|purchase|security/i.test(errText)) {
				throw new Error('Chapter is locked / premium on Story Seedling');
			}
			throw new Error(`Failed to load chapter content: ${res.status}`);
		}

		const raw = await res.text();
		if (!raw.trim() || raw.trim().startsWith('{')) {
			try {
				const j = JSON.parse(raw);
				if (j.captcha || j.success === false) {
					throw new Error(
						j.message || 'Chapter requires captcha / is unavailable'
					);
				}
			} catch (e) {
				if (e instanceof Error && e.message.includes('captcha')) throw e;
			}
			throw new Error('Chapter body is empty');
		}

		const cleaned = cleanChapterHtml(raw);
		if (!stripHtml(cleaned).trim()) {
			throw new Error('Chapter body is empty after decode');
		}

		const content = `<div class="ss-chapter">${cleaned}</div>`;

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		try {
			const tocHash =
				pageHtml.match(/toc\(\s*['"]\d+['"]\s*,\s*['"]([a-f0-9]+)['"]\s*\)/i)?.[1] ||
				TOC_POST_HASH;
			const chs = await this.fetchChapters(seriesId, tocHash);
			const idx = chs.findIndex(
				(c) => c.id === path || c.id.endsWith(`/${slug}`)
			);
			if (idx >= 0) {
				prevChapterId = chs[idx + 1]?.id ?? null;
				nextChapterId = chs[idx - 1]?.id ?? null;
			}
		} catch {
		}

		return { title, content, prevChapterId, nextChapterId };
	}
}

export default StorySeedlingSource;
