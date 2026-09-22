import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

/**
 * Areakomik adapter (https://areakomik.com)
 * Komik dewasa Indo — custom theme
 *
 * Latest  : /  |  /page/{n}/
 * Search  : /?s={q}  |  /page/{n}/?s={q}
 * Detail  : /series/{slug}/
 * Chapter : /chapter/{slug}-chapter-{n}/
 * Pages   : img.chapter-img (CDN pic.gudangkomik.top)
 *
 * ID format:
 *   manga   : /series/{slug}
 *   chapter : /chapter/{slug}-chapter-{n}
 */
export class AreakomikSource extends BaseSource {
	id = 'areakomik';
	name = 'Areakomik';
	baseUrl = 'https://areakomik.com';

	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'id';

	private absUrl(url: string): string {
		if (!url) return '';
		if (url.startsWith('http')) return url;
		if (url.startsWith('//')) return `https:${url}`;
		return `${this.baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
	}

	private cleanId(link: string): string {
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

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath = path.match(/chapter[_-]?(\d+(?:\.\d+)?)(?:[_-]end)?/i);
		if (fromPath) return parseFloat(fromPath[1]);

		const m = String(text).match(
			/(?:chapter|chap|ch\.?)\s*(\d+)(?:[.,](\d+))?/i
		);
		if (m) {
			if (m[2] != null) return parseFloat(`${m[1]}.${m[2]}`);
			return parseInt(m[1], 10);
		}
		const n = String(text).match(/\b(\d+(?:\.\d+)?)\b/);
		return n ? parseFloat(n[1]) : 0;
	}

	private mapStatus(raw: string): string {
		const s = String(raw || '').toLowerCase();
		if (/complet|tamat|end|finished/.test(s)) return 'Completed';
		if (/hiatus/.test(s)) return 'Hiatus';
		if (/drop|cancel/.test(s)) return 'Dropped';
		return 'Ongoing';
	}

	private detectType(text: string): string {
		const t = (text || '').toLowerCase();
		if (/\bmanhwa\b/.test(t)) return 'manhwa';
		if (/\bmanhua\b/.test(t)) return 'manhua';
		if (/\btoon\b/.test(t)) return 'manhwa';
		if (/\blokal\b/.test(t)) return 'manga';
		return 'manga';
	}

	private preferFullCover(url: string): string {
		if (!url) return '';
		return url.replace(/-\d+x\d+(\.\w+)(\?.*)?$/, '$1$2');
	}

	/** Parse chapter badge text → string number for latestChapter */
	private chapterBadge(text: string): string | undefined {
		const t = String(text || '')
			.replace(/\s+/g, ' ')
			.trim();
		if (!t) return undefined;
		const n = this.parseChapterNumber(t);
		if (n > 0) return String(n);
		// fallback: "Ch. 01", "Chapter End", etc.
		const m = t.match(/(?:ch\.?|chapter)\s*([0-9]+(?:\.[0-9]+)?)/i);
		if (m) return m[1];
		return undefined;
	}

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		const push = (
			href: string,
			title: string,
			cover: string,
			typeText = '',
			statusText = '',
			chText = ''
		) => {
			const id = this.cleanId(href);
			if (!/^\/series\/[^/]+$/i.test(id)) return;
			if (seen.has(id)) return;
			seen.add(id);

			title = (title || '').replace(/\s+/g, ' ').trim();
			if (!title || title.length < 2) return;

			const latestChapter = this.chapterBadge(chText);

			out.push({
				id,
				sourceId: this.id,
				title,
				cover: this.preferFullCover(this.absUrl((cover || '').split('?')[0])),
				type: this.detectType(typeText),
				status: this.mapStatus(statusText),
				latestChapter,
				lang: this.DEFAULT_LANG
			});
		};

		// Kartu utama: article.komik-card
		$('article.komik-card, .komik-card').each((_, el) => {
			const $el = $(el);
			const a =
				$el.find('h3.card-title a[href*="/series/"]').first().length > 0
					? $el.find('h3.card-title a[href*="/series/"]').first()
					: $el.find('a.thumb-wrap[href*="/series/"]').first().length > 0
						? $el.find('a.thumb-wrap[href*="/series/"]').first()
						: $el.find('a[href*="/series/"]').first();

			const href = a.attr('href') || '';
			if (!href) return;

			const title =
				$el.find('h3.card-title a').first().text() ||
				a.attr('title') ||
				a.text() ||
				$el.find('img').attr('alt') ||
				'';

			const cover =
				$el.find('img').first().attr('src') ||
				$el.find('img').first().attr('data-src') ||
				'';

			const typeText =
				$el.find('.type-badge').first().text() ||
				$el.find('[class*="type-"]').first().attr('class') ||
				'';

			const statusText =
				$el.find('.status-badge').first().text() ||
				$el.find('.status-badge').first().attr('class') ||
				'';

			// Badge chapter: beberapa layout beda class
			const chText =
				$el.find('a.chapter-link').first().text() ||
				$el.find('.chapter-row a[href*="/chapter/"]').first().text() ||
				$el.find('a[href*="/chapter/"]').first().text() ||
				$el.find('.chapter-link, .chapter-row, .update-time').first().text() ||
				'';

			push(href, title, cover, typeText, statusText, chText);
		});

		// Section UPDATE TERBARU (kadang struktur beda)
		$('.linut-item, .lin-update-today .linut-item, .update-item').each((_, el) => {
			const $el = $(el);
			const seriesA = $el.find('a[href*="/series/"]').first();
			const href = seriesA.attr('href') || '';
			if (!href) return;
			const title =
				seriesA.attr('title') ||
				$el.find('h3, .card-title, a[href*="/series/"]').last().text() ||
				'';
			const cover =
				$el.find('img').first().attr('src') ||
				$el.find('img').first().attr('data-src') ||
				'';
			const typeText = $el.find('.type-badge, [class*="type-"]').first().text() || '';
			const statusText =
				$el.find('.status-badge').first().text() || $el.text().slice(0, 80);
			const chText =
				$el.find('a[href*="/chapter/"]').first().text() ||
				$el.find('.chapter-link, .chapter-row').first().text() ||
				'';
			push(href, title, cover, typeText, statusText, chText);
		});

		// Fallback global
		if (!out.length) {
			$('a[href*="/series/"]').each((_, el) => {
				const $a = $(el);
				const href = $a.attr('href') || '';
				if (!/\/series\/[^/]+\/?$/i.test(href.split('?')[0])) return;
				const title = ($a.attr('title') || $a.text() || '')
					.replace(/\s+/g, ' ')
					.trim();
				if (!title || title.length < 3) return;
				const $parent = $a.closest('article, .komik-card, .card, li, div');
				const cover =
					$parent.find('img').attr('src') ||
					$parent.find('img').attr('data-src') ||
					$a.find('img').attr('src') ||
					'';
				const chText =
					$parent.find('a[href*="/chapter/"]').first().text() || '';
				push(href, title, cover, $parent.text(), $parent.text(), chText);
			});
		}

		return out;
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			// Pagination site: /page/2/  (bukan query ?page=)
			const path = p <= 1 ? `/` : `/page/${p}/`;
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list = this.parseCards($);

			// Homepage punya popular + update — dedupe sudah di parseCards.
			// Ambil semua card unik; jangan slice terlalu agresif agar page 2 beda.
			const pageList = list.slice(0, this.PER_PAGE);

			console.log(
				`[areakomik] latest page=${p} path=${path} → ${pageList.length} (raw=${list.length})`
			);
			return pageList;
		} catch (e) {
			console.error('[areakomik] getLatestManga', e);
			return [];
		}
	}

	async searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page || 1);
		if (!q) return this.getLatestManga(page, opts);

		try {
			const path =
				page <= 1
					? `/?s=${encodeURIComponent(q)}`
					: `/page/${page}/?s=${encodeURIComponent(q)}`;
			const html = await this.fetchHtml(path);
			const list = this.parseCards(cheerio.load(html)).slice(0, this.PER_PAGE);
			console.log(`[areakomik] search "${q}" page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[areakomik] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);

