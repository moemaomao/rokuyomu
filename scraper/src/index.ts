/**
 * Mikoroku Scraper Microservice
 * Heavy Cheerio HTML parsing lives here (Render/Koyeb/Fly free tier).
 * Cloudflare Worker only fetches JSON → < 1 ms CPU.
 */
import express from 'express';
import cors from 'cors';
import { getSource, getSourceList } from './sources/index';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.SCRAPER_API_KEY || '';

app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  if (!API_KEY) return next();
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.get('/sources', (_req, res) => {
  try {
    res.json(getSourceList());
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'failed' });
  }
});

app.get('/:sourceId/latest', async (req, res) => {
  try {
    const { sourceId } = req.params;
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const lang = String(req.query.lang || 'all');
    const type = String(req.query.type || 'all');
    const q = String(req.query.q || '').trim();
    const adapter = getSource(sourceId);
    const data = q
      ? await adapter.searchManga(q, { page, lang, type })
      : await adapter.getLatestManga(page, { lang, type });
    res.json(Array.isArray(data) ? data : []);
  } catch (e: any) {
    console.error('[latest]', req.params.sourceId, e);
    res.status(500).json({ error: e?.message || 'scraping failed' });
  }
});

app.get('/:sourceId/manga/*', async (req, res) => {
  try {
    const sourceId = req.params.sourceId;
    const raw = (req.params as any)[0] || '';
    const mangaId = '/' + String(raw).replace(/^\/+/, '');
    const lang = String(req.query.lang || 'all');
    if (!mangaId || mangaId === '/') return res.status(400).json({ error: 'Invalid mangaId' });
    const adapter = getSource(sourceId);
    const data = await adapter.getMangaDetails(mangaId, { lang });
    res.json(data);
  } catch (e: any) {
    console.error('[manga]', req.params.sourceId, e);
    res.status(500).json({ error: e?.message || 'scraping failed' });
  }
});

app.get('/:sourceId/chapter/*', async (req, res) => {
  try {
    const sourceId = req.params.sourceId;
    const raw = (req.params as any)[0] || '';
    const chapterId = '/' + String(raw).replace(/^\/+/, '');
    if (!chapterId || chapterId === '/') return res.status(400).json({ error: 'Invalid chapterId' });
    const adapter = getSource(sourceId);
    const pages = await adapter.getChapterPages(chapterId);
    res.json(Array.isArray(pages) ? pages : []);
  } catch (e: any) {
    console.error('[chapter]', req.params.sourceId, e);
    res.status(500).json({ error: e?.message || 'scraping failed' });
  }
});

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`[mikoroku-scraper] :${PORT}`);
  });
}

export default app;
