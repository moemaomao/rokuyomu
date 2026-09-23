import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

/**
 * Proxy novel chapter content from scraper microservice.
 * GET /api/novel-chapter?source=xxx&chapter=/path/to/chapter
 */
export const GET: RequestHandler = async ({ url }) => {
	const source = url.searchParams.get('source') || '';
	const chapter = url.searchParams.get('chapter') || '';
	if (!source || !chapter) throw error(400, 'source and chapter required');

	const base = env.SCRAPER_BASE_URL || 'http://localhost:3000';
	const chapterPath = chapter.startsWith('/') ? chapter : `/${chapter}`;
	const target = `${base}/${source}/novel-chapter${chapterPath}`;

	const headers: Record<string, string> = {};
	if (env.SCRAPER_API_KEY) headers['x-api-key'] = env.SCRAPER_API_KEY;

	const res = await fetch(target, { headers });
	if (!res.ok) {
		const body = await res.text();
		throw error(res.status, body || 'Scraper error');
	}
	const data = await res.json();
	return json(data);
};
