# Rokuyomu — Scraper

**Node.js** microservice (**Express** + **Cheerio**) that scrapes external manga/comic **and** novel sites and returns normalized JSON.

The Cloudflare Worker frontend calls this service over HTTP so Worker CPU stays low on the free tier. Optional **Byparr** integration solves Cloudflare challenges.

Monorepo: [moemaomao/rokuyomu](https://github.com/moemaomao/rokuyomu) · this package: `scraper/`

---

## Role

| Task | Detail |
|------|--------|
| HTML / API parsing | Per-site adapters under `src/sources/impl/` |
| JSON API | Latest, search, detail, chapter pages, novel chapter body |
| CF bypass | `fetchWithCf` → Byparr + per-domain cookie jar |
| Deploy | Vercel serverless (or Render / Koyeb / Fly / bare Node) |

The frontend does **not** import scraper adapters at runtime for normal sources. It calls:

```http
GET /:sourceId/latest
GET /:sourceId/search?q=
GET /:sourceId/manga/*
GET /:sourceId/chapter/*
GET /:sourceId/novel-chapter/*
GET /:sourceId/manga-from-chapter?chapter=
GET /health
```

Source IDs listed in the frontend’s `WORKER_SOURCE_IDS` are parsed **on the Worker** instead and never hit this service for those routes.

Adapter scale (approximate, changes often): **~100+ manga**, **~80+ novel** TypeScript modules under `impl/manga` and `impl/novel`.

---

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness + Byparr / cookie-jar stats |
| `GET` | `/:sourceId/latest` | Latest updates (pagination via query as implemented) |
| `GET` | `/:sourceId/search` | Search titles |
| `GET` | `/:sourceId/manga/*` | Title details + chapters |
| `GET` | `/:sourceId/chapter/*` | Page image URL list |
| `GET` | `/:sourceId/novel-chapter/*` | Novel chapter content |
| `GET` | `/:sourceId/manga-from-chapter` | Resolve title from a chapter URL/id |

Exact query parameters depend on the adapter (page, lang, q, chapter, …). Responses are JSON shaped for the frontend’s `Manga` / `MangaDetails` / `Chapter` types (`src/sources/types.ts`, `types-novel.ts`).

Example health:

```bash
curl http://localhost:3000/health
```

```json
{
  "ok": true,
  "ts": 1727800000000,
  "byparr": true,
  "byparrUrl": "(set)",
  "cfJar": { "size": 2, "alive": 2 }
}
```

---

## Project structure

```
scraper/
├── src/
│   ├── index.ts              # Express app + route wiring
│   ├── lib/
│   │   ├── byparr.ts         # HTTP client for Byparr /v1
│   │   ├── cfCookieJar.ts    # Domain cookie + UA cache (TTL)
│   │   └── fetchWithCf.ts    # Fetch, detect CF challenge, solve, retry
│   └── sources/
│       ├── index.ts          # getAllMangaSources / getAllNovelSources / getAllSources
│       ├── BaseSource.ts     # shared fetchHtml → fetchWithCf
│       ├── types.ts          # manga interfaces
│       ├── types-novel.ts    # novel interfaces
│       └── impl/
│           ├── manga/        # one file per source adapter
│           └── novel/
├── api/index.js              # esbuild CJS bundle for Vercel (generated)
├── vercel.json
├── render.yaml               # optional alternate host
└── package.json
```

---

## Byparr (Cloudflare bypass)

Flow inside the scraper:

1. `BaseSource.fetchHtml` uses `fetchWithCf`.  
2. If the response looks like a CF challenge (markers / 403 + `cf-ray`) → call Byparr.  
3. Store cookies + user-agent in `cfCookieJar` (per domain, TTL).  
4. Return solved body or retry with stored cookies.

### Run Byparr

**Docker (recommended):**

```bash
docker run -d --name byparr -p 8191:8191 --restart unless-stopped \
  ghcr.io/thephaseless/byparr:latest
```

**Local (uv):**

```bash
git clone https://github.com/ThePhaseless/Byparr
cd Byparr
uv run main.py
# → http://localhost:8191  · docs at /docs
```

### Scraper env

| Variable | Default | Meaning |
|----------|---------|---------|
| `BYPARR_URL` | _(empty)_ | e.g. `http://localhost:8191`. Empty = Byparr **disabled** |
| `CF_COOKIE_TTL_MS` | `900000` | Cookie TTL (15 minutes) |
| `PORT` | `3000` | Listen port (local / Render) |
| `SCRAPER_API_KEY` | _(empty)_ | Optional shared secret if you add auth |
| `VERCEL` | _(platform)_ | Skip `app.listen` on Vercel |

Without `BYPARR_URL`, CF-protected sources fail with an explicit error that Byparr is disabled.

---

## Local setup

```bash
cd scraper
npm install
```

**Linux / macOS / Git Bash:**

```bash
BYPARR_URL=http://localhost:8191 npx tsx src/index.ts
```

**Windows PowerShell:**

```powershell
$env:BYPARR_URL="http://localhost:8191"
npx tsx src/index.ts
```

Useful `package.json` scripts:

```json
{
  "scripts": {
    "dev": "tsx src/index.ts",
    "start": "tsx src/index.ts",
    "build": "esbuild src/index.ts --bundle --platform=node --target=node20 --format=cjs --outfile=api/index.js",
    "vercel-build": "esbuild src/index.ts --bundle --platform=node --target=node20 --format=cjs --outfile=api/index.js"
  }
}
```

---

## Adding a source

1. Create `src/sources/impl/manga/YourSource.ts` or `impl/novel/…` implementing `IMangaSource` / novel interface.  
2. Register it in the manga or novel registry used by `getAllMangaSources` / `getAllNovelSources`.  
3. Test: `GET /yourSourceId/latest`, detail, chapter/pages or novel-chapter.  
4. If the site blocks the scraper host but not Cloudflare’s edge, add the id to **`frontend/scripts/worker-sources.json`** and run `pnpm sync-worker-sources` in `frontend/`.  
5. Prefer resilient selectors; handle missing optional fields (`lang`, `cover`, …).

`BaseSource` already routes HTML through `fetchWithCf` — do not bypass it unless you have a special case.

---

## Deploy

### Vercel (default)

- Build command: `npm run vercel-build` (or project setting equivalent)  
- Output: `api/index.js` serverless entry  
- Set env vars in the Vercel project (`BYPARR_URL` only if Byparr is reachable from Vercel — often **not** true for `localhost`; use a public Byparr URL or omit)

### Render / Koyeb / Fly

- Start: `npx tsx src/index.ts` or Node on the built bundle  
- Expose `PORT`  
- Attach persistent Byparr on a private network if needed  

Point the frontend Worker’s `SCRAPER_BASE_URL` at the public HTTPS origin of this service.

---

## Operational tips

- **Rate limits / bans:** adapters should be polite; prefer KV-cached responses on the Worker.  
- **Cookie jar size:** monitor `/health` → `cfJar`.  
- **Bundle size on Vercel:** all adapters ship in one esbuild bundle; remove dead sources if limits are hit.  
- **Contract with frontend:** keep JSON field names stable (`id`, `title`, `cover`, `chapters`, `pages`, novel `content` / `text`).  

---

## Related

- [Root README](../README.md)  
- [Frontend README](../frontend/README.md)  
- [Byparr](https://github.com/ThePhaseless/Byparr)  
