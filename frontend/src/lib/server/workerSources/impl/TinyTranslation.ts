/**
 * TinyTranslation.xyz — WordPress novel translation site
 * Path: scraper/src/sources/impl/TinyTranslation.ts
 *
 * URL pattern:
 *   Series  : /series/{slug}/
 *   Chapter : /{slug}/{slug}-v4c120/  atau /{slug}/{slug}-50/
 *   List    : /list-novels/
 *   Latest  : /latest-releases/  + /latest-releases/page/{n}
 *
 * CF memblokir IP Vercel → wajib hybrid Worker.
 * Konten = text novel → getChapterPages() = []
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types';

function absUrl(base: string, href: string | undefined): string {
	if (!href) return '';
	if (href.startsWith('//')) return `https:${href}`;
	if (href.startsWith('http')) return href;
	try {
		return new URL(href, base).href;
	} catch {
		return href;
	}
}

function pathOnly(href: string): string {
	try {
		const u = new URL(
			href.startsWith('http')
				? href
				: `https://www.tinytranslation.xyz${href.startsWith('/') ? '' : '/'}${href}`
		);
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		return href.startsWith('/') ? href : `/${href}`;
	}
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function parseChapterNumber(title: string, fallback: number): number {
	const m =
		title.match(/(?:volume|vol\.?)\s*\d+\s*(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i) ||
		title.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i) ||
		title.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function extractChapterNum(text: string): number | undefined {
	const t = (text || '').replace(/\s+/g, ' ').trim();
	if (!t) return undefined;
	const m =
		t.match(/(?:volume|vol\.?)\s*\d+\s*(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/(\d+(?:\.\d+)?)/);
	if (!m) return undefined;
	const n = parseFloat(m[1]);
	return Number.isNaN(n) ? undefined : n;
}

function slugToTitle(slug: string): string {
	return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Parse nomor dari path: .../loveho-isekai-v4c120/ atau ...-v1c2-2/ atau ...-50/ */
function parseFromPath(path: string): {
	vol?: number;
	ch?: number;
	part?: number;
	number: number;
	label: string;
} {
	// v4c120, v1c2-2, v3c8-3
	const m = path.match(/v(\d+)c(\d+)(?:-(\d+))?/i);
	if (m) {
		const vol = parseInt(m[1], 10);
		const ch = parseInt(m[2], 10);
		const part = m[3] ? parseInt(m[3], 10) : undefined;
		const number = vol * 100000 + ch * 100 + (part ?? 0);
		const label =
			part != null ? `Vol ${vol} Ch ${ch}-${part}` : `Vol ${vol} Ch ${ch}`;
		return { vol, ch, part, number, label };
	}

	// kichiten-183, shared-life-v1c1 sudah ketangkap di atas; fallback angka di ujung
	const m2 = path.match(/-(\d+)(?:-\d+)?\/?$/);
	if (m2) {
		const ch = parseInt(m2[1], 10);
		if (!Number.isNaN(ch) && ch > 0) {
			return { ch, number: ch, label: `Chapter ${ch}` };
		}
	}

	return { number: 0, label: 'Chapter' };
}

export class TinyTranslationSource extends BaseSource {
	id = 'tinytranslation';
	name = 'TinyTranslation';
	baseUrl = 'https://www.tinytranslation.xyz';

	async getLatestManga(page = 1): Promise<Manga[]> {
		if (page <= 1) {
			const [fromLatest, fromList] = await Promise.all([
				this.parseLatestReleases(1).catch(() => [] as Manga[]),
				this.parseListNovels().catch(() => [] as Manga[])
			]);
			return this.dedupeById([...fromLatest, ...fromList]).slice(0, 30);
		}
		return this.parseLatestReleases(page);
	}

	private dedupeById(items: Manga[]): Manga[] {
		const seen = new Set<string>();
		const out: Manga[] = [];
		for (const m of items) {
			if (seen.has(m.id)) continue;
			seen.add(m.id);
			out.push(m);
		}
		return out;
	}

