# Rokuyomu (Mikoroku v2)

Multi-source **manga, comics & light novel** reader built with **SvelteKit** on **Cloudflare Workers**, with a **Node scraper microservice** and optional **Byparr** Cloudflare bypass.

Browse latest updates and search across many sources (manga, manhwa, manhua, doujin, adult titles, light novels, and more) in one UI.

**Live:** [rokuyomu.mikoroku.workers.dev](https://rokuyomu.mikoroku.workers.dev) · **Repo:** [moemaomao/rokuyomu](https://github.com/moemaomao/rokuyomu)

---

## Features

### Browse & read

- Browse recent updates from one source or combine preferred sources on the home page.
- Search and filter by content kind (comic or novel), source, language, and supported title types.
- **Deep Search** searches titles across sources.
- View title details including covers, descriptions, genres, and chapter lists.
- Read comic chapters in the image reader and text chapters in the novel reader.
- Choose light, dark, system, or Vocaloid themes; customize homepage layout and reader preferences.
- Source availability and supported filters depend on each external source.

### Downloads & reading progress

- Download comic chapters as image folders to a local folder or as a ZIP in the browser.
- Download novel chapters as **PDF or EPUB**; choose the format in Settings.
- Manage downloaded titles from **Download** (`/download`), with IndexedDB metadata and, in supported browsers, chapter files on disk using the **File System Access API**. Chrome and Edge are recommended.
- Manage bookmarks, reading history, chapter read markers, and notifications for new chapters on tracked titles.
- Sync bookmarks into Download and refresh tracked updates; download chapters individually or in batches where available.
- Optional JSON backup export/import includes bookmarks, history, download metadata, notifications, stats, and local preferences. Chapter files/blobs are not included.
- Bookmark and history data are stored locally; optional Firebase sign-in can sync supported data across devices.

Default disk layout:

```
Rokuyomu/
├── Download/
│   ├── Manga/<Title>/…
│   └── Novel/<Title>/…
├── Bookmark/
│   ├── bookmarks.json
│   └── covers/
└── History/
    ├── history.json
    └── covers/
```

History can use **Browser cache** (IndexedDB, up to 80 titles) or **Local disk** (`history.json` and covers; soft limit around 10,000 titles).

### Settings, privacy & community

- Configure themes, homepage grid, preferred sources, reader defaults, download destination, and novel download format.
- Control history storage, disable history saving, use an incognito session, or configure automatic history cleanup.
- Adult-source visibility controls and an age confirmation gate.
- Community forum and forms for source requests, broken-source reports, and feature suggestions.
- Admin tools for report management, plus reading statistics and lifetime progress.
- Path sanitization helps handle unusual title names when saving files locally.
- Image proxy endpoint (`/api/proxy`) for covers and other proxied resources.

### Backend

- Cloudflare Workers **KV** cache (`MIKOROKU_CACHE`)
- Cron warm / sync (~every 20 minutes)
- **Hybrid scrape:** some sources parse on the Worker (Cheerio); others call the Node scraper
- Optional **Byparr** on the scraper for Cloudflare challenges

---

## Architecture

```
Browser
  └─ Cloudflare Worker (SvelteKit)
       ├─ KV cache (browse / detail / pages / novel)
       ├─ Client: IndexedDB + File System Access
       │    ├─ Download chapters / covers
       │    ├─ Bookmark JSON + covers
       │    └─ History JSON + covers (disk mode)
       └─ scraperClient (hybrid)
            ├─ source ∈ WORKER_SOURCE_IDS  → Cheerio on Worker
            └─ other sources               → HTTP JSON → Node scraper
                 └─ fetchWithCf → Byparr (optional)
```

| Layer | Role | Deploy |
|-------|------|--------|
| **frontend/** | UI, KV, hybrid Worker sources, cron, offline client | Cloudflare Workers |
| **scraper/** | Express + Cheerio, adapters (manga + novel), Byparr client | Vercel / Render / Fly / Node |
| **Byparr** (optional) | CF challenge solver | Docker `:8191` |

---

## Repository layout

```
rokuyomu/
├── README.md                 # this file
├── frontend/                 # SvelteKit → Cloudflare Worker
│   ├── README.md
│   ├── src/
│   │   ├── lib/
│   │   │   ├── db.ts                 # IndexedDB (bookmarks, history, library, covers, …)
│   │   │   ├── server/               # scraperClient, cache, worker sources
│   │   │   ├── stores/               # auth, bookmark, download, history, preferences, …
│   │   │   └── utils/                # localFs, cacheCover, downloadManga, downloadNovel, etc.
│   │   └── routes/                   # pages + /api/*
│   ├── scripts/
│   └── wrangler.jsonc
└── scraper/                  # Node microservice
    ├── README.md
    └── src/
        ├── index.ts
        ├── lib/              # byparr, cfCookieJar, fetchWithCf
        └── sources/          # registry + impl/manga + impl/novel
```

---

## Prerequisites

- **Node.js 20+**
- **pnpm 9+** (frontend)
- **npm** (scraper)
- Cloudflare account + Wrangler (frontend deploy)
- Optional: Docker for Byparr

---

## Quick start (local)

### 1. Scraper

```bash
cd scraper
npm install
npx tsx src/index.ts
# → http://localhost:3000
curl http://localhost:3000/health
```

Optional Byparr:

```bash
docker run -d --name byparr -p 8191:8191 --restart unless-stopped \
  ghcr.io/thephaseless/byparr:latest
BYPARR_URL=http://localhost:8191 npx tsx src/index.ts
```

### 2. Frontend

```bash
cd frontend
pnpm install
pnpm dev
# → http://localhost:5173
```

Point `SCRAPER_BASE_URL` at the local scraper (see `frontend/README.md` / `wrangler.jsonc`).

---

## Offline History (summary)

| Mode | Storage | Limit |
|------|---------|-------|
| **Browser cache** | IndexedDB | max **80** titles |
| **Local disk** | IndexedDB + `History/history.json` + covers | unlimited (soft ~10k) |

- Choose mode on **History** page (explanation in English in the UI).
- Disk mode needs Chrome/Edge + a granted parent folder (creates `Rokuyomu/` or privacy name).
- Switching to cache **trims** to 80; switching to disk **hydrates** from `history.json` if present.

---

## Environment (overview)

| Variable | Where | Purpose |
|----------|--------|---------|
| `SCRAPER_BASE_URL` | frontend / Wrangler | Node scraper base URL |
| `MIKOROKU_CACHE` | Cloudflare KV binding | Cache namespace |
| `BYPARR_URL` | scraper | e.g. `http://localhost:8191` — empty = off |
| Firebase config | frontend | Optional auth / cloud sync for bookmarks & history |

---

## Deploy

| Package | Typical target | Notes |
|---------|----------------|-------|
| `frontend/` | Cloudflare Workers | `pnpm deploy` (sync worker sources → build → wrangler) |
| `scraper/` | Vercel | `vercel-build` → `api/index.js` |

Keep `SCRAPER_BASE_URL` on the Worker pointed at the live scraper.

---

## License

See [LICENSE.txt](./LICENSE.txt).

---

## Related docs

- [frontend/README.md](./frontend/README.md) — UI, Download / History / Bookmark, KV, deploy
- [scraper/README.md](./scraper/README.md) — HTTP API, adapters, Byparr, deploy
