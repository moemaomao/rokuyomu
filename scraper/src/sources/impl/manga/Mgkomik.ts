/**
 * MGKomik adapter (mgkomik.cc mirrors)
 * Theme: Madara (wp-manga) → extends MadaraSource
 *
 * seriesPath : /komik
 * Latest     : /komik/?m_orderby=latest  (+ fallback /komik-tag/project/)
 * Search     : /?s={q}&post_type=wp-manga
 * Detail     : /komik/{slug}/
 * Chapters   : POST /komik/{slug}/ajax/chapters/
 * Pages      : .reading-content img / .wp-manga-chapter-img
 */

import * as cheerio from 'cheerio';
import { MadaraSource } from '../../family/MadaraSource';
import type { Manga } from '../../types-manga';

export class MgkomikSource extends MadaraSource {
	id = 'mgkomik';
	name = 'MGKomik';
	baseUrl = 'https://web1.mgkomik.cc';

	private readonly MIRRORS = [
		'https://web1.mgkomik.cc',
		'https://id.mgkomik.cc',
		'https://web.mgkomik.cc'
	];

	protected seriesPath = '/komik';
	protected defaultLang = 'id';
	protected perPage = 24;
	protected useAjaxChapters = true;

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, this.name)
			.replace(/\s*[-|]\s*MG\s*Komik.*$/i, '')
			.replace(/\s*[-|]\s*Mgkomik.*$/i, '')
			.trim();
	}

	protected async fetchHtml(path: string): Promise<string> {
		const rel = path.startsWith('http') ? path : path;
		let lastErr: unknown;
		for (const base of this.MIRRORS) {
			try {
				const url = rel.startsWith('http') ? rel : `${base}${rel.startsWith('/') ? '' : '/'}${rel}`;
				const response = await fetch(url, {
					headers: {
						...this.headers,
						Referer: `${base}/`
					},
					redirect: 'follow'
				});
				if (!response.ok) {
					lastErr = new Error(`HTTP ${response.status} ${url}`);
					continue;
				}
				const html = await response.text();
				if (/just a moment|cf-browser-verification|challenge-platform/i.test(html)) {
					lastErr = new Error(`CF challenge ${url}`);
					continue;
				}
				this.baseUrl = base;
				return html;
			} catch (e) {
				lastErr = e;
			}
		}
		throw lastErr instanceof Error ? lastErr : new Error('mgkomik fetch failed');
	}

	async getLatestManga(page: number): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			const candidates =
				p <= 1
					? [`${this.seriesPath}/?m_orderby=latest`, `${this.seriesPath}-tag/project/`]
					: [
							`${this.seriesPath}/page/${p}/?m_orderby=latest`,
							`${this.seriesPath}-tag/project/page/${p}/`
						];
			for (const path of candidates) {
				try {
					const list = this.parseCards(cheerio.load(await this.fetchHtml(path)));
					if (list.length > 0) {
						const out = list.slice(0, this.perPage);
						console.log(`[${this.id}] latest page=${p} via ${path} → ${out.length}`);
						return out;
					}
				} catch (e) {
					console.warn(`[${this.id}] path failed ${path}`, e);
				}
			}
			console.log(`[${this.id}] latest page=${p} → 0 items`);
			return [];
		} catch (e) {
			console.error(`[${this.id}] getLatestManga`, e);
			return [];
		}
	}
}

export default MgkomikSource;
