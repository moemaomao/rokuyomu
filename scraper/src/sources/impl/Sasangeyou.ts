/**
 * Sasangeyou adapter (sasangeyou.net)
 *
 * Theme: Themesia / mangareader
 * Latest : homepage "Project Update" + "Latest Update" digabung → 24 judul
 * Page 2+: /manga/page/{n}/?order=update
 * Search : /?s={query}
 * Detail : /manga/{slug}/
 * Chapter: /{chapter-slug}/  (flat path, bukan di bawah /manga/)
 * Pages  : ts_reader.run → sources[].images (cdn.sasangeyouku.my.id)
 *
 * ID format:
 *   manga   : /manga/{slug}
 *   chapter : /{chapter-slug}
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class SasangeyouSource extends BaseSource {
	id = 'sasangeyou';
	name = 'Sasangeyou';
	baseUrl = 'https://sasangeyou.net';

	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'id';

	private absUrl(url: string): string {
		if (!url) return '';
		url = url.trim();
		if (url.includes(' ')) url = url.split(/\s+/)[0];
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

	private normalizeTitle(raw: string): string {
		if (!raw) return '';
		return raw
			.trim()
			.replace(/\s+/g, ' ')
			.replace(/\s*\|\s*sasangeyou\.net.*$/i, '')
			.replace(/\s*Bahasa Indonesia\s*$/i, '')
			.trim();
	}

	private parseChapterNumber(text: string, path = ''): number {
		const t = String(text || '');
		if (/\bbatch\b/i.test(t) || /\bbatch\b/i.test(path)) return NaN;

		const fromPath = String(path).match(
			/chapter[_-]?(\d+)(?:[.-](\d+))?/i
		);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null && fromPath[2].length <= 2) {
				return parseFloat(`${major}.${fromPath[2]}`);
			}
			return major;
		}
		const m = t.match(/(?:chapter|chap|ch\.?)\s*(\d+)(?:[.,](\d+))?/i);
		if (m) {
			if (m[2] != null && m[2].length <= 2) {
				return parseFloat(`${m[1]}.${m[2]}`);
			}
			return parseInt(m[1], 10);
		}
		const n = t.match(/\b(\d+(?:\.\d{1,2})?)\b/);
		return n ? parseFloat(n[1]) : NaN;
	}

	private mapStatus(raw?: string | null): string {
		const s = String(raw || '').toLowerCase();
		if (/\b(completed|complete|tamat|selesai|end|finish)\b/.test(s))
			return 'Completed';
		if (/\bhiatus\b/.test(s)) return 'Hiatus';
		if (/\b(cancelled|dropped|canceled)\b/.test(s)) return 'Cancelled';
		return 'Ongoing';
	}

	private mapType(raw: string): 'manga' | 'manhwa' | 'manhua' {
		const t = String(raw || '').toLowerCase();
		if (t.includes('manhwa')) return 'manhwa';
		if (t.includes('manhua')) return 'manhua';
		return 'manga';
	}

	private imgSrc($img: cheerio.Cheerio<any>): string {
		const raw =
			$img.attr('data-src') ||
			$img.attr('data-lazy-src') ||
			$img.attr('src') ||
			'';
		return (raw || '').trim().split(/\s+/)[0];
	}

	/** Parse kartu .bsx (Themesia) */
	private parseBsxCards($: cheerio.CheerioAPI): Manga[] {
		const mangas: Manga[] = [];
		const seen = new Set<string>();

		$('.bsx, .listupd .bs, .bixbox .bs').each((_, el) => {
			const $el = $(el);
			const $a =
				$el.find('a[href*="/manga/"]').first().length > 0
					? $el.find('a[href*="/manga/"]').first()
					: $el.find('a').first();
			const href = ($a.attr('href') || '').split('?')[0];
			if (!href || !/\/manga\//i.test(href)) return;
			if (/\/manga\/?(feed)?\/?$/i.test(href)) return;

			const id = this.cleanId(href);
			if (!/^\/manga\/[^/]+$/i.test(id) || seen.has(id)) return;
			const slug = id.split('/').pop() || '';
			if (!slug || slug === 'feed' || slug === 'page') return;
			seen.add(id);

			const title = this.normalizeTitle(
				$el.find('.tt').first().text() ||
					$a.attr('title') ||
					$a.find('img').attr('alt') ||
					slug
			);

			const $img = $el.find('img').first();
			const cover = this.absUrl(this.imgSrc($img));

			const status = this.mapStatus(
				$el.find('.status').first().text() ||
					$el.find('.status').attr('class')
			);

			let type: 'manga' | 'manhwa' | 'manhua' = 'manga';
			const typeText = $el.find('.type, .typeflag').text() || '';
			type = this.mapType(typeText || title);

			let latestChapter: string | undefined;
			const epxs = $el.find('.epxs').first().text().trim();
			const n = this.parseChapterNumber(epxs);
			if (Number.isFinite(n) && n > 0) latestChapter = String(n);

			mangas.push({
				id,
				title,
				cover,
				sourceId: this.id,
				status,
				type,
				lang: this.DEFAULT_LANG,
				latestChapter
			});
		});

		// fallback: any manga link with nearby cover
		if (mangas.length === 0) {
			$('a[href*="/manga/"]').each((_, el) => {
				const href = ($(el).attr('href') || '').split('?')[0];
				const id = this.cleanId(href);
				if (!/^\/manga\/[^/]+$/i.test(id) || seen.has(id)) return;
				const slug = id.split('/').pop() || '';
				if (!slug || slug === 'feed') return;
				seen.add(id);

				const $a = $(el);
				const $img = $a.find('img').first();
				const title = this.normalizeTitle(
					$a.attr('title') || $img.attr('alt') || slug
				);
				mangas.push({
					id,
					title,
					cover: this.absUrl(this.imgSrc($img)),
					sourceId: this.id,
					status: 'Ongoing',
					type: 'manga',
					lang: this.DEFAULT_LANG
				});
			});
		}

		return mangas;
	}

	/**
	 * Homepage: gabung Project Update + Latest Update (dedupe, target 24)
	 */
	private parseHomeSections(html: string): Manga[] {
		const $ = cheerio.load(html);
		const map = new Map<string, Manga>();
		const order: string[] = [];

		const pushAll = (list: Manga[]) => {
			for (const m of list) {
				if (!map.has(m.id)) order.push(m.id);
				const prev = map.get(m.id);
				if (!prev) {
					map.set(m.id, m);
				} else {
					map.set(m.id, {
						...prev,
						...m,
						latestChapter: m.latestChapter || prev.latestChapter,
						cover: m.cover || prev.cover
					});
				}
			}
		};

		// potong HTML per section bila ada heading
		const lower = html;
		const idxProj = lower.search(/Project\s*Update/i);
		const idxLatest = lower.search(/Latest\s*Update/i);

		if (idxProj >= 0 && idxLatest > idxProj) {
			const projHtml = html.slice(idxProj, idxLatest);
			const latestHtml = html.slice(idxLatest);
			pushAll(this.parseBsxCards(cheerio.load(projHtml)));
			pushAll(this.parseBsxCards(cheerio.load(latestHtml)));
		} else {
			// fallback: semua kartu di halaman
			pushAll(this.parseBsxCards($));
		}

		return order.map((id) => map.get(id)!).filter(Boolean);
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);

			if (p === 1) {
				const homeHtml = await this.fetchHtml('/');
				let list = this.parseHomeSections(homeHtml);
				console.log(`[sasangeyou] home sections → ${list.length}`);

				// pastikan 24: isi dari /manga/?order=update
				if (list.length < this.PER_PAGE) {
					const updHtml = await this.fetchHtml(
						'/manga/?order=update'
					);
					const fill = this.parseBsxCards(cheerio.load(updHtml));
					const seen = new Set(list.map((m) => m.id));
					for (const m of fill) {
						if (seen.has(m.id)) continue;
						seen.add(m.id);
						list.push(m);
						if (list.length >= this.PER_PAGE) break;
					}
					console.log(`[sasangeyou] home+fill → ${list.length}`);
				}

				return list.slice(0, this.PER_PAGE);
			}

			// page 2+: manga list by update
			const path =
				p === 2
					? '/manga/page/2/?order=update'
					: `/manga/page/${p}/?order=update`;
			const html = await this.fetchHtml(path);
			const list = this.parseBsxCards(cheerio.load(html));
			console.log(`[sasangeyou] page=${p} → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[sasangeyou] getLatestManga', e);
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
			const list = this.parseBsxCards(cheerio.load(html));
			console.log(`[sasangeyou] search "${q}" → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[sasangeyou] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);

		// chapter flat URL → tidak bisa reverse slug dengan mudah; biarkan path manga
		if (!path.startsWith('/manga/')) {
			path = `/manga/${path.replace(/^\//, '')}`;
		}
		path = path.replace(/\/+$/, '');

		const html = await this.fetchHtml(path.endsWith('/') ? path : path + '/');
		const $ = cheerio.load(html);

		let title =
			$('h1.entry-title').first().text().trim() ||
			$('meta[property="og:title"]').attr('content') ||
			$('.infox h1').first().text().trim() ||
			path;
		title = this.normalizeTitle(title);

		let cover =
			$('.thumbook img, .thumb img, .seriestualcover img')
				.first()
				.attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			$('.thumbook img').attr('data-src') ||
			'';
		cover = this.absUrl((cover || '').trim().split(/\s+/)[0]);

		let description =
			$('.entry-content[itemprop="description"]').text().trim() ||
			$('.seriestucontent .entry-content').text().trim() ||
			$('.desc, .description, [itemprop="description"]').text().trim() ||
			$('meta[property="og:description"]').attr('content') ||
			'';
		description = description.replace(/\s+/g, ' ').trim();

		const authors: string[] = [];
		const infoMap: Record<string, string> = {};
		$('.infotable tr, .fmed, .imptdt').each((_, el) => {
			const $el = $(el);
			const label = $el.find('b, th, .ft').first().text().trim().toLowerCase();
			const value = $el.find('td, span, a, i').last().text().trim();
			if (label) infoMap[label] = value;
		});
		// Themesia alternate
		$('.infox .fmed').each((_, el) => {
			const b = $(el).find('b').first().text().trim().toLowerCase();
			const v = $(el).find('span').text().trim();
			if (b) infoMap[b] = v;
		});
		$('.tsinfo .imptdt').each((_, el) => {
			const t = $(el).text();
			const m = t.match(/^\s*([^:]+)\s*(.+)$/);
			if (m) infoMap[m[1].trim().toLowerCase()] = m[2].trim();
		});

		for (const key of ['author', 'artist', 'pengarang', 'author ']) {
			const v = infoMap[key] || infoMap[key.trim()];
			if (v && v !== '-' && v !== '?') {
				for (const a of v.split(/[,&]/)) {
					const name = a.trim();
					if (name && !authors.includes(name)) authors.push(name);
				}
			}
		}

		const genres: string[] = [];
		$('.mgen a, .seriestugenre a, span.mgen a[rel="tag"]').each((_, el) => {
			const g = $(el).text().trim();
			if (
				g &&
				!/^(manhwa|manhua|manga|doujin)$/i.test(g) &&
				!genres.includes(g)
			) {
				genres.push(g);
			}
		});

		const status = this.mapStatus(
			infoMap['status'] ||
				$('.status').first().text() ||
				$('.imptdt:contains("Status") i, .imptdt:contains("Status") span')
					.last()
					.text()
		);

		let type: 'manga' | 'manhwa' | 'manhua' = 'manga';
		const typeRaw =
			infoMap['type'] ||
			infoMap['tipe'] ||
			$('.imptdt:contains("Type") i').text() ||
			'';
		type = this.mapType(typeRaw);

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('#chapterlist li, .eplister li, #chapterlist .chbox').each((_, el) => {
			const $li = $(el);
			const $a = $li.find('a').first();
			const href = $a.attr('href') || '';
			if (!href || href.includes('rekonise') || href.includes('lynk.id'))
				return;
			// skip pure download links
			if ($a.hasClass('dload')) return;

			const id = this.cleanId(href);
			if (seen.has(id) || id === '/' || id.startsWith('/manga/')) {
				// chapter flat path should not be /manga/
				if (id.startsWith('/manga/')) return;
			}
			if (!id || id === '/') return;
			if (seen.has(id)) return;

			const numAttr = $li.attr('data-num') || '';
			const chText =
				$li.find('.chapternum').text() || $a.text() || numAttr;
			if (/\bbatch\b/i.test(chText) || /\bbatch\b/i.test(numAttr)) {
				return; // skip batch pack
			}

			const number = this.parseChapterNumber(chText || numAttr, id);
			if (!Number.isFinite(number) || number <= 0) return;

			seen.add(id);
			const date =
				$li.find('.chapterdate').text().trim() ||
				$li.find('.dt').text().trim() ||
				'';

			chapters.push({
				id,
				title: `Chapter ${number}`,
				number,
				date
			});
		});

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const latestChapter =
			chapters.length && chapters[0].number != null
				? String(chapters[0].number)
				: undefined;

		const metaLines = [
			authors.length && `Author: ${authors.join(' · ')}`,
			chapters[0]?.date && `Latest: ${chapters[0].date}`,
			`Language: Indonesian`,
			`Type: ${type}`,
			chapters.length && `Chapters: ${chapters.length}`
		].filter(Boolean);

		const fullDescription = [...metaLines, description]
			.filter(Boolean)
			.join('\n');

		console.log(
			`[sasangeyou] details ${path} → ch=${chapters.length} status=${status}`
		);

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			description: fullDescription,
			authors,
			genres,
			status,
			chapters,
			type,
			latestChapter,
			lang: this.DEFAULT_LANG
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(
			chapterId.startsWith('/') ? chapterId : `/${chapterId}`
		);

		const maxAttempts = 3;
		let lastErr: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const html = await this.fetchHtml(
					path.endsWith('/') ? path : path + '/'
				);
				const images: string[] = [];
				const seen = new Set<string>();

				const push = (src: string) => {
					src = this.absUrl((src || '').trim().split(/\s+/)[0]);
					if (
						!src ||
						seen.has(src) ||
						!/^https?:\/\//i.test(src) ||
						src.startsWith('data:') ||
						/logo|icon|avatar|spinner|ads|banner|placeholder|gravatar|emoji|loyalty|safesearch|doujin-sasangeyou/i.test(
							src
						) ||
						/\.gif(\?|$)/i.test(src)
					) {
						return;
					}
					seen.add(src);
					images.push(src);
				};

				// ts_reader.run
				const tsMatch = html.match(
					/ts_reader\.run\((\{[\s\S]*?\})\);/
				);
				if (tsMatch) {
					try {
						const data = JSON.parse(tsMatch[1]);
						const sources = data?.sources || [];
						for (const src of sources) {
							const imgs = src?.images || [];
							for (const u of imgs) push(String(u));
						}
					} catch (e) {
						console.warn('[sasangeyou] ts_reader parse', e);
						// regex images from sources
						const imgRe =
							/https?:\\\/\\\/[^"\\]+?\.(?:jpg|jpeg|png|webp)/gi;
						const found = tsMatch[1].match(imgRe) || [];
						for (const u of found) {
							push(u.replace(/\\\//g, '/'));
						}
					}
				}

				// #readerarea fallback
				if (images.length === 0) {
					const $ = cheerio.load(html);
					$('#readerarea img, .reader-area img, .rdminimal img').each(
						(_, img) => {
							push(this.imgSrc($(img)));
						}
					);
				}

				if (images.length === 0) {
					console.warn(
						`[sasangeyou] 0 pages attempt=${attempt}`,
						path,
						'htmlLen=',
						html.length
					);
					lastErr = new Error('Sasangeyou chapter has 0 images');
					await new Promise((r) => setTimeout(r, 400 * attempt));
					continue;
				}

				console.log(`[sasangeyou] ${images.length} pages → ${path}`);
				return images;
			} catch (e) {
				lastErr = e;
				console.error(
					`[sasangeyou] getChapterPages attempt=${attempt}`,
					path,
					e
				);
				if (attempt < maxAttempts) {
					await new Promise((r) => setTimeout(r, 500 * attempt));
				}
			}
		}

		console.error('[sasangeyou] getChapterPages failed', path, lastErr);
		return [];
	}
}
