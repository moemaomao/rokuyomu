import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

/**
 * LectorTMO (lectortmo.vip) — tema manganexus
 *
 * Latest  : /manga/?orderby=date (+ page/2 untuk 24 item)
 * Search  : /?s=QUERY&post_type=manga
 * Detail  : /manga/{slug}/
 * Chapter : /manga-chapter/{slug}-cap-XXX/
 */
export class LectorTmoSource extends BaseSource {
	id = 'lectortmo';
	name = 'LectorTMO';
	baseUrl = 'https://lectortmo.vip';

	private readonly PER_PAGE = 24;

	// ── Helpers ──────────────────────────────────────────────────────────────

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

	private detectType(text: string): 'manga' | 'manhwa' | 'manhua' {
		const t = (text || '').toLowerCase();
		if (/\bmanhwa\b/.test(t)) return 'manhwa';
		if (/\bmanhua\b/.test(t)) return 'manhua';
		if (/\bwebtoon\b/.test(t)) return 'manhwa';
		return 'manga';
	}

	// ── List ─────────────────────────────────────────────────────────────────

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		$('a[href*="/manga/"]').each((_, el) => {
			const $a = $(el);
			const href = $a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			// hanya /manga/{slug}
			if (!/^\/manga\/[^/]+$/.test(id)) return;
			if (seen.has(id)) return;
			seen.add(id);

			const $card = $a.closest(
				'article, .manga-card, .manga-card-compact, .card, .col-6, .col-md-3, .group, li, .grid > div'
			);
			const $ctx = $card.length ? $card : $a.parent();

			let title =
				$a.attr('title')?.trim() ||
				$ctx.find('h2, h3, h4, .title, .manga-title').first().text().trim() ||
				$a.text().replace(/\s+/g, ' ').trim();

			title = title.replace(/\s+/g, ' ').trim();
			if (!title || title.length < 2) {
				title = decodeURIComponent(id.split('/').pop() || '').replace(/-/g, ' ');
			}
			if (/^(biblioteca|inicio|categorias|manga)$/i.test(title)) return;

			const cover =
				$ctx.find('img').attr('data-src') ||
				$ctx.find('img').attr('data-lazy-src') ||
				$ctx.find('img').attr('src') ||
				$a.find('img').attr('data-src') ||
				$a.find('img').attr('src') ||
				'';

			const cardText = $ctx.text().replace(/\s+/g, ' ');
			let latestChapter: number | undefined;
			const capMatch =
				cardText.match(/cap[ií]tulos?\s*(\d+(?:\.\d+)?)/i) ||
				cardText.match(/\b(\d+)\s*cap/i);
			if (capMatch) latestChapter = parseFloat(capMatch[1]);

			out.push({
				id,
				sourceId: this.id,
				title,
				cover: this.absUrl(cover),
				type: this.detectType(cardText),
				latestChapter
			});
		});

