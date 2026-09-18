/**
 * Thin HTTP client → external scraper microservice.
 * Worker only does fetch JSON + KV (no Cheerio).
 */
import { env } from '$env/dynamic/private';
import type { Manga, MangaDetails } from '$lib/server/sources/types';

function baseUrl(): string {
  const u = env.SCRAPER_BASE_URL || (typeof process !== 'undefined' ? process.env?.SCRAPER_BASE_URL : '') || 'http://localhost:3000';
  return String(u).replace(/\/$/, '');
}

function apiKey(): string {
  return env.SCRAPER_API_KEY || (typeof process !== 'undefined' ? process.env?.SCRAPER_API_KEY : '') || '';
}

async function scraperFetch<T>(path: string): Promise<T> {
  const url = `${baseUrl()}${path.startsWith('/') ? path : '/' + path}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  const key = apiKey();
  if (key) headers['x-api-key'] = key;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Scraper ${res.status} ${url}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function remoteSourceList(): Promise<Array<{ id: string; name: string }>> {
  return scraperFetch('/sources');
}

export async function remoteLatest(
  sourceId: string,
  page: number,
  opts: { lang?: string; type?: string; q?: string } = {}
): Promise<Manga[]> {
  const params = new URLSearchParams({
    page: String(page),
    lang: opts.lang || 'all',
    type: opts.type || 'all'
  });
  if (opts.q?.trim()) params.set('q', opts.q.trim());
  return scraperFetch(`/${encodeURIComponent(sourceId)}/latest?${params}`);
}

export async function remoteMangaDetails(
  sourceId: string,
  mangaId: string,
  lang = 'all'
): Promise<MangaDetails> {
  const id = mangaId.replace(/^\/+/, '');
  return scraperFetch(
    `/${encodeURIComponent(sourceId)}/manga/${id}?lang=${encodeURIComponent(lang)}`
  );
}

export async function remoteChapterPages(sourceId: string, chapterId: string): Promise<string[]> {
  const id = chapterId.replace(/^\/+/, '');
  return scraperFetch(`/${encodeURIComponent(sourceId)}/chapter/${id}`);
}
