# Rokuyomu — Scraper

Microservice **Node.js** (Express + Cheerio) untuk scraping source manga/comics.

Dipakai frontend Cloudflare Worker lewat HTTP JSON supaya Worker tetap di free tier (CPU kecil).

Repo: [moemaomao/rokuyomu](https://github.com/moemaomao/rokuyomu) · package ini: `scraper/`

---

## Role

| Tugas | Detail |
|-------|--------|
| Parse HTML / API source | Cheerio + adapter per situs |
| API JSON | Latest, search, detail, chapter pages |
| Deploy | Vercel serverless (atau Render / Koyeb / Fly) |

Frontend **tidak** import adapter scraper secara default. Request datang sebagai:

```
GET /:sourceId/latest
GET /:sourceId/manga/*
GET /:sourceId/chapter/*
```

---

## API

| Method | Path | Keterangan |
|--------|------|------------|
| `GET` | `/health` | `{ ok: true, ts }` |
| `GET` | `/sources` | Daftar `{ id, name }[]` |
| `GET` | `/:sourceId/latest` | Query: `page`, `lang`, `type`, `q` (search jika `q` diisi) |
| `GET` | `/:sourceId/manga/*` | Detail manga + chapters. Query: `lang` |
| `GET` | `/:sourceId/chapter/*` | Array URL halaman gambar |

### Auth (opsional)

Set env `SCRAPER_API_KEY`. Client mengirim header:

```http
x-api-key: <sama dengan SCRAPER_API_KEY>
```

atau `?api_key=...`.

### Contoh

```bash
curl http://localhost:3000/health
curl "http://localhost:3000/asura/latest?page=1&lang=all&type=all"
curl "http://localhost:3000/asura/manga/some-slug?lang=all"
curl "http://localhost:3000/asura/chapter/some-slug/chapter-1"
```

---

## Structure

```
scraper/
├── src/
│   ├── index.ts              # Express app + routes
│   └── sources/
│       ├── BaseSource.ts     # fetchHtml / fetchJson helpers
│       ├── types.ts
│       ├── index.ts          # Registry semua adapter
│       └── impl/             # Satu file per source (~80)
├── api/
│   └── index.js              # Output esbuild (Vercel) — jangan edit manual
├── package.json
├── tsconfig.json
├── vercel.json
└── render.yaml               # Opsional Render
```

---

## Setup lokal

### Prerequisites

- Node.js 20+

### Install & run

```bash
cd scraper
npm install
npx tsx src/index.ts
# → http://localhost:3000
```

Disarankan tambah script di `package.json`:

```json
"scripts": {
  "dev": "tsx src/index.ts",
  "start": "tsx src/index.ts",
  "build": "esbuild src/index.ts --bundle --platform=node --target=node20 --format=cjs --outfile=api/index.js",
  "vercel-build": "esbuild src/index.ts --bundle --platform=node --target=node20 --format=cjs --outfile=api/index.js"
}
```

Lalu:

```bash
npm run dev
```

### Health

```bash
curl http://localhost:3000/health
```

---

## Deploy

### Vercel (default repo)

- Root directory: `scraper`
- Build command: `npm run vercel-build`
- Output: `api/index.js` (serverless)
- Env opsional: `SCRAPER_API_KEY`

Setelah live, set di frontend:

```
SCRAPER_BASE_URL=https://rokuyomu.vercel.app
```

### Render / Koyeb / Fly (alternatif)

Jika IP Vercel diblokir banyak source, deploy scraper yang sama ke host lain dan arahkan frontend ke URL itu (atau hybrid dual-URL).

Contoh Render Web Service:

- Build: `npm install`
- Start: `npx tsx src/index.ts` (atau `npm start`)
- Free tier bisa sleep → ping `/health` berkala

---

## Menambah source baru

1. Buat `src/sources/impl/NamaSource.ts` extends `BaseSource`.
2. Implement:
   - `getLatestManga`
   - `searchManga`
   - `getMangaDetails`
   - `getChapterPages`
3. Register di `src/sources/index.ts`.
4. Tambah metadata id/name di **frontend** `src/lib/server/sources/index.ts`.
5. Deploy scraper (+ frontend jika registry berubah).

### Source diblokir Vercel

Jangan andalkan scraper Vercel untuk source itu. Di frontend:

1. Copy file adapter ke `frontend/src/lib/server/workerSources/impl/`
2. Register di `workerSources/index.ts`

Lihat `frontend/README.md` (hybrid).

---

## TypeScript / IDE

File `api/index.js` adalah **bundle** esbuild. VS Code sering menampilkan false error (`#state`, private fields).

Di `tsconfig.json`:

```json
"exclude": ["node_modules", "dist", "api"]
```

Jangan commit perubahan manual di `api/index.js` kecuali dari `npm run build`.

---

## Env

| Variable | Keterangan |
|----------|------------|
| `PORT` | Default `3000` (lokal / Render) |
| `SCRAPER_API_KEY` | Opsional; wajib match frontend |
| `VERCEL` | Di-set platform; skip `app.listen` di Vercel |

---

## Catatan

- CORS: `origin: true` (siap dipanggil Worker).
- Error scraping → `500` + `{ error: "..." }` (detail di server log).
- Frontend hybrid: source di `WORKER_SOURCE_IDS` **tidak** memanggil API ini.
- Parent README: `../README.md`
