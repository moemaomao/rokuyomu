/**
 * Sky Demon Order (skydemonorder.com) — Laravel + Livewire novel site
 * Path: scraper/src/sources/impl/novel/SkyDemonOrder.ts
 *
 * - List: /projects (+ pagination / search)
 * - Detail: /projects/{slug}
 * - Chapters: Livewire component "project.chapter-list" → freeChapters JSON
 * - Content: .prose (HTML)
 * - Premium (Qi) → isLocked: true
 *
 * WAJIB hybrid Worker / Byparr (Cloudflare ketat).
 * fetchHtml memakai fetchWithCf secara eksplisit.
 *
 * Frontend id: skydemonorder
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';
import { fetchWithCf } from '../../../lib/fetchWithCf';

const BASE = 'https://skydemonorder.com';

function absUrl(href: string | undefined | null): string {
	if (!href) return '';
	const h = String(href).trim();
	if (!h) return '';
	if (h.startsWith('//')) return `https:${h}`;
	if (/^https?:\/\//i.test(h)) return h;
	try {
		return new URL(h.startsWith('/') ? h : `/${h}`, BASE).href;
	} catch {
		return h;
	}
}

function pathOnly(href: string): string {
	try {
		const u = new URL(href.startsWith('http') ? href : absUrl(href));
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		return href.startsWith('/') ? href.replace(/\/$/, '') || '/' : `/${href}`;
	}
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function extractChapterNum(text: string): number | undefined {
	const t = (text || '').replace(/\s+/g, ' ').trim();
	if (!t) return undefined;
	const m =
		t.match(/(?:chapter|ch\.?|ep\.?|episode|bab)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/(\d+(?:\.\d+)?)/);
	if (!m) return undefined;
	const n = parseFloat(m[1]);
	return Number.isNaN(n) ? undefined : n;
}

function decodeJsString(raw: string): string {
	return raw
		.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
		.replace(/\\'/g, "'")
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, '\\');
}

function assertNotCloudflare(html: string, url: string): void {
	const lower = html.toLowerCase();
	const markers = [
		'just a moment',
		'verify you are human',
		'cf-browser-verification',
		'checking your browser',
		'enable javascript and cookies to continue',
		'cf-chl-captcha',
		'attention required',
		'performing security verification'
	];
	if (markers.some((m) => lower.includes(m)) && html.length < 30000) {
		throw new Error(
			`[SkyDemonOrder] Cloudflare challenge blocked fetch: ${url}. ` +
				`Pastikan source ini dijalankan di hybrid Worker (WORKER_SOURCE_IDS) atau Byparr aktif.`
		);
	}
}

function isProjectPath(href: string): { slug: string } | null {
	const path = pathOnly(href);
	const m = path.match(/^\/projects\/([^/]+)\/?$/);
	if (!m) return null;
	if (
		/^(genres?|tags?|search|login|register|faq|products|subscriptions|library)$/i.test(
			m[1]
		)
	) {
		return null;
	}
	return { slug: m[1] };
}

function cleanTitle(raw: string): string {
	return (raw || '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function isValidTitle(t: string): boolean {
	if (!t || t.length < 3) return false;
	if (
		/^(read|view|more|home|projects?|browse|login|register|faq|all|new|trending)$/i.test(
			t
		)
	) {
		return false;
	}
	if (/^\d+\s*(ch|chapter|ep)/i.test(t)) return false;
	return true;
}

function shortChapterTitle(num: number, raw?: string): string {
	if (num > 0) return `Chapter ${num}`;
	if (/prologue/i.test(raw || '')) return 'Prologue';
	if (/epilogue/i.test(raw || '')) return 'Epilogue';
	if (/side\s*story|extra/i.test(raw || '')) return 'Side Story';
	return cleanTitle(raw || 'Chapter') || 'Chapter';
}

export class SkyDemonOrderSource extends BaseSource {
	id = 'skydemonorder';
	name = 'Sky Demon Order';
	baseUrl = BASE;

	kind = 'novel' as const;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept:
			'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		'Accept-Encoding': 'gzip, deflate, br',
		'Sec-Fetch-Dest': 'document',
		'Sec-Fetch-Mode': 'navigate',
		'Sec-Fetch-Site': 'none',
		'Upgrade-Insecure-Requests': '1'
	};

	/** Explicit fetchWithCf — bypass Cloudflare via Byparr when needed */
	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http')
			? path
			: `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
		return fetchWithCf(url, {
			headers: {
				...this.headers,
				Referer: this.baseUrl + '/'
			}
		});
	}

	// ─── Latest ──────────────────────────────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		if (page <= 1) {
			const [home, list] = await Promise.all([
				this.parseHome().catch((e) => {
					console.error('[SkyDemonOrder] parseHome failed', e);
					return [] as Manga[];
				}),
				this.fetchProjectsPage(1).catch((e) => {
					console.error('[SkyDemonOrder] fetchProjectsPage failed', e);
					return [] as Manga[];
				})
			]);
			const merged = this.dedupeById([...home, ...list]);
			if (merged.length === 0) {
				throw new Error(
					'[SkyDemonOrder] No novels found — likely Cloudflare blocked. Ensure hybrid Worker / Byparr.'
				);
			}
			return merged.slice(0, 24);
		}
		return this.fetchProjectsPage(page);
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

	private parseProjectCards(html: string): Manga[] {
		assertNotCloudflare(html, this.baseUrl);
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('a[href*="/projects/"]').each((_, el) => {
			const href = $(el).attr('href') || '';
			const parsed = isProjectPath(href);
			if (!parsed) return;

			const id = `/projects/${parsed.slug}`;
			if (seen.has(id)) return;

			const root = $(el).closest(
				'article, [class*="card"], li, [class*="project"]'
			).length
				? $(el).closest('article, [class*="card"], li, [class*="project"]')
				: $(el).parent();

			const title = cleanTitle(
				$(el).attr('title') ||
					root.find('h2, h3, h4, [class*="title"]').first().text() ||
					$(el).find('img').attr('alt') ||
					root.find('img').attr('alt') ||
					$(el).text() ||
					''
			);
			if (!isValidTitle(title)) return;

			const cover =
				root.find('img').attr('src') ||
				root.find('img').attr('data-src') ||
				root.find('img').attr('data-lazy-src') ||
				$(el).find('img').attr('src') ||
				$(el).find('img').attr('data-src') ||
				'';

			const statusText = root.text();
			const status = /premium\s*complete|completed|complete/i.test(statusText)
				? 'Completed'
				: /dropped|hiatus/i.test(statusText)
					? 'Hiatus'
					: 'Ongoing';

			const chMatch = statusText.match(/(\d+)\s*ch/i);
			const latestChapter = chMatch ? parseInt(chMatch[1], 10) : undefined;

			seen.add(id);
			list.push({
				id,
				title,
				cover: absUrl((cover || '').split('?')[0]),
				sourceId: this.id,
				type: 'novel',
				status,
				lang: 'en',
				...(latestChapter != null ? { latestChapter } : {})
			});
		});

		return list;
	}

	private async parseHome(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		return this.parseProjectCards(html);
	}

	private async fetchProjectsPage(page: number): Promise<Manga[]> {
		const path =
			page <= 1
				? '/projects?sort=latest_chapter'
				: `/projects?sort=latest_chapter&page=${page}`;
		const html = await this.fetchHtml(path);
		const list = this.parseProjectCards(html);
		return list.slice(0, 24);
	}

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = encodeURIComponent(query.trim());
		if (!q) return [];
		const path =
			page <= 1 ? `/projects?search=${q}` : `/projects?search=${q}&page=${page}`;
		const html = await this.fetchHtml(path);
		return this.parseProjectCards(html).slice(0, 24);
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		if (!path.includes('/projects/')) {
			path = `/projects/${path.replace(/^\//, '')}`;
		}
		path = path.replace(/\/$/, '');

		const html = await this.fetchHtml(path);
		assertNotCloudflare(html, path);
		const $ = cheerio.load(html);

		const title = cleanTitle(
			$('h1').first().text() ||
				$('meta[property="og:title"]').attr('content')?.split('|')[0] ||
				$('title').text().split('|')[0] ||
				''
		);
		if (!title || title.length < 2) {
			throw new Error('Manga not found (empty title) — possible Cloudflare block');
		}

		const cover =
			$(`img[alt="${title}"]`).attr('src') ||
			$('meta[property="og:image"]').attr('content') ||
			$('img').first().attr('src') ||
			'';

		let description = '';
		const descEl = $(
			'[class*="description"], [class*="synopsis"], .prose, article p'
		).first();
		if (descEl.length) {
			description = descEl
				.find('p')
				.map((_, p) => $(p).text().trim())
				.get()
				.filter((t) => t.length > 20)
				.join('\n\n');
			if (!description) description = descEl.text().replace(/\s+/g, ' ').trim();
		}
		if (!description) {
			description =
				$('meta[property="og:description"]').attr('content') ||
				$('meta[name="description"]').attr('content') ||
				'';
		}

		const authors: string[] = [];
		$('a[href*="/authors/"], a[href*="/author/"], [class*="author"] a').each((_, a) => {
			const n = cleanTitle($(a).text());
			if (n && n.length < 60 && !authors.includes(n)) authors.push(n);
		});

		const genres: string[] = [];
		$('a[href*="/genres/"], a[href*="/genre/"], [class*="genre"] a').each((_, a) => {
			const g = cleanTitle($(a).text());
			if (g && g.length < 40 && !genres.includes(g)) genres.push(g);
		});

		const statusText = $('body').text();
		const status = /complete|completed|premium complete/i.test(statusText)
			? 'Completed'
			: /dropped/i.test(statusText)
				? 'Dropped'
				: 'Ongoing';

		const chapters = await this.fetchChaptersViaLivewire(html, path);
		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		return {
			id: pathOnly(path),
			title,
			cover: absUrl((cover || '').split('?')[0]),
			sourceId: this.id,
			description,
			authors,
			status,
			genres,
			chapters,
			type: 'novel',
			lang: 'en',
			...(chapters[0]?.number != null ? { latestChapter: chapters[0].number } : {})
		};
	}

	private async fetchChaptersViaLivewire(
		html: string,
		projectPath: string
	): Promise<Chapter[]> {
		try {
			const $ = cheerio.load(html);

			const csrf = $('meta[name="csrf-token"]').attr('content');
			if (!csrf) return this.parseChapterFallback($, projectPath);

			const lwScript = $('script[src*="livewire"]').attr('src') || '';
			const lwMatch = lwScript.match(/(livewire-[a-f0-9]+)/i);
			if (!lwMatch) return this.parseChapterFallback($, projectPath);

			const livewireUrl = absUrl(`/${lwMatch[1]}/update`);

			const lwDiv =
				$('[wire\\:name="project.chapter-list"]').first().length > 0
					? $('[wire\\:name="project.chapter-list"]').first()
					: $('[wire\\:id*="chapter"]').first().length > 0
						? $('[wire\\:id*="chapter"]').first()
						: $('[wire\\:snapshot]')
								.filter((_, el) => {
									const s = $(el).attr('wire:snapshot') || '';
									return /chapter/i.test(s);
								})
								.first();

			const snapshot = lwDiv.attr('wire:snapshot');
			if (!snapshot) return this.parseChapterFallback($, projectPath);

			const body = JSON.stringify({
				components: [{ snapshot, updates: {}, calls: [] }]
			});

			let chapterHtml = '';
			try {
				const res = await fetch(livewireUrl, {
					method: 'POST',
					headers: {
						...this.headers,
						'Content-Type': 'application/json',
						'X-CSRF-TOKEN': csrf,
						'X-Livewire': '',
						Referer: absUrl(projectPath),
						Origin: this.baseUrl,
						'Sec-Fetch-Dest': 'empty',
						'Sec-Fetch-Mode': 'cors',
						'Sec-Fetch-Site': 'same-origin',
						Accept: 'application/json'
					},
					body
				});
				if (res.ok) {
					const data = (await res.json()) as any;
					chapterHtml = data?.components?.[0]?.effects?.html || '';
				} else {
					console.error('[SkyDemonOrder] Livewire HTTP', res.status);
				}
			} catch (e) {
				console.error('[SkyDemonOrder] Livewire POST failed', e);
			}

			if (!chapterHtml) return this.parseChapterFallback($, projectPath);

			const $ch = cheerio.load(chapterHtml);
			const xdataDiv = $ch('div[x-data]').first();
			const xData = xdataDiv.attr('x-data') || '';

			const freeMatch =
				xData.match(/freeChapters:\s*JSON\.parse\(\s*'((?:\\'|[^'])*)'\s*\)/) ||
				xData.match(/freeChapters:\s*JSON\.parse\(\s*"((?:\\"|[^"])*)"\s*\)/) ||
				xData.match(/freeChapters:\s*(\[[\s\S]*?\])/);

			const premMatch =
				xData.match(/premiumChapters:\s*JSON\.parse\(\s*'((?:\\'|[^'])*)'\s*\)/) ||
				xData.match(/premiumChapters:\s*JSON\.parse\(\s*"((?:\\"|[^"])*)"\s*\)/) ||
				xData.match(/premiumChapters:\s*(\[[\s\S]*?\])/);

			type LwCh = {
				slug?: string;
				title?: string;
				number?: number;
				index?: number;
			};

			const parseLwArr = (match: RegExpMatchArray | null): LwCh[] => {
				if (!match) return [];
				try {
					if (match[1].trim().startsWith('[')) return JSON.parse(match[1]);
					return JSON.parse(decodeJsString(match[1]));
				} catch {
					return [];
				}
			};

			const freeChapters = parseLwArr(freeMatch);
			const premiumChapters = parseLwArr(premMatch);

			if (!freeChapters.length && !premiumChapters.length) {
				return this.parseChapterFallback($, projectPath);
			}

			const slugMatch = xData.match(/projectSlug:\s*['"]([^'"]+)['"]/);
			const projectSlug =
				slugMatch?.[1] ||
				projectPath.replace(/^\/projects\//, '').replace(/\/$/, '');

			const out: Chapter[] = [];
			const seen = new Set<string>();

			const pushItems = (items: LwCh[], locked: boolean) => {
				const ordered = [...items].reverse();
				for (let i = 0; i < ordered.length; i++) {
					const item = ordered[i];
					const chapSlug =
						item.slug || String(item.number ?? item.index ?? i + 1);
					const id = `/projects/${projectSlug}/${chapSlug}`;
					if (seen.has(id)) continue;
					seen.add(id);
					const num =
						typeof item.number === 'number'
							? item.number
							: extractChapterNum(item.title || '') ?? ordered.length - i;
					out.push({
						id,
						title: shortChapterTitle(num, item.title),
						number: num,
						...(locked ? { isLocked: true } : {})
					});
				}
			};

			pushItems(freeChapters, false);
			pushItems(premiumChapters, true);

			out.sort((a, b) => (b.number || 0) - (a.number || 0));
			return out;
		} catch (e) {
			console.error('[SkyDemonOrder] Livewire chapters failed', e);
			const $ = cheerio.load(html);
			return this.parseChapterFallback($, projectPath);
		}
	}

	private parseChapterFallback(
		$: cheerio.CheerioAPI,
		projectPath: string
	): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();
		const slug = projectPath.replace(/^\/projects\//, '').replace(/\/$/, '');

		$('a[href*="/projects/"]').each((_, el) => {
			const href = $(el).attr('href') || '';
			const m = href.match(new RegExp(`/projects/${slug}/([^/?#]+)`));
			if (!m) return;
			const id = pathOnly(href);
			if (seen.has(id)) return;
			seen.add(id);
			const raw = cleanTitle($(el).attr('title') || $(el).text());
			if (!raw || raw.length < 2) return;
			const num = extractChapterNum(raw) ?? out.length + 1;
			const locked =
				/premium|locked|qi/i.test(raw) ||
				$(el).closest('[class*="premium"], [class*="locked"]').length > 0;
			out.push({
				id,
				title: shortChapterTitle(num, raw),
				number: num,
				...(locked ? { isLocked: true } : {})
			});
		});

		out.sort((a, b) => (b.number || 0) - (a.number || 0));
		return out;
	}

	// ─── Chapter content ─────────────────────────────────────────────────

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
		const html = await this.fetchHtml(path);
		assertNotCloudflare(html, path);
		const $ = cheerio.load(html);

		const bodyText = $('body').text().toLowerCase();
		const locked =
			bodyText.includes('qi required') ||
			bodyText.includes('unlock this chapter') ||
			($('[class*="locked"], [class*="premium"], [class*="paywall"]').length > 0 &&
				!$('.prose').text().trim());

		if (locked) {
			return {
				title: 'Locked Chapter',
				content:
					'<p>This chapter is premium / locked on Sky Demon Order (Qi required).</p>',
				prevChapterId: null,
				nextChapterId: null
			};
		}

		const rawTitle = cleanTitle(
			$('h1').first().text() || $('title').text().split('|')[0] || 'Chapter'
		);
		const num = extractChapterNum(rawTitle) ?? 0;
		const title = shortChapterTitle(num, rawTitle);

		const prose = $('.prose').first();
		prose.find('script, style, nav, .ads, .ad, [class*="advert"]').remove();
		let contentHtml = prose.html() || '';

		if (!contentHtml) {
			const fallback = $('[class*="chapter-content"], article, .content').first();
			fallback.find('script, style, nav').remove();
			contentHtml = fallback.html() || '';
		}

		let content = contentHtml;
		if (content && !content.includes('<p') && !content.includes('<br')) {
			content = content
				.split(/\n{2,}/)
				.map((p) => p.trim())
				.filter(Boolean)
				.map((p) => `<p>${escapeHtml(p)}</p>`)
				.join('\n');
		}
		if (!content || content.length < 40) {
			content = '<p>Content not available.</p>';
		}

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		$('a[href*="/projects/"]').each((_, el) => {
			const href = $(el).attr('href') || '';
			const text = $(el).text().toLowerCase();
			const id = pathOnly(href);
		
			if (!/^\/projects\/[^/]+\/[^/]+$/.test(id)) return;
			if (/prev|previous|←|sebelum/i.test(text)) prevChapterId = id;
			if (/next|lanjut|→|berikut/i.test(text)) nextChapterId = id;
		});

		return {
			title,
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default SkyDemonOrderSource;
