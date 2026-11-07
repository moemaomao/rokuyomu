/**
 * KJNovels (kjnovels.com) — Next.js translated web novels
 * Path: scraper/src/sources/impl/novel/KJNovels.ts
 *
 * - Latest: homepage + /browse (site kecil; return semua)
 * - Novel: /novel/{slug}
 * - Chapter: /novel/{slug}/chapter-{n}-...
 * - Chapter list: extract all chapter-* slugs from novel HTML
 * - Content: chapter page body text / prose
 * - Cover: img.kjnovels.com/wp-content/uploads/...
 * - Search: /search?q=
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://kjnovels.com';
const PER_PAGE = 24;

function absUrl(href: string | undefined | null): string {
	if (!href) return '';
	const h = String(href).trim();
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
	return /^\/novel\/[a-z0-9\-]+\/chapter-/i.test(id);
}

function parseChapterNumber(text: string): number {
	const m =
		text.match(/\/chapter-(\d+)/i) ||
		text.match(/(?:chapter|ch\.?)\s*[.:\-]?\s*(\d+)/i);
	if (m) {
		const n = parseInt(m[1], 10);
		if (!Number.isNaN(n)) return n;
	}
	return 0;
}

function extractCover(html: string, $?: any): string {
	const og = html.match(/property="og:image"\s+content="([^"]+)"/i);
	if (og) return absUrl(og[1].replace(/\\+/g, ''));
	const img = html.match(
		/(https:\/\/img\.kjnovels\.com\/[^"'\\\s]+\.(?:webp|jpg|jpeg|png))/i
	);
	if (img) return img[1].replace(/\\+/g, '');
	if ($) {
		const src =
			$('meta[property="og:image"]').attr('content') ||
			$('img[src*="img.kjnovels.com"]').first().attr('src') ||
			$('img[src*="cover"]').first().attr('src') ||
			'';
		return absUrl(String(src).split('?')[0]);
	}
	return '';
}

export class KJNovelsSource extends BaseSource {
	id = 'kjnovels';
	name = 'KJNovels';
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
				pageNum <= 1
					? ['/', '/browse', '/updates']
					: [`/browse?page=${pageNum}`, `/updates?page=${pageNum}`];
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
			console.error('[kjnovels] getLatestManga', e);
			return [];
		}
	}

	private parseNovelCards(html: string): Manga[] {
		const ordered: Manga[] = [];
		const seen = new Set<string>();
		const slugRe = /\/novel\/([a-z0-9\-]+)(?!\/chapter)/gi;
		const slugs: string[] = [];
		let sm: RegExpExecArray | null;
		while ((sm = slugRe.exec(html))) {
			const slug = sm[1];
			if (slugs.includes(slug)) continue;
			if (/^chapter-\d+/i.test(slug)) continue;
			slugs.push(slug);
		}

		for (const slug of slugs) {
			const id = `/novel/${slug}`;
			if (seen.has(id)) continue;

			let title = '';
			const idx = html.indexOf(slug);
			if (idx >= 0) {
				const chunk = html.slice(Math.max(0, idx - 1200), idx + 1200);
				const t1 = chunk.match(/\\?"title\\?"\s*:\s*\\?"((?:[^\\"\\]|\\.)+?)\\?"/);
				if (t1) {
					try {
						title = cleanText(JSON.parse(`"${t1[1].replace(/\\"/g, '"')}"`));
					} catch {
						title = cleanText(t1[1].replace(/\\"/g, '"').replace(/\\'/g, "'"));
					}
				}
				if (!title) {
					const t2 = chunk.match(/\\"title\\":\\"((?:[^\\]|\\.)*?)\\"/);
					if (t2) title = cleanText(t2[1].replace(/\\"/g, '"'));
				}
			}
			if (!title || title.length < 2) {
				title = slug
					.split('-')
					.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
					.join(' ');
			}
			if (
				/^(start reading|read more|view all|browse|home|search|login|latest)$/i.test(
					title
				)
			) {
				continue;
			}
			if (title.length > 180) title = title.slice(0, 180);

			let cover = '';
			if (idx >= 0) {
				const chunk = html.slice(Math.max(0, idx - 800), idx + 800);
				const cm = chunk.match(
					/https:\/\/img\.kjnovels\.com\/[^"'\\\s]+\.(?:webp|jpg|jpeg|png)/i
				);
				if (cm) cover = cm[0].replace(/\\+/g, '');
			}
			if (!cover) {
				const cm = html.match(
					new RegExp(
						`${slug}[\\s\\S]{0,400}?(https://img\\.kjnovels\\.com/[^"'\\\\\\s]+\\.(?:webp|jpg|jpeg|png))`,
						'i'
					)
				);
				if (cm) cover = cm[1].replace(/\\+/g, '');
			}

			let latestChapter: number | undefined;
			if (idx >= 0) {
				const chunk = html.slice(idx, idx + 600);
				const cm = chunk.match(/chapter-(\d+)/i);
				if (cm) latestChapter = parseInt(cm[1], 10);
			}

			seen.add(id);
			ordered.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				...(latestChapter != null ? { latestChapter } : {})
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
				`/search?q=${encodeURIComponent(q)}`
			);
			return this.parseNovelCards(html).slice(0, PER_PAGE);
		} catch (e) {
			console.error('[kjnovels] search', e);
			const all = await this.getLatestManga(1);
			const qq = q.toLowerCase();
			return all.filter((m) => m.title.toLowerCase().includes(qq));
		}
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
			cleanText($('h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '') ||
			'';
		title = title
			.replace(/\s*[|\-–]\s*KJNovels.*$/i, '')
			.replace(/\s+by\s+.+$/i, '')
			.trim();
		if (!title || title.length < 2) {
			const tm = html.match(/<title>([^<]+)<\/title>/i);
			if (tm) {
				title = cleanText(tm[1])
					.replace(/\s*[|\-–]\s*Read Online.*$/i, '')
					.replace(/\s*[|\-–]\s*KJNovels.*$/i, '')
					.replace(/\s+by\s+.+$/i, '')
					.trim();
			}
		}
		if (!title) throw new Error('Novel not found');

		const cover = extractCover(html, $);
		const authors: string[] = [];
		const authorFromTitle = html.match(
			/<title>[^<]*?\s+by\s+([^|<]+)/i
		);
		if (authorFromTitle) {
			const a = cleanText(authorFromTitle[1]);
			if (a) authors.push(a);
		}
		$('a[href*="/author/"], [class*="author"]').each((_, el) => {
			const n = cleanText($(el).text());
			if (n && n.length < 80 && !authors.includes(n)) authors.push(n);
		});

		const genres: string[] = [];
		const genreSet = new Set<string>();
		const gms = html.matchAll(/\/browse\?genre=([a-z0-9\-]+)/gi);
		for (const m of gms) {
			const g = m[1].replace(/-/g, ' ');
			const label = g.replace(/\b\w/g, (c) => c.toUpperCase());
			if (!genreSet.has(label)) {
				genreSet.add(label);
				genres.push(label);
			}
		}

		let description = '';
		const descMeta = html.match(
			/name="description"\s+content="([^"]+)"/i
		);
		if (descMeta) {
			description = cleanText(
				descMeta[1]
					.replace(/&lt;/g, '<')
					.replace(/&gt;/g, '>')
					.replace(/&quot;/g, '"')
					.replace(/&amp;/g, '&')
					.replace(/<[^>]+>/g, ' ')
			);

			description = description
				.replace(/\s*\d+\s*chapters?\s*availa\w*/i, '')
				.trim()
				.slice(0, 4000);
		}
		if (description.length < 40) {
			$('p').each((_, el) => {
				const t = cleanText($(el).text());
				if (t.length > 80 && !description) {
					description = t
						.replace(/\s*\d+\s*chapters?\s*availa\w*/i, '')
						.trim()
						.slice(0, 4000);
				}
			});
		}

		let status = 'Ongoing';
		if (/\bCompleted\b/i.test(html)) status = 'Completed';
		else if (/\bHiatus\b/i.test(html)) status = 'Hiatus';

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
		const out: Chapter[] = [];
		const slug = novelPath.replace(/^\/novel\//, '');
		const byNum = new Map<number, string>();
		const re = /chapter-(\d+)([a-z0-9\-]*)/gi;
		let m: RegExpExecArray | null;
		while ((m = re.exec(html))) {
			const number = parseInt(m[1], 10);
			if (Number.isNaN(number) || number <= 0) continue;
			const chSlug = `chapter-${m[1]}${m[2] || ''}`;
			const prev = byNum.get(number);
			if (!prev || chSlug.length > prev.length) {
				byNum.set(number, chSlug);
			}
		}

		const lockedNums = new Set<number>();
		const lockRe =
			/chapter-(\d+)[a-z0-9\-]*[\s\S]{0,120}?(?:Locked|Premium|🔒)/gi;
		while ((m = lockRe.exec(html))) {
			lockedNums.add(parseInt(m[1], 10));
		}

		const nums = [...byNum.keys()].sort((a, b) => b - a);
		for (const number of nums) {
			const chSlug = byNum.get(number)!;
			out.push({
				id: `/novel/${slug}/${chSlug}`,
				title: `Chapter ${number}`,
				number,
				isLocked: lockedNums.has(number)
			});
		}

		return out;
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

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const bodyText = cleanText($('body').text()).slice(0, 2500);
		if (
			/unlock this chapter|login to read|not enough coins|purchase chapter/i.test(
				bodyText
			)
		) {

		}

		let $content = $('article .prose, .prose, article, main').first();
		$content.find('script, style, noscript, nav, header, footer').remove();

		const paragraphs: string[] = [];
		$content.find('p').each((_, el) => {
			const t = cleanText($(el).text());
			if (t.length > 0) paragraphs.push(t);
		});

		if (paragraphs.length < 2) {
			const texts = html.match(/>([^<]{60,})/g) || [];
			for (const raw of texts) {
				const t = cleanText(raw.slice(1));
				if (
					t.length > 60 &&
					!/function|webpack|https?:|KJNovels|Loading/i.test(t)
				) {
					paragraphs.push(t);
				}
			}
		}

		if (paragraphs.length < 1) {
			throw new Error('Chapter content empty or locked');
		}

		const content = paragraphs
			.map((p) => `<p>${escapeHtml(p)}</p>`)
			.join('');

		const number = parseChapterNumber(path);

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		const novelBase = path.replace(/\/chapter-[^/]+$/i, '');
		const allCh = [
			...new Set(
				(html.match(new RegExp(`${novelBase}/chapter-[a-z0-9\\-]+`, 'gi')) ||
					[]).map((h) => pathOnly(h))
			)
		];
		const sorted = allCh
			.map((id) => ({ id, n: parseChapterNumber(id) }))
			.filter((x) => x.n > 0)
			.sort((a, b) => a.n - b.n);
		const idx = sorted.findIndex((x) => x.n === number);
		if (idx > 0) prevChapterId = sorted[idx - 1].id;
		if (idx >= 0 && idx < sorted.length - 1) nextChapterId = sorted[idx + 1].id;

		$('a[href*="/chapter-"]').each((_, el) => {
			const href = pathOnly($(el).attr('href') || '');
			const label = cleanText($(el).text()).toLowerCase();
			if (!isChapterPath(href)) return;
			if (!prevChapterId && /prev|previous/i.test(label)) prevChapterId = href;
			if (!nextChapterId && /next/i.test(label)) nextChapterId = href;
		});
		if (!nextChapterId && number > 0) {
			const candidates = sorted.filter((x) => x.n === number + 1);
			if (candidates.length) nextChapterId = candidates[0].id;
		}
		if (!prevChapterId && number > 1) {
			const candidates = sorted.filter((x) => x.n === number - 1);
			if (candidates.length) prevChapterId = candidates[0].id;
		}

		return {
			title: number > 0 ? `Chapter ${number}` : 'Chapter',
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default KJNovelsSource;