		return out;
	}

	private async fetchListPage(path: string): Promise<Manga[]> {
		try {
			const html = await this.fetchHtml(path);
			console.log(`[lectortmo] GET ${path} → html=${html?.length ?? 0}`);
			if (!html || html.length < 500) return [];

			const $ = cheerio.load(html);
			const list = this.parseCards($);
			console.log(
				`[lectortmo] ${path} parsed=${list.length}`,
				list.slice(0, 3).map((m) => `${m.title} [ch ${m.latestChapter ?? '?'}]`)
			);
			return list;
		} catch (e) {
			console.warn('[lectortmo] fetch error', path, e);
			return [];
		}
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		const p = Math.max(1, Number(page) || 1);
		const seen = new Set<string>();
		const merged: Manga[] = [];

		// Site ~12/page → ambil 2 page site per 1 page app
		const paths: string[] =
			p <= 1
				? ['/manga/?orderby=date', '/manga/page/2/?orderby=date']
				: [
						`/manga/page/${(p - 1) * 2 + 1}/?orderby=date`,
						`/manga/page/${(p - 1) * 2 + 2}/?orderby=date`
					];

		for (const path of paths) {
			if (merged.length >= this.PER_PAGE) break;
			const batch = await this.fetchListPage(path);
			for (const m of batch) {
				if (seen.has(m.id)) continue;
				seen.add(m.id);
				merged.push(m);
				if (merged.length >= this.PER_PAGE) break;
			}
		}

		console.log(`[lectortmo] latest page=${p} → ${merged.length} items`);
		return merged.slice(0, this.PER_PAGE);
	}

	async searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page || 1);
		if (!q) return this.getLatestManga(page, opts);

		const path =
			page <= 1
				? `/?s=${encodeURIComponent(q)}&post_type=manga`
				: `/page/${page}/?s=${encodeURIComponent(q)}&post_type=manga`;

		let list = await this.fetchListPage(path);
		if (!list.length) {
			list = await this.fetchListPage(
				`/manga/?s=${encodeURIComponent(q)}${page > 1 ? `&page=${page}` : ''}`
			);
		}
		return list.slice(0, this.PER_PAGE);
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);
		if (!path.startsWith('/manga/')) {
			path = `/manga/${path.replace(/^\//, '')}`;
		}

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title =
			$('h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content')?.split('|')[0]?.trim() ||
			path;

		// Alternative titles
		const altNames: string[] = [];
		const pushAlt = (raw: string) => {
			raw
				.split(/[,;/|]/)
				.map((s) => s.trim())
				.filter((s) => s.length > 1 && s.toLowerCase() !== title.toLowerCase())
				.forEach((s) => {
					if (!altNames.includes(s)) altNames.push(s);
				});
		};

		// Pola label umum
		$('span, div, p, li, dt, dd, h2, h3, h4').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			const m = t.match(
				/(?:t[ií]tulos?\s*alternativos?|alternative\s*titles?|otros?\s*nombres?|nombres?\s*alternativos?)\s*[:：]?\s*(.+)/i
			);
			if (m?.[1]) pushAlt(m[1]);
		});

		// meta / JSON-LD
		const ogTitle = $('meta[property="og:title"]').attr('content') || '';
		if (ogTitle && !ogTitle.toLowerCase().includes(title.toLowerCase().slice(0, 12))) {
			pushAlt(ogTitle.split('|')[0]);
		}
		const ld = html.match(/"alternateName"\s*:\s*\[([^\]]+)\]/i);
		if (ld) {
			const parts = ld[1].match(/"([^"]+)"/g);
			parts?.forEach((p) => pushAlt(p.replace(/"/g, '')));
		}
		const ldOne = html.match(/"alternateName"\s*:\s*"([^"]+)"/i);
		if (ldOne) pushAlt(ldOne[1]);

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('img[class*="aspect-"]').attr('src') ||
			$('img[src*="uploads"]').first().attr('src') ||
			$('img[src*="cover"]').attr('src') ||
			'';
		cover = this.absUrl(cover);

		// Sinopsis
		let synopsis = '';
		$('h2, h3').each((_, el) => {
			const t = $(el).text().toLowerCase();
			if (/sinopsis|detalles/.test(t)) {
				const next = $(el).nextAll('p, div').first().text().replace(/\s+/g, ' ').trim();
				if (next && next.length > synopsis.length) synopsis = next;
			}
		});
		if (!synopsis) {
			synopsis =
				$('meta[name="description"]').attr('content')?.trim() ||
				$('meta[property="og:description"]').attr('content')?.trim() ||
				'';
		}

		const description = [altNames.length ? `Alternative: ${altNames.join(', ')}` : '', synopsis]
			.filter(Boolean)
			.join('\n\n');

		let status = 'Ongoing';
		const bodyText = $('body').text().toLowerCase();
		if (/estado\s*finalizado|\bfinalizado\b/.test(bodyText)) status = 'Completed';
		else if (/en\s*emisi[oó]n/.test(bodyText)) status = 'Ongoing';

		const type = this.detectType(bodyText);

		const genres: string[] = [];
		$('a[href*="manga-genre"], a[href*="/genre/"]').each((_, el) => {
			const g = $(el).text().trim();
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		const authors: string[] = [];
		$('a[href*="author"], a[href*="artista"], a[href*="artist"]').each((_, el) => {
			const a = $(el).text().trim();
			if (a && a.length < 60 && !authors.includes(a)) authors.push(a);
		});

		// Chapters: /manga-chapter/{slug}-cap-XXX/
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('a.chapter-card, a[href*="/manga-chapter/"]').each((_, el) => {
			const $a = $(el);
			const href = $a.attr('href') || '';
			if (!href.includes('/manga-chapter/')) return;

			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			const numMatch =
				id.match(/cap[_-]?(\d+)(?:[_-](\d+))?/i) || $a.text().match(/(\d+(?:\.\d+)?)/);
			let number = 0;
			if (numMatch) {
				number = numMatch[2]
					? parseFloat(`${parseInt(numMatch[1], 10)}.${numMatch[2]}`)
					: parseFloat(numMatch[1]);
			}

			const date =
				$a.find('time, .date, span').last().text().replace(/\s+/g, ' ').trim() || '';

			chapters.push({
				id,
				title:
					Number.isFinite(number) && number > 0
						? `Capítulo ${number}`
						: $a.text().replace(/\s+/g, ' ').trim() || id,
				number: number || chapters.length + 1,
				date
			});
		});

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));
		const latestChapter = chapters[0]?.number;

		console.log(
			`[lectortmo] details ${path} chapters=${chapters.length} latest=${latestChapter} alts=${altNames.length}`
		);

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			type,
			status,
			description,
			authors,
			genres,
			chapters,
			latestChapter
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		let path = this.cleanId(chapterId);
		if (!path.includes('/manga-chapter/')) {
			path = `/manga-chapter/${path.replace(/^\//, '')}`;
		}

		console.log(`[lectortmo] pages path=${path}`);

		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const pages: string[] = [];
			const seen = new Set<string>();

			const push = (raw: string) => {
				const src = this.absUrl((raw || '').trim());
				if (!src || seen.has(src)) return;
				if (/logo|icon|avatar|spinner|ads|placeholder|banner|emoji|logofml/i.test(src)) return;
				if (
					!/\.(webp|jpg|jpeg|png|avif|gif)(\?|$)/i.test(src) &&
					!/mangax|uploads|chapter/i.test(src)
				) {
					return;
				}
				seen.add(src);
				pages.push(src);
			};

			$('img').each((_, img) => {
				const $img = $(img);
				push(
					$img.attr('data-src') ||
						$img.attr('data-lazy-src') ||
						$img.attr('data-original') ||
						$img.attr('src') ||
						''
				);
			});

			if (pages.length < 2) {
				const re = /["'](https?:\/\/[^"']+\.(?:webp|jpg|jpeg|png)[^"']*)["']/gi;
				let m: RegExpExecArray | null;
				while ((m = re.exec(html)) !== null) push(m[1]);
			}

			console.log(`[lectortmo] pages=${pages.length}`);
			return pages;
		} catch (e) {
			console.error('[lectortmo] getChapterPages', e);
			return [];
		}
	}

}

