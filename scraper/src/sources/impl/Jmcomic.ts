/**
 * 18comic / 禁漫天堂 (JMComic)
 *
 * Deploy: Cloudflare Workers (adapter-cloudflare + nodejs_compat)
 *
 * Masalah production sebelumnya:
 * 1. +page.server.ts timeout 4.5s — retry domain berurutan kehabisan waktu
 * 2. return [] di-cache KV 30 menit → list kosong terus
 * 3. import 'crypto' vs 'node:crypto'
 *
 * Fix: race 2 domain (timeout 3.2s), throw on fail (jangan cache []), node:crypto
 */

import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';
import { createHash, createDecipheriv } from 'node:crypto';

export class JmcomicSource extends BaseSource {
	id = 'jmcomic';
	name = '18comic';
	baseUrl = 'https://18comic.vip';

	private readonly PER_PAGE = 30;
	private readonly DEFAULT_LANG = 'zh';

	private readonly APP_TOKEN_SECRET = '185Hcomic3PAPP7R';
	private readonly APP_DATA_SECRET = '185Hcomic3PAPP7R';
	private readonly APP_VERSION = '1.7.0';

	private readonly API_DOMAINS = [
		'www.cdnhjk.net',
		'www.cdngwc.cc',
		'www.cdngwc.net',
		'www.cdngwc.club'
	];

	private readonly IMG_CDN = [
		'cdn-msp.jmapiproxy1.cc',
		'cdn-msp.jmapiproxy2.cc',
		'cdn-msp2.jmapiproxy2.cc',
		'cdn-msp3.jmapiproxy2.cc'
	];

	private readonly FETCH_TIMEOUT_MS = 3200;

	private md5hex(s: string): string {
		return createHash('md5').update(s, 'utf8').digest('hex');
	}

	private tokenPair(ts: string): { token: string; tokenparam: string } {
		return {
			token: this.md5hex(`${ts}${this.APP_TOKEN_SECRET}`),
			tokenparam: `${ts},${this.APP_VERSION}`
		};
	}

	private decryptData(b64: string, ts: string): any {
		const raw = Buffer.from(b64, 'base64');
		const key = Buffer.from(this.md5hex(`${ts}${this.APP_DATA_SECRET}`), 'utf8');
		const decipher = createDecipheriv('aes-256-ecb', key, null);
		decipher.setAutoPadding(false);
		const dec = Buffer.concat([decipher.update(raw), decipher.final()]);
		const pad = dec[dec.length - 1];
		const plain =
			pad >= 1 && pad <= 32 ? dec.subarray(0, dec.length - pad) : dec;
		return JSON.parse(plain.toString('utf8'));
	}

	// ── API ──────────────────────────────────────────────────────────────────

	private pickImgCdn(): string {
		return this.IMG_CDN[Math.floor(Math.random() * this.IMG_CDN.length)];
	}

	private async fetchOne(
		domain: string,
		path: string,
		ts: string,
		token: string,
		tokenparam: string
	): Promise<any> {
		const url = `https://${domain}${path}`;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.FETCH_TIMEOUT_MS);

