/**
 * Null Translation (nulltranslation.com)
 * Path: scraper/src/sources/impl/NullTranslation.ts
 *
 * Novel source — English fan translations (Next.js App Router / RSC).
 *
 * URL pattern:
 *   Releases : /releases
 *   Book     : /book/{bookId}
 *   Chapter  : /book/{bookId}/chapter/{chId}
 *
 * Cover CDN:
 *   https://cdn.nulltranslation.com/null-translation-cms-cover-images/{Name}.jpg
 *
 * Chapter body:
 *   - Embedded in RSC flight as base64 AES-GCM blob
 *   - Key from GET /api/chapter/key → { key: base64 } (no auth required)
 *   - Decrypt: iv = first 12 bytes, ciphertext+tag = rest, AES-256-GCM
 *
 * Frontend id: nulltranslation
 */
import * as cheerio from 'cheerio';
import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails, Chapter } from '../types';

const BASE = 'https://nulltranslation.com';
const COVER_CDN = 'https://cdn.nulltranslation.com/null-translation-cms-cover-images';

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

function unescapeRsc(html: string): string {
	return html.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function extractBalanced(s: string, start: number): string | null {
	const open = s[start];
	if (open !== '{' && open !== '[') return null;
	const close = open === '{' ? '}' : ']';
	let depth = 0;
	let inStr = false;
	let esc = false;
	for (let i = start; i < s.length && i < start + 500000; i++) {
		const c = s[i];
		if (inStr) {
			if (esc) esc = false;
			else if (c === '\\') esc = true;
			else if (c === '"') inStr = false;
			continue;
		}
		if (c === '"') {
			inStr = true;
			continue;
		}
		if (c === open) depth++;
		else if (c === close) {
			depth--;
			if (depth === 0) return s.slice(start, i + 1);
		}
	}
	return null;
}

function parseJsonSlice<T>(s: string, start: number): T | null {
	const slice = extractBalanced(s, start);
	if (!slice) return null;
	try {
		return JSON.parse(slice) as T;
	} catch {
		return null;
	}
}

type NtChapter = {
	id: string;
	bookId?: string;
	title?: string;
	chapterNumber?: number;
	releaseDateTime?: string;
	volume?: number;
};

type NtBook = {
	id: string;
	title?: string;
	author?: string;
	numChapters?: number;
	translationStatus?: string;
	rawStatus?: string;
	releaseDate?: string;
	copyrighted?: boolean;
	numViews?: number;
};

function titleToCoverFilename(title: string): string {
	return title
		.trim()
		.replace(/\s+/g, '_')
		.replace(/[^\w\-_[\]'.&!]+/g, '');
}

function guessCoverFromTitle(title: string): string {
	if (!title) return '';
	const base = titleToCoverFilename(title);
	if (!base) return '';
	return `${COVER_CDN}/${base}.jpg`;
}

function resolveCoverFromHtml(html: string, unesc: string, title?: string): string {
	const m =
		unesc.match(
			/https:\/\/cdn\.nulltranslation\.com\/null-translation-cms-cover-images\/[^"\\]+\.(?:jpg|jpeg|png|webp)/i
		) ||
		html.match(
			/https:\/\/cdn\.nulltranslation\.com\/null-translation-cms-cover-images\/[^"\\&]+\.(?:jpg|jpeg|png|webp)/i
		);
	if (m) return m[0].replace(/\\+$/, '').split('&')[0];
	const m2 = html.match(
		/url=(https%3A%2F%2Fcdn\.nulltranslation\.com%2Fnull-translation-cms-cover-images%2F[^&"']+)/i
	);
	if (m2) {
		try {
			return decodeURIComponent(m2[1]);
		} catch {
			/* ignore */
		}
	}
	if (title) return guessCoverFromTitle(title);
	return '';
}

function normalizeStatus(s?: string): string {
	const v = (s || '').toUpperCase();
	if (v.includes('COMPLETE') || v.includes('FINISHED')) return 'Completed';
	if (v.includes('HIATUS')) return 'Hiatus';
	if (v.includes('DROP')) return 'Dropped';
	return 'Ongoing';
}

function isFutureRelease(iso?: string): boolean {
	if (!iso) return false;
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return false;
	return t > Date.now();
}

function mapChapters(list: NtChapter[], bookId: string): Chapter[] {
	const out: Chapter[] = [];
	const seen = new Set<string>();
	for (const ch of list) {
		if (!ch?.id) continue;
		const num = Number(ch.chapterNumber ?? 0);
		const id = `/book/${bookId}/chapter/${ch.id}`;
		if (seen.has(id)) continue;
		seen.add(id);
		const locked = isFutureRelease(ch.releaseDateTime);
		out.push({
			id,
			title: `Chapter ${num}`,
			number: num,
			date: ch.releaseDateTime || undefined,
			...(locked ? { isLocked: true } : {})
		});
	}
	out.sort((a, b) => {
		if (b.number !== a.number) return b.number - a.number;
		return (b.date || '').localeCompare(a.date || '');
	});
	return out;
}

function extractChaptersIn(unesc: string): NtChapter[] {
	const key = '"chaptersIn":';
	const idx = unesc.indexOf(key);
	if (idx < 0) return [];
	const arrStart = unesc.indexOf('[', idx + key.length - 1);
	if (arrStart < 0) return [];
	const arr = parseJsonSlice<NtChapter[]>(unesc, arrStart);
	return Array.isArray(arr) ? arr : [];
}

function extractBookMeta(unesc: string, bookId: string): NtBook | null {
	const needle = `"id":"${bookId}"`;
	let from = 0;
	while (from < unesc.length) {
		const idx = unesc.indexOf(needle, from);
		if (idx < 0) break;
		let start = idx;
		while (start > 0 && unesc[start] !== '{') start--;
		if (unesc[start] === '{') {
			const obj = parseJsonSlice<NtBook>(unesc, start);
			if (obj?.id === bookId && (obj.title || obj.numChapters != null)) return obj;
		}
		from = idx + needle.length;
	}
	return null;
}

function extractDescription(unesc: string): string {
	const matches = [...unesc.matchAll(/"description":"((?:[^"\\]|\\.)*)"/g)];
	const texts = matches
		.map((m) => {
			try {
				return JSON.parse(`"${m[1]}"`) as string;
			} catch {
				return m[1];
			}
		})
		.map((t) => cleanText(t))
		.filter((t) => t.length > 20);
	texts.sort((a, b) => b.length - a.length);
	return texts[0] || '';
}

function extractGenresTags(unesc: string): string[] {
	const out: string[] = [];
	for (const m of unesc.matchAll(/\/all\?genre=([A-Za-z0-9+\-%]+)/g)) {
		const g = decodeURIComponent(m[1].replace(/\+/g, ' '));
		if (g && !out.includes(g)) out.push(g);
	}
	const tIdx = unesc.indexOf('"tags":[');
	if (tIdx >= 0) {
		const arrStart = unesc.indexOf('[', tIdx);
		const arr = parseJsonSlice<string[]>(unesc, arrStart);
		if (Array.isArray(arr)) {
			for (const t of arr) {
				const s = cleanText(String(t));
				if (s && !out.includes(s)) out.push(s);
			}
		}
	}
	return out.slice(0, 30);
}

function extractEncryptedBase64(html: string): string | null {
	const unesc = unescapeRsc(html);
	const matches = [...unesc.matchAll(/["']([A-Za-z0-9+/]{500,}={0,2})["']/g)].map((m) => m[1]);
	const rawMatches = [...html.matchAll(/([A-Za-z0-9+/]{500,}={0,2})/g)].map((m) => m[1]);
	const all = [...matches, ...rawMatches];
	if (!all.length) return null;
	all.sort((a, b) => b.length - a.length);
	return all[0];
}

function b64ToBytes(b64: string): Uint8Array {
	// Prefer atob (Workers / browsers); fallback for Node without @types/node
	const atobFn =
		typeof atob === 'function'
			? atob
			: (s: string) => {
					const chars =
						'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
					const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
					let str = '';
					for (let i = 0; i < clean.length; i += 4) {
						const a = chars.indexOf(clean[i]);
						const b = chars.indexOf(clean[i + 1]);
						const c = chars.indexOf(clean[i + 2]);
						const d = chars.indexOf(clean[i + 3]);
						const n = (a << 18) | (b << 12) | ((c & 63) << 6) | (d & 63);
						str += String.fromCharCode((n >> 16) & 255);
						if (c !== -1 && clean[i + 2] !== '=') str += String.fromCharCode((n >> 8) & 255);
						if (d !== -1 && clean[i + 3] !== '=') str += String.fromCharCode(n & 255);
					}
					return str;
				};
	const bin = atobFn(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

async function getSubtle(): Promise<SubtleCrypto> {
	const g = globalThis as any;
	if (g.crypto?.subtle) return g.crypto.subtle as SubtleCrypto;
	try {
		// Node 19+ / some runtimes
		const mod = await (Function('return import("node:crypto")')() as Promise<any>);
		if (mod?.webcrypto?.subtle) return mod.webcrypto.subtle as SubtleCrypto;
	} catch {
		/* ignore */
	}
	throw new Error('WebCrypto subtle not available');
}

/** AES-256-GCM: iv = first 12 bytes, rest = ciphertext||tag */
async function decryptChapterBody(encryptedB64: string, keyB64: string): Promise<string> {
	const subtle = await getSubtle();
	const keyBytes = b64ToBytes(keyB64);
	const data = b64ToBytes(encryptedB64);
	if (data.length < 13) throw new Error('Encrypted payload too short');
	const iv = data.slice(0, 12);
	const ct = data.slice(12);
	const cryptoKey = await subtle.importKey(
		'raw',
		toArrayBuffer(keyBytes),
		'AES-GCM',
		false,
		['decrypt']
	);
	const plain = await subtle.decrypt(
		{ name: 'AES-GCM', iv: toArrayBuffer(iv) },
		cryptoKey,
		toArrayBuffer(ct)
	);
	return new TextDecoder('utf-8').decode(plain);
}

function textToHtmlParagraphs(text: string): string {
	const cleaned = text
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.replace(/=====+/g, '')
		.trim();
	const parts = cleaned
		.split(/\n{2,}/)
		.map((p) => p.replace(/\n+/g, ' ').trim())
		.filter(Boolean);
	if (parts.length <= 1 && cleaned.includes('\n')) {
		return cleaned
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean)
			.map((l) => `<p>${escapeHtml(l)}</p>`)
			.join('\n');
	}
	return parts.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export class NullTranslationSource extends BaseSource {
	id = 'nulltranslation';
	name = 'Null Translation';
	baseUrl = BASE;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${BASE}/`
	};

	async getLatestManga(page = 1): Promise<Manga[]> {
		const pageNum = Math.max(1, page);
		const pageSize = 24;

		const byId = new Map<string, Manga>();

		// 1) Homepage RSC embeds a larger catalog of book objects
		try {
			const home = await this.fetchHtml('/');
			for (const m of this.parseRscBookCards(home)) {
				byId.set(m.id, m);
			}
		} catch {
			/* ignore */
		}

		// 2) /releases — best for latestChapter badges + extra titles
		try {
			const rel = await this.fetchHtml('/releases');
			for (const m of this.parseReleasesList(rel)) {
				const prev = byId.get(m.id);
				if (!prev) {
					byId.set(m.id, m);
				} else {
					// merge badge / prefer non-empty latestChapter
					byId.set(m.id, {
						...prev,
						latestChapter: m.latestChapter ?? prev.latestChapter,
						cover: prev.cover || m.cover,
						title: prev.title || m.title
					});
				}
			}
		} catch {
			/* ignore */
		}

		const list = [...byId.values()];
		// Prefer items with latestChapter first (more "fresh"), then title
		list.sort((a, b) => {
			const la = Number(a.latestChapter ?? 0) || 0;
			const lb = Number(b.latestChapter ?? 0) || 0;
			if (lb !== la) return lb - la;
			return (a.title || '').localeCompare(b.title || '');
		});

		const startIdx = (pageNum - 1) * pageSize;
		return list.slice(startIdx, startIdx + pageSize);
	}

	/**
	 * Homepage (and similar) embeds book objects in RSC:
	 *   "id":"…","title":"…","titleRaw":"…" … "numChapters":N
	 */
	private parseRscBookCards(html: string): Manga[] {
		const unesc = unescapeRsc(html);
		const out: Manga[] = [];
		const seen = new Set<string>();

		const re =
			/"id":"([A-Za-z0-9_-]+)","title":"([^"]+)","titleRaw":"([^"]*)","author":"([^"]*)"/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(unesc)) !== null) {
			const bookId = m[1];
			const id = `/book/${bookId}`;
			if (seen.has(id)) continue;
			seen.add(id);

			const title = cleanText(m[2]);
			if (!title || title.length < 2) continue;

			// numChapters in the following ~2KB
			const window = unesc.slice(m.index, m.index + 2500);
			const nc = window.match(/"numChapters":(\d+)/);
			const latestChapter = nc ? parseInt(nc[1], 10) : undefined;

			// status if present
			const st = window.match(/"translationStatus":"([^"]+)"/);
			const status = normalizeStatus(st?.[1]);

			out.push({
				id,
				title,
				cover: guessCoverFromTitle(title),
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status,
				...(latestChapter != null && latestChapter > 0 ? { latestChapter } : {})
			});
		}

		// Also pick up CDN covers mapped by filename ≈ title
		return out;
	}

	/** Parse /releases HTML → Manga[] with latestChapter from Ch. N badges */
	private parseReleasesList(html: string): Manga[] {
		const $ = cheerio.load(html);
		const out: Manga[] = [];
		const seen = new Set<string>();

		const latestByBook = new Map<string, number>();
		const re = /\/book\/([A-Za-z0-9_-]+)(?!\/chapter)[\s\S]{0,3000}?Ch\.\s*(\d+)/gi;
		let m: RegExpExecArray | null;
		while ((m = re.exec(html)) !== null) {
			const bid = m[1];
			const n = parseInt(m[2], 10);
			if (!Number.isFinite(n)) continue;
			const prev = latestByBook.get(bid);
			if (prev == null || n > prev) latestByBook.set(bid, n);
		}

		$('a[href*="/book/"]').each((_: number, el: any) => {
			const href = $(el).attr('href') || '';
			if (!href || /\/chapter\//i.test(href)) return;
			const mm = href.match(/\/book\/([A-Za-z0-9_-]+)/);
			if (!mm) return;
			const bookId = mm[1];
			const id = `/book/${bookId}`;
			if (seen.has(id)) return;

			let title = cleanText($(el).text());
			if (!title || /^ch\.?\s*\d+/i.test(title) || title.length < 2) {
				title = cleanText($(el).attr('title') || '');
			}
			const imgAlt = cleanText($(el).find('img').attr('alt') || '');
			if (imgAlt && (title.length < 2 || /^ch\.?\s*\d+/i.test(title))) title = imgAlt;
			if (!title || title.length < 2 || /^ch\.?\s*\d+/i.test(title)) return;
			if (
				/^(all|releases|genres|tags|authors|home|discover|login|by book|by date)$/i.test(
					title
				)
			) {
				return;
			}

			seen.add(id);
			const latestChapter = latestByBook.get(bookId);

			out.push({
				id,
				title,
				cover: guessCoverFromTitle(title),
				sourceId: this.id,
				type: 'novel',
				lang: 'en',
				status: 'Ongoing',
				...(latestChapter != null ? { latestChapter } : {})
			});
		});

		return out;
	}

	async searchManga(query: string, _opts?: { page?: number }): Promise<Manga[]> {
		const q = query.trim().toLowerCase();
		if (!q) return [];
		const byId = new Map<string, Manga>();
		try {
			const home = await this.fetchHtml('/');
			for (const m of this.parseRscBookCards(home)) byId.set(m.id, m);
		} catch {
			/* ignore */
		}
		try {
			const rel = await this.fetchHtml('/releases');
			for (const m of this.parseReleasesList(rel)) {
				if (!byId.has(m.id)) byId.set(m.id, m);
			}
		} catch {
			/* ignore */
		}
		return [...byId.values()]
			.filter((m) => m.title.toLowerCase().includes(q))
			.slice(0, 24);
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		if (!path.includes('/book/')) {
			path = `/book${path.startsWith('/') ? path : `/${path}`}`;
		}
		path = path.replace(/\/$/, '');

		const bookIdMatch = path.match(/\/book\/([A-Za-z0-9_-]+)/);
		const bookId = bookIdMatch?.[1] || '';
		if (!bookId) throw new Error(`NullTranslation: invalid manga id ${mangaId}`);

		const html = await this.fetchHtml(`/book/${bookId}`);
		const unesc = unescapeRsc(html);

		const book = extractBookMeta(unesc, bookId);
		const chaptersRaw = extractChaptersIn(unesc);
		const chapters = mapChapters(chaptersRaw, bookId);

		const $ = cheerio.load(html);
		const title =
			book?.title ||
			cleanText($('h1').first().text() || $('title').text().split(/[|\-–]/)[0]) ||
			bookId;

		const cover = resolveCoverFromHtml(html, unesc, title);
		const description = extractDescription(unesc);
		const genres = extractGenresTags(unesc);
		const authors: string[] = book?.author ? [book.author] : [];

		if (!authors.length) {
			$('a[href*="author="]').each((_: number, el: any) => {
				const t = cleanText($(el).text());
				if (t && !authors.includes(t)) authors.push(t);
			});
		}

		if (!chapters.length && !title) {
			throw new Error(`NullTranslation: empty detail for ${bookId} (RSC parse failed)`);
		}

		return {
			id: `/book/${bookId}`,
			title,
			cover: cover || guessCoverFromTitle(title),
			sourceId: this.id,
			description,
			authors,
			status: normalizeStatus(book?.translationStatus || book?.rawStatus),
			genres,
			chapters,
			type: 'novel',
			lang: 'en',
			...(chapters.length ? { latestChapter: chapters[0]?.number } : {})
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
		let path = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
		path = path.replace(/\/$/, '');
		const m = path.match(/\/book\/([A-Za-z0-9_-]+)\/chapter\/([A-Za-z0-9_-]+)/);
		if (!m) throw new Error(`NullTranslation: invalid chapter id ${chapterId}`);
		const bookId = m[1];
		const chId = m[2];

		const html = await this.fetchHtml(`/book/${bookId}/chapter/${chId}`);
		const unesc = unescapeRsc(html);
		const $ = cheerio.load(html);

		let title = '';
		const chNeedle = `"id":"${chId}"`;
		const cIdx = unesc.indexOf(chNeedle);
		if (cIdx >= 0) {
			let start = cIdx;
			while (start > 0 && unesc[start] !== '{') start--;
			const obj = parseJsonSlice<NtChapter>(unesc, start);
			if (obj?.title) title = cleanText(obj.title);
		}
		if (!title) {
			const h1 = cleanText($('h1').first().text());
			if (h1 && !/yemen runners|click the wand|null translation/i.test(h1)) {
				title = h1;
			}
		}
		if (!title) title = `Chapter ${chId}`;

		let prevChapterId: string | null = null;
		let nextChapterId: string | null = null;
		$('a[href*="/chapter/"]').each((_: number, el: any) => {
			const t = cleanText($(el).text()).toLowerCase();
			const href = pathOnly($(el).attr('href') || '');
			if (/^prev|previous/.test(t)) prevChapterId = href;
			if (/^next/.test(t)) nextChapterId = href;
		});

		const encB64 = extractEncryptedBase64(html);
		if (!encB64) {
			throw new Error(`NullTranslation: no encrypted chapter blob found for ${path}`);
		}

		const keyRes = await fetch(`${BASE}/api/chapter/key`, {
			headers: {
				...this.headers,
				Accept: 'application/json',
				Referer: `${BASE}/book/${bookId}/chapter/${chId}`
			}
		});
		if (!keyRes.ok) {
			throw new Error(`NullTranslation: failed to fetch chapter key (${keyRes.status})`);
		}
		const keyJson = (await keyRes.json()) as { key?: string };
		if (!keyJson?.key) {
			throw new Error('NullTranslation: chapter key missing in response');
		}

		let plain: string;
		try {
			plain = await decryptChapterBody(encB64, keyJson.key);
		} catch (e) {
			throw new Error(
				`NullTranslation: AES-GCM decrypt failed — ${e instanceof Error ? e.message : e}`
			);
		}

		const htmlContent = textToHtmlParagraphs(plain);
		if (htmlContent.length < 40) {
			throw new Error('NullTranslation: decrypted content too short');
		}

		return {
			title,
			content: htmlContent,
			prevChapterId,
			nextChapterId
		};
	}
}

export default NullTranslationSource;
