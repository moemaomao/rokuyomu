import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails } from '../types';
import https from 'node:https';

/**
 * imhentai.to adapter (HTML scrape)
 *
 * List / Search : /?page=N | /language/{lang}/?page=N | /search/?q=...&page=N
 * Detail        : /g/{id}/
 * Pages         : https://zrocdn.xyz/galleries/{mediaId}/{n}.webp
 * ID format: "/{numericId}"
 */

export class ImhentaiSource extends BaseSource {
	id = 'imhentai';
	name = 'ImHentai';
	baseUrl = 'https://imhentai.to';

	private readonly cdn = 'https://zrocdn.xyz';

	private readonly insecureAgent = new https.Agent({
		rejectUnauthorized: false
	});

	// ── HTTP ─────────────────────────────────────────────────────────────────

	private h(): Record<string, string> {
		return {
			'User-Agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
			Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			'Accept-Language': 'en-US,en;q=0.9',
			Referer: 'https://imhentai.to/',
			Origin: 'https://imhentai.to'
		};
	}

	private getHtml(url: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const req = https.get(
				url,
				{ headers: this.h(), agent: this.insecureAgent },
				(res) => {
					if (
						res.statusCode &&
						res.statusCode >= 300 &&
						res.statusCode < 400 &&
						res.headers.location
					) {
						const next = res.headers.location.startsWith('http')
							? res.headers.location
							: `${this.baseUrl}${res.headers.location}`;
						this.getHtml(next).then(resolve).catch(reject);
						return;
					}
					if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
						reject(new Error(`HTTP ${res.statusCode} → ${url}`));
						return;
					}
					const chunks: Buffer[] = [];
					res.on('data', (c) => chunks.push(c));
					res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
					res.on('error', reject);
				}
			);
			req.on('error', reject);
			req.setTimeout(30000, () => {
				req.destroy();
				reject(new Error(`Timeout → ${url}`));
			});
		});
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private toId(id: number | string): string {
		return `/${String(id).replace(/\D/g, '')}`;
	}

	private extractId(mangaId: string): string {
		return String(mangaId).replace(/\D/g, '');
	}

	private extractMediaId(html: string): string {
		const m =
			html.match(/zrocdn\.xyz\/galleries\/(\d+)\//) ||
			html.match(/\/galleries\/(\d+)\//);
		return m?.[1] || '';
	}

	private decodeHtml(s: string): string {
		return s
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#039;/g, "'")
			.replace(/&#x27;/g, "'")
			.trim();
	}

	private normalizeLangForSearch(lang?: string): string | null {
		const raw = String(lang || '')
			.trim()
			.toLowerCase();
		if (!raw || raw === 'all' || raw === 'any' || raw === '*') return null;

		const map: Record<string, string> = {
			english: 'english',
			en: 'english',
			'en-us': 'english',
			japanese: 'japanese',
			ja: 'japanese',
			japan: 'japanese',
			chinese: 'chinese',
			zh: 'chinese',
			'zh-cn': 'chinese',
			'zh-hk': 'chinese',
			'zh-tw': 'chinese',
			korean: 'korean',
			ko: 'korean',
			korea: 'korean',
			spanish: 'spanish',
			es: 'spanish',
			french: 'french',
			fr: 'french',
			russian: 'russian',
			ru: 'russian',
			german: 'german',
			de: 'german',
			portuguese: 'portuguese',
			pt: 'portuguese',
			'pt-br': 'portuguese',
			italian: 'italian',
			it: 'italian',
			thai: 'thai',
			th: 'thai',
			vietnamese: 'vietnamese',
			vi: 'vietnamese',
			indonesian: 'indonesian',
			id: 'indonesian',
			translated: 'translated'
		};
		return map[raw] || (/^[a-z]{2,12}$/.test(raw) ? raw : null);
	}

	private toIsoLang(name?: string): string | undefined {
		const s = String(name || '')
			.trim()
			.toLowerCase();
		if (!s) return undefined;
		const map: Record<string, string> = {
			english: 'en',
			en: 'en',
			japanese: 'ja',
			ja: 'ja',
			chinese: 'zh',
			zh: 'zh',
			korean: 'ko',
			ko: 'ko',
			spanish: 'es',
			es: 'es',
			french: 'fr',
			fr: 'fr',
			russian: 'ru',
			ru: 'ru',
			german: 'de',
			de: 'de',
			portuguese: 'pt',
			pt: 'pt',
			italian: 'it',
			it: 'it',
			thai: 'th',
			th: 'th',
			vietnamese: 'vi',
			vi: 'vi',
			indonesian: 'id',
			id: 'id',
			translated: 'en'
		};
		return map[s] || (s.length <= 3 ? s : undefined);
	}

	private parseList(html: string): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();
		const blocks = html.split(/<div class="thumb"[^>]*>/i).slice(1);

		for (const block of blocks) {
			const idM = block.match(/href="\/g\/(\d+)\/"/);
			if (!idM) continue;
			const id = idM[1];
			if (seen.has(id)) continue;
			seen.add(id);

			const coverM = block.match(/data-src="(https?:\/\/[^"]+)"/);
			const cover = (coverM?.[1] || '').trim();

			const titleM =
				block.match(/gallery_title"><a[^>]*>([^<]+)<\/a>/i) ||
				block.match(/<h2 class="gallery_title"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
			const title = this.decodeHtml(titleM?.[1] || `Gallery ${id}`);

			const catM = block.match(/class="thumb_cat"[^>]*>([^<]+)</i);
			const type = catM ? this.decodeHtml(catM[1]).toLowerCase() : 'doujinshi';

			const flagAlt = block.match(
				/thumb_flag"[^>]*alt="([^"]+)"|alt="([^"]+)"[^>]*class="[^"]*thumb_flag/i
			);
			const langPath = block.match(/\/language\/([a-z]+)\//i);
			const langRaw =
				(flagAlt?.[1] || flagAlt?.[2] || langPath?.[1] || '').trim();
			const lang = this.toIsoLang(langRaw);

			out.push({
				id: this.toId(id),
				sourceId: this.id,
				title,
				cover,
				type,
				status: 'Completed',
				latestChapter: 1,
				lang
			});
		}

		if (out.length === 0) {
			const re =
				/<div class="thumb"[^>]*>[\s\S]*?<a href="\/g\/(\d+)\/">[\s\S]*?<img[^>]+data-src="([^"]+)"[^>]*>[\s\S]*?<h2 class="gallery_title"><a[^>]*>([^<]+)<\/a>/gi;
			let m: RegExpExecArray | null;
			while ((m = re.exec(html)) !== null) {
				const id = m[1];
				if (seen.has(id)) continue;
				seen.add(id);
				out.push({
					id: this.toId(id),
					sourceId: this.id,
					title: this.decodeHtml(m[3] || `Gallery ${id}`),
					cover: (m[2] || '').trim(),
					type: 'doujinshi',
					status: 'Completed',
					latestChapter: 1
				});
			}
		}

		return out;
	}

	private pickFromInfo(html: string, label: string): string[] {
		const re = new RegExp(`${label}:[\\s\\S]*?</(?:div|ul|li)>`, 'i');
		const section = html.match(re)?.[0] || '';
		const names: string[] = [];
		const tagRe =
			/href="\/(?:tag|artist|group|parody|character|language|category)\/[^"]+\/"[^>]*>([^<]+)</gi;
		let tm: RegExpExecArray | null;
		while ((tm = tagRe.exec(section)) !== null) {
			const name = this.decodeHtml(tm[1]);
			if (name) names.push(name);
		}
		return names;
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const langSlug = this.normalizeLangForSearch(opts?.lang);
			const type = (opts?.type || 'all').toLowerCase();

			let url: string;
			if (langSlug) {
				url =
					p === 1
						? `${this.baseUrl}/language/${langSlug}/`
						: `${this.baseUrl}/language/${langSlug}/?page=${p}`;
			} else if (type && type !== 'all') {
				url =
					p === 1
						? `${this.baseUrl}/category/${encodeURIComponent(type)}/`
						: `${this.baseUrl}/category/${encodeURIComponent(type)}/?page=${p}`;
			} else {
				url = `${this.baseUrl}/?page=${p}`;
			}

			const html = await this.getHtml(url);
			const list = this.parseList(html);
			console.log(
				`[imhentai] latest page=${p} lang=${langSlug ?? 'all'} → ${list.length} items`
			);
			return list;
		} catch (e) {
			console.error('[imhentai] getLatestManga', e);
			return [];
		}
	}

	async searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page || 1);
		const langSlug = this.normalizeLangForSearch(opts?.lang);

		if (!q) return this.getLatestManga(page, opts);

		try {
			// imhentai search: q= + optional language via query text
			const qParts = [q];
			if (langSlug && langSlug !== 'translated') {
				qParts.push(`language:${langSlug}`);
			}
			const url = `${this.baseUrl}/search/?q=${encodeURIComponent(qParts.join(' '))}&page=${page}`;
			const html = await this.getHtml(url);
			const list = this.parseList(html);
			console.log(
				`[imhentai] search "${q}" page=${page} lang=${langSlug ?? 'all'} → ${list.length}`
			);
			return list;
		} catch (e) {
			console.error('[imhentai] searchManga', e);
			return [];
		}
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const id = this.extractId(mangaId);
		if (!id) throw new Error(`Invalid imhentai id: ${mangaId}`);

		const html = await this.getHtml(`${this.baseUrl}/g/${id}/`);

		const titleM = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
		const title = titleM ? this.decodeHtml(titleM[1]) : `Gallery ${id}`;

		const mediaId = this.extractMediaId(html);
		const cover = mediaId ? `${this.cdn}/galleries/${mediaId}/cover.webp` : '';

		const pagesM =
			html.match(/pages_num">(\d+)/i) ||
			html.match(/Pages:\s*<\/span>\s*<span[^>]*>(\d+)/i);
		const pageCount = pagesM ? parseInt(pagesM[1], 10) : 0;

		const artists = this.pickFromInfo(html, 'Artists');
		const groups = this.pickFromInfo(html, 'Groups');
		const languages = this.pickFromInfo(html, 'Languages');
		const categories = this.pickFromInfo(html, 'Category');
		const tags = this.pickFromInfo(html, 'Tags');
		const parodies = this.pickFromInfo(html, 'Parodies');
		const characters = this.pickFromInfo(html, 'Characters');

		const category = categories[0] || 'doujinshi';
		const languageName =
			languages.find((l) => {
				const x = l.toLowerCase();
				return x !== 'translated' && x !== 'rewrite';
			}) ||
			languages[0] ||
			'';
		const lang = this.toIsoLang(languageName);

		const genres = [
			...tags,
			...parodies.map((p) => `parody:${p}`),
			...characters.map((c) => `character:${c}`)
		];

		// Badge chapter = page count (Ch. 42), sama seperti nhentai
		const latestChapter = pageCount > 0 ? pageCount : 1;

		return {
			id: this.toId(id),
			sourceId: this.id,
			title,
			cover,
			type: category,
			status: 'Completed',
			lang,
			latestChapter,
			description: [
				languageName && `Language: ${languageName}`,
				category && `Type: ${category}`,
				artists.length && `Artists: ${artists.join(', ')}`,
				groups.length && `Groups: ${groups.join(', ')}`,
				pageCount && `Pages: ${pageCount}`
			]
				.filter(Boolean)
				.join('\n'),
			authors: artists.length ? artists : groups,
			genres,
			chapters:
				pageCount > 0
					? [
							{
								id: this.toId(id),
								title: 'Read',
								number: 1,
								date: '',
								lang
							}
					  ]
					: []
		};
	}

	// ── Pages ────────────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const id = this.extractId(chapterId);
		if (!id) {
			console.error('[imhentai] getChapterPages → empty id from:', chapterId);
			return [];
		}

		try {
			const html = await this.getHtml(`${this.baseUrl}/g/${id}/`);

			const mediaId = this.extractMediaId(html);
			if (!mediaId) {
				console.error('[imhentai] getChapterPages → no mediaId for', id);
				return [];
			}

			const thumbRe = new RegExp(
				`zrocdn\\.xyz/galleries/${mediaId}/(\\d+)t\\.(?:webp|jpg|png)`,
				'gi'
			);
			const nums = new Set<number>();
			let tm: RegExpExecArray | null;
			while ((tm = thumbRe.exec(html)) !== null) {
				nums.add(parseInt(tm[1], 10));
			}

			let pageCount = nums.size;

			if (!pageCount) {
				const pagesM = html.match(/pages_num">(\d+)/i);
				pageCount = pagesM ? parseInt(pagesM[1], 10) : 0;
			}

			if (!pageCount) {
				console.error('[imhentai] getChapterPages → 0 pages for', id);
				return [];
			}

			const urls: string[] = [];
			for (let i = 1; i <= pageCount; i++) {
				urls.push(`${this.cdn}/galleries/${mediaId}/${i}.webp`);
			}

			console.log(
				`[imhentai] loaded ${urls.length} pages for gallery ${id} (media ${mediaId})`
			);
			return urls;
		} catch (e) {
			console.error('[imhentai] getChapterPages failed for', id, e);
			return [];
		}
	}
}
