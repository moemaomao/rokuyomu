/**
 * Zky Translates (zkytl.wordpress.com) — WordPress.com TL blog
 * Path: scraper/src/sources/impl/novel/ZkyTL.ts
 *
 * - Novel index: /{long-slug}/  (menu: LIV, TRA, PRA, RAK, …)
 * - Chapter post: /YYYY/MM/DD/{code}-chapter-{n}/
 * - Homepage: latest chapter posts → group by series (max 24)
 * - Chapter title → "Chapter N" (clean)
 * - Content: .entry-content
 * - Prev/Next: nav links + infer from number
 * - Search: filter known series catalog by title
 * - Uses fetchWithCf
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const PAGE_SIZE = 24;
const SERIES_CATALOG: Array<{
	code: string;
	id: string;
	title: string;
	status: string;
}> = [
	{
		code: 'LIV',
		id: '/a-livid-ladys-guide-to-getting-even-how-i-crushed-my-homeland-with-my-mighty-grimoires',
		title:
			"A Livid Lady's Guide to Getting Even: How I Crushed My Homeland with My Mighty Grimoires",
		status: 'Ongoing'
	},
	{
		code: 'TRA',
		id: '/trapped-in-a-dungeon-for-25-years-by-the-time-i-was-rescued-id-become-a-full-fledged-suspicious-guy',
		title:
			"Trapped in a Dungeon for 25 Years: By the Time I Was Rescued I'd Become a Full-Fledged Suspicious Guy",
		status: 'Ongoing'
	},
	{
		code: 'PRA',
		id: '/practically-another-world-reincarnation-i-slept-for-two-thousand-years-and-the-world-had-changed',
		title:
			'Practically Another World Reincarnation: I Slept for Two Thousand Years and the World Had Changed',
		status: 'Ongoing'
	},
	{
		code: 'RAK',
		id: '/rakshasa-galaxy-i-became-the-character-who-dies-right-at-the-start-so-i-did-whatever-i-wanted-and-somehow-ended-up-a-hero',
		title:
			'Rakshasa Galaxy: I Became the Character Who Dies Right at the Start, So I Did Whatever I Wanted and Somehow Ended Up a Hero',
		status: 'Ongoing'
	},
	{
		code: 'IDI',
		id: '/the-idiot-the-curse-and-the-magic-academy',
		title: 'The Idiot, the Curse, and the Magic Academy',
		status: 'Ongoing'
	},
	{
		code: 'IGO',
		id: '/the-commoner-born-imperial-general-officer-rises-through-the-ranks-by-crushing-his-incompetent-noble-superiors',
		title:
			'The Commoner-Born Imperial General Officer Rises Through the Ranks by Crushing His Incompetent Noble Superiors',
		status: 'Ongoing'
	},
	{
		code: 'SLO',
		id: '/the-slothful-villainous-noble',
		title: 'The Slothful Villainous Noble',
		status: 'Ongoing'
	},
	{
		code: 'LVL',
		id: '/reberu-ga-arunara-agerudesho-mobukyara-ni-tensei-shita-ore-wa-gemu-chishiki-o-ikashi-hitasura-reberu-o-age-tsudzukeru',
		title:
			'Reberu ga Arunara Agerudesho: Mobukyara ni Tensei Shita Ore wa Gemu Chishiki o Ikashi Hitasura Reberu o Age Tsudzukeru',
		status: 'Ongoing'
	},
	{
		code: 'POT',
		id: '/potions-are-meant-to-be-thrown-at-160-km-h-i-an-item-handler-became-the-strongest-adventurer-by-throwing-omnipotent-potions',
		title:
			'Potions Are Meant to Be Thrown at 160 km/h: I, an Item Handler, Became the Strongest Adventurer by Throwing Omnipotent Potions',
		status: 'Completed'
	},
	{
		code: 'BSO',
		id: '/bso',
		title: 'BSO',
		status: 'Completed'
	},
	{
		code: 'ZAM',
		id: '/zam',
		title: 'ZAM',
		status: 'Completed'
	},
	{
		code: 'PAW',
		id: '/paw',
		title: 'PAW',
		status: 'Completed'
	},
	{
		code: 'MSM',
		id: '/a-sword-master-childhood-friend-power-harassed-me-harshly-so-i-broke-off-our-relationship-and-make-a-fresh-start-at-the-frontier-as-a-magic-swordsman',
		title:
			'A Sword Master Childhood Friend Power-Harassed Me Harshly, So I Broke Off Our Relationship and Make a Fresh Start at the Frontier as a Magic Swordsman',
		status: 'Completed'
	},
	{
		code: 'OTO',
		id: '/ototsukai-wa-shi-to-odoru',
		title: 'Ototsukai wa Shi to Odoru',
		status: 'Dropped'
	}
];

const CODE_TO_SERIES = new Map(SERIES_CATALOG.map((s) => [s.code.toUpperCase(), s]));

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

function pathOnly(href: string, baseHost = 'https://zkytl.wordpress.com'): string {
	try {
		const u = new URL(
			href.startsWith('http')
				? href
				: `${baseHost}${href.startsWith('/') ? '' : '/'}${href}`
		);
		return u.pathname.replace(/\/$/, '') || '/';
	} catch {
		return href.startsWith('/') ? href.replace(/\/$/, '') : `/${href}`;
	}
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function decodeEntities(s: string): string {
	return s
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function parseChapterNumber(text: string, fallback = 0): number {
	const t = (text || '').replace(/\s+/g, ' ').trim();
	const m =
		t.match(/chapter[-\s]*(\d+(?:\.\d+)?)/i) ||
		t.match(/\bch\.?\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/^(\d+(?:\.\d+)?)$/) ||
		t.match(/(\d+(?:\.\d+)?)/);
	if (m) {
		const n = parseFloat(m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function shortChapterTitle(number: number): string {
	return number > 0 ? `Chapter ${number}` : 'Chapter';
}

function extractSeriesCode(text: string): string | null {
	const m = (text || '').match(/\b([A-Z]{2,4})\s+Chapter\s+\d/i);
	if (m) return m[1].toUpperCase();
	const m2 = (text || '').match(/\/([a-z]{2,4})-chapter-\d/i);
	if (m2) return m2[1].toUpperCase();
	return null;
}

function isChapterPostPath(path: string): boolean {
	return /\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9\-]+-chapter-[\d.]+/i.test(path);
}

function isNovelIndexPath(path: string): boolean {
	if (!path || path === '/') return false;
	if (isChapterPostPath(path)) return false;
	if (/^\/(page|category|tag|author|feed|contact|completed|dropped)\b/i.test(path))
		return false;
	if (/^\/\d{4}\//.test(path)) return false;
	return path.length > 3;
}

export class ZkyTLSource extends BaseSource {
	id = 'zkytl';
	name = 'Zky Translates';
	baseUrl = 'https://zkytl.wordpress.com';

	kind = 'novel' as const;

	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const headers = {
			...this.headers,
			Referer: this.baseUrl,
			'User-Agent':
				this.headers?.['User-Agent'] ||
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
			Accept:
				'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
		};

		try {
			const res = await fetch(url, { headers, redirect: 'follow' });
			const html = await res.text();
			const low = html.slice(0, 3000).toLowerCase();
			const isCf =
				res.status === 403 ||
				res.status === 503 ||
				((low.includes('just a moment') ||
					low.includes('cf-browser-verification') ||
					low.includes('challenge-platform')) &&
					html.length < 25000);
			if (!isCf && res.ok && html.length > 500) {
				return html;
			}
			console.warn(
				`[zkytl] plain fetch status=${res.status} len=${html.length} → try fetchWithCf`
			);
		} catch (e) {
			console.warn('[zkytl] plain fetch failed', String(e));
		}

		return fetchWithCf(url, { headers });
	}

	// ─── Latest ──────────────────────────────────────────────────────────

	async getLatestManga(page = 1): Promise<Manga[]> {
		return this.getLatestNovels(page);
	}

	async getLatestNovels(page = 1): Promise<Manga[]> {
		const p = Math.max(1, page);
		try {
			if (p <= 1) {
				const fromHome = await this.parseHomeLatest().catch(() => [] as Manga[]);
				if (fromHome.length >= 4) {
					console.log(`[zkytl] latest page=1 (home) → ${fromHome.length}`);
					return fromHome.slice(0, PAGE_SIZE);
				}
			}
			const all = this.catalogAsManga();
			const start = (p - 1) * PAGE_SIZE;
			const slice = all.slice(start, start + PAGE_SIZE);
			console.log(`[zkytl] latest page=${p} catalog → ${slice.length}`);
			return slice;
		} catch (e) {
			console.error('[zkytl] latest', e);
			return this.catalogAsManga().slice(0, PAGE_SIZE);
		}
	}

	private catalogAsManga(): Manga[] {
		return SERIES_CATALOG.map((s) => ({
			id: s.id,
			title: s.title,
			cover: '',
			sourceId: this.id,
			type: 'novel',
			lang: 'en',
			status: s.status
		}));
	}

	private async parseHomeLatest(): Promise<Manga[]> {
		const html = await this.fetchHtml('/');
		const $ = cheerio.load(html);
		const order: string[] = [];
		const latestByCode = new Map<string, number>();

		$('article h1 a, article h2 a, .entry-title a, h2.entry-title a, h1 a, h2 a').each(
			(_, a) => {
				const text = $(a).text().replace(/\s+/g, ' ').trim();
				const href = $(a).attr('href') || '';
				const code = extractSeriesCode(text + ' ' + href);
				if (!code || !CODE_TO_SERIES.has(code)) return;
				const n = parseChapterNumber(text + ' ' + href, 0);
				if (!order.includes(code)) order.push(code);
				const prev = latestByCode.get(code) || 0;
				if (n > prev) latestByCode.set(code, n);
			}
		);

		$('a[href*="/category/"]').each((_, a) => {
			const code = ($(a).text() || '').trim().toUpperCase();
			if (!CODE_TO_SERIES.has(code)) return;
			if (!order.includes(code)) order.push(code);
		});

		const list: Manga[] = [];
		for (const code of order) {
			const s = CODE_TO_SERIES.get(code);
			if (!s) continue;
			const latest = latestByCode.get(code);
			list.push({
				id: s.id,
				title: s.title,
				cover: '',
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: s.status,
				...(latest != null && latest > 0 ? { latestChapter: latest } : {})
			});
		}

		for (const s of SERIES_CATALOG) {
			if (list.some((m) => m.id === s.id)) continue;
			list.push({
				id: s.id,
				title: s.title,
				cover: '',
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: s.status
			});
		}

		return list.slice(0, PAGE_SIZE);
	}

	// ─── Search ──────────────────────────────────────────────────────────

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		return this.searchNovels(query, opts);
	}

	async searchNovels(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim().toLowerCase();
		if (!q) return this.getLatestNovels(opts?.page ?? 1);

		const page = Math.max(1, opts?.page ?? 1);
		const all = this.catalogAsManga().filter(
			(m) =>
				m.title.toLowerCase().includes(q) ||
				m.id.toLowerCase().includes(q.replace(/\s+/g, '-')) ||
				SERIES_CATALOG.some(
					(s) =>
						s.id === m.id &&
						(s.code.toLowerCase().includes(q) || s.title.toLowerCase().includes(q))
				)
		);
		const start = (page - 1) * PAGE_SIZE;
		const slice = all.slice(start, start + PAGE_SIZE);
		console.log(`[zkytl] search "${q}" → ${slice.length}`);
		return slice;
	}

	// ─── Details ─────────────────────────────────────────────────────────

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		return this.getNovelDetails(mangaId);
	}

	async getNovelDetails(novelId: string): Promise<MangaDetails> {
		let path = pathOnly(novelId, this.baseUrl);

		if (isChapterPostPath(path)) {
			const code = extractSeriesCode(path);
			const s = code ? CODE_TO_SERIES.get(code) : undefined;
			if (s) path = s.id;
		}

		if (!path.startsWith('/')) path = `/${path}`;
		const fetchPath = path.endsWith('/') ? path : `${path}/`;

		console.log(`[zkytl] details ${fetchPath}`);
		const html = await this.fetchHtml(fetchPath);
		const $ = cheerio.load(html);

		let title = decodeEntities(
			$('h1.entry-title, .entry-header h1, article h1, h1').first().text() ||
				$('meta[property="og:title"]').attr('content')?.split(/\s*[|\-–]\s*/)[0] ||
				''
		);
		if (!title || title.length < 3) {
			const known = SERIES_CATALOG.find((s) => s.id === pathOnly(path, this.baseUrl));
			title = known?.title || path.split('/').pop()?.replace(/-/g, ' ') || 'Unknown';
		}

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('.entry-content img, article img').first().attr('src') ||
			'';
		if (/gravatar|avatar|emoji|wordpress\.com\/i/i.test(cover)) cover = '';
		cover = absUrl(this.baseUrl, (cover || '').split('?')[0]);

		const authors: string[] = [];
		const bodyText = $('.entry-content, .post-content, article').first().text();
		const am = bodyText.match(/Author\s*:\s*([^\n\r]{2,80})/i);
		if (am) authors.push(decodeEntities(am[1].trim()));

		let description = '';
		const content = $('.entry-content, .post-content').first();
		content.find('p').each((_, p) => {
			const t = $(p).text().replace(/\s+/g, ' ').trim();
			if (!t) return;
			if (/^Author\s*:/i.test(t) || /^Raw\s*:/i.test(t)) return;
			if (/^\d{1,4}(\.\d+)?$/.test(t)) return;
			if (t.length < 40) return;
			if (!description) description = t;
			else if (description.length < 800) description += '\n\n' + t;
		});
		description = decodeEntities(description).slice(0, 3000);

		const known = SERIES_CATALOG.find((s) => s.id === pathOnly(path, this.baseUrl));
		const status = known?.status || 'Ongoing';

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		content.find('a[href]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const full = pathOnly(href, this.baseUrl);
			if (!isChapterPostPath(full) && !/chapter-\d/i.test(full)) {
				// numeric-only links still go to chapter posts
				if (!/\/\d{4}\/\d{2}\/\d{2}\//.test(full)) return;
			}
			if (!/chapter/i.test(full) && !/\/\d{4}\/\d{2}\/\d{2}\//.test(full)) return;

			const id = full;
			if (seen.has(id)) return;

			const raw = $(a).text().replace(/\s+/g, ' ').trim();
			let number = parseChapterNumber(raw, 0);
			if (number <= 0) number = parseChapterNumber(id, 0);
			if (number <= 0) return;

			seen.add(id);
			chapters.push({
				id,
				title: shortChapterTitle(number),
				number
			});
		});

		if (chapters.length < 1) {
			$('a[href*="-chapter-"]').each((_, a) => {
				const full = pathOnly($(a).attr('href') || '', this.baseUrl);
				if (seen.has(full)) return;
				const number = parseChapterNumber(full + ' ' + $(a).text(), 0);
				if (number <= 0) return;
				seen.add(full);
				chapters.push({ id: full, title: shortChapterTitle(number), number });
			});
		}

		chapters.sort((a, b) => b.number - a.number);

		console.log(`[zkytl] details ${path} → ${chapters.length} ch`);

		return {
			id: pathOnly(path, this.baseUrl),
			title,
			cover,
			sourceId: this.id,
			description,
			authors,
			status,
			genres: [],
			chapters,
			type: 'novel',
			lang: 'en',
			...(chapters[0]?.number ? { latestChapter: chapters[0].number } : {})
		};
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
		let path = pathOnly(chapterId, this.baseUrl);
		const fetchPath = path.endsWith('/') ? path : `${path}/`;
		console.log(`[zkytl] chapter ${fetchPath}`);

		const html = await this.fetchHtml(fetchPath);
		const $ = cheerio.load(html);

		const rawTitle =
			$('h1.entry-title, .entry-header h1, h1').first().text().replace(/\s+/g, ' ').trim() ||
			'';
		const number = parseChapterNumber(path + ' ' + rawTitle, 0);
		const title = shortChapterTitle(number > 0 ? number : 1);

		const contentEl = $('.entry-content, .post-content, .entry').first();
		contentEl
			.find(
				'script, style, noscript, iframe, .sharedaddy, .jp-relatedposts, #jp-post-flair, .wpcnt, nav, .nav-links, .post-navigation'
			)
			.remove();

		const paras: string[] = [];
		contentEl.find('p').each((_, p) => {
			const t = $(p).text().replace(/\s+/g, ' ').trim();
			if (!t) return;
			if (/^Share this:/i.test(t)) return;
			if (/^Loading\.\.\./i.test(t)) return;
			if (/Like this:|Related|Leave a comment/i.test(t)) return;
			paras.push(`<p>${escapeHtml(t)}</p>`);
		});

		let contentHtml = paras.join('\n');
		if (!contentHtml || contentHtml.replace(/<[^>]+>/g, '').trim().length < 40) {
			const plain = contentEl.text().replace(/\s+/g, ' ').trim();
			contentHtml = plain
				? plain
						.split(/(?<=[.!?])\s+(?=[A-Z“"])/)
						.filter((x) => x.trim().length > 20)
						.map((x) => `<p>${escapeHtml(x.trim())}</p>`)
						.join('\n')
				: '<p>No content</p>';
		}

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;

		$('a').each((_, a) => {
			const t = $(a).text().replace(/\s+/g, ' ').trim().toLowerCase();
			const href = $(a).attr('href') || '';
			const full = pathOnly(href, this.baseUrl);
			if (!isChapterPostPath(full) && !/chapter-\d/i.test(full)) return;
			if (t === 'prev' || t === 'previous') prevChapterId = full;
			if (t === 'next') nextChapterId = full;
		});

		if ((!prevChapterId || !nextChapterId) && number > 0) {
			const m = path.match(/^(.*-)(\d+)(\/?)$/i) || path.match(/chapter-(\d+)/i);

		}

		console.log(
			`[zkytl] chapter ok ${contentHtml.length}c prev=${prevChapterId} next=${nextChapterId}`
		);

		return {
			title,
			content: contentHtml,
			prevChapterId,
			nextChapterId
		};
	}
}

export default ZkyTLSource;
