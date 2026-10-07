/**
 * Nightjar Reads (nightjarreads.com) — Next.js + Supabase covers
 * Path: scraper/src/sources/impl/novel/NightjarReads.ts
 *
 * - Latest: / and /browse
 * - Novel: /novel/{slug}
 * - Chapter: /novel/{slug}/{n}
 * - Content: article / .prose paragraphs
 * - Cover: supabase.co/storage/.../covers/...
 * - Search: /browse?q= or client filter
 * - Chapter title: "Chapter N"
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://nightjarreads.com';
const PER_PAGE = 24;

function absUrl(href: string | undefined | null): string {
	if (!href) return '';
	const h = String(href).trim().replace(/\\+/g, '');
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
		return (href.startsWith('/') ? href : `/${href}`).replace(/\/$/, '') || '/';
	}
}

function cleanText(s: string): string {
	return (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function isNovelPath(id: string): boolean {
	return /^\/novel\/[a-z0-9\-]+$/i.test(id);
}

function isChapterPath(id: string): boolean {
	return /^\/novel\/[a-z0-9\-]+\/\d+$/i.test(id);
}

function parseChapterNumber(text: string): number {
	const m =
		text.match(/\/(\d+)$/) ||
		text.match(/(?:chapter|ch\.?)\s*[.:\-]?\s*(\d+)/i);
	if (m) {
		const n = parseInt(m[1], 10);
		if (!Number.isNaN(n)) return n;
	}
	return 0;
}

function decodeRsc(s: string): string {
	try {
		return JSON.parse(`"${s.replace(/"/g, '\\"')}"`);
	} catch {
		return s
			.replace(/\\n/g, '\n')
			.replace(/\\"/g, '"')
			.replace(/\\\\/g, '\\')
			.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
				String.fromCharCode(parseInt(h, 16))
			);
	}
}

function rscField(html: string, key: string): string {
	const re = new RegExp(`\\\\"${key}\\\\":\\\\"((?:[^\\\\]|\\\\.)*?)\\\\"`);
	const m = html.match(re);
	if (!m) return '';
	return cleanText(decodeRsc(m[1]));
}

export class NightjarReadsSource extends BaseSource {
	id = 'nightjarreads';
	name = 'NightjarReads';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	// ─── Latest ──────────────────────────────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		const pageNum = Math.max(1, page);
		try {
			const paths =
				pageNum <= 1 ? ['/', '/browse'] : [`/browse?page=${pageNum}`];
			const ordered: Manga[] = [];
			const seen = new Set<string>();
			for (const p of paths) {
				try {
					const html = await this.fetchHtml(p);
					for (const m of this.parseNovelCards(html)) {
						if (seen.has(m.id)) continue;
						seen.add(m.id);
						ordered.push(m);
					}
				} catch {
				}
			}
			const start = (pageNum - 1) * PER_PAGE;
			return ordered.slice(start, start + PER_PAGE);
		} catch (e) {
			console.error('[nightjarreads] getLatestManga', e);
			return [];
		}
	}

	private parseNovelCards(html: string): Manga[] {
		const ordered: Manga[] = [];
		const seen = new Set<string>();
		const slugRe = /\/novel\/([a-z0-9\-]+)(?!\/\d)/gi;
		const slugs: string[] = [];
		let sm: RegExpExecArray | null;
		while ((sm = slugRe.exec(html))) {
			if (!slugs.includes(sm[1])) slugs.push(sm[1]);
		}

		for (const slug of slugs) {
			const id = `/novel/${slug}`;
			if (seen.has(id)) continue;

			const latestLink = html.match(
				new RegExp(
					`href="(/novel/${slug}/(\\d+))"[^>]*>\\s*Latest ch\\.`,
					'i'
				)
			);
			const idx = latestLink
				? html.indexOf(latestLink[0])
				: html.indexOf(`/novel/${slug}`);
			const chunk =
				idx >= 0
					? html.slice(Math.max(0, idx - 2000), idx + 800)
					: html;

			let title = '';
			const tm = chunk.match(/\\"title\\":\\"((?:[^\\]|\\.)*?)\\"/);
			if (tm) title = cleanText(decodeRsc(tm[1]));
			if (!title || title.length < 2) {
				title = slug
					.split('-')
					.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
					.join(' ');
			}
		
			if (
				/^(nightjar|browse|library|genres|home|popular|trending|latest|originals?)$/i.test(
					title
				) ||
				/being read a lot/i.test(title)
			) {
				continue;
			}
			if (title.length > 180) title = title.slice(0, 180);

			let cover = '';
			const cm = chunk.match(
				/(https:\/\/[^"'\\]*supabase\.co\/[^"'\\]*covers[^"'\\]+\.(?:jpg|jpeg|png|webp))/i
			);
			if (cm) cover = cm[1].replace(/\\+/g, '');
			if (!cover) {
				const pm = chunk.match(/_next\/image\?url=([^&"']+)/i);
				if (pm) {
					try {
						cover = decodeURIComponent(pm[1]);
					} catch {
						cover = pm[1];
					}
				}
			}

			let latestChapter: number | undefined;
			if (latestLink) {
				latestChapter = parseInt(latestLink[2], 10);
			} else {
				const nums = [
					...chunk.matchAll(
						new RegExp(`/novel/${slug}/(\\d+)`, 'gi')
					)
				].map((x) => parseInt(x[1], 10));
				if (nums.length) latestChapter = Math.max(...nums);
			}

			let status: string | undefined;
			if (
				/\\"status\\":\\"Completed\\"/i.test(chunk) ||
				/\bCompleted\b/i.test(chunk)
			) {
				status = 'Completed';
			} else if (/\\"status\\":\\"Ongoing\\"/i.test(chunk)) {
				status = 'Ongoing';
			}

			let updatedAt: number | undefined;
			const iso =
				chunk.match(/\\"updatedAt\\":\\"([^\\"]+)\\"/i) ||
				chunk.match(/\\"updated_at\\":\\"([^\\"]+)\\"/i) ||
				chunk.match(/\\"lastUpdated\\":\\"([^\\"]+)\\"/i);
			if (iso) {
				const parsed = Date.parse(iso[1]);
				if (!Number.isNaN(parsed)) updatedAt = parsed;
			}

			seen.add(id);
			ordered.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status,
				...(latestChapter != null ? { latestChapter } : {}),
				...(updatedAt != null ? { updatedAt } : {})
			});
		}

		return ordered;
	}

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page ?? 1);
		if (!q) return this.getLatestManga(page);

		try {
			const html = await this.fetchHtml(
				`/browse?q=${encodeURIComponent(q)}`
			);
			const list = this.parseNovelCards(html);
			if (list.length) return list.slice(0, PER_PAGE);
		} catch {
		}
		const all = await this.getLatestManga(1);
		const qq = q.toLowerCase();
		return all.filter((m) => m.title.toLowerCase().includes(qq));
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = pathOnly(mangaId);
		if (!path.startsWith('/novel/')) {
			path = `/novel/${path.replace(/^\//, '')}`;
		}

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		let title =
			rscField(html, 'title') ||
			cleanText($('h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '');
		title = title
			.replace(/\s*[—–\-]\s*read online.*$/i, '')
			.replace(/\s*[—–\-]\s*Nightjar.*$/i, '')
			.trim();
		if (!title) {
			const tm = html.match(/<title>([^<]+)<\/title>/i);
			if (tm) {
				title = cleanText(tm[1])
					.replace(/\s*[—–\-]\s*read online.*$/i, '')
					.replace(/\s*[—–\-]\s*Nightjar.*$/i, '')
					.trim();
			}
		}
		if (!title) throw new Error('Novel not found');

		let cover = '';
		const cm = html.match(
			/(https:\/\/[^"'\\]*supabase\.co\/[^"'\\]*covers[^"'\\]+\.(?:jpg|jpeg|png|webp))/i
		);
		if (cm) cover = cm[1].replace(/\\+/g, '');
		if (!cover) {
			cover = absUrl(
				$('meta[property="og:image"]').attr('content') ||
					$('img[src*="supabase"]').first().attr('src') ||
					''
			);
		}

		const authors: string[] = [];
		const author = rscField(html, 'author');
		if (author) authors.push(author);
		$('a[href*="/author/"]').each((_, a) => {
			const n = cleanText($(a).text());
			if (n && !authors.includes(n)) authors.push(n);
		});

		const genres: string[] = [];
		const gm = html.match(/\\"genres\\":\[((?:[^\]])*?)\]/);
		if (gm) {
			const parts = gm[1].match(/\\"([^\\]+)\\"/g) || [];
			for (const p of parts) {
				const g = p.replace(/\\"/g, '');
				if (g && !genres.includes(g)) genres.push(g);
			}
		}

		let description =
			rscField(html, 'description') ||
			rscField(html, 'synopsis') ||
			rscField(html, 'summary') ||
			'';
		if (description.length < 40) {
			$('p').each((_, el) => {
				const t = cleanText($(el).text());
				if (t.length > 80 && !description) description = t.slice(0, 4000);
			});
		}
		description = description.slice(0, 4000);

		let status = 'Ongoing';
		const st = rscField(html, 'status') || '';
		if (/complet/i.test(st) || /\bCompleted\b/i.test(html)) status = 'Completed';
		else if (/hiatus/i.test(st)) status = 'Hiatus';
		else if (/ongoing/i.test(st)) status = 'Ongoing';

		const chapters = this.parseChapterList(html, path);

		return {
			id: path,
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

	private parseChapterList(html: string, novelPath: string): Chapter[] {
		const slug = novelPath.replace(/^\/novel\//, '');
		const byNum = new Map<number, string>();

		const re = new RegExp(`/novel/${slug}/(\\d+)`, 'gi');
		let m: RegExpExecArray | null;
		while ((m = re.exec(html))) {
			const n = parseInt(m[1], 10);
			if (!Number.isNaN(n) && n > 0) byNum.set(n, `${novelPath}/${n}`);
		}

		const nr = /\\"number\\":(\d+)/g;
		while ((m = nr.exec(html))) {
			const n = parseInt(m[1], 10);
			if (!Number.isNaN(n) && n > 0 && !byNum.has(n)) {
				byNum.set(n, `${novelPath}/${n}`);
			}
		}

		const locked = new Set<number>();
		const lockRe = new RegExp(
			`/novel/${slug}/(\\d+)[\\s\\S]{0,80}?(?:locked|premium|🔒)`,
			'gi'
		);
		while ((m = lockRe.exec(html))) {
			locked.add(parseInt(m[1], 10));
		}

		const nums = [...byNum.keys()].sort((a, b) => b - a);
		return nums.map((number) => ({
			id: byNum.get(number)!,
			title: `Chapter ${number}`,
			number,
			isLocked: locked.has(number)
		}));
	}

	// ─── Chapter content ─────────────────────────────────────────────────

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		const path = pathOnly(chapterId);
		if (!isChapterPath(path)) {
			throw new Error(`Invalid chapter id: ${chapterId}`);
		}
		const number = parseChapterNumber(path);
		const novelBase = path.replace(/\/\d+$/, '');

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		let $content = $(
			'article.reader-prose, .reader-prose, article, .reader-shell, main'
		).first();
		$content.find('script, style, noscript, nav, header, footer').remove();

		const paragraphs: string[] = [];
		$content.find('p').each((_, el) => {
			const t = cleanText($(el).text());
			if (!t || t.length < 2) return;
			if (
				/^(previous|next|table of contents|bookmark)/i.test(t) ||
				/quiet place to read translated/i.test(t) ||
				/novels and translations remain the property/i.test(t) ||
				/©\s*\d{4}\s*Nightjar/i.test(t)
			) {
				return;
			}
			paragraphs.push(t);
		});

		if (
			paragraphs.length &&
			paragraphs[0].length < 80 &&
			!/[.!?]"?$/.test(paragraphs[0])
		) {
			paragraphs.shift();
		}

		let content = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('');

		if (!content || content.length < 80) {
			const fallback: string[] = [];
			$('p').each((_, el) => {
				const t = cleanText($(el).text());
				if (
					t.length > 40 &&
					!/quiet place to read|property of their respective|©\s*\d{4}/i.test(
						t
					)
				) {
					fallback.push(t);
				}
			});
			if (fallback.length >= 2) {
				content = fallback.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
			}
		}

		if (!content || content.length < 40) {
			const bodySnippet = cleanText($('body').text()).slice(0, 2500);
			if (
				/unlock this chapter|login to read|subscribe to continue|premium only/i.test(
					bodySnippet
				)
			) {
				throw new Error(`Chapter ${number} is locked on Nightjar Reads`);
			}
			throw new Error(`Chapter ${number} empty or locked`);
		}

		let prevChapterId: string | null =
			number > 1 ? `${novelBase}/${number - 1}` : null;
		let nextChapterId: string | null = `${novelBase}/${number + 1}`;

		$('a[href*="/novel/"]').each((_, el) => {
			const href = pathOnly($(el).attr('href') || '');
			if (!isChapterPath(href)) return;
			const label = cleanText($(el).text()).toLowerCase();
			const cls = ($(el).attr('class') || '').toLowerCase();
			if (/prev/i.test(label) || /prev/i.test(cls)) prevChapterId = href;
			if (/next/i.test(label) || /next/i.test(cls)) nextChapterId = href;
		});

		return {
			title: `Chapter ${number}`,
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default NightjarReadsSource;
