# Rokuyomu — Frontend

SvelteKit application deployed as a **Cloudflare Worker**. Provides the web UI, Workers KV cache, hybrid scrape routing (manga **&** novel), and the **Offline Library** client features.

Monorepo: [moemaomao/rokuyomu](https://github.com/moemaomao/rokuyomu) · this package: `frontend/`

**Live:** [rokuyomu.mikoroku.workers.dev](https://rokuyomu.mikoroku.workers.dev)

---

## Role

| Responsibility | Detail |
|----------------|--------|
| UI | Browse, search, detail, image reader, novel reader, bookmarks, history, settings, deep search, community, notifications, admin, **library** |
| Cache | Workers KV binding `MIKOROKU_CACHE` |
| Data proxy | `scraperClient.ts` → Node scraper **or** in-Worker Cheerio (hybrid) |
| Cron | Warm / sync cache (~every 20 minutes via Wrangler cron) |
| Offline | IndexedDB metadata + optional File System Access downloads (Chrome/Edge) |

The Worker does **not** permanently host manga/novel files. Chapter images and novel text come from external sources (proxied when needed). Offline copies live **on the user’s device**.

---

## Architecture (hybrid)

```
Browser
  → CF Worker (SvelteKit)
       → KV hit?  → cached JSON
       → KV miss  → scraperClient
            ├─ source ∈ WORKER_SOURCE_IDS  → workerSources (Cheerio on Worker)
            └─ else                        → GET {SCRAPER_BASE_URL}/...
```

Sources blocked from the scraper’s host IP are listed in `scripts/worker-sources.json` and synced into `src/lib/server/workerSources/` (generated — do not hand-edit `impl/` or generated `index.ts`).

```bash
pnpm sync-worker-sources   # copies adapters + regenerates index
```

---

## Tech stack

- **SvelteKit** + **Svelte 5** (`$state` / runes)
- **Cloudflare Workers** + **Wrangler** + **KV**
- **Cheerio** (hybrid Worker parsers only)
- **Firebase** (optional auth + cloud sync for bookmarks/history)
- **idb** — IndexedDB helpers
- **JSZip** — ZIP fallback downloads
- **lucide-svelte** — icons
- **flag-icons** (CDN in `app.html`) — language badges

---

## Main routes

| Path | Description |
|------|-------------|
| `/` | Homepage / multi-source browse |
| `/manga/[source]/[...id]` | Title detail + chapter list + download actions |
| `/reader/[source]/[...id]` | Manga image reader |
| `/novel-reader/[source]/[...id]` | Novel text reader |
| `/library` | **Offline Library** UI |
| `/bookmark` · `/history` · `/notification` | User lists |
| `/deep-search` | Cross-source search |
| `/community/*` | Forum |
| `/settings` · `/report` · `/admin` · `/stats` | Config / moderation / metrics |
| `/about` · `/privacy` | Legal / about |

### API routes (Worker)

| Path | Purpose |
|------|---------|
| `/api/chapters` | Paginated chapter list for a title |
| `/api/pages` | Chapter page image URLs |
| `/api/novel-chapter` | Novel chapter text/HTML |
| `/api/proxy` | Image / asset proxy |
| `/api/deep-search` | Aggregated search |
| `/api/warm` · `/api/cron/sync` | Cache maintenance |
| `/api/admin/*` | Health, sources, backup snapshot |
| `/api/translate` · `/api/tracker/*` | Optional helpers |

---

## Offline Library

Client-only feature (no server storage of chapter files).

### Storage

| Layer | Content |
|-------|---------|
| **IndexedDB** (`library` store) | Title metadata, offline chapter refs, `latestChapter`, `lang`, paths |
| **IndexedDB** (`libraryCovers`) | Cover image **blobs** for offline display |
| **Disk** (File System Access) | `RokuyomuLibrary/Manga/<Title>/<Chapter>/001.jpg…` · `…/cover.ext` · `RokuyomuLibrary/Novel/<Title>/<Chapter>.pdf` |

Handles for the library root are kept in memory and best-effort in a small FS IDB; Svelte `$state` proxies are **never** written to IDB (plain clones only) to avoid `DataCloneError`.

### UI actions

| Control | Behavior |
|---------|----------|
| **Folder** | Pick parent directory; app creates `RokuyomuLibrary` + `Manga` / `Novel` |
| **Sync Bookmarks** | Copy bookmark titles into Library (metadata only) |
| **Sync Updates** | Fetch chapter lists for all titles, refresh latest badges, sort by newest `timestamp` |
| **Download** (card) | Batch-download remaining chapters (modal warning + progress bar) |
| **Sync** (card) | Refresh meta for one title only |
| **Remove** | Drop Library metadata (disk files are not deleted) |

Chapter list on the title page shows a **checkmark** when that chapter is recorded offline.

### Download helpers

| Module | Role |
|--------|------|
| `utils/localFs.ts` | Directory picker, `saveMangaChapterToDisk`, `saveNovelPdfToDisk`, `saveCoverToDisk` |
| `utils/downloadChapter.ts` | Pages → disk folders or ZIP / sequential fallback |
| `utils/downloadNovelPdf.ts` | Chapter text → PDF → disk or browser download |
| `utils/cacheCover.ts` | Proxy fetch cover → IDB + disk |
| `stores/library.svelte.ts` | Reactive library API + events (`library-changed`) |

---

## Client data (IndexedDB)

Defined in `src/lib/db.ts` (versioned schema), including:

- `bookmarks`, `history`, `notifications`
- `activityLog`, `permanentStats`
- `library`, `libraryCovers`

Stores under `src/lib/stores/` wrap IDB and optional Firebase sync.

---

## Scripts

```bash
pnpm install
pnpm dev                 # Vite dev server
pnpm build               # production build + cron append
pnpm preview             # wrangler dev after build
pnpm check               # svelte-check
pnpm sync-worker-sources # refresh hybrid adapters from scraper
pnpm deploy              # sync → build → wrangler deploy
pnpm cf-typegen          # Wrangler types
```

---

## Configuration

### Wrangler / env

| Name | Purpose |
|------|---------|
| `SCRAPER_BASE_URL` | Absolute URL of the scraper service |
| KV binding `MIKOROKU_CACHE` | Response cache |
| Cron triggers | Warm / sync schedules in `wrangler.jsonc` |

### Firebase (optional)

Client config for auth and cloud backup of bookmarks / history. Without it, those features stay local-only.

### `scripts/worker-sources.json`

Array of source IDs that must run on the Worker. After edits:

```bash
pnpm sync-worker-sources
pnpm deploy
```

---

## Local development

```bash
# Terminal 1 — scraper
cd ../scraper && npm install && npx tsx src/index.ts

# Terminal 2 — frontend
cd frontend
pnpm install
# Ensure SCRAPER_BASE_URL points to http://localhost:3000 (wrangler vars or .env as you use)
pnpm dev
```

Open `http://localhost:5173`. For Offline disk downloads, use Chromium-based browsers.

---

## Deploy (Cloudflare)

```bash
cd frontend
pnpm deploy
```

Confirm:

1. `SCRAPER_BASE_URL` reaches the production scraper  
2. KV namespace is bound  
3. Cron routes are authorized as required by your setup  

---

## Notes & limits

- **Hybrid bundle size / CPU:** too many Worker sources increases cold CPU; keep `worker-sources.json` minimal.  
- **File System Access:** user gesture required to pick the folder; permission may need re-grant after browser restart.  
- **ZIP fallback:** used when directory API is unavailable.  
- **NSFW / source policy:** respect local laws and each source’s terms; this project is an aggregator, not a file host.

---

## Related

- [Root README](../README.md)  
- [Scraper README](../scraper/README.md)  
