/**
 * Azure Chronicles (azurechronicles.com)
 * Path: scraper/src/sources/impl/AzureChronicles.ts
 *
 * Stack: WordPress + Imunify360 bot-protection
 *
 * Model mirip Kari Studio:
 *   - Novel page: /novel/{slug}/
 *   - Chapter:    /novel/{slug}/chapter-{n}/
 *   - WP REST:    /wp-json/wp/v2/posts, categories, tags, search
 *
 * Catatan:
 *   IP datacenter sering kena Imunify360 403 di /wp-json/ dan interstitial HTML.
 *   Source mencoba API dulu (seperti KariStudio), fallback HTML scrape.
 */
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types';

const PAGE_SIZE = 24;
const WP = '/wp-json/wp/v2';

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
		.replace(/^Read\s+/i, '')
		.replace(/\s*(?:[–—|]|-)\s*Azure Chronicles\s*$/i, '')
		.replace(/\s*—\s*Chapter\s+\d+.*$/i, '')
		.trim();
}

function isChallengePage(html: string): boolean {
	return (
		/One moment, please/i.test(html) ||
		/request is being verified/i.test(html) ||
		/Access denied by Imunify360/i.test(html) ||
		(/please wait/i.test(html) && /verified/i.test(html) && html.length < 30000)
	);
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

function slugFromPath(path: string): string | null {
	const m = path.match(/\/novel\/([^/]+)/i);
	return m ? m[1] : null;
}

type WpRendered = { rendered?: string };
type WpPost = {
	id: number;
	date?: string;
	slug: string;
	link?: string;
	title?: WpRendered;
	content?: WpRendered;
	excerpt?: WpRendered;
	categories?: number[];
	tags?: number[];
	featured_media?: number;
	_embedded?: {
		'wp:featuredmedia'?: Array<{ source_url?: string }>;
		'wp:term'?: Array<
			Array<{ id: number; name: string; slug: string; taxonomy: string }>
		>;
	};
};
type WpCategory = {
	id: number;
	count: number;
	name: string;
	slug: string;
	description?: string;
};

export class AzureChroniclesSource extends BaseSource {
	id = 'azurechronicles';
	name = 'Azure Chronicles';
	baseUrl = 'https://azurechronicles.com';

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'application/json, text/html, */*',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: 'https://azurechronicles.com/',
		Origin: 'https://azurechronicles.com'
	};

	private apiOk: boolean | null = null;

	private async fetchWp<T>(path: string): Promise<T> {
		return this.fetchJson<T>(path.startsWith('http') ? path : path);
	}

	/** Cek apakah /wp-json/ bisa diakses dari IP ini */
	private async canUseApi(): Promise<boolean> {
		if (this.apiOk != null) return this.apiOk;
		try {
			const data = await this.fetchWp<unknown>(`${WP}/posts?per_page=1`);
			this.apiOk = data != null;
		} catch {
			this.apiOk = false;
		}
		return this.apiOk;
	}

	private async fetchPage(path: string, retries = 3): Promise<string> {
		let last = '';
		for (let i = 0; i < retries; i++) {
			if (i > 0) await new Promise((r) => setTimeout(r, 1500 * i));
			try {
				last = await this.fetchHtml(path);
			} catch (e) {
				if (i === retries - 1) throw e;
				continue;
			}
			if (!isChallengePage(last) && last.length > 4000) return last;
		}
		if (isChallengePage(last)) {
			throw new Error(
				'Azure Chronicles blocked (Imunify360 / challenge) — retry later'
			);
		}
		return last;
	}

	/* ─── API path (KariStudio-style) ─── */

	private mapPostToManga(p: WpPost): Manga | null {
		const link = p.link || '';
		const slug =
			slugFromPath(link) ||
			(p.slug?.startsWith('chapter-') ? null : p.slug);
		if (!slug || /^chapter-/i.test(slug)) return null;
		const media = p._embedded?.['wp:featuredmedia']?.[0];
		const cover = media?.source_url || '';
		return {
			id: `/novel/${slug}`,
			title: cleanTitle(p.title?.rendered || slug),
			cover,
			sourceId: this.id,
			type: 'novel',
			lang: 'en',
			status: 'Ongoing'
		};
	}

	private async apiLatest(page: number): Promise<Manga[]> {
		const posts = await this.fetchWp<WpPost[]>(
			`${WP}/posts?per_page=${PAGE_SIZE}&page=${page}&orderby=modified&order=desc&_embed=1`
		);
		if (!Array.isArray(posts)) return [];
		const out: Manga[] = [];
		const seen = new Set<string>();
		for (const p of posts) {
			const m = this.mapPostToManga(p);
			if (!m || seen.has(m.id)) continue;
			// Skip pure chapter posts
			if (/\/chapter-\d+/i.test(p.link || '')) continue;
			seen.add(m.id);
			out.push(m);
		}
		return out;
	}

	private async apiSearch(query: string, page: number): Promise<Manga[]> {
		const posts = await this.fetchWp<WpPost[]>(
			`${WP}/search?search=${encodeURIComponent(query)}&per_page=${PAGE_SIZE}&page=${page}&type=post&_embed=1`
		);
		// fallback: posts?search=
		let list = Array.isArray(posts) ? posts : [];
		if (!list.length) {
			const alt = await this.fetchWp<WpPost[]>(
				`${WP}/posts?search=${encodeURIComponent(query)}&per_page=${PAGE_SIZE}&page=${page}&_embed=1`
			);
			list = Array.isArray(alt) ? alt : [];
		}
		const out: Manga[] = [];
		const seen = new Set<string>();
		for (const p of list) {
			const m = this.mapPostToManga(p);
			if (!m || seen.has(m.id)) continue;
			if (/\/chapter-\d+/i.test(p.link || '')) continue;
			seen.add(m.id);
			out.push(m);
		}
		return out;
	}

	private async apiDetails(slug: string): Promise<MangaDetails | null> {
		// Coba post dengan slug novel
		let posts = await this.fetchWp<WpPost[]>(
			`${WP}/posts?slug=${encodeURIComponent(slug)}&_embed=1&per_page=5`
		);
		if (!Array.isArray(posts) || !posts.length) {
			// Kadang novel adalah custom post type — coba categories
			const cats = await this.fetchWp<WpCategory[]>(
				`${WP}/categories?slug=${encodeURIComponent(slug)}`
			);
			if (!Array.isArray(cats) || !cats[0]) return null;
			const cat = cats[0];
			const chapters = await this.apiChaptersByCategory(cat.id, slug);
			return {
				id: `/novel/${slug}`,
				title: cleanTitle(cat.name),
				cover: '',
				sourceId: this.id,
				description: stripHtml(cat.description || ''),
				authors: [],
				status: 'Ongoing',
				genres: [],
				chapters,
				type: 'novel',
				lang: 'en',
				...(chapters.length ? { latestChapter: chapters[0]?.number } : {})
			};
		}

		// Pilih post yang link-nya /novel/{slug}/ (bukan chapter)
		const index =
			posts.find((p) => {
				const path = (p.link || '').replace(/\/$/, '');
				return path.endsWith(`/novel/${slug}`) || p.slug === slug;
			}) || posts[0];

		const media = index._embedded?.['wp:featuredmedia']?.[0];
		const cover = media?.source_url || '';
		const title = cleanTitle(index.title?.rendered || slug);
		const description = stripHtml(
			index.content?.rendered || index.excerpt?.rendered || ''
		);

		const genres: string[] = [];
		const seenG = new Set<string>();
		for (const group of index._embedded?.['wp:term'] || []) {
			if (!Array.isArray(group)) continue;
			for (const t of group) {
				if (!t?.name) continue;
				if (t.taxonomy !== 'post_tag' && t.taxonomy !== 'category') continue;
				if (t.slug === slug) continue;
				const name = cleanTitle(t.name);
				const key = name.toLowerCase();
				if (seenG.has(key)) continue;
				seenG.add(key);
				genres.push(name);
			}
		}

		// Chapters: posts in same category, or search by parent path
		let chapters: Chapter[] = [];
		const catIds = (index.categories || []).filter(Boolean);
		if (catIds.length) {
			chapters = await this.apiChaptersByCategory(catIds[0], slug);
		}
		if (!chapters.length) {
			chapters = await this.apiChaptersBySearch(slug);
		}

		return {
			id: `/novel/${slug}`,
			title,
			cover,
			sourceId: this.id,
			description,
			authors: [],
			status: 'Ongoing',
			genres,
			chapters,
			type: 'novel',
			lang: 'en',
			...(chapters.length ? { latestChapter: chapters[0]?.number } : {})
		};
	}

	private async apiChaptersByCategory(
		catId: number,
		seriesSlug: string
	): Promise<Chapter[]> {
		const out: Chapter[] = [];
		const seen = new Set<string>();
		for (let page = 1; page <= 20; page++) {
			const posts = await this.fetchWp<WpPost[]>(
				`${WP}/posts?categories=${catId}&per_page=100&page=${page}&orderby=date&order=asc&_fields=id,slug,title,date,link`
			);
			if (!Array.isArray(posts) || !posts.length) break;
			for (const p of posts) {
				const link = p.link || '';
				if (!/\/chapter-\d+/i.test(link) && !/^chapter-/i.test(p.slug)) {
					if (p.slug === seriesSlug) continue;
					if (!/\d/.test(p.slug + (p.title?.rendered || ''))) continue;
				}
				const chapSlug =
					(link.match(/\/(chapter-[^/]+)\/?$/i) || [])[1] || p.slug;
				const id = `/novel/${seriesSlug}/${chapSlug}`;
				if (seen.has(id)) continue;
				seen.add(id);
				const title = cleanTitle(p.title?.rendered || chapSlug);
				out.push({
					id,
					title,
					number: parseChapterNumber(title, chapSlug),
					date: p.date
				});
			}
			if (posts.length < 100) break;
		}
		out.sort((a, b) => b.number - a.number);
		return out;
	}

	private async apiChaptersBySearch(seriesSlug: string): Promise<Chapter[]> {
		const out: Chapter[] = [];
		const seen = new Set<string>();
		// Search posts whose link contains /novel/{slug}/chapter-
		for (let page = 1; page <= 10; page++) {
			const posts = await this.fetchWp<WpPost[]>(
				`${WP}/posts?search=${encodeURIComponent(seriesSlug)}&per_page=100&page=${page}&_fields=id,slug,title,date,link`
			);
			if (!Array.isArray(posts) || !posts.length) break;
			for (const p of posts) {
				const link = p.link || '';
				if (!link.includes(`/novel/${seriesSlug}/`)) continue;
				const cm = link.match(/\/(chapter-[^/]+)\/?$/i);
				if (!cm) continue;
				const chapSlug = cm[1];
				const id = `/novel/${seriesSlug}/${chapSlug}`;
				if (seen.has(id)) continue;
				seen.add(id);
				const title = cleanTitle(p.title?.rendered || chapSlug);
				out.push({
					id,
					title,
					number: parseChapterNumber(title, chapSlug),
					date: p.date
				});
			}
			if (posts.length < 100) break;
		}
		out.sort((a, b) => b.number - a.number);
		return out;
	}

	private async apiChapterContent(
		seriesSlug: string,
		chapSlug: string
	): Promise<{ title: string; content: string } | null> {
		// Prefer slug chapter-N
		let posts = await this.fetchWp<WpPost[]>(
			`${WP}/posts?slug=${encodeURIComponent(chapSlug)}&per_page=5`
		);
		if (!Array.isArray(posts)) posts = [];
		let p =
			posts.find((x) => (x.link || '').includes(`/novel/${seriesSlug}/`)) ||
			posts[0];
		if (!p?.content?.rendered) {
			// search by path
			const alt = await this.fetchWp<WpPost[]>(
				`${WP}/posts?search=${encodeURIComponent(chapSlug)}&per_page=20`
			);
			if (Array.isArray(alt)) {
				p =
					alt.find((x) =>
						(x.link || '').includes(`/novel/${seriesSlug}/${chapSlug}`)
					) || alt[0];
			}
		}
		if (!p?.content?.rendered) return null;
		const raw = p.content.rendered;
		const text = stripHtml(raw);
		if (text.length < 80) return null;
		return {
			title: cleanTitle(p.title?.rendered || chapSlug),
			content: `<div class="ac-chapter">${raw}</div>`
		};
	}

	/* ─── HTML fallback ─── */

	private parseNovelCards(html: string): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();
		const re =
			/href="((?:https?:\/\/azurechronicles\.com)?\/novel\/([^/"?#]+))\/?"/gi;
		let m: RegExpExecArray | null;
		while ((m = re.exec(html))) {
			const slug = m[2];
			if (!slug || /^(page|tag|genre)/i.test(slug)) continue;
			if (/\/chapter-/i.test(m[1])) continue;
			const id = `/novel/${slug}`;
			if (seen.has(id)) continue;
			seen.add(id);
			const around = html.slice(
				Math.max(0, m.index - 500),
				Math.min(html.length, m.index + 700)
			);
			let title = '';
			const alt = around.match(/<img[^>]+alt="([^"]{3,})"/i);
			if (alt) title = cleanTitle(alt[1]);
			if (!title) {
				const tl = around.match(
					new RegExp(`href="[^"]*/novel/${slug}/?"[^>]*>\\s*([^<]{3,120})`, 'i')
				);
				if (tl) title = cleanTitle(tl[1]);
			}
			if (!title) {
				title = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
			}
			if (/^(read novel|start reading)$/i.test(title)) continue;

			let cover = '';
			const img = around.match(
				/<img[^>]+(?:src|data-src)="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i
			);
			if (img) cover = img[1].replace(/&amp;/g, '&');

			out.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: 'Ongoing'
			});
		}
		return out;
	}

	private parseChapterListHtml(html: string, seriesSlug: string): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();
		const re = new RegExp(
			`href="(?:https?:\\/\\/azurechronicles\\.com)?\\/novel\\/${seriesSlug.replace(
				/[.*+?^${}()|[\\]\\\\]/g,
				'\\$&'
			)}\\/(chapter-[^"/?#]+)\\/?"[^>]*>([\\s\\S]*?)<\\/a>`,
			'gi'
		);
		let m: RegExpExecArray | null;
		while ((m = re.exec(html))) {
			const chapSlug = m[1];
			const id = `/novel/${seriesSlug}/${chapSlug}`;
			if (seen.has(id)) continue;
			let title = cleanTitle(stripHtml(m[2]))
				.replace(/\s+\d+[smhdw]\s+ago\s*$/i, '')
				.trim();
			if (
				!title ||
				/^(start reading|read novel|add to library)$/i.test(title)
			)
				continue;
			seen.add(id);
			out.push({
				id,
				title,
				number: parseChapterNumber(title, chapSlug)
			});
		}
		out.sort((a, b) => b.number - a.number);
		return out;
	}

	private extractChapterText(html: string): string {
		const extractParas = (src: string): string => {
			const chunk = src
				.replace(/<script[\s\S]*?<\/script>/gi, '')
				.replace(/<style[\s\S]*?<\/style>/gi, '')
				.replace(/<nav[\s\S]*?<\/nav>/gi, '')
				.replace(/What did you think of this chapter[\s\S]*/i, '');
			return [...chunk.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
				.map((x) => x[0])
				.filter((p) => {
					const t = stripHtml(p).replace(/\s+/g, ' ').trim();
					return (
						t.length >= 25 &&
						!/^(start reading|add to library|sign in)/i.test(t)
					);
				})
				.join('\n');
		};

		for (const re of [
			/<article[^>]*>([\s\S]*?)<\/article>/i,
			/<div[^>]+class="[^"]*(?:chapter-content|entry-content|post-content|prose)[^"]*"[^>]*>([\s\S]*?)<\/div>/i
		]) {
			const hit = html.match(re);
			if (hit?.[1] && stripHtml(extractParas(hit[1])).length > 150) {
				return extractParas(hit[1]);
			}
		}
		const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] || html;
		const after = main.split(/<\/h1>/i).slice(1).join('</h1>');
		const cut = after.split(
			/What did you think of this chapter|Discussion|Comments/i
		)[0];
		return extractParas(cut);
	}

	/* ─── Public API ─── */

	async getLatestManga(page = 1): Promise<Manga[]> {
		const pageNum = Math.max(1, page);
		if (await this.canUseApi()) {
			try {
				const api = await this.apiLatest(pageNum);
				if (api.length) return api;
			} catch (e) {
				console.error('[AzureChronicles] API latest failed', e);
				this.apiOk = false;
			}
		}
		// HTML fallback
		const path = pageNum <= 1 ? '/' : `/?page=${pageNum}`;
		try {
			const html = await this.fetchPage(path);
			return this.parseNovelCards(html).slice(0, PAGE_SIZE);
		} catch (e) {
			console.error('[AzureChronicles] HTML latest failed', e);
			return [];
		}
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = query.trim();
		if (!q) return [];
		const page = opts?.page ?? 1;
		if (await this.canUseApi()) {
			try {
				const api = await this.apiSearch(q, page);
				if (api.length) return api;
			} catch {
				this.apiOk = false;
			}
		}
		try {
			const html = await this.fetchPage(`/?s=${encodeURIComponent(q)}`);
			return this.parseNovelCards(html).slice(0, PAGE_SIZE);
		} catch {
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = slugFromPath(mangaId) || mangaId.replace(/^\/+|\/+$/g, '');
		if (!slug) throw new Error(`Invalid manga id: ${mangaId}`);

		if (await this.canUseApi()) {
			try {
				const api = await this.apiDetails(slug);
				if (api) return api;
			} catch (e) {
				console.error('[AzureChronicles] API details failed', e);
				this.apiOk = false;
			}
		}

		const html = await this.fetchPage(`/novel/${slug}/`);
		const titleMatch =
			html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
			html.match(/property="og:title"[^>]+content="([^"]+)"/i);
		const title = cleanTitle(
			titleMatch ? stripHtml(titleMatch[1]) : slug.replace(/-/g, ' ')
		);
		const coverMatch = html.match(
			/property="og:image"[^>]+content="([^"]+)"/i
		);
		const cover = (coverMatch?.[1] || '').replace(/&amp;/g, '&');
		const genres: string[] = [];
		const gb = html.match(/Genres\s*:?\s*([\s\S]{0,300}?)<\//i);
		if (gb) {
			for (const g of stripHtml(gb[1]).split(/[,|/]/)) {
				const t = g.trim();
				if (t && t.length < 40 && !/genre/i.test(t)) genres.push(t);
			}
		}
		let description = '';
		const og = html.match(
			/property="og:description"[^>]+content="([^"]+)"/i
		);
		if (og) description = decodeEntities(og[1]);
		const chapters = this.parseChapterListHtml(html, slug);

		return {
			id: `/novel/${slug}`,
			title,
			cover,
			sourceId: this.id,
			description,
			authors: [],
			status: /Completed/i.test(html) ? 'Completed' : 'Ongoing',
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
		const m = chapterId.match(/\/novel\/([^/]+)\/(chapter-[^/]+)/i);
		if (!m) throw new Error(`Invalid chapter id: ${chapterId}`);
		const [, seriesSlug, chapSlug] = m;

		// 1) WP API dulu (seperti KariStudio)
		if (await this.canUseApi()) {
			try {
				const api = await this.apiChapterContent(seriesSlug, chapSlug);
				if (api && stripHtml(api.content).length > 80) {
					return {
						...api,
						prevChapterId: null,
						nextChapterId: null
					};
				}
			} catch (e) {
				console.error('[AzureChronicles] API chapter failed', e);
				this.apiOk = false;
			}
		}

		// 2) HTML fallback
		const path = `/novel/${seriesSlug}/${chapSlug}/`;
		try {
			await this.fetchPage(`/novel/${seriesSlug}/`);
		} catch {
			/* warm */
		}
		const html = await this.fetchPage(path);
		const titleMatch =
			html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
			html.match(/property="og:title"[^>]+content="([^"]+)"/i);
		const title = cleanTitle(
			titleMatch ? stripHtml(titleMatch[1]) : chapSlug.replace(/-/g, ' ')
		);

		let body = this.extractChapterText(html);
		body = body
			.replace(/<img\b[^>]*>/gi, '')
			.replace(/<picture[\s\S]*?<\/picture>/gi, '');
		let plain = stripHtml(body).replace(/\s+/g, ' ').trim();

		if (plain.length < 100) {
			await new Promise((r) => setTimeout(r, 2500));
			const html2 = await this.fetchPage(path, 3);
			body = this.extractChapterText(html2).replace(/<img\b[^>]*>/gi, '');
			plain = stripHtml(body).replace(/\s+/g, ' ').trim();
		}

		if (plain.length < 80) {
			throw new Error(
				'Chapter body empty or blocked by anti-bot — retry in a few seconds'
			);
		}

		return {
			title,
			content: `<div class="ac-chapter">${body}</div>`,
			prevChapterId: null,
			nextChapterId: null
		};
	}
}

export default AzureChroniclesSource;
