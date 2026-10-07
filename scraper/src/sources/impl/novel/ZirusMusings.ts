/**
 * Ziru's Musings (zirusmusings.net) — Next.js SSG
 * Path: scraper/src/sources/impl/novel/ZirusMusings.ts
 *
 * - Catalog: /series
 * - Series: /series/{code}
 * - Chapter: /series/{code}/{n}
 * - Chapter list: __NEXT_DATA__.props.pageProps.data.volumes[*].chapters
 * - Cover: /images/{code}/cover.png
 * - Latest: homepage Recent Releases + /series catalog
 * - Chapter title: "Chapter N"
 * - fetchWithCf
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../../BaseSource';
import { fetchWithCf } from '../../../lib/fetchWithCf';
import type { Manga, MangaDetails, Chapter } from '../../types-manga';

const BASE = 'https://zirusmusings.net';
const PER_PAGE = 24;

function absUrl(href: string | undefined | null): string {
	if (!href) return '';
	const h = String(href).trim();
	if (!h || h === '#') return '';
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
		return (href.startsWith('/') ? href : `/${href}`).replace(/\/$/, '') || '/';
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

function parseChapterNumber(text: string, fallback = 0): number {
	const t = (text || '').replace(/\s+/g, ' ').trim();
	const m =
		t.match(/(?:chapter|ch\.?|c)\s*[.\-:]?\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/\/(\d+)(?:\/(\d+))?$/i) ||
		t.match(/\b(\d+(?:\.\d+)?)\b/);
	if (m) {
		const n = parseFloat(m[2] || m[1]);
		if (!Number.isNaN(n)) return n;
	}
	return fallback;
}

function seriesIdFromPath(p: string): string | null {
	const m = p.match(/^\/series\/([a-z0-9-]+)(?:\/|$)/i);
	return m ? `/series/${m[1].toLowerCase()}` : null;
}

function seriesCode(id: string): string {
	return id.replace(/^\/series\//, '').replace(/\/$/, '');
}

function coverFor(code: string): string {
	return `${BASE}/images/${code}/cover.png`;
}

function parseNextData(html: string): any | null {
	const m = html.match(
		/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i
	);
	if (!m) return null;
	try {
		return JSON.parse(m[1]);
	} catch {
		return null;
	}
}

function parseMonthDay(text: string): number | undefined {
	const m = text.match(
		/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})\b/i
	);
	if (!m) return undefined;
	const year = new Date().getFullYear();
	const ts = Date.parse(`${m[0]}, ${year}`);
	return Number.isNaN(ts) ? undefined : ts;
}

export class ZirusMusingsSource extends BaseSource {
	id = 'zirusmusings';
	name = "Ziru's Musings";
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept:
			'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		try {
			return await fetchWithCf(url, {
				headers: { ...this.headers, Referer: this.baseUrl }
			});
		} catch (e) {
			console.warn('[zirus] fetchWithCf fail', String(e).slice(0, 100));
			const res = await fetch(url, { headers: this.headers });
			if (!res.ok) {
				const t = await res.text().catch(() => '');
				throw new Error(`fetchHtml ${res.status}: ${t.slice(0, 100)}`);
			}
			return await res.text();
		}
	}

	async getLatestManga(page = 1): Promise<Manga[]> {
		const p = Math.max(1, page);
		try {
			const seen = new Set<string>();
			const list: Manga[] = [];
			const absorb = (items: Manga[]) => {
				for (const m of items) {
					if (seen.has(m.id)) continue;
					seen.add(m.id);
					list.push(m);
				}
			};

			if (p === 1) {
				try {
					absorb(this.parseRecentReleases(await this.fetchHtml('/')));
				} catch (e) {
					console.warn('[zirus] home', String(e).slice(0, 80));
				}
				try {
					absorb(this.parseSeriesCatalog(await this.fetchHtml('/series')));
				} catch (e) {
					console.warn('[zirus] series', String(e).slice(0, 80));
				}
			} else {
				const all = this.parseSeriesCatalog(await this.fetchHtml('/series'));
				const start = (p - 1) * PER_PAGE;
				return all.slice(start, start + PER_PAGE);
			}

			console.log(`[zirus] latest page=${p} n=${list.length}`);
			return list.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[zirus] latest', e);
			return [];
		}
	}

	private parseRecentReleases(html: string): Manga[] {
		const $ = cheerio.load(html);
		const ordered: Manga[] = [];
		const seen = new Set<string>();
		const titleMap = new Map<string, string>();

		$('a[href*="/series/"]').each((_, a) => {
			const p = pathOnly($(a).attr('href') || '');
			if (!/^\/series\/[a-z0-9-]+$/i.test(p)) return;
			const t = cleanText($(a).text());
			if (t.length > 2) titleMap.set(p, t);
		});

		$('a[href*="/series/"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const p = pathOnly(href);
			const id = seriesIdFromPath(p);
			if (!id) return;
			if (!/\/series\/[a-z0-9-]+\/\d+/i.test(p)) return;

			const code = seriesCode(id);
			const raw = cleanText($(a).text());
			const n = parseChapterNumber(p + ' ' + raw, 0);
			const updatedAt = parseMonthDay(raw);

			if (seen.has(id)) {
				const prev = ordered.find((m) => m.id === id);
				if (prev && n > Number(prev.latestChapter || 0)) {
					(prev as any).latestChapter = n;
				}
				return;
			}

			const title =
				titleMap.get(id) ||
				raw
					.replace(
						/\s*[A-Z]{2,6}\s*[•·]\s*(?:Vol\.?\s*\d+\s*)?Ch\.?\s*\d+.*$/i,
						''
					)
					.replace(
						/\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*\d+.*$/i,
						''
					)
					.trim() ||
				code.toUpperCase();

			seen.add(id);
			ordered.push({
				id,
				title: title.slice(0, 200),
				cover: coverFor(code),
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: 'Ongoing',
				...(n > 0 ? { latestChapter: Math.floor(n) } : {}),
				...(updatedAt ? { updatedAt } : {})
			});
		});

		console.log(`[zirus] recent n=${ordered.length}`);
		return ordered;
	}

	private parseSeriesCatalog(html: string): Manga[] {
		const $ = cheerio.load(html);
		const ordered: Manga[] = [];
		const seen = new Set<string>();

		$('a[href*="/series/"]').each((_, a) => {
			const href = $(a).attr('href') || '';
			const p = pathOnly(href);
			if (!/^\/series\/[a-z0-9-]+$/i.test(p)) return;
			const id = seriesIdFromPath(p);
			if (!id || seen.has(id)) return;

			const title = cleanText($(a).text());
			if (!title || title.length < 2) return;
			if (/^(start reading|translations)$/i.test(title)) return;

			const root = $(a).closest('div, article, li, section');
			const body = cleanText(root.text());
			let status = 'Ongoing';
			if (/\bcomplete\b/i.test(body)) status = 'Completed';

			let latest: number | undefined;
			const prog = body.match(/(\d+)\s*\/\s*(\d+)/);
			if (prog) latest = parseInt(prog[1], 10);

			const code = seriesCode(id);
			seen.add(id);
			ordered.push({
				id,
				title: title.slice(0, 200),
				cover: coverFor(code),
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status,
				...(latest && latest > 0 ? { latestChapter: latest } : {})
			});
		});

		$('h2').each((_, h) => {
			const title = cleanText($(h).text());
			if (!title || title.length < 3 || /welcome|settings/i.test(title))
				return;
			const $block = $(h).parent();
			const $a = $block
				.find('a[href*="/series/"]')
				.filter((__, a) =>
					/^\/series\/[a-z0-9-]+$/i.test(
						pathOnly($(a).attr('href') || '')
					)
				)
				.first();
			const id = seriesIdFromPath(pathOnly($a.attr('href') || ''));
			if (!id || seen.has(id)) return;
			const body = cleanText($block.text());
			const prog = body.match(/(\d+)\s*\/\s*(\d+)/);
			const code = seriesCode(id);
			seen.add(id);
			ordered.push({
				id,
				title: title.slice(0, 200),
				cover: coverFor(code),
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: /\bcomplete\b/i.test(body) ? 'Completed' : 'Ongoing',
				...(prog ? { latestChapter: parseInt(prog[1], 10) } : {})
			});
		});

		console.log(`[zirus] catalog n=${ordered.length}`);
		return ordered;
	}

	async searchManga(
		query: string,
		opts?: { page?: number }
	): Promise<Manga[]> {
		const q = (query || '').trim().toLowerCase();
		const page = Math.max(1, opts?.page ?? 1);
		if (!q) return this.getLatestManga(page);

		try {
			const all = this.parseSeriesCatalog(await this.fetchHtml('/series'));
			const filtered = all.filter(
				(m) =>
					m.title.toLowerCase().includes(q) ||
					m.id.toLowerCase().includes(q)
			);
			console.log(`[zirus] search "${q}" n=${filtered.length}`);
			return filtered.slice(0, PER_PAGE);
		} catch (e) {
			console.error('[zirus] search', e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = pathOnly(mangaId);
		const sid = seriesIdFromPath(path);
		if (!sid) throw new Error('Invalid series id');
		path = sid;
		const code = seriesCode(path);

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);
		const next = parseNextData(html);

		let title =
			cleanText($('h1').first().text()) ||
			cleanText(
				$('meta[property="og:title"]')
					.attr('content')
					?.split(/\s*[|\-–]\s*/)[0] || ''
			);
		title = title
			.replace(/\s*[|\-–]\s*Ziru.*$/i, '')
			.replace(/<!--.*?-->/g, '')
			.trim();
		if (!title) title = code.toUpperCase();

		let cover =
			$('meta[property="og:image"]').attr('content') ||
			$('img[alt*="Cover" i], img[src*="/images/"]').attr('src') ||
			'';
		cover = absUrl(String(cover).split('?')[0]);
		if (!cover || /headers\//i.test(cover)) cover = coverFor(code);

		const authors: string[] = [];
		$('a[href*="kakuyomu"], a[href*="syosetu"]').each((_, a) => {
			const n = cleanText($(a).text());
			if (n && n.length < 80 && !authors.includes(n)) authors.push(n);
		});
		const byMatch = cleanText($('body').text()).match(/By\s+([^\n]{2,60})/);
		if (byMatch) {
			const n = cleanText(byMatch[1]);
			if (n && !authors.includes(n)) authors.unshift(n);
		}

		let description = '';
		$('p').each((_, el) => {
			const t = cleanText($(el).text());
			if (t.length > 80 && description.length < 40) {
				description = t.slice(0, 4000);
			}
		});
		if (description.length < 40) {
			description = cleanText(
				$('meta[property="og:description"]').attr('content') || ''
			);
		}

		const bodyText = cleanText($('body').text());
		let status = 'Ongoing';
		if (/\bcomplete\b/i.test(bodyText.slice(0, 2000))) status = 'Completed';

		let chapters = this.parseChaptersFromNext(next, code);
		if (chapters.length === 0) {
			chapters = this.parseChapterListDom($, code);
		}

		console.log(`[zirus] details ${path} → ${chapters.length} ch`);

		return {
			id: path,
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
			...(chapters.length ? { latestChapter: chapters[0]?.number } : {})
		};
	}

	private parseChaptersFromNext(next: any, code: string): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();
		const volumes: any[] =
			next?.props?.pageProps?.data?.volumes ||
			next?.props?.pageProps?.volumes ||
			[];

		for (const vol of volumes) {
			const chs: any[] = vol?.chapters || [];
			for (const ch of chs) {
				const chNum = parseFloat(String(ch.chapter ?? ch.number ?? 0));
				if (!chNum || chNum <= 0) continue;
				const id = `/series/${code}/${chNum}`;
				if (seen.has(id)) continue;
				seen.add(id);

				let date: string | undefined;
				if (ch.published) {
					const ts = Date.parse(ch.published);
					if (!Number.isNaN(ts)) date = new Date(ts).toISOString();
				}

				out.push({
					id,
					title: `Chapter ${chNum}`,
					number: chNum,
					...(date ? { date } : {})
				});
			}
		}

		out.sort((a, b) => b.number - a.number);
		return out;
	}

	private parseChapterListDom(
		$: cheerio.CheerioAPI,
		code: string
	): Chapter[] {
		const out: Chapter[] = [];
		const seen = new Set<string>();

		$(`a[href*="/series/${code}/"]`).each((_, a) => {
			const href = $(a).attr('href') || '';
			const p = pathOnly(href);
			const m = p.match(
				new RegExp(`^/series/${code}/(\\d+)(?:/(\\d+))?$`, 'i')
			);
			if (!m) return;
			if (seen.has(p)) return;
			const number = parseFloat(m[2] || m[1]);
			if (!number) return;
			seen.add(p);
			out.push({ id: p, title: `Chapter ${number}`, number });
		});

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
		const path = pathOnly(chapterId);
		if (!path.startsWith('/series/')) {
			throw new Error('Invalid chapter path');
		}

		const html = await this.fetchHtml(path);
		const $ = cheerio.load(html);

		const number = parseChapterNumber(path, 0);
		const title = number > 0 ? `Chapter ${number}` : 'Chapter';

		$(
			'nav, header, footer, script, style, noscript, form, .comments, #comments'
		).remove();

		const parts: string[] = [];
		const pushP = (t: string) => {
			if (!t || t.length < 2) return;
			if (
				/^(translator|released|patreon|sign in|become a patron|loading comments|prev|next|arc\s*\d)/i.test(
					t
				)
			)
				return;
			if (/zirusmusings\.net/i.test(t) && t.length < 60) return;
			parts.push(`<p>${escapeHtml(t)}</p>`);
		};

		const $main = $(
			'article, main, #main-content, .chapter-content'
		).first();
		const scope = $main.length ? $main : $('body');
		scope.find('p').each((_, el) => {
			pushP(cleanText($(el).text()));
		});

		if (parts.length < 3) {
			const bodyText = cleanText($('body').text());
			const start = Math.max(
				0,
				bodyText.search(/Released\s+[A-Z][a-z]+\s+\d+/i)
			);
			const chunk = bodyText
				.slice(start)
				.replace(/^Released[^\n]*/i, '')
				.split(/Loading comments|0 0 0 0 0|Become a Patron/i)[0];
			chunk.split(/\n+/).forEach((line) => pushP(line.trim()));
		}

		const content =
			parts.length > 0
				? parts.join('\n')
				: '<p><em>Empty content — may require Patreon.</em></p>';

		const codeMatch = path.match(
			/^\/series\/([a-z0-9-]+)\/(\d+)(?:\/(\d+))?$/i
		);
		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		if (codeMatch) {
			const code = codeMatch[1];
			const n = parseFloat(codeMatch[3] || codeMatch[2]);
			if (n > 1) prevChapterId = `/series/${code}/${n - 1}`;
			nextChapterId = `/series/${code}/${n + 1}`;
		}

		$('a[href*="/series/"]').each((_, a) => {
			const t = cleanText($(a).text()).toLowerCase();
			const full = pathOnly($(a).attr('href') || '');
			if (!/^\/series\//i.test(full)) return;
			if (/^prev/i.test(t) || t === '←') prevChapterId = full;
			if (/^next/i.test(t) || t === '→') nextChapterId = full;
		});

		console.log(`[zirus] chapter ${path} → ${parts.length}p`);

		return { title, content, prevChapterId, nextChapterId };
	}
}

export default ZirusMusingsSource;
