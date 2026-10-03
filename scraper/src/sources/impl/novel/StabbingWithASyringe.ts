/**
 * Stabbing with a Syringe (stabbingwithasyringe.home.blog)
 * Path: scraper/src/sources/impl/novel/StabbingWithASyringe.ts
 *
 * WordPress blog — adult JP→EN novel translations (NeoRecormon).
 *
 * - Homepage posts = chapter announcements (not series cards)
 * - Series list   : /stabbingwithasyringe-translated-works/
 * - Series detail : /stabbingwithasyringe-translated-works/{slug}/
 *                   /translations/{slug}/
 * - Chapter pages : various (root, /translations/..., nested under series)
 * - Patreon links → isLocked: true (lock icon)
 * - Chapter title shortened to "Chapter N" / "Volume X Chapter N"
 * - Homepage target: 24 titles
 * - Pagination: series list pages + WP /page/N/
 * - Novel content: .entry-content (HTML paragraphs)
 *
 * Frontend id: stabbingwithasyringe
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://stabbingwithasyringe.home.blog';

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
		const p = href.startsWith('/') ? href : `/${href}`;
		return p.replace(/\/$/, '') || '/';
	}
}

function cleanText(s: string): string {
	return (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function isSeriesPath(path: string): boolean {
	const p = path.replace(/\/$/, '');
	if (/\/stabbingwithasyringe-translated-works\/?$/i.test(p)) return false;
	if (/\/translations\/?$/i.test(p)) return false;
	if (/\/stabbingwithasyringe-translated-works\/[^/]+$/i.test(p)) return true;
	if (/\/translations\/[^/]+$/i.test(p)) return true;
	return false;
}

function seriesPathFromHref(href: string): string | null {
	const id = pathOnly(href);
	if (isSeriesPath(id)) return id;

	const m1 = id.match(
		/^(\/stabbingwithasyringe-translated-works\/[^/]+)\//i
	);
	if (m1) return m1[1];

	const m2 = id.match(/^(\/translations\/[^/]+)\//i);
	if (m2) return m2[1];

	return null;
}

function parseVolumeChapter(text: string): { volume?: number; chapter: number } | null {
	const t = cleanText(text);
	if (!t) return null;

	const vc = t.match(/\bv(\d+)\s*c(\d+(?:\.\d+)?)\b/i);
	if (vc) {
		return { volume: parseInt(vc[1], 10), chapter: parseFloat(vc[2]) };
	}

	const full = t.match(
		/(?:volume|vol\.?)\s*(\d+)\s*(?:chapter|ch\.?|c)\s*(\d+(?:\.\d+)?)/i
	);
	if (full) {
		return { volume: parseInt(full[1], 10), chapter: parseFloat(full[2]) };
	}

	const ch =
		t.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\bc(\d+(?:\.\d+)?)\b/i);
	if (ch) {
		return { chapter: parseFloat(ch[1]) };
	}

	if (/prologue/i.test(t)) return { chapter: 0 };
	if (/side\s*story|extra/i.test(t)) {
		const n = t.match(/(\d+(?:\.\d+)?)/);
		return { chapter: n ? 1000 + parseFloat(n[1]) : 1000 };
	}

	const bare = t.match(/(\d+(?:\.\d+)?)/);
	if (bare) return { chapter: parseFloat(bare[1]) };
	return null;
}

function compositeNumber(vol: number | undefined, ch: number): number {
	if (vol != null && vol > 0) return vol * 1000 + ch;
	return ch;
}

function shortChapterTitle(vol: number | undefined, ch: number, raw?: string): string {
	if (vol != null && vol > 0 && ch >= 0) {
		return `Volume ${vol} Chapter ${ch}`;
	}
	if (ch === 0 || /prologue/i.test(raw || '')) return 'Prologue';
	if (ch >= 1000 || /side\s*story|extra/i.test(raw || '')) {
		const n = ch >= 1000 ? ch - 1000 : ch;
		return n > 0 ? `Side Story ${n}` : 'Side Story';
	}
	if (ch > 0) return `Chapter ${ch}`;
	return 'Chapter';
}

function isPatreonUrl(href: string): boolean {
	return /patreon\.com/i.test(href || '');
}

function assertNotCf(html: string): void {
	const low = html.slice(0, 3000).toLowerCase();
	if (
		(low.includes('just a moment') ||
			low.includes('cf-browser-verification') ||
			low.includes('challenge-platform') ||
			low.includes('verify you are human')) &&
		html.length < 25000
	) {
		throw new Error('Cloudflare blocked this request');
	}
}

const KNOWN_SERIES: Array<{ title: string; path: string }> = [
	{
		title: 'Harem Tales of Reincarnated Elf Prince',
		path: '/stabbingwithasyringe-translated-works/harem-tales-of-reincarnated-elf-prince'
	},
	{
		title: "Reincarnated Mage's Tower Dungeon Management",
		path: '/stabbingwithasyringe-translated-works/tower-dungeon-management'
	},
	{
		title: "The Reversed Parallel World's Messiah",
		path: '/stabbingwithasyringe-translated-works/reversed-another-worlds-messiah'
	},
	{
		title: 'The Harem Teacher at Elreis Sorceress Academy',
		path: '/stabbingwithasyringe-translated-works/the-harem-teacher-at-elreis-sorceress-academy'
	},
	{
		title: 'Reincarnated as an Elf Magic Swordsman',
		path: '/stabbingwithasyringe-translated-works/reincarnated-as-an-elf-magic-swordsman'
	},
	{
		title: 'What? Failure to Transition……Success?',
		path: '/stabbingwithasyringe-translated-works/what-failure-to-transition-success'
	},
	{
		title:
			'After being Abandoned, the Bastard of the Royal Family turned out to be the Strongest',
		path: '/stabbingwithasyringe-translated-works/bastard-of-the-royal-family'
	},
	{
		title:
			'When I was Transferred to Another World, I Became the Second-in-Command of a Lady Commander',
		path: '/stabbingwithasyringe-translated-works/second-in-command-of-a-lady-commander'
	},
	{
		title:
			'I, Reborn as A Holy Knight, Will Work Hard to Make Babies to Revive the Other World',
		path: '/stabbingwithasyringe-translated-works/reborn-as-a-holy-knight'
	},
	{
		title: 'Profession, Merchant',
		path: '/stabbingwithasyringe-translated-works/profession-merchant'
	},
	{
		title:
			"I'm Being Pressed by S-Rank Female Adventurers Who Are Late for Marriage in a Reversed World",
		path: '/stabbingwithasyringe-translated-works/im-being-pressed-by-s-rank-female-adventurers'
	},
	{
		title: 'A Maid From Another World Arrives',
		path: '/stabbingwithasyringe-translated-works/a-maid-from-another-world-arrives'
	},
	{
		title: "Relegated to a Women's City",
		path: '/stabbingwithasyringe-translated-works/relegated-to-a-womens-city'
	},
	{
		title: 'Genius Women Crave Defeat',
		path: '/stabbingwithasyringe-translated-works/genius-women-crave-defeat'
	},
	{
		title: 'What, the Transition Failed!?',
		path: '/stabbingwithasyringe-translated-works/what-the-transition-failed'
	}
];

export class StabbingWithASyringeSource extends BaseSource {
	id = 'stabbingwithasyringe';
	name = 'Stabbing with a Syringe';
	baseUrl = BASE;

	kind = 'novel' as const;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept:
			'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http')
			? path
			: `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
		return super.fetchHtml(url);
	}

	// ─── Latest (homepage → 24 titles) ───────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		return this.getLatestNovels(page);
	}

	async getLatestNovels(page = 1): Promise<Manga[]> {
		if (page <= 1) {
			const [series, home] = await Promise.all([
				this.parseSeriesList().catch(() => [] as Manga[]),
				this.parseHomePosts().catch(() => [] as Manga[])
			]);
			const merged = this.mergeById(series, home);
			if (merged.length >= 8) return merged.slice(0, 24);
			return (home.length ? home : series).slice(0, 24);
		}
	
		return this.parseBlogPage(page);
	}

	private mergeById(primary: Manga[], secondary: Manga[]): Manga[] {
		const map = new Map<string, Manga>();
		for (const m of primary) map.set(m.id, m);
		for (const m of secondary) {
			const prev = map.get(m.id);
			if (!prev) {
				map.set(m.id, m);
			} else {
				map.set(m.id, {
					...prev,
					latestChapter: m.latestChapter ?? prev.latestChapter,
					cover: prev.cover || m.cover,
					title: prev.title || m.title
				});
			}
		}
		return [...map.values()];
	}

	private async parseSeriesList(): Promise<Manga[]> {
		const html = await this.fetchHtml('/stabbingwithasyringe-translated-works/');
		assertNotCf(html);
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('.entry-content a, .post-content a, article a, .page-content a').each((_, a) => {
			const href = $(a).attr('href') || '';
			if (!href || isPatreonUrl(href)) return;
			const seriesId = seriesPathFromHref(href);
			if (!seriesId || !isSeriesPath(seriesId)) return;
			if (seen.has(seriesId)) return;

			const title = cleanText($(a).attr('title') || $(a).text());
			if (!title || title.length < 3) return;
			if (/^here$|^link$|^original/i.test(title)) return;

			seen.add(seriesId);
			list.push({
				id: seriesId,
				title,
				cover: '',
				sourceId: this.id,
				type: 'novel',
				lang: 'en'
			});
		});

		if (list.length < 5) {
			for (const k of KNOWN_SERIES) {
				if (seen.has(k.path)) continue;
				seen.add(k.path);
				list.push({
					id: k.path,
					title: k.title,
					cover: '',
					sourceId: this.id,
					type: 'novel',
					lang: 'en'
				});
			}
		}

		return list;
	}

	private async parseHomePosts(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		assertNotCf(html);
		const $ = cheerio.load(html);
		const list: Manga[] = [];
		const seen = new Set<string>();

		$('article, .post, .entry, .hentry').each((_, el) => {
			const item = this.parsePostCard($, el);
			if (!item || seen.has(item.id)) return;
			seen.add(item.id);
			list.push(item);
		});

		if (list.length < 6) {
			$('h2 a, h3 a, .entry-title a, .post-title a').each((_, a) => {
				const href = $(a).attr('href') || '';
				const title = cleanText($(a).attr('title') || $(a).text());
				if (!title || title.length < 4) return;
				const parsed = this.titleToSeries(title, href);
				if (!parsed || seen.has(parsed.id)) return;
				seen.add(parsed.id);
				list.push(parsed);
			});
		}

		return list;
	}

	private parsePostCard($: cheerio.CheerioAPI, el: any): Manga | null {
		const a =
			$(el).find('h2 a, h3 a, .entry-title a, .post-title a').first().length > 0
				? $(el).find('h2 a, h3 a, .entry-title a, .post-title a').first()
				: $(el).find('a').first();
		const href = a.attr('href') || '';
		const rawTitle = cleanText(a.attr('title') || a.text() || $(el).find('h2, h3').first().text());
		if (!rawTitle || rawTitle.length < 4) return null;

		return this.titleToSeries(rawTitle, href);
	}

	private titleToSeries(rawTitle: string, href: string): Manga | null {
		let seriesTitle = rawTitle
			.replace(/\s*[!\.]?\s*v\d+\s*c\d+.*$/i, '')
			.replace(/\s*[!\.]?\s*(?:volume|vol\.?)\s*\d+\s*(?:chapter|ch\.?|c)\s*\d+.*$/i, '')
			.replace(/\s*[!\.]?\s*(?:chapter|ch\.?)\s*\d+.*$/i, '')
			.replace(/!\s*$/, '')
			.trim();

		if (!seriesTitle || seriesTitle.length < 3) seriesTitle = rawTitle;

		let seriesId: string | null = null;
		const lower = seriesTitle.toLowerCase();
		for (const k of KNOWN_SERIES) {
			const kl = k.title.toLowerCase();
			if (
				lower.includes(kl.slice(0, 20)) ||
				kl.includes(lower.slice(0, 20)) ||
				lower.replace(/[^a-z0-9]/g, '').includes(kl.replace(/[^a-z0-9]/g, '').slice(0, 18))
			) {
				seriesId = k.path;
				seriesTitle = k.title;
				break;
			}
		}

		if (!seriesId && href) {
			seriesId = seriesPathFromHref(href);
		}

		if (!seriesId) {
			const slug = seriesTitle
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-|-$/g, '')
				.slice(0, 80);
			if (slug.length < 3) return null;
			seriesId = `/stabbingwithasyringe-translated-works/${slug}`;
		}

		const vc = parseVolumeChapter(rawTitle);
		const latestChapter = vc
			? compositeNumber(vc.volume, vc.chapter)
			: undefined;

		const cover =
			'';

		return {
			id: seriesId,
			title: seriesTitle,
			cover,
			sourceId: this.id,
			type: 'novel',
			lang: 'en',
			...(latestChapter != null ? { latestChapter } : {})
		};
	}

	private async parseBlogPage(page: number): Promise<Manga[]> {
		const paths = [`/page/${page}/`, `/?paged=${page}`];
		for (const path of paths) {
			try {
				const html = await this.fetchHtml(path);
				assertNotCf(html);
				const $ = cheerio.load(html);
				const list: Manga[] = [];
				const seen = new Set<string>();
				$('article, .post, .entry, .hentry').each((_, el) => {
					const item = this.parsePostCard($, el);
					if (!item || seen.has(item.id)) return;
					seen.add(item.id);
					list.push(item);
				});
				if (list.length) return list.slice(0, 24);
			} catch {
			}
		}
		return [];
	}

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const page = opts?.page ?? 1;
		const q = encodeURIComponent(query.trim());
		if (!q) return [];

		const paths =
			page <= 1
				? [`/?s=${q}`, `/search/${q}/`]
				: [`/page/${page}/?s=${q}`, `/?s=${q}&paged=${page}`];

		for (const path of paths) {
			try {
				const html = await this.fetchHtml(path);
				assertNotCf(html);
				const $ = cheerio.load(html);
				const list: Manga[] = [];
				const seen = new Set<string>();

				$('a[href*="/stabbingwithasyringe-translated-works/"], a[href*="/translations/"]').each(
					(_, a) => {
						const href = $(a).attr('href') || '';
						const seriesId = seriesPathFromHref(href);
						if (!seriesId || !isSeriesPath(seriesId) || seen.has(seriesId)) return;
						const title = cleanText($(a).attr('title') || $(a).text());
						if (!title || title.length < 3) return;
						seen.add(seriesId);
						list.push({
							id: seriesId,
							title,
							cover: '',
							sourceId: this.id,
							type: 'novel',
							lang: 'en'
						});
					}
				);

				$('article, .post, .entry, .hentry').each((_, el) => {
					const item = this.parsePostCard($, el);
					if (!item || seen.has(item.id)) return;
					seen.add(item.id);
					list.push(item);
				});

				if (list.length) return list.slice(0, 24);
			} catch {
			}
		}

		const ql = query.toLowerCase();
		return KNOWN_SERIES.filter((k) => k.title.toLowerCase().includes(ql))
			.map((k) => ({
				id: k.path,
				title: k.title,
				cover: '',
				sourceId: this.id,
				type: 'novel' as const,
				lang: 'en'
			}))
			.slice(0, 24);
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		path = path.replace(/\/$/, '');

		const candidates = [path.endsWith('/') ? path : `${path}/`];
		if (path.includes('/stabbingwithasyringe-translated-works/')) {
			const slug = path.split('/').pop()!;
			candidates.push(`/translations/${slug}/`);
		} else if (path.includes('/translations/')) {
			const slug = path.split('/').pop()!;
			candidates.push(`/stabbingwithasyringe-translated-works/${slug}/`);
		}

		let html = '';
		let usedPath = path;
		for (const c of candidates) {
			try {
				html = await this.fetchHtml(c);
				assertNotCf(html);
				if (html.length > 2000) {
					usedPath = pathOnly(c);
					break;
				}
			} catch {
			}
		}
		if (!html || html.length < 500) {
			throw new Error(`Novel not found: ${mangaId}`);
		}

		const $ = cheerio.load(html);

		const title =
			cleanText($('h1.entry-title, h1').first().text()) ||
			cleanText(
				$('meta[property="og:title"]').attr('content')?.split(/[|\-–]/)[0] || ''
			) ||
			'';

		if (!title || title.length < 2) {
			throw new Error('Novel not found (empty title)');
		}

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('.entry-content img, .post-content img, article img').first().attr('src') ||
			$('img.wp-post-image').attr('src') ||
			'';
		cover = absUrl((cover || '').split('?')[0]);

		let description = '';
		const content = $('.entry-content, .post-content, .page-content, article .content').first();
		if (content.length) {
			const parts: string[] = [];
			content.find('p').each((_, p) => {
				const t = cleanText($(p).text());
				if (!t || t.length < 30) return;
				if (/table of contents|warning\.?\s*this novel|original webnovel/i.test(t)) return;
				if (/^author\s*:/i.test(t)) return;
				parts.push(t);
			});
			description = parts.slice(0, 6).join('\n\n');
		}
		if (!description) {
			description =
				cleanText($('meta[property="og:description"]').attr('content') || '') ||
				cleanText($('meta[name="description"]').attr('content') || '');
		}

		const authors: string[] = [];
		const authorMatch =
			content.text().match(/Author\s*[:：]\s*([^\n|]+)/i) ||
			$('body').text().match(/Author\s*[:：]\s*([^\n|]+)/i);
		if (authorMatch) {
			const name = cleanText(authorMatch[1].split(/\n|Published|Book/)[0]);
			if (name && name.length < 80) authors.push(name);
		}
		content.find('p, div, span').each((_, el) => {
			const t = cleanText($(el).text());
			const m = t.match(/^Author\s*[:：]\s*(.+)$/i);
			if (m) {
				const name = cleanText(m[1]).split(/\s{2,}|\n/)[0];
				if (name && name.length < 80 && !authors.includes(name)) authors.push(name);
			}
		});

		const genres: string[] = ['Adult', 'Ecchi', 'Harem'];
		const bodyText = content.text();
		if (/100%\s*Ecchi/i.test(bodyText)) genres.push('Explicit');
		if (/isekai|another world|reincarnat/i.test(bodyText + title)) genres.push('Isekai');
		if (/fantasy/i.test(bodyText)) genres.push('Fantasy');

		let status = 'Ongoing';
		if (/completed|complete|finished/i.test(bodyText.slice(0, 2000))) {
			status = 'Completed';
		}

		const chapters = this.parseChapterList($, usedPath);
		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

		return {
			id: usedPath,
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
			...(chapters[0]?.number != null ? { latestChapter: chapters[0].number } : {})
		};
	}

	private parseChapterList($: cheerio.CheerioAPI, seriesPath: string): Chapter[] {
		const out: Chapter[] = [];
		const seenId = new Set<string>();
		const seenNum = new Set<number>();
		let currentVol: number | undefined;
		let fallbackIdx = 0;

		const root =
			$('.entry-content, .post-content, .page-content').first().length > 0
				? $('.entry-content, .post-content, .page-content').first()
				: $('article').first();

		const nodes = root.find('h2, h3, h4, p, li, a').toArray();

		for (const node of nodes) {
			const el = $(node);
			const tag = ((node as any).tagName || (node as any).name || '').toLowerCase();

			if (tag === 'h2' || tag === 'h3' || tag === 'h4') {
				const ht = cleanText(el.text());
				const vm =
					ht.match(/(?:volume|vol\.?)\s*(\d+)/i) ||
					ht.match(/\bv\s*(\d+)\b/i);
				if (vm) {
					currentVol = parseInt(vm[1], 10);
				} else if (/prologue/i.test(ht)) {
					currentVol = 0;
				} else if (/extra|side\s*story/i.test(ht)) {
					if (currentVol == null) currentVol = 100;
				}
				continue;
			}

			if (tag !== 'a') continue;

			const href = el.attr('href') || '';
			if (!href) continue;

			const locked = isPatreonUrl(href);
			let id = locked ? href : pathOnly(href);

			if (!locked) {
				if (id === seriesPath || id === seriesPath + '/') continue;
				if (/\/(category|tag|author|page|feed)\//i.test(id)) continue;
				if (
					!href.includes('stabbingwithasyringe') &&
					!href.startsWith('/')
				)
					continue;
				if (isSeriesPath(id)) continue;
			}

			const rawTitle = cleanText(el.attr('title') || el.text());
			if (!rawTitle || rawTitle.length < 2) continue;
			if (/^here$|^link$|^original|^table of contents|^support/i.test(rawTitle))
				continue;

			let vc = parseVolumeChapter(rawTitle);

			if (!vc?.volume) {
				const urlVc = parseVolumeChapter(id.replace(/[-_/]/g, ' '));
				if (urlVc) {
					vc = {
						volume: urlVc.volume ?? vc?.volume,
						chapter: urlVc.chapter ?? vc?.chapter ?? 0
					};
				}
			}

			if (vc && vc.volume == null && currentVol != null && currentVol > 0) {
				vc = { volume: currentVol, chapter: vc.chapter };
			}
			if (!vc && currentVol != null) {
				const chOnly = parseVolumeChapter(rawTitle);
				if (chOnly) {
					vc = { volume: currentVol > 0 ? currentVol : undefined, chapter: chOnly.chapter };
				}
			}

			const looksChapter =
				!!vc ||
				/chapter|prologue|side\s*story|extra/i.test(rawTitle) ||
				/chapter|volume|prologue|side|extra/i.test(id);
			if (!looksChapter && !locked) continue;

			try {
				id = decodeURIComponent(id);
			} catch {
			
			}
			id = id.replace(/\/$/, '');

			if (seenId.has(id)) continue;
			seenId.add(id);

			fallbackIdx += 1;
			const vol = vc?.volume ?? (currentVol && currentVol > 0 ? currentVol : undefined);
			const ch = vc?.chapter ?? fallbackIdx;
			const number = compositeNumber(vol, ch);

			if (seenNum.has(number) && number > 0) continue;
			seenNum.add(number);

			let date: string | undefined;
			const parent = el.parent();
			const timeEl = parent.find('time').first();
			if (timeEl.length) {
				date =
					timeEl.attr('datetime') ||
					cleanText(timeEl.text()) ||
					undefined;
			}
			if (!date) {
				const dateText = cleanText(
					parent.find('.posted-on, .entry-date, .date').first().text()
				);
				if (dateText && /\d{4}|\d{1,2}[\/\-]\d{1,2}/.test(dateText)) {
					date = dateText;
				}
			}

			out.push({
				id,
				title: shortChapterTitle(vol, ch, rawTitle),
				number,
				...(date ? { date } : {}),
				...(locked ? { isLocked: true } : {})
			});
		}

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
		if (isPatreonUrl(chapterId)) {
			return {
				title: 'Locked Chapter',
				content:
					'<p>This chapter is locked behind Patreon. Please support the translator on Patreon to read it.</p>',
				prevChapterId: null,
				nextChapterId: null
			};
		}

		let path = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
		path = path.replace(/\/$/, '');
		const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
		assertNotCf(html);
		const $ = cheerio.load(html);

		const rawTitle =
			cleanText($('h1.entry-title, h1').first().text()) ||
			cleanText($('meta[property="og:title"]').attr('content')?.split(/[|\-–]/)[0] || '') ||
			'Chapter';

		const vc = parseVolumeChapter(rawTitle);
		const title = vc
			? shortChapterTitle(vc.volume, vc.chapter, rawTitle)
			: shortChapterTitle(undefined, 0, rawTitle);

		const root = $('.entry-content, .post-content, .page-content, article .content').first();
		const paragraphs: string[] = [];

		root.find('p, h2, h3, blockquote').each((_, el) => {
			const tag = ((el as any).tagName || (el as any).name || '').toLowerCase();
			const t = cleanText($(el).text());
			if (!t || t.length < 2) return;

			if (
				/advertisements?|leave a comment|posted in|posted by|table of contents/i.test(t)
			)
				return;
			if (/thanks to the following|support us on patreon|once again, thank you/i.test(t))
				return;
			if (/^\d+cc$/i.test(t)) return;
			if (t.length < 15 && /^(jason|john|matt|allen|gimo|bla)/i.test(t)) return;

			if (/if y\s*ou ar\s*e a\s*ble to r\s*e/i.test(t) || /th is cha p er/i.test(t))
				return;
			if (/unauthorized agg|read at my wordpress|stabbi ngwit/i.test(t)) return;

			if (tag === 'h2' || tag === 'h3') {
				paragraphs.push(`<h3>${escapeHtml(t)}</h3>`);
			} else {
				paragraphs.push(`<p>${escapeHtml(t)}</p>`);
			}
		});

		let content = paragraphs.join('\n');
		if (!content || content.length < 80) {
			const fallback = cleanText(root.text())
				.split(/\n{2,}/)
				.map((p) => p.trim())
				.filter((p) => p.length > 40)
				.filter(
					(p) =>
						!/advertisement|patreon|leave a comment|unauthorized/i.test(p)
				)
				.slice(0, 80)
				.map((p) => `<p>${escapeHtml(p)}</p>`)
				.join('\n');
			content = fallback || '<p>Content not available.</p>';
		}

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		$('a[rel="prev"], .nav-previous a, .prev a').each((_, a) => {
			const href = $(a).attr('href') || '';
			if (href && !isPatreonUrl(href)) prevChapterId = pathOnly(href);
		});
		$('a[rel="next"], .nav-next a, .next a').each((_, a) => {
			const href = $(a).attr('href') || '';
			if (href && !isPatreonUrl(href)) nextChapterId = pathOnly(href);
		});

		if (!prevChapterId || !nextChapterId) {
			root.find('a').each((_, a) => {
				const t = cleanText($(a).text()).toLowerCase();
				const href = $(a).attr('href') || '';
				if (!href || isPatreonUrl(href)) return;
				if (!prevChapterId && /prev|previous|←|«/.test(t)) {
					prevChapterId = pathOnly(href);
				}
				if (!nextChapterId && /next|→|»/.test(t)) {
					nextChapterId = pathOnly(href);
				}
			});
		}

		return {
			title,
			content,
			prevChapterId,
			nextChapterId
		};
	}
}

export default StabbingWithASyringeSource;
