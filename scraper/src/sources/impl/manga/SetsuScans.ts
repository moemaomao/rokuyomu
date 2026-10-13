/**
 * Setsu Scans (setsuscans.com) — Themesia / mangareader → extends ThemesiaSource
 * Catatan: Cloudflare Turnstile — fetchHtml override + deteksi challenge.
 *
 * Latest  : /manga/?page=N&order=update
 * Search  : /?s=
 * Detail  : /manga/{slug}/
 * Chapter : /manga/{slug}/chapter-{n}/ atau /{slug}-chapter-{n}/
 */

import { ThemesiaSource } from '../../family/ThemesiaSource';

export class SetsuScansSource extends ThemesiaSource {
	id = 'setsuscans';
	name = 'Setsu Scans';
	baseUrl = 'https://setsuscans.com';

	protected seriesPath = '/manga';
	protected defaultLang = 'en';
	protected perPage = 24;

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
		const p = Math.max(1, page || 1);
		return `${this.seriesPath}/?page=${p}&order=update`;
	}

	protected searchPath(query: string, page: number): string {
		const q = encodeURIComponent(query);
		return page <= 1 ? `/?s=${q}` : `/?s=${q}&page=${page}`;
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
			.normalizeTitle(raw, 'Setsu Scans')
			.replace(/\s*[-|]\s*Setsu\s*Scans.*$/i, '')
			.trim();
	}
}
