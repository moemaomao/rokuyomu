import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import * as cheerio from 'cheerio';

export class VoratoonSource extends BaseSource {
	id = 'voratoon';
	name = 'Voratoon';
	baseUrl = 'https://v2.voratoon.com';

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
		return id.replace(/\/+$/, '').split('?')[0] || '/';
	}

	private cleanUrl(url: string): string {
		if (!url) return '';
		return url
			.replace(/\\u0026/gi, '&')
			.replace(/&amp;/g, '&')
			.replace(/\\"/g, '"')
			.trim();
	}

	private slugToTitle(slug: string): string {
		return slug
			.split('-')
			.map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
			.join(' ')
			.trim();
	}

	private flagToType(flagSrc: string): string {
		const s = (flagSrc || '').toLowerCase();
		if (/\/kr\.|korea|\/kr\b/.test(s)) return 'manhwa';
		if (/\/cn\.|\/tw\.|china|\/cn\b/.test(s)) return 'manhua';
		if (/\/jp\.|japan|\/jp\b/.test(s)) return 'manga';
		return 'manga';
	}

	private parseChapterNumber(text: string, path = ''): number {
		const fromPath = path.match(/\/chapter\/(\d+)(?:[.-](\d+))?/i);
		if (fromPath) {
			if (fromPath[2] != null) return parseFloat(`${fromPath[1]}.${fromPath[2]}`);
			return parseInt(fromPath[1], 10);
		}
		const m = String(text).match(/(?:chapter|chap|ch\.?)\s*(\d+)(?:[.,](\d+))?/i);
		if (m) {
			if (m[2] != null) return parseFloat(`${m[1]}.${m[2]}`);
			return parseInt(m[1], 10);
		}
		const n = String(text).match(/\b(\d+(?:\.\d+)?)\b/);
		return n ? parseFloat(n[1]) : NaN;
	}

	private parseUpdateCards(html: string): Manga[] {
		const $ = cheerio.load(html);
		const out: Manga[] = [];
		const seen = new Set<string>();

		$('article').each((_, art) => {
			const $art = $(art);

			const coverA = $art
				.find('a[href*="/series/"]')
				.filter((_, a) => {
					const h = $(a).attr('href') || '';
					return /\/series\/[a-z0-9\-]+\/?$/i.test(h) && !h.includes('/chapter/');
				})
				.first();

			const href =
				coverA.attr('href') ||
				$art.find('a[href*="/series/"]').first().attr('href') ||
				'';
			const m = href.match(/\/series\/([a-z0-9\-]+)/i);
			if (!m) return;

			const slug = m[1];
			const id = `/series/${slug}`;
			if (seen.has(id)) return;
			seen.add(id);

			let title =
				$art.find('a[class*="title"]').first().text().replace(/\s+/g, ' ').trim() ||
				coverA.find('img').attr('alt')?.replace(/^Cover\s+/i, '').trim() ||
				this.slugToTitle(slug);

			let cover = this.cleanUrl(
				coverA.find('img[src*="/cover/"]').attr('src') ||
					$art.find('img[src*="/cover/"]').first().attr('src') ||
					''
			);

			const flagSrc =
				$art.find('img[src*="flagcdn.com"]').attr('src') ||
				$art.find('img[class*="flag"]').attr('src') ||
				'';
			const type = this.flagToType(flagSrc);

			let latestChapter: number | undefined;

			$art.find('a[href*="/chapter/"]').each((_, a) => {
				const chHref = $(a).attr('href') || '';
				const n = this.parseChapterNumber(
					$(a).attr('aria-label') || $(a).text(),
					chHref
				);
				if (!Number.isFinite(n)) return;
				if (latestChapter == null || n > latestChapter) {
					latestChapter = n;
				}
			});

			out.push({
				id,
				sourceId: this.id,
				title,
				cover,
				type,
				status: 'Ongoing',
				latestChapter,
				lang: this.LIST_LANG
			});
		});

		if (out.some((m) => !m.cover)) {
			const coverRe =
				/https:\/\/cvr\.voratoon\.id\/prod\/series\/([a-z0-9\-]+)\/cover\/[^\"\s<>]+/gi;
			let cm: RegExpExecArray | null;
			const map = new Map<string, string>();
			while ((cm = coverRe.exec(html))) {
				if (!map.has(cm[1])) map.set(cm[1], this.cleanUrl(cm[0]));
			}
			for (const item of out) {
				if (item.cover) continue;
				const slug = item.id.replace(/^\/series\//, '');
				if (map.has(slug)) item.cover = map.get(slug)!;
			}
		}

		return out;
	}

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const path = p <= 1 ? `/updates` : `/updates?page=${p}`;
			const html = await this.fetchHtml(path);
			const list = this.parseUpdateCards(html);
			console.log(`[voratoon] latest page=${p} → ${list.length} items`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[voratoon] getLatestManga', e);
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
			const path = `/browse?search=${encodeURIComponent(q)}${
				page > 1 ? `&page=${page}` : ''
			}`;
			const html = await this.fetchHtml(path);
			const list = this.parseUpdateCards(html);
			console.log(`[voratoon] search "${q}" → ${list.length} items`);
			return list.slice(0, this.PER_PAGE);
		} catch (e) {
			console.error('[voratoon] searchManga', e);
			return [];
		}
	}

	private extractSeriesData(html: string, slug: string): Record<string, any> | null {
		const marker = `"slug":"${slug}"`;
		let idx = html.indexOf(marker);
		if (idx < 0) idx = html.indexOf(`\\"slug\\":\\"${slug}\\"`);
		if (idx < 0) return null;

		const start = Math.max(0, idx - 500);
		const end = Math.min(html.length, idx + 4000);
		let chunk = html.slice(start, end);
		chunk = chunk
			.replace(/\\u0026/gi, '&')
			.replace(/\\"/g, '"')
			.replace(/\\\\/g, '\\');

		const pick = (key: string): string => {
			const m = chunk.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
			if (!m) return '';
			return m[1]
				.replace(/\\n/g, '\n')
				.replace(/\\"/g, '"')
				.replace(/\\u0026/gi, '&');
		};

		const pickNum = (key: string): number | null => {
			const m = chunk.match(new RegExp(`"${key}"\\s*:\\s*(\\d+(?:\\.\\d+)?|"\\d+")`));
			if (!m) return null;
			return parseFloat(m[1].replace(/"/g, ''));
		};

		const genres: string[] = [];
		const gBlock = chunk.match(/"genres"\s*:\s*\[([\s\S]*?)\]/);
		if (gBlock) {
			for (const n of gBlock[1].matchAll(/"name"\s*:\s*"([^"]+)"/g)) {
				if (!genres.includes(n[1])) genres.push(n[1]);
			}
		}

		return {
			title: pick('title'),
			nativeTitle: pick('nativeTitle'),
			coverImage: this.cleanUrl(pick('coverImage')),
			synopsis: pick('synopsis'),
			author: pick('author'),
			status: pick('status'),
			format: pick('format'),
			rating: pickNum('rating'),
			totalChapters: pick('totalChapters') || pickNum('totalChapters'),
			genres
		};
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);
		if (!path.startsWith('/series/')) {
			path = `/series/${path.replace(/^\//, '')}`;
		}
		const slug = path.split('/').pop() || '';

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);
		const data = this.extractSeriesData(html, slug);

		const title =
			data?.title ||
			$('h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]')
				.attr('content')
				?.replace(/\s*\|\s*VoraToon.*$/i, '')
				.replace(/^Baca\s+/i, '')
				.trim() ||
			this.slugToTitle(slug);

		let cover = data?.coverImage || '';
		if (!cover) {
			const cvr = html.match(
				new RegExp(
					`https://cvr\\.voratoon\\.id/prod/series/${slug}/cover/[^\"\\s<>]+`,
					'i'
				)
			);
			if (cvr) cover = this.cleanUrl(cvr[0]);
		}
		if (!cover) {
			cover = this.cleanUrl($('img[src*="/cover/"]').first().attr('src') || '');
		}

		const alt = data?.nativeTitle || '';
		const synopsis =
			data?.synopsis ||
			$('.synopsis').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[name="description"]').attr('content')?.trim() ||
			'';

		let status = 'Ongoing';
		const st = (data?.status || '').toLowerCase();
		if (/complete|tamat|selesai|end/.test(st)) status = 'Completed';
		else if (/hiatus/.test(st)) status = 'Hiatus';
		else if (/ongoing|berjalan/.test(st)) status = 'Ongoing';

		let type = 'manga';
		const fmt = (data?.format || '').toLowerCase();
		if (fmt.includes('manhwa')) type = 'manhwa';
		else if (fmt.includes('manhua')) type = 'manhua';
		else if (fmt.includes('manga')) type = 'manga';

		const authors: string[] = [];
		if (data?.author) {
			for (const part of String(data.author).split(/,|\+/)) {
				const n = part.trim();
				if (n && !authors.includes(n)) authors.push(n);
			}
		}

		const genres: string[] = data?.genres || [];
		const rating = data?.rating != null ? String(data.rating) : '';

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('a[href*="/chapter/"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const id = this.cleanId(href);
			if (!id.includes(`/series/${slug}/chapter/`)) return;
			if (seen.has(id)) return;
			seen.add(id);

			const number = this.parseChapterNumber($(a).text(), id);
			if (!Number.isFinite(number)) return;

			const date =
				$(a)
					.find('.chapter-date, [class*="chapter-date"], [class*="date"]')
					.first()
					.text()
					.replace(/\s+/g, ' ')
					.trim() || '';

			chapters.push({
				id,
				title: `Chapter ${number}`,
				number,
				date
			});
		});

		chapters.sort((a, b) => (b.number ?? 0) - (a.number ?? 0));

		const latestUpdate = chapters[0]?.date || '';

		const description = [
			alt && `Alternative: ${alt}`,
			rating && `Rating: ${rating}`,
			data?.format && `Type: ${data.format}`,
			latestUpdate && `Latest update: ${latestUpdate}`,
			data?.totalChapters && `Total chapters: ${data.totalChapters}`,
			chapters[0]?.number != null && `Latest chapter: ${chapters[0].number}`,
			synopsis
		]
			.filter(Boolean)
			.join('\n\n');

		return {
			id: path,
			sourceId: this.id,
			title,
			cover,
			type,
			status,
			description,
			authors,
			genres,
			chapters,
			latestChapter: chapters[0]?.number
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const path = this.cleanId(chapterId);
		if (!/\/chapter\//i.test(path)) {
			console.error('[voratoon] getChapterPages → not a chapter path:', chapterId);
			return [];
		}

		try {
			const html = await this.fetchHtml(path);
			const urls: string[] = [];
			const seen = new Set<string>();

			const fromHtml = html.match(
				/https:\/\/cdn\.voratoon\.com[^\"\\\s<>]+?\.(?:jpg|jpeg|png|webp)/gi
			);
			if (fromHtml) {
				for (let src of fromHtml) {
					src = this.cleanUrl(src);
					if (seen.has(src)) continue;
					if (/logo|icon|avatar|ads|banner/i.test(src)) continue;
					seen.add(src);
					urls.push(src);
				}
			}

			console.log(`[voratoon] ${urls.length} pages → ${path}`);
			return urls;
		} catch (e) {
			console.error('[voratoon] getChapterPages', path, e);
			return [];
		}
	}
}
