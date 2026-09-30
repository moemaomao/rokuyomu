# Rokuyomu — Frontend

SvelteKit app deployed as **Cloudflare Worker**. UI + KV cache + hybrid scrape client (manga **&** novel).

Repo root: [moemaomao/rokuyomu](https://github.com/moemaomao/rokuyomu) · package ini: `frontend/`

---

## Role

| Tugas | Detail |
|-------|--------|
| UI | Browse, search, detail, image reader, **novel reader**, bookmark, history, settings, deep-search, community, notification, admin |
| Cache | Workers KV `MIKOROKU_CACHE` |
| Proxy data | `scraperClient.ts` → scraper Node **atau** parse lokal (hybrid) |
| Cron | Warm / sync cache tiap 20 menit |

**Tidak** menyimpan file manga/novel. Hanya agregasi metadata + URL halaman / teks dari source eksternal.

---

## Architecture (hybrid)

```
Browser
  → CF Worker (SvelteKit)
       → KV hit?  → return cache
       → KV miss  → scraperClient
            ├─ source ∈ WORKER_SOURCE_IDS  → workerSources (Cheerio di Worker)
            └─ else                        → GET {SCRAPER_BASE_URL}/...
```

Source yang diblokir outbound IP **Vercel** didaftarkan di `scripts/worker-sources.json`.  
Source lain selalu ke microservice `scraper/` (biasanya Vercel).

Saat ini ada **~44 source** di Worker (banyak Indo + beberapa internasional + novel). Bundle membesar — pantau CPU time.

---

## Tech

- SvelteKit 2 + Svelte 5 + TypeScript
- Tailwind CSS v4
- `@sveltejs/adapter-cloudflare`
- Cheerio (hanya untuk `workerSources`)
- Firebase (auth / sync opsional)
- jszip (download chapter)
- pnpm

---

## Structure

```
frontend/
├── src/
│   ├── lib/
│   │   ├── components/
│   │   ├── server/
│   │   │   ├── sources/           # Light registry (id + name only, ~118)
│   │   │   ├── workerSources/     # Hybrid adapters (blocked-on-Vercel)
│   │   │   │   ├── index.ts       # GENERATED — jangan edit manual
│   │   │   │   ├── BaseSource.ts
│   │   │   │   ├── types.ts
│   │   │   │   └── impl/          # GENERATED dari scraper
│   │   │   ├── scraperClient.ts   # Hybrid routing
│   │   │   ├── cache.ts
│   │   │   ├── warmCache.ts
│   │   │   ├── syncSources.ts
│   │   │   └── ...
│   │   ├── stores/                # auth, bookmark, history, preferredSources, forum, ...
│   │   └── utils/                 # novelSources, nsfw, downloadChapter, image, ...
│   ├── routes/
│   │   ├── +page.*                # Home / browse
│   │   ├── manga/[source]/[...id]/
│   │   ├── reader/[source]/[...id]/        # Image chapter
│   │   ├── novel-reader/[source]/[...id]/  # Novel (teks)
│   │   ├── deep-search/
│   │   ├── community/             # category, thread, new
│   │   ├── bookmark/ history/ settings/ report/ notification/
│   │   ├── admin/
│   │   ├── about/ privacy/
│   │   └── api/                   # pages, proxy, warm, cron, novel-chapter, translate, deep-search, admin/*
│   └── hooks.server.ts
├── scripts/
│   ├── worker-sources.json        # Daftar ID source yang dijalankan di Worker
│   ├── sync-worker-sources.mjs    # Auto-copy + generate index.ts
│   └── append-cron.js
├── wrangler.jsonc
├── package.json
└── svelte.config.js
```

---

## Setup

### Prerequisites

- Node.js 20+
- pnpm 9+
- Cloudflare account (Workers + KV)
- Scraper running (lokal atau production URL)

### Install

```bash
cd frontend
pnpm install
```

### Env

**Lokal** — `frontend/.env`:

```env
SCRAPER_BASE_URL=http://localhost:3000
# SCRAPER_API_KEY=optional
```

**Production** — `wrangler.jsonc` → `vars`:

```jsonc
"vars": {
  "SCRAPER_BASE_URL": "https://rokuyomu.vercel.app"
}
```

Opsional: `SCRAPER_API_KEY` (harus sama dengan scraper).

### Dev

```bash
# terminal lain: scraper harus hidup di :3000
pnpm dev
```

### Scripts

| Command | Keterangan |
|---------|------------|
| `pnpm dev` | Vite dev server |
| `pnpm build` | Build + append cron handler |
| `pnpm preview` | Build + `wrangler dev` |
| `pnpm check` | Type / svelte-check |
| `pnpm lint` / `pnpm format` | Lint / format |
| `pnpm sync-worker-sources` | Sync adapter dari scraper → workerSources |
| `pnpm deploy` | Sync + build + deploy Cloudflare Worker |
| `pnpm cf-typegen` | Generate Worker types |

---

## Hybrid: tambah source diblokir Vercel

1. Pastikan adapter sudah ada di `../scraper/src/sources/impl/` dan punya baris `id = 'namasource'`.
2. Tambah ID ke `scripts/worker-sources.json`.
3. Jalankan:

```bash
pnpm sync-worker-sources
```

Script akan:
- Copy file dari scraper → `src/lib/server/workerSources/impl/`
- Generate ulang `src/lib/server/workerSources/index.ts`
- Hapus file yang sudah tidak ada di daftar

4. (Opsional) tambah id ke `WARM_SOURCES` / `PRIORITY_SOURCES` agar cron mengisi KV.
5. `pnpm deploy` (sudah otomatis menjalankan sync).

> **Jangan edit manual** `workerSources/index.ts` atau file di `impl/`. Semua digenerate.

**Penting:** Jaga jumlah Worker source tetap wajar (~44 saat ini). Bundle membesar dan cold-start CPU naik. Hanya daftarkan yang benar-benar gagal di Vercel.

### Daftar Worker sources

Lihat isi file:

```
scripts/worker-sources.json
```

---

## Novel

- `src/lib/utils/novelSources.ts` — `NOVEL_SOURCE_IDS`, `isNovelSource()`, `chapterHref()` → `/novel-reader/...`
- Route: `routes/novel-reader/[source]/[...id]/`
- API: `routes/api/novel-chapter/+server.ts` (proxy ke scraper `/novel-chapter/*`)

---

## KV & Cron

- Binding: `MIKOROKU_CACHE`
- Cron: `*/20 * * * *` (`wrangler.jsonc` → `triggers.crons`)
- Key contoh: `browse:{sourceId}:p1:q:lall:tall:lim24`

Setelah ubah hybrid, cache lama bisa masih kosong/error sampai TTL habis atau key dihapus di dashboard Cloudflare KV.

---

## Deploy

```bash
pnpm deploy
```

Pastikan KV namespace id di `wrangler.jsonc` cocok dengan akun Cloudflare kamu.

---

## Catatan

- `sources/index.ts` = metadata saja (tanpa Cheerio).
- `scraperClient.ts` = satu pintu data untuk page server & API (hybrid-aware).
- `workerSources/index.ts` dan `impl/` digenerate oleh `pnpm sync-worker-sources`.
- Bundle Worker membesar jika terlalu banyak file di `workerSources/impl` — hanya daftarkan yang perlu.
- Parent README: `../README.md`
