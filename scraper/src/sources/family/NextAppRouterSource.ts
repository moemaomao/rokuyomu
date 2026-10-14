/**
 * Family base: Next.js **App Router** sites (bukan Pages Router `_next/data`).
 *
 * Ciri site:
 *   - /_next/static/chunks/main-app-*.js
 *   - /_next/static/chunks/app/...
 *   - meta next-size-adjust
 *   - TIDAK ada __NEXT_DATA__ / /_next/data/{buildId}/
 *
 * Data biasanya:
 *   - HTML SSR + cheerio, dan/atau
 *   - payload tertanam di HTML (RSC flight / serialized props)
 *
 * Path: scraper/src/sources/family/NextAppRouterSource.ts
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types-manga';

export abstract class NextAppRouterSource extends BaseSource {
	protected perPage = 24;
	protected defaultLang = 'en';

	protected cleanId(link: string): string {
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

	protected absUrl(url: string): string {
		if (!url) return '';
		if (url.startsWith('http')) return url;
		if (url.startsWith('//')) return `https:${url}`;
		return `${this.baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
	}

	protected cleanUrl(url: string): string {
		if (!url) return '';
		return url
			.replace(/\\u0026/gi, '&')
			.replace(/&amp;/g, '&')
			.replace(/\\"/g, '"')
			.replace(/\\\//g, '/')
			.trim();
	}

	protected cleanText(s: string): string {
		return (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
	}

	protected slugToTitle(slug: string): string {
		return slug
			.split('-')
			.map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
			.join(' ')
			.trim();
	}

	protected parseChapterNumber(text: string, path = ''): number {
		const fromPath =
			path.match(/\/chapter\/(\d+)(?:[.-](\d+))?/i) ||
			path.match(/(?:ch|chapter)[_-]?(\d+)(?:[.-](\d+))?/i) ||
			path.match(/-(\d+)(?:[.-](\d+))?\/?$/i);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null && fromPath[2].length <= 2) {
				return parseFloat(`${major}.${fromPath[2]}`);
			}
			return major;
		}
		const m = String(text).match(/(?:chapter|chap|ch\.?)\s*(\d+)(?:[.,](\d+))?/i);
		if (m) {
			if (m[2] != null) return parseFloat(`${m[1]}.${m[2]}`);
			return parseInt(m[1], 10);
		}
		const n = String(text).match(/\b(\d+(?:\.\d+)?)\b/);
		return n ? parseFloat(n[1]) : NaN;
	}

	protected mapStatus(raw?: string | null): string {
		const s = String(raw || '').toLowerCase();
		if (/complet|tamat|selesai|finish|end/.test(s)) return 'Completed';
		if (/hiatus/.test(s)) return 'Hiatus';
		if (/drop|cancel/.test(s)) return 'Cancelled';
		return 'Ongoing';
	}

	protected mapType(raw?: string | null, countryOrFlag?: string | null): string {
		const t = String(raw || '').toLowerCase();
		if (t.includes('manhwa')) return 'manhwa';
		if (t.includes('manhua')) return 'manhua';
		if (t.includes('manga')) return 'manga';
		const c = String(countryOrFlag || '').toLowerCase();
		if (/\/kr\.|korea|\bkr\b/.test(c)) return 'manhwa';
		if (/\/cn\.|\/tw\.|china|\bcn\b/.test(c)) return 'manhua';
		if (/\/jp\.|japan|\bjp\b/.test(c)) return 'manga';
		return 'manga';
	}

	protected extractNearSlug(
		html: string,
		slug: string,
		window = 4000
	): string {
		const markers = [`"slug":"${slug}"`, `\\"slug\\":\\"${slug}\\"`];
		let idx = -1;
		for (const m of markers) {
			idx = html.indexOf(m);
			if (idx >= 0) break;
		}
		if (idx < 0) return '';
		return html.slice(Math.max(0, idx - 500), Math.min(html.length, idx + window));
	}

	protected pickJsonString(chunk: string, key: string): string {
		const m = chunk.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
		if (!m) return '';
		return m[1]
			.replace(/\\n/g, '\n')
			.replace(/\\"/g, '"')
			.replace(/\\u0026/gi, '&')
			.replace(/\\\//g, '/');
	}

	protected pickJsonNumber(chunk: string, key: string): number | null {
		const m = chunk.match(new RegExp(`"${key}"\\s*:\\s*(\\d+(?:\\.\\d+)?|"\\d+")`));
		if (!m) return null;
		return parseFloat(m[1].replace(/"/g, ''));
	}

	protected pickJsonStringArray(chunk: string, arrayKey: string, nameKey = 'name'): string[] {
		const gBlock = chunk.match(new RegExp(`"${arrayKey}"\\s*:\\s*\\[([\\s\\S]*?)\\]`));
		if (!gBlock) return [];
		const out: string[] = [];
		const re = new RegExp(`"${nameKey}"\\s*:\\s*"([^"]+)"`, 'g');
		for (const n of gBlock[1].matchAll(re)) {
			if (!out.includes(n[1])) out.push(n[1]);
		}
		return out;
	}

	protected extractImageUrls(
		html: string,
		hostOrPattern: RegExp,
		opts?: { skip?: RegExp }
	): string[] {
		const skip = opts?.skip || /logo|icon|avatar|ads|banner|emoji|spinner/i;
		const out: string[] = [];
		const seen = new Set<string>();
		const re = hostOrPattern.flags.includes('g')
			? hostOrPattern
			: new RegExp(hostOrPattern.source, hostOrPattern.flags + 'g');
		for (const m of html.matchAll(re)) {
			const src = this.cleanUrl(m[0]);
			if (!src || seen.has(src) || skip.test(src)) continue;
			seen.add(src);
			out.push(src);
		}
		return out;
	}

	protected load$(html: string): cheerio.CheerioAPI {
		return cheerio.load(html);
	}

	protected dedupeById<T extends { id: string }>(items: T[]): T[] {
		const seen = new Set<string>();
		const out: T[] = [];
		for (const it of items) {
			if (!it?.id || seen.has(it.id)) continue;
			seen.add(it.id);
			out.push(it);
		}
		return out;
	}

	protected paginate<T>(items: T[], page: number): T[] {
		const p = Math.max(1, page || 1);
		const start = (p - 1) * this.perPage;
		return items.slice(start, start + this.perPage);
	}

	abstract getLatestManga(page: number): Promise<Manga[]>;
	abstract searchManga(query: string, opts?: { page?: number }): Promise<Manga[]>;
	abstract getMangaDetails(mangaId: string): Promise<MangaDetails>;
	abstract getChapterPages(chapterId: string): Promise<string[]>;
}
