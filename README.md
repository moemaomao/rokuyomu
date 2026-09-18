# Mikoroku v2 — Refactored (External Scraper)

Scraping (Cheerio) dipindah ke **microservice Node.js** agar Cloudflare Worker tetap di free tier (CPU &lt; 10 ms).

## Struktur

```
mikoroku-refactored/
├── scraper/          # Express + Cheerio (deploy ke Render/Koyeb/Fly)
│   └── src/sources/  # semua adapter (82 sources)
└── frontend/         # SvelteKit + Cloudflare Worker (thin proxy + KV)
```

## Cara pakai

### 1. Deploy scraper (gratis)

```bash
cd scraper
npm install
npm run dev          # local :3000

# Production: push ke Render Web Service (free)
# Build: npm install
# Start: npm start
```

Catat URL, contoh: `https://mikoroku-scraper.onrender.com`

### 2. Frontend (Worker)

Set env di Cloudflare / `.env` / `wrangler.jsonc` → `vars.SCRAPER_BASE_URL`:

```
SCRAPER_BASE_URL=https://mikoroku-scraper.onrender.com
```

Opsional: `SCRAPER_API_KEY` (harus sama di scraper & frontend).

```bash
cd frontend
pnpm install
pnpm dev
pnpm deploy
```

### 3. Alur request

```
UI → Cloudflare Worker (KV cache) → fetch JSON ke Scraper → Cheerio parse situs
```

Worker hanya `fetch()` JSON → CPU sangat kecil.

## Catatan

- Source registry metadata (`getSourceList`) tetap di frontend (tanpa scraping).
- Reader masih pakai `getSource()` hanya untuk `baseUrl` / resolve mangaId (ringan).
- Hapus `cheerio` dari frontend dependency setelah stabil (opsional; bundle Worker lebih kecil).
- Free tier Render bisa sleep → ping `/health` tiap 10–14 menit.

## File yang diubah di frontend

- `src/lib/server/scraperClient.ts` (baru)
- `src/routes/+page.server.ts`
- `src/routes/manga/[source]/[...id]/+page.server.ts`
- `src/routes/reader/[source]/[...id]/+page.server.ts`
- `src/routes/api/pages/+server.ts`
- `src/lib/server/warmCache.ts`
- `src/lib/server/syncSources.ts`
- `wrangler.jsonc` (vars SCRAPER_BASE_URL)
