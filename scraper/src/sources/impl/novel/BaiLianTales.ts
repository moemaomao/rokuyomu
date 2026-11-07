/**
 * BaiLianTales (bailiantales.com) — WordPress novel site
 * Path: scraper/src/sources/impl/novel/BaiLianTales.ts
 *
 * - Latest: / and /page/{n}/
 * - Novel: /novel/{slug}/
 * - Chapter: /novel/{slug}/chapter-{n}/
 * - Content: .reading-content / .text-left / .entry-content / article
 * - Search: /?s=
 * - Chapter title: "Chapter N"
 * - Site has anti-bot; BaseSource.fetchHtml / CF helpers handle it
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://bailiantales.com';
const PER_PAGE = 24;

function absUrl(href: string | undefined | null): string {
	if (!href) return '';
	const h = String(href).trim();
	if (!h || h === '#') return '';
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
	return /^\/novel\/[a-z0-9\-]+\/chapter-[\d.]+/i.test(id);
}

function parseChapterNumber(text: string): number {
	const m =
		text.match(/\/chapter-([\d.]+)/i) ||
		text.match(/(?:chapter|ch\.?)\s*[.:\-]?\s*([\d.]+)/i);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return 0;
}

function extractImg($el: any): string {
	if (!$el || !$el.find) return '';
	let best = '';
	$el.find('img').each((_: number, el: any) => {
		const a = (el as any).attribs || {};
		for (const key of ['data-src', 'data-lazy-src', 'data-bg', 'src']) {
			const v = a[key];
			if (
				v &&
				!String(v).startsWith('data:') &&
				!/logo|icon|sprite|avatar|emoji|gravatar|placeholder/i.test(String(v))
			) {
				const url = absUrl(String(v).split('?')[0]);
				if (/wp-content\/uploads|cover/i.test(url)) {
					best = url;
					return false;
				}
				if (!best) best = url;
			}
		}
	});
	return best;
}

export class BaiLianTalesSource extends BaseSource {
	id = 'bailiantales';
	name = 'BaiLianTales';
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
		const path = pageNum <= 1 ? '/' : `/page/${pageNum}/`;
		try {
			const html = await this.fetchHtml(path);
			return this.parseNovelCards(html).slice(0, PER_PAGE);
		} catch (e) {
			console.error('[bailiantales] getLatestManga', e);
			return [];
		}
	}

	private parseNovelCards(html: string): Manga[] {
		const $ = cheerio.load(html);
		const ordered: Manga[] = [];
		const seen = new Set<string>();
		const coverById = new Map<string, string>();
		const imgRe =
			/(?:src|data-src|data-lazy-src|data-bg)=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi;
		let im: RegExpExecArray | null;
		const allImgs: { idx: number; url: string }[] = [];
		while ((im = imgRe.exec(html))) {
			const url = absUrl(im[1].split('?')[0]);
			if (/logo|icon|sprite|avatar|emoji|gravatar|placeholder/i.test(url)) continue;
			allImgs.push({ idx: im.index, url });
		}
	
		const linkRe = /href=["']([^"']*\/novel\/[a-z0-9\-]+\/?)["']/gi;
		let lm: RegExpExecArray | null;
		while ((lm = linkRe.exec(html))) {
			const id = pathOnly(lm[1]);
			if (!isNovelPath(id) || coverById.has(id)) continue;
			let best = '';
			let bestDist = 99999;
			for (const img of allImgs) {
				const dist = lm.index - img.idx;
				if (dist >= 0 && dist < bestDist && dist < 1500) {
					bestDist = dist;
					best = img.url;
				}
			}
			if (best) coverById.set(id, best);
		}

		const addCard = (
			id: string,
			title: string,
			$card: any,
			extraText = ''
		) => {
			if (!isNovelPath(id) || seen.has(id)) return;
			title = title.replace(/^(COMPLETED|18\+|ONGOING)\s+/i, '').trim();
			if (!title || title.length < 2) return;
			if (/^(most read|novels|recently added|home|chapter\s)/i.test(title)) return;

			const cardText = cleanText(($card?.text?.() || '') + ' ' + extraText);
			let cover =
				extractImg($card) ||
				coverById.get(id) ||
				'';

			let latestChapter: number | undefined;
			const cm = cardText.match(/Chapter\s+([\d.]+)/i);
			if (cm) latestChapter = parseFloat(cm[1]);

			let status: string | undefined;
			if (/COMPLETED/i.test(cardText)) status = 'Completed';
			else if (/ONGOING|OnGoing/i.test(cardText)) status = 'Ongoing';

			let updatedAt: number | undefined;
			const dm = cardText.match(
				/\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\b/i
			);
			if (dm) {
				const parsed = Date.parse(dm[1]);
				if (!Number.isNaN(parsed)) updatedAt = parsed;
			} else {
				const rel = cardText.match(
					/\b(\d+)\s+(second|minute|hour|day|week|month)s?\s+ago\b/i
				);
				if (rel) {
					const n = parseInt(rel[1], 10);
					const unit = rel[2].toLowerCase();
					const mult: Record<string, number> = {
						second: 1e3,
						minute: 6e4,
						hour: 36e5,
						day: 864e5,
						week: 6048e5,
						month: 2592e6
					};
					updatedAt = Date.now() - n * (mult[unit] || 0);
				}
			}

			seen.add(id);
			ordered.push({
				id,
				title: title.slice(0, 200),
				cover,
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status,
				...(latestChapter != null ? { latestChapter } : {}),
				...(updatedAt != null ? { updatedAt } : {})
			});
		};

		$('h2 a[href*="/novel/"], h3 a[href*="/novel/"], .post-title a[href*="/novel/"]').each(
			(_, el) => {
				const href = $(el).attr('href') || '';
				const id = pathOnly(href);
				const $card = $(el).closest('article, li, .post, .item, .page-item-detail, div');
				addCard(id, cleanText($(el).text()), $card);
			}
		);

		if (ordered.length < 5) {
			$('a[href*="/novel/"]').each((_, el) => {
				const href = $(el).attr('href') || '';
				const id = pathOnly(href);
				if (!isNovelPath(id)) return;
				const title = cleanText($(el).text());
				if (/^chapter\s+[\d.]+$/i.test(title)) return;
				const $card = $(el).closest('article, li, div');
				addCard(id, title, $card);
			});
		}

		return ordered;
	}

	private async postForm(url: string, body: string): Promise<string> {
		const abs = url.startsWith('http') ? url : `${BASE}${url.startsWith('/') ? url : `/${url}`}`;
		const res = await (globalThis as any).fetch(abs, {
			method: 'POST',
			headers: {
				...this.headers,
				'Content-Type': 'application/x-www-form-urlencoded',
				'X-Requested-With': 'XMLHttpRequest',
				Referer: `${BASE}/`
			},
			body
		});
		return await res.text();
	}

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page ?? 1);
		if (!q) return this.getLatestManga(page);

		const path =
			page <= 1
				? `/?s=${encodeURIComponent(q)}`
				: `/page/${page}/?s=${encodeURIComponent(q)}`;
		try {
			const html = await this.fetchHtml(path);
			const list = this.parseNovelCards(html);
			if (list.length) return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[bailiantales] search', e);
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
		const fetchPath = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(fetchPath);
		const $ = cheerio.load(html);

		const title =
			cleanText($('h1').first().text()) ||
			cleanText($('.post-title h1, .entry-title').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '')
				.replace(/\s*[–\-]\s*BaiLianTales.*$/i, '')
				.trim();
		if (!title || title.length < 2) throw new Error('Novel not found');

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('.summary_image img, .thumb img, img.wp-post-image').first().attr('src') ||
			$('img[src*="wp-content"]').first().attr('src') ||
			'';
		cover = absUrl(String(cover).split('?')[0]);

		let description = '';
		const $sum = $(
			'.summary__content, .description-summary, .manga-excerpt, #editdescription, .entry-content'
		).first();
		if ($sum.length) {
			$sum.find('script, style, noscript').remove();
			description = cleanText($sum.text()).slice(0, 4000);
		}
		
		const body = cleanText($('body').text());
		const syn = body.match(/Synopsis:\s*([\s\S]{40,2000}?)(?:One-sentence|Theme:|Show more|MANGA DISCUSSION)/i);
		if (syn && syn[1].length > description.length) {
			description = cleanText(syn[1]).slice(0, 4000);
		}
		if (description.length < 40) {
			$('p').each((_, el) => {
				const t = cleanText($(el).text());
				if (t.length > 80 && !description) description = t.slice(0, 4000);
			});
		}

		const authors: string[] = [];
		$('a[href*="/author/"], .author-content a, .artist-content a').each((_, a) => {
			const n = cleanText($(a).text());
			if (n && n.length < 80 && !authors.includes(n)) authors.push(n);
		});

		const genres: string[] = [];
		$('a[href*="/genre/"], .genres-content a, a[rel="tag"]').each((_, a) => {
			const n = cleanText($(a).text());
			if (n && n.length < 40 && !genres.includes(n) && n !== ',') genres.push(n);
		});

		let status = 'Ongoing';
		const st =
			cleanText($('.post-status .summary-content, .status').first().text()) ||
			body.slice(0, 2000);
		if (/\bCompleted\b/i.test(st)) status = 'Completed';
		else if (/\bHiatus\b/i.test(st)) status = 'Hiatus';
		else if (/\bOnGoing|Ongoing\b/i.test(st)) status = 'Ongoing';

		let chapters = this.parseChapterListHtml($, path, html);

		if (chapters.length < 5) {
			try {
				const ajaxCh = await this.fetchChaptersAjax(path, html);
				if (ajaxCh.length > chapters.length) chapters = ajaxCh;
			} catch (e) {
				console.error('[bailiantales] ajax chapters', e);
			}
		}

		if (chapters.length < 2) {
			const cm =
				html.match(/#####\s*Chapters\s*(\d+)/i) ||
				html.match(/Chapters?\s*[:：]?\s*(\d+)/i);
			if (cm) {
				const total = parseInt(cm[1], 10);
				chapters = [];
				for (let i = total; i >= 1; i--) {
					chapters.push({
						id: `${path}/chapter-${i}`,
						title: `Chapter ${i}`,
						number: i,
						isLocked: false
					});
				}
			}
		}

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

	private async fetchChaptersAjax(
		novelPath: string,
		pageHtml: string
	): Promise<Chapter[]> {
		
		const idMatch =
			pageHtml.match(
				/id=["']manga-chapters-holder["'][^>]*data-id=["'](\d+)["']/i
			) ||
			pageHtml.match(
				/data-id=["'](\d+)["'][^>]*id=["']manga-chapters-holder["']/i
			) ||
			pageHtml.match(/data-id=["'](\d+)["']/);
		const mangaId = idMatch?.[1] || '';

		let listHtml = '';
		
		try {
			const ajaxPath = novelPath.endsWith('/')
				? `${novelPath}ajax/chapters/`
				: `${novelPath}/ajax/chapters/`;
			listHtml = await this.postForm(ajaxPath, '');
		} catch {
		}

		if (!listHtml || listHtml.length < 80 || !/chapter/i.test(listHtml)) {
			if (mangaId) {
				listHtml = await this.postForm(
					'/wp-admin/admin-ajax.php',
					`action=manga_get_chapters&manga=${encodeURIComponent(mangaId)}`
				);
			}
		}

		if (!listHtml || listHtml.length < 40) return [];
		return this.parseChapterListHtml(cheerio.load(listHtml), novelPath, listHtml);
	}

	private parseChapterListHtml(
		$: any,
		novelPath: string,
		html: string
	): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		const selectors = [
			'li.wp-manga-chapter a',
			'.listing-chapters_wrap a',
			'.eplister a',
			'ul.main a[href*="/chapter"]',
			`a[href*="${novelPath}/chapter-"]`,
			'a[href*="/chapter-"]'
		];

		for (const sel of selectors) {
			$(sel).each((_: number, el: any) => {
				const href = $(el).attr('href') || '';
				if (!href || href === '#') return;
				const id = pathOnly(href.split('?')[0]);
				if (!/\/chapter-[\d.]+/i.test(id)) return;
				if (seen.has(id)) return;

				const number =
					parseChapterNumber(id) ||
					parseChapterNumber(cleanText($(el).text()));
				if (number <= 0) return;

				const $row = $(el).closest('li, tr, div');
				const rowText = cleanText($row.text());
				const isLocked =
					/\block|\bpremium|\bcoin|\bpaid/i.test(
						($row.attr('class') || '') + rowText
					) || !!$row.find('.fa-lock, .icon-lock').length;

				let date: string | undefined;
				const dateEl = cleanText(
					$row.find('.chapter-release-date, i, time').first().text()
				);
				const dm = (dateEl || rowText).match(
					/\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\b/i
				);
				if (dm) {
					const parsed = Date.parse(dm[1]);
					if (!Number.isNaN(parsed)) date = new Date(parsed).toISOString();
				}

				seen.add(id);
				out.push({
					id,
					title: `Chapter ${number}`,
					number,
					date,
					isLocked
				});
			});
			if (out.length > 3) break;
		}

		if (out.length < 2) {
			const re = new RegExp(
				`${novelPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/chapter-([\\d.]+)/`,
				'gi'
			);
			let m: RegExpExecArray | null;
			while ((m = re.exec(html))) {
				const number = parseFloat(m[1]);
				if (Number.isNaN(number)) continue;
				const id = `${novelPath}/chapter-${m[1]}`;
				if (seen.has(id)) continue;
				seen.add(id);
				out.push({
					id,
					title: `Chapter ${number}`,
					number,
					isLocked: false
				});
			}
		}

		out.sort((a, b) => b.number - a.number);
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
		let path = pathOnly(chapterId);
		if (!path.includes('/chapter-')) {
			throw new Error(`Invalid chapter id: ${chapterId}`);
		}
		const fetchPath = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(fetchPath);
		const $ = cheerio.load(html);
		const number = parseChapterNumber(path);

		let $content = $(
			'.reading-content, .text-left, .entry-content .text-left, #chapter-content, .chapter-content, article .entry-content'
		).first();
		if (!$content.length) {
			$content = $('article, .post-content, main').first();
		}
		$content.find('script, style, noscript, nav, .ads, .code-block').remove();

		const paragraphs: string[] = [];
		$content.find('p').each((_, el) => {
			const t = cleanText($(el).text());
			if (
				t &&
				!/^(previous|next|table of contents|leave a reply)/i.test(t) &&
				t.length > 1
			) {
				paragraphs.push(t);
			}
		});

		let content = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
		if (!content || content.length < 40) {
			const plain = cleanText($content.text());
			if (plain.length > 40) {
				content = plain
					.split(/\n{2,}/)
					.map((p) => cleanText(p))
					.filter((p) => p.length > 0)
					.map((p) => `<p>${escapeHtml(p)}</p>`)
					.join('');
			}
		}
		if (!content || content.length < 40) {
			throw new Error(`Chapter ${number} empty or protected`);
		}

		// Prev / Next
		const novelBase = path.replace(/\/chapter-[\d.]+$/i, '');
		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		$('a[href*="/chapter-"]').each((_, el) => {
			const href = pathOnly($(el).attr('href') || '');
			const label = cleanText($(el).text()).toLowerCase();
			const cls = ($(el).attr('class') || '').toLowerCase();
			if (!href.includes('/chapter-')) return;
			if (!prevChapterId && (/prev/i.test(label) || /prev/i.test(cls))) {
				prevChapterId = href;
			}
			if (!nextChapterId && (/next/i.test(label) || /next/i.test(cls))) {
				nextChapterId = href;
			}
		});

		if (number > 1 && !prevChapterId) {
			const prevN = Number.isInteger(number) ? number - 1 : Math.floor(number);
			prevChapterId = `${novelBase}/chapter-${prevN}`;
		}
		if (!nextChapterId && number > 0) {
			const nextN = Number.isInteger(number) ? number + 1 : Math.ceil(number);
			nextChapterId = `${novelBase}/chapter-${nextN}`;
		}

		return {
			title: number > 0 ? `Chapter ${number}` : 'Chapter',
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default BaiLianTalesSource;
