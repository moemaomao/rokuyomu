import type { IMangaSource, Manga, MangaDetails } from './types';

/**
 * Abstract base class for all manga source adapters.
 */
export abstract class BaseSource implements IMangaSource {
	abstract id: string;
	abstract name: string;
	abstract baseUrl: string;

	protected headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
		'Accept-Language': 'en-US,en;q=0.5'
	};

	protected async fetchHtml(path: string): Promise<string> {
	const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;

	const response = await fetch(url, {
		headers: { ...this.headers, Referer: this.baseUrl }
	});

	const html = await response.text();
	const lowerHtml = html.toLowerCase();

	const cloudflareMarkers = [
		'cf-browser-verification',
		'just a moment...',
		'verify you are human',
		'checking your browser',
		'enable javascript and cookies to continue',
		'cf-chl-captcha'
	];

	const matchedMarkers = cloudflareMarkers.filter((marker) =>
		lowerHtml.includes(marker.toLowerCase())
	);

	const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	const title = titleMatch?.[1]?.replace(/\s+/g, ' ').trim() || '';

	const isChallenge =
		matchedMarkers.length > 0 ||
		(
			response.status === 403 &&
			/just a moment|attention required|verify you are human/i.test(html)
		);

	console.log('[fetchHtml]', {
		url,
		status: response.status,
		ok: response.ok,
		length: html.length,
		contentType: response.headers.get('content-type'),
		server: response.headers.get('server'),
		cfRay: response.headers.get('cf-ray'),
		cloudflareServer: response.headers.get('server')?.toLowerCase() === 'cloudflare',
		isChallenge,
		markers: matchedMarkers,
		title,
		preview: html.slice(0, 1000).replace(/\s+/g, ' ').trim()
	});

	if (!response.ok) {
		throw new Error(
			`Failed to fetch ${url}: ${response.status} ${response.statusText}`
		);
	}

	return html;
}

	protected async fetchJson<T>(path: string): Promise<T> {
		const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
		const response = await fetch(url, {
			headers: {
				...this.headers,
				Referer: this.baseUrl,
				Accept: 'application/json'
			}
		});
		if (!response.ok) {
			throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
		}
		return await response.json();
	}

	abstract getLatestManga(
		page: number,
		opts?: { lang?: string; type?: string }
	): Promise<Manga[]>;

	abstract searchManga(
		query: string,
		opts?: { page?: number; lang?: string; type?: string }
	): Promise<Manga[]>;

	abstract getMangaDetails(
		mangaId: string,
		opts?: { lang?: string }
	): Promise<MangaDetails>;

	abstract getChapterPages(chapterId: string): Promise<string[]>;
}