import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails } from '../types';

/**
 * hentailoop.com adapter
 *
 * List     : /manga/  |  /manga/page/{n}/
 * Search   : /?s=QUERY
 * Detail   : /manga/{slug}/
 * Pages    : preview thumbs → full (buang -150x200), atau reader /read/p/N/
 *
 * ID format : "/{slug}"
 *
 * Catatan: Cloudflare sering block outbound IP Vercel.
 * Kalau gagal terus → pindah ke workerSources.
 */
export class HentailoopSource extends BaseSource {
	id = 'hentailoop';
	name = 'HentaiLoop';
	baseUrl = 'https://hentailoop.com';

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
		const res = await fetch(url, { headers: this.h(), redirect: 'follow' });
		if (!res.ok) throw new Error(`HTTP ${res.status} → ${url}`);
		const html = await res.text();
		if (
			html.includes('Just a moment') ||
			html.includes('cf-browser-verification') ||
			html.includes('challenge-platform') ||
			html.includes('Verify you are human')
		) {
			throw new Error('Cloudflare challenge — hentailoop.com blocked');
		}
		return html;
	}

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

	private normalizeCover(src: string): string {
		if (!src) return '';
		let cover = src.trim();
		if (cover.startsWith('//')) cover = `https:${cover}`;
		else if (cover.startsWith('/')) cover = `${this.baseUrl}${cover}`;
		// buang size suffix WordPress
		cover = cover.replace(/-\d+x\d+(\.(jpg|jpeg|png|webp))/i, '$1');
		return cover;
	}

	/** Full page image dari thumb hentailoop */
	private toFullImage(src: string): string {
		if (!src) return '';
		let u = src.trim();
		if (u.startsWith('//')) u = `https:${u}`;
		// hapus -150x200 / -WxH
		u = u.replace(/-\d+x\d+(\.(jpg|jpeg|png|webp))/i, '$1');
		return u;
	}

	private parseList(html: string): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		// link /manga/{slug}/
		const re =
			/href="(?:https?:\/\/hentailoop\.com)?\/manga\/([a-z0-9][a-z0-9\-_%]+)\/"/gi;
		let m: RegExpExecArray | null;
		while ((m = re.exec(html)) !== null) {
			const slug = decodeURIComponent(m[1]);
			if (!slug || seen.has(slug) || slug === 'page' || slug.startsWith('page/')) continue;
			seen.add(slug);

			// cari cover di sekitar link (approximate)
			const start = Math.max(0, m.index - 800);
			const chunk = html.slice(start, m.index + 1200);
			const imgM =
				chunk.match(
					/(?:data-src|data-lazy-src|data-original|src)=["'](https?:\/\/[^"']*hentailoop[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i
				) ||
				chunk.match(
					/(?:data-src|src)=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i
				);
			let cover = imgM?.[1] || '';
			if (/placeholder|blank|spinner|loading|data:/i.test(cover)) cover = '';
			cover = this.normalizeCover(cover);

			const titleM =
				chunk.match(/title=["']([^"']{2,200})["']/i) ||
				chunk.match(/<h[23][^>]*>\s*([^<]{2,200})\s*<\/h[23]>/i) ||
				chunk.match(/alt=["']([^"']{2,200})["']/i);
			const title = this.decodeHtml(
				titleM?.[1] || slug.replace(/-/g, ' ')
			);

			out.push({
				id: this.toMangaId(slug),
				sourceId: this.id,
				title,
				cover,
				type: 'doujinshi',
				status: 'Completed'
			});
		}

		return out;
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const url =
				p <= 1
					? `${this.baseUrl}/manga/`
					: `${this.baseUrl}/manga/page/${p}/`;
			const html = await this.getHtml(url);
			const list = this.parseList(html);
			console.log(`[hentailoop] latest page=${p} → ${list.length} items`);
			return list.slice(0, 24);
		} catch (e) {
			console.error('[hentailoop] getLatestManga', e);
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
			if (page > 1) params.set('paged', String(page));
			const url = `${this.baseUrl}/?${params.toString()}`;
			const html = await this.getHtml(url);
			const list = this.parseList(html);
			console.log(`[hentailoop] search "${q}" → ${list.length} items`);
			return list.slice(0, 24);
		} catch (e) {
			console.error('[hentailoop] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = this.extractSlug(mangaId);
		if (!slug) throw new Error(`Invalid hentailoop id: ${mangaId}`);

		const html = await this.getHtml(`${this.baseUrl}/manga/${slug}/`);

		const titleM =
	html.match(/<h1[^>]*>([^<]+)<\/h1>/i) ||
	html.match(/<title>([^<]+)<\/title>/i);
let title = titleM
	? this.decodeHtml(titleM[1])
	: slug.replace(/-/g, ' ');
// bersihkan suffix situs
title = title
	.replace(/\s*[-–|]\s*Hentai(?:\s*Loop)?.*$/i, '')
	.replace(/\s*[-–|]\s*free hentai.*$/i, '')
	.trim();

		const altM = html.match(/<h2[^>]*>([^<]+)<\/h2>/i);
		const alt = altM ? this.decodeHtml(altM[1]) : '';

		let cover = '';
		const coverM =
			html.match(
				/(?:data-src|src)=["'](https?:\/\/i\d*\.hentailoop\.com[^"']+)["']/i
			) ||
			html.match(
				/(?:data-src|src)=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i
			);
		cover = this.normalizeCover(coverM?.[1] || '');

		const pagesM = html.match(/Pages:\s*(\d+)/i);
		const pageCount = pagesM ? parseInt(pagesM[1], 10) : 0;

		const statusM = html.match(/Status:\s*([A-Za-z]+)/i);
		const status = statusM?.[1] || 'Completed';

		const updatedM = html.match(/Updated:\s*([^\n<]+)/i);
		const updated = updatedM ? this.decodeHtml(updatedM[1]).trim() : '';

		const artists: string[] = [];
		const tags: string[] = [];
		// parse simple tag links if present
		const tagRe = /\/tag\/([^/"']+)\/[^>]*>\s*([^<]+)/gi;
		let tm: RegExpExecArray | null;
		while ((tm = tagRe.exec(html)) !== null) {
			const t = this.decodeHtml(tm[2] || tm[1].replace(/-/g, ' '));
			if (t && !tags.includes(t)) tags.push(t);
		}

		return {
			id: this.toMangaId(slug),
			sourceId: this.id,
			title,
			cover,
			type: 'doujinshi',
			status,
			description: [
				alt && alt !== title && `Alt: ${alt}`,
				pageCount && `Pages: ${pageCount}`,
				updated && `Updated: ${updated}`
			]
				.filter(Boolean)
				.join('\n'),
			authors: artists,
			genres: tags,
			chapters: [
				{
					id: this.toMangaId(slug),
					title: 'Read',
					number: 1,
					date: updated
				}
			]
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const slug = this.extractSlug(chapterId);
		if (!slug) {
			console.error('[hentailoop] getChapterPages → empty slug:', chapterId);
			return [];
		}

		try {
			const html = await this.getHtml(`${this.baseUrl}/manga/${slug}/`);
			const urls: string[] = [];
			const seen = new Set<string>();

			// preview thumbs di detail page
			const imgRe =
				/(?:data-src|data-lazy-src|src)=["'](https?:\/\/i\d*\.hentailoop\.com[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/gi;
			let m: RegExpExecArray | null;
			while ((m = imgRe.exec(html)) !== null) {
				let src = this.toFullImage(m[1]);
				if (!src || seen.has(src) || /avatar|logo|icon/i.test(src)) continue;
				seen.add(src);
				urls.push(src);
			}

			// fallback: generate dari page count kalau cuma dapat sedikit
			if (urls.length < 3) {
				const pagesM = html.match(/Pages:\s*(\d+)/i);
				const total = pagesM ? parseInt(pagesM[1], 10) : 0;
				if (total > 0 && urls[0]) {
					const base = urls[0].replace(/-page-\d+/i, '-page-{n}');
					if (base.includes('{n}')) {
						const generated: string[] = [];
						for (let i = 1; i <= total; i++) {
							generated.push(base.replace('{n}', String(i)));
						}
						console.log(
							`[hentailoop] generated ${generated.length} pages from pattern`
						);
						return generated;
					}
				}
			}

			console.log(`[hentailoop] ${urls.length} pages → ${slug}`);
			return urls;
		} catch (e) {
			console.error('[hentailoop] getChapterPages failed', slug, e);
			return [];
		}
	}
}