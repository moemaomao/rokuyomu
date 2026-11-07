import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { remoteNovelChapter } from '$lib/server/scraperClient';

export const GET: RequestHandler = async ({ url }) => {
	const source = url.searchParams.get('source')?.trim() || '';
	const chapter = url.searchParams.get('chapter')?.trim() || '';
	if (!source || !chapter) throw error(400, 'source and chapter required');

	try {
		const data = await remoteNovelChapter(source, chapter);
		if (!data?.content && !data?.title) {
			throw error(502, 'Empty novel chapter from source');
		}
		return json(data);
	} catch (e: any) {
		const msg = e?.message || String(e);
		console.error('[api/novel-chapter]', source, chapter, msg);
		if (e?.status && typeof e.status === 'number') throw e;
		if (/locked|premium/i.test(msg)) throw error(403, msg);
		if (/challenge|cloudflare|stackprotect|byparr/i.test(msg)) {
			throw error(503, msg);
		}
		throw error(500, msg);
	}
};
