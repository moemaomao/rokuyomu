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
- Dark / light theme, mobile-friendly layout

### Library, bookmarks & progress
- **Bookmarks** (local IndexedDB + optional Firebase sync when logged in)
- **Reading history** and chapter read markers
- **Notifications** for new chapters on tracked titles
- **Offline Library** (client-side):
  - Metadata in IndexedDB (survives reload)
  - Files on disk via **File System Access API** (Chrome / Edge)
  - Structure: `RokuyomuLibrary/Manga|Novel/<Title>/…`
  - Manga chapters as image folders (no ZIP required)
  - Novel chapters as **PDF** files
  - Cover images cached offline (disk + IndexedDB blob)
  - Sync Bookmarks → import titles into Library
  - **Sync Updates** → refresh latest chapter badges, sort by newest activity
  - Per-title **batch download**, single-chapter download, offline checkmarks on chapter list

### Community & ops
- Community forum (categories, threads)
- Report broken source / chapter
- Admin panel (health, sources, backup snapshot)
- Stats / lifetime progress helpers
- Image proxy (`/api/proxy`) for hotlink-safe covers & pages

### Backend
- Cloudflare Workers **KV** cache (`MIKOROKU_CACHE`)
- Cron warm / sync cache (~every 20 minutes)
- **Hybrid scrape:** blocked Vercel outbound sources parse **on the Worker** (Cheerio); others call the Node scraper over HTTP JSON
- **Byparr** integration on the scraper for Cloudflare challenges (optional)

---

## Architecture

```
Browser
  └─ Cloudflare Worker (SvelteKit)
       ├─ KV cache (browse / detail / pages / novel)
       ├─ Client: IndexedDB + optional File System Access (Library)
       └─ scraperClient (hybrid)
            ├─ source ∈ WORKER_SOURCE_IDS  → Cheerio adapters on Worker
            └─ other sources               → HTTP JSON → Node scraper
                 └─ fetchWithCf → Byparr (if CF challenge)
```

| Layer | Role | Deploy |
|-------|------|--------|
| **`frontend/`** | UI, KV, hybrid Worker sources, cron | Cloudflare Workers |
| **`scraper/`** | Express + Cheerio, ~190+ adapters (manga + novel), Byparr client | Vercel (or Render / Koyeb / Fly) |
| **Byparr** (optional) | Camoufox-based CF solver | Docker / local `:8191` |

Worker free tier stays viable when most traffic is `fetch()` of JSON. Cheerio on the Worker is reserved for sources that fail from the scraper’s hosting IP.

---

## Repository layout

```
rokuyomu/
├── README.md                 # this file
├── frontend/                 # SvelteKit → Cloudflare Worker
│   ├── README.md
│   ├── src/
│   │   ├── lib/
│   │   │   ├── db.ts                 # IndexedDB schema (bookmarks, history, library, covers, …)
│   │   │   ├── server/
│   │   │   │   ├── workerSources/    # hybrid adapters (generated)
│   │   │   │   ├── scraperClient.ts
│   │   │   │   ├── cache.ts
│   │   │   │   └── …
│   │   │   ├── stores/               # bookmark, history, library, auth, …
│   │   │   └── utils/                # downloadChapter, downloadNovelPdf, localFs, cacheCover, …
│   │   └── routes/
│   │       ├── +page.*               # homepage / browse
│   │       ├── library/              # Offline Library UI
│   │       ├── manga/[source]/[...id]/
│   │       ├── reader/ · novel-reader/
│   │       ├── deep-search/ · community/ · bookmark/ · history/
│   │       ├── notification/ · settings/ · report/ · admin/ · stats/
│   │       └── api/                  # chapters, pages, proxy, novel-chapter, warm, cron, …
│   ├── scripts/
│   │   ├── worker-sources.json
│   │   ├── sync-worker-sources.mjs
│   │   └── append-cron.js
│   └── wrangler.jsonc
│
└── scraper/                  # Node microservice
    ├── README.md
    ├── src/
    │   ├── index.ts          # Express API
    │   ├── lib/              # byparr, cfCookieJar, fetchWithCf
    │   └── sources/          # registry + impl/manga · impl/novel
    ├── api/index.js          # esbuild bundle for Vercel (generated)
    └── package.json
```

Rough adapter counts (evolve over time): **~100+ manga**, **~80+ novel** in the scraper registry; a subset is mirrored to Worker hybrid sources via `sync-worker-sources`.

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

# Linux/macOS
BYPARR_URL=http://localhost:8191 npx tsx src/index.ts
```

### 2. Frontend

```bash
cd frontend
pnpm install
# Point at local scraper (see frontend/README.md / wrangler.jsonc vars)
pnpm dev
# → http://localhost:5173
```

---

## Environment (overview)

| Variable | Where | Purpose |
|----------|--------|---------|
| `SCRAPER_BASE_URL` | frontend / Wrangler | Base URL of the Node scraper |
| `MIKOROKU_CACHE` | Cloudflare KV binding | Cache namespace |
| `BYPARR_URL` | scraper | e.g. `http://localhost:8191` — empty = off |
| `CF_COOKIE_TTL_MS` | scraper | CF cookie TTL (default 15 min) |
| Firebase config | frontend | Optional auth / cloud sync for bookmarks & history |

See **`frontend/README.md`** and **`scraper/README.md`** for full tables and deploy steps.

---

## Offline Library (client)

Chrome / Edge recommended (File System Access API).

1. Open **Library** in the sidebar → **Folder** → pick a parent directory once.  
2. App creates `RokuyomuLibrary/Manga/…` and `RokuyomuLibrary/Novel/…`.  
3. **Sync Bookmarks** copies title metadata into Library.  
4. Download chapters from the title page or use **Download** (batch) on a Library card.  
5. **Sync Updates** refreshes latest chapter labels and sorts titles by recent activity.  
6. Covers are stored as `cover.*` under each title folder and as blobs in IndexedDB for offline UI.

Firefox / Safari: Library metadata still works; downloads fall back to ZIP / single-file browser downloads.

---

## Deploy

| Package | Typical target | Notes |
|---------|----------------|-------|
| `frontend/` | Cloudflare Workers | `pnpm deploy` (sync worker sources → build → wrangler) |
| `scraper/` | Vercel | `vercel-build` bundles to `api/index.js` |

Keep `SCRAPER_BASE_URL` on the Worker pointed at the live scraper. Register hybrid sources in `frontend/scripts/worker-sources.json` and run `pnpm sync-worker-sources` before deploy.

---

## Scripts (root-level mental model)

| Area | Common commands |
|------|-----------------|
| Frontend | `pnpm dev` · `pnpm build` · `pnpm deploy` · `pnpm sync-worker-sources` · `pnpm check` |
| Scraper | `npx tsx src/index.ts` · `npm run build` / `vercel-build` |

---

## License

See [LICENSE.txt](./LICENSE.txt).

---

## Related docs

- [frontend/README.md](./frontend/README.md) — UI, hybrid sources, KV, Library, deploy  
- [scraper/README.md](./scraper/README.md) — HTTP API, adapters, Byparr, deploy  
