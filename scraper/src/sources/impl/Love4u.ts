import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class Love4uSource extends BaseSource {
	id = 'love4u';
	name = 'Love4u';
	baseUrl = 'https://love4u.net';

	private readonly PER_PAGE = 24;
	private readonly LIST_LANG = 'ja';

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

	private decodeEnc(raw: string): string {
		if (!raw) return '';
		try {
			if (typeof atob === 'function') return atob(raw).trim();
		} catch {
			/* fallthrough */
		}
		try {
			return Buffer.from(raw, 'base64').toString('utf8').trim();
		} catch {
			return '';
		}
	}

	private extractCoverFromBg(styleOrData: string): string {
		if (!styleOrData) return '';
		const m =
			styleOrData.match(/url\(['"]?([^'")\s]+)['"]?\)/i) ||
			styleOrData.match(/(https?:\/\/[^\s'")]+)/i);
		return m?.[1] || styleOrData;
	}

	private parseChapterNumber(text: string): number {
		const m = String(text).match(/(?:chapter|chap|ch\.?)\s*(\d+(?:\.\d+)?)/i);
		if (m) return parseFloat(m[1]);
		const n = String(text).match(/(\d+(?:\.\d+)?)/);
		return n ? parseFloat(n[1]) : 0;
	}

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		const $cards = $(
			'.row-last-update .thumb-item-flow, #history .thumb-item-flow, .card-body .thumb-item-flow'
		);
		const $scope = $cards.length ? $cards : $('.thumb-item-flow');

		$scope.each((_, el) => {
			const $el = $(el);

			if ($el.hasClass('see-more') || $el.find('.thumb-see-more').length) return;

			const seriesA = $el.find('.series-title a, .thumb_attr.series-title a').first();
			let href = seriesA.attr('href') || '';
			if (!href) {
				const dataId = $el.find('.thumb-wrapper').attr('data-id');
				if (dataId) href = `/manga-${dataId}/`;
			}
			if (!href || !/\/manga-\d+/.test(href)) return;

			const idMatch = href.match(/\/manga-(\d+)/);
			if (!idMatch) return;
			const id = `/manga-${idMatch[1]}`;
			if (seen.has(id)) return;
			seen.add(id);

			let title =
				seriesA.attr('title') ||
				seriesA.text() ||
				$el.find('[data-enc]').attr('data-enc') ||
				'';
			if (/^[A-Za-z0-9+/=]+$/.test(title) && title.length > 8) {
				const decoded = this.decodeEnc(title);
				if (decoded) title = decoded;
			}
			title = title.replace(/\s+/g, ' ').trim();
			if (!title) title = `Manga ${idMatch[1]}`;

			const bgEl = $el.find('.img-in-ratio, .content.img-in-ratio, [data-bg]').first();
			let cover =
				bgEl.attr('data-bg') ||
				this.extractCoverFromBg(bgEl.attr('style') || '') ||
				$el.find('img').attr('src') ||
				$el.find('img').attr('data-src') ||
				'';
			cover = this.absUrl((cover || '').split('?')[0]);

			const chText =
				$el.find('.chapter-title a, .thumb_attr.chapter-title').text() ||
				$el.find('.chapter-title').attr('title') ||
				'';
			const latestChapter = this.parseChapterNumber(chText) || undefined;

			out.push({
				id,
				sourceId: this.id,
				title,
				cover,
				type: 'manga',
				status: 'Ongoing',
				latestChapter,
				lang: this.LIST_LANG
			});
		});

		return out;
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const sitePageStart = (p - 1) * 2 + 1;
			const pagesToFetch = [sitePageStart, sitePageStart + 1];

			const seen = new Set<string>();
			const merged: Manga[] = [];

			for (const sp of pagesToFetch) {
				const path =
					`/manga-list.html?listType=pagination&page=${sp}` +
					`&artist=&author=&group=&m_status=&name=&genre=&ungenre=` +
					`&sort=last_update&sort_type=DESC`;

				const html = await this.fetchHtml(path);
				const $ = cheerio.load(html);
				for (const m of this.parseCards($)) {
					if (seen.has(m.id)) continue;
					seen.add(m.id);
					merged.push(m);
				}
				if (merged.length >= this.PER_PAGE) break;
			}

			const list = merged.slice(0, this.PER_PAGE);
			console.log(`[love4u] latest page=${p} → ${list.length} items`);
			return list;
		} catch (e) {
			console.error('[love4u] getLatestManga', e);
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
			const sitePageStart = (page - 1) * 2 + 1;
			const seen = new Set<string>();
			const merged: Manga[] = [];

			for (const sp of [sitePageStart, sitePageStart + 1]) {
				const path =
					`/manga-list.html?listType=pagination&page=${sp}` +
					`&name=${encodeURIComponent(q)}&sort=views&sort_type=DESC`;
				const html = await this.fetchHtml(path);
				const $ = cheerio.load(html);
				for (const m of this.parseCards($)) {
					if (seen.has(m.id)) continue;
					seen.add(m.id);
					merged.push(m);
				}
				if (merged.length >= this.PER_PAGE) break;
			}

			if (!merged.length) {
				try {
					const suggest = await this.fetchHtml(
						`/app/manga/controllers/search.single.php?term=${encodeURIComponent(q)}`
					);
					const arr = JSON.parse(suggest);
					if (Array.isArray(arr)) {
						for (const item of arr) {
							const onclick = String(item.onclick || '');
							const url = onclick
								.replace(/^window\.location=['"]/, '')
								.replace(/['"]$/, '');
							const idMatch =
								url.match(/\/manga-(\d+)/) || url.match(/\/(\d+)\/?$/);
							if (!idMatch) continue;
							const id = `/manga-${idMatch[1]}`;
							if (seen.has(id)) continue;
							seen.add(id);
							merged.push({
								id,
								sourceId: this.id,
								title: String(item.primary || item.secondary || idMatch[1]),
								cover: this.absUrl(String(item.image || '').replace(/\\\//g, '/')),
								type: 'manga',
								status: 'Ongoing',
								lang: this.LIST_LANG
							});
						}
					}
				} catch {
					/* ignore */
				}
			}

			const list = merged.slice(0, this.PER_PAGE);
			console.log(`[love4u] search "${q}" → ${list.length} items`);
			return list;
		} catch (e) {
			console.error('[love4u] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const path = this.cleanId(mangaId);
		const idMatch = path.match(/\/manga-(\d+)/);
		if (!idMatch) throw new Error(`Invalid love4u id: ${mangaId}`);
		const detailPath = `/manga-${idMatch[1]}/`;

		const html = await this.fetchHtml(detailPath);
		const $ = cheerio.load(html);

		let title =
			$('.breadcrumb-item.active').text().trim() ||
			this.decodeEnc($('.manga-info h3[data-enc]').attr('data-enc') || '') ||
			$('meta[property="og:title"]').attr('content') ||
			`Manga ${idMatch[1]}`;
		title = title.replace(/\s*[-|].*love4u.*$/i, '').trim();

		let cover =
			$('.info-cover img.thumbnail').attr('src') ||
			$('.info-cover img').attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = this.absUrl((cover || '').split('?')[0]);

		let alt = '';
		$('.manga-info li').each((_, li) => {
			const t = $(li).text();
			if (/other names/i.test(t)) {
				alt = t.replace(/.*Other names\s*:?\s*/i, '').trim();
			}
		});

		let status = 'Ongoing';
		$('.manga-info li').each((_, li) => {
			const t = $(li).text();
			if (/status/i.test(t)) {
				const v = t.toLowerCase();
				if (/complete|finished|end/.test(v)) status = 'Completed';
			}
		});

		const authors: string[] = [];
		$('.manga-info li').each((_, li) => {
			const $li = $(li);
			if (/author/i.test($li.text())) {
				$li.find('a').each((__, a) => {
					const name = $(a).text().trim();
					if (name) authors.push(name);
				});
			}
		});

		const genres: string[] = [];
		$('.manga-info li').each((_, li) => {
			const $li = $(li);
			if (/genre/i.test($li.text())) {
				$li.find('a').each((__, a) => {
					const g = $(a).text().trim();
					if (g && !genres.includes(g)) genres.push(g);
				});
			}
		});

		const synopsis =
			$('.summary-content').text().replace(/\s+/g, ' ').trim() ||
			$('.series-summary .summary-content p').text().replace(/\s+/g, ' ').trim() ||
			'';

		const latestUpdate =
			$('.list-chapters .chapter-time').first().text().trim() || '';

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		$('.list-chapters a[href*="chapter"]').each((_, a) => {
			const $a = $(a);
			const href = $a.attr('href') || '';
			if (!href) return;
			const id = this.cleanId(href);
			if (seen.has(id)) return;
			seen.add(id);

			const chTitle =
				$a.attr('title') ||
				$a.find('.chapter-name').text().trim() ||
				$a.text().replace(/\s+/g, ' ').trim() ||
				'Chapter';
			const date = $a.find('.chapter-time').text().trim() || '';
			const number = this.parseChapterNumber(chTitle);

			chapters.push({
				id,
				title: chTitle,
				number: number || chapters.length + 1,
				date
			});
		});

		const latestChapter = chapters[0]?.number;

		const description = [
			alt && `Alternative: ${alt}`,
			latestUpdate && `Latest update: ${latestUpdate}`,
			latestChapter != null && `Latest chapter: ${latestChapter}`,
			synopsis
		]
			.filter(Boolean)
			.join('\n\n');

		return {
			id: `/manga-${idMatch[1]}`,
			sourceId: this.id,
			title,
			cover,
			type: 'manga',
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
		if (!path.includes('chapter')) {
			console.error('[love4u] getChapterPages → not a chapter path:', chapterId);
			return [];
		}

		try {
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const urls: string[] = [];
			const seen = new Set<string>();

			$(
				'#chapter-images img.chapter-img, .chapter-content img.chapter-img, .chapter-content img'
			).each((_, img) => {
				let src =
					$(img).attr('src') ||
					$(img).attr('data-src') ||
					$(img).attr('data-original') ||
					'';
				if (!src || src.startsWith('data:')) return;
				src = this.absUrl(src.split('?')[0]);
				if (!/^https?:\/\//i.test(src)) return;
				if (/logo|icon|avatar|ads|banner|spinner/i.test(src)) return;
				if (seen.has(src)) return;
				seen.add(src);
				urls.push(src);
			});

			console.log(`[love4u] ${urls.length} pages → ${path}`);
			return urls;
		} catch (e) {
			console.error('[love4u] getChapterPages failed', path, e);
			return [];
		}
	}
}