		if (/^\/chapter\//i.test(path)) {
			const m = path.match(/^\/chapter\/(.+?)-chapter-[\d.]+(?:-end)?$/i);
			if (m?.[1]) path = `/series/${m[1]}`;
		}

		if (!/^\/series\/[^/]+$/i.test(path)) {
			throw new Error(`Invalid areakomik id: ${mangaId}`);
		}

		const html = await this.fetchHtml(path + '/');
		const $ = cheerio.load(html);

		let title =
			$('h1, .series-title, .entry-title').first().text().trim() ||
			$('meta[property="og:title"]').attr('content') ||
			path;
		title = title
			.replace(/\s*[-|].*areakomik.*$/i, '')
			.replace(/\s*Bahasa Indonesia.*$/i, '')
			.replace(/\s+/g, ' ')
			.trim();

		let cover =
			$('.series-thumb img, .thumb img').first().attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = this.preferFullCover(this.absUrl((cover || '').split('?')[0]));

		const metaText = $('.series-meta, .series-info, .meta-item')
			.text()
			.replace(/\s+/g, ' ');

		let type = this.detectType(metaText);
		const typeMatch = metaText.match(/Type\s*:\s*(\w+)/i);
		if (typeMatch) type = this.detectType(typeMatch[1]);

		let status = this.mapStatus(metaText);
		const statusMatch = metaText.match(/Status\s*:\s*(\w+)/i);
		if (statusMatch) status = this.mapStatus(statusMatch[1]);

