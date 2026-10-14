/**
 * Voratoon (v4.voratoon.com) — Next.js App Router
 * → extends NextAppRouterSource
 *
 * Latest/Search : /updates , /browse?search=
 * Detail        : /series/{slug}  (+ embedded series JSON in HTML)
 * Chapter pages : cdn.voratoon.com images in HTML
 */
import { NextAppRouterSource } from '../../family/NextAppRouterSource';
import type { Chapter, Manga, MangaDetails } from '../../types-manga';

export class VoratoonSource extends NextAppRouterSource {
	id = 'voratoon';
	name = 'Voratoon';
	baseUrl = 'https://v4.voratoon.com';
	protected defaultLang = 'id';

	private parseCards(html: string): Manga[] {
		const $ = this.load$(html);
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
				coverA.attr('href') || $art.find('a[href*="/series/"]').first().attr('href') || '';
			const m = href.match(/\/series\/([a-z0-9\-]+)/i);
			if (!m) return;
			const slug = m[1];
			const id = `/series/${slug}`;
			if (seen.has(id)) return;
			seen.add(id);

			const title =
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

			let latestChapter: number | undefined;
			$art.find('a[href*="/chapter/"]').each((_, a) => {
				const n = this.parseChapterNumber(
					$(a).attr('aria-label') || $(a).text(),
					$(a).attr('href') || ''
				);
				if (!Number.isFinite(n)) return;
				if (latestChapter == null || n > latestChapter) latestChapter = n;
			});

			out.push({
				id,
				sourceId: this.id,
				title,
				cover,
				type: this.mapType(undefined, flagSrc),
				status: 'Ongoing',
				latestChapter,
				lang: this.defaultLang
			});
		});

		if (out.some((x) => !x.cover)) {
			const map = new Map<string, string>();
			const re =
				/https:\/\/cvr\.voratoon\.id\/prod\/series\/([a-z0-9\-]+)\/cover\/[^\"\s<>]+/gi;
			for (const cm of html.matchAll(re)) {
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

	async getLatestManga(page: number): Promise<Manga[]> {
		const p = Math.max(1, page || 1);
		const path = p <= 1 ? '/updates' : `/updates?page=${p}`;
		const list = this.parseCards(await this.fetchHtml(path));
		return list.slice(0, this.perPage);
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = query.trim();
		const page = Math.max(1, opts?.page || 1);
		if (!q) return this.getLatestManga(page);
		const path = `/browse?search=${encodeURIComponent(q)}${page > 1 ? `&page=${page}` : ''}`;
		return this.parseCards(await this.fetchHtml(path)).slice(0, this.perPage);
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);
		if (!path.startsWith('/series/')) path = `/series/${path.replace(/^\//, '')}`;
		const slug = path.split('/').pop() || '';

		const html = await this.fetchHtml(path);
		const $ = this.load$(html);
		const chunk = this.extractNearSlug(html, slug);

		const title =
			this.pickJsonString(chunk, 'title') ||
			$('h1').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[property="og:title"]')
				.attr('content')
				?.replace(/\s*\|\s*VoraToon.*$/i, '')
				.replace(/^Baca\s+/i, '')
				.trim() ||
			this.slugToTitle(slug);

		let cover = this.cleanUrl(this.pickJsonString(chunk, 'coverImage'));
		if (!cover) {
			const cvr = html.match(
				new RegExp(`https://cvr\\.voratoon\\.id/prod/series/${slug}/cover/[^\"\\s<>]+`, 'i')
			);
			if (cvr) cover = this.cleanUrl(cvr[0]);
		}
		if (!cover) cover = this.cleanUrl($('img[src*="/cover/"]').first().attr('src') || '');

		const alt = this.pickJsonString(chunk, 'nativeTitle');
		const synopsis =
			this.pickJsonString(chunk, 'synopsis') ||
			$('.synopsis').first().text().replace(/\s+/g, ' ').trim() ||
			$('meta[name="description"]').attr('content')?.trim() ||
			'';
		const status = this.mapStatus(this.pickJsonString(chunk, 'status'));
		const type = this.mapType(this.pickJsonString(chunk, 'format'));
		const author = this.pickJsonString(chunk, 'author');
		const authors = author
			? author
					.split(/,|\+/)
					.map((s) => s.trim())
					.filter(Boolean)
			: [];
		const genres = this.pickJsonStringArray(chunk, 'genres');
		const rating = this.pickJsonNumber(chunk, 'rating');
		const totalChapters =
			this.pickJsonString(chunk, 'totalChapters') ||
			this.pickJsonNumber(chunk, 'totalChapters');

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		$('a[href*="/chapter/"]').each((_, a) => {
			const id = this.cleanId($(a).attr('href') || '');
			if (!id.includes(`/series/${slug}/chapter/`) || seen.has(id)) return;
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
			chapters.push({ id, title: `Chapter ${number}`, number, date });
		});
		chapters.sort((a, b) => (b.number ?? 0) - (a.number ?? 0));

		const description = [
			alt && `Alternative: ${alt}`,
			rating != null && `Rating: ${rating}`,
			totalChapters && `Total chapters: ${totalChapters}`,
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
		if (!/\/chapter\//i.test(path)) return [];
		const html = await this.fetchHtml(path);
		return this.extractImageUrls(
			html,
			/https:\/\/cdn\.voratoon\.com[^\"\\\s<>]+?\.(?:jpg|jpeg|png|webp)/gi
		);
	}
}
