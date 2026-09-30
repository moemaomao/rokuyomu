# Rokuyomu — Scraper

Microservice **Node.js** (Express + Cheerio) untuk scraping source manga/comics **dan novel**.

Dipakai frontend Cloudflare Worker lewat HTTP JSON supaya Worker tetap di free tier (CPU kecil).

Repo: [moemaomao/rokuyomu](https://github.com/moemaomao/rokuyomu) · package ini: `scraper/`

---

## Role

| Tugas | Detail |
|-------|--------|
| Parse HTML / API source | Cheerio + adapter per situs (~118) |
| API JSON | Latest, search, detail, chapter pages, **novel chapter content** |
| Deploy | Vercel serverless (atau Render / Koyeb / Fly) |

Frontend **tidak** import adapter scraper secara default.  
Request datang sebagai:

```
GET /:sourceId/latest
GET /:sourceId/manga/*
GET /:sourceId/chapter/*
GET /:sourceId/novel-chapter/*
GET /:sourceId/manga-from-chapter?chapter=...
```

Source yang ada di `WORKER_SOURCE_IDS` (frontend) **tidak** memanggil API ini — di-parse langsung di Cloudflare Worker.

---

## API

| Method | Path | Keterangan |
|--------|------|------------|
| `GET` | `/health` | `{ ok: true, ts }` |
| `GET` | `/sources` | Daftar `{ id, name }[]` |
| `GET` | `/:sourceId/latest` | Query: `page`, `lang`, `type`, `q` (search jika `q` diisi) |
| `GET` | `/:sourceId/manga/*` | Detail manga/novel + chapters. Query: `lang` |
| `GET` | `/:sourceId/chapter/*` | Array URL halaman gambar |
| `GET` | `/:sourceId/novel-chapter/*` | Konten teks chapter novel (`title`, `content`, prev/next) |
| `GET` | `/:sourceId/manga-from-chapter` | Query: `chapter` → `{ mangaId }` (opsional) |

### Auth (opsional)

Set env `SCRAPER_API_KEY`.  
Client mengirim header:

```
x-api-key: <SCRAPER_API_KEY>
```

---

## Structure

```
scraper/
├── src/
│   ├── index.ts              # Express app + routes
│   └── sources/
│       ├── index.ts          # Registry + getSource / getAllSources
│       ├── BaseSource.ts
│       ├── types.ts          # Manga types (IMangaSource, ...)
│       ├── types-novel.ts    # Novel types (INovelSource, NovelChapterContent, ...)
│       └── impl/             # ~118 adapter (manga + novel)
├── api/index.js              # esbuild bundle (Vercel) — JANGAN edit manual
├── vercel.json
├── render.yaml
├── package.json
└── tsconfig.json
```

---

## Setup lokal

```bash
cd scraper
npm install
npx tsx src/index.ts
# → http://localhost:3000
```

Atau tambah script:

```json
"scripts": {
  "dev": "tsx src/index.ts",
  "start": "tsx src/index.ts",
  "build": "esbuild src/index.ts --bundle --platform=node --target=node20 --format=cjs --outfile=api/index.js",
  "vercel-build": "esbuild src/index.ts --bundle --platform=node --target=node20 --format=cjs --outfile=api/index.js"
}
```

Health:

```bash
curl http://localhost:3000/health
```

---

## Deploy

### Vercel (default)

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

### Manga

1. Buat `src/sources/impl/NamaSource.ts` extends `BaseSource`.
2. Implement:
   - `getLatestManga`
   - `searchManga`
   - `getMangaDetails`
   - `getChapterPages`
   - (opsional) `resolveMangaIdFromChapter`
3. Register di `src/sources/index.ts`.
4. Tambah metadata id/name di **frontend** `src/lib/server/sources/index.ts`.
5. Deploy scraper (+ frontend jika registry berubah).

### Novel

1. Buat adapter yang implement `INovelSource` (`types-novel.ts`):
   - `getLatestNovels` / `searchNovels` / `getNovelDetails` / `getChapterContent`
   - Set `kind: 'novel'`
2. Register di `src/sources/index.ts`.
3. Tambah ID ke frontend:
   - light registry `sources/index.ts`
   - `utils/novelSources.ts` → `NOVEL_SOURCE_IDS`
4. Deploy.

### Source diblokir Vercel

Jangan andalkan scraper Vercel untuk source itu. Di frontend:

1. Pastikan adapter sudah ada di sini (`src/sources/impl/`) dan punya `id = 'namasource'`.
2. Tambah ID ke `frontend/scripts/worker-sources.json`.
3. Jalankan di folder frontend:

```bash
cd ../frontend
pnpm sync-worker-sources
```

Script akan otomatis copy file + generate `workerSources/index.ts`.

Lihat `frontend/README.md` (hybrid) untuk detail lengkap.

---

## TypeScript / IDE

File `api/index.js` adalah **bundle** esbuild. VS Code sering menampilkan false error (`#state`, private fields).

Di `tsconfig.json`:

```json
"exclude": ["node_modules", "dist", "api"]
```

Jangan commit perubahan manual di `api/index.js` kecuali dari `npm run build` / `vercel-build`.

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
- Novel: endpoint `/novel-chapter/*` mengembalikan teks; source harus punya `getChapterContent`.
- Parent README: `../README.md`
