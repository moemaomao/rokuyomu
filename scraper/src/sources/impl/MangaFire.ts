/**
 * MangaFire adapter (https://mangafire.to)
 *
 * /api/titles* butuh VRF. /api/top-titles TIDAK butuh VRF → fallback Workers
 * (IP datacenter Cloudflare sering kena WAF MangaFire).
 *
 * List/Latest : GET /api/titles?order[chapter_updated_at]=desc
 *               fallback → /api/top-titles?type=trending|new
 * Search      : GET /api/titles?keyword=
 * Detail      : GET /api/titles/{hid}
 * Chapters    : GET /api/titles/{hid}/chapters?language=
 * Pages       : GET /api/chapters/{id} → data.pages[].url
 *
 * ID: manga "/title/{hid}" | chapter "/title/{hid}/chapter/{id}"
 *
 * Fix 2026-09-21:
 * - User-Agent + sec-ch-ua modern (Chrome 128)
 * - Retry + random delay saat kena CF 403
 * - Header lebih mirip browser asli
 * - rawGet support attempt untuk ganti UA
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';

export class MangaFireSource extends BaseSource {
	id = 'mangafire';
	name = 'MangaFire';
	baseUrl = 'https://mangafire.to';

	private readonly PER_PAGE = 24;
	private readonly DEFAULT_LANG = 'en';
	private readonly SUPPORTED_LANGS = new Set([
		'en',
		'es',
		'es-la',
		'fr',
		'ja',
		'pt',
		'pt-br'
	]);

	private static readonly B64_CHARS =
		'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

	private b64Decode(s: string): Uint8Array {
		const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
		const len = clean.length;
		const outLen = ((len * 3) / 4) | 0;
		const out = new Uint8Array(outLen);
		const table = new Uint8Array(128);
		for (let i = 0; i < MangaFireSource.B64_CHARS.length; i++) {
			table[MangaFireSource.B64_CHARS.charCodeAt(i)] = i;
		}
		let p = 0;
		for (let i = 0; i < len; i += 4) {
			const a = table[clean.charCodeAt(i)] ?? 0;
			const b = table[clean.charCodeAt(i + 1)] ?? 0;
			const c = table[clean.charCodeAt(i + 2)] ?? 0;
			const d = table[clean.charCodeAt(i + 3)] ?? 0;
			out[p++] = (a << 2) | (b >> 4);
			if (p < outLen) out[p++] = ((b & 15) << 4) | (c >> 2);
			if (p < outLen) out[p++] = ((c & 3) << 6) | d;
		}
		return out;
	}

	private b64EncodeUrl(bytes: Uint8Array): string {
		const chars = MangaFireSource.B64_CHARS;
		let out = '';
		for (let i = 0; i < bytes.length; i += 3) {
			const a = bytes[i]!;
			const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
			const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
			out += chars[a >> 2];
			out += chars[((a & 3) << 4) | (b >> 4)];
			out += i + 1 < bytes.length ? chars[((b & 15) << 2) | (c >> 6)] : '';
			out += i + 2 < bytes.length ? chars[c & 63] : '';
		}
		return out.replace(/\+/g, '-').replace(/\//g, '_');
	}

	private vrfStages: Array<{ table: Uint8Array; key: Uint8Array; iv: number }> | null =
		null;

	private getVrfStages() {
		if (this.vrfStages) return this.vrfStages;
		this.vrfStages = [
			{
				table: this.b64Decode(
					'yINlmUNho8VYJT+ibTIP+9ESiULpVEtMOoD6U6lRE0R/xwXo/Xp9NrUgC4cw/Lmo33vUyjUE40kUoEWIr/fxfNNcq2s79ShQ5NhNrFnJ4hXPwOu/SuXzIbuTQKGFvfm08E9jvCfqAtoDqvQq3dVWPQFmJjgvkISBeXY3BgANR+yVnjGbcxZ47d6kLNfZPIayTq3/YGySb1KuVZodWp/WGNAO5pfMcpaK53Hhs0allBszaMaxuouOwdxbwgxIw6YunSsXjI05Yi0j9j4eHKfSXR8Ifo/Od+8iamRfCXTyvm7NGRGYdcQ0ywcK/u6RXhrbcCm4t2eCtrDgQVecJGkQ+A=='
				),
				key: this.b64Decode('0Ec58JOY3uBzJK9m3zqIOpdlF7UFiax9DmA='),
				iv: 0x5a
			},
			{
				table: this.b64Decode(
					'IUFltCxD3Oc2cwCgkJffthaOg9cgPUb0LgW6H/VtfcF0kc5F25t+aWj6JH9VOhOaY0rAFdUxlDnl5BLNvwEJvQtP5qcw7vdb/K+chnbwnspSHT8mz5lqwz41TezG0hkO06FTjJZhsyNuFLDpD2ZZxQj/QIRcF90zpmQ7Byu483WsQqUE0C342HL+JXngRB6fRzxRyVTaKu83h7UYTJ0QMt6ixFh6S3F8gqkKwrGTL3jHNBsD45UnifK8+RGtishQV2K3rujLKEkiZxpr2dYcudFW4oFsDKhad3CLBvuyTqsCo4B7mL5IKQ1vXo/MOOvq1I1d8ar9X6Ttu5KF4fZgiA=='
				),
				key: this.b64Decode('AAdjb1iPY8CiDmq9H34tKTBF8a3oDQ=='),
				iv: 0x35
			},
			{
				table: this.b64Decode(
					'NQHlu1/wVO5EmkwQymF810qqY2xG1k2obcas4Z9mCsPEIFl9pRIjFxbJ7ybMHbBckT5Ton85E0FOeHezbh/mjlEYpmpnlXOS8dgrqeq2KfxImTh1YK9y0PeMNhzA1OQzSY9brYOJq/l2QnE/hwOeZIhPixVSKIUlDb5vLcH6RWKxkIEMuP0bDwIqQ71AJJaEaMJL7A6YtyIwoRT+L5v4aZzodN/0+3nOGsfblFjgxSfPzVDjNFeNl5P26+kEC/8AHgdrpAbt3hHz3HrRN1Y6e+JHgF7ncFWnoF0y3THL1S71WgWGCa6KtSzTCCG58n68nTyj2T3Sshk7utqCtMi/ZQ=='
				),
				key: this.b64Decode('DELOJgPsVaCcblDtTGMdHzM='),
				iv: 0xba
			}
		];
		return this.vrfStages;
	}

	private encryptStage(
		data: Uint8Array,
		table: Uint8Array,
		key: Uint8Array,
		iv: number
	): Uint8Array {
		const out = new Uint8Array(data.length);
		let prev = iv;
		const keySize = key.length;
		for (let i = 0; i < data.length; i++) {
			prev = table[(data[i]! ^ key[i % keySize]! ^ prev) & 0xff]! & 0xff;
			out[i] = prev;
		}
		return out;
	}

	private signVrf(path: string): string {
		let data: Uint8Array = new TextEncoder().encode(path);
		for (const stage of this.getVrfStages()) {
			data = this.encryptStage(data, stage.table, stage.key, stage.iv);
		}
		return this.b64EncodeUrl(data);
	}

	private buildSignedUrl(
		apiPath: string,
		params: Array<[string, string | number]> = []
	): string {
		const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
		const sorted = [...params].sort((a, b) => a[0].localeCompare(b[0]));
		let lastKey = '';
		let index = 0;
		const signedParts = sorted.map(([key, value]) => {
			let newKey = key;
			if (key.endsWith('[]')) {
				if (lastKey !== key) index = 0;
				lastKey = key;
				newKey = key.replace('[]', `[${index++}]`);
			}
			return `${newKey}=${value}`;
		});
		const toSign = path + (signedParts.length ? `?${signedParts.join('&')}` : '');
		const vrf = this.signVrf(toSign);
		const url = new URL(`${this.baseUrl}/api${path}`);
		for (const [k, v] of params) url.searchParams.append(k, String(v));
		url.searchParams.set('vrf', vrf);
		return url.toString();
	}

	/** Header mirip browser modern + support extra override per attempt */
	private reqHeaders(json = true, extra: Record<string, string> = {}): Record<string, string> {
		const ua =
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

		return {
			'User-Agent': ua,
			Accept: json
				? 'application/json, text/plain, */*'
				: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
			'Accept-Language': 'en-US,en;q=0.9',
			'Accept-Encoding': 'gzip, deflate, br',
			Origin: this.baseUrl,
			Referer: `${this.baseUrl}/`,
			'Sec-Fetch-Dest': json ? 'empty' : 'document',
			'Sec-Fetch-Mode': json ? 'cors' : 'navigate',
			'Sec-Fetch-Site': 'same-origin',
			'Sec-Fetch-User': '?1',
			'sec-ch-ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
			'sec-ch-ua-mobile': '?0',
			'sec-ch-ua-platform': '"Windows"',
			'Cache-Control': 'no-cache',
			Pragma: 'no-cache',
			...extra
		};
	}

	private async rawGet(
		url: string,
		json = true,
		attempt = 1
	): Promise<{ ok: boolean; status: number; text: string }> {
		// Ganti header sedikit di attempt ke-2 supaya tidak terlihat pola yang sama
		const extra =
			attempt > 1
				? {
						'User-Agent':
							'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
						'sec-ch-ua':
							'"Not)A;Brand";v="99", "Google Chrome";v="127", "Chromium";v="127"'
					}
				: {};

		const res = await fetch(url, {
			headers: this.reqHeaders(json, extra),
			redirect: 'follow',
			cache: 'no-store'
		});

		const text = await res.text();
		return { ok: res.ok, status: res.status, text };
	}

	private async apiGet<T = any>(
		apiPath: string,
		params: Array<[string, string | number]> = []
	): Promise<T> {
		const url = this.buildSignedUrl(apiPath, params);
		const maxAttempts = 3;
		let lastErr: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
			
				if (attempt > 1) {
					await new Promise((r) => setTimeout(r, 300 + Math.random() * 400));
				}

				const { ok, status, text } = await this.rawGet(url, true, attempt);
				const trimmed = text.trim();

				if (
					trimmed.startsWith('<') ||
					/just a moment|cf-browser-verification|challenge-platform|cf-chl/i.test(
						trimmed
					)
				) {
					lastErr = new Error(`MangaFire blocked (CF) HTTP ${status}`);
					console.error('[mangafire] CF/HTML block', apiPath, status);
					continue;
				}

				if (!ok) {
					console.error(
						`[mangafire] HTTP ${status} ${apiPath}`,
						trimmed.slice(0, 180)
					);
					if ([403, 429, 503].includes(status) && attempt < maxAttempts) {
						lastErr = new Error(`MangaFire HTTP ${status}`);
						continue;
					}
					throw new Error(`MangaFire HTTP ${status}: ${trimmed.slice(0, 120)}`);
				}

				return JSON.parse(trimmed) as T;
			} catch (e) {
				lastErr = e;
				if (attempt < maxAttempts) continue;
			}
		}

		throw lastErr instanceof Error ? lastErr : new Error('MangaFire request failed');
	}

	private async topTitles(
		kind: 'trending' | 'new' = 'trending',
		limit = 30,
		days = 7
	): Promise<any[]> {
		const url = new URL(`${this.baseUrl}/api/top-titles`);
		url.searchParams.set('type', kind);
		url.searchParams.set('days', String(days));
		url.searchParams.set('limit', String(limit));
		url.searchParams.append('genres_ex[]', '7');
		url.searchParams.append('genres_ex[]', '268929');
		url.searchParams.append('genres_ex[]', '268930');
		url.searchParams.append('genres_ex[]', '268932');

		const maxAttempts = 2;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				if (attempt > 1) {
					await new Promise((r) => setTimeout(r, 250 + Math.random() * 300));
				}

				const { ok, status, text } = await this.rawGet(
					url.toString(),
					true,
					attempt
				);

				if (!ok || text.trim().startsWith('<')) {
					console.error(
						'[mangafire] top-titles HTTP',
						status,
						text.slice(0, 100)
					);
					if (attempt < maxAttempts) continue;
					return [];
				}

				const data = JSON.parse(text) as { items?: any[] };
				return Array.isArray(data?.items) ? data.items : [];
			} catch (e) {
				console.error('[mangafire] top-titles error', e);
				if (attempt === maxAttempts) return [];
			}
		}

		return [];
	}

	private normalizeLang(lang?: string): string | null {
		const raw = String(lang || '')
			.trim()
			.toLowerCase();
		if (!raw || raw === 'all' || raw === 'any' || raw === '*') return null;
		const aliases: Record<string, string> = {
			english: 'en',
			indonesian: 'id',
			indonesia: 'id',
			bahasa: 'id',
			japanese: 'ja',
			japan: 'ja',
			korean: 'ko',
			korea: 'ko',
			chinese: 'zh',
			french: 'fr',
			spanish: 'es',
			'latin american spanish': 'es-la',
			'es-419': 'es-la',
			portuguese: 'pt',
			'brazilian portuguese': 'pt-br',
			'pt-br': 'pt-br',
			russian: 'ru',
			vietnamese: 'vi',
			thai: 'th',
			arabic: 'ar',
			german: 'de',
			italian: 'it'
		};
		if (aliases[raw]) return aliases[raw];
		if (/^[a-z]{2}(-[a-z]{2,4})?$/.test(raw)) return raw;
		return null;
	}

	private toApiLang(lang?: string | null): string {
		const n = this.normalizeLang(lang ?? undefined);
		if (!n) return this.DEFAULT_LANG;
		if (this.SUPPORTED_LANGS.has(n)) return n;
		return this.DEFAULT_LANG;
	}

	private toMangaId(hid: string): string {
		return `/title/${String(hid).replace(/^\/+|\/+$/g, '')}`;
	}

	private extractHid(mangaId: string): string {
		const parts = String(mangaId)
			.replace(/^\/+/, '')
			.split('/')
			.filter(Boolean);
		if (parts[0]?.toLowerCase() === 'title' && parts[1]) {
			return parts[1].split('-')[0] || parts[1];
		}
		return (parts[0] || '').split('-')[0] || '';
	}

	private toChapterId(hid: string, chapterId: string | number): string {
		return `/title/${hid}/chapter/${chapterId}`;
	}

	private extractChapterParts(chapterId: string): {
		hid: string;
		chapterId: string;
	} {
		const s = String(chapterId).replace(/^\/+/, '');
		const m = s.match(/^title\/([^/]+)\/chapter\/(.+)$/i);
		if (m) {
			return { hid: m[1].split('-')[0] || m[1], chapterId: m[2] };
		}
		const parts = s.split('/').filter(Boolean);
		return {
			hid: parts[0] === 'title' ? (parts[1] || '').split('-')[0] : parts[0] || '',
			chapterId: parts[parts.length - 1] || ''
		};
	}

	private mapStatus(status?: string | null): string {
		const s = String(status || '').toLowerCase();
		if (s === 'finished' || s === 'completed') return 'Completed';
		if (s === 'on_hiatus' || s === 'hiatus') return 'Hiatus';
		if (s === 'discontinued' || s === 'cancelled') return 'Cancelled';
		return 'Ongoing';
	}

	private mapType(type?: string | null): string {
		const t = String(type || '').toLowerCase();
		if (t === 'manhwa' || t === 'manhua' || t === 'manga' || t === 'other') return t;
		return t || 'manga';
	}

	private normalizeTypeFilter(type?: string | null): string | null {
		const t = String(type || '')
			.trim()
			.toLowerCase();
		if (!t || t === 'all' || t === 'any' || t === '*') return null;
		if (t === 'manga' || t === 'manhwa' || t === 'manhua' || t === 'other') return t;
		return null;
	}

	private formatDate(unix?: number | null): string {
		if (unix == null || !Number.isFinite(Number(unix))) return '';
		try {
			const ms = Number(unix) > 1e12 ? Number(unix) : Number(unix) * 1000;
			return new Date(ms).toISOString().slice(0, 10);
		} catch {
			return '';
		}
	}

	private stripHtml(html?: string | null): string {
		if (!html) return '';
		return String(html)
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/<\/p>/gi, '\n')
			.replace(/<[^>]+>/g, '')
			.replace(/&nbsp;/g, ' ')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/\s+/g, ' ')
			.trim();
	}

	private mapListItem(item: any, lang?: string | null): Manga | null {
		const hid = item?.hid;
		const title = String(item?.title || '').trim();
		if (!hid || !title) return null;

		const cover =
			item?.poster?.large || item?.poster?.medium || item?.poster?.small || '';
		const latest =
			item?.latestChapter != null && item.latestChapter !== ''
				? String(item.latestChapter)
				: undefined;
		const langCode = lang ? this.toApiLang(lang) : this.DEFAULT_LANG;

		return {
			id: this.toMangaId(hid),
			sourceId: this.id,
			title,
			cover,
			type: this.mapType(item?.type),
			status: this.mapStatus(item?.status),
			latestChapter: latest,
			lang: langCode
		} as Manga & { lang?: string };
	}

	async getLatestManga(
		page: number,
		opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		const p = Math.max(1, Number(page) || 1);
		const lang = this.normalizeLang(opts?.lang);
		const apiLang = lang ? this.toApiLang(lang) : null;
		const typeFilter = this.normalizeTypeFilter(opts?.type);

		try {
			const [trending, newest] = await Promise.all([
				this.topTitles('trending', 48, 30),
				this.topTitles('new', 48, 30)
			]);
			const seen = new Set<string>();
			const merged: any[] = [];
			for (const it of [...trending, ...newest]) {
				const hid = String(it?.hid || '');
				if (!hid || seen.has(hid)) continue;
				seen.add(hid);
				merged.push(it);
			}

			let list = merged
				.map((it) => this.mapListItem(it, apiLang))
				.filter(Boolean) as Manga[];

			if (typeFilter) {
				list = list.filter((m) => (m.type || '').toLowerCase() === typeFilter);
			}

			if (list.length > 0) {
				const start = (p - 1) * this.PER_PAGE;
				const pageList = list.slice(start, start + this.PER_PAGE);
				console.log(
					`[mangafire] latest(top) page=${p} → ${pageList.length} (pool=${list.length})`
				);
				return pageList;
			}
		} catch (e) {
			console.error('[mangafire] top-titles failed', e);
		}

		try {
			const params: Array<[string, string | number]> = [
				['order[chapter_updated_at]', 'desc'],
				['page', p],
				['limit', this.PER_PAGE],
				['content_rating[]', 'safe'],
				['content_rating[]', 'suggestive']
			];
			if (apiLang) params.push(['language[]', apiLang]);
			if (typeFilter) params.push(['types[]', typeFilter]);

			const data = await this.apiGet<{ items?: any[] }>('/titles', params);
			const list = (data?.items || [])
				.map((it) => this.mapListItem(it, apiLang))
				.filter(Boolean) as Manga[];

			console.log(
				`[mangafire] latest(api) page=${p} lang=${apiLang ?? 'all'} → ${list.length}`
			);
			return list;
		} catch (e) {
			console.error('[mangafire] getLatestManga api failed', e);
			return [];
		}
	}

	async searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page || 1);
		if (!q) return this.getLatestManga(page, opts);

		const lang = this.normalizeLang(opts?.lang);
		const apiLang = lang ? this.toApiLang(lang) : null;
		const typeFilter = this.normalizeTypeFilter(opts?.type);

		try {
			const params: Array<[string, string | number]> = [
				['keyword', q],
				['page', page],
				['limit', this.PER_PAGE],
				['content_rating[]', 'safe'],
				['content_rating[]', 'suggestive']
			];
			if (apiLang) params.push(['language[]', apiLang]);
			if (typeFilter) params.push(['types[]', typeFilter]);

			const data = await this.apiGet<{ items?: any[] }>('/titles', params);
			const list = (data?.items || [])
				.map((it) => this.mapListItem(it, apiLang))
				.filter(Boolean) as Manga[];
			console.log(`[mangafire] search "${q}" page=${page} → ${list.length}`);
			return list;
		} catch (e) {
			console.error('[mangafire] searchManga', e);
			try {
				const pool = [
					...(await this.topTitles('trending', 60, 30)),
					...(await this.topTitles('new', 60, 30))
				];
				const nq = q.toLowerCase();
				const filtered = pool.filter((it) =>
					String(it?.title || '')
						.toLowerCase()
						.includes(nq)
				);
				const list = filtered
					.map((it) => this.mapListItem(it, apiLang))
					.filter(Boolean) as Manga[];
				const start = (page - 1) * this.PER_PAGE;
				return list.slice(start, start + this.PER_PAGE);
			} catch {
				return [];
			}
		}
	}

	async getMangaDetails(
		mangaId: string,
		opts?: { lang?: string }
	): Promise<MangaDetails> {
		const hid = this.extractHid(mangaId);
		if (!hid) throw new Error(`Invalid mangafire id: ${mangaId}`);

		const apiLang = this.toApiLang(opts?.lang);
		const detail = await this.apiGet<{ data?: any }>(
			`/titles/${encodeURIComponent(hid)}`
		);
		const data = detail?.data ?? detail;
		if (!data?.hid && !data?.title) throw new Error(`Manga not found: ${hid}`);

		const title = String(data.title || hid).trim();
		const cover =
			data?.poster?.large || data?.poster?.medium || data?.poster?.small || '';
		const status = this.mapStatus(data.status);
		const type = this.mapType(data.type);
		const synopsis = this.stripHtml(data.synopsisHtml || data.synopsis || '');

		const authors: string[] = [];
		for (const list of [data.authors, data.artists]) {
			if (!Array.isArray(list)) continue;
			for (const a of list) {
				const n = String(a?.title || a?.name || a || '').trim();
				if (n && !authors.includes(n)) authors.push(n);
			}
		}

		const genres: string[] = [];
		for (const list of [data.genres, data.themes]) {
			if (!Array.isArray(list)) continue;
			for (const g of list) {
				const n = String(g?.title || g?.name || g || '').trim();
				if (n && n.length < 40 && !genres.includes(n)) genres.push(n);
			}
		}
		if (type && !genres.includes(type)) genres.unshift(type);

		const chapters: Chapter[] = [];
		const seen = new Set<string>();
		let page = 1;
		let lastPage = 1;
		const LIMIT = 200;

		do {
			const chData = await this.apiGet<{
				items?: any[];
				meta?: { lastPage?: number };
			}>(`/titles/${encodeURIComponent(hid)}/chapters`, [
				['language', apiLang],
				['sort', 'number'],
				['order', 'desc'],
				['page', page],
				['limit', LIMIT]
			]);

			lastPage = chData?.meta?.lastPage ?? page;
			for (const u of chData?.items || []) {
				const cid = String(u?.id ?? '').trim();
				if (!cid || seen.has(cid)) continue;
				seen.add(cid);
				const num = parseFloat(String(u?.number ?? ''));
				const number = Number.isFinite(num) ? num : chapters.length + 1;
				const extra = String(u?.name || '').trim();
				const chTitle = extra
					? `Chapter ${String(u?.number ?? number).replace(/\.0$/, '')} - ${extra}`
					: `Chapter ${String(u?.number ?? number).replace(/\.0$/, '')}`;
				chapters.push({
					id: this.toChapterId(hid, cid),
					title: chTitle,
					number,
					date: this.formatDate(u?.createdAt),
					lang: String(u?.language || apiLang).toLowerCase() || undefined
				} as Chapter & { lang?: string });
			}
			page++;
		} while (page <= lastPage && page <= 20);

		chapters.sort((a, b) => (b.number || 0) - (a.number || 0));
		const latestChapter =
			chapters[0]?.number != null ? String(chapters[0].number) : undefined;

		const publication =
			data.year != null && String(data.year).trim()
				? String(data.year).trim()
				: '';

		const metaLines = [
			publication && `Publication: ${publication}`,
			authors[0] && `Author: ${authors.join(', ')}`,
			authors[0] && `Artist: ${authors.join(', ')}`,
			`Language: ${apiLang}`,
			`Type: ${type}`
		].filter(Boolean);

		const description = [...metaLines, synopsis].filter(Boolean).join('\n');

		console.log(
			`[mangafire] details ${hid} lang=${apiLang} → ch=${chapters.length}`
		);

		return {
			id: this.toMangaId(hid),
			sourceId: this.id,
			title,
			cover,
			type,
			status,
			description,
			authors,
			genres,
			chapters,
			latestChapter
		};
	}

	async getChapterPages(chapterId: string): Promise<string[]> {
		const { chapterId: cid } = this.extractChapterParts(chapterId);
		if (!cid) {
			console.error('[mangafire] getChapterPages bad id:', chapterId);
			return [];
		}
		try {
			const data = await this.apiGet<{
				data?: { pages?: Array<{ url?: string }> };
			}>(`/chapters/${encodeURIComponent(cid)}`);
			const pages = Array.isArray(data?.data?.pages) ? data.data.pages : [];
			const urls = pages
				.map((p) => String(p?.url || '').trim())
				.filter((u) => /^https?:\/\//i.test(u));
			console.log(`[mangafire] ${urls.length} pages → chapter ${cid}`);
			return urls;
		} catch (e) {
			console.error('[mangafire] getChapterPages failed', cid, e);
			return [];
		}
	}
}