		try {
			const res = await fetch(url, {
				headers: {
					token,
					tokenparam,
					'User-Agent':
						'Mozilla/5.0 (Linux; Android 9; V1938CT Build/PQ3A.190705.11211812; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Safari/537.36',
					Accept: 'application/json, text/plain, */*',
					'Accept-Encoding': 'identity',
					'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
				},
				signal: controller.signal
			});

			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const body = (await res.json()) as { data?: string };
			if (!body?.data) throw new Error('empty data');
			return this.decryptData(body.data, ts);
		} finally {
			clearTimeout(timer);
		}
	}

	private async apiGet(path: string): Promise<any> {
		const ts = String(Math.floor(Date.now() / 1000));
		const { token, tokenparam } = this.tokenPair(ts);
		const rel = path.startsWith('/') ? path : `/${path}`;

		const shuffled = [...this.API_DOMAINS].sort(() => Math.random() - 0.5);
		const pair = shuffled.slice(0, 2);

		try {
			return await Promise.any(
				pair.map((d) => this.fetchOne(d, rel, ts, token, tokenparam))
			);
		} catch {
	
			for (const d of shuffled.slice(2)) {
				try {
					return await this.fetchOne(d, rel, ts, token, tokenparam);
				} catch {
					/* next */
				}
			}
			throw new Error(`[jmcomic] all API domains failed for ${rel}`);
		}
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	private toId(id: string | number): string {
		const n = String(id).replace(/\D/g, '');
		return n ? `/${n}` : '';
	}

	private extractId(raw: string): string {
		return String(raw || '').replace(/\D/g, '');
	}

	private coverUrl(albumId: string | number): string {
		return `https://${this.pickImgCdn()}/media/albums/${albumId}.jpg`;
	}

	private pageUrl(photoId: string | number, filename: string): string {
		return `https://${this.pickImgCdn()}/media/photos/${photoId}/${filename}`;
	}

	private mapListItem(item: any): Manga | null {
		const id = String(item?.id || '').trim();
		if (!id) return null;
		const title = String(item?.name || item?.title || '')
			.replace(/\s+/g, ' ')
			.trim();
		if (!title) return null;

		const categoryTitle = item?.category?.title || '';
		let type = 'manga';
		if (/韓|韩|hanman/i.test(categoryTitle)) type = 'manhwa';

		return {
			id: this.toId(id),
			title,
			cover: this.coverUrl(id),
			sourceId: this.id,
			type,
			status: 'Ongoing',
			lang: this.DEFAULT_LANG
		};
	}

	// ── Catalog ──────────────────────────────────────────────────────────────

	async getLatestManga(
		page: number,
		_opts?: { lang?: string; type?: string }
	): Promise<Manga[]> {
		const p = Math.max(1, Number(page) || 1);
		const data = await this.apiGet(
			`/categories/filter?page=${p}&order=&c=0&o=mr`
		);
		const content: any[] = data?.content || [];
		const list = content
			.map((it) => this.mapListItem(it))
			.filter(Boolean) as Manga[];

		console.log(`[jmcomic] latest page=${p} → ${list.length}`);
		return list.slice(0, this.PER_PAGE);
	}

	async searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page || 1);
		if (!q) return this.getLatestManga(page, opts);

		const params = new URLSearchParams({
			main_tag: '0',
			search_query: q,
			page: String(page),
			o: 'mr',
			t: 'a'
		});
		const data = await this.apiGet(`/search?${params.toString()}`);

		if (data?.redirect_aid) {
			const aid = String(data.redirect_aid);
			const details = await this.getMangaDetails(aid);
			return [
				{
					id: this.toId(aid),
					title: details.title,
					cover: details.cover,
					sourceId: this.id,
					type: details.type || 'manga',
					status: details.status,
					latestChapter: details.latestChapter,
					lang: this.DEFAULT_LANG
				}
			];
		}

		const content: any[] = data?.content || [];
		const list = content
			.map((it) => this.mapListItem(it))
			.filter(Boolean) as Manga[];

		console.log(`[jmcomic] search "${q}" page=${page} → ${list.length}`);
		return list.slice(0, this.PER_PAGE);
	}

	// ── Details ──────────────────────────────────────────────────────────────

	async getMangaDetails(
		mangaId: string,
		_opts?: { lang?: string }
	): Promise<MangaDetails> {
		const aid = this.extractId(mangaId);
		if (!aid) throw new Error(`JMComic: invalid mangaId ${mangaId}`);

		const data = await this.apiGet(`/album?id=${aid}`);

		const title = String(data?.name || '')
			.replace(/\s+/g, ' ')
			.trim();
		const description = String(data?.description || '')
			.replace(/\s+/g, ' ')
			.trim();

		const authors: string[] = Array.isArray(data?.author)
			? data.author.map((a: any) => String(a).trim()).filter(Boolean)
			: [];

		const tags: string[] = Array.isArray(data?.tags)
			? data.tags.map((t: any) => String(t).trim()).filter(Boolean)
			: String(data?.tags || '')
					.split(/\s+/)
					.map((t: string) => t.trim())
					.filter(Boolean);

		const genres = tags.filter(
			(t) => !/^(連載中|完結|完结|中文|韓漫|韩漫|同人|CG)$/i.test(t)
		);

		const status = tags.some((t) => /完結|完结/.test(t))
			? 'Completed'
			: 'Ongoing';

		let type = 'manga';
		if (tags.some((t) => /韓|韩/.test(t))) type = 'manhwa';

		const series: any[] = Array.isArray(data?.series) ? data.series : [];
		const chapters: Chapter[] = [];

		if (series.length > 0) {
			for (const s of series) {
				const cid = String(s?.id || '').trim();
				if (!cid) continue;
				const sort =
					parseInt(String(s?.sort || '0'), 10) || chapters.length + 1;
				const name = String(s?.name || '').trim();
				chapters.push({
					id: this.toId(cid),
					title: name || `第${sort}話`,
					number: sort,
					lang: this.DEFAULT_LANG
				});
			}
		} else {
			chapters.push({
				id: this.toId(aid),
				title: '第1話',
				number: 1,
				lang: this.DEFAULT_LANG
			});
		}

		chapters.sort((a, b) => a.number - b.number);

		let latestChapter: string | undefined;
		if (chapters.length > 1) {
			latestChapter = `第${chapters[chapters.length - 1].number}話`;
		} else if (data?.total_photos) {
			latestChapter = `${data.total_photos}P`;
		} else if (chapters.length === 1) {
			latestChapter = '第1話';
		}

		return {
			id: this.toId(aid),
			title,
			cover: this.coverUrl(aid),
			sourceId: this.id,
			type,
			status,
			description,
			authors,
			genres,
			chapters,
			lang: this.DEFAULT_LANG,
			latestChapter
		};
	}

	// ── Chapter pages ────────────────────────────────────────────────────────

	async getChapterPages(chapterId: string): Promise<string[]> {
		const pid = this.extractId(chapterId);
		if (!pid) throw new Error(`JMComic: invalid chapterId ${chapterId}`);

		const data = await this.apiGet(`/chapter?id=${pid}`);
		const images: string[] = Array.isArray(data?.images) ? data.images : [];
		const pages = images.map((file: string) => this.pageUrl(pid, file));

		console.log(`[jmcomic] getChapterPages ${pid} → ${pages.length} pages`);
		return pages;
	}
}
