import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails } from '../types';

/**
 * hentairead.com adapter (HTML scrape)
 *
 * List     : /page/{n}  |  /hentai/page/{n}/?sortby=new&order=desc
 * Search   : /page/{n}/?s=QUERY
 * Detail   : /hentai/{slug}/
 * Pages    : ul.lazy-listing__list img  (hencover → henread, hapus /preview)
 *
 * ID format : "/{slug}"
 *
 * Catatan: situs pakai Cloudflare — fetch server-side bisa gagal tanpa cookie/bypass.
 */
export class HentaireadSource extends BaseSource {
	id = 'hentairead';
	name = 'HentaiRead';
	baseUrl = 'https://hentairead.com';

	// ── HTTP ─────────────────────────────────────────────────────────────────

	/** Jangan namai `headers` — bentrok property BaseSource */
	private h(extra?: Record<string, string>): Record<string, string> {
		return {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
			Accept:
				'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
			'Accept-Language': 'en-US,en;q=0.9',
			Referer: `${this.baseUrl}/`,
			Origin: this.baseUrl,
			...extra
		};
	}

	private async getHtml(url: string): Promise<string> {
		const res = await fetch(url, {
			headers: this.h(),
			redirect: 'follow'
		});
		if (!res.ok) throw new Error(`HTTP ${res.status} → ${url}`);
		const html = await res.text();
		// Cloudflare challenge
		if (
			html.includes('Just a moment') ||
			html.includes('cf-browser-verification') ||
			html.includes('challenge-platform')
		) {
			throw new Error('Cloudflare challenge — hentairead.com blocked');
		}
		return html;
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private decodeHtml(s: string): string {
		return s
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#039;/g, "'")
			.replace(/&#x27;/g, "'")
			.replace(/&nbsp;/g, ' ')
			.trim();
	}

	private toMangaId(slug: string): string {
		return `/${String(slug).replace(/^\/+|\/+$/g, '')}`;
	}

	private extractSlug(id: string): string {
		return (
			String(id)
				.replace(/^\/+|\/+$/g, '')
				.split('/')
				.filter(Boolean)[0] || ''
		);
	}

	/** Ambil URL terbesar dari srcset */
	private pickSrcset(srcset: string): string {
		if (!srcset) return '';
		let best = '';
		let bestW = -1;
		for (const part of srcset.split(',')) {
			const bits = part.trim().split(/\s+/);
			const url = bits[0] || '';
			const w = parseInt((bits[1] || '0').replace(/\D/g, ''), 10) || 0;
			if (url && w >= bestW) {
				bestW = w;
				best = url;
			}
		}
		return best || srcset.trim().split(/\s+/)[0] || '';
	}

	/** Full image: hencover → henread, buang /preview */
	private toFullImage(src: string): string {
		if (!src) return '';
		return src
			.replace(/hencover/gi, 'henread')
			.replace(/\/preview/gi, '');
	}

	/** Pastikan cover jadi URL absolut */
	private normalizeCover(src: string): string {
		if (!src) return '';
		let cover = src.trim();
		if (cover.startsWith('//')) cover = `https:${cover}`;
		else if (cover.startsWith('/')) cover = `${this.baseUrl}${cover}`;
		else if (cover && !cover.startsWith('http')) cover = `${this.baseUrl}/${cover}`;
		return cover;
	}

	// ── List parser ──────────────────────────────────────────────────────────

	/**
	 * Struktur (hentairead-js):
	 *   .manga-grid > item
	 *     a[href*="/hentai/"]  → slug + title
	 *     .manga-item__img img[srcset|data-src|src] → cover
	 */
	private parseList(html: string): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		const blocks = html.split(/class="[^"]*manga-item[^"]*"/i);

		for (let i = 1; i < blocks.length; i++) {
			const block = blocks[i].slice(0, 5000);

			const slugM = block.match(/\/hentai\/([a-z0-9_-]+)\//i);
			if (!slugM) continue;
			const slug = slugM[1];
			if (!slug || seen.has(slug)) continue;
			seen.add(slug);

			let cover = '';
			const srcsetM = block.match(/(?:srcset|data-srcset)=["']([^"']+)["']/i);
			if (srcsetM) {
				cover = this.pickSrcset(srcsetM[1]);
			}
			if (!cover) {
				const lazyM = block.match(
					/(?:data-src|data-original|data-lazy-src)=["']([^"']+)["']/i
				);
				const srcM = block.match(/<img[^>]+src=["']([^"']+)["']/i);
				cover = lazyM?.[1] || srcM?.[1] || '';
			}

			if (
				!cover ||
				cover.startsWith('data:') ||
				/placeholder|blank|spinner|loading/i.test(cover)
			) {
				cover = '';
			}
			cover = this.normalizeCover(cover);

			const titleM =
				block.match(
					/<a[^>]*href="[^"]*\/hentai\/[^"]+"[^>]*>\s*([^<]{2,200})\s*<\/a>/i
				) ||
				block.match(/manga-item__title[^>]*>\s*([^<]+)/i) ||
				block.match(/title="([^"]{2,200})"/i);
			const title = this.decodeHtml(titleM?.[1] || slug.replace(/-/g, ' '));

			out.push({
				id: this.toMangaId(slug),
				sourceId: this.id,
				title,
				cover,
				type: 'doujinshi',
				status: 'Completed'
			});
		}

		if (!out.length) {
			const slugRe =
				/href="(?:https?:\/\/hentairead\.com)?\/hentai\/([a-z0-9_-]+)\/"/gi;
			let m: RegExpExecArray | null;
			while ((m = slugRe.exec(html)) !== null) {
				const slug = m[1];
				if (!slug || seen.has(slug)) continue;
				seen.add(slug);
				out.push({
					id: this.toMangaId(slug),
					sourceId: this.id,
					title: slug.replace(/-/g, ' '),
					cover: '',
					type: 'doujinshi',
					status: 'Completed'
				});
			}
		}

		return out;
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const url = `${this.baseUrl}/hentai/page/${p}/?sortby=new&order=desc`;
			const html = await this.getHtml(url);
			const list = this.parseList(html);
			console.log(`[hentairead] latest page=${p} → ${list.length} items`);
			return list.slice(0, 24);
		} catch (e) {
			console.error('[hentairead] getLatestManga', e);
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
			const params = new URLSearchParams({ s: q });
			const url = `${this.baseUrl}/page/${page}/?${params.toString()}`;
			const html = await this.getHtml(url);
			const list = this.parseList(html);
			console.log(`[hentairead] search "${q}" → ${list.length} items`);
			return list.slice(0, 24);
		} catch (e) {
			console.error('[hentairead] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) throw new Error(`Invalid hentairead id: ${mangaId}`);

		const html = await this.getHtml(`${this.baseUrl}/hentai/${slug}/`);

		const titleM =
			html.match(/manga-titles[^>]*>[\s\S]*?<h1[^>]*>([^<]+)<\/h1>/i) ||
			html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
		const title = titleM
			? this.decodeHtml(titleM[1])
			: slug.replace(/-/g, ' ');

		const altM = html.match(/manga-titles[^>]*>[\s\S]*?<h2[^>]*>([^<]+)<\/h2>/i);
		const alt = altM ? this.decodeHtml(altM[1]) : '';

		let cover = '';
		const srcsetM = html.match(
			/manga-item__img[\s\S]{0,500}?(?:srcset|data-srcset)=["']([^"']+)["']/i
		);
		if (srcsetM) {
			cover = this.pickSrcset(srcsetM[1]);
		}
		if (!cover) {
			const dataSrcM = html.match(
				/manga-item__img[\s\S]{0,500}?(?:data-src|data-original)=["']([^"']+)["']/i
			);
			const imgM = html.match(
				/manga-item__img[\s\S]{0,500}?src=["']([^"']+)["']/i
			);
			cover = dataSrcM?.[1] || imgM?.[1] || '';
		}
		cover = this.normalizeCover(cover);

		const meta: Record<string, string[]> = {};
		const rowRe =
			/<div class="flex flex-wrap items-center gap-2"[^>]*>([\s\S]*?)<\/div>/gi;
		let row: RegExpExecArray | null;
		while ((row = rowRe.exec(html)) !== null) {
			const inner = row[1];
			const keyM = inner.match(/text-primary[^>]*>\s*([^<:]+)\s*:?\s*</i);
			if (!keyM) continue;
			const key = this.decodeHtml(keyM[1]).toLowerCase().replace(/:$/, '');

			const vals: string[] = [];
			const aRe = /<a[^>]*>\s*<span[^>]*>\s*([^<]+)\s*<\/span>/gi;
			let am: RegExpExecArray | null;
			while ((am = aRe.exec(inner)) !== null) {
				const v = this.decodeHtml(am[1]);
				if (v) vals.push(v);
			}
			if (!vals.length) {
				const plain = inner.match(
					/text-gray-(?:100|400)[^>]*>\s*([^<]+)/i
				);
				if (plain) vals.push(this.decodeHtml(plain[1]));
			}
			if (vals.length) meta[key] = vals;
		}

		const artists = meta['artist'] || meta['artists'] || [];
		const tags = meta['tag'] || meta['tags'] || [];
		const characters = meta['character'] || meta['characters'] || [];
		const parodies = meta['parody'] || meta['parodies'] || [];
		const language = (meta['language'] || meta['languages'] || [])[0] || '';
		const pagesRaw = (meta['pages'] || meta['page'] || [])[0] || '';
		const pageCount = parseInt(String(pagesRaw).replace(/\D/g, ''), 10) || 0;
		const uploaded =
			(meta['uploaded'] || meta['upload'] || meta['date'] || meta['released'] || [])[0] ||
			'';

		const genres = [
			...tags,
			...parodies.map((p) => `parody:${p}`),
			...characters.map((c) => `character:${c}`)
		];

		return {
			id: this.toMangaId(slug),
			sourceId: this.id,
			title,
			cover,
			type: 'doujinshi',
			status: 'Completed',
			description: [
				alt && alt !== title && `Alt: ${alt}`,
				language && `Language: ${language}`,
				artists.length && `Artists: ${artists.join(', ')}`,
				pageCount && `Pages: ${pageCount}`,
				uploaded && `Updated: ${uploaded}`
			]
				.filter(Boolean)
				.join('\n'),
			authors: artists,
			genres,
			chapters: [
				{
					id: this.toMangaId(slug),
					title: 'Read',
					number: 1,
					date: uploaded
				}
			]
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const slug = this.extractSlug(chapterId);
		if (!slug) {
			console.error('[hentairead] getChapterPages → empty slug:', chapterId);
			return [];
		}

		try {
			const html = await this.getHtml(`${this.baseUrl}/hentai/${slug}/`);

			const urls: string[] = [];
			const seen = new Set<string>();

			const imgRe =
				/<ul[^>]*class="[^"]*lazy-listing__list[^"]*"[^>]*>([\s\S]*?)<\/ul>/i;
			const listHtml = html.match(imgRe)?.[1] || html;

			const srcRe = /<img[^>]+(?:data-src|src)=["']([^"']+)["']/gi;
			let m: RegExpExecArray | null;

			while ((m = srcRe.exec(listHtml)) !== null) {
				let src = (m[1] || '').trim();
				if (!src || src.startsWith('data:') || /placeholder|blank|spinner/i.test(src)) {
					continue;
				}

				src = this.toFullImage(src);

				if (src.startsWith('//')) src = `https:${src}`;
				else if (src.startsWith('/')) src = `${this.baseUrl}${src}`;

				if (!src.startsWith('http') || seen.has(src)) continue;
				seen.add(src);
				urls.push(src);
			}

			console.log(`[hentairead] ${urls.length} pages → ${slug}`);
			return urls;
		} catch (e) {
			console.error('[hentairead] getChapterPages failed', slug, e);
			return [];
		}
	}
}