	/** /list-novels/ — On-going / Completed / Dropped */
	private async parseListNovels(): Promise<Manga[]> {
		const html = await this.fetchHtml('/list-novels/');
		const $ = cheerio.load(html);
		$('script, style, noscript, iframe').remove();

		const list: Manga[] = [];
		const seen = new Set<string>();

		$('a[href*="/series/"]').each((_, el) => {
			const href = $(el).attr('href') || '';
			if (!href || !/\/series\/[^/]+\/?$/.test(pathOnly(href))) return;
			if (/\/series\/page\//.test(href) || href.endsWith('/series/')) return;

			const id = pathOnly(href);
			if (seen.has(id)) return;
			seen.add(id);

			const title = ($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim();
			if (!title || title.length < 3) return;

			const parentText =
				$(el).closest('ul, ol, div, section').prev('h2, h3, h4, h5').text() || '';
			let status: string | undefined;
			if (/on[- ]?going/i.test(parentText)) status = 'Ongoing';
			else if (/completed|complete/i.test(parentText)) status = 'Completed';
			else if (/dropped/i.test(parentText)) status = 'Dropped';

			list.push({
				id,
				title,
				cover: '',
				sourceId: this.id,
				type: 'novel',
				status,
				lang: 'en'
			});
		});

		return list;
	}

	/**
	 * /latest-releases/ (+ page/N)
	 * Page 2+ TIDAK punya link /series/ — chapter URL: /{slug}/{slug}-xxx/
	 */
	private async parseLatestReleases(page: number): Promise<Manga[]> {
		const path =
			page <= 1 ? '/latest-releases/' : `/latest-releases/page/${page}/`;
		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);
		$('script, style, noscript, iframe').remove();

		const map = new Map<string, Manga>();

		$('a[href]').each((_, el) => {
			const href = $(el).attr('href') || '';
			if (!href) return;

			const p = pathOnly(href);
			if (
				p === '/' ||
				/\/(series|latest-releases|list-novels|notice|donate|category|tag|author|page|feed|wp-)\//i.test(
					p
				)
			) {
				return;
			}

			const parts = p.split('/').filter(Boolean);
			if (parts.length < 2) return;

			const slug = parts[0];
			const second = parts[1];
			if (!second.startsWith(slug) && !/(?:chapter|c\d|v\d)/i.test(second)) return;
			if (/\.(css|js|png|jpg|jpeg|webp|gif|svg|ico|xml|json)$/i.test(second)) return;

			const seriesId = `/series/${slug}`;
			const chText = ($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim();
			const fromPath = parseFromPath(p);
			const latestChapter =
				fromPath.ch ?? extractChapterNum(chText) ?? (fromPath.number || undefined);

			const parent = $(el).closest('li, article, div, p, section');
			const parentText = parent.text().replace(/\s+/g, ' ').trim();

			let seriesTitle = '';
			const afterDate = parentText.match(
				/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\s+(.+)$/i
			);
			if (afterDate) {
				seriesTitle = afterDate[1]
					.replace(/^\d+\s*/, '')
					.replace(/\s+\d+\s+(?:Volume|Chapter).*$/i, '')
					.trim();
			}
			if (!seriesTitle || seriesTitle.length < 3) {
				seriesTitle = slugToTitle(slug);
			}
			if (seriesTitle.length > 120) {
				seriesTitle = seriesTitle.slice(0, 120).replace(/\s+\S*$/, '');
			}

			const existing = map.get(seriesId);
			if (!existing) {
				map.set(seriesId, {
					id: seriesId,
					title: seriesTitle,
					cover: '',
					sourceId: this.id,
					type: 'novel',
					lang: 'en',
					...(latestChapter != null ? { latestChapter } : {})
				});
			} else if (latestChapter != null) {
				const prev =
					typeof existing.latestChapter === 'number'
						? existing.latestChapter
						: extractChapterNum(String(existing.latestChapter ?? '')) ?? 0;
				if (Number(latestChapter) > prev) existing.latestChapter = latestChapter;
			}
		});

		// Page 1: merge link /series/
		$('a[href*="/series/"]').each((_, el) => {
			const href = $(el).attr('href') || '';
			if (!href || !/\/series\/[^/]+\/?$/.test(pathOnly(href))) return;
			const id = pathOnly(href);
			if (map.has(id)) return;
			const title = ($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim();
			if (!title || title.length < 3) return;
			map.set(id, {
				id,
				title,
				cover: '',
				sourceId: this.id,
				type: 'novel',
				lang: 'en'
			});
		});

		return Array.from(map.values());
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = encodeURIComponent(query);
		const paths =
			page <= 1
				? [`/?s=${q}`, `/page/1/?s=${q}`]
				: [`/page/${page}/?s=${q}`, `/?s=${q}&paged=${page}`];

		for (const path of paths) {
			try {
				const html = await this.fetchHtml(path);
				const $ = cheerio.load(html);
				$('script, style, noscript, iframe').remove();

				const list: Manga[] = [];
				const seen = new Set<string>();

				$('a[href]').each((_, el) => {
					const href = $(el).attr('href') || '';
					if (!href) return;
					const p = pathOnly(href);

					if (/\/series\/[^/]+\/?$/.test(p)) {
						if (seen.has(p)) return;
						seen.add(p);
						const title = ($(el).attr('title') || $(el).text())
							.replace(/\s+/g, ' ')
							.trim();
						if (!title || title.length < 3) return;
						list.push({
							id: p,
							title,
							cover: '',
							sourceId: this.id,
							type: 'novel',
							lang: 'en'
						});
						return;
					}

					const parts = p.split('/').filter(Boolean);
					if (parts.length < 2) return;
					const slug = parts[0];
					if (!parts[1].startsWith(slug) && !/(?:chapter|c\d|v\d)/i.test(parts[1]))
						return;
					if (/\/(latest|list-novels|notice|donate|category|tag|page|feed)\//i.test(p))
						return;

					const seriesId = `/series/${slug}`;
					if (seen.has(seriesId)) return;
					seen.add(seriesId);

					const parent = $(el).closest('li, article, div, p');
					const parentText = parent.text().replace(/\s+/g, ' ').trim();
					let title = '';
					const afterDate = parentText.match(
						/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\s+(.+)$/i
					);
					if (afterDate) {
						title = afterDate[1]
							.replace(/^\d+\s*/, '')
							.replace(/\s+\d+\s+(?:Volume|Chapter).*$/i, '')
							.trim();
					}
					if (!title || title.length < 3) title = slugToTitle(slug);

					list.push({
						id: seriesId,
						title: title.slice(0, 120),
						cover: '',
						sourceId: this.id,
						type: 'novel',
						lang: 'en'
					});
				});

				if (list.length) return list;
			} catch {
				/* next path */
			}
		}
		return [];
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		if (!path.includes('/series/')) {
			path = `/series${path.startsWith('/') ? path : `/${path}`}`;
		}
		path = path.endsWith('/') ? path : `${path}/`;

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);
		$('script, style, noscript, iframe').remove();

		const title =
			$('h1.wp-block-post-title, h1.entry-title, h1').first().text().trim() ||
			$('meta[property="og:title"]').attr('content')?.split(/[|\-–]/)[0].trim() ||
			$('title').text().split(/[|\-–]/)[0].trim();

		if (!title || title.length < 2) {
			throw new Error('Novel not found (empty title)');
		}

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('meta[name="twitter:image"]').attr('content') ||
			$('.wp-block-post-featured-image img, .post-thumbnail img, article img')
				.first()
				.attr('src') ||
			'';
		cover = (cover || '').split('?')[0];

		const authors: string[] = [];
		const genres: string[] = [];
		let status = 'Ongoing';
		let description = '';

		const bodyText = $('.entry-content, .wp-block-post-content, article')
			.first()
			.text()
			.replace(/\s+/g, ' ');

		const authorM = bodyText.match(/Author\s*:\s*([^G]+?)(?:\s*Genre\s*:|$)/i);
		if (authorM) {
			const name = authorM[1].replace(/\s+/g, ' ').trim();
			if (name && name.length < 80) authors.push(name);
		}

		const genreM = bodyText.match(
			/Genre\s*:\s*([^T]+?)(?:\s*Tags\s*:|\s*Synopsis\s*:|$)/i
		);
		if (genreM) {
			for (const g of genreM[1].split(/[,/|]/)) {
				const t = g.trim();
				if (t && t.length < 40 && !genres.includes(t)) genres.push(t);
			}
		}

		const synIdx = bodyText.search(/Synopsis\s*:/i);
		if (synIdx >= 0) {
			let syn = bodyText.slice(synIdx).replace(/^Synopsis\s*:\s*/i, '');
			syn = syn.split(/\s*(?:Links|Chapter)\s*:/i)[0] || syn;
			description = syn.replace(/\s+/g, ' ').trim().slice(0, 2000);
		}

		if (!description || description.length < 40) {
			description =
				$('meta[property="og:description"]').attr('content') ||
				$('meta[name="description"]').attr('content') ||
				'';
		}

		description = description
			.replace(/jQuery\s*\(.*?$/gi, '')
			.replace(/document\.(ready|getElementById).*?$/gi, '')
			.replace(/Your email address will not be published.*$/gi, '')
			.replace(/Leave a Reply.*$/gi, '')
			.replace(/adsbygoogle.*?$/gi, '')
			.replace(/\s+/g, ' ')
			.trim();

		const chapters: Chapter[] = [];
		const seen = new Set<string>();

		$('a[href]').each((_, el) => {
			const href = $(el).attr('href') || '';
			if (!href) return;
			const p = pathOnly(href);

			if (/\/series\//.test(p)) return;
			if (
				/\/(notice|donate|category|tag|author|page|list-novels|latest|feed|wp-)\//i.test(p)
			)
				return;
			if (p === '/' || p === pathOnly(path)) return;

			const rawTitle = ($(el).attr('title') || $(el).text()).replace(/\s+/g, ' ').trim();
			if (!rawTitle || rawTitle.length < 1) return;

			const parts = p.split('/').filter(Boolean);
			if (parts.length < 2) return;

			const slug = parts[0];
			const second = parts[1];
			const looksLikeChapter =
				second.toLowerCase().startsWith(slug.toLowerCase().slice(0, 4)) ||
				/v\d+c\d+/i.test(p) ||
				/-\d+\/?$/.test(p);
			if (!looksLikeChapter) return;

			const parsed = parseFromPath(p);

			if (parsed.number === 0 && !/chapter|part|prologue|epilogue|volume/i.test(rawTitle)) {
				return;
			}

			if (seen.has(p)) return;
			seen.add(p);

			if (parsed.number === 0) {
				const n = parseChapterNumber(rawTitle, chapters.length + 1);
				chapters.push({ id: p, title: `Chapter ${n}`, number: n });
			} else {
				chapters.push({ id: p, title: parsed.label, number: parsed.number });
			}
		});

		chapters.sort((a, b) => {
			const na = typeof a.number === 'number' ? a.number : 0;
			const nb = typeof b.number === 'number' ? b.number : 0;
			return nb - na;
		});

		return {
			id: pathOnly(path),
			title,
			cover: absUrl(this.baseUrl, cover),
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters,
			type: 'novel',
			lang: 'en'
		};
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
		const path = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		const $ = cheerio.load(html);

		const title =
			$('h1.wp-block-post-title, h1.entry-title, h1, h2').first().text().trim() ||
			$('title').text().split(/[|\-–]/)[0].trim() ||
			'Chapter';

		const contentRoot = $(
			'.entry-content, .wp-block-post-content, article .content, .post-content, article'
		).first();
		const clone = contentRoot.length ? contentRoot.clone() : $('body').clone();

		clone
			.find(
				'script, style, iframe, noscript, .ads, .ad, nav, .nav, .sharedaddy, .comments, #comments, .wp-block-comments, form, .donate, .code-block, .post-views, .entry-meta, header, footer'
			)
			.remove();

		const parts: string[] = [];
		clone.find('p').each((_, p) => {
			const t = $(p).text().replace(/\s+/g, ' ').trim();
			if (!t || t.length < 15) return;
			if (
				/tinytranslation|please bookmark|thanks for reading|donate us|post views|edited by|kanaa-senpai|leave a reply|your email address|adsbygoogle/i.test(
					t
				)
			)
				return;
			parts.push(`<p>${escapeHtml(t)}</p>`);
		});

		let contentHtml = parts.length >= 2 ? parts.join('\n') : '';

		if (!contentHtml || contentHtml.length < 80) {
			const raw = clone.text().replace(/\s+/g, ' ').trim();
			if (raw.length > 200) {
				const paras = raw
					.split(/(?<=[.!?])\s+(?=[A-Z“"])/)
					.filter((s) => s.length > 40)
					.slice(0, 80);
				contentHtml = paras.map((s) => `<p>${escapeHtml(s.trim())}</p>`).join('\n');
			}
		}

		const prevHref =
			$('a[rel="prev"]').attr('href') ||
			$('a:contains("Previous"), a:contains("Prev"), a:contains("«")').first().attr('href');
		const nextHref =
			$('a[rel="next"]').attr('href') ||
			$('a:contains("Next"), a:contains("»")').first().attr('href');

		return {
			title,
			content:
				contentHtml ||
				'<p><em>Konten kosong — selector berubah atau halaman terproteksi.</em></p>',
			prevChapterId: prevHref ? pathOnly(prevHref) : null,
			nextChapterId: nextHref ? pathOnly(nextHref) : null
		};
	}
}

export default TinyTranslationSource;