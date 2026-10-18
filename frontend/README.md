# Rokuyomu — Frontend

SvelteKit app deployed as a **Cloudflare Worker**. UI, KV cache, hybrid scrape routing, and offline client (Download / Bookmark / History).

Monorepo: [moemaomao/rokuyomu](https://github.com/moemaomao/rokuyomu) · package: `frontend/`  
**Live:** [rokuyomu.mikoroku.workers.dev](https://rokuyomu.mikoroku.workers.dev)

---

## Tech stack

- **SvelteKit** + **Svelte 5**
- **Cloudflare Workers** + **KV** (`MIKOROKU_CACHE`)
- **Cheerio** (Worker-side parsers only)
- **Firebase** (optional auth / cloud sync)
- **idb**, **JSZip**, **lucide-svelte**

---

## Project layout

```
frontend/
├── src/
│   ├── app.html                  # HTML shell
│   ├── app.d.ts                  # App types
│   ├── hooks.server.ts           # Server hooks
│   ├── worker-configuration.d.ts
│   │
│   ├── lib/
│   │   ├── db.ts                 # IndexedDB (bookmarks, history, download metadata, covers…)
│   │   ├── firebase.ts           # Optional Firebase
│   │   ├── admin.ts
│   │   ├── assets/               # favicon, logo, placeholders
│   │   ├── components/           # Shared UI (Auth, Footer, HistoryWidget…)
│   │   ├── stores/               # Client state
│   │   │   ├── auth.svelte.ts
│   │   │   ├── bookmark.svelte.ts
│   │   │   ├── history.ts          # Reading history (cache 80 / disk unlimited)
│   │   │   ├── download.svelte.ts  # Download metadata and offline status
│   │   │   ├── preferences.ts      # Theme, privacy, historyStorageMode, hide folders
│   │   │   ├── notification.svelte.ts
│   │   │   └── …
│   │   ├── utils/
│   │   │   ├── localFs.ts          # File System Access: Download / Bookmark / History
│   │   │   ├── cacheCover.ts       # Cover blobs + disk covers
│   │   │   ├── downloadManga.ts    # Manga chapter → disk / zip
│   │   │   ├── downloadNovel.ts
│   │   │   ├── offlineChapter.ts
│   │   │   └── …
│   │   └── server/               # Worker-only
│   │       ├── scraperClient.ts  # Hybrid: Worker Cheerio vs Node scraper HTTP
│   │       ├── cache.ts          # KV helpers
│   │       ├── warmCache.ts
│   │       ├── workerSources/    # Generated / maintained Worker adapters
│   │       └── …
│   │
│   └── routes/                   # SvelteKit file-based routing
│       ├── +layout.svelte        # App chrome (sidebar, theme)
│       ├── +layout.server.ts
│       ├── +page.svelte          # Home browse
│       ├── +page.server.ts
│       ├── layout.css
│       │
│       ├── series/[source]/[...id]/  # Title detail  → /series/weloma/m/00oDS
│       ├── manga-reader/[source]/[...id]/  # Image reader
│       ├── novel-reader/[source]/[...id]/
│       ├── download/             # Download manager UI
│       ├── bookmark/
│       ├── history/              # History + storage mode toggle
│       ├── notification/
│       ├── deep-search/
│       ├── settings/             # Privacy, hide folders, backup
│       ├── source-preferences/
│       ├── community/
│       ├── report/ · admin/ · stats/ · about/ · privacy/
│       │
│       └── api/                  # Worker HTTP endpoints
│           ├── chapters/
│           ├── pages/
│           ├── novel-chapter/
│           ├── proxy/
│           ├── deep-search/
│           ├── warm/ · cron/sync/
│           └── admin/…
│
├── static/
├── scripts/                      # sync-worker-sources, deploy helpers
├── svelte.config.js
├── vite.config.ts
├── wrangler.jsonc                # CF Worker + KV + cron
└── package.json
```

### URL patterns (routes)

| Pattern (folder) | Example URL | Page |
|------------------|-------------|------|
| `/` | `/` | Home browse |
| `/series/[source]/[...id]` | `/series/weloma/m/00oDS` | Title detail + chapters |
| `/manga-reader/[source]/[...id]` | `/manga-reader/weloma/...` | Manga reader |
| `/novel-reader/[source]/[...id]` | `/novel-reader/...` | Novel reader |
| `/download` | `/download` | Download manager |
| `/bookmark` · `/history` · `/notification` | | User lists |
| `/settings` | `/settings` | Preferences & privacy |
| `/deep-search` | `/deep-search` | Cross-source search |
| `/api/manga-chapter` · `/api/pages` · … | | Worker APIs |

`[source]` = dynamic segment (source id).  
`[...id]` = catch-all (title id / path from the source).

---

## Offline disk layout

Granted parent folder creates a root (default **`Rokuyomu`**):

```
Rokuyomu/                 # or AppCache/ if “Hide main folder”
├── Download/             # or _media/
│   ├── Manga/<Title>/…
│   └── Novel/<Title>/…
├── Bookmark/             # or _fav/
│   ├── bookmarks.json
│   └── covers/
└── History/              # or _recent/  (when History = Local disk)
    ├── history.json
    └── covers/
```

Privacy checkboxes (Settings → Privacy) control each name independently. Only **new** writes use hidden names.

### History storage modes

| Mode | Backend | Limit |
|------|---------|-------|
| Browser cache | IndexedDB | max **80** |
| Local disk | IndexedDB + `History/history.json` + covers | unlimited (soft ~10k) |

Toggle on **`/history`**. Disk mode re-hydrates from `history.json` so the list is not stuck at 80.

Key files: `stores/history.ts`, `stores/preferences.ts`, `utils/localFs.ts`, `utils/cacheCover.ts`.

Path sanitization (`sanitizePathSegment`) strips mojibake / invalid filename chars; `getOrCreateDir` falls back to `title_<hash>` if the FS rejects a name.

---

## Local development

```bash
cd frontend
pnpm install
pnpm dev          # http://localhost:5173
```

Point `SCRAPER_BASE_URL` at the scraper (env / `wrangler.jsonc`).

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Dev server |
| `pnpm build` | Production build |
| `pnpm check` | Type / svelte-check |
| `pnpm deploy` | Sync worker sources → build → Wrangler |
| `pnpm sync-worker-sources` | Regenerate Worker adapters |

---

## Deploy

1. KV binding `MIKOROKU_CACHE` + vars in `wrangler.jsonc`
2. `pnpm sync-worker-sources` when adapters change
3. `pnpm deploy`

---

## Related

- [../README.md](../README.md) — monorepo overview  
- [../scraper/README.md](../scraper/README.md) — Node scrape API
