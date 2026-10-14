/**
 * Family base: MangaThemesia / MangaReader (WordPress)
 *
 * Typical paths:
 *   list   /manga/?order=update&page=N  (or /series/)
 *   search /?s=q
 *   detail /manga/{slug}/  or  /series/{slug}/
 *   pages  #readerarea img  or  ts_reader.run({...})  (manga)
 *   text   .epcontent / .entry-content                 (novel)
 *
 * Chapter list (detail page):
 *   - number : .epl-num / path -chapter-N
 *   - date   : .epl-date / .chapterdate
 *   - lock   : .fa-lock / .premium / coin → chapter.isLocked (UI detail)
 *
 * Novel reader next/prev:
 *   getChapterContent() returns prevChapterId / nextChapterId
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types-manga';

export abstract class ThemesiaSource extends BaseSource {
	protected perPage = 24;
	protected defaultLang = 'en';
	protected seriesPath = '/manga';

	protected absUrl(url: string): string {
		if (!url) return '';
		if (url.startsWith('http')) return url;
		if (url.startsWith('//')) return `https:${url}`;
		return `${this.baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
	}

	protected cleanId(link: string): string {
		let id = (link || '').trim();
		if (id.startsWith('http')) {
			try {
				id = new URL(id).pathname;
			} catch {
				/* ignore */
			}
		}
		if (!id.startsWith('/')) id = `/${id}`;
		return id.replace(/\/+$/, '').split('?')[0] || '/';
	}

	protected normalizeTitle(raw: string, siteName?: string): string {
		if (!raw) return '';
		let t = raw.trim().replace(/\s+/g, ' ');
		if (siteName) {
			const re = new RegExp(`\\s*[-|–]\\s*${siteName}.*$`, 'i');
			t = t.replace(re, '');
		}
		return t.trim();
	}

	protected parseChapterNumber(text: string, path = ''): number {
		const fromPath =
			path.match(/(?:chapter|chap|ch)[-_.\s]*(\d+)(?:[.-](\d+))?/i) ||
			path.match(/-chapter-(\d+)(?:[.-](\d+))?/i);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null && fromPath[2].length <= 2) {
				return parseFloat(`${major}.${fromPath[2]}`);
			}
			return major;
		}
		const m = String(text).match(/(?:chapter|chap|ch\.?)\s*[.\-_:]?\s*(\d+)(?:[.,](\d+))?/i);
		if (m) {
			if (m[2] != null) return parseFloat(`${m[1]}.${m[2]}`);
			return parseInt(m[1], 10);
		}
		const n = String(text).match(/\b(\d+(?:\.\d+)?)\b/);
		return n ? parseFloat(n[1]) : 0;
	}

	protected mapStatus(raw: string): string {
		const s = String(raw || '').toLowerCase();
		if (/complete|end|finished|tamat|selesai/.test(s)) return 'Completed';
		if (/hiatus/.test(s)) return 'Hiatus';
		if (/drop|cancel/.test(s)) return 'Dropped';
		return 'Ongoing';
	}

	protected mapType(raw: string): string {
		const t = String(raw || '').toLowerCase();
		if (t.includes('manhwa')) return 'manhwa';
		if (t.includes('manhua')) return 'manhua';
		if (t.includes('novel')) return 'novel';
		if (t.includes('comic') || t.includes('western')) return 'comic';
		return 'manga';
	}

	protected preferFullCover(url: string): string {
		if (!url) return '';
		return url.replace(/-\d+x\d+(\.\w+)(\?.*)?$/, '$1$2');
	}

	protected listPath(page: number): string {
		const p = Math.max(1, page || 1);
		return `${this.seriesPath}/?page=${p}&order=update`;
	}

	protected searchPath(query: string, page: number): string {
		const q = encodeURIComponent(query);
		return page <= 1 ? `/?s=${q}` : `/?s=${q}&page=${page}`;
	}

	protected cardSelector =
		'div.listupd div.bsx, div.listupd div.bs, .listupd .bsx, .listupd .bs, .postbody div.bsx, .listupd article.maindet, article.maindet, .bixbox .bsx, .bixbox .bs, div.bsx, div.bs, .page-item-detail, .utao, .uta, .epic-card';

	protected chapterListSelector =
		'#chapterlist li a, .eplister li a, #chapterlist a, .chbox a, .eplisterfull li a, ul.clstyle li a, .eplister a';

	protected pageImageSelector =
		'#readerarea img, .readerarea img, .rdminimal img, #reader img, .reading-content img';

	// ── Latest badge on list cards ───────────────────────────────────────────

	protected extractLatestChapter(
		$: cheerio.CheerioAPI,
		$el: cheerio.Cheerio<any>
	): string | undefined {
		const selectors = [
			'.epxs',
			'.epx',
			'.bigor .epxs',
			'.bigor .epx',
			'.adds .epx',
			'.adds .epxs',
			'.fivchap',
			'.chfiv',
			'.nchapter',
			'.forchap',
			'.num-chapter',
			'.lchapter'
		];
		for (const sel of selectors) {
			const t = $el.find(sel).first().text().replace(/\s+/g, ' ').trim();
			if (!t) continue;
			const n = this.parseChapterNumber(t);
			if (n > 0) return String(n);
			const m =
				t.match(/(?:ch(?:apter)?\.?|ep(?:isode)?\.?)\s*(\d+(?:\.\d+)?)/i) ||
				t.match(/\b(\d{1,4}(?:\.\d+)?)\b/);
			if (m?.[1]) return m[1];
		}
		const chHref =
			$el.find('a[href*="-chapter-"], a[href*="-ch-"]').attr('href') || '';
		if (chHref) {
			const n = this.parseChapterNumber('', this.cleanId(chHref));
			if (n > 0) return String(n);
		}
		const html = $.html($el) || '';
		const em =
			html.match(/class=["'][^"']*epxs?[^"']*["'][^>]*>\s*(?:Chapter\s*)?(\d+(?:\.\d+)?)/i) ||
			html.match(/(?:Chapter|Ch\.?)\s*(\d+(?:\.\d+)?)/i);
		if (em?.[1]) return em[1];
		return undefined;
	}

	protected parseCards($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		$(this.cardSelector).each((_, el) => {
			const $el = $(el);

			let $a = $el
				.find(`a[href*="${this.seriesPath}/"]`)
				.filter((_, a) => {
					const h = ($(a).attr('href') || '').split('?')[0];
					const re = new RegExp(
						`${this.seriesPath.replace(/\//g, '\\/')}\\/[^/]+\\/?$`,
						'i'
					);
					return re.test(h) && !/chapter/i.test(h);
				})
				.first();

			if (!$a.length) {
				$a = $el
					.find('a')
					.filter((_, a) => {
						const h = ($(a).attr('href') || '').split('?')[0];
						return (
							!!h &&
							!/\/(page|genre|tag|author|project)\//i.test(h) &&
							!/chapter/i.test(h)
						);
					})
					.first();
			}

			const href = $a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			if (/\/(page|genre|tag|author|project|list-mode)\//i.test(id)) return;
			if (/-chapter-\d+/i.test(id) || /-ch-\d+/i.test(id)) return;
			seen.add(id);

			const title = this.normalizeTitle(
				$el.find('.tt, .hottitle, .ntitle, h2, h3').first().text() ||
					$a.attr('title') ||
					$a.attr('oldtitle') ||
					$a.text() ||
					$el.find('img').attr('alt') ||
					'',
				this.name
			);
			if (!title) return;

			const $img = $el.find('img').first();
			let cover =
				$img.attr('data-src') ||
				$img.attr('data-lazy-src') ||
				$img.attr('src') ||
				'';
			if (cover.startsWith('data:')) cover = '';
			cover = this.preferFullCover(this.absUrl(cover));

			const latestChapter = this.extractLatestChapter($, $el);

			res.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type: this.mapType($el.text()),
				status: 'Ongoing',
				latestChapter,
				lang: this.defaultLang
			});
		});

		return res;
	}

	async getLatestManga(page: number): Promise<Manga[]> {
		const html = await this.fetchHtml(this.listPath(Math.max(1, page || 1)));
		return this.parseCards(cheerio.load(html));
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = Math.max(1, opts?.page || 1);
		const html = await this.fetchHtml(this.searchPath(query, page));
		return this.parseCards(cheerio.load(html));
	}

	protected isChapterLocked(
		$a: cheerio.Cheerio<any>,
		$li: cheerio.Cheerio<any>
	): boolean {
		if (
			$a.find(
				'.lock, .fa-lock, .fas.fa-lock, .premium, .premium-lock, .coin-price, .coin-price-pill, .premium-star, [class*="lock"], [data-coin]'
			).length
		) {
			return true;
		}
		if (
			$li.find(
				'.lock, .fa-lock, .fas.fa-lock, .premium, .premium-lock, .coin-price, .coin-price-pill, .premium-star, .chapter-lock-badge, [class*="lock"], [data-coin]'
			).length
		) {
			return true;
		}

		const cls = `${$li.attr('class') || ''} ${$a.attr('class') || ''}`.toLowerCase();
		if (/\b(premium|locked|paywall|is-premium|chapter-lock)\b/.test(cls)) return true;

		const target = (
			$a.attr('data-bs-target') ||
			$a.attr('data-target') ||
			$li.attr('data-bs-target') ||
			''
		).toLowerCase();
		if (/lock|premium|coin|vip/.test(target)) return true;

		if ($a.attr('data-coin') || $li.attr('data-coin')) return true;

		const rowText = $li.text().replace(/\s+/g, ' ');
		if (/🔒|(?:\d+\s*)coins?|premium|vip\s*only|early\s*access/i.test(rowText)) {
			return true;
		}

		return false;
	}

	protected parseChapterList($: cheerio.CheerioAPI): Chapter[] {
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$(this.chapterListSelector).each((_, a) => {
			const $a = $(a);
			const href = $a.attr('href') || '';
			if (!href || href === '#' || href.includes('{{')) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			const $li = $a.closest('li').length ? $a.closest('li') : $a.parent();

			const numText =
				$a.find('.epl-num, .chapternum').first().text().replace(/\s+/g, ' ').trim() ||
				$a.text().replace(/\s+/g, ' ').trim();
			const number = this.parseChapterNumber(numText || id, id);
			if (!number && !/chapter/i.test(id) && !/chapter/i.test(numText)) return;

			const title = number > 0 ? `Chapter ${number}` : numText || id;

			const date =
				$a.find('.epl-date, .chapterdate, .chapter-date').first().text().replace(/\s+/g, ' ').trim() ||
				$li
					.find('.epl-date, .chapterdate, .chapter-date, .dt, .chapter-release-date, time, .date, .chapter-time')
					.first()
					.text()
					.replace(/\s+/g, ' ')
					.trim() ||
				$li.find('time').attr('datetime') ||
				undefined;

			const isLocked = this.isChapterLocked($a, $li);

			chapters.push({
				id,
				title,
				number: number || chapters.length + 1,
				date: date || undefined,
				...(isLocked ? { isLocked: true } : {})
			});
		});

		return chapters;
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const path = this.cleanId(mangaId);
		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const title = this.normalizeTitle(
			$('h1.entry-title, h1').first().text() ||
				$('meta[property="og:title"]').attr('content') ||
				'',
			this.name
		);

		let cover = '';
		const imgSelectors = [
			'.thumbook img',
			'.thumb img',
			'.series-thumb img',
			'.seriestucontl img',
			'.seriestuimg img',
			'.ims img',
			'.manga-poster img',
			'.summary_image img',
			'img.wp-post-image',
			'.post-thumbnail img',
			'.info-desc img'
		];
		for (const sel of imgSelectors) {
			const $img = $(sel).first();
			if (!$img.length) continue;
			cover =
				$img.attr('data-src') ||
				$img.attr('data-lazy-src') ||
				$img.attr('data-srcset')?.split(/\s*,\s*/)[0]?.split(/\s+/)[0] ||
				$img.attr('srcset')?.split(/\s*,\s*/)[0]?.split(/\s+/)[0] ||
				$img.attr('src') ||
				'';
			if (cover && !cover.startsWith('data:')) break;
			cover = '';
		}
		if (!cover) {
			cover =
				$('meta[property="og:image"]').attr('content') ||
				$('meta[name="twitter:image"]').attr('content') ||
				'';
		}
		if (!cover) {
			const style =
				$('.thumbook, .thumb, .seriestuimg, .summary_image').first().attr('style') || '';
			const bm = style.match(/url\(['"]?([^'")\s]+)['"]?\)/i);
			if (bm?.[1]) cover = bm[1];
		}
		if (cover.startsWith('data:')) cover = '';
		cover = this.preferFullCover(this.absUrl(cover));

		const description = $(
			'.entry-content[itemprop="description"], .seriestuhead .entry-content, .sersys, .series-synops, .synops, .wd-full, .entry-content'
		)
			.first()
			.text()
			.replace(/\s+/g, ' ')
			.trim();

		const genres: string[] = [];
		$('.seriestugenre a, .mgen a, .genxed a, a[rel="tag"]').each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		const authors: string[] = [];
		$('.infotable tr, .fmed, .imptdt, .tsinfo .imptdt').each((_, row) => {
			const t = $(row).text();
			if (/author|artist|pengarang|penulis/i.test(t)) {
				const v =
					$(row).find('td').last().text().replace(/\s+/g, ' ').trim() ||
					$(row).find('span, a').last().text().replace(/\s+/g, ' ').trim();
				if (v && !/author|artist|pengarang/i.test(v) && !authors.includes(v)) {
					authors.push(v);
				}
			}
		});

		let status = 'Ongoing';
		$('.status, .imptdt, .infotable tr').each((_, el) => {
			const t = $(el).text();
			if (/status/i.test(t)) status = this.mapStatus(t);
		});

		const chapters = this.parseChapterList($);

		return {
			id: path,
			sourceId: this.id,
			title: title || path.split('/').filter(Boolean).pop() || path,
			cover,
			type: this.mapType($('.infotable, .seriestucont, .spe').text()),
			status,
			description,
			authors,
			genres,
			chapters,
			latestChapter: chapters[0] ? String(chapters[0].number) : undefined,
			lang: this.defaultLang
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const pages: string[] = [];
		const seen = new Set<string>();

		const push = (src?: string | null) => {
			if (!src || src.startsWith('data:')) return;
			const url = this.absUrl(src.split(/\s+/)[0]);
			if (!url || seen.has(url)) return;
			if (/logo|icon|avatar|emoji|spinner|loading|dummy/i.test(url)) return;
			seen.add(url);
			pages.push(url);
		};

		const m = html.match(/ts_reader\.run\((\{[\s\S]*?\})\);/);
		if (m?.[1]) {
			try {
				const data = JSON.parse(m[1]) as {
					sources?: Array<{ images?: string[] }>;
				};
				for (const src of data.sources || []) {
					for (const img of src.images || []) push(img);
				}
			} catch {
				/* fall through */
			}
		}

		if (pages.length === 0) {
			const $ = cheerio.load(html);
			$(this.pageImageSelector).each((_, img) => {
				const $img = $(img);
				push(
					$img.attr('data-src') ||
						$img.attr('data-lazy-src') ||
						$img.attr('src')
				);
			});
		}

		return pages;
	}

	protected adjacentChapterIds(path: string): {
		prev: string | null;
		next: string | null;
	} {
		const p = path.replace(/\/$/, '');
		const m =
			p.match(/^(.*-chapter-)(\d+(?:\.\d+)?)(?:-.*)?$/i) ||
			p.match(/^(.*-ch-)(\d+(?:\.\d+)?)(?:-.*)?$/i) ||
			p.match(/^(.*-c)(\d+(?:\.\d+)?)(?:-.*)?$/i);
		if (!m) return { prev: null, next: null };
		const n = parseFloat(m[2]);
		if (!Number.isFinite(n) || n <= 0) return { prev: null, next: null };
		const prevN = n > 1 ? (Number.isInteger(n) ? n - 1 : Math.floor(n)) : null;
		const nextN = Number.isInteger(n) ? n + 1 : Math.ceil(n);
		return {
			prev: prevN != null && prevN > 0 ? `${m[1]}${prevN}` : null,
			next: `${m[1]}${nextN}`
		};
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
		novelId?: string | null;
	}> {
		const path = this.cleanId(chapterId);
		const adj = this.adjacentChapterIds(path);
		let prevChapterId: string | null = adj.prev;
		let nextChapterId: string | null = adj.next;

		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const h1 = $('h1.entry-title, h1').first().text().replace(/\s+/g, ' ').trim();
		const number = this.parseChapterNumber(h1, path);
		const title = number > 0 ? `Chapter ${number}` : h1 || 'Chapter';

		const root = $(
			[
				'.epcontent.entry-content',
				'.entry-content .epcontent',
				'.epcontent',
				'#readerarea',
				'.reading-content',
				'.text-left',
				'.entry-content',
				'.chapter-content'
			].join(', ')
		).first();
		root
			.find(
				'script, style, .ads, .code-block, .sharedaddy, .chapter-nav, .chnav, .navi, .epheader, .headpost, nav, .adsbygoogle'
			)
			.remove();

		let content = (root.html() || '').trim();
		if (!content) {
			content = root.text().replace(/\s+/g, ' ').trim();
		}
		if (!content) {
			content =
				'<p><em>Empty content — selector may have changed or chapter is locked.</em></p>';
		}

		const pickNav = (sels: string[]): string | null => {
			for (const sel of sels) {
				const href = $(sel).first().attr('href') || '';
				if (!href || href === '#' || href.startsWith('javascript:')) continue;
				const id = this.cleanId(href);
				if (id && id !== path && id !== '/') return id;
			}
			return null;
		};

		const fromPrevNav = pickNav([
			'.chnav a[rel="prev"]',
			'.chnav a.prev',
			'.navi a.prev',
			'.nextprev a[rel="prev"]',
			'a.ch-prev',
			'a[rel="prev"]'
		]);
		const fromNextNav = pickNav([
			'.chnav a[rel="next"]',
			'.chnav a.next',
			'.navi a.next',
			'.nextprev a[rel="next"]',
			'a.ch-next',
			'a[rel="next"]'
		]);
		if (fromPrevNav) prevChapterId = fromPrevNav;
		if (fromNextNav) nextChapterId = fromNextNav;

		if (!prevChapterId || !nextChapterId) {
			$('a').each((_, a) => {
				const t = $(a).text().replace(/\s+/g, ' ').trim().toLowerCase();
				const href = $(a).attr('href') || '';
				if (!href || href === '#' || href.startsWith('javascript:')) return;
				const id = this.cleanId(href);
				if (!id || id === path || id === '/') return;
				if (new RegExp(`^${this.seriesPath}/[^/]+$`, 'i').test(id)) return;
				if (!prevChapterId && /^(prev|previous|←|‹|«)$/i.test(t)) prevChapterId = id;
				if (!nextChapterId && /^(next|→|›|»)$/i.test(t)) nextChapterId = id;
			});
		}

		if (!prevChapterId && adj.prev) prevChapterId = adj.prev;
		if (!nextChapterId && adj.next) nextChapterId = adj.next;

		let novelId: string | null = null;
		const seriesRe = new RegExp(
			`^${this.seriesPath.replace(/\//g, '\\/')}\\/[^/]+$`,
			'i'
		);
		const chapterSlug = path
			.replace(/^\/+/, '')
			.replace(/[-_](?:chapter|ch|c)[-_]?\d+(?:\.\d+)?.*$/i, '')
			.replace(/[-_]v\d+c\d+(?:\.\d+)?.*$/i, '');

		$('a[href]').each((_, a) => {
			if (novelId) return;
			const id = this.cleanId($(a).attr('href') || '');
			if (!seriesRe.test(id)) return;
			if (chapterSlug && id.toLowerCase().includes(chapterSlug.toLowerCase())) {
				novelId = id;
			}
		});
		if (!novelId) {
			$('a[href]').each((_, a) => {
				if (novelId) return;
				const id = this.cleanId($(a).attr('href') || '');
				if (seriesRe.test(id)) novelId = id;
			});
		}
		if (!novelId) {
			const m =
				path.match(/^\/(.+?)[-_](?:chapter|ch)[-_]?\d+/i) ||
				path.match(/^\/(.+?)[-_]v\d+c\d+/i) ||
				path.match(/^\/(.+?)[-_]c\d+/i);
			if (m?.[1]) {
				novelId = `${this.seriesPath}/${m[1]}`.replace(/\/{2,}/g, '/');
				if (!novelId.startsWith('/')) novelId = `/${novelId}`;
			}
		}

		return { title, content, prevChapterId, nextChapterId, novelId };
	}
}
