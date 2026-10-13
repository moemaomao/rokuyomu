/**
 * Setsu Scans (setsuscans.com)
 * Theme: WordPress Madara (/wp-content/themes/madara/)
 * → extends MadaraSource
 *
 * Latest  : /manga/?m_orderby=latest  |  /manga/page/{n}/?m_orderby=latest
 * Search  : /?s={q}&post_type=wp-manga
 * Detail  : /manga/{slug}/
 * Chapters: ajax/chapters (Madara)
 * Pages   : .reading-content img / .wp-manga-chapter-img
 */

import { MadaraSource } from '../family/MadaraSource';

export class SetsuScansSource extends MadaraSource {
	id = 'setsuscans';
	name = 'Setsu Scans';
	baseUrl = 'https://setsuscans.com';

	protected seriesPath = '/manga';
	protected defaultLang = 'en';
	protected perPage = 24;
	protected useAjaxChapters = true;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		Accept:
			'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.9',
		'Cache-Control': 'no-cache',
		Pragma: 'no-cache',
		'Sec-Fetch-Dest': 'document',
		'Sec-Fetch-Mode': 'navigate',
		'Sec-Fetch-Site': 'none',
		'Sec-Fetch-User': '?1',
		'Upgrade-Insecure-Requests': '1'
	};

	protected listPath(page: number): string {
		if (page <= 1) return `${this.seriesPath}/?m_orderby=latest`;
		return `${this.seriesPath}/page/${page}/?m_orderby=latest`;
	}

	protected searchPath(query: string, page: number): string {
		const q = encodeURIComponent(query);
		const base = `/?s=${q}&post_type=wp-manga`;
		return page <= 1 ? base : `/page/${page}/?s=${q}&post_type=wp-manga`;
	}

	protected async fetchHtml(path: string): Promise<string> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const response = await fetch(url, {
			headers: { ...this.headers, Referer: this.baseUrl + '/' },
			redirect: 'follow'
		});
		const html = await response.text();
		const lower = html.toLowerCase();
		const isChallenge =
			response.status === 403 ||
			response.status === 503 ||
			/just a moment|verify you are human|cf-browser-verification|challenge-platform|cf-turnstile|checking your browser/i.test(
				lower
			);
		if (isChallenge || !response.ok) {
			console.error('[setsuscans] Cloudflare / blocked', {
				url,
				status: response.status
			});
			throw new Error(
				`Failed to fetch ${url}: ${response.status}` +
					(isChallenge ? ' (Cloudflare challenge)' : '')
			);
		}
		return html;
	}

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, 'Setsu Scans')
			.replace(/\s*[-|]\s*Setsu\s*Scans.*$/i, '')
			.trim();
	}
}
