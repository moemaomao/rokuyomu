/**
 * Drowsic (drowsic.com)
 * Path: scraper/src/sources/impl/novel/Drowsic.ts
 *
 * WordPress + Fictioneer theme — JP novel fan translations / originals.
 *
 * - List: / and /projects/ (+ /projects/page/N/)
 * - Story: /story/{slug}/
 * - Chapter: /story/{slug}/{chapter-slug}/
 * - Content: .chapter__content / #chapter-content
 * - Premium: list item class _premium + fa-lock → isLocked
 *
 * Homepage: 24 titles
 * Chapter titles: "Chapter N" (volume disimpan di number composit opsional)
 *
 * Frontend id: drowsic
 *
 * WAJIB: BYPARR_URL di Vercel ATAU hybrid Worker (worker-sources.json → drowsic).
 * IP datacenter kena Cloudflare challenge.
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types-manga';
import { fetchWithCf } from '../../fetchWithCf';

const BASE = 'https://drowsic.com';

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
		const p = href.startsWith('/') ? href : `/${href}`;
		return p.replace(/\/$/, '') || '/';
	}
}

function cleanText(s: string): string {
	return (s || '')
		.replace(/\u00a0/g, ' ')
		.replace(/&#8211;/g, '–')
		.replace(/&#8212;/g, '—')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ')
		.trim();
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function decodeEntities(s: string): string {
	return s
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
		.replace(/&#8211;/g, '–')
		.replace(/&#8212;/g, '—');
}

function parseChapterNumber(text: string, fallback = 0): number {
	const t = cleanText(text);
	const volCh = t.match(
		/vol(?:ume)?\.?\s*(\d+)\s*[-–]?\s*ch(?:apter)?\.?\s*(\d+(?:\.\d+)?)/i
	);
	if (volCh) {
		const vol = parseInt(volCh[1], 10);
		const ch = parseFloat(volCh[2]);
		if (!Number.isNaN(vol) && !Number.isNaN(ch)) {
			return vol * 100000 + Math.round(ch * 100);
		}
	}
	const ch = t.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i);
	if (ch) {
		const n = parseFloat(ch[1]);
		if (!Number.isNaN(n)) return Math.round(n * 100);
	}
	const bare = t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (bare) {
		const n = parseFloat(bare[1]);
		if (!Number.isNaN(n)) return Math.round(n * 100);
	}
	return fallback;
}

function shortChapterTitle(num: number, raw?: string): string {
	if (num >= 100000) {
		const vol = Math.floor(num / 100000);
		const chHundredths = num % 100000;
		const ch = chHundredths / 100;
		const chStr = Number.isInteger(ch) ? String(ch) : ch.toFixed(2).replace(/\.?0+$/, '');
		return `Vol. ${vol} Chapter ${chStr}`;
	}
	if (num > 0) {
		const ch = num / 100;
		const chStr = Number.isInteger(ch) ? String(ch) : ch.toFixed(2).replace(/\.?0+$/, '');
		return `Chapter ${chStr}`;
	}
	if (/prologue/i.test(raw || '')) return 'Prologue';
	if (/epilogue/i.test(raw || '')) return 'Epilogue';
	return 'Chapter';
}

function isStoryPath(href: string): { slug: string } | null {
	const path = pathOnly(href);
	const m = path.match(/^\/story\/([^/]+)\/?$/);
	if (!m) return null;
	return { slug: m[1] };
}

function isChapterPath(href: string): boolean {
	const path = pathOnly(href);
	return /^\/story\/[^/]+\/[^/]+$/.test(path);
}

function pickImgSrc(img: cheerio.Cheerio<any>): string {
	const srcset =
		img.attr('data-srcset') ||
		img.attr('srcset') ||
		'';
	const fromSrcset = srcset
		.split(',')
		.map((s) => s.trim().split(/\s+/)[0])
		.filter(Boolean);

	const candidates = [
		img.attr('data-src'),
		img.attr('data-lazy-src'),
		img.attr('data-bg'),
		img.attr('data-orig-file'),
		...fromSrcset,
		img.attr('src')
	].filter((s): s is string => !!s && !s.startsWith('data:') && !s.startsWith('#'));

	const full = candidates.find((s) => /\/uploads\/.+\.(jpg|jpeg|png|webp)$/i.test(s) && !/\-\d+x\d+\./.test(s));
	const src = full || candidates[candidates.length - 1] || candidates[0] || '';
	return absUrl((src || '').split('?')[0]);
}

function imgFromEl($: cheerio.CheerioAPI, el: cheerio.Cheerio<any>): string {
	const imageLink = el.find('a.card__image, a[data-lightbox]').first().attr('href') || '';
	if (imageLink && /\.(jpg|jpeg|png|webp)(\?|$)/i.test(imageLink)) {
		return absUrl(imageLink.split('?')[0]);
	}

	const imgs = el.find('img');
	for (let i = 0; i < imgs.length; i++) {
		const src = pickImgSrc(imgs.eq(i));
		if (src) return src;
	}
	const style = el.find('[style*="background"]').attr('style') || '';
	const m = style.match(/url\(['"]?([^'")\s]+)/);
	if (m) return absUrl(m[1]);
	return '';
}

export class DrowsicSource extends BaseSource {
	id = 'drowsic';
	name = 'Drowsic';
	baseUrl = BASE;

	kind = 'novel' as const;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept:
			'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http')
			? path
			: `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
		return fetchWithCf(url, {
			headers: {
				...this.headers,
				Referer: this.baseUrl + '/'
			}
		});
	}

	// ─── Latest ──────────────────────────────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		return this.getLatestNovels(page);
	}

	async getLatestNovels(page = 1): Promise<Manga[]> {
		const path = page <= 1 ? '/projects/' : `/projects/page/${page}/`;
		const errors: string[] = [];

		const load = async (p: string): Promise<Manga[]> => {
			try {
				const html = await this.fetchHtml(p);
				if (!html || html.length < 500) {
					errors.push(`${p}: empty html (${html?.length ?? 0})`);
					return [];
				}
				const list = this.parseStoryCards(html);
				if (!list.length) {
					const fb = this.parseStoryCardsRegex(html);
					if (fb.length) return fb;
					errors.push(`${p}: parsed 0 cards (html ${html.length})`);
				}
				return list;
			} catch (e: any) {
				errors.push(`${p}: ${e?.message || e}`);
				return [];
			}
		};

		let list: Manga[] = [];
		if (page <= 1) {
			const [home, projects] = await Promise.all([load('/'), load(path)]);
			list = this.dedupe([...home, ...projects]);
		} else {
			list = await load(path);
		}

		list = list.slice(0, 24);
		if (!list.length) {
			throw new Error(
				`[Drowsic] No stories found (page ${page}). ${errors.join(' | ') || 'unknown'}`
			);
		}
		return list;
	}

	private parseStoryCardsRegex(html: string): Manga[] {
		const list: Manga[] = [];
		const seen = new Set<string>();
		const re =
			/href=["'](https?:\/\/drowsic\.com\/story\/([^/"'?#]+)\/?)["'][^>]*>\s*([^<]{2,120})\s*</gi;
		let m: RegExpExecArray | null;
		while ((m = re.exec(html)) !== null) {
			const slug = m[2];
			const id = `/story/${slug}`;
			if (seen.has(id)) continue;
			let title = cleanText(decodeEntities(m[3]));
			if (!title || title.length < 2) continue;
			if (/^(read|home|projects|more)$/i.test(title)) continue;
			if (m[1].split('/').filter(Boolean).length > 3) continue;
			seen.add(id);

			const around = html.slice(Math.max(0, m.index - 600), m.index + 200);
			const img =
				around.match(
					/data-src=["'](https?:\/\/[^"']+wp-content\/uploads\/[^"']+)["']/i
				) ||
				around.match(
					/srcset=["'](https?:\/\/[^"'\s]+wp-content\/uploads\/[^"'\s]+)/i
				);
			const cover = img ? absUrl(img[1].split(' ')[0]) : '';

			list.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type: 'novel',
				status: 'Ongoing',
				lang: 'en'
			});
		}
		return list;
	}

	private dedupe(items: Manga[]): Manga[] {
		const seen = new Set<string>();
		const out: Manga[] = [];
		for (const m of items) {
			if (seen.has(m.id)) continue;
			seen.add(m.id);
			out.push(m);
		}
		return out;
	}

	private parseStoryCards(html: string): Manga[] {
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('a[href*="/story/"]').each((_, el) => {
			const a = $(el);
			const href = a.attr('href') || '';
			const parsed = isStoryPath(href);
			if (!parsed) return;
			const id = `/story/${parsed.slug}`;
			if (seen.has(id)) return;

			const root = a.closest('.card, article, li, [class*="card"]');
			const box = root.length ? root : a.parent();

			const title = cleanText(
				a.attr('title') ||
					box.find('.card__title, h2, h3, h4').first().text() ||
					a.text() ||
					''
			);
			if (!title || title.length < 2) return;
			if (/^(home|projects|bookmarks|faq|dmca|read more)$/i.test(title)) return;

			const cardRoot = a.closest('.card').length ? a.closest('.card') : box;
			const cover = imgFromEl($, cardRoot);

			const statusText =
				box.find('.card__footer-status, .story__status').text() || box.text();
			const status = /completed|complete/i.test(statusText)
				? 'Completed'
				: /hiatus|dropped/i.test(statusText)
					? 'Hiatus'
					: 'Ongoing';

			let latestChapter: number | undefined;
			const chFooter = cleanText(
				box.find('.card__footer-chapters').first().text() ||
					box.find('[class*="footer-chapters"]').first().text()
			);
			const chMatch = chFooter.match(/(\d{1,5})/);
			if (chMatch) {
				const n = parseInt(chMatch[1], 10);
				if (n > 0) latestChapter = n;
			}

			seen.add(id);
			list.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type: 'novel',
				status,
				lang: 'en',
				...(latestChapter != null ? { latestChapter } : {})
			});
		});

		return list;
	}

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = query.trim();
		if (!q) return [];
		const path =
			page <= 1
				? `/?s=${encodeURIComponent(q)}`
				: `/page/${page}/?s=${encodeURIComponent(q)}`;
		const html = await this.fetchHtml(path);
		return this.parseStoryCards(html).slice(0, 24);
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		if (!path.startsWith('/story/')) {
			path = `/story/${path.replace(/^\//, '')}`;
		}
		path = path.replace(/\/$/, '') + '/';

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title = cleanText(
			$('.story__identity-title, h1').first().text() ||
				$('meta[property="og:title"]').attr('content')?.split(/[–|-]/)[0] ||
				$('title').text().split(/[–|-]/)[0] ||
				''
		);
		if (!title || title.length < 2) {
			throw new Error('Story not found (empty title)');
		}

		const cover =
			absUrl($('meta[property="og:image"]').attr('content') || '') ||
			absUrl($('.story__thumbnail-image, .story__thumbnail img').attr('src') || '') ||
			absUrl($('img.wp-post-image').attr('src') || '');

		let description =
			cleanText($('meta[property="og:description"]').attr('content') || '') ||
			cleanText($('.story__summary, .content-section').first().text());

		// Authors
		const authors: string[] = [];
		$('.story__author a, a[href*="/author/"], .chapter__author a').each((_, a) => {
			const n = cleanText($(a).text());
			if (n && n.length < 60 && !authors.includes(n)) authors.push(n);
		});
	
		if (!authors.length) {
			const m = html.match(/dc:creator[^>]*>([^<]+)/i);
		}
		$('[rel="author"], .author').each((_, el) => {
			const n = cleanText($(el).text());
			if (n && n.length < 60 && !authors.includes(n)) authors.push(n);
		});

		const genres: string[] = [];
		$('a[href*="/genre"], a[href*="/tag/"], .card__tag-list a, .story__tax a').each(
			(_, a) => {
				const g = cleanText($(a).text());
				if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
			}
		);

		const statusText =
			$('.story__status').text() || $('.card__footer-status').text() || $('body').text();
		const status = /completed|complete/i.test(statusText)
			? 'Completed'
			: /hiatus|dropped/i.test(statusText)
				? 'Hiatus'
				: 'Ongoing';

		const chapters = this.parseChapterList($, pathOnly(path));
		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));
		const latestChapter = chapters.length > 0 ? chapters.length : undefined;

		return {
			id: pathOnly(path),
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
			...(latestChapter != null ? { latestChapter } : {})
		};
	}

	private parseChapterList($: cheerio.CheerioAPI, storyPath: string): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();
		let idx = 0;

		$('.chapter-group__list-item, li[class*="chapter-group"]').each((_, li) => {
			const el = $(li);
			const a = el.find('a.chapter-group__list-item-link, a[href*="/story/"]').first();
			const href = a.attr('href') || '';
			if (!href) return;

			let id = pathOnly(href);
			if (href.includes('post_type=fcn_chapter') || href.includes('?p=')) {
				id = href.replace(BASE, '').split('#')[0];
				if (!id.startsWith('/')) id = `/${id}`;
			}

			if (seen.has(id)) return;
			if (id === storyPath) return;

			const raw = cleanText(decodeEntities(a.text() || a.attr('title') || ''));
			if (!raw || raw.length < 2) return;

			const cls = el.attr('class') || '';
			const locked =
				/(?:^|\s)_premium(?:\s|$)/.test(cls) ||
				el.children('i.fa-lock, i[class*="fa-lock"]').length > 0 ||
				el.find('> .fa-lock, > i.fa-lock').length > 0;

			const dateUnix = el.find('time[datetime]').attr('datetime');
			let date: string | undefined;
			if (dateUnix && /^\d+$/.test(dateUnix)) {
				const d = new Date(parseInt(dateUnix, 10) * 1000);
				if (!Number.isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
			} else {
				const t = cleanText(el.find('time, .chapter-group__list-item-date').text());
				if (/\d{4}/.test(t)) {
					const parsed = Date.parse(t);
					if (!Number.isNaN(parsed)) date = new Date(parsed).toISOString().slice(0, 10);
				}
			}

			idx += 1;
			const num = parseChapterNumber(raw, idx);

			seen.add(id);
			out.push({
				id,
				title: shortChapterTitle(num, raw),
				number: num,
				...(date ? { date } : {}),
				...(locked ? { isLocked: true } : {})
			});
		});

		if (out.length < 2) {
			$('a[href*="/story/"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				if (!isChapterPath(href) && !href.includes('fcn_chapter')) return;
				const id = pathOnly(href);
				if (seen.has(id) || id === storyPath) return;
				const raw = cleanText($(a).text());
				if (!raw || raw.length < 2) return;
				seen.add(id);
				idx += 1;
				const num = parseChapterNumber(raw, idx);
				out.push({
					id,
					title: shortChapterTitle(num, raw),
					number: num
				});
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
		let path = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
		const url = path.startsWith('http')
			? path
			: path.includes('?')
				? `${BASE}${path}`
				: `${BASE}${path}${path.endsWith('/') ? '' : '/'}`;

		const html = await this.fetchHtml(url);
		const $ = cheerio.load(html);

		const rawTitle = cleanText(
			$('.chapter__title, h1').first().text() ||
				$('meta[property="og:title"]').attr('content')?.split(/[–|-]/)[0] ||
				$('title').text().split(/[–|-]/)[0] ||
				'Chapter'
		);
		const num = parseChapterNumber(rawTitle, 0);
		const title = shortChapterTitle(num, rawTitle);
		const bodyText = $('body').text().toLowerCase();
		const locked =
			bodyText.includes('this chapter is locked') ||
			bodyText.includes('subscribers only') ||
			bodyText.includes('unlock this chapter') ||
			($('.fa-lock').length > 0 && !$('.chapter__content').text().trim());

		if (locked) {
			return {
				title,
				content:
					'<p>This chapter is premium / locked on Drowsic.</p>',
				prevChapterId: null,
				nextChapterId: null
			};
		}

		const contentEl = $(
			'.chapter__content, #chapter-content, [data-fictioneer-chapter-target="content"]'
		).first();
		contentEl
			.find('script, style, noscript, .ads, .ad, nav, .chapter-index, .chapter__actions')
			.remove();

		const parts: string[] = [];
		contentEl.find('p, h2, h3, blockquote').each((_, el) => {
			const tag = ((el as any).tagName || (el as any).name || '').toLowerCase();
			const t = cleanText(decodeEntities($(el).text()));
			if (!t || t.length < 1) return;
			if (/^advertisement|^share this|^leave a reply/i.test(t)) return;
			if (tag === 'h2' || tag === 'h3') {
				parts.push(`<h3>${escapeHtml(t)}</h3>`);
			} else {
				parts.push(`<p>${escapeHtml(t)}</p>`);
			}
		});

		let content = parts.join('\n');
		if (!content || content.length < 40) {
			const raw = contentEl.html() || '';
			if (raw.length > 40) {
				content = raw;
			} else {
				content = '<p>Content not available.</p>';
			}
		}

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		$('a[rel="prev"], a[class*="prev"], .chapter__actions a').each((_, a) => {
			const t = cleanText($(a).text()).toLowerCase();
			const href = $(a).attr('href') || '';
			if (!href.includes('/story/')) return;
			const id = pathOnly(href);
			if (!isChapterPath(href) && !href.includes('fcn_chapter')) return;
			if (/prev|previous|←|«|older/i.test(t) || $(a).attr('rel') === 'prev') {
				prevChapterId = id;
			}
		});
		$('a[rel="next"], a[class*="next"], .chapter__actions a').each((_, a) => {
			const t = cleanText($(a).text()).toLowerCase();
			const href = $(a).attr('href') || '';
			if (!href.includes('/story/')) return;
			const id = pathOnly(href);
			if (!isChapterPath(href) && !href.includes('fcn_chapter')) return;
			if (/next|→|»|newer/i.test(t) || $(a).attr('rel') === 'next') {
				nextChapterId = id;
			}
		});

		if (!nextChapterId || !prevChapterId) {
			$('a[href*="/story/"]').each((_, a) => {
				const href = ($(a).attr('href') || '').split('#')[0];
				const t = cleanText($(a).text()).toLowerCase();
				if (!isChapterPath(href)) return;
				const id = pathOnly(href);
				if (!prevChapterId && /prev|previous|←/i.test(t)) prevChapterId = id;
				if (!nextChapterId && /next|→/i.test(t)) nextChapterId = id;
			});
		}

		return {
			title,
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default DrowsicSource;
