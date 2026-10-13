/**
 * ManhwaDesu (manhwadesu.wiki) — Themesia → extends ThemesiaSource
 * seriesPath = /komik/  |  Cloudflare Turnstile mungkin aktif
 *
 * Latest  : /komik/?order=update&page={n}
 * Search  : /?s=
 * Detail  : /komik/{slug}/
 * Chapter : /{slug}-chapter-{n}/
 */

import * as cheerio from 'cheerio';
import { ThemesiaSource } from '../family/ThemesiaSource';
import type { Manga, MangaDetails } from '../types-manga';

export class ManhwaDesuSource extends ThemesiaSource {
	id = 'manhwadesu';
	name = 'ManhwaDesu';
	baseUrl = 'https://manhwadesu.wiki';

	protected seriesPath = '/komik';
	protected defaultLang = 'id';
	protected perPage = 24;
	private readonly SITE_PER_PAGE = 20;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept:
			'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
		'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
		'Cache-Control': 'no-cache',
		Pragma: 'no-cache'
	};

	protected listPath(page: number): string {
		const p = Math.max(1, page || 1);
		const params = new URLSearchParams({ order: 'update' });
		if (p > 1) params.set('page', String(p));
		return `${this.seriesPath}/?${params.toString()}`;
	}

	protected searchPath(query: string, page: number): string {
		const params = new URLSearchParams({ s: query });
		if (page > 1) params.set('page', String(page));
		return `/?${params.toString()}`;
	}

	protected parseChapterNumber(text: string, path = ''): number {
		const fromPath =
			path.match(/(?:ch|chapter)[_-]?(\d+)(?:[.-](\d+))?/i) ||
			path.match(/-(\d+)(?:[.-](\d+))?\/?$/i);
		if (fromPath) {
			const major = parseInt(fromPath[1], 10);
			if (fromPath[2] != null && fromPath[2].length <= 2) {
				return parseFloat(`${major}.${fromPath[2]}`);
			}
			return major;
		}
		return super.parseChapterNumber(text, path);
	}

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, 'ManhwaDesu')
			.replace(/\s*[-|]\s*Manhwa\s*Desu.*$/i, '')
			.trim();
	}

	private async fetchCatalogPages(
		buildPath: (sitePage: number) => string,
		appPage: number
	): Promise<Manga[]> {
		const p = Math.max(1, Number(appPage) || 1);
		const start = (p - 1) * this.perPage;
		const siteStart = Math.floor(start / this.SITE_PER_PAGE) + 1;
		const offsetInFirst = start % this.SITE_PER_PAGE;
		const merged: Manga[] = [];
		const seen = new Set<string>();

		for (
			let sp = siteStart;
			sp <= siteStart + 3 && merged.length < offsetInFirst + this.perPage;
			sp++
		) {
			try {
				const list = this.parseCards(cheerio.load(await this.fetchHtml(buildPath(sp))));
				for (const m of list) {
					if (seen.has(m.id)) continue;
					seen.add(m.id);
					merged.push(m);
				}
				if (list.length === 0) break;
			} catch (e) {
				console.error('[manhwadesu] catalog page', sp, e);
				break;
			}
		}
		return merged.slice(offsetInFirst, offsetInFirst + this.perPage);
	}

	async getLatestManga(page: number): Promise<Manga[]> {
		try {
			return await this.fetchCatalogPages((sitePage) => this.listPath(sitePage), page);
		} catch (e) {
			console.error('[manhwadesu] getLatestManga', e);
			return [];
		}
	}

	async searchManga(query: string, opts?: { page?: number }): Promise<Manga[]> {
		const q = (query || '').trim();
		const page = Math.max(1, opts?.page || 1);
		if (!q) return this.getLatestManga(page);
		try {
			return await this.fetchCatalogPages(
				(sitePage) => this.searchPath(q, sitePage),
				page
			);
		} catch (e) {
			console.error('[manhwadesu] searchManga', e);
			return [];
		}
	}

	async getMangaDetails(mangaId: string): Promise<MangaDetails> {
		let path = this.cleanId(mangaId);
		if (/chapter/i.test(path) && !path.startsWith('/komik/')) {
			const slug = path
				.replace(/^\//, '')
				.replace(/-chapter-[\d.]+.*$/i, '')
				.replace(/\/$/, '');
			path = `/komik/${slug}`;
		}
		if (!path.startsWith('/komik/')) {
			path = `/komik/${path.replace(/^\//, '')}`;
		}
		return super.getMangaDetails(path);
	}
}
