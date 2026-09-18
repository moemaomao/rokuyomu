# Mikoroku Scraper

External Node.js scraping service. Deploy to Render / Koyeb / Fly.io (free).

## API
- `GET /health`
- `GET /sources`
- `GET /:sourceId/latest?page&lang&type&q`
- `GET /:sourceId/manga/*?lang`
- `GET /:sourceId/chapter/*`

Optional: `x-api-key` header if `SCRAPER_API_KEY` is set.

```bash
npm install && npm run dev
```