		const authors: string[] = [];
		$('a[href*="/author/"]').each((_, a) => {
			const n = $(a).text().replace(/\s+/g, ' ').trim();
			if (n && !authors.includes(n)) authors.push(n);
		});
		if (!authors.length) {
			const authorMatch = metaText.match(
				/Author\s*:\s*([^]+?)(?:Genre|Total|Type|Status|$)/i
			);
			if (authorMatch) {
				authorMatch[1]
					.split(/,|\//)
					.map((s) => s.trim())
					.filter((n) => n && n.length < 60)
					.forEach((n) => {
						if (!authors.includes(n)) authors.push(n);
					});
			}
		}

		const genres: string[] = [];
		$('a[href*="/genre/"], .genre-list a').each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		// Sinopsis bersih — jangan campur meta
		const synopsis = (
			$('.series-sinopsis, .sinopsis').first().text() ||
			$('.entry-content').first().text() ||
			''
		)
			.replace(/^\s*Sinopsis\s*/i, '')
			.replace(/\s+/g, ' ')
			.trim();

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('a.chapter-link, .chapter-row a[href*="/chapter/"], a[href*="/chapter/"]').each(
			(_, a) => {
				const $a = $(a);
				const href = $a.attr('href') || '';
				if (!/\/chapter\//i.test(href)) return;
				if (/\/series\//i.test(href)) return;
				if (/areakomik_confirm|pdf-download|token=/i.test(href)) return;

				const cid = this.cleanId(href);
				if (!/^\/chapter\/[^/]+$/i.test(cid)) return;
				if (seen.has(cid)) return;
				seen.add(cid);

				const text = $a.text().replace(/\s+/g, ' ').trim();
				const titleClean = text
					.replace(/\bNEW\b/gi, '')
					.replace(/\d{1,2}\/\d{1,2}\/\d{4}/g, '')
					.replace(/\s+/g, ' ')
					.trim();

				const number =
					this.parseChapterNumber(cid) || this.parseChapterNumber(titleClean);

				let date: string | undefined;
				const parentText = $a
					.closest('.chapter-row, li, tr, div')
					.text()
					.replace(/\s+/g, ' ');
				const dm = parentText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
				if (dm) {
					date = `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
				}

				chapters.push({
					id: cid,
					title: titleClean || `Chapter ${number}`,
					number: number || 0,
					date
				});
			}
		);

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));
		const latestChapter =
			chapters.length > 0 ? String(chapters[0].number) : undefined;

		console.log(`[areakomik] details ${path} → ch=${chapters.length}`);

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			type,
			status,
			description: synopsis,
			authors,
			genres,
			chapters,
			latestChapter,
			lang: this.DEFAULT_LANG
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		if (!/^\/chapter\//i.test(path)) {
			console.error('[areakomik] not a chapter path:', chapterId);
			return [];
		}

		try {
			const html = await this.fetchHtml(path + '/');
			const $ = cheerio.load(html);
			const urls: string[] = [];
			const seen = new Set<string>();

			const pick = (src: string) => {
				if (!src || src.startsWith('data:')) return;
				src = this.absUrl(src.split(/\s+/)[0].split('?')[0]);
				if (!/^https?:\/\//i.test(src)) return;
				if (
					/wm-chapter|foxdoor|logo|icon|avatar|donasi|gravatar|banner|ads|betcoin|katsu|premium|lospollos|tele-pdf|\.gif$/i.test(
						src
					)
				) {
					return;
				}
				if (seen.has(src)) return;
				seen.add(src);
				urls.push(src);
			};

			$('img.chapter-img').each((_, img) => {
				const $img = $(img);
				pick($img.attr('src') || $img.attr('data-src') || '');
			});

			if (!urls.length) {
				$(
					'#readerarea img, .readerarea img, .entry-content img, .reading-content img, article img'
				).each((_, img) => {
					const $img = $(img);
					pick($img.attr('src') || $img.attr('data-src') || '');
				});
			}

			const cdn = urls.filter((u) =>
				/gudangkomik|pic\.gudangkomik/i.test(u)
			);
			const finalUrls = cdn.length ? cdn : urls;

			console.log(`[areakomik] ${finalUrls.length} pages → ${path}`);
			return finalUrls;
		} catch (e) {
			console.error('[areakomik] getChapterPages failed', path, e);
			return [];
		}
	}
}
