/**
 * FreeWebNovel.com — Cloudflare-protected; use fetchWithCf / Byparr
 * Path: scraper/src/sources/impl/novel/FreeWebNovel.ts
 *
 * - Homepage Latest Release → max 24 judul
 * - Sort list: /sort/latest-release/{page}
 * - Novel: /novel/{slug}
 * - Chapter: /novel/{slug}/chapter-{n}
 * - Chapter list: #idData + ajax ?ajax=chapters&page=&pageSize=
 * - Search: /search?searchkey=
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types-manga';

const BASE = 'https://freewebnovel.com';
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
		const p = href.startsWith('/') ? href : `/${href}`;
		return p.replace(/\/$/, '') || '/';
	}
}

function cleanText(s: string): string {
	return (s || '')
		.replace(/\u00a0/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function decodeHtml(s: string): string {
	return (s || '')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#8217;|&rsquo;|&#39;/g, "'")
		.replace(/&#8220;|&ldquo;/g, '"')
		.replace(/&#8221;|&rdquo;/g, '"')
		.replace(/&#8211;|&ndash;/g, '–')
		.replace(/&#8212;|&mdash;/g, '—')
		.replace(/&nbsp;/g, ' ');
}

function stripHtml(html: string): string {
	return decodeHtml(
		(html || '')
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/p>/gi, '\n\n')
			.replace(/<\/div>/gi, '\n')
			.replace(/<[^>]+>/g, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function parseChapterNumber(text: string, fallback = 0): number {
	const t = cleanText(text);
	if (!t) return fallback;
	const pathM = t.match(/\/chapter-(\d+(?:\.\d+)?)/i);
	if (pathM) {
		const n = parseFloat(pathM[1]);
		if (!Number.isNaN(n)) return n;
	}
	const m =
		t.match(/(?:chapter|ch\.?|c)\s*[.:\-]?\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	if (/prologue/i.test(t)) return 0;
	return fallback;
}

function isNovelPath(id: string): boolean {
	return /^\/novel\/[^/]+$/i.test(id);
}

function isChapterPath(id: string): boolean {
	return /^\/novel\/[^/]+\/chapter-\d+/i.test(id);
}

function extractImg($el: any): string {
	if (!$el || !$el.find) return '';
	const candidates: string[] = [];

	$el.find('img').each((_: number, el: any) => {
		const attribs = (el as any).attribs || {};
		for (const key of [
			'data-src',
			'data-lazy-src',
			'data-original',
			'data-echo',
			'src'
		]) {
			const v = attribs[key];
			if (v) candidates.push(String(v));
		}
		if (attribs['srcset']) {
			const last = String(attribs['srcset']).split(',').pop();
			if (last) candidates.push(last.trim().split(/\s+/)[0]);
		}
	});

	$el.find('[style*="background"]').each((_: number, el: any) => {
		const style = ((el as any).attribs || {}).style || '';
		const m = style.match(/url\(['"]?([^'")\s]+)/);
		if (m) candidates.push(m[1]);
	});

	let best = '';
	for (const c of candidates) {
		if (
			!c ||
			c.startsWith('data:') ||
			/svg|sprite|icon|logo|placeholder|default|avatar/i.test(c)
		) {
			continue;
		}
		const url = absUrl(c.split('?')[0]);
		if (/\/files\/article\//i.test(url) || /\.(jpg|jpeg|png|webp)$/i.test(url)) {
			return url;
		}
		if (!best) best = url;
	}
	return best;
}

function parseRelativeDate(text: string): string | undefined {
	const t = cleanText(text);
	if (/just\s*now/i.test(t)) return new Date().toISOString();
	const m = t.match(
		/(\d+)\s*(min|mins|minute|minutes|hour|hours|day|days|week|weeks)\s*ago/i
	);
	if (!m) return undefined;
	const n = parseInt(m[1], 10);
	const unit = m[2].toLowerCase();
	const d = new Date();
	if (/min/.test(unit)) d.setMinutes(d.getMinutes() - n);
	else if (/hour/.test(unit)) d.setHours(d.getHours() - n);
	else if (/day/.test(unit)) d.setDate(d.getDate() - n);
	else if (/week/.test(unit)) d.setDate(d.getDate() - n * 7);
	return d.toISOString();
}

export class FreeWebNovelSource extends BaseSource {
	id = 'freewebnovel';
	name = 'FreeWebNovel';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	// ─── Latest ──────────────────────────────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		const pageNum = Math.max(1, page);
		if (pageNum <= 1) {
			const fromHome = await this.parseLatestHome().catch(() => [] as Manga[]);
			if (fromHome.length >= 8) return fromHome.slice(0, PER_PAGE);
			return this.fetchLatestSort(1);
		}
		return this.fetchLatestSort(pageNum);
	}

	private async parseLatestHome(): Promise<Manga[]> {
		const html = await this.fetchHtml('/home');
		const $ = cheerio.load(html);
		$('script, style, noscript, iframe').remove();
		$('.m-hot, .m-list-hot, aside, .right, #sidebar').remove();

		const ordered: Manga[] = [];
		const seen = new Set<string>();

		let $scope: any = null;
		$('h2, h3, .tit, .section-title').each((_, el) => {
			if (/latest\s*release/i.test(cleanText($(el).text()))) {
				$scope = $(el).parent();
				return false;
			}
		});
		const $root = $scope && $scope.length ? $scope : $('body');

		$root.find('a[href*="/novel/"]').each((_, el) => {
			const href = $(el).attr('href') || '';
			const id = pathOnly(href);
			if (!isNovelPath(id) || seen.has(id)) return;

			const title =
				cleanText($(el).attr('title') || '') || cleanText($(el).text());
			if (!title || title.length < 2) return;
			if (/^(see more|genres?|home|latest|hot)/i.test(title)) return;

			const $parent = $(el).closest('li, article, .item, .con, .txt, .ss-custom, div');
			let latestChapter: number | undefined;
			$parent.find('a[href*="/chapter-"]').each((__, a) => {
				const n = parseChapterNumber(
					($(a).attr('href') || '') + ' ' + cleanText($(a).text())
				);
				if (n > 0 && (latestChapter == null || n > latestChapter)) {
					latestChapter = n;
				}
			});
			if (latestChapter == null) {
				const cm = cleanText($parent.text()).match(/(\d+)\s*Chapters?/i);
				if (cm) latestChapter = parseInt(cm[1], 10);
			}

			let cover =
				extractImg($parent) ||
				extractImg($(el).parent()) ||
				extractImg($(el).parent().parent()) ||
				extractImg($(el));

			if (!cover) {
				const prevImg = $(el).closest('div').find('img').first();
				if (prevImg.length) {
					const src =
						prevImg.attr('data-src') ||
						prevImg.attr('src') ||
						'';
					if (src && !/icon|logo|sprite/i.test(src)) {
						cover = absUrl(src.split('?')[0]);
					}
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
				...(latestChapter != null ? { latestChapter } : {})
			});
		});

		return ordered.slice(0, PER_PAGE);
	}

	private async fetchLatestSort(page: number): Promise<Manga[]> {
		const path =
			page <= 1 ? '/sort/latest-release' : `/sort/latest-release/${page}`;
		try {
			const html = await this.fetchHtml(path);
			if (/just a moment|cf-browser-verification|challenge-platform/i.test(html)) {
				console.error('[freewebnovel] CF challenge on', path);
				return [];
			}
			const $ = cheerio.load(html);
			$('script, style, noscript').remove();
			$('.m-hot, .m-list-hot, aside, .right').remove();

			const ordered: Manga[] = [];
			const seen = new Set<string>();
			const $cards = $(
				'.col-content .ss-custom, .col-content .item, .col-content .con, .m-list li, .list-item'
			);
			if ($cards.length) {
				$cards.each((_, el) => {
					const $el = $(el);
					const a = $el
						.find('a[href*="/novel/"]')
						.filter((__, link) =>
							isNovelPath(pathOnly($(link).attr('href') || ''))
						)
						.first();
					const id = pathOnly(a.attr('href') || '');
					if (!isNovelPath(id) || seen.has(id)) return;
					const title =
						cleanText(a.attr('title') || '') ||
						cleanText($el.find('h3, h2, .tit').first().text()) ||
						cleanText(a.text());
					if (!title || title.length < 2) return;

					let latestChapter: number | undefined;
					const cm = cleanText($el.text()).match(/(\d+)\s*Chapters?/i);
					if (cm) latestChapter = parseInt(cm[1], 10);
					$el.find('a[href*="/chapter-"]').each((__, ch) => {
						const n = parseChapterNumber($(ch).attr('href') || '');
						if (n > 0 && (latestChapter == null || n > latestChapter)) {
							latestChapter = n;
						}
					});

					seen.add(id);
					ordered.push({
						id,
						title: title.slice(0, 200),
						cover: extractImg($el),
						sourceId: this.id,
						type: 'novel',
						lang: 'en',
						...(latestChapter != null ? { latestChapter } : {})
					});
				});
			}

			if (ordered.length < 4) {
				$('a[href*="/novel/"]').each((_, el) => {
					const href = $(el).attr('href') || '';
					const id = pathOnly(href);
					if (!isNovelPath(id) || seen.has(id)) return;
					const title =
						cleanText($(el).attr('title') || '') ||
						cleanText($(el).text());
					if (!title || title.length < 2) return;
					if (/^(see more|genres?|hot|completed)/i.test(title)) return;

					const $parent = $(el).closest(
						'li, article, .item, .con, .ss-custom, div'
					);
					let latestChapter: number | undefined;
					const cm = cleanText($parent.text()).match(/(\d+)\s*Chapters?/i);
					if (cm) latestChapter = parseInt(cm[1], 10);

					seen.add(id);
					ordered.push({
						id,
						title: title.slice(0, 200),
						cover: extractImg($parent) || extractImg($(el).parent()),
						sourceId: this.id,
						type: 'novel',
						lang: 'en',
						...(latestChapter != null ? { latestChapter } : {})
					});
				});
			}

			return ordered.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[freewebnovel] fetchLatestSort', page, e);
			return [];
		}
	}

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page ?? 1);
		if (!q) return this.getLatestManga(page);

		try {
			const html = await this.fetchHtml(
				`/search?searchkey=${encodeURIComponent(q)}`
			);
			const $ = cheerio.load(html);
			const ordered: Manga[] = [];
			const seen = new Set<string>();

			const $links = $(
				'.col-content .con .txt h3 a, .col-content a[href*="/novel/"], a[href*="/novel/"]'
			);
			$links.each((_, el) => {
				const href = $(el).attr('href') || '';
				const id = pathOnly(href);
				if (!isNovelPath(id) || seen.has(id)) return;
				const title =
					cleanText($(el).attr('title') || '') || cleanText($(el).text());
				if (!title || title.length < 2) return;
				const $parent = $(el).closest('.con, .item, li, .ss-custom, div');
				seen.add(id);
				ordered.push({
					id,
					title: title.slice(0, 200),
					cover: extractImg($parent) || extractImg($(el)),
					sourceId: this.id,
					type: 'novel',
					lang: 'en'
				});
			});

			return ordered.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[freewebnovel] search', e);
			return [];
		}
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = pathOnly(mangaId);
		if (!path.startsWith('/novel/')) {
			path = `/novel/${path.replace(/^\//, '')}`;
		}
		path = path.replace(/\/$/, '');

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			cleanText($('.m-desc h1.tit, h1.tit, h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content') || '')
				.split(/\s*[|\-–]\s*Free Web Novel/i)[0]
				.trim() ||
			'';

		if (!title || title.length < 2) {
			throw new Error('Novel not found (empty title)');
		}

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('.m-imgtxt img').first().attr('data-src') ||
			$('.m-imgtxt img').first().attr('src') ||
			$('.m-desc img').first().attr('src') ||
			'';
		cover = absUrl(String(cover).split('?')[0]);

		let description = '';
		const $sum = $('.m-desc .txt, .m-desc .inner, .summary').first();
		if ($sum.length) {
			description = stripHtml($sum.html() || $sum.text()).slice(0, 4000);
		}
		if (!description || description.length < 40) {
			description = cleanText(
				$('meta[name="description"]').attr('content') ||
					$('meta[property="og:description"]').attr('content') ||
					''
			);
		}
	
		description = description
			.replace(/^Read .+? online for free\.?\s*/i, '')
			.trim();

		const authors: string[] = [];
		$('.m-imgtxt a[href*="/authors/"], .m-desc a[href*="/authors/"]').each(
			(_, a) => {
				const n = cleanText($(a).text());
				if (n && n.length < 80 && !authors.includes(n)) authors.push(n);
			}
		);

		const genres: string[] = [];
		$(
			'.m-imgtxt a[href*="/genres/"], .m-imgtxt a[href*="/genre/"], .m-desc a[href*="/genre/"]'
		).each((_, a) => {
			const href = $(a).attr('href') || '';
			const n = cleanText($(a).text());
			if (
				n &&
				n.length < 40 &&
				!genres.includes(n) &&
				!/^(genres?|all)$/i.test(n) &&
				/\/genre/i.test(href)
			) {
				genres.push(n);
			}
		});
	
		if (genres.length > 12) {
			genres.length = 0;
		}

		let status = 'Ongoing';
		const infoText = cleanText($('.m-imgtxt, .m-desc').first().text());
		if (/\bCompleted\b|\bStatus\s*:\s*Completed\b/i.test(infoText)) {
			status = 'Completed';
		} else if (/\bHiatus\b/i.test(infoText)) {
			status = 'Hiatus';
		} else if (/\bFULL\b/.test(cleanText($('body').text()).slice(0, 500))) {
		}

		const chapters = await this.parseChapterList($, path);

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

	private async parseChapterList(
		$: any,
		novelPath: string
	): Promise<Chapter[]> {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		const pushLink = (href: string, titleHint: string, dateHint?: string) => {
			const id = pathOnly(href);
			if (!id || seen.has(id)) return;
			if (!isChapterPath(id)) return;
			const number = parseChapterNumber(id + ' ' + titleHint);
			if (number <= 0 && !/prologue/i.test(titleHint)) return;
			seen.add(id);
			const date = dateHint ? parseRelativeDate(dateHint) || dateHint : undefined;
			out.push({
				id,
				title: number > 0 ? `Chapter ${number}` : 'Prologue',
				number: number || 0,
				date: date || undefined,
				isLocked: false
			});
		};

		$('#idData li').each((_: number, el: any) => {
			const $li = $(el);
			const a = $li.find('a').first();
			const href = a.attr('href') || '';
			const titleHint =
				cleanText(a.attr('title') || '') || cleanText(a.text());
			const dateHint = cleanText($li.find('.time, .date, span').last().text());
			pushLink(href, titleHint, dateHint);
		});
		if (out.length < 2) {
			$('#idData a, .m-newest2 ul li a').each((_: number, el: any) => {
				const href = $(el).attr('href') || '';
				const titleHint =
					cleanText($(el).attr('title') || '') || cleanText($(el).text());
				pushLink(href, titleHint);
			});
		}

		let totalPage = 1;
		let pageSize = 40;
		$('script').each((_: number, el: any) => {
			const text = $(el).html() || '';
			if (!/chapterPagination/i.test(text)) return;
			const tp = text.match(/totalPage\s*:\s*(\d+)/i);
			const ps = text.match(/pageSize\s*:\s*(\d+)/i);
			if (tp) totalPage = parseInt(tp[1], 10);
			if (ps) pageSize = parseInt(ps[1], 10);
		});
		const optCount = $('.page #indexselect option, #indexselect option').length;
		if (optCount > totalPage) totalPage = optCount;

		if (totalPage > 1) {
			const maxPages = Math.min(totalPage, 50);
			for (let p = 1; p <= maxPages; p++) {
				if (p === 1 && out.length >= pageSize * 0.8) continue;
				try {
					const url = `${novelPath}?ajax=chapters&page=${p}&pageSize=${pageSize}`;
					const text = await this.fetchHtml(url);
					let htmlChunk = text;
					try {
						const json = JSON.parse(text);
						if (json && typeof json.html === 'string') htmlChunk = json.html;
					} catch {
					}
					const $c = cheerio.load(htmlChunk);
					$c('a[href*="/chapter-"]').each((__, a) => {
						const href = $c(a).attr('href') || '';
						const titleHint =
							cleanText($c(a).attr('title') || '') ||
							cleanText($c(a).text());
						pushLink(href, titleHint);
					});
				} catch (e) {
					console.error('[freewebnovel] chapter ajax page', p, e);
				}
			}
		}

		if (out.length < 2) {
			$('a[href*="/chapter-"]').each((_: number, el: any) => {
				pushLink(
					$(el).attr('href') || '',
					cleanText($(el).attr('title') || $(el).text())
				);
			});
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
		const path = pathOnly(chapterId);
		if (!path || !isChapterPath(path)) {
			throw new Error(`Invalid chapter id: ${chapterId}`);
		}

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const number = parseChapterNumber(path);
		const title = number > 0 ? `Chapter ${number}` : 'Chapter';

		let $body = $('.m-read, #article, .txt').first();
		if (!$body.length) $body = $('article, .content').first();

		$body.find('script, style, noscript, iframe, nav, .ads, .ad').remove();

		$('style').each((_: number, el: any) => {
			const styleText = $(el).html() || '';
			const rules = styleText.match(/p:nth-last-child\(\d+\)/gi) || [];
			for (const rule of rules) {
				const m = rule.match(/nth-last-child\((\d+)\)/i);
				if (m) $body.find(`p:nth-last-child(${m[1]})`).remove();
			}
		});

		let contentHtml = $body.html() || '';
		const $txt = $body.find('.txt').first();
		if ($txt.length && ($txt.html() || '').length > 80) {
			contentHtml = $txt.html() || contentHtml;
		}

		let content = (contentHtml || '').trim();
		if (content && !/<p|<br|<div/i.test(content)) {
			content = content
				.split(/\n{2,}/)
				.map((p) => `<p>${escapeHtml(p.trim())}</p>`)
				.join('');
		}

		if (!content || content.length < 40) {
			throw new Error(`Chapter ${number} has empty content`);
		}

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		$('a').each((_: number, el: any) => {
			const href = $(el).attr('href') || '';
			const id = pathOnly(href);
			if (!isChapterPath(id)) return;
			const label = cleanText($(el).text());
			if (!prevChapterId && /prev/i.test(label)) prevChapterId = id;
			if (!nextChapterId && /next/i.test(label)) nextChapterId = id;
		});

		if (number > 0) {
			const base = path.replace(/\/chapter-\d+.*/i, '');
			if (!prevChapterId && number > 1) {
				prevChapterId = `${base}/chapter-${number - 1}`;
			}
			if (!nextChapterId) {
				nextChapterId = `${base}/chapter-${number + 1}`;
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

export default FreeWebNovelSource;
