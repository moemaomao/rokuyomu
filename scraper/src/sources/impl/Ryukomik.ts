import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

/**
 * Ryukomik adapter (ryukomik.my.id)
 *
 * Stack: Next.js (RSC)
 * Catalog page 1 : homepage "Project Update" + /api/source/project/search → 24 titles
 * Page 2+        : remaining project pool
 * Search         : /api/source/project/search?q=
 * Detail         : /komik/project/{slug}  (meta from RSC flight data)
 * Chapter        : /chapter/project/{slug}/chapter-{n}
 * Pages          : storage.ryukomik.my.id/chapters/{slug}/{n}/...
 *
 * Image guard:
 *   CDN serves promo PNG unless unlocked via POST /api/image-session
 *   body: { chapter: "{slug}/chapter-{n}" } → Set-Cookie ryu_image_access
 *   Reader loads pages through /api/proxy?url=...&source=ryukomik
 *   Proxy attaches the session cookie and streams original images
 */

export class RyukomikSource extends BaseSource {
	id = 'ryukomik';
	name = 'Ryukomik';
	baseUrl = 'https://ryukomik.my.id';

	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'id';

	private absUrl(url: string): string {
		if (!url) return '';
		url = url.trim();
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
			.replace(/\s*[-|]\s*Ryukomik.*$/i, '')
			.replace(/\s*Bahasa Indonesia.*$/i, '')
			.replace(/^Baca\s+/i, '')
			.trim();
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath = String(path).match(/chapter[_-]?(\d+)(?:[.-](\d+))?/i);
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
			if (m[2] != null && m[2].length <= 2) {
				return parseFloat(`${m[1]}.${m[2]}`);
			}
			return parseInt(m[1], 10);
		}
		const n = String(text).match(/\b(\d+(?:\.\d{1,2})?)\b/);
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
		if (t.includes('manga')) return 'manga';
		return 'manhwa';
	}

	private decodeFlight(html: string): string {
		const chunks = html.match(
			/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g
		) || [];
		let full = '';
		for (const chunk of chunks) {
			const m = chunk.match(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/);
			if (!m) continue;
			try {
				full += m[1]
					.replace(/\\"/g, '"')
					.replace(/\\n/g, '\n')
					.replace(/\\r/g, '')
					.replace(/\\\\/g, '\\')
					.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
						String.fromCharCode(parseInt(h, 16))
					);
			} catch {
				full += m[1];
			}
		}
		return full;
	}

	private mapApiItem(item: any): Manga | null {
		const slug = String(item?.slug || '').trim();
		if (!slug) return null;

		const id = `/komik/project/${slug}`;
		const title = this.normalizeTitle(item.title || slug);
		const cover = this.absUrl(
			item.image || item.cover_url || item.cover || ''
		);

		let latestChapter: string | undefined;
		const chRaw =
			item.chapter_terbaru ||
			item.latest_chapter ||
			item.chapter ||
			'';
		const n = this.parseChapterNumber(String(chRaw));
		if (Number.isFinite(n) && n > 0) latestChapter = String(n);

		const type = this.mapType(
			item.type_genre || item.type || item.genre || 'manhwa'
		);
		const status = this.mapStatus(item.info || item.status);

		return {
			id,
			title,
			cover,
			sourceId: this.id,
			status,
			type,
			lang: this.DEFAULT_LANG,
			latestChapter
		};
	}

	private mergeManga(into: Map<string, Manga>, m: Manga) {
		const prev = into.get(m.id);
		if (!prev) {
			into.set(m.id, m);
			return;
		}
	
		into.set(m.id, {
			...prev,
			...m,
			title: m.title || prev.title,
			cover: m.cover || prev.cover,
			latestChapter: m.latestChapter || prev.latestChapter,
			type: m.type || prev.type,
			status: m.status || prev.status
		});
	}

	private parseProjectCards(html: string): Manga[] {
		const $ = cheerio.load(html);
		const map = new Map<string, Manga>();

		$('a[href*="/komik/project/"]').each((_, el) => {
			const $a = $(el);
			const href = ($a.attr('href') || '').split('?')[0];
			if (!href || /\/chapter\//i.test(href)) return;
			if (!/\/komik\/project\/[^/]+\/?$/.test(href)) return;

			const id = this.cleanId(href);
			if (!/^\/komik\/project\/[^/]+$/i.test(id)) return;

			const $img = $a.find('img').first();
			let title =
				$img.attr('alt') ||
				$a.attr('title') ||
				$a.find('h3, h4, p, span').first().text() ||
				$a.text() ||
				'';
			title = this.normalizeTitle(title);
			if (!title || title.length < 2) {
				const slug = id.split('/').pop() || '';
				title = slug
					.split('-')
					.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
					.join(' ');
			}

			let cover = $img.attr('data-src') || $img.attr('src') || '';
			cover = this.absUrl((cover || '').trim().split(/\s+/)[0]);

			let latestChapter: string | undefined;
			const $card = $a.closest('div').parent();
			$card.find('a[href*="/chapter/project/"]').each((__, a) => {
				const n = this.parseChapterNumber(
					$(a).text(),
					$(a).attr('href') || ''
				);
				if (Number.isFinite(n) && n > 0) {
					latestChapter = String(n);
					return false;
				}
			});

			this.mergeManga(map, {
				id,
				title,
				cover,
				sourceId: this.id,
				status: 'Ongoing',
				type: 'manhwa',
				lang: this.DEFAULT_LANG,
				latestChapter
			});
		});

		const flight = this.decodeFlight(html);
		const re2 =
			/\{"title":"([^"]*)","image":"([^"]*)","genre":"[^"]*","type":"([^"]*)","status":"([^"]*)","chapter":"([^"]*)","slug":"([^"]+)"\}/g;
		let m: RegExpExecArray | null;
		while ((m = re2.exec(flight))) {
			const slug = m[6];
			const n = this.parseChapterNumber(m[5]);
			this.mergeManga(map, {
				id: `/komik/project/${slug}`,
				title: this.normalizeTitle(m[1]),
				cover: this.absUrl(m[2]),
				sourceId: this.id,
				status: this.mapStatus(m[4]),
				type: this.mapType(m[3]),
				lang: this.DEFAULT_LANG,
				latestChapter:
					Number.isFinite(n) && n > 0 ? String(n) : undefined
			});
		}

		return Array.from(map.values());
	}

	private async fetchProjectPool(): Promise<Manga[]> {
		const queries = [
			'',
			'a',
			'e',
			'i',
			'o',
			'the',
			'love',
			're',
			'man',
			'hero',
			'revenge',
			'k',
			's',
			'n',
			'b'
		];
		const map = new Map<string, Manga>();

		await Promise.all(
			queries.map(async (q) => {
				try {
					const path = `/api/source/project/search?q=${encodeURIComponent(q)}`;
					const raw = await this.fetchHtml(path);
					const data = JSON.parse(raw);
					const arr = Array.isArray(data?.data) ? data.data : [];
					for (const item of arr) {
						if (item.source && item.source !== 'project') continue;
						const manga = this.mapApiItem(item);
						if (manga) this.mergeManga(map, manga);
					}
				} catch (e) {
					console.warn('[ryukomik] project search', q, e);
				}
			})
		);

		return Array.from(map.values());
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);

			const homeHtml = await this.fetchHtml('/');
			const fromHome = this.parseProjectCards(homeHtml);
			const pool = await this.fetchProjectPool();

			const map = new Map<string, Manga>();
			const order: string[] = [];

			for (const m of fromHome) {
				if (!map.has(m.id)) order.push(m.id);
				this.mergeManga(map, m);
			}
			for (const m of pool) {
				if (!map.has(m.id)) order.push(m.id);
				this.mergeManga(map, m);
			}

			const ordered = order.map((id) => map.get(id)!).filter(Boolean);

			console.log(
				`[ryukomik] project home=${fromHome.length} total=${ordered.length} withCh=${ordered.filter((x) => x.latestChapter).length}`
			);

			const start = (p - 1) * this.PER_PAGE;
			return ordered.slice(start, start + this.PER_PAGE);
		} catch (e) {
			console.error('[ryukomik] getLatestManga', e);
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
			const path = `/api/source/project/search?q=${encodeURIComponent(q)}`;
			const raw = await this.fetchHtml(path);
			const data = JSON.parse(raw);
			const arr = Array.isArray(data?.data) ? data.data : [];
			const map = new Map<string, Manga>();
			for (const item of arr) {
				if (item.source && item.source !== 'project') continue;
				const m = this.mapApiItem(item);
				if (m) this.mergeManga(map, m);
			}
			const list = Array.from(map.values());
			console.log(`[ryukomik] search "${q}" → ${list.length}`);
			const start = (page - 1) * this.PER_PAGE;
			return list.slice(start, start + this.PER_PAGE);
		} catch (e) {
			console.error('[ryukomik] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);

		if (/\/chapter\//i.test(path)) {
			const m = path.match(/\/chapter\/project\/([^/]+)/i);
			if (m) path = `/komik/project/${m[1]}`;
		}
		if (!path.startsWith('/komik/project/')) {
			const slug = path.replace(/^\/(komik\/)?(project\/)?/, '');
			path = `/komik/project/${slug}`;
		}
		path = path.replace(/\/+$/, '');
		const slug = path.split('/').pop() || '';

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);
		const flight = this.decodeFlight(html);

		let title =
			$('meta[property="og:title"]').attr('content') ||
			$('h1').first().text().trim() ||
			slug;
		title = this.normalizeTitle(title);

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			'';
		let description =
			$('meta[property="og:description"]').attr('content') ||
			$('meta[name="description"]').attr('content') ||
			'';
		let type: 'manga' | 'manhwa' | 'manhua' = 'manhwa';
		let status = 'Ongoing';
		const authors: string[] = [];
		const genres: string[] = [];
		let updatedAt = '';

		const objRe = new RegExp(
			`"slug":"${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s\\S]{0,200}?"title":"([^"]*)"[\\s\\S]{0,80}?"cover_url":"([^"]*)"[\\s\\S]{0,40}?"description":"([\\s\\S]*?)"\\s*,\\s*"type":"([^"]*)"\\s*,\\s*"status":"([^"]*)"\\s*,\\s*"author":"([^"]*)"\\s*,\\s*"genres":\\[([^\\]]*)\\][\\s\\S]{0,120}?"updated_at":"([^"]*)"`,
			'i'
		);
		let om = objRe.exec(flight);

		if (!om) {
			const looser = new RegExp(
				`"slug":"${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s\\S]{0,400}?"description":"([\\s\\S]*?)"\\s*,\\s*"type":"([^"]*)"\\s*,\\s*"status":"([^"]*)"\\s*,\\s*"author":"([^"]*)"\\s*,\\s*"genres":\\[([^\\]]*)\\]`,
				'i'
			);
			const lm = looser.exec(flight);
			if (lm) {
				description = lm[1];
				type = this.mapType(lm[2]);
				status = this.mapStatus(lm[3]);
				if (lm[4]?.trim()) authors.push(lm[4].trim());
				const gs = lm[5].match(/"([^"]+)"/g) || [];
				for (const g of gs) {
					const name = g.replace(/"/g, '');
					if (name && !/^(manhwa|manhua|manga)$/i.test(name))
						genres.push(name);
				}
			}
		} else {
			title = this.normalizeTitle(om[1]) || title;
			cover = om[2] || cover;
			description = om[3];
			type = this.mapType(om[4]);
			status = this.mapStatus(om[5]);
			if (om[6]?.trim()) authors.push(om[6].trim());
			const gs = om[7].match(/"([^"]+)"/g) || [];
			for (const g of gs) {
				const name = g.replace(/"/g, '');
				if (name && !/^(manhwa|manhua|manga)$/i.test(name))
					genres.push(name);
			}
			updatedAt = om[8] || '';
		}

		if (!cover || /og:image/i.test(cover) === false) {
			const cm = flight.match(
				new RegExp(
					`https://storage\\.ryukomik\\.my\\.id/covers/${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^"\\\\]+\\.(?:png|jpg|jpeg|webp)`,
					'i'
				)
			);
			if (cm) cover = cm[0];
		}
		cover = this.absUrl((cover || '').trim().split(/\s+/)[0]);

		description = String(description || '')
			.replace(/\\n/g, '\n')
			.replace(/\s+/g, ' ')
			.trim();
		const shortOg =
			$('meta[property="og:description"]').attr('content') || '';
		if (
			description.length < 40 &&
			shortOg &&
			shortOg.length > description.length
		) {
			description = shortOg.trim();
		}
	
		if (description.length < 80 || /bahasa Indonesia gratis/i.test(description)) {
			const longDesc = flight.match(
				new RegExp(
					`"slug":"${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s\\S]{0,300}?"description":"([\\s\\S]{80,}?)"\\s*,\\s*"type"`
				)
			);
			if (longDesc) {
				description = longDesc[1].replace(/\\n/g, '\n').replace(/\s+/g, ' ').trim();
			}
		}

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		const chBlock = flight.match(
			new RegExp(
				`"slug":"${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s\\S]{0,2500}?"chapters":\\[([\\s\\S]*?)\\](?:\\s*,\\s*"|\\s*\\})`
			)
		);
		if (chBlock) {
			const chRe =
				/\{"id":"[^"]*","slug":"([^"]+)","title":"([^"]*)","date":"([^"]*)"/g;
			let cm: RegExpExecArray | null;
			while ((cm = chRe.exec(chBlock[1]))) {
				const chSlug = cm[1];
				const number = this.parseChapterNumber(cm[2], chSlug);
				if (!Number.isFinite(number) || number <= 0) continue;
				const id = `/chapter/project/${chSlug.replace(/^\/+/, '')}`;
				if (seen.has(id)) continue;
				seen.add(id);
				chapters.push({
					id,
					title: cm[2] || `Chapter ${number}`,
					number,
					date: cm[3] || ''
				});
			}
		}

		if (chapters.length === 0) {
			$(`a[href*="/chapter/project/${slug}"]`).each((_, el) => {
				const href = $(el).attr('href') || '';
				const id = this.cleanId(href);
				if (seen.has(id) || !/chapter/i.test(id)) return;
				seen.add(id);
				const number = this.parseChapterNumber($(el).text(), id);
				if (!Number.isFinite(number) || number <= 0) return;
				chapters.push({
					id,
					title: `Chapter ${number}`,
					number,
					date: ''
				});
			});
		}

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		const latestChapter =
			chapters.length && chapters[0].number != null
				? String(chapters[0].number)
				: undefined;

		const metaLines = [
			authors.length && `Author: ${authors.join(' · ')}`,
			updatedAt &&
				`Updated: ${chapters[0]?.date || updatedAt.slice(0, 10)}`,
			chapters[0]?.date && `Latest: ${chapters[0].date}`,
			`Language: Indonesian`,
			`Type: ${type}`,
			chapters.length && `Chapters: ${chapters.length}`
		].filter(Boolean);

		const fullDescription = [...metaLines, description]
			.filter(Boolean)
			.join('\n');

		console.log(
			`[ryukomik] details ${path} → ch=${chapters.length} author=${authors[0] || '-'} descLen=${description.length}`
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

	/**
 * Replace getChapterPages() in Ryukomik.ts
 * Return RAW storage URLs only — reader/proxyImage() wraps once via /api/proxy.
 */

async getChapterPages(chapterId: string): Promise<string[]> {
	const path = this.cleanId(
		chapterId.startsWith('/') ? chapterId : `/${chapterId}`
	);

	const keyMatch = path.match(
		/\/chapter\/project\/([^/]+\/chapter-\d+(?:\.\d+)?)/i
	);
	const chapterKey = keyMatch
		? keyMatch[1]
		: path.replace(/^\/chapter\/project\//i, '').replace(/^\/+/, '');

	const maxAttempts = 3;
	let lastErr: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			// Optional warm-up (proxy also unlocks per image)
			try {
				await fetch(`${this.baseUrl}/api/image-session`, {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						'user-agent':
							'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
						referer: `${this.baseUrl}/chapter/project/${chapterKey}`,
						origin: this.baseUrl
					},
					body: JSON.stringify({ chapter: chapterKey })
				});
			} catch {
				/* ignore */
			}

			const html = await this.fetchHtml(path);
			const images: string[] = [];
			const seen = new Set<string>();

			const push = (src: string) => {
				src = this.absUrl((src || '').trim().split(/\s+/)[0]);
				if (
					!src ||
					seen.has(src) ||
					!/^https?:\/\/storage\.ryukomik\.my\.id\//i.test(src) ||
					src.startsWith('data:') ||
					/logo|icon|avatar|spinner|ads|banner|placeholder|recruitment/i.test(src) ||
					/\/covers\//i.test(src) ||
					/\.gif(\?|$)/i.test(src)
				) {
					return;
				}
				seen.add(src);
				// RAW url only — do NOT prefix /api/proxy here
				images.push(src);
			};

			const re =
				/https:\/\/storage\.ryukomik\.my\.id\/chapters\/[^"'\\\s]+?\.(?:jpg|jpeg|png|webp)/gi;
			for (const u of html.match(re) || []) push(u);

			if (images.length === 0) {
				const $ = cheerio.load(html);
				$('img').each((_, img) => {
					const src =
						$(img).attr('data-src') ||
						$(img).attr('src') ||
						'';
					if (/storage\.ryukomik\.my\.id\/chapters\//i.test(src)) {
						push(src);
					}
				});
			}

			if (images.length === 0) {
				console.warn(
					`[ryukomik] 0 pages attempt=${attempt}`,
					path,
					'htmlLen=',
					html.length
				);
				lastErr = new Error('Ryukomik chapter has 0 images');
				await new Promise((r) => setTimeout(r, 400 * attempt));
				continue;
			}

			const numbered = images.filter((u) =>
				/ch-chapter-\d+_\d+|_\d{2,4}_|\/\d{2,4}[_-]/i.test(u)
			);
			const out = numbered.length >= Math.min(3, images.length) ? numbered : images;
			console.log(`[ryukomik] ${out.length} pages → ${path}`);
			return out;
		} catch (e) {
			lastErr = e;
			console.error(`[ryukomik] getChapterPages attempt=${attempt}`, path, e);
			if (attempt < maxAttempts) {
				await new Promise((r) => setTimeout(r, 500 * attempt));
			}
		}
	}

	console.error('[ryukomik] getChapterPages failed', path, lastErr);
	return [];
}
}