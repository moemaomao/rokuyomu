# Rokuyomu (Mikoroku v2)

Multi-source **manga, comics & novel** reader — **SvelteKit** on **Cloudflare Workers**, scraping via **Node microservice** (+ hybrid untuk source yang diblokir Vercel) + **Byparr** untuk bypass Cloudflare.

Aggregates latest updates and search from many sources (manga, manhwa, manhua, doujin, hentai, light novel, dll.) in one place.

**Live:** [rokuyomu](https://rokuyomu.mikoroku.workers.dev) · Repo: [moemaomao/rokuyomu](https://github.com/moemaomao/rokuyomu)

---

## Features

- Multi-source browsing & search (manga **dan** novel)
- Manga / novel detail (cover, description, genres, chapter list)
- Chapter reader (image) + **novel reader** (teks)
- Bookmark & reading history (local / Firebase sync)
- Language / type filters
- Preferred sources (homepage multi-source)
- **Deep search** lintas source
- **Community** (forum / thread)
- Notifications
- Chapter download (ZIP)
- Cloudflare Workers KV cache (`MIKOROKU_CACHE`)
- Cron warm/sync cache (setiap 20 menit)
- Dark / light theme
- Report broken source / chapter
- Admin panel (health, sources, backup snapshot)
- **Hybrid scrape:** source yang diblokir outbound IP Vercel dijalankan langsung di Cloudflare Worker (Cheerio)
- **Byparr:** bypass Cloudflare challenge di scraper (cookie jar + auto-retry)

---

## Architecture

```
UI
 └─ Cloudflare Worker (SvelteKit)
      ├─ KV cache (browse / manga / pages / novel)
      └─ scraperClient (hybrid)
           ├─ source ∈ WORKER_SOURCE_IDS  → parse lokal di Worker (Cheerio)
           └─ source lainnya              → HTTP JSON ke scraper Node (Vercel/Render)
                └─ fetchWithCf → Byparr (jika CF challenge)
```

| Layer | Role | Deploy |
|-------|------|--------|
| **frontend/** | UI + thin proxy + KV + hybrid Worker sources | Cloudflare Workers |
| **scraper/** | Express + Cheerio, **~118** source adapters (manga + novel) + Byparr client | Vercel (atau Render/Koyeb/Fly) |
| **Byparr** | Anti-bot solver (Camoufox) — opsional, self-hosted | Docker / lokal (port 8191) |

Worker free tier tetap aman selama mayoritas request hanya `fetch()` JSON. Cheerio di Worker **hanya** untuk source yang gagal dari IP Vercel.

> **Catatan:** Saat ini ada **~44 source** di `WORKER_SOURCE_IDS` (banyak Indo + beberapa internasional + novel yang diblokir). Bundle Worker membesar — pantau CPU time di dashboard Cloudflare.

---

## Tech Stack

- **SvelteKit** 2 + Svelte 5 + TypeScript
- **Tailwind CSS** v4
- **Cloudflare Workers** + Workers KV + Cron Triggers
- **Express** + **Cheerio** (scraper microservice)
- **Byparr** (FlareSolverr-compatible anti-bot bypass)
- **Firebase** (auth / sync opsional)
- **jszip** (download chapter)
- **pnpm** (frontend) · **npm** (scraper)

---

## Project Structure

```
rokuyomu/
├── frontend/                         # SvelteKit → Cloudflare Worker
│   ├── src/
│   │   ├── lib/
│   │   │   ├── components/
│   │   │   ├── server/
│   │   │   │   ├── sources/          # Metadata source saja (light registry, ~118)
│   │   │   │   ├── workerSources/    # Adapter hybrid (source diblokir Vercel)
│   │   │   │   │   ├── index.ts      # GENERATED — jangan edit manual
│   │   │   │   │   ├── BaseSource.ts
│   │   │   │   │   ├── types.ts
│   │   │   │   │   └── impl/         # GENERATED dari scraper (via sync script)
│   │   │   │   ├── scraperClient.ts  # Hybrid routing
│   │   │   │   ├── cache.ts
│   │   │   │   ├── warmCache.ts
│   │   │   │   ├── syncSources.ts
│   │   │   │   └── ...
│   │   │   ├── stores/               # auth, bookmark, history, preferredSources, ...
│   │   │   └── utils/                # novelSources, nsfw, downloadChapter, ...
│   │   └── routes/
│   │       ├── +page.*               # Homepage / browse
│   │       ├── manga/[source]/[...id]/
│   │       ├── reader/[source]/[...id]/       # Image chapter reader
│   │       ├── novel-reader/[source]/[...id]/ # Novel (teks) reader
│   │       ├── deep-search/
│   │       ├── community/            # Forum: category, thread, new
│   │       ├── bookmark/ history/ settings/ report/ notification/
│   │       ├── admin/                # Health, sources, backup
│   │       ├── about/ privacy/
│   │       └── api/                  # pages, proxy, warm, cron, novel-chapter, ...
│   ├── scripts/
│   │   ├── worker-sources.json       # Daftar ID source yang dijalankan di Worker
│   │   ├── sync-worker-sources.mjs   # Script auto-copy + generate index.ts
│   │   └── append-cron.js
│   ├── wrangler.jsonc                # SCRAPER_BASE_URL, KV, cron
│   └── package.json
│
└── scraper/                          # Node microservice
    ├── src/
    │   ├── index.ts                  # Express API (+ novel-chapter + Byparr health)
    │   ├── lib/
    │   │   ├── byparr.ts             # Client ke Byparr /v1
    │   │   ├── cfCookieJar.ts        # Cookie jar per-domain (TTL)
    │   │   └── fetchWithCf.ts        # Fetch + deteksi CF challenge → Byparr
    │   └── sources/
    │       ├── index.ts              # Full registry (~118 adapters)
    │       ├── BaseSource.ts         # fetchHtml → fetchWithCf
    │       ├── types.ts              # Manga types
    │       ├── types-novel.ts        # Novel types (INovelSource, ...)
    │       └── impl/                 # Semua adapter manga + novel
    ├── api/index.js                  # Bundle esbuild (Vercel) — jangan edit manual
    ├── vercel.json
    ├── render.yaml
    └── package.json
```

---

## Prerequisites

- Node.js 20+
- pnpm 9+ (frontend)
- npm (scraper)
- Cloudflare account (Workers + KV)
- Akun Vercel / Render (scraper)
- **(Opsional)** Docker — untuk Byparr (bypass Cloudflare)

---

## Development

### 0. Byparr (opsional, terminal 0) — bypass Cloudflare

Byparr = self-hosted anti-bot solver (drop-in FlareSolverr). Scraper memanggil `BYPARR_URL` kalau ketemu Cloudflare challenge.

**Docker (paling gampang):**

```bash
docker run -d --name byparr -p 8191:8191 ghcr.io/thephaseless/byparr:latest
```

Docs API: `http://localhost:8191/docs`

**Lokal (tanpa Docker):**

```bash
# install uv dulu: https://docs.astral.sh/uv/
git clone https://github.com/ThePhaseless/Byparr
cd Byparr
uv run main.py
# → http://localhost:8191
```

Setelah Byparr hidup, set env di scraper:

```bash
export BYPARR_URL=http://localhost:8191
# opsional: CF_COOKIE_TTL_MS=900000   # default 15 menit
```

Health scraper akan menampilkan `byparr: true` kalau env ter-set:

```bash
curl http://localhost:3000/health
# { "ok": true, "byparr": true, "byparrUrl": "(set)", "cfJar": { "size": 0, "alive": 0 }, ... }
```

> Tanpa `BYPARR_URL`, source yang kena CF challenge akan error: `Cloudflare challenge ... (Byparr disabled; set BYPARR_URL)`.

### 1. Scraper (terminal 1)

```bash
cd scraper
npm install
```

**Linux / macOS / Git Bash:**

```bash
# dengan Byparr:
BYPARR_URL=http://localhost:8191 npx tsx src/index.ts
# tanpa Byparr:
npx tsx src/index.ts
# → http://localhost:3000
```

**Windows PowerShell:**

```powershell
# dengan Byparr:
$env:BYPARR_URL="http://localhost:8191"
npx tsx src/index.ts

# tanpa Byparr:
npx tsx src/index.ts
# → http://localhost:3000
```

Disarankan script di `scraper/package.json`:

```json
"scripts": {
  "dev": "tsx src/index.ts",
  "start": "tsx src/index.ts",
  "build": "esbuild src/index.ts --bundle --platform=node --target=node20 --format=cjs --outfile=api/index.js",
  "vercel-build": "esbuild src/index.ts --bundle --platform=node --target=node20 --format=cjs --outfile=api/index.js"
}
```

Health check: `curl http://localhost:3000/health`

### 2. Frontend (terminal 2)

```bash
cd frontend
pnpm install
```

Buat `frontend/.env`:

```env
SCRAPER_BASE_URL=http://localhost:3000
# SCRAPER_API_KEY=optional
```

```bash
pnpm dev
# → http://localhost:5173 (atau port Vite)
```

### Scripts frontend

| Command | Keterangan |
|---------|------------|
| `pnpm dev` | Dev server |
| `pnpm build` | Build + append cron |
| `pnpm preview` | Build + `wrangler dev` |
| `pnpm check` | svelte-check |
| `pnpm lint` / `pnpm format` | ESLint / Prettier |
| `pnpm sync-worker-sources` | Sync adapter blocked sources dari scraper |
| `pnpm deploy` | Sync + build + deploy ke Cloudflare Workers |
| `pnpm cf-typegen` | Generate Worker types |

---

## Production deploy

### Byparr (self-hosted)

Jalankan Byparr di VPS / home server (Docker), lalu set `BYPARR_URL` di env scraper (Render/Koyeb/Fly — **bukan** Vercel serverless, karena Byparr butuh long-running browser).

```bash
docker run -d --name byparr -p 8191:8191 --restart unless-stopped ghcr.io/thephaseless/byparr:latest
```

Contoh env scraper (Render):

```
BYPARR_URL=http://IP-VPS-KAMU:8191
# atau internal network: http://byparr:8191
CF_COOKIE_TTL_MS=900000
```

> Vercel serverless **tidak cocok** untuk Byparr (cold start + no persistent cookie jar). Kalau banyak source kena CF, deploy scraper ke Render/Koyeb/Fly + Byparr di sampingnya.

### Scraper → Vercel (tanpa Byparr) / Render (dengan Byparr)

- Root directory: `scraper`
- Build: `npm run vercel-build` (esbuild → `api/index.js`) — Vercel
- Atau Render: start `npx tsx src/index.ts`, env `BYPARR_URL=...`
- Catat URL, contoh: `https://rokuyomu.vercel.app`

### Frontend → Cloudflare

`frontend/wrangler.jsonc` (vars):

```jsonc
"vars": {
  "SCRAPER_BASE_URL": "https://rokuyomu.vercel.app"
}
```

```bash
cd frontend
pnpm deploy
```

Opsional: `SCRAPER_API_KEY` (sama di scraper & frontend).

---

## Hybrid sources (diblokir Vercel)

Beberapa situs memblokir outbound IP Vercel. Source tersebut dijalankan langsung di Cloudflare Worker (Cheerio).

### Alur

```
source ∈ WORKER_SOURCE_IDS  → Cheerio di CF Worker
source lainnya              → scraper Vercel/Render (+ Byparr jika CF)
```

Daftar ID disimpan di:

```
frontend/scripts/worker-sources.json
```

### Menambah source blocked (otomatis)

1. Pastikan adapter sudah ada di `scraper/src/sources/impl/` dan punya `id = 'namasource'`.
2. Tambah ID ke `frontend/scripts/worker-sources.json`.
3. Jalankan:

```bash
cd frontend
pnpm sync-worker-sources
```

Script akan:
- Copy file adapter dari scraper → `workerSources/impl/`
- Generate ulang `workerSources/index.ts` (WORKER_SOURCE_IDS + loaders)
- Hapus file orphan yang sudah tidak ada di daftar

4. (Opsional) tambah id ke `WARM_SOURCES` / `PRIORITY_SOURCES` agar cron mengisi KV.
5. `pnpm deploy` (sudah otomatis menjalankan sync dulu).

> **Jangan edit manual** `workerSources/index.ts` atau file di `impl/`. Semua digenerate oleh script.

Jaga jumlah Worker source tetap wajar. Bundle membesar + cold start CPU naik jika terlalu banyak.

### Warm / sync cache

`warmCache.ts` & `syncSources.ts` memanggil `remoteLatest` (hybrid-aware).  
Masukkan id source blocked ke `WARM_SOURCES` / `PRIORITY_SOURCES` agar cron mengisi KV.

Cron: `*/20 * * * *` (lihat `wrangler.jsonc`).

---

## Novel support

Source novel punya `kind: 'novel'` dan implement `getChapterContent` (bukan `getChapterPages`).

- Frontend: `utils/novelSources.ts` (`NOVEL_SOURCE_IDS`, `chapterHref` → `/novel-reader/...`)
- Route: `/novel-reader/[source]/[...id]`
- Scraper API: `GET /:sourceId/novel-chapter/*`
- Types: `scraper/src/sources/types-novel.ts`

---

## Scraper API

| Endpoint | Keterangan |
|----------|------------|
| `GET /health` | Health check (+ status Byparr & CF cookie jar) |
| `GET /sources` | Daftar source |
| `GET /:sourceId/latest?page&lang&type&q` | Latest / search |
| `GET /:sourceId/manga/*` | Detail manga/novel |
| `GET /:sourceId/chapter/*` | Halaman gambar chapter |
| `GET /:sourceId/novel-chapter/*` | Konten teks chapter novel |
| `GET /:sourceId/manga-from-chapter?chapter=...` | Resolve mangaId dari chapter (opsional) |

Header opsional: `x-api-key` jika `SCRAPER_API_KEY` di-set.

### Env scraper (Byparr)

| Variable | Default | Keterangan |
|----------|---------|------------|
| `BYPARR_URL` | (kosong) | URL Byparr, contoh `http://localhost:8191`. Kosong = Byparr off |
| `CF_COOKIE_TTL_MS` | `900000` (15 mnt) | TTL cookie CF di jar per-domain |
| `PORT` | `3000` | Port lokal / Render |
| `SCRAPER_API_KEY` | (kosong) | Opsional; wajib match frontend |
| `VERCEL` | (platform) | Skip `app.listen` di Vercel |

---

## Catatan

- **KV** menyimpan hasil browse/detail/pages — setelah ganti hybrid, tunggu TTL atau hapus key lama di dashboard Cloudflare.
- Bundle `scraper/api/index.js` untuk Vercel; jangan diedit manual; exclude dari `tsconfig` (`"exclude": ["api"]`).
- Free tier Render/Koyeb bisa sleep — ping `/health` berkala jika scraper dipindah ke sana.
- Frontend source registry = metadata only; scraping penuh di scraper atau `workerSources`.
- Source baru ditambahkan di scraper; register juga di frontend light registry (`src/lib/server/sources/index.ts`).
- Beberapa source berisi konten R18 — gunakan secara bertanggung jawab sesuai hukum setempat.
- **Byparr** tidak menjamin 100% bypass; success rate naik kalau egress IP “bersih”. Cookie di-cache per domain biar tidak solve ulang tiap request.

---

## License

Lihat `frontend/LICENSE.txt`.
