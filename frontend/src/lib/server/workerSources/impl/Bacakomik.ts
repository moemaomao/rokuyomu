import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class BacaKomikSource extends BaseSource {
	id = 'bacakomik';
	name = 'BacaKomik';
	baseUrl = 'https://bacakomik.pics';
	badge = 'Indo';

	private readonly PER_PAGE = 24;
	private readonly LIST_LANG = 'id';

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
		const s = String(text || '');
		const m =
			s.match(/chapter[\s_-]*(\d+(?:\.\d+)?)/i) ||
			s.match(/\bch\.?\s*(\d+(?:\.\d+)?)/i) ||
			s.match(/(\d+(?:\.\d+)?)/);
		return m ? parseFloat(m[1]) : 0;
	}

	private detectType(text: string): 'manga' | 'manhwa' | 'manhua' {
		const t = (text || '').toLowerCase();
		if (/\bmanhwa\b/.test(t)) return 'manhwa';
		if (/\bmanhua\b/.test(t)) return 'manhua';
		if (/\btoon\b/.test(t)) return 'manhwa';
		return 'manga';
	}

	private seriesIdFromChapter(path: string): string | null {
		const p = this.cleanId(path);
		const m = p.match(/^\/chapter\/(.+?)-chapter-[\d.]+/i);
		if (m?.[1]) return `/series/${m[1]}`;
		const m2 = p.match(/^\/chapter\/(.+)$/i);
		if (m2?.[1]) {
			const slug = m2[1].replace(/-chapter-[\d.]+.*$/i, '');
			if (slug) return `/series/${slug}`;
		}
		return null;
	}

	private maxChapterFromHtml(html: string): number | undefined {
		const m = html.match(/const\s+chapterData\s*=\s*(\[[\s\S]*?\]);/);
		if (!m) return undefined;
		try {
			const data = JSON.parse(m[1]) as Array<{ title?: string; url?: string }>;
			let max = 0;
			for (const item of data) {
				const n =
					this.parseChapterNumber(item?.url || '') ||
					this.parseChapterNumber(item?.title || '');
				if (n > max) max = n;
			}
			return max > 0 ? max : undefined;
		} catch {

			const nums = [...html.matchAll(/chapter[\s_-]*(\d+(?:\.\d+)?)/gi)].map((x) =>
				parseFloat(x[1])
			);
			const max = nums.length ? Math.max(...nums) : 0;
			return max > 0 ? max : undefined;
		}
	}

	private async fillLatestChapters(list: Manga[]): Promise<Manga[]> {
		const need = list.filter((m) => m.latestChapter == null || m.latestChapter === 0);
		if (!need.length) return list;

		const concurrency = 6;
		const results = new Map<string, number>();

		for (let i = 0; i < need.length; i += concurrency) {
			const batch = need.slice(i, i + concurrency);
			await Promise.all(
				batch.map(async (m) => {
					try {
						const path = m.id.endsWith('/') ? m.id : `${m.id}/`;
						const html = await this.fetchHtml(path);
						const n = this.maxChapterFromHtml(html);
						if (n != null) results.set(m.id, n);
					} catch (e) {
						console.warn('[bacakomik] fillLatestChapters failed', m.id, e);
					}
				})
			);
		}

		return list.map((m) => {
			const n = results.get(m.id);
			if (n == null) {
				return { ...m, lang: this.LIST_LANG };
			}
			return { ...m, latestChapter: n, lang: this.LIST_LANG };
		});
	}

	private extractPostCardsHtml(html: string): string[] {
		const m = html.match(/const\s+postCards\s*=\s*(\[[\s\S]*?\]);/);
		if (!m) return [];
		try {
			const arr = JSON.parse(m[1].replace(/\\'/g, "'")) as string[];
			return Array.isArray(arr) ? arr : [];
		} catch {
			const parts: string[] = [];
			const re = /<a class=\\"card[^"]*\\"[\s\S]*?<\\\/a>/g;
			let x: RegExpExecArray | null;
			while ((x = re.exec(m[1])) !== null) {
				parts.push(
					x[0].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\r/g, '')
				);
			}
			return parts;
		}
	}

	private parseCardHtml(fragment: string): Manga | null {
		const html = fragment
			.replace(/\\"/g, '"')
			.replace(/\\\//g, '/')
			.replace(/\\n/g, '\n')
			.replace(/\\r/g, '');
		const $ = cheerio.load(html);
		const a = $('a.card, a[href*="/series/"]').first();
		const href = a.attr('href') || '';
		const id = this.cleanId(href);
		if (!/^\/series\/[^/]+$/.test(id)) return null;

		const title = (
			a.find('.card-title').text() ||
			a.find('img').attr('alt') ||
			a.attr('title') ||
			''
		)
			.replace(/\s+/g, ' ')
			.trim();
		if (!title) return null;

		const cover =
			a.find('img').attr('src') || a.find('img').attr('data-src') || '';
		const typeText = a.find('.cpt-label').text() || a.attr('class') || '';
		const statusText = a.find('.status-label').text() || '';
		const status = /complete|finished|end/i.test(statusText)
			? 'Completed'
			: 'Ongoing';

		const cardText = $.root().text();
		const chFromCard = this.parseChapterNumber(
			a.find('.chapter, .ch, .epxs, .episode').text() ||
				cardText.match(/chapter[\s_-]*\d+(?:\.\d+)?/i)?.[0] ||
				''
		);

		return {
			id,
			sourceId: this.id,
			title,
			cover: this.absUrl((cover || '').split('?')[0]),
			type: this.detectType(typeText),
			status,
			lang: this.LIST_LANG,
			...(chFromCard > 0 ? { latestChapter: chFromCard } : {})
		};
	}

	private parseListHtml(html: string): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		for (const frag of this.extractPostCardsHtml(html)) {
			const m = this.parseCardHtml(frag);
			if (!m || seen.has(m.id)) continue;
			seen.add(m.id);
			out.push(m);
		}

		if (!out.length) {
			const $ = cheerio.load(html);
			$(
				'#komik-grid a.card, a.card[href*="/series/"], a[href*="/series/"]'
			).each((_, el) => {
				const $a = $(el);
				const id = this.cleanId($a.attr('href') || '');
				if (!/^\/series\/[^/]+$/.test(id) || seen.has(id)) return;
				seen.add(id);
				const title = (
					$a.find('.card-title').text() ||
					$a.find('img').attr('alt') ||
					$a.attr('title') ||
					$a.text() ||
					''
				)
					.replace(/\s+/g, ' ')
					.trim();
				if (!title || title.length < 2) return;
				const cover =
					$a.find('img').attr('src') ||
					$a.find('img').attr('data-src') ||
					$a.closest('div, article').find('img').first().attr('src') ||
					'';
				const typeText =
					$a.find('.cpt-label').text() || $a.attr('class') || '';
				const statusText = $a.find('.status-label').text() || '';
				const parentText = $a.parent().text();
				const chFromCard = this.parseChapterNumber(
					$a.find('.chapter, .ch, .epxs').text() ||
						parentText.match(/chapter[\s_-]*\d+(?:\.\d+)?/i)?.[0] ||
						''
				);

				out.push({
					id,
					sourceId: this.id,
					title,
					cover: this.absUrl((cover || '').split('?')[0]),
					type: this.detectType(typeText),
					status: /complete/i.test(statusText) ? 'Completed' : 'Ongoing',
					lang: this.LIST_LANG,
					...(chFromCard > 0 ? { latestChapter: chFromCard } : {})
				});
			});
		}

		return out;
	}

	private async fetchListPage(path: string): Promise<Manga[]> {
		try {
			const html = await this.fetchHtml(path);
			if (!html || html.length < 500) return [];
			const list = this.parseListHtml(html);
			console.log(`[bacakomik] ${path} → ${list.length} items`);
			return list;
		} catch (e) {
			console.warn('[bacakomik] fetchListPage', path, e);
			return [];
		}
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const siteStart = (p - 1) * 2 + 1;
			const paths = [
				siteStart <= 1 ? `/series/` : `/series/page/${siteStart}/`,
				`/series/page/${siteStart + 1}/`
			];

			const seen = new Set<string>();
			const merged: Manga[] = [];

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

			// homepage fallback
			if (!merged.length && p <= 1) {
				const home = await this.fetchListPage(`/`);
				for (const m of home) {
					if (seen.has(m.id)) continue;
					seen.add(m.id);
					merged.push(m);
					if (merged.length >= this.PER_PAGE) break;
				}
			}

			const filled = await this.fillLatestChapters(merged.slice(0, this.PER_PAGE));

			console.log(
				`[bacakomik] latest page=${p} → ${filled.length} (with ch=${filled.filter((x) => x.latestChapter).length})`
			);
			return filled;
		} catch (e) {
			console.error('[bacakomik] getLatestManga', e);
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
			let list = await this.fetchListPage(path);

			if (!list.length) {
				const html = await this.fetchHtml(path);
				const $ = cheerio.load(html);
				const seen = new Set<string>();
				$('a[href*="/series/"]').each((_, el) => {
					const href = $(el).attr('href') || '';
					const id = this.cleanId(href);
					if (!/^\/series\/[^/]+$/.test(id) || seen.has(id)) return;
					seen.add(id);
					const title = ($(el).attr('title') || $(el).text() || '')
						.replace(/\s+/g, ' ')
						.trim();
					if (!title || title.length < 2) return;
					const cover =
						$(el).find('img').attr('src') ||
						$(el).closest('article, div').find('img').attr('src') ||
						'';
					list.push({
						id,
						sourceId: this.id,
						title,
						cover: this.absUrl((cover || '').split('?')[0]),
						type: 'manga',
						status: 'Ongoing',
						lang: this.LIST_LANG
					});
				});
			}

			const filled = await this.fillLatestChapters(list.slice(0, this.PER_PAGE));
			console.log(`[bacakomik] search "${q}" → ${filled.length}`);
			return filled;
		} catch (e) {
			console.error('[bacakomik] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);

		if (/^\/chapter\//i.test(path)) {
			const series = this.seriesIdFromChapter(path);
			if (series) path = series;
		}

		if (!/^\/series\/[^/]+$/i.test(path)) {
			throw new Error(`Invalid bacakomik id: ${mangaId}`);
		}

		const html = await this.fetchHtml(path + '/');
		const $ = cheerio.load(html);

		let title =
			$('h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content') ||
			path;
		title = title
			.replace(/\s*[-–|].*BacaKomik.*$/i, '')
			.replace(/\s+/g, ' ')
			.trim();

		let cover =
			$('img.thumb').attr('src') ||
			$('.series-thumb img').attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			$('.thumbnail-wrapper img, .thumb img, article img').first().attr('src') ||
			'';
		cover = this.absUrl((cover || '').split('?')[0]);

		const bodyText = $('body').text().replace(/\s+/g, ' ');

		let alt = '';
		const altM = bodyText.match(/Alternatif\s*:\s*(.+?)(?:Author|Status|Sinopsis|$)/i);
		if (altM) alt = altM[1].replace(/\s+/g, ' ').trim().replace(/,$/, '');

		const authors: string[] = [];
		const authM = bodyText.match(/Author\s*:\s*(.+?)(?:Status|Sinopsis|Genre|$)/i);
		if (authM) {
			authM[1]
				.split(/,|\//)
				.map((s) => s.trim())
				.filter((n) => n && n.length < 60)
				.forEach((n) => {
					if (!authors.includes(n)) authors.push(n);
				});
		}

		let status = 'Ongoing';
		const stM = bodyText.match(/Status\s*:\s*(Ongoing|Completed|Hiatus)/i);
		if (stM) {
			status = /complete/i.test(stM[1]) ? 'Completed' : stM[1];
		}

		const genres: string[] = [];
		$('a.genre-link, a[href*="/genre/"]').each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (g && g.length < 40 && !/^genre$/i.test(g) && !genres.includes(g)) {
				genres.push(g);
			}
		});

		let synopsis = '';
		const sinM = bodyText.match(/Sinopsis\s*:\s*(.+?)(?:Dae Ho|Chapter|Favorit|$)/i);
		$('p').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (t.length > 80 && !synopsis && !/genre|author|status|alternatif/i.test(t)) {
				synopsis = t;
			}
		});
		if (!synopsis && sinM) synopsis = sinM[1].trim();

		const typeHint = $('.cpt-label, .card').first().text() || genres.join(' ');

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		const chapterDataMatch = html.match(/const\s+chapterData\s*=\s*(\[[\s\S]*?\]);/);
		if (chapterDataMatch) {
			try {
				const data = JSON.parse(chapterDataMatch[1]) as Array<{
					title?: string;
					url?: string;
				}>;
				for (const item of data) {
					if (!item?.url) continue;
					const id = this.cleanId(item.url);
					if (!/^\/chapter\//i.test(id) || seen.has(id)) continue;
					seen.add(id);

					const text = (item.title || '').replace(/\s+/g, ' ').trim();
					const number =
						this.parseChapterNumber(id) || this.parseChapterNumber(text) || 0;

					chapters.push({
						id,
						title: text || `Chapter ${number}`,
						number
					});
				}
			} catch (e) {
				console.warn('[bacakomik] failed to parse chapterData', e);
			}
		}

		if (!chapters.length) {
			$('a[href*="/chapter/"]').each((_, a) => {
				const href = $(a).attr('href') || '';
				const id = this.cleanId(href);
				if (!/^\/chapter\//i.test(id) || seen.has(id)) return;
				seen.add(id);

				const text = $(a).text().replace(/\s+/g, ' ').trim();
				const number =
					this.parseChapterNumber(id) || this.parseChapterNumber(text) || 0;

				chapters.push({
					id,
					title: text || `Chapter ${number}`,
					number
				});
			});
		}

		chapters.sort((a, b) => (a.number || 0) - (b.number || 0));

		const latestChapter = chapters[chapters.length - 1]?.number;

		const description = [
			alt && `Alternative: ${alt}`,
			authors.length && `Author(s): ${authors.join(', ')}`,
			latestChapter != null && `Latest chapter: ${latestChapter}`,
			synopsis
		]
			.filter(Boolean)
			.join('\n\n');

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			type: this.detectType(typeHint),
			status,
			description,
			authors,
			genres,
			chapters,
			latestChapter
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		if (!/^\/chapter\//i.test(path)) {
			console.error('[bacakomik] not a chapter path:', chapterId);
			return [];
		}

		try {
			const html = await this.fetchHtml(path + '/');
			const $ = cheerio.load(html);
			const urls: string[] = [];
			const seen = new Set<string>();

			const pick = (src: string) => {
				if (!src || src.startsWith('data:')) return;
				src = this.absUrl(src.split('?')[0]);
				if (!/^https?:\/\//i.test(src)) return;

				if (
					/logo|icon|avatar|emoji|banner|\.gif$|ads|wp-content\/uploads\/2025\/10\/bacakomik|histats|yandex/i.test(
						src
					)
				)
					return;

				if (/r2\.dev\//i.test(src) && !/warungkomik|gudangkomik/i.test(src)) return;

				if (seen.has(src)) return;
				seen.add(src);
				urls.push(src);
			};

			$(
				'.viewer-komik img, .img-wrapper img, .entry-content img, #readerarea img, .reader-area img, article img'
			).each((_, img) => {
				const $img = $(img);
				pick(
					$img.attr('src') ||
						$img.attr('data-src') ||
						$img.attr('data-lazy-src') ||
						$img.attr('data-original') ||
						''
				);
			});

			const preferred = urls.filter((u) =>
				/gudangkomik|warungkomikcdn|warungkomik/i.test(u)
			);
			const finalUrls = preferred.length ? preferred : urls;

			console.log(`[bacakomik] ${finalUrls.length} pages → ${path}`);
			return finalUrls;
		} catch (e) {
			console.error('[bacakomik] getChapterPages', path, e);
			return [];
		}
	}
}
