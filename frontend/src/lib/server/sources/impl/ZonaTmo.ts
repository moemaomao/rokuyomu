import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types';
import * as cheerio from 'cheerio';

/**
 * ZonaTMO (zonatmo.org)
 * - Latest: /biblioteca + /ultimas-subidas (target 24 unique)
 * - Manga:  /library/manga/{id}/{slug}
 * - Chapter:/view_uploads/{id} → /viewer/{uniqid}/cascade
 */
export class ZonaTmoSource extends BaseSource {
	id = 'zonatmo';
	name = 'ZonaTMO';
	baseUrl = 'https://zonatmo.org';

	private readonly PER_PAGE = 24;

	// ── Helpers ──────────────────────────────────────────────────────────────

	private absUrl(href: string): string {
		if (!href) return '';
		if (href.startsWith('http')) return href;
		if (href.startsWith('//')) return `https:${href}`;
		return `${this.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
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
		return id.replace(/\/+$/, '').split('?')[0];
	}

	private detectType(text: string): 'manga' | 'manhwa' | 'manhua' {
		const t = (text || '').toLowerCase();
		if (t.includes('manhwa')) return 'manhwa';
		if (t.includes('manhua')) return 'manhua';
		if (
			t.includes('webtoon') ||
			t.includes('comic') ||
			t.includes('one_shot') ||
			t.includes('one shot')
		) {
			return 'manhwa';
		}
		return 'manga';
	}

	private parseMangaList(html: string): Manga[] {
		const $ = cheerio.load(html);
		const mangas: Manga[] = [];
		const seen = new Set<string>();

		$('a[href*="/library/manga/"]').each((_, el) => {
			const $a = $(el);
			const href = $a.attr('href') || '';
			if (!href.includes('/library/manga/')) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			const $card = $a.closest(
				'div.element, div.book-item, .element-bg, .element, .card, article, li, .col'
			);

			let title =
				$a.find('h4, h3, h2, .title, .name').first().text().trim() ||
				($card.length ? $card.find('h4, h3, h2, .title').first().text().trim() : '') ||
				$a.attr('title')?.trim() ||
				$a.text().replace(/\s+/g, ' ').trim();

			title = title
				.replace(/\s*Cap[ií]tulo\s*\d+(?:\.\d+)?.*$/i, '')
				.replace(/\s*Chapter\s*\d+(?:\.\d+)?.*$/i, '')
				.replace(/\s+/g, ' ')
				.trim();

			if (!title || title.length < 2) {
				const slug = id.split('/').pop() || '';
				title = decodeURIComponent(slug).replace(/-/g, ' ').trim();
			}
			if (!title) return;

			let cover = '';
			const $img = ($card.length ? $card : $a).find('img').first();
			if ($img.length) {
				cover =
					$img.attr('src') ||
					$img.attr('data-src') ||
					$img.attr('data-original') ||
					$img.attr('data-lazy-src') ||
					'';
			}
			if (!cover && $card.length) {
				const style =
					$card
						.find('.thumbnail, .thumb, .book-thumbnail, [style*="background"]')
						.attr('style') ||
					$card.attr('style') ||
					'';
				const m = style.match(/url\(['"]?(https?:\/\/[^'")\s]+)/i);
				if (m) cover = m[1];
				if (!cover) cover = $card.attr('data-bg') || '';
			}

			mangas.push({
				id,
				title,
				cover: this.absUrl(cover),
				sourceId: this.id,
				type: this.detectType(($card.length ? $card : $a).text())
			});
		});

		if (mangas.length === 0) {
			const re = /href=["']([^"']*\/library\/manga\/\d+\/[^"'?#]+)/gi;
			let m: RegExpExecArray | null;
			while ((m = re.exec(html)) !== null) {
				const id = this.cleanId(m[1]);
				if (seen.has(id)) continue;
				seen.add(id);
				const slug = id.split('/').pop() || id;
				mangas.push({
					id,
					title: decodeURIComponent(slug).replace(/-/g, ' '),
					cover: '',
					sourceId: this.id,
					type: 'manga'
				});
			}
		}

		return mangas;
	}

	// ── Latest ───────────────────────────────────────────────────────────────

	async getLatestManga(page: number): Promise<Manga[]> {
		const mangas: Manga[] = [];
		const seen = new Set<string>();

		const paths =
			page <= 1
				? [
						'/biblioteca?order_item=creation&order_dir=desc&page=1',
						'/ultimas-subidas',
						'/?tab=trending'
					]
				: [
						`/biblioteca?order_item=creation&order_dir=desc&page=${page}`,
						`/ultimas-subidas?page=${page}`
					];

		for (const path of paths) {
			if (mangas.length >= this.PER_PAGE) break;
			try {
				const html = await this.fetchHtml(path);
				if (html.length < 3000) {
					console.warn(`[zonatmo] short html on ${path} len=${html.length}`);
					continue;
				}
				const batch = this.parseMangaList(html);
				for (const item of batch) {
					if (seen.has(item.id)) continue;
					seen.add(item.id);
					mangas.push(item);
					if (mangas.length >= this.PER_PAGE) break;
				}
				console.log(`[zonatmo] ${path} batch=${batch.length} unique=${mangas.length}`);
			} catch (e) {
				console.error(`[zonatmo] fetch fail ${path}:`, e);
			}
		}

		if (mangas.length < this.PER_PAGE && page <= 1) {
			for (let p = 2; p <= 3 && mangas.length < this.PER_PAGE; p++) {
				try {
					const html = await this.fetchHtml(
						`/biblioteca?order_item=creation&order_dir=desc&page=${p}`
					);
					const batch = this.parseMangaList(html);
					for (const item of batch) {
						if (seen.has(item.id)) continue;
						seen.add(item.id);
						mangas.push(item);
						if (mangas.length >= this.PER_PAGE) break;
					}
				} catch {
					/* ignore */
				}
			}
		}

		return mangas.slice(0, this.PER_PAGE);
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim();
		if (!q) return this.getLatestManga(opts?.page || 1);
		const page = Math.max(1, opts?.page || 1);
		try {
			const html = await this.fetchHtml(
				`/biblioteca?title=${encodeURIComponent(q)}&page=${page}`
			);
			return this.parseMangaList(html).slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[zonatmo] search fail:', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);
		if (!path.startsWith('/library/manga/')) {
			path = `/library/manga/${path.replace(/^\//, '')}`;
		}

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			$('h1.element-title, h1:not(.book-type), h2.title').first().text().trim() ||
			$('meta[property="og:title"]')
				.attr('content')
				?.replace(/\s*\|?\s*ZonaTMO.*$/i, '')
				.trim() ||
			path;

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('.book-thumbnail img, .thumb img, .cover img').first().attr('src') ||
			$('img[itemprop="image"]').attr('src') ||
			'';
		cover = this.absUrl(cover);

		const description =
			$(
				'p.element-description, #manga-synopsis, .element-description, .sinopsis, .description'
			)
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim() ||
			$('meta[name="description"]').attr('content')?.trim() ||
			'';

		let status = 'Ongoing';
		const statusRaw =
			$('.status, .book-status, .element-status').first().text().toLowerCase() || '';
		if (/finalizado|completado|terminado|completed/.test(statusRaw)) status = 'Completed';
		else if (/pausado|hiatus/.test(statusRaw)) status = 'Hiatus';

		const type = this.detectType($('body').text());

		const genres: string[] = [];
		$('.genres a, .badge-primary, a[href*="/tag/"]').each((_, el) => {
			const g = $(el).text().trim();
			if (g && !genres.includes(g)) genres.push(g);
		});

		const authors: string[] = [];
		$('.author a, a[href*="author"]').each((_, el) => {
			const a = $(el).text().trim();
			if (a && !authors.includes(a)) authors.push(a);
		});

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		const rows = $(
			'li.upload-link, ul.chapters-list li, .chapter-list li, .chapters li, .upload-link'
		);

		if (rows.length > 0) {
			rows.each((_, el) => {
				const $el = $(el);
				const $a =
					$el.find('a[href*="/view_uploads/"]').first().length > 0
						? $el.find('a[href*="/view_uploads/"]').first()
						: $el.find('.chapter-detail a.btn-primary, a.btn-primary').first();

				const href = $a.attr('href') || '';
				if (!href || href === '#' || !href.includes('/view_uploads/')) return;

				const id = this.cleanId(href);
				if (seen.has(id)) return;
				seen.add(id);

				const nameEl = $el
					.find('.btn-collapse, .chapter-link, .chapter-number, a.btn-collapse, .chapter-name')
					.first();

				let rawName =
					nameEl.text().replace(/\s+/g, ' ').trim() ||
					$el.find('h4, h5, .title').first().text().replace(/\s+/g, ' ').trim() ||
					'';
				if (/^leer online$/i.test(rawName)) rawName = '';

				const numMatch =
					rawName.match(/cap[ií]tulo\s*(\d+(?:\.\d+)?)/i) ||
					rawName.match(/chapter\s*(\d+(?:\.\d+)?)/i) ||
					rawName.match(/\b(\d+(?:\.\d+)?)\b/);
				const number = numMatch ? parseFloat(numMatch[1]) : NaN;

				const group =
					$el.find('.group-name, .scan-group, .team, a[href*="/groups/"]').first().text().trim() ||
					'';
				const date =
					$el.find('.date, .chapter-date, time, .text-muted').last().text().replace(/\s+/g, ' ').trim() ||
					'';

				const chTitle = Number.isFinite(number)
					? group
						? `Capítulo ${number} — ${group}`
						: `Capítulo ${number}`
					: rawName || `Capítulo ${chapters.length + 1}`;

				chapters.push({
					id,
					title: chTitle,
					number: Number.isFinite(number) ? number : chapters.length + 1,
					date
				});
			});
		}

		if (chapters.length === 0) {
			$('a[href*="/view_uploads/"]').each((i, el) => {
				const href = $(el).attr('href') || '';
				if (!href) return;
				const id = this.cleanId(href);
				if (seen.has(id)) return;
				seen.add(id);

				const rowText = $(el).closest('li, tr, .upload-link, div').text().replace(/\s+/g, ' ');
				const numMatch =
					rowText.match(/cap[ií]tulo\s*(\d+(?:\.\d+)?)/i) ||
					rowText.match(/chapter\s*(\d+(?:\.\d+)?)/i);
				const number = numMatch ? parseFloat(numMatch[1]) : i + 1;

				chapters.push({
					id,
					title: `Capítulo ${number}`,
					number,
					date: ''
				});
			});
		}

		chapters.sort((a, b) => b.number - a.number);
		console.log(`[zonatmo] details ${path} chapters=${chapters.length}`);

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			type,
			description,
			authors,
			status,
			genres,
			chapters
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	private extractPagesFromHtml(html: string): string[] {
		const $ = cheerio.load(html);
		const pages: string[] = [];
		const seen = new Set<string>();

		const push = (raw: string) => {
			const src = this.absUrl(raw || '');
			if (!src || seen.has(src)) return;
			if (/logo|icon|avatar|spinner|ads|placeholder|banner|emoji/i.test(src)) return;
			if (
				!/\.(jpg|jpeg|png|webp|avif|gif)(\?|$)/i.test(src) &&
				!/\/(images?|uploads?|pages?|cascade)\//i.test(src)
			) {
				return;
			}
			seen.add(src);
			pages.push(src);
		};

		const selectors = [
			'#reader-wrap img.reader-image',
			'#reader-wrap img',
			'img.reader-image',
			'#viewer img',
			'.viewer img',
			'#viewer-container img',
			'.viewer-image img',
			'.reading-content img',
			'#chapter-content img',
			'img[data-original]',
			'img[data-src]',
			'#main-container img'
		];

		for (const sel of selectors) {
			$(sel).each((_, img) => {
				const $img = $(img);
				push(
					$img.attr('data-original') ||
						$img.attr('data-src') ||
						$img.attr('data-lazy-src') ||
						$img.attr('src') ||
						''
				);
			});
			if (pages.length > 0) break;
		}

		if (pages.length === 0) {
			const re = /["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi;
			let m: RegExpExecArray | null;
			while ((m = re.exec(html)) !== null) push(m[1]);
		}

		if (pages.length === 0) {
			$('img').each((_, img) => {
				const $img = $(img);
				push($img.attr('data-original') || $img.attr('data-src') || $img.attr('src') || '');
			});
		}

		return pages;
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		let path = this.cleanId(chapterId);
		if (!path.startsWith('/')) path = `/${path}`;

		if (!path.includes('/view_uploads/') && !path.includes('/viewer/')) {
			const onlyNum = path.replace(/\//g, '');
			if (/^\d+$/.test(onlyNum)) path = `/view_uploads/${onlyNum}`;
		}

		console.log(`[zonatmo] pages input="${chapterId}" path="${path}"`);

		try {
			let html = await this.fetchHtml(path);
			console.log(`[zonatmo] step1 len=${html.length}`);

			if (path.includes('/view_uploads/')) {
				const uniqid =
					html.match(/uniqid\s*[:=]\s*['"]([a-f0-9]{16,})['"]/i)?.[1] ||
					html.match(/["']uniqid["']\s*:\s*["']([a-f0-9]{16,})['"]/i)?.[1] ||
					html.match(/\/viewer\/([a-f0-9]{16,})/i)?.[1] ||
					'';

				if (uniqid) {
					path = `/viewer/${uniqid}/cascade`;
					html = await this.fetchHtml(path);
					console.log(`[zonatmo] cascade len=${html.length} uniqid=${uniqid}`);
				} else {
					const cascadeLink = html.match(
						/href=["']([^"']*\/viewer\/[^"']*cascade[^"']*)["']/i
					)?.[1];
					if (cascadeLink) {
						path = this.cleanId(cascadeLink);
						html = await this.fetchHtml(path);
						console.log(`[zonatmo] cascade-link len=${html.length}`);
					}
				}
			} else if (path.includes('/viewer/') && !path.includes('/cascade')) {
				path = path.replace(/\/?$/, '') + '/cascade';
				html = await this.fetchHtml(path);
			}

			let pages = this.extractPagesFromHtml(html);
			console.log(`[zonatmo] pages=${pages.length}`);

			if (pages.length === 0 && path.includes('/cascade')) {
				const paged = path.replace('/cascade', '/paginated');
				try {
					const html2 = await this.fetchHtml(paged);
					pages = this.extractPagesFromHtml(html2);
					console.log(`[zonatmo] paginated pages=${pages.length}`);
				} catch {
					/* ignore */
				}
			}

			return pages;
		} catch (e) {
			console.error('[zonatmo] getChapterPages error:', e);
			return [];
		}
	}
}
