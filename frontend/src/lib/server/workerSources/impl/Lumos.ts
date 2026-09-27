/**
 * LumosKomik adapter (03.lumosgg.com)
 *
 * Theme     : Astro + htg-card (mirip Holodek / HoloToon)
 * Latest    : /browse?sort=latest&page={n}  |  /project?page={n}
 * Search    : /browse?q={query}&page={n}
 * Detail    : /comic/{slug}   (+ JSON-LD ComicSeries)
 * Chapter   : /read/{slug}/chapter-{num}
 * Pages     : #reader-pages img  /  lms.imgsvr.my.id
 *
 * ID format:
 *   manga   : /comic/{slug}
 *   chapter : /read/{slug}/chapter-{num}
 *
 * Bahasa: Indonesian
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class LumosSource extends BaseSource {
	id = 'lumos';
	name = 'LumosKomik';
	baseUrl = 'https://03.lumosgg.com';

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
			.replace(/\s*[|–-]\s*LumosKomik.*$/i, '')
			.replace(/\s*[|–-]\s*Lumos.*$/i, '')
			.replace(/\s*Bahasa Indonesia.*$/i, '')
			.replace(/^Baca\s+/i, '')
			.trim();
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath = String(path).match(/chapter-(\d+)(?:[.-](\d+))?/i);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null && fromPath[2].length <= 2) {
				return parseFloat(`${major}.${fromPath[2]}`);
			}
			return major;
		}
		const m = String(text).match(/(?:chapter|chap|ch\.?)\s*(\d+)(?:[.,](\d+))?/i);
		if (m) {
			if (m[2] != null && m[2].length <= 2) {
				return parseFloat(`${m[1]}.${m[2]}`);
			}
			return parseInt(m[1], 10);
		}
		const n = String(text).match(/\b(\d+(?:\.\d{1,2})?)\b/);
		return n ? parseFloat(n[1]) : NaN;
	}

	private mapType(raw: string): 'manga' | 'manhwa' | 'manhua' {
		const t = String(raw || '').toLowerCase();
		if (t.includes('manhwa')) return 'manhwa';
		if (t.includes('manhua')) return 'manhua';
		if (t.includes('manga')) return 'manga';
		return 'manhwa';
	}

	private mapStatus(raw?: string | null): string {
		const s = String(raw || '').toLowerCase();
		if (/\b(completed|complete|tamat|selesai|end|finish)\b/.test(s)) return 'Completed';
		if (/\bhiatus\b/.test(s)) return 'Hiatus';
		if (/\b(cancelled|dropped|canceled)\b/.test(s)) return 'Cancelled';
		return 'Ongoing';
	}

	private cleanSynopsis(raw: string): string {
		let description = (raw || '').replace(/\s+/g, ' ').trim();
		description = description
			.replace(/\s*Chapter\s+\d+\s*[—\-–].*$/i, '')
			.replace(/\s*Start Reading.*$/i, '')
			.replace(/\s*Bookmark.*$/i, '')
			.replace(/\s*Show more.*$/i, '')
			.replace(/\s*View Series.*$/i, '')
			.replace(/\s*Loading\.\.\..*$/i, '')
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

		// Kartu utama: .htg-card (project & browse)
		const $cards = $('.htg-card');
		if ($cards.length > 0) {
			$cards.each((_, el) => {
				const $card = $(el);
				const $a = $card
					.find('a[href*="/comic/"]')
					.filter((_, a) => {
						const h = ($(a).attr('href') || '').split('?')[0];
						return /\/comic\/[^/]+\/?$/.test(h);
					})
					.first();
				const href = $a.attr('href') || '';
				if (!href) return;

				const id = this.cleanId(href);
				if (!/^\/comic\/[^/]+$/i.test(id) || this.isHoneypot(id) || seen.has(id)) return;
				seen.add(id);

				const $img = $card.find('img').first();
				let title =
					$card.find('h3, h2, h1').first().text() ||
					$img.attr('alt') ||
					$a.attr('title') ||
					'';
				title = this.normalizeTitle(title);
				if (!title || title.length < 2) {
					const slug = id.split('/').filter(Boolean).pop() || '';
					title = slug
						.split('-')
						.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
						.join(' ');
				}
				if (!title) return;

				let cover =
					$img.attr('src') ||
					$img.attr('data-src') ||
					$img.attr('data-lazy-src') ||
					'';
				cover = this.absUrl((cover || '').split('?')[0]);

				const blockText = $card.text();
				const n = this.parseChapterNumber(blockText);
				const typeMatch = blockText.match(/\b(manhwa|manhua|manga)\b/i);
				let status = 'Ongoing';
				if (/\b(completed|tamat|selesai|end)\b/i.test(blockText)) status = 'Completed';
				else if (/\bhiatus\b/i.test(blockText)) status = 'Hiatus';

				out.push({
					id,
					sourceId: this.id,
					title,
					cover,
					type: typeMatch ? this.mapType(typeMatch[1]) : 'manhwa',
					status,
					latestChapter: Number.isFinite(n) && n > 0 ? n : undefined,
					lang: this.DEFAULT_LANG
				});
			});
			return out;
		}

		// Fallback: link langsung
		$('a[href*="/comic/"]').each((_, el) => {
			const $a = $(el);
			const href = $a.attr('href') || '';
			const id = this.cleanId(href);
			if (!/^\/comic\/[^/]+$/i.test(id) || this.isHoneypot(id) || seen.has(id)) return;
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
				latestChapter: Number.isFinite(n) && n > 0 ? n : undefined,
				lang: this.DEFAULT_LANG
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
			// Prefer project list (series resmi Lumos), fallback browse latest
			const path =
				p <= 1 ? `/project` : `/project?page=${p}`;

			const html = await this.fetchHtml(path);
			const $ = cheerio.load(html);
			let list = this.parseBrowseCards($);

			if (list.length === 0) {
				const browsePath =
					p <= 1 ? `/browse?sort=latest` : `/browse?sort=latest&page=${p}`;
				const html2 = await this.fetchHtml(browsePath);
				list = this.parseBrowseCards(cheerio.load(html2));
			}

			console.log(`[lumos] latest page=${p} → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[lumos] getLatestManga', e);
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

			console.log(`[lumos] search "${q}" page=${page} → ${list.length}`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[lumos] searchManga', e);
			return [];
		}
	}

	// ── JSON-LD ──────────────────────────────────────────────────────────────

	private parseJsonLd(html: string): {
		title?: string;
		description?: string;
		cover?: string;
		authors: string[];
		artists: string[];
		genres: string[];
		status?: string;
		year?: string;
		rating?: string;
		alt?: string;
	} {
		const out = {
			authors: [] as string[],
			artists: [] as string[],
			genres: [] as string[]
		};
		const scripts = html.match(
			/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
		);
		if (!scripts) return out;

		for (const block of scripts) {
			const raw = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '').trim();
			let data: any;
			try {
				data = JSON.parse(raw);
			} catch {
				continue;
			}

			const items: any[] = Array.isArray(data)
				? data
				: data?.['@graph']
					? data['@graph']
					: [data];

			for (const item of items) {
				const types = Array.isArray(item?.['@type'])
					? item['@type']
					: [item?.['@type']];
				const isSeries =
					types.includes('ComicSeries') ||
					types.includes('Book') ||
					item?.author ||
					item?.aggregateRating;

				if (!isSeries) continue;

				if (item.name || item.headline) {
					(out as any).title = String(item.name || item.headline).trim();
				}
				if (item.description) {
					(out as any).description = this.cleanSynopsis(String(item.description));
				}
				const img =
					typeof item.image === 'string'
						? item.image
						: item.image?.url || item.thumbnailUrl;
				if (img) (out as any).cover = String(img);

				const pushPerson = (p: any, arr: string[]) => {
					const name = typeof p === 'string' ? p : p?.name ? String(p.name) : '';
					const n = name.trim();
					if (n && n !== '-' && !arr.includes(n)) arr.push(n);
				};
				if (item.author) {
					const authors = Array.isArray(item.author) ? item.author : [item.author];
					authors.forEach((a: any) => pushPerson(a, out.authors));
				}
				if (item.illustrator) {
					const arts = Array.isArray(item.illustrator)
						? item.illustrator
						: [item.illustrator];
					arts.forEach((a: any) => pushPerson(a, out.artists));
				}
				if (Array.isArray(item.genre)) {
					for (const g of item.genre) {
						const name = String(g || '').trim();
						if (name && name.length < 40 && !out.genres.includes(name)) {
							out.genres.push(name);
						}
					}
				}
				if (item.creativeWorkStatus) {
					(out as any).status = String(item.creativeWorkStatus);
				}
				if (item.datePublished) {
					(out as any).year = String(item.datePublished).slice(0, 4);
				}
				const ar = item.aggregateRating;
				if (ar?.ratingValue != null) {
					const v = Number(ar.ratingValue);
					if (!Number.isNaN(v)) (out as any).rating = v.toFixed(1);
				}
				if (item.alternateName) {
					(out as any).alt = Array.isArray(item.alternateName)
						? item.alternateName.filter(Boolean).join(' · ')
						: String(item.alternateName).trim();
				}
			}
		}
		return out;
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
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
			throw new Error(`Invalid lumos id: ${mangaId}`);
		}

		const html = await this.fetchHtml(`/comic/${slug}`);
		const $ = cheerio.load(html);
		const ld = this.parseJsonLd(html);

		let title =
			ld.title ||
			$('h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content') ||
			slug;
		title = this.normalizeTitle(title);

		let cover =
			ld.cover ||
			$('meta[property="og:image"]').attr('content') ||
			$('img[src*="imgsvr"][src*="cover"]').first().attr('src') ||
			$('img[src*="cover"]').first().attr('src') ||
			$('img').first().attr('src') ||
			'';
		cover = this.absUrl((cover || '').split('?')[0]);

		let description =
			ld.description ||
			this.cleanSynopsis($('meta[name="description"]').attr('content') || '') ||
			'';

		// Status / type dari DOM
		const bodyText = $('body').text();
		let status = this.mapStatus(ld.status);
		if (/\bOngoing\b/i.test(bodyText) && status === 'Ongoing') {
			/* keep */
		} else if (/\b(Completed|Tamat|Selesai)\b/i.test(bodyText)) {
			status = 'Completed';
		} else if (/\bHiatus\b/i.test(bodyText)) {
			status = 'Hiatus';
		}

		let type: 'manga' | 'manhwa' | 'manhua' = 'manhwa';
		if (/\bMANHUA\b/i.test(bodyText)) type = 'manhua';
		else if (/\bMANGA\b/i.test(bodyText) && !/\bMANHWA\b/i.test(bodyText)) type = 'manga';
		else if (/\bMANHWA\b/i.test(bodyText)) type = 'manhwa';
		// genre list sering mengandung "Manhwa"
		const genreHasType = ld.genres.find((g) =>
			/^(manhwa|manhua|manga)$/i.test(g)
		);
		if (genreHasType) type = this.mapType(genreHasType);

		const authors = [...ld.authors];
		const artists = [...ld.artists];
		// Fallback DOM label Author / Artist
		if (!authors.length) {
			$('body')
				.find('*')
				.filter((_, el) => /^\s*Author\s*$/i.test($(el).text()))
				.each((_, el) => {
					const t = $(el).next().text().trim() || $(el).parent().text().replace(/Author/i, '').trim();
					if (t && t.length < 80 && !authors.includes(t)) authors.push(t.split('\n')[0].trim());
				});
		}
		if (!artists.length) {
			$('body')
				.find('*')
				.filter((_, el) => /^\s*Artist\s*$/i.test($(el).text()))
				.each((_, el) => {
					const t = $(el).next().text().trim() || $(el).parent().text().replace(/Artist/i, '').trim();
					if (t && t.length < 80 && !artists.includes(t)) artists.push(t.split('\n')[0].trim());
				});
		}

		const genres = ld.genres.filter((g) => !/^(manhwa|manhua|manga)$/i.test(g));

		// Chapters
		// Link text format situs: "Chapter 124 2 bulan lalu"
		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		const RELATIVE_DATE_RE =
			/(\d+\s*(?:hours?|hrs?|days?|weeks?|months?|years?|jam|hari|minggu|bulan|tahun)\s*(?:lalu|ago)|yesterday|today|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})/i;

		$('a[href*="/read/"]').each((_, a) => {
			const $a = $(a);
			const href = $a.attr('href') || '';
			const id = this.cleanId(href);
			if (seen.has(id) || !/\/read\/[^/]+\/chapter-/i.test(id)) return;
			if (this.isHoneypot(id)) return;

			const fullText = $a.text().replace(/\s+/g, ' ').trim();

			// Skip tombol navigasi "Chapter Pertama" / "Chapter Terbaru"
			if (/^(Chapter Pertama|Chapter Terbaru)$/i.test(fullText)) return;

			seen.add(id);

			// Ambil tanggal dari teks link dulu (format: "Chapter 124 2 bulan lalu")
			let date = '';
			const dateFromText = fullText.match(RELATIVE_DATE_RE);
			if (dateFromText) date = dateFromText[1].trim();

			let rawText = fullText
				.replace(RELATIVE_DATE_RE, '')
				.replace(/\s+/g, ' ')
				.trim();

			const number = this.parseChapterNumber(rawText || id, id);
			if (!Number.isFinite(number)) return;

			// Jangan ambil "Bookmark" / teks tombol lain sebagai tanggal
			if (!date) {
				const candidate =
					$a.find('span, time').last().text().trim() ||
					$a.parent().find('span, time').not($a).last().text().trim() ||
					'';
				if (
					candidate &&
					!/bookmark|rating|share|download|login|masuk/i.test(candidate) &&
					RELATIVE_DATE_RE.test(candidate)
				) {
					date = candidate.match(RELATIVE_DATE_RE)?.[1]?.trim() || '';
				}
			}

			const chapterTitle =
				rawText && /chapter/i.test(rawText) ? rawText : `Chapter ${number}`;

			chapters.push({
				id,
				title: chapterTitle,
				number,
				date
			});
		});

		// Unik + sort desc
		const unique: Chapter[] = [];
		const seenNum = new Set<number>();
		for (const ch of chapters) {
			const key = ch.number;
			if (seenNum.has(key)) continue;
			seenNum.add(key);
			unique.push(ch);
		}
		unique.sort((a, b) => (b.number || 0) - (a.number || 0));

		const latestChapter =
			unique.length && unique[0].number != null
				? String(unique[0].number)
				: undefined;

		const metaLines = [
			ld.alt && `Alternative: ${ld.alt}`,
			ld.rating && `Rating: ${ld.rating}/5`,
			authors.length && `Author: ${authors.join(' · ')}`,
			artists.length && `Artist: ${artists.join(' · ')}`,
			// UI parseMeta baca "Publication" / "Published" (bukan "Year")
			ld.year && `Publication: ${ld.year}`,
			`Language: Indonesian`,
			`Type: ${type}`
		].filter(Boolean);

		const fullDescription = [...metaLines, description].filter(Boolean).join('\n');

		const allCreators = [...authors];
		for (const a of artists) {
			if (!allCreators.includes(a)) allCreators.push(a);
		}

		console.log(
			`[lumos] details ${path} → ch=${unique.length} rating=${ld.rating} type=${type}`
		);

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			description: fullDescription,
			authors: allCreators,
			genres,
			status,
			chapters: unique,
			type,
			latestChapter
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(
			chapterId.startsWith('/') ? chapterId : `/${chapterId}`
		);

		if (this.isHoneypot(path)) {
			console.warn('[lumos] honeypot chapter skipped');
			return [];
		}

		// Normalisasi ke /read/{slug}/chapter-{n}
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

		const maxAttempts = 3;
		let lastErr: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const html = await this.fetchHtml(fetchPath);
				const lower = html.toLowerCase();
				if (
					lower.includes('cf-browser-verification') ||
					lower.includes('just a moment') ||
					(lower.includes('challenge-platform') && html.length < 5000)
				) {
					console.warn(`[lumos] chapter blocked/CF attempt=${attempt}`, fetchPath);
					lastErr = new Error('Lumos chapter blocked by CF');
					await new Promise((r) => setTimeout(r, 500 * attempt));
					continue;
				}

				const $ = cheerio.load(html);
				const images: string[] = [];
				const seen = new Set<string>();

				const push = (src: string) => {
					src = this.absUrl((src || '').trim().split('?')[0]);
					if (
						!src ||
						seen.has(src) ||
						!/^https?:\/\//i.test(src) ||
						/logo|icon|avatar|spinner|ads|banner|placeholder|gravatar|gtag|cover_|site-/i.test(
							src
						) ||
						/\.gif(\?|$)/i.test(src)
					) {
						return;
					}
					seen.add(src);
					images.push(src);
				};

				// Primary: #reader-pages
				$('#reader-pages img, .reader-pages img').each((_, img) => {
					push(
						$(img).attr('data-src') ||
							$(img).attr('data-lazy-src') ||
							$(img).attr('src') ||
							''
					);
				});

				// Fallback: imgsvr chapter images
				if (images.length === 0) {
					$('img[src*="imgsvr"], img[data-src*="imgsvr"]').each((_, img) => {
						const src =
							$(img).attr('data-src') ||
							$(img).attr('data-lazy-src') ||
							$(img).attr('src') ||
							'';
						if (/\/chapter-|\/file\/comic\//i.test(src)) push(src);
					});
				}

				// Regex fallback dari HTML mentah
				if (images.length === 0) {
					const re =
						/https:\/\/lms\.imgsvr\.my\.id\/file\/comic\/[^"'\\\s<>]+/gi;
					const found = html.match(re) || [];
					for (const u of found) {
						if (!/cover_/i.test(u)) push(u);
					}
				}

				// Sort by page number in filename (001_, 002_, …)
				images.sort((a, b) => {
					const na = parseInt(a.match(/\/(\d+)(?:_\d+)?_[^/]+$/)?.[1] || '0', 10);
					const nb = parseInt(b.match(/\/(\d+)(?:_\d+)?_[^/]+$/)?.[1] || '0', 10);
					if (na !== nb) return na - nb;
					return a.localeCompare(b);
				});

				if (images.length === 0) {
					console.warn(
						`[lumos] 0 pages attempt=${attempt}`,
						fetchPath,
						'htmlLen=',
						html.length
					);
					lastErr = new Error('Lumos chapter has 0 images');
					await new Promise((r) => setTimeout(r, 400 * attempt));
					continue;
				}

				console.log(`[lumos] ${images.length} pages → ${fetchPath}`);
				return images;
			} catch (e) {
				lastErr = e;
				console.error(`[lumos] getChapterPages attempt=${attempt}`, fetchPath, e);
				if (attempt < maxAttempts) {
					await new Promise((r) => setTimeout(r, 500 * attempt));
				}
			}
		}

		console.error('[lumos] getChapterPages failed', fetchPath, lastErr);
		return [];
	}
}
