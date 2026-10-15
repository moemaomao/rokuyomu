# Rokuyomu (Mikoroku v2)

Multi-source **manga, comics & light novel** reader built with **SvelteKit** on **Cloudflare Workers**, with a **Node scraper microservice** and optional **Byparr** Cloudflare bypass.

Browse latest updates and search across many sources (manga, manhwa, manhua, doujin, adult titles, light novels, and more) in one UI.

**Live:** [rokuyomu.mikoroku.workers.dev](https://rokuyomu.mikoroku.workers.dev) · **Repo:** [moemaomao/rokuyomu](https://github.com/moemaomao/rokuyomu)

---

## Features

### Browse & read

- Multi-source homepage (preferred sources) with language / type filters
- Search and **Deep Search** across sources
- Manga / novel detail pages (cover, synopsis, genres, chapter list)
- **Image reader** for manga chapters
- **Novel reader** for text chapters
- Dark / light / Vocaloid themes, mobile-friendly layout

### Library, bookmarks & progress

- **Bookmarks** (IndexedDB + optional Firebase sync when logged in)
  - Optional disk snapshot: `Rokuyomu/Bookmark/bookmarks.json` + covers
- **Reading history** and chapter read markers
  - **Browser cache** mode: IndexedDB only, **max 80** titles
  - **Local disk** mode: unlimited (soft ~10k), `Rokuyomu/History/history.json` + covers offline
  - Toggle + English explanation on the **History** page
- **Notifications** for new chapters on tracked titles
- **Offline Library** (client-side, Chrome / Edge recommended):
  - Metadata in IndexedDB
  - Files on disk via **File System Access API**
  - Structure (default names):

    ```
    Rokuyomu/
    ├── Library/
    │   ├── Manga/<Title>/…
    │   └── Novel/<Title>/…
    ├── Bookmark/
    │   ├── bookmarks.json
    │   └── covers/
    └── History/
        ├── history.json
        └── covers/
    ```

  - Manga chapters as image folders; novels as **PDF**
  - Cover images on disk + IndexedDB blobs
  - Sync Bookmarks → Library; Sync Updates; batch / single-chapter download

### Privacy (Settings)

- Don’t save history / incognito session / auto-clear history
- **Hide offline folders** (independent checkboxes):
  | Folder | Normal | Hidden name |
  |--------|--------|-------------|
  | Main | `Rokuyomu` | `AppCache` |
  | Library | `Library` | `_media` |
  | Bookmark | `Bookmark` | `_fav` |
  | History | `History` | `_recent` |

  Only **new writes** use hidden names; existing folders are not renamed automatically.

### Disk paths

- `sanitizePathSegment` normalizes titles (NFKC), strips mojibake / replacement chars, falls back to `title_<hash>` when needed
- `getOrCreateDir` retries with a hashed folder name if the FS rejects a path (weird titles still download)

### Community & ops

- Community forum, report broken source/chapter
- Admin panel, stats / lifetime progress
- Image proxy (`/api/proxy`)

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
       │    ├─ Library chapters / covers
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
│   │   │   ├── stores/               # auth, bookmark, history, library, preferences, …
│   │   │   └── utils/                # localFs, cacheCover, download*, sanitize paths
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

- [frontend/README.md](./frontend/README.md) — UI, offline Library / History / Bookmark, KV, deploy
- [scraper/README.md](./scraper/README.md) — HTTP API, adapters, Byparr, deploy
