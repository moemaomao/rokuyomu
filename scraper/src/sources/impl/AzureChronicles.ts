/**
 * Azure Chronicles (azurechronicles.com)
 * Path: scraper/src/sources/impl/AzureChronicles.ts
 *
 * URL:
 *   /                          → homepage (latest novels)
 *   /novel/{slug}/             → series detail + chapter list
 *   /novel/{slug}/chapter-{n}/ → chapter body
 *   /?s={query} or search UI   → search (fallback: homepage parse)
 *
 * Catatan: site sering menampilkan interstitial anti-bot
 * ("Please wait while your request is being verified...").
 * Scraper perlu User-Agent browser + cookie session; jika
 * fetchHtml masih dapat interstitial, retry / naikkan delay.
 */
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types';

const PAGE_SIZE = 24;

function decodeEntities(s: string): string {
	return (s || '')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#8217;/g, "'")
		.replace(/&#8216;/g, "'")
		.replace(/&#8220;/g, '"')
		.replace(/&#8221;/g, '"')
		.replace(/&#8211;/g, '–')
		.replace(/&#8230;/g, '…')
		.replace(/&nbsp;/g, ' ');
}

function stripHtml(html: string): string {
	return decodeEntities(
		html
			.replace(/<script[\s\S]*?<\/script>/gi, '')
			.replace(/<style[\s\S]*?<\/style>/gi, '')
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/p>/gi, '\n\n')
			.replace(/<[^>]+>/g, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
}

function cleanTitle(raw: string): string {
	return decodeEntities(raw || '')
		.replace(/\s+/g, ' ')
		.replace(/^Read\s+/i, '')
		.replace(/\s*(?:[–—|]|-)\s*Azure Chronicles\s*$/i, '')
		.replace(/\s*—\s*Chapter\s+\d+.*$/i, '')
		.trim();
}

function isChallengePage(html: string): boolean {
	return (
		/One moment, please/i.test(html) ||
		/request is being verified/i.test(html) ||
		(/please wait/i.test(html) && /verified/i.test(html) && html.length < 30000)
	);
}

function parseChapterNumber(title: string, slug = ''): number {
	const fromSlug = slug.match(/chapter-(\d+)(?:-(\d+))?/i);
	if (fromSlug) {
		if (fromSlug[2]) return parseFloat(`${fromSlug[1]}.${fromSlug[2]}`);
		return parseInt(fromSlug[1], 10);
	}
	const m = title.match(
		/(?:chapter|chap|ch\.?|episode|ep\.?)\s*[:.]?\s*(\d+)(?:[.,](\d+))?/i
	);
	if (m) {
		if (m[2]) return parseFloat(`${m[1]}.${m[2]}`);
		return parseInt(m[1], 10);
	}
	if (/prologue/i.test(title)) return 0;
	const n = title.match(/\b(\d+(?:\.\d+)?)\b/);
	return n ? parseFloat(n[1]) : 0;
}

function slugFromNovelPath(path: string): string | null {
	const m = path.match(/\/novel\/([^/]+)/i);
	return m ? m[1] : null;
}

export class AzureChroniclesSource extends BaseSource {
	id = 'azurechronicles';
	name = 'Azure Chronicles';
	baseUrl = 'https://azurechronicles.com';

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept:
			'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: 'https://azurechronicles.com/',
		'Sec-Fetch-Dest': 'document',
		'Sec-Fetch-Mode': 'navigate',
		'Sec-Fetch-Site': 'same-origin',
		'Upgrade-Insecure-Requests': '1'
	};

	/** fetchHtml + retry saat interstitial anti-bot (sering intermittent) */
	private async fetchPage(path: string, retries = 4): Promise<string> {
		const url = path.startsWith('http') ? path : path;
		let last = '';
		for (let i = 0; i < retries; i++) {
			if (i > 0) {
				// backoff: 2s, 4s, 6s...
				await new Promise((r) => setTimeout(r, 2000 * i));
			}
			try {
				last = await this.fetchHtml(url);
			} catch (e) {
				if (i === retries - 1) throw e;
				continue;
			}
			if (!isChallengePage(last) && last.length > 5000) {
				return last;
			}
		}
		if (isChallengePage(last) || last.length < 3000) {
			throw new Error(
				'Azure Chronicles anti-bot challenge — coba lagi nanti (intermittent)'
			);
		}
		return last;
	}

	private parseNovelCards(html: string): Manga[] {
		const out: Manga[] = [];
		const seen = new Set<string>();

		// Cari setiap /novel/{slug}/ lalu ambil title + cover di sekitarnya
		const linkRe =
			/href="((?:https?:\/\/azurechronicles\.com)?\/novel\/([^/"?#]+))\/?"/gi;
		let m: RegExpExecArray | null;
		while ((m = linkRe.exec(html))) {
			const slug = m[2];
			if (!slug || /^(page|tag|genre|chapter)/i.test(slug)) continue;
			const id = `/novel/${slug}`;
			if (seen.has(id)) continue;
			// skip chapter links
			if (/\/chapter-/i.test(m[1])) continue;
			seen.add(id);

			const start = Math.max(0, m.index - 600);
			const end = Math.min(html.length, m.index + 800);
			const around = html.slice(start, end);

			// Title dari aria-label, img alt, atau teks link berikutnya
			let title = '';
			const aria = around.match(
				new RegExp(
					`href="[^"]*/novel/${slug}/?"[^>]*(?:aria-label|title)="([^"]+)"`,
					'i'
				)
			);
			if (aria) title = cleanTitle(aria[1]);
			if (!title) {
				const alt = around.match(/<img[^>]+alt="([^"]{3,})"/i);
				if (alt) title = cleanTitle(alt[1]);
			}
			if (!title) {
				const textLink = around.match(
					new RegExp(
						`href="[^"]*/novel/${slug}/?"[^>]*>\\s*([^<]{3,120})\\s*<`,
						'i'
					)
				);
				if (textLink) title = cleanTitle(textLink[1]);
			}
			if (!title || title.length < 2) {
				title = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
			}
			// buang noise
			if (/^(read novel|start reading|view all)$/i.test(title)) continue;

			let cover = '';
			// background-image
			const bg = around.match(
				/background(?:-image)?\s*:\s*url\(['"]?([^)'"]+)['"]?\)/i
			);
			if (bg && !/avatar|icon|logo/i.test(bg[1])) {
				cover = bg[1].replace(/&amp;/g, '&');
			}
			if (!cover) {
				const imgs = [
					...around.matchAll(
						/<img[^>]+(?:src|data-src|data-lazy-src|data-original|srcset)="([^"]+)"[^>]*>/gi
					)
				];
				for (const im of imgs) {
					let src = im[1].replace(/&amp;/g, '&').split(/\s*,\s*/)[0].split(/\s+/)[0];
					if (/avatar|icon|logo|emoji|svg|data:image/i.test(src)) continue;
					if (
						/\.(jpg|jpeg|png|webp|avif)/i.test(src) ||
						/\/(images?|uploads|covers?|thumb)\//i.test(src) ||
						/cdn\./i.test(src)
					) {
						cover = src;
						break;
					}
				}
			}

			// latest chapter number di sekitar card
			let latestChapter: number | undefined;
			const chBadge = around.match(
				/(?:chapter|ch\.?)\s*[:.]?\s*(\d+)/i
			);
			if (chBadge) latestChapter = parseInt(chBadge[1], 10);

			out.push({
				id,
				title,
				cover,
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: 'Ongoing',
				...(latestChapter != null ? { latestChapter } : {})
			});
		}
		return out;
	}

	async getLatestManga(page = 1): Promise<Manga[]> {
		const pageNum = Math.max(1, page);
		const seen = new Set<string>();
		const out: Manga[] = [];

		const addAll = (cards: Manga[]) => {
			for (const c of cards) {
				if (seen.has(c.id)) continue;
				seen.add(c.id);
				out.push(c);
			}
		};

		// Coba beberapa pola pagination (site SPA, path bisa beda)
		const paths =
			pageNum <= 1
				? ['/']
				: [
						`/?page=${pageNum}`,
						`/page/${pageNum}/`,
						`/page/${pageNum}`,
						`/novels?page=${pageNum}`,
						`/browse?page=${pageNum}`,
						`/latest?page=${pageNum}`
				  ];

		for (const path of paths) {
			try {
				const html = await this.fetchPage(path);
				const cards = this.parseNovelCards(html);
				if (cards.length) {
					addAll(cards);
					// path berhasil → tidak perlu coba path lain
					break;
				}
			} catch (e) {
				console.error('[AzureChronicles] latest path failed', path, e);
			}
		}

		// Fallback page 2+: kumpulkan lebih banyak via search seeds lalu slice
		if (out.length < PAGE_SIZE || pageNum > 1) {
			const seeds = [
				'a', 'the', 'of', 'in', 'my', 'i', 're', 'to', 'and', 'for',
				'king', 'hunter', 'mage', 'world', 'regress'
			];
			for (const q of seeds) {
				if (out.length >= pageNum * PAGE_SIZE) break;
				try {
					const more = await this.searchManga(q, { page: 1 });
					addAll(more);
				} catch {
					/* ignore */
				}
			}
		}

		// Enrich cover untuk item yang masih kosong (batas 12 request)
		const needCover = out.filter((x) => !x.cover).slice(0, 12);
		if (needCover.length) {
			await Promise.all(
				needCover.map(async (item) => {
					try {
						const slug = slugFromNovelPath(item.id);
						if (!slug) return;
						const h = await this.fetchPage(`/novel/${slug}/`);
						const og = h.match(/property="og:image"[^>]+content="([^"]+)"/i);
						if (og) item.cover = og[1].replace(/&amp;/g, '&');
						const chs = this.parseChapterList(h, slug);
						if (chs.length && item.latestChapter == null) {
							item.latestChapter = chs[0].number;
						}
						// perbaiki title "Read ..."
						const t = h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
						if (t) item.title = cleanTitle(stripHtml(t[1]));
					} catch {
						/* ignore */
					}
				})
			);
		}

		const startIdx = (pageNum - 1) * PAGE_SIZE;
		return out.slice(startIdx, startIdx + PAGE_SIZE);
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = query.trim();
		if (!q) return [];
		const page = opts?.page ?? 1;

		// Coba query string umum WordPress/custom search
		const paths = [
			`/?s=${encodeURIComponent(q)}`,
			`/search?q=${encodeURIComponent(q)}`,
			`/novels?search=${encodeURIComponent(q)}`
		];

		for (const path of paths) {
			try {
				const html = await this.fetchPage(path);
				const cards = this.parseNovelCards(html);
				if (cards.length) {
					const start = (Math.max(1, page) - 1) * PAGE_SIZE;
					return cards.slice(start, start + PAGE_SIZE);
				}
			} catch {
				/* try next */
			}
		}

		// Fallback: filter homepage cards by title
		try {
			const home = await this.fetchPage('/');
			const cards = this.parseNovelCards(home).filter((c) =>
				c.title.toLowerCase().includes(q.toLowerCase())
			);
			return cards.slice(0, PAGE_SIZE);
		} catch {
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		const slug = slugFromNovelPath(mangaId) || mangaId.replace(/^\/+/, '');
		if (!slug) throw new Error(`Invalid manga id: ${mangaId}`);

		const html = await this.fetchPage(`/novel/${slug}/`);

		const titleMatch =
			html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
			html.match(/property="og:title"[^>]+content="([^"]+)"/i);
		const title = cleanTitle(
			titleMatch ? stripHtml(titleMatch[1]) : slug.replace(/-/g, ' ')
		);

		const coverMatch =
			html.match(/property="og:image"[^>]+content="([^"]+)"/i) ||
			html.match(
				/<img[^>]+class="[^"]*(?:cover|poster|thumbnail)[^"]*"[^>]+src="([^"]+)"/i
			) ||
			html.match(/<img[^>]+src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
		const cover = (coverMatch?.[1] || '').replace(/&amp;/g, '&');

		// Genres: "Genres : Action Adventure Fantasy"
		const genres: string[] = [];
		const genreBlock = html.match(/Genres\s*:?\s*([\s\S]{0,300}?)<\//i);
		if (genreBlock) {
			const raw = stripHtml(genreBlock[1]);
			for (const g of raw.split(/[,|/]/)) {
				const t = g.trim();
				if (t && t.length < 40 && !/genres?/i.test(t)) genres.push(t);
			}
		}
		// Tag links fallback
		for (const m of html.matchAll(
			/href="[^"]*(?:genre|tag)[^"]*"[^>]*>([^<]+)</gi
		)) {
			const t = cleanTitle(m[1]);
			if (t && !genres.includes(t)) genres.push(t);
		}

		let description = '';
		const syn =
			html.match(/Synopsis[\s\S]{0,80}?Show more([\s\S]{0,2500}?)(?:Details|Show more|Newest)/i) ||
			html.match(/property="og:description"[^>]+content="([^"]+)"/i);
		if (syn) description = stripHtml(syn[1]).slice(0, 2000);
		if (!description) {
			const p = html.match(/<p[^>]*>([\s\S]{80,800}?)<\/p>/i);
			if (p) description = stripHtml(p[1]);
		}

		let status = 'Ongoing';
		if (/Status[\s\S]{0,40}Completed/i.test(html)) status = 'Completed';
		else if (/Status[\s\S]{0,40}Hiatus/i.test(html)) status = 'Hiatus';

		const authors: string[] = [];
		const tr = html.match(/Translator[\s\S]{0,40}?>([^<]+)</i);
		if (tr) {
			const a = cleanTitle(tr[1]);
			if (a && !/translator/i.test(a)) authors.push(a);
		}

		const chapters = this.parseChapterList(html, slug);

		return {
			id: `/novel/${slug}`,
			title,
			cover,
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters,
			type: 'novel',
			lang: 'en',
			...(chapters.length ? { latestChapter: chapters[0]?.number } : {})
		};
	}

	private parseChapterList(html: string, seriesSlug: string): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		const skipTitle = (t: string) =>
			!t ||
			/^(start reading|read novel|add to library|view all|details|synopsis|show more)$/i.test(
				t.trim()
			);

		// /novel/{slug}/chapter-{n}/
		const re = new RegExp(
			`href="((?:https?:\\/\\/azurechronicles\\.com)?\\/novel\\/${seriesSlug.replace(
				/[.*+?^${}()|[\\]\\\\]/g,
				'\\$&'
			)}\\/(chapter-[^"/?#]+))\\/?"[^>]*>([\\s\\S]*?)<\\/a>`,
			'gi'
		);

		let m: RegExpExecArray | null;
		while ((m = re.exec(html))) {
			const path = m[1].replace(/^https?:\/\/azurechronicles\.com/, '');
			const chapSlug = (path.split('/').pop() || '').replace(/\/$/, '');
			if (!/^chapter-/i.test(chapSlug)) continue;

			const id = `/novel/${seriesSlug}/${chapSlug}`;
			if (seen.has(id)) continue;

			let title = cleanTitle(stripHtml(m[3]));
			// "Chapter 15 5h ago" → "Chapter 15"
			title = title
				.replace(/\s+\d+[smhdw]\s+ago\s*$/i, '')
				.replace(/\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s*$/, '')
				.trim();
			if (skipTitle(title)) continue;
			if (!title || title.length < 2) {
				title = chapSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
			}

			seen.add(id);
			out.push({
				id,
				title,
				number: parseChapterNumber(title, chapSlug)
			});
		}

		// Fallback: any chapter-N link text
		if (!out.length) {
			const loose = html.matchAll(
				/href="([^"]*\/(chapter-\d+(?:-\d+)?)\/?)"[^>]*>([\s\S]*?)<\/a>/gi
			);
			for (const x of loose) {
				const chapSlug = x[2];
				const id = `/novel/${seriesSlug}/${chapSlug}`;
				if (seen.has(id)) continue;
				let title = cleanTitle(stripHtml(x[3]))
					.replace(/\s+\d+[smhdw]\s+ago\s*$/i, '')
					.trim();
				if (skipTitle(title)) continue;
				if (!title) title = `Chapter ${chapSlug.replace(/^chapter-/i, '')}`;
				seen.add(id);
				out.push({
					id,
					title,
					number: parseChapterNumber(title, chapSlug)
				});
			}
		}

		out.sort((a, b) => b.number - a.number);
		return out;
	}

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		const m = chapterId.match(/\/novel\/([^/]+)\/(chapter-[^/]+)/i);
		if (!m) throw new Error(`Invalid chapter id: ${chapterId}`);
		const [, seriesSlug, chapSlug] = m;
		const path = `/novel/${seriesSlug}/${chapSlug.replace(/\/$/, '')}/`;

		// Warm session via series page (membantu lolos challenge di beberapa edge)
		try {
			await this.fetchPage(`/novel/${seriesSlug}/`);
		} catch {
			/* optional */
		}

		const html = await this.fetchPage(path);

		const titleMatch =
			html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
			html.match(/property="og:title"[^>]+content="([^"]+)"/i);
		const title = cleanTitle(
			titleMatch ? stripHtml(titleMatch[1]) : chapSlug.replace(/-/g, ' ')
		);

		// Ekstrak teks chapter: prioritaskan <p>, buang cover/img promo
		const extractParas = (src: string): string => {
			const chunk = src
				.replace(/<script[\s\S]*?<\/script>/gi, '')
				.replace(/<style[\s\S]*?<\/style>/gi, '')
				.replace(/<nav[\s\S]*?<\/nav>/gi, '')
				.replace(/<aside[\s\S]*?<\/aside>/gi, '')
				.replace(/What did you think of this chapter[\s\S]*/i, '')
				.replace(/<a[^>]+href="[^"]*\/novel\/(?![^"]*chapter-)[^"]*"[^>]*>[\s\S]*?<\/a>/gi, '');

			const paras = [...chunk.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
				.map((x) => x[0])
				.filter((p) => {
					const t = stripHtml(p).replace(/\s+/g, ' ').trim();
					if (t.length < 25) return false;
					if (/^(start reading|add to library|sign in|read novel)/i.test(t)) return false;
					if (/^chapter\s+\d+\s*$/i.test(t)) return false;
					return true;
				});
			return paras.join('\n');
		};

		let body = '';
		// 1) container khusus chapter
		for (const re of [
			/<article[^>]*>([\s\S]*?)<\/article>/i,
			/<div[^>]+class="[^"]*(?:chapter-content|entry-content|post-content|reader-content|prose)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
			/<div[^>]+id="[^"]*(?:chapter-content|chapter|reader)[^"]*"[^>]*>([\s\S]*?)<\/div>/i
		]) {
			const hit = html.match(re);
			if (!hit?.[1]) continue;
			const paras = extractParas(hit[1]);
			if (stripHtml(paras).length > 150) {
				body = paras;
				break;
			}
		}

		// 2) fallback: setelah h1 sampai reaction
		if (!body || stripHtml(body).length < 150) {
			const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] || html;
			const afterH1 = main.split(/<\/h1>/i).slice(1).join('</h1>');
			const cut = afterH1.split(
				/What did you think of this chapter|Discussion|Comments|<\/main>/i
			)[0];
			const paras = extractParas(cut);
			if (stripHtml(paras).length > stripHtml(body).length) body = paras;
		}

		// Buang semua gambar — reader novel hanya butuh teks
		body = body
			.replace(/<img\b[^>]*>/gi, '')
			.replace(/<picture[\s\S]*?<\/picture>/gi, '')
			.replace(/<figure[\s\S]*?<\/figure>/gi, '')
			.replace(/<svg[\s\S]*?<\/svg>/gi, '');

		let plain = stripHtml(body).replace(/\s+/g, ' ').trim();

		// Retry sekali jika teks terlalu pendek (sering karena page masih challenge/partial)
		if (plain.length < 120) {
			await new Promise((r) => setTimeout(r, 3000));
			const html2 = await this.fetchPage(path, 3);
			const main2 = html2.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] || html2;
			const after2 = main2.split(/<\/h1>/i).slice(1).join('</h1>');
			const cut2 = after2.split(
				/What did you think of this chapter|Discussion|Comments|<\/main>/i
			)[0];
			const paras2 = extractParas(cut2)
				.replace(/<img\b[^>]*>/gi, '')
				.replace(/<picture[\s\S]*?<\/picture>/gi, '');
			if (stripHtml(paras2).length > plain.length) {
				body = paras2;
				plain = stripHtml(body).replace(/\s+/g, ' ').trim();
			}
		}

		if (plain.length < 80) {
			throw new Error(
				'Chapter body empty or blocked by anti-bot — retry in a few seconds'
			);
		}

		// Konten final: hanya paragraf teks
		const content = `<div class="ac-chapter">${body}</div>`;

		// prev/next
		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		try {
			const seriesHtml = await this.fetchPage(`/novel/${seriesSlug}/`);
			const chs = this.parseChapterList(seriesHtml, seriesSlug);
			const idx = chs.findIndex(
				(c) => c.id.endsWith(`/${chapSlug}`) || c.id === chapterId
			);
			if (idx >= 0) {
				prevChapterId = chs[idx + 1]?.id ?? null;
				nextChapterId = chs[idx - 1]?.id ?? null;
			}
		} catch {
			/* optional */
		}

		return { title, content, prevChapterId, nextChapterId };
	}
}

export default AzureChroniclesSource;
