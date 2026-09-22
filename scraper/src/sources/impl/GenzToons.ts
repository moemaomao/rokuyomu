import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

/**
 * Genz Toons adapter (genztoons.org)
 *
 * Domain  : https://genztoons.org
 * Latest  : /latest/
 * Search  : /?s={query}
 * Detail  : /series/{slug}/
 * Chapter : /chapter/{seriesId}-{chapterId}/
 * Images  : https://cdn.meowing.org/uploads/{uid}
 *           (img.myImage[uid] di reader)
 *
 * Cover di list/detail sering lewat:
 *   style="background-image:url(https://wsrv.nl/?url=cdn.meowing.org/uploads/...)"
 *   atau og:image / i0.wp.com proxy
 *
 * ID format:
 *   manga   : "/series/{slug}"
 *   chapter : "/chapter/{seriesId}-{chapterId}"
 *
 * Chapter locked (coins) → title ditandai 🔒, pages kosong.
 */
export class GenzToonsSource extends BaseSource {
	id = 'genztoons';
	name = 'Genz Toons';
	baseUrl = 'https://genztoons.org';

	private readonly CDN = 'https://cdn.meowing.org/uploads';
	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'en';

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
			.replace(/\s*[-|]\s*Genz\s*Toon.*$/i, '')
			.trim();
	}

	/**
	 * Unwrap proxies (wsrv.nl, i0.wp.com, images.weserv.nl) → direct CDN URL
	 */
	private normalizeCover(url: string): string {
		if (!url) return '';
		let u = url.trim().replace(/^url\(['"]?|['"]?\)$/gi, '');
		u = this.decodeHtml(u);

		try {
			if (!u.startsWith('http') && u.includes('meowing.org')) {
				u = `https://${u.replace(/^\/\//, '')}`;
			}
			if (!u.startsWith('http') && /^[A-Za-z0-9_.-]+$/.test(u)) {
				return `${this.CDN}/${u}`;
			}

			const parsed = new URL(this.absUrl(u));
			const host = parsed.hostname.toLowerCase();

			if (host.includes('wsrv') || host.includes('weserv')) {
				const inner = parsed.searchParams.get('url');
				if (inner) return this.normalizeCover(decodeURIComponent(inner));
			}

			if (host.includes('wp.com') || host.includes('wordpress.com')) {
				const path = parsed.pathname.replace(/^\//, '');
				if (path.includes('meowing.org') || path.startsWith('cdn.')) {
					return `https://${path}`.split('?')[0];
				}
				const m = path.match(/uploads\/([A-Za-z0-9_.-]+)/);
				if (m) return `${this.CDN}/${m[1]}`;
			}

			if (host.includes('meowing.org')) {
				return parsed.origin + parsed.pathname;
			}
		} catch {
			/* ignore */
		}

		return this.absUrl(u).split('?')[0];
	}

	/** Extract background-image URL from inline style */
	private bgFromStyle(style?: string | null): string {
		if (!style) return '';
		const m = style.match(
			/background(?:-image)?\s*:\s*url\((['"]?)([^)'"]+)\1\)/i
		);
		return m?.[2] ? this.normalizeCover(m[2]) : '';
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath = path.match(/chapter[_-]?(\d+)(?:[.-](\d+))?/i);
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

	private mapType(text: string): string {
		const t = (text || '').toLowerCase();
		if (/\bmanhua\b/.test(t)) return 'manhua';
		if (/\bmanga\b/.test(t) && !/\bmanhwa\b/.test(t)) return 'manga';
		if (/\bcomic\b/.test(t)) return 'comic';
		if (/\bnovel\b/.test(t)) return 'novel';
		if (/\bmangatoon\b/.test(t)) return 'manhwa';
		return 'manhwa';
	}

	private mapStatus(text: string): string {
		const t = (text || '').toLowerCase();
		if (/complet/.test(t)) return 'Completed';
		if (/hiatus/.test(t)) return 'Hiatus';
		if (/drop|cancel/.test(t)) return 'Dropped';
		return 'Ongoing';
	}

	private parseDate(text: string): string | undefined {
		const t = (text || '').replace(/\s+/g, ' ').trim();
		if (!t) return undefined;
		const abs = t.match(
			/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/i
		);
		if (abs) return abs[1];
		if (/\b\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago\b/i.test(t)) {
			return t.match(
				/\b\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago\b/i
			)?.[0];
		}
		return undefined;
	}

	/**
	 * List cards: cover is on <a style="background-image:url(...)">,
	 * title often on a sibling <a><h3>...
	 */
	private parseCards($: cheerio.CheerioAPI): Manga[] {
		const res: Manga[] = [];
		const seen = new Set<string>();

		$('a[href*="/series/"]').each((_, el) => {
			const $a = $(el);
			const href = ($a.attr('href') || '').trim();
			if (!href || !/\/series\/[^/]+\/?$/.test(href.split('?')[0])) return;

			const id = this.cleanId(href);

			let title =
				$a.attr('title') ||
				$a.attr('alt') ||
				$a.find('h3, h2, .title').first().text() ||
				'';
			title = this.normalizeTitle(title);

			let cover =
				this.bgFromStyle($a.attr('style')) ||
				this.normalizeCover(
					$a.find('img').first().attr('data-src') ||
						$a.find('img').first().attr('src') ||
						''
				);

			if (!title && !cover) return;

			const existing = res.find((m) => m.id === id);
			if (existing) {
				if (title && (!existing.title || existing.title === id.split('/').pop())) {
					existing.title = title;
				}
				if (cover && !existing.cover) existing.cover = cover;
				return;
			}

			if (seen.has(id)) return;
			seen.add(id);

			const cardText = ($a.text() || '').toLowerCase();
			const parentText = ($a.parent().text() || '').toLowerCase();
			const type = this.mapType(cardText + ' ' + parentText);

			res.push({
				id,
				title: title || id.split('/').pop() || id,
				cover,
				sourceId: this.id,
				type,
				status: 'Ongoing',
				lang: this.DEFAULT_LANG
			});
		});

		return res.filter((m) => m.title && m.title.length > 1);
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const path = p <= 1 ? '/latest/' : `/latest/?page=${p}`;
			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			let list = this.parseCards($);

			if (list.length === 0 && p === 1) {
				const homeHtml = await this.fetchHtml('/');
				list = this.parseCards(cheerio.load(homeHtml));
			}

			const start = (p - 1) * this.PER_PAGE;
			const pageList = list.slice(start, start + this.PER_PAGE);

			console.log(
				`[genztoons] latest page=${p} → ${pageList.length} (raw=${list.length})`
			);
			return pageList;
		} catch (e) {
			console.error('[genztoons] getLatestManga', e);
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
			let list = this.parseCards(cheerio.load(html));

			if (list.length === 0) {
				const alt = await this.fetchHtml(
					`/series/?s=${encodeURIComponent(q)}`
				);
				list = this.parseCards(cheerio.load(alt));
			}

			const start = (page - 1) * this.PER_PAGE;
			const pageList = list.slice(start, start + this.PER_PAGE);

			console.log(
				`[genztoons] search "${q}" page=${page} → ${pageList.length}`
			);
			return pageList;
		} catch (e) {
			console.error('[genztoons] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const id = this.cleanId(mangaId);
		const path = id.endsWith('/') ? id : `${id}/`;
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const title = this.normalizeTitle(
			$('h1').first().text() ||
				$('meta[property="og:title"]').attr('content') ||
				''
		);

		let cover =
			this.normalizeCover(
				$('meta[property="og:image"]').attr('content') || ''
			) ||
			this.bgFromStyle(
				$('[style*="background-image"][style*="meowing"], [style*="background-image"][style*="wsrv"]')
					.first()
					.attr('style')
			) ||
			this.normalizeCover(
				$('img[src*="meowing"], img[src*="wsrv"], img[src*="wp.com"]')
					.first()
					.attr('src') || ''
			);

		let description = '';
		$('p, div').each((_, el) => {
			if (description) return;
			const $el = $(el);
			const t = $el.text().replace(/\s+/g, ' ').trim();
			if (
				t.length > 80 &&
				t.length < 2500 &&
				$el.find('a[href*="/chapter/"]').length === 0
			) {
				const cls = ($el.attr('class') || '').toLowerCase();
				if (
					/desc|synop|summary|overview|about|container/.test(cls) ||
					$el.parent().attr('class')?.match(/desc|synop|container/i)
				) {
					description = this.decodeHtml(t);
				}
			}
		});
		if (!description) {
			description = this.decodeHtml(
				$('meta[name="description"]').attr('content') || ''
			)
				.replace(/\s*-\s*A Standard scanlation.*$/i, '')
				.replace(/\s*Enjoy a vast library.*$/i, '')
				.trim();
		}

		const bodyText = $('body').text().replace(/\s+/g, ' ');
		const authors: string[] = [];
		const authorM = bodyText.match(
			/\bAuthor\s+([^\n]{1,60}?)(?:\s+Artist|\s+Type|\s+Status|\s+Add to|\s+Start)/i
		);
		if (authorM) {
			const a = authorM[1].trim();
			if (a && a.length < 50) authors.push(a);
		}
		const artistM = bodyText.match(
			/\bArtist\s+([^\n]{1,80}?)(?:\s+Type|\s+Status|\s+Add to|\s+Start)/i
		);
		if (artistM) {
			for (const part of artistM[1].split(/[,&]/)) {
				const a = part.trim();
				if (a && a.length < 40 && !authors.includes(a)) authors.push(a);
			}
		}

		const typeM = bodyText.match(
			/\bType\s+(MANHWA|MANHUA|MANGA|COMIC|NOVEL)\b/i
		);
		const type = typeM ? this.mapType(typeM[1]) : this.mapType(bodyText);

		const statusM = bodyText.match(
			/\bStatus\s+(ONGOING|COMPLETED|HIATUS|DROPPED)\b/i
		);
		const status = statusM
			? this.mapStatus(statusM[1])
			: this.mapStatus(bodyText);

		const genres: string[] = [];
		$('span, a').each((_, el) => {
			const t = $(el).text().replace(/\s+/g, ' ').trim();
			if (
				t.length >= 3 &&
				t.length <= 20 &&
				/^[A-Za-z][A-Za-z -]+$/.test(t) &&
				!/manhwa|manga|comic|ongoing|completed|pinned|new|free|author|artist|type|status/i.test(
					t
				)
			) {
				const href = ($(el).attr('href') || '').toLowerCase();
				if (href.includes('genre') || href.includes('tag')) {
					if (!genres.includes(t)) genres.push(t);
				}
			}
		});

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('#chapters a[href*="/chapter/"], a[href*="/chapter/"]').each(
			(_, el) => {
				const $a = $(el);
				const href = ($a.attr('href') || '').trim();
				if (!href || !/\/chapter\/[a-z0-9-]+/i.test(href)) return;

				const chId = this.cleanId(href);
				if (seen.has(chId)) return;
				seen.add(chId);

				const rawText = $a.text().replace(/\s+/g, ' ').trim();
				const htmlSnippet = $a.html() || '';

				const isPaid =
					/lock|coin|premium|paid/i.test(htmlSnippet) ||
					$a.find(
						'[class*="lock"], img[src*="lock"], img[src*="Coin"], img[src*="coin"]'
					).length > 0 ||
					/^\s*\d+\s+Chapter/i.test(rawText);

				const number = this.parseChapterNumber(rawText, chId);

				let titleBase = rawText
					.replace(/^\s*\d+\s+(?=Chapter)/i, '')
					.replace(/\s+/g, ' ')
					.trim();

				const chLabel = titleBase.match(
					/Chapter\s+\d+(?:\.\d+)?/i
				);
				if (chLabel) {
					titleBase = chLabel[0].trim();
				} else if (number) {
					titleBase = `Chapter ${number}`;
				}

				const date = this.parseDate(rawText);

				const thumb =
					this.bgFromStyle(
						$a.find('[style*="background"]').first().attr('style')
					) || undefined;

				chapters.push({
					id: chId,
					title: isPaid ? `${titleBase} 🔒` : titleBase,
					number: number || chapters.length + 1,
					date,
					cover: thumb
				});
			}
		);

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const latestChapter =
			chapters.length > 0 ? String(chapters[0].number) : undefined;

		return {
			id,
			sourceId: this.id,
			title: title || id.split('/').pop() || id,
			cover,
			type,
			status,
			latestChapter,
			lang: this.DEFAULT_LANG,
			description,
			authors: [...new Set(authors)],
			genres: genres.slice(0, 12),
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

			const push = (src?: string | null, uid?: string | null) => {
				let url = '';
				if (uid) {
					url = `${this.CDN}/${String(uid).trim()}`;
				} else if (src) {
					if (src.startsWith('data:')) return;
					url = this.normalizeCover(src);
				}
				if (!url || seen.has(url)) return;
				if (
					/logo|icon|avatar|emoji|placeholder|coin|lock|iconify/i.test(
						url
					)
				)
					return;
				seen.add(url);
				pages.push(url);
			};

			$('img.myImage, #chapters_panel img, .reader img, img[uid]').each(
				(_, img) => {
					const $img = $(img);
					const uid =
						$img.attr('uid') ||
						$img.attr('data-uid') ||
						($img.data('uid') as string | undefined);
					const src =
						$img.attr('data-src') ||
						$img.attr('data-lazy-src') ||
						$img.attr('src');
					push(src, uid ? String(uid) : null);
				}
			);

			if (pages.length === 0) {
				$('img[src*="meowing.org"], img[data-src*="meowing.org"]').each(
					(_, img) => {
						const $img = $(img);
						push(
							$img.attr('data-src') ||
								$img.attr('data-lazy-src') ||
								$img.attr('src')
						);
					}
				);
			}

			if (pages.length === 0) {
				const re =
					/(?:uid=["']([A-Za-z0-9_-]+)["']|cdn\.meowing\.org\/uploads\/([A-Za-z0-9_.-]+))/gi;
				let m: RegExpExecArray | null;
				while ((m = re.exec(html)) !== null) {
					const uid = m[1] || m[2];
					if (uid) push(null, uid);
				}
			}

			console.log(
				`[genztoons] getChapterPages ${path} → ${pages.length} pages`
			);
			return pages;
		} catch (e) {
			console.error('[genztoons] getChapterPages', e);
			return [];
		}
	}
}
