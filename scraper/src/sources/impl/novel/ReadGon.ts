/**
 * ReadGon (readgon.com) — Fictioneer / WordPress novel site
 * Path: scraper/src/sources/impl/novel/ReadGon.ts
 *
 * - Latest: /stories/ & /stories/page/{n}/ (sorted Updated)
 * - Novel: /story/{slug}/
 * - Chapters: ol.chapter-group__list li[data-post-id]
 * - Content: /wp-json/wp/v2/fcn_chapter/{postId}
 * - Cover: wp-content/uploads / .wp-post-image
 * - Paywall: li with lock/password/premium classes or text
 * - Search: /?s={q}
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://readgon.com';
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
		return (u.pathname.replace(/\/$/, '') || '/') + (u.search || '');
	} catch {
		return href.startsWith('/') ? href.replace(/\/$/, '') : `/${href}`;
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

function isStoryPath(id: string): boolean {
	return /^\/story\/[a-z0-9\-]+$/i.test(id.split('?')[0]);
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
				!/logo|icon|sprite|avatar|emoji|gravatar/i.test(String(v))
			) {
				const url = absUrl(String(v).split('?')[0]);
				if (/wp-content\/uploads|wp-post-image/i.test(url + (a.class || ''))) {
					best = url;
					return false;
				}
				if (!best) best = url;
			}
		}
	});
	return best;
}

function parseChapterNumber(text: string, href = ''): number {
	const src = `${text} ${href}`;
	const m =
		src.match(/(?:chapter|ch\.?)\s*[.:\-]?\s*(\d+(?:\.\d+)?)/i) ||
		src.match(/\/chapter-(\d+)/i) ||
		src.match(/\bch\.?\s*(\d+)/i);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return 0;
}

export class ReadGonSource extends BaseSource {
	id = 'readgon';
	name = 'ReadGon';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	// ─── Latest (stories list, Updated) ──────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		const pageNum = Math.max(1, page);
		const path =
			pageNum <= 1 ? '/stories/' : `/stories/page/${pageNum}/`;
		try {
			const html = await this.fetchHtml(path);
			const list = this.parseStoryCards(html);
			if (pageNum <= 1 && list.length < PER_PAGE) {
				try {
					const html2 = await this.fetchHtml('/stories/page/2/');
					const more = this.parseStoryCards(html2);
					const seen = new Set(list.map((m) => m.id));
					for (const m of more) {
						if (seen.has(m.id)) continue;
						seen.add(m.id);
						list.push(m);
						if (list.length >= PER_PAGE) break;
					}
				} catch {
				}
			}
			return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[readgon] getLatestManga', e);
			return [];
		}
	}

	private parseStoryCards(html: string): Manga[] {
		const $ = cheerio.load(html);
		$('script, style, noscript').remove();
		const ordered: Manga[] = [];
		const seen = new Set<string>();

		$('li.card, .card._story, article.card, .post-item').each((_, el) => {
			const $card = $(el);
			const $a = $card
				.find('a[href*="/story/"]')
				.filter((_, a) => {
					const id = pathOnly($(a).attr('href') || '').split('?')[0];
					return isStoryPath(id);
				})
				.first();
			if (!$a.length) return;
			const id = pathOnly($a.attr('href') || '').split('?')[0];
			if (!isStoryPath(id) || seen.has(id)) return;

			let title =
				cleanText($card.find('.card__title, h3, h2, h4').first().text()) ||
				cleanText($a.attr('title') || '') ||
				cleanText($a.text());
			if (!title || title.length < 2) return;
			if (/^(start reading|read more|view all)$/i.test(title)) return;
			if (title.length > 180) title = title.slice(0, 180);

			const cover = extractImg($card);

			let latestChapter: number | undefined;
			const foot = cleanText($card.find('.card__footer, .card__footer-box').text());
			const cm =
				foot.match(/(\d+)\s*(?:ch|chapters?)/i) ||
				cleanText($card.text()).match(/(\d+)\s*chapters?/i);
			if (cm) latestChapter = parseInt(cm[1], 10);

			let updatedAt: number | undefined;
			const dateText =
				cleanText($card.find('.card__footer-modified-date').text()) ||
				cleanText($card.find('time').attr('datetime') || '') ||
				foot;
			const iso = dateText.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
			if (iso) {
				const parsed = Date.parse(iso[1] + 'T00:00:00Z');
				if (!Number.isNaN(parsed)) updatedAt = parsed;
			} else {
				const dm = dateText.match(
					/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+'?\d{2,4})\b/i
				);
				if (dm) {
					const ds = dm[1].replace(/'(\d{2})$/, '20$1');
					const parsed = Date.parse(ds);
					if (!Number.isNaN(parsed)) updatedAt = parsed;
				}
			}

			let status: string | undefined;
			if (
				/_ongoing|ongoing/i.test(
					$card.find('.card__footer-status').attr('class') || ''
				) ||
				/\bOngoing\b/i.test(foot)
			) {
				status = 'Ongoing';
			} else if (/\bCompleted\b/i.test(foot)) {
				status = 'Completed';
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
		});

		if (ordered.length < 5) {
			$('a[href*="/story/"]').each((_, el) => {
				const href = $(el).attr('href') || '';
				const id = pathOnly(href).split('?')[0];
				if (!isStoryPath(id) || seen.has(id)) return;
				const $el = $(el);
				const $card = $el.closest('li, article, .card, div');
				let title =
					cleanText($el.find('h2, h3, h4').first().text()) ||
					cleanText($card.find('h2, h3, h4').first().text()) ||
					cleanText($el.attr('title') || '') ||
					cleanText($el.text());
				if (!title || title.length < 3) return;
				if (/^(start reading|read more|view all|hot|free|trending)/i.test(title)) return;
				if (title.length > 180) title = title.slice(0, 180);
				const cover = extractImg($card) || extractImg($el);
				seen.add(id);
				ordered.push({
					id,
					title,
					cover,
					sourceId: this.id,
					type: 'novel',
					lang: 'en'
				});
			});
		}

		return ordered;
	}

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page ?? 1);
		if (!q) return this.getLatestManga(page);

		const path =
			page <= 1
				? `/?s=${encodeURIComponent(q)}`
				: `/?s=${encodeURIComponent(q)}&paged=${page}`;
		try {
			const html = await this.fetchHtml(path);
			return this.parseStoryCards(html).slice(0, PER_PAGE);
		} catch (e) {
			console.error('[readgon] search', e);
			return [];
		}
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = pathOnly(mangaId).split('?')[0];
		if (!path.startsWith('/story/')) {
			path = `/story/${path.replace(/^\//, '')}`;
		}

		const fetchPath = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(fetchPath);
		const $ = cheerio.load(html);

		const title =
			cleanText($('h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '') ||
			'';
		if (!title || title.length < 2) {
			throw new Error('Novel not found');
		}

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('img.wp-post-image').first().attr('src') ||
			$('img[src*="uploads"]').first().attr('src') ||
			'';
		cover = absUrl(String(cover).split('?')[0]);

		let description = '';
		const $desc = $(
			'.story-content, .description, .summary, .post-content, .entry-content, .story__content'
		).first();
		if ($desc.length) {
			$desc.find('script, style, noscript').remove();
			description = cleanText($desc.text()).slice(0, 4000);
		}
		if (description.length < 40) {
			$('p').each((_, el) => {
				const t = cleanText($(el).text());
				if (t.length > 80 && !description) description = t.slice(0, 4000);
			});
		}

		const authors: string[] = [];
		$('a.author, a[href*="/author/"]').each((_, a) => {
			const n = cleanText($(a).text());
			if (n && n.length < 80 && !authors.includes(n) && !/readgon/i.test(n)) {
				authors.push(n);
			}
		});

		if (!authors.length) {
			$('a.author').each((_, a) => {
				const n = cleanText($(a).text());
				if (n && !authors.includes(n)) authors.push(n);
			});
		}

		const genres: string[] = [];
		$('a.tag-pill._genre, a[href*="/genre/"]').each((_, a) => {
			const n = cleanText($(a).text());
			if (n && n.length < 40 && !genres.includes(n)) genres.push(n);
		});

		let status = 'Ongoing';
		const stText =
			cleanText($('.story__status, .card__footer-status').first().text()) ||
			cleanText($('body').text()).slice(0, 3000);
		if (/\bCompleted\b/i.test(stText)) status = 'Completed';
		else if (/\bHiatus\b/i.test(stText)) status = 'Hiatus';
		else if (/\bOngoing\b/i.test(stText)) status = 'Ongoing';

		const chapters = this.parseChapterList($, path);

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

	private parseChapterList($: any, storyPath: string): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		$('ol.chapter-group__list li, .chapter-group__list-item').each(
			(_: number, el: any) => {
				const $li = $(el);
				const $a = $li.find('a[href]').first();
				if (!$a.length) return;

				const href = $a.attr('href') || '';
				const id = pathOnly(href);
				const chapterId = id.split('?')[0];
				if (seen.has(chapterId)) return;
				if (!/\/story\//i.test(chapterId)) return;

				const postId = $li.attr('data-post-id') || '';
				const text = cleanText($li.text());
				const number = parseChapterNumber(text, href);
				if (number <= 0 && !postId) return;

				const cls = ($li.attr('class') || '').toLowerCase();
				const isLocked =
					/\block|\bpassword|\bpremium|\bcoin|\bpaywall|\bfuture\b/.test(cls) ||
					/\b(locked|premium|coins?|password)\b/i.test(text) ||
					!!$li.find('.icon-lock, .fa-lock, [class*="lock"]').length;

				let date: string | undefined;
				const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
				if (iso) {
					date = new Date(iso[1] + 'T00:00:00Z').toISOString();
				} else {
					const dm = text.match(
						/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+'?\d{2,4})\b/i
					);
					if (dm) {
						const ds = dm[1].replace(/'(\d{2})$/, '20$1');
						const parsed = Date.parse(ds);
						if (!Number.isNaN(parsed)) date = new Date(parsed).toISOString();
					}
				}

				const finalId = postId
					? `${chapterId}?pid=${postId}`
					: chapterId;

				seen.add(chapterId);
				out.push({
					id: finalId,
					title: `Chapter ${number || out.length + 1}`,
					number: number || out.length + 1,
					date,
					isLocked
				});
			}
		);

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
		const raw = String(chapterId);
		const path = pathOnly(raw).split('?')[0];
		const fetchPath = path.endsWith('/') ? path : `${path}/`;
		const pidMatch = raw.match(/[?&]pid=(\d+)/);
		let postId = pidMatch ? pidMatch[1] : '';

		const html = await this.fetchHtml(fetchPath);
		const $page = cheerio.load(html);

		if (!postId) {
			const m =
				html.match(/\/wp-json\/wp\/v2\/fcn_chapter\/(\d+)/) ||
				html.match(/data-post-id=["'](\d+)["']/);
			if (m) postId = m[1];
		}

		// Prev / Next from Fictioneer nav buttons
		const resolveNav = (sel: string): string | null => {
			const href = $page(sel).first().attr('href') || '';
			if (!href || !/\/story\//i.test(href)) return null;
			const id = pathOnly(href).split('?')[0];
			return id || null;
		};
		let prevChapterId =
			resolveNav('a._navigation._prev, a._navigation._previous, a.micro-menu__previous, a.micro-menu__prev, a.button._prev') ||
			resolveNav('a[rel="prev"]');
		let nextChapterId =
			resolveNav('a._navigation._next, a.micro-menu__next, a.button._next') ||
			resolveNav('a[rel="next"]');

		if (!prevChapterId || !nextChapterId) {
			$page('a[href*="/story/"]').each((_, el) => {
				const href = $page(el).attr('href') || '';
				const id = pathOnly(href).split('?')[0];
				if (!/\/story\/[^/]+\/.+/i.test(id)) return;
				const cls = ($page(el).attr('class') || '').toLowerCase();
				const label = cleanText($page(el).text()).toLowerCase();
				if (!prevChapterId && (/_prev/.test(cls) || /previous|^prev$/i.test(label))) {
					prevChapterId = id;
				}
				if (!nextChapterId && (/_next/.test(cls) || /^next$/i.test(label))) {
					nextChapterId = id;
				}
			});
		}

		if (!postId) {
			throw new Error(`Cannot resolve chapter post id for ${chapterId}`);
		}

		let contentHtml = '';
		let title = '';
		try {
			const jsonText = await this.fetchHtml(
				`/wp-json/wp/v2/fcn_chapter/${postId}`
			);
			const data = JSON.parse(jsonText);
			contentHtml = data?.content?.rendered || '';
			title = cleanText(data?.title?.rendered || '');
			if (data?.content?.protected) {
				throw new Error('Chapter is protected/locked');
			}
		} catch (e) {
			const $c = $page(
				'.chapter-content, #chapter-content, .content-section, article .post-content, .entry-content'
			).first();
			$c.find('script, style, noscript').remove();
			contentHtml = $c.html() || '';
			if (!title) title = cleanText($page('h1').first().text());
		}

		const $c = cheerio.load(contentHtml || '');
		$c('script, style, noscript').remove();
		const paragraphs: string[] = [];
		$c('p').each((_, el) => {
			const t = cleanText($c(el).text());
			if (t) paragraphs.push(`<p>${escapeHtml(t)}</p>`);
		});
		let content = paragraphs.join('');
		if (!content || content.length < 40) {
			const plain = cleanText($c.root().text());
			if (plain.length > 40) {
				content = plain
					.split(/\n{2,}/)
					.map((p) => cleanText(p))
					.filter(Boolean)
					.map((p) => `<p>${escapeHtml(p)}</p>`)
					.join('');
			}
		}
		if (!content || content.length < 40) {
			throw new Error(`Chapter content empty or locked (pid=${postId})`);
		}

		const number = parseChapterNumber(title || path);

		return {
			title: number > 0 ? `Chapter ${number}` : title || 'Chapter',
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default ReadGonSource;
