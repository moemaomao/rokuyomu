/**
 * SilentQuill adapter (silentquill.net)
 * → extends ThemesiaSource
 *
 * Theme: Themesia / mangareader
 * Latest  : /manga/?page=N&order=update
 * Search  : /?s=
 * Detail  : /manga/{slug}/  (atau root slug)
 * Chapter : /{slug}-chapter-{n}/
 * Pages   : ts_reader / #readerarea
 *
 * Bahasa default: English
 */

import { ThemesiaSource } from '../../family/ThemesiaSource';

export class SilentQuillSource extends ThemesiaSource {
	id = 'silentquill';
	name = 'SilentQuill';
	baseUrl = 'https://silentquill.net';

	protected seriesPath = '/manga';
	protected defaultLang = 'en';
	protected perPage = 30;

	protected listPath(page: number): string {
		const p = Math.max(1, page || 1);
		return `${this.seriesPath}/?page=${p}&order=update`;
	}

	protected searchPath(query: string, page: number): string {
		const q = encodeURIComponent(query);
		return page <= 1 ? `/?s=${q}` : `/?s=${q}&page=${page}`;
	}

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, 'SilentQuill')
			.replace(/\s*[-|]\s*Silent\s*Quill.*$/i, '')
			.trim();
	}
}
