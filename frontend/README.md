# Rokuyomu — Frontend

SvelteKit app deployed as **Cloudflare Worker**. UI + KV cache + hybrid scrape client.

Repo root: [moemaomao/rokuyomu](https://github.com/moemaomao/rokuyomu) · package ini: `frontend/`

---

## Role

| Tugas | Detail |
|-------|--------|
| UI | Browse, search, detail, reader, bookmark, history, settings |
| Cache | Workers KV `MIKOROKU_CACHE` |
| Proxy data | `scraperClient.ts` → scraper Node **atau** parse lokal (hybrid) |
| Cron | Warm / sync cache tiap 20 menit |

**Tidak** menyimpan file manga. Hanya agregasi metadata + URL halaman dari source eksternal.

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

Source yang diblokir outbound IP **Vercel** didaftarkan di `src/lib/server/workerSources/`.  
Source lain selalu ke microservice `scraper/` (biasanya Vercel).

Saat ini ada **~30 source** di Worker (banyak Indo + beberapa internasional). Bundle membesar — pantau CPU time.

---

## Tech

- SvelteKit 2 + Svelte 5 + TypeScript
- Tailwind CSS v4
- `@sveltejs/adapter-cloudflare`
- Cheerio (hanya untuk `workerSources`)
- Firebase (auth / sync opsional)
- pnpm

---

## Structure

```
frontend/
├── src/
│   ├── lib/
│   │   ├── components/
│   │   ├── server/
│   │   │   ├── sources/           # Light registry (id + name only)
│   │   │   ├── workerSources/     # Hybrid adapters (blocked-on-Vercel)
│   │   │   │   ├── index.ts       # WORKER_SOURCE_IDS + registry
│   │   │   │   ├── BaseSource.ts
│   │   │   │   ├── types.ts
│   │   │   │   └── impl/          # ~30 adapter (copy dari scraper)
│   │   │   ├── scraperClient.ts   # Hybrid routing
│   │   │   ├── cache.ts
│   │   │   ├── warmCache.ts
│   │   │   ├── syncSources.ts
│   │   │   └── ...
│   │   ├── stores/
│   │   └── utils/
│   ├── routes/
│   │   ├── +page.*                # Home / browse
│   │   ├── manga/[source]/[...id]/
│   │   ├── reader/[source]/[...id]/
│   │   ├── bookmark/ history/ settings/ report/
│   │   ├── about/ privacy/
│   │   └── api/pages | proxy | warm | cron
│   └── hooks.server.ts
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
| `pnpm deploy` | Build + deploy Cloudflare Worker |
| `pnpm cf-typegen` | Generate Worker types |

---

## Hybrid: tambah source diblokir Vercel

1. Copy adapter dari scraper:
   ```bash
   cp ../scraper/src/sources/impl/Xxx.ts \
      src/lib/server/workerSources/impl/Xxx.ts
   ```
2. Register di `src/lib/server/workerSources/index.ts`:
   ```ts
   import { XxxSource } from './impl/Xxx';
   // ...
   const workerSources: Record<string, IMangaSource> = {
     xxx: new XxxSource(),
     // ...
   };
   ```
3. (Opsional) tambah id ke `WARM_SOURCES` / `PRIORITY_SOURCES` agar cron mengisi KV.
4. `pnpm deploy`.

**Penting:** Jaga jumlah Worker source tetap wajar. Saat ini sudah ~30 — bundle membesar dan cold-start CPU naik. Hanya copy yang benar-benar gagal di Vercel.

### Daftar Worker sources (saat ini)

`klz9`, `zonatmo`, `lectortmo`, `rawkuma`, `athreascans`, `flamecomics`, `hentairead`, `kingcomix`, `manhuarmtl`, `onemanga`, `simplyhentai`, `weebcentral`, `ainzscans`, `bacakomik`, `bacami`, `crotpedia`, `doujinku`, `holodek`, `ikiru`, `kiryuu`, `komikindo`, `komikstation`, `lumos`, `luvyaa`, `manhwadesu`, `manhwaindo`, `ngomik`, `pixhentai`, `sasangeyou`, `siikomik`, …

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
- `getWorkerSource()` mengembalikan instance langsung (sync). Kode pemanggil boleh `await` (harmless).
- Bundle Worker membesar jika terlalu banyak file di `workerSources/impl` — hanya copy yang perlu.
- Parent README: `../README.md`
