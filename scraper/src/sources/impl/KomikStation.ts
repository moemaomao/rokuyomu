import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

/**
 * komikstation.org adapter (MangaStream)
 *
 * List   : /manga/?order=update  |  /manga/?order=update&page={n}
 * Search : /?s=QUERY  (fallback: WP categories API)
 * Detail : /manga/{slug}/
 * Chapter: /{slug}-chapter-{n}/
 *
 * ID format:
 *   manga   : "/manga/{slug}"
 *   chapter : "/{slug}-chapter-{n}"
 */
export class KomikStationSource extends BaseSource {
	id = 'komikstation';
	name = 'KomikStation';
	baseUrl = 'https://komikstation.org';

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
		return id.replace(/\/+$/, '') || '/';
	}

	private parseChapterNumber(text: string): number {
		const m = String(text).match(
			/(?:chapter|chap|ch\.?|episode|ep\.?)\s*(\d+(?:\.\d+)?)/i
		);
		if (m) return parseFloat(m[1]);
		const n = String(text).match(/(\d+(?:\.\d+)?)/);
		return n ? parseFloat(n[1]) : NaN;
	}

	private imgSrc($el: cheerio.Cheerio<any>): string {
		const candidates = [
			$el.attr('data-src'),
			$el.attr('data-lazy-src'),
			$el.attr('data-original'),
			$el.attr('src')
		];
		for (const c of candidates) {
			if (!c || c.startsWith('data:')) continue;
			if (/flags\/|svg|placeholder|spinner|logo|avatar/i.test(c)) continue;
			return c;
		}
		return '';
	}

	private detectType(text: string): 'manga' | 'manhwa' | 'manhua' {
		const t = (text || '').toLowerCase();
		if (/\bmanhwa\b/.test(t)) return 'manhwa';
		if (/\bmanhua\b/.test(t)) return 'manhua';
		if (/\bwebtoon\b/.test(t)) return 'manhwa';
		return 'manga';
	}

	// ── List parser ──────────────────────────────────────────────────────────

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		$('.listupd .bs, .bs .bsx').each((_, el) => {
			const $el = $(el);
			const a = $el.find('a[href*="/manga/"]').first();
			const href = a.attr('href') || '';
			if (!href) return;

			const id = this.cleanId(href);
			if (!/^\/manga\/[^/]+$/.test(id)) return;
			if (seen.has(id)) return;
			seen.add(id);

			let title =
				a.attr('title') ||
				$el.find('.tt').first().text() ||
				a.text() ||
				'';
			title = title.replace(/\s+/g, ' ').trim();
			if (!title || title.length < 2) return;

			// cover: skip flag icons
			let cover = '';
			$el.find('img').each((__, img) => {
				if (cover) return;
				const src = this.imgSrc($(img));
				if (src) cover = src;
			});
			cover = this.absUrl((cover || '').split('?')[0]);

			const chText = $el.find('.epxs').first().text() || '';
			const chNum = this.parseChapterNumber(chText);
			const latestChapter = Number.isFinite(chNum) && chNum >= 0 ? chNum : undefined;

			const typeClass =
				$el.find('.type').attr('class') ||
				$el.find('.type').attr('title') ||
				$el.find('.type').text() ||
				'';
			const type = this.detectType(typeClass + ' ' + $el.text());

			let status = 'Ongoing';
			if (/complete|selesai|tamat|end/i.test($el.text())) status = 'Completed';

			out.push({
				id,
				sourceId: this.id,
				title,
				cover,
				type,
				status,
				latestChapter
			});
		});

		return out;
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
	page: number,
	_opts?: { lang?: string; type?: string }
): Promise<Manga[]> {
	try {
		const p = Math.max(1, Number(page) || 1);
		// Proyek Komikstation: /project-list/ (~20/page) → gabung 2 page situs utk dapat 24
		const siteStart = (p - 1) * 2 + 1;
		const paths = [
			siteStart <= 1 ? `/project-list/` : `/project-list/page/${siteStart}/`,
			`/project-list/page/${siteStart + 1}/`
		];

		const seen = new Set<string>();
		const merged: Manga[] = [];

		for (const path of paths) {
			if (merged.length >= this.PER_PAGE) break;
			const html = await this.fetchHtml(path);
			if (!html || html.length < 5000 || /just a moment/i.test(html)) {
				console.error('[komikstation] blocked or empty', path);
				continue;
			}
			const $ = cheerio.load(html);
			const batch = this.parseCards($);
			for (const m of batch) {
				if (seen.has(m.id)) continue;
				seen.add(m.id);
				merged.push(m);
				if (merged.length >= this.PER_PAGE) break;
			}
		}

		console.log(`[komikstation] project page=${p} → ${merged.length}`);
		return merged.slice(0, this.PER_PAGE);
	} catch (e) {
		console.error('[komikstation] getLatestManga', e);
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

		// 1) Coba HTML search
		try {
			const path =
				page <= 1
					? `/?s=${encodeURIComponent(q)}`
					: `/page/${page}/?s=${encodeURIComponent(q)}`;
			const html = await this.fetchHtml(path);
			if (html && html.length > 10000 && !/just a moment/i.test(html)) {
				const $ = cheerio.load(html);
				const list = this.parseCards($);
				if (list.length) {
					console.log(`[komikstation] search html "${q}" → ${list.length}`);
					return list.slice(0, this.PER_PAGE);
				}
			}
		} catch {
			/* fallback below */
		}

		// 2) Fallback WP categories API
		try {
			const cats = await this.fetchJson<any[]>(
				`/wp-json/wp/v2/categories?search=${encodeURIComponent(q)}&per_page=${this.PER_PAGE}&page=${page}`
			);
			const list: Manga[] = [];
			const seen = new Set<string>();
			if (Array.isArray(cats)) {
				for (const c of cats) {
					const slug = c.slug || '';
					if (!slug || seen.has(slug) || (c.count ?? 0) < 1) continue;
					seen.add(slug);
					list.push({
						id: `/manga/${slug}`,
						sourceId: this.id,
						title: String(c.name || slug)
							.replace(/&#8217;/g, "'")
							.replace(/&amp;/g, '&')
							.trim(),
						cover: '',
						type: 'manga',
						status: 'Ongoing',
						latestChapter: c.count || undefined
					});
				}
			}
			console.log(`[komikstation] search api "${q}" → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[komikstation] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);

		if (/-chapter-[\d.]+/i.test(path) && !path.startsWith('/manga/')) {
			const slug = path.replace(/^\//, '').replace(/-chapter-[\d.]+.*$/i, '');
			if (slug) path = `/manga/${slug}`;
		}
		if (!path.startsWith('/manga/')) {
			path = `/manga/${path.replace(/^\//, '')}`;
		}

		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		let title =
			$('h1.entry-title, h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]').attr('content') ||
			'Unknown';
		title = title
			.replace(/\s*Bahasa Indonesia.*$/i, '')
			.replace(/\s*[-|].*KomikStation.*$/i, '')
			.trim();

		let cover =
			this.imgSrc($('.thumb img, .seriestuimg img, img.wp-post-image').first()) ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = this.absUrl((cover || '').split('?')[0]);

		let status = 'Ongoing';
		$('.imptdt').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ');
			if (/status/i.test(t)) {
				if (/selesai|complete|tamat|end/i.test(t)) status = 'Completed';
				else if (/hiatus/i.test(t)) status = 'Hiatus';
				else if (/berjalan|ongoing/i.test(t)) status = 'Ongoing';
			}
		});

		let type: 'manga' | 'manhwa' | 'manhua' = 'manga';
		$('.imptdt').each((_, el) => {
			const t = $(el).text();
			if (/tipe|type/i.test(t)) type = this.detectType(t);
		});

		const authors: string[] = [];
		$('.fmed').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ');
			if (/penulis|author|ilustrator|artist/i.test(t)) {
				const val = t
					.replace(/.*(Penulis|Author|Ilustrator|Artist)\s*/i, '')
					.trim();
				for (const part of val.split(/,|&/)) {
					const n = part.trim();
					if (n && n !== '-' && !authors.includes(n)) authors.push(n);
				}
			}
		});

		let alt = '';
		$('.wd-full').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ');
			if (/judul alternatif|alternative/i.test(t)) {
				alt = t.replace(/.*(Judul Alternatif|Alternative)\s*/i, '').trim();
			}
		});

		const genres: string[] = [];
		$('.seriestugenre a, .mgen a, a[rel="tag"]').each((_, a) => {
			const g = $(a).text().trim();
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		let synopsis = '';
		$('.wd-full').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (/sinopsis|synopsis/i.test(t) && t.length > 40) {
				synopsis = t.replace(/.*(Sinopsis|Synopsis)\s*/i, '').trim();
			}
		});
		if (!synopsis) {
			synopsis =
				$('.entry-content').first().text().replace(/\s+/g, ' ').trim() ||
				$('meta[name="description"]').attr('content') ||
				'';
		}

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		$('#chapterlist li, .eplister li').each((_, li) => {
			const $li = $(li);
			const a = $li.find('a').first();
			const href = a.attr('href') || '';
			if (!href) return;
			const id = this.cleanId(href);
			if (!/-chapter-/i.test(id)) return;
			if (seen.has(id)) return;
			seen.add(id);

			const chTitle = (a.find('.chapternum').text() || a.text())
				.replace(/\s+/g, ' ')
				.trim();
			const date = $li.find('.chapterdate').text().replace(/\s+/g, ' ').trim() || '';
			const fromPath = id.match(/-chapter-(\d+(?:\.\d+)?)/i);
			let number = fromPath ? parseFloat(fromPath[1]) : this.parseChapterNumber(chTitle);
			if (!Number.isFinite(number)) number = chapters.length + 1;

			chapters.push({
				id,
				title: /chapter|ch\./i.test(chTitle) ? chTitle : `Chapter ${number}`,
				number,
				date
			});
		});

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));
		const latestChapter = chapters[0]?.number;

		const description = [
			alt && `Alternative: ${alt}`,
			latestChapter != null && `Latest chapter: ${latestChapter}`,
			synopsis
		]
			.filter(Boolean)
			.join('\n\n');

		console.log(`[komikstation] details ${path} → ch=${chapters.length}`);

		return {
			id: path.replace(/\/+$/, ''),
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
		const path = this.cleanId(chapterId);
		if (!/-chapter-/i.test(path)) {
			console.error('[komikstation] not a chapter path', chapterId);
			return [];
		}

		try {
			const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
			const $ = cheerio.load(html);
			const urls: string[] = [];
			const seen = new Set<string>();

			$('#readerarea img, .entry-content img').each((_, img) => {
				let src = this.imgSrc($(img));
				if (!src || src.startsWith('data:')) return;
				src = this.absUrl(src.split('?')[0]);
				if (!/^https?:\/\//i.test(src)) return;
				if (/logo|icon|avatar|ads|banner|emoji|gravatar|flags\//i.test(src)) return;
				if (seen.has(src)) return;
				seen.add(src);
				urls.push(src);
			});

			console.log(`[komikstation] ${urls.length} pages → ${path}`);
			return urls;
		} catch (e) {
			console.error('[komikstation] getChapterPages', path, e);
			return [];
		}
	}
}