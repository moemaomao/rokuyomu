import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

/**
 * Holodek / HoloToon (holodek.run)
 *
 * List   : /browse?sort=latest&page={n}
 * Search : /browse?q={query}
 * Detail : /comic/{slug}
 * Chapter: /read/{slug}/{chapter-slug}  (site)
 * App ID :
 *   manga   : /comic/{slug}
 *   chapter : /comic/{slug}/{chapter-slug}
 *
 * Bahasa: Indonesian | NSFW
 */
export class HolodekSource extends BaseSource {
	id = 'holodek';
	name = 'Holodek';
	baseUrl = 'https://holodek.run';

	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'id';

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

	private isHoneypot(idOrSlug: string): boolean {
		return /honeypot/i.test(idOrSlug);
	}

	private normalizeTitle(raw: string): string {
		return (raw || '')
			.replace(/\s+/g, ' ')
			.replace(/\s*[|–-]\s*HoloToon.*$/i, '')
			.trim();
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath = path.match(/chapter-(\d+)(?:[.-](\d+))?/i);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null) return parseFloat(`${major}.${fromPath[2]}`);
			return major;
		}
		const m = String(text).match(/(?:chapter|ch\.?)\s*(\d+)(?:[.,](\d+))?/i);
		if (m) {
			if (m[2] != null) return parseFloat(`${m[1]}.${m[2]}`);
			return parseInt(m[1], 10);
		}
		const n = String(text).match(/\b(\d+(?:\.\d+)?)\b/);
		return n ? parseFloat(n[1]) : 0;
	}

	private mapType(raw: string): string {
		const t = raw.toLowerCase();
		if (t.includes('manhwa')) return 'manhwa';
		if (t.includes('manhua')) return 'manhua';
		return 'manga';
	}

	private cleanSynopsis(raw: string): string {
		let description = (raw || '').replace(/\s+/g, ' ').trim();

		description = description
			.replace(/\s*Chapter\s+\d+\s*[—\-–].*$/i, '')
			.replace(/\s*Start Reading.*$/i, '')
			.replace(/\s*Bookmark.*$/i, '')
			.replace(/\s*Dukung kami.*$/i, '')
			.replace(/\s*TAKO:.*$/i, '')
			.replace(/\s*Info Karakter.*$/i, '')
			.replace(/\s*Honeypot.*$/i, '')
			.replace(/\s*Trap Genre.*$/i, '')
			.replace(/\s*Trap Comic.*$/i, '')
			.replace(/\s*Loading\.\.\..*$/i, '')
			.replace(/\s*Show more.*$/i, '')
			.replace(/\s*Uploaded by:.*$/i, '')
			.replace(/\s*Views:.*$/i, '')
			.replace(/\s+/g, ' ')
			.trim();

		if (description.length > 1200) {
			description = description.slice(0, 1200).replace(/\s+\S*$/, '') + '…';
		}
		return description;
	}

	// ── List cards ───────────────────────────────────────────────────────────

	private parseBrowseCards($: cheerio.CheerioAPI): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		const $links = $('#browse-grid-view').length
			? $('#browse-grid-view').find('a[href^="/comic/"]')
			: $('a[href^="/comic/"]');

		$links.each((_, el) => {
			const $a = $(el);
			const href = $a.attr('href') || '';
			const id = this.cleanId(href);
			if (!/^\/comic\/[^/]+$/i.test(id)) return;
			if (this.isHoneypot(id) || seen.has(id)) return;
			seen.add(id);

			const $img = $a.find('img').first();
			const title = this.normalizeTitle(
				$img.attr('alt') || $a.attr('title') || $a.text() || ''
			);
			if (!title || title.length < 2) return;

			const cover =
				$img.attr('src') ||
				$img.attr('data-src') ||
				$img.attr('data-lazy-src') ||
				'';

			const blockText = $a.text();
			const n = this.parseChapterNumber(blockText);
			const typeMatch = blockText.match(/\b(manhwa|manhua|manga)\b/i);

			out.push({
				id,
				sourceId: this.id,
				title,
				cover: this.absUrl((cover || '').split('?')[0]),
				type: typeMatch ? this.mapType(typeMatch[1]) : 'manhwa',
				status: 'Ongoing',
				latestChapter: n > 0 ? n : undefined,
				lang: this.DEFAULT_LANG
			} as Manga & { lang?: string });
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
			const path =
				p <= 1 ? `/browse?sort=latest` : `/browse?sort=latest&page=${p}`;

			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list = this.parseBrowseCards($);

			console.log(`[holodek] latest page=${p} → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[holodek] getLatestManga', e);
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
			const params = new URLSearchParams({ q });
			if (page > 1) params.set('page', String(page));
			const path = `/browse?${params.toString()}`;

			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			const list = this.parseBrowseCards($);

			console.log(`[holodek] search "${q}" page=${page} → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[holodek] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);

		if (path.startsWith('/read/')) {
			const s = path.replace(/^\/read\//, '').split('/')[0];
			path = `/comic/${s}`;
		}
	
		if (path.startsWith('/comic/')) {
			const parts = path.replace(/^\/comic\//, '').split('/');
			if (parts.length >= 2 && /chapter/i.test(parts[1])) {
				path = `/comic/${parts[0]}`;
			}
		}
		if (!path.startsWith('/comic/')) {
			path = `/comic/${path.replace(/^\//, '')}`;
		}

		const slug = path.replace(/^\/comic\//, '').split('/')[0];
		if (!slug || this.isHoneypot(slug)) {
			throw new Error(`Invalid holodek id: ${mangaId}`);
		}

		const html = await this.fetchHtml(`/comic/${slug}`);
		const $ = cheerio.load(html);

		let title =
			$('h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content') ||
			slug;
		title = this.normalizeTitle(title);

		let cover =
			$('img[src*="imgsvr"][src*="covers"]').first().attr('src') ||
			$('img[src*="covers"]').first().attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			'';
		cover = this.absUrl((cover || '').split('?')[0]);

		// ── Synopsis ketat ───────────────────────────────────────────────────
		let description = '';

		const metaDesc = $('meta[name="description"]').attr('content') || '';
		if (
			metaDesc.length > 40 &&
			!/honeypot|trap comic|scraper/i.test(metaDesc)
		) {
			description = metaDesc;
		}

		if (!description) {
			const $syn = $(
				'[data-synopsis] p, [data-synopsis-id-cls] p, .synopsis p, .comic-synopsis p, #synopsis p, [data-synopsis], .synopsis, .comic-synopsis, #synopsis'
			).first();
			if ($syn.length) {
				const t = $syn.text().replace(/\s+/g, ' ').trim();
				if (t.length > 30 && !/honeypot|trap comic/i.test(t)) {
					description = t;
				}
			}
		}

		if (!description || description.length < 30) {
			const raw = $('main p, article p, .prose p')
				.filter((_, el) => {
					const t = $(el).text().replace(/\s+/g, ' ').trim();
					if (t.length < 40) return false;
					if (/honeypot|trap comic|scraper|moccacinno\s+moccacinno/i.test(t))
						return false;
					if (/^chapter\s*\d+/i.test(t)) return false;
					if ((t.match(/chapter\s+\d+/gi) || []).length > 3) return false;
					return true;
				})
				.first()
				.text()
				.replace(/\s+/g, ' ')
				.trim();
			if (raw) description = raw;
		}

				description = this.cleanSynopsis(description);

		// ── Author / Artist / Year / Rating ───────────────────────────────────
		const authors: string[] = [];
		const artists: string[] = [];

		const infoText = $('body').text();

		const authorM = html.match(
			/Author:\s*(?:<[^>]+>)*\s*<span[^>]*>\s*([^<]+)\s*<\/span>/i
		) || html.match(/Author:\s*<\/?(?:span|a)[^>]*>\s*([^<]+)/i);
		const artistM = html.match(
			/Artist:\s*(?:<[^>]+>)*\s*<span[^>]*>\s*([^<]+)\s*<\/span>/i
		) || html.match(/Artist:\s*<\/?(?:span|a)[^>]*>\s*([^<]+)/i);

		$('span').each((_, el) => {
			const full = $(el).text().replace(/\s+/g, ' ').trim();
			const am = full.match(/^Author:\s*(.+)$/i);
			if (am) {
				const name = am[1].trim();
				if (name && name.length < 80 && !authors.includes(name)) authors.push(name);
			}
			const art = full.match(/^Artist:\s*(.+)$/i);
			if (art) {
				const name = art[1].trim();
				if (name && name.length < 80 && !artists.includes(name)) artists.push(name);
			}
		});

		for (const a of artists) {
			if (!authors.includes(a)) authors.push(a);
		}

		let year = '';
		const yearM = html.match(/Year:\s*(?:<[^>]+>)*\s*<span[^>]*>\s*(\d{4})\s*<\/span>/i);
		if (yearM) year = yearM[1];

		let rating: number | undefined;
		let ratingCount: number | undefined;

		// JSON-LD aggregateRating
		const ldBlocks = html.match(
			/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
		) || [];
		for (const block of ldBlocks) {
			const inner = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
			try {
				const data = JSON.parse(inner);
				const list = Array.isArray(data) ? data : [data];
				for (const item of list) {
					const ar = item?.aggregateRating;
					if (ar?.ratingValue != null) {
						rating = parseFloat(String(ar.ratingValue));
						if (ar.ratingCount != null) {
							ratingCount = parseInt(String(ar.ratingCount), 10);
						}
					}
					// author dari schema
					if (item?.author) {
						const au = item.author;
						const names = Array.isArray(au) ? au : [au];
						for (const n of names) {
							const name = typeof n === 'string' ? n : n?.name;
							if (name && !authors.includes(name)) authors.push(String(name));
						}
					}
				}
			} catch {
				/* ignore bad json */
			}
		}

		// Type & status
		let type = 'manhwa';
		let status = 'Ongoing';
		$('span').each((_, el) => {
			const t = $(el).text().trim().toLowerCase();
			if (t === 'manhwa' || t === 'manhua' || t === 'manga') {
				type = this.mapType(t);
			}
			if (t === 'ongoing' || t === 'berlangsung') status = 'Ongoing';
			if (t === 'completed' || t === 'tamat' || t === 'end' || t === 'finished') {
				status = 'Completed';
			}
			if (t === 'hiatus') status = 'Hiatus';
		});

		const genres: string[] = [];
		$('a[href*="genre"], a[href*="/genre"]').each((_, a) => {
			const g = $(a).text().replace(/\s+/g, ' ').trim();
			if (
				g &&
				g.length < 40 &&
				!/honeypot|trap|genre list/i.test(g) &&
				!genres.includes(g)
			) {
				genres.push(g);
			}
		});

		if (year || rating != null) {
			const bits: string[] = [];
			if (year) bits.push(`Year: ${year}`);
			if (rating != null) {
				bits.push(
					ratingCount != null
						? `Rating: ${rating}/10 (${ratingCount})`
						: `Rating: ${rating}/10`
				);
			}
			if (bits.length) {
				description = description
					? `${description}\n\n${bits.join(' · ')}`
					: bits.join(' · ');
			}
		}

		// ── Chapters ─────────────────────────────────────────────────────────
		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$(`a[href^="/read/${slug}/"]`).each((_, a) => {
			const href = $(a).attr('href') || '';
			const parts = href.replace(/\/+$/, '').split('/').filter(Boolean);
			if (parts.length < 3 || parts[0] !== 'read') return;
			if (parts[1] !== slug) return;

			const chSlug = parts.slice(2).join('/');
			if (!chSlug || !/chapter/i.test(chSlug)) return;

			const id = `/comic/${slug}/${chSlug}`;
			if (seen.has(id)) return;
			seen.add(id);

			const label =
				$(a).find('span').first().text().replace(/\s+/g, ' ').trim() ||
				$(a).text().replace(/\s+/g, ' ').trim() ||
				chSlug;

			if (/honeypot|trap|loading/i.test(label)) return;

			const number =
				this.parseChapterNumber(label, chSlug) || chapters.length + 1;

			chapters.push({
				id,
				title: /chapter/i.test(label) ? label : `Chapter ${number}`,
				number,
				date: ''
			});
		});

		if (chapters.length < 2) {
			const propsBlocks = html.match(/props="(\{[^"]+\})"/g) || [];
			for (const raw of propsBlocks) {
				const decoded = raw
					.replace(/^props="/, '')
					.replace(/"$/, '')
					.replace(/&quot;/g, '"');
				const matches = [
					...decoded.matchAll(
						/\{\s*"slug"\s*:\s*\[\s*0\s*,\s*"([^"]+)"\s*\]\s*,\s*"number"\s*:\s*\[\s*0\s*,\s*"([^"]+)"\s*\]/g
					)
				];
				for (const m of matches) {
					const chSlug = m[1];
					const numStr = m[2];
					if (!/chapter/i.test(chSlug)) continue;
					const id = `/comic/${slug}/${chSlug}`;
					if (seen.has(id)) continue;
					seen.add(id);
					const number = parseFloat(numStr) || this.parseChapterNumber(chSlug);
					chapters.push({
						id,
						title: `Chapter ${numStr}`,
						number,
						date: ''
					});
				}
			}
		}

		chapters.sort((a, b) => a.number - b.number);

		console.log(`[holodek] details ${slug} → ch=${chapters.length}`);

		return {
			id: `/comic/${slug}`,
			sourceId: this.id,
			title,
			cover,
			description,
			authors,
			genres,
			status,
			type,
			chapters,
			latestChapter: chapters.length
				? chapters[chapters.length - 1].number
				: undefined
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

protected async fetchHtml(path: string): Promise<string> {
	const url = path.startsWith('http')
		? path
		: `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;

	const headers: Record<string, string> = {
		'User-Agent': 'Mozilla/5.0',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
		'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8'
	};

	const res = await fetch(url, { headers, redirect: 'follow' });
	if (!res.ok) {
		throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
	}
	return await res.text();
}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(
			chapterId.startsWith('/') ? chapterId : `/${chapterId}`
		);

		if (this.isHoneypot(path)) {
			console.warn('[holodek] honeypot chapter skipped');
			return [];
		}

		let fetchPath = path;
		if (path.startsWith('/comic/')) {
			const rest = path.replace(/^\/comic\//, '');
			const [slug, ...chParts] = rest.split('/');
			const chSlug = chParts.join('/');
			if (slug && chSlug) {
				fetchPath = `/read/${slug}/${chSlug}`;
			}
		} else if (!path.startsWith('/read/')) {
			const parts = path.replace(/^\//, '').split('/');
			if (parts.length >= 2) {
				fetchPath = `/read/${parts[0]}/${parts.slice(1).join('/')}`;
			}
		}

		const html = await this.fetchHtml(fetchPath);
		const images: string[] = [];
		const seen = new Set<string>();
		const $ = cheerio.load(html);

		$('img[src*="imgsvr"], img[data-src*="imgsvr"], img[src*="/image/comic/"]').each(
			(_, img) => {
				let src =
					$(img).attr('src') ||
					$(img).attr('data-src') ||
					$(img).attr('data-lazy-src') ||
					'';
				src = this.absUrl(src.split('?')[0]);
				if (!src || seen.has(src)) return;

				if (
					/chapter-header|site-logo|site-icon|covers\/|reactions\/|avatar/i.test(
						src
					)
				) {
					return;
				}
				if (
					!/\.(webp|jpg|jpeg|png)$/i.test(src) &&
					!/\/image\/comic\//i.test(src)
				) {
					return;
				}

				seen.add(src);
				images.push(src);
			}
		);

		images.sort((a, b) => {
			const na = parseInt(a.match(/\/(\d+)_[^/]+$/)?.[1] || '0', 10);
			const nb = parseInt(b.match(/\/(\d+)_[^/]+$/)?.[1] || '0', 10);
			return na - nb;
		});

		console.log(`[holodek] ${images.length} pages → ${fetchPath}`);
		return images;
	}
}