/**
 * Setsu Scans adapter (https://setsuscans.com)
 *
 * Theme: Themesia / WordPress mangareader
 *
 * Latest  : /manga/?page=N&order=update
 * Search  : /?s={query}&page=N
 * Detail  : /manga/{slug}/
 * Chapter : /manga/{slug}/chapter-{n}/   (atau /{slug}-chapter-{n}/)
 * Pages   : #readerarea img  /  ts_reader.run({ sources:[{ images:[...] }] })
 *
 * ID format:
 *   manga   : "/manga/{slug}"
 *   chapter : "/manga/{slug}/chapter-{n}"  (path as on site)
 *
 * Bahasa default: English
 *
 * Catatan: situs di belakang Cloudflare Turnstile.
 * Hybrid Worker membantu, tapi challenge interaktif tetap bisa 403.
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class SetsuScansSource extends BaseSource {
	id = 'setsuscans';
	name = 'Setsu Scans';
	baseUrl = 'https://setsuscans.com';

	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'en';

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept:
			'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		'Accept-Encoding': 'gzip, deflate, br',
		'Cache-Control': 'no-cache',
		Pragma: 'no-cache',
		'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
		'Sec-Ch-Ua-Mobile': '?0',
		'Sec-Ch-Ua-Platform': '"Windows"',
		'Sec-Fetch-Dest': 'document',
		'Sec-Fetch-Mode': 'navigate',
		'Sec-Fetch-Site': 'none',
		'Sec-Fetch-User': '?1',
		'Upgrade-Insecure-Requests': '1'
	};

	// ── Fetch dengan deteksi Cloudflare ─────────────────────────────────────

	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const response = await fetch(url, {
			headers: {
				...this.headers,
				Referer: this.baseUrl + '/'
			},
			redirect: 'follow'
		});

		const html = await response.text();
		const lower = html.toLowerCase();

		const isChallenge =
			response.status === 403 ||
			response.status === 503 ||
			/just a moment|verify you are human|cf-browser-verification|challenge-platform|cf-turnstile|checking your browser/i.test(
				lower
			);

		if (isChallenge || !response.ok) {
			const title =
				html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() ||
				'';
			console.error('[setsuscans] Cloudflare / blocked', {
				url,
				status: response.status,
				title,
				cfRay: response.headers.get('cf-ray'),
				server: response.headers.get('server'),
				preview: html.slice(0, 300).replace(/\s+/g, ' ')
			});
			throw new Error(
				`Failed to fetch ${url}: ${response.status} ${response.statusText}` +
					(isChallenge ? ' (Cloudflare challenge)' : '')
			);
		}

		return html;
	}

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

	private decodeHtml(s: string): string {
		return String(s || '')
			.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
			.replace(/&#x([0-9a-f]+);/gi, (_, h) =>
				String.fromCharCode(parseInt(h, 16))
			)
			.replace(/&amp;/g, '&')
			.replace(/&quot;/g, '"')
			.replace(/&#039;/g, "'")
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&nbsp;/g, ' ')
			.trim();
	}

	private normalizeTitle(raw: string): string {
		if (!raw) return '';
		return this.decodeHtml(raw)
			.replace(/\s+/g, ' ')
			.replace(/\s*[-|]\s*Setsu\s*Scans.*$/i, '')
			.replace(/\s*Manga\s*$/i, '')
			.trim();
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath = path.match(
			/(?:chapter[_-]|\/chapter-)(\d+)(?:[.-](\d+))?/i
		);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null && fromPath[2].length <= 2) {
				return parseFloat(`${major}.${fromPath[2]}`);
			}
			return major;
		}
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

	private preferFullCover(url: string): string {
		if (!url) return '';
		return url.replace(/-\d+x\d+(\.\w+)(\?.*)?$/, '$1$2');
	}

	private mangaSlug(mangaId: string): string {
		const id = this.cleanId(mangaId);
		const parts = id.split('/').filter(Boolean);
		if (parts[0] === 'manga' && parts[1]) return parts[1];
		return parts[parts.length - 1] || '';
	}

	private mapStatus(text: string): string {
		const t = (text || '').toLowerCase();
		if (/complet|end|finished/.test(t)) return 'Completed';
		if (/hiatus/.test(t)) return 'Hiatus';
		if (/drop|cancel/.test(t)) return 'Dropped';
		return 'Ongoing';
	}

	private mapType(text: string): string {
		const t = (text || '').toLowerCase();
		if (/\bmanhwa\b/.test(t)) return 'manhwa';
		if (/\bmanhua\b/.test(t)) return 'manhua';
		return 'manga';
	}

	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		$('div.listupd div.bsx, .postbody div.bsx, div.bs, div.bsx').each(
			(_, card) => {
				const $card = $(card);
				const a = $card
					.find('a[href*="/manga/"]')
					.filter((_, el) => {
						const h = ($(el).attr('href') || '').split('?')[0];
						return /\/manga\/[^/]+\/?$/.test(h);
					})
					.first();

				const href = a.attr('href') || '';
				if (!href) return;

				const id = this.cleanId(href);
				if (seen.has(id)) return;
				if (/\/manga\/(page|list-mode|feed)/i.test(id)) return;
				seen.add(id);

				let title =
					a.attr('title') ||
					$card.find('.tt a, .tt').first().text() ||
					$card.find('img').first().attr('alt') ||
					'';
				title = this.normalizeTitle(title);
				if (!title) return;

				const img = $card.find('img').first();
				let cover =
					img.attr('data-src') ||
					img.attr('data-lazy-src') ||
					img.attr('src') ||
					'';
				if (cover.startsWith('data:')) cover = '';
				cover = this.preferFullCover(this.absUrl(cover));

				const epxs = $card.find('.epxs, .fivchap, .chfiv').first().text();
				let latestChapter: string | undefined;
				if (epxs) {
					const n = this.parseChapterNumber(epxs);
					if (n > 0) latestChapter = String(n);
					else {
						const cleaned = epxs
							.replace(/^chapter\s*/i, '')
							.replace(/\s*END\s*$/i, '')
							.trim();
						if (cleaned && cleaned !== '?' && cleaned !== '0')
							latestChapter = cleaned;
					}
				}
				if (!latestChapter) {
					const cardHtml = $.html($card) || '';
					const em =
						cardHtml.match(
							/class=["']epxs["'][^>]*>\s*Chapter\s*([\d.]+)/i
						) || cardHtml.match(/Chapter\s+([\d.]+)/i);
					if (em?.[1]) latestChapter = em[1];
				}
				if (!latestChapter) {
					const chHref =
						$card.find('a[href*="chapter"]').attr('href') || '';
					const n2 = this.parseChapterNumber('', chHref);
					if (n2 > 0) latestChapter = String(n2);
				}

				const typeText = $card.text().toLowerCase();
				const type = this.mapType(typeText);

				res.push({
					id,
					title,
					cover,
					sourceId: this.id,
					type,
					status: 'Ongoing',
					latestChapter,
					lang: this.DEFAULT_LANG
				});
			}
		);

		return res;
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const html = await this.fetchHtml(
				`/manga/?page=${p}&order=update`
			);
			const $ = cheerio.load(html);
			let list = this.parseCards($);

			if (list.length === 0 && p === 1) {
				const home = await this.fetchHtml('/');
				list = this.parseCards(cheerio.load(home));
			}

			console.log(`[setsuscans] latest page=${p} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[setsuscans] getLatestManga', e);
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
				page > 1
					? `/?s=${encodeURIComponent(q)}&page=${page}`
					: `/?s=${encodeURIComponent(q)}`;
			const html = await this.fetchHtml(path);
			const list = this.parseCards(cheerio.load(html));
			console.log(
				`[setsuscans] search "${q}" page=${page} → ${list.length}`
			);
			return list;
		} catch (e) {
			console.error('[setsuscans] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const id = this.cleanId(mangaId);
		const html = await this.fetchHtml(id.endsWith('/') ? id : `${id}/`);
		const $ = cheerio.load(html);
		const slug = this.mangaSlug(id);

		const title = this.normalizeTitle(
			$('h1.entry-title, h1').first().text() ||
				$('meta[property="og:title"]').attr('content') ||
				''
		);

		let cover =
			$('.thumb img, .seriestuimg img, .infomanga img, img.wp-post-image')
				.first()
				.attr('data-src') ||
			$('.thumb img, .seriestuimg img, .infomanga img, img.wp-post-image')
				.first()
				.attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		if (cover.startsWith('data:')) cover = '';
		cover = this.preferFullCover(this.absUrl(cover));

		const description = this.decodeHtml(
			$('.entry-content, .desc, .seriestucontent .entry-content')
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim()
		);

		const genres: string[] = [];
		$('a[href*="/genres/"], .mgen a, .seriestugenre a').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (t && t.length < 40 && !genres.includes(t)) genres.push(t);
		});

		let status = 'Ongoing';
		$('.imptdt, .infotable tr, .fmed, .tsinfo .imptdt').each((_, el) => {
			const text = $(el).text().replace(/\s+/g, ' ').trim();
			if (/status/i.test(text)) {
				status = this.mapStatus(text);
			}
		});

		const authors: string[] = [];
		$('.fmed, .imptdt, .infotable tr, .tsinfo .imptdt').each((_, el) => {
			const text = $(el).text().replace(/\s+/g, ' ').trim();
			if (/author|artist|pengarang/i.test(text)) {
				$(el)
					.find('a')
					.each((__, a) => {
						const n = $(a).text().replace(/\s+/g, ' ').trim();
						if (n && n.length < 80 && !authors.includes(n))
							authors.push(n);
					});
				if (authors.length === 0) {
					const val = text
						.replace(/author|artist|pengarang/gi, '')
						.replace(/\s+/g, ' ')
						.trim();
					if (val && val.length < 80) authors.push(val);
				}
			}
		});

		const typeText = $('.imptdt, .tsinfo, body').text();
		const type = this.mapType(typeText);

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('#chapterlist li, .eplister li, #chapterlist ul li, .chbox').each(
			(_, li) => {
				const $li = $(li);
				const a = $li.find('a').first();
				const href = (a.attr('href') || '').trim();

				const dataNum = $li.attr('data-num') || '';
				const numText =
					$li.find('.chapternum').text() ||
					a.attr('data-title') ||
					a.text() ||
					dataNum;

				let chId: string;
				if (href && !href.startsWith('#') && !/javascript:/i.test(href)) {
					chId = this.cleanId(href);
				} else if (slug && (dataNum || numText)) {
					const n = dataNum || String(this.parseChapterNumber(numText));
					const pathNum = String(n).replace(/\./g, '-');
					chId = `/manga/${slug}/chapter-${pathNum}`;
				} else {
					return;
				}

				if (seen.has(chId)) return;
				seen.add(chId);

				const number =
					(dataNum ? parseFloat(dataNum) : 0) ||
					this.parseChapterNumber(numText, chId);

				const date = $li
					.find('.chapterdate')
					.text()
					.replace(/\s+/g, ' ')
					.trim();

				const titleBase = (numText || `Chapter ${number}`)
					.replace(/\s+/g, ' ')
					.trim();

				chapters.push({
					id: chId,
					title: titleBase,
					number: number || chapters.length + 1,
					date: date || undefined
				});
			}
		);

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const latestChapter =
			chapters.length > 0 ? String(chapters[0].number) : undefined;

		return {
			id,
			sourceId: this.id,
			title: title || slug || id,
			cover,
			type,
			status,
			latestChapter,
			lang: this.DEFAULT_LANG,
			description,
			authors: [...new Set(authors)],
			genres,
			chapters
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		try {
			const path = this.cleanId(chapterId);
			const html = await this.fetchHtml(
				path.endsWith('/') ? path : `${path}/`
			);
			const $ = cheerio.load(html);

			const pages: string[] = [];
			const seen = new Set<string>();

			const push = (src?: string | null) => {
				if (!src) return;
				if (src.startsWith('data:')) return;
				let url = this.absUrl(src.split('?')[0]);
				url = url.replace(/\\\//g, '/');
				if (!url || seen.has(url)) return;
				if (/logo|icon|avatar|emoji|placeholder|spinner/i.test(url))
					return;
				seen.add(url);
				pages.push(url);
			};

			// ts_reader.run({ sources: [{ images: [...] }] })
			const tsMatch = html.match(
				/ts_reader\.run\s*\(\s*(\{[\s\S]*?\})\s*\)/
			);
			if (tsMatch?.[1]) {
				try {
					const jsonStr = tsMatch[1]
						.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":')
						.replace(/'/g, '"');
					const data = JSON.parse(jsonStr) as {
						sources?: Array<{ images?: string[] }>;
					};
					for (const src of data.sources || []) {
						for (const img of src.images || []) {
							push(img);
						}
					}
				} catch {
					/* fall through */
				}
			}

			if (pages.length === 0) {
				$(
					'#readerarea img, .readerarea img, #reader img, .reading-content img'
				).each((_, img) => {
					const $img = $(img);
					push(
						$img.attr('data-src') ||
							$img.attr('data-lazy-src') ||
							$img.attr('src')
					);
				});
			}

			if (pages.length === 0) {
				const re =
					/(https?:\/\/[^"'\\\s]+\/wp-content\/uploads\/[^"'\\\s]+\.(?:webp|jpg|jpeg|png|avif|gif))/gi;
				let m: RegExpExecArray | null;
				while ((m = re.exec(html)) !== null) {
					push(m[1]);
				}
			}

			console.log(
				`[setsuscans] getChapterPages ${path} → ${pages.length} pages`
			);
			return pages;
		} catch (e) {
			console.error('[setsuscans] getChapterPages', e);
			return [];
		}
	}
}