# Rokuyomu — Scraper

Microservice **Node.js** (Express + Cheerio) untuk scraping source manga/comics **dan novel**.

Dipakai frontend Cloudflare Worker lewat HTTP JSON supaya Worker tetap di free tier (CPU kecil).

Repo: [moemaomao/rokuyomu](https://github.com/moemaomao/rokuyomu) · package ini: `scraper/`

**Byparr** terintegrasi untuk bypass Cloudflare challenge (cookie jar + auto-retry).

---

## Role

| Tugas | Detail |
|-------|--------|
| Parse HTML / API source | Cheerio + adapter per situs (~118) |
| API JSON | Latest, search, detail, chapter pages, **novel chapter content** |
| CF bypass | `fetchWithCf` → Byparr (`BYPARR_URL`) + cookie jar per-domain |
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
| `GET` | `/health` | `{ ok, ts, byparr, byparrUrl, cfJar }` |
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
│   ├── index.ts              # Express app + routes (+ Byparr di /health)
│   ├── lib/
│   │   ├── byparr.ts         # Client POST {BYPARR_URL}/v1 (cmd: request.get)
│   │   ├── cfCookieJar.ts    # Cookie jar per-domain (TTL default 15 mnt)
│   │   └── fetchWithCf.ts    # Deteksi CF challenge → solve Byparr → retry
│   └── sources/
│       ├── index.ts          # Registry + getSource / getAllSources
│       ├── BaseSource.ts     # fetchHtml → fetchWithCf
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

## Byparr (Cloudflare bypass)

Byparr = self-hosted anti-bot solver ([ThePhaseless/Byparr](https://github.com/ThePhaseless/Byparr)), kompatibel API FlareSolverr.

Alur di scraper:

1. `BaseSource.fetchHtml` → `fetchWithCf`
2. Kalau response kena CF challenge (marker / 403+cf-ray) → panggil Byparr
3. Simpan cookie + UA di `cfCookieJar` (per domain, TTL)
4. Pakai body dari solver atau retry dengan cookie

### Hidupin Byparr

**Docker (disarankan):**

```bash
docker run -d --name byparr -p 8191:8191 --restart unless-stopped ghcr.io/thephaseless/byparr:latest
```

**Lokal:**

```bash
# butuh uv: https://docs.astral.sh/uv/
git clone https://github.com/ThePhaseless/Byparr
cd Byparr
uv run main.py
# → http://localhost:8191
```

Docs: `http://localhost:8191/docs`

### Env scraper

| Variable | Default | Keterangan |
|----------|---------|------------|
| `BYPARR_URL` | (kosong) | Contoh `http://localhost:8191`. Kosong = Byparr **off** |
| `CF_COOKIE_TTL_MS` | `900000` | TTL cookie CF di jar (15 menit) |
| `PORT` | `3000` | Port lokal / Render |
| `SCRAPER_API_KEY` | (kosong) | Opsional |
| `VERCEL` | (platform) | Skip `app.listen` di Vercel |

Tanpa `BYPARR_URL`, source yang kena CF akan throw:

```
Cloudflare challenge on <url> (Byparr disabled; set BYPARR_URL)
```

### Cek status

```bash
curl http://localhost:3000/health
```

Contoh response:

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

## Setup lokal

```bash
# 1) (opsional) Byparr dulu
docker run -d --name byparr -p 8191:8191 ghcr.io/thephaseless/byparr:latest

# 2) Scraper
cd scraper
npm install
```

**Linux / macOS / Git Bash:**

```bash
BYPARR_URL=http://localhost:8191 npx tsx src/index.ts
# → http://localhost:3000
```

**Windows PowerShell:**

```powershell
$env:BYPARR_URL="http://localhost:8191"
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

### Vercel (default, tanpa Byparr)

- Root directory: `scraper`
- Build command: `npm run vercel-build`
- Output: `api/index.js` (serverless)
- Env opsional: `SCRAPER_API_KEY`

Setelah live, set di frontend:

```
SCRAPER_BASE_URL=https://rokuyomu.vercel.app
```

> Vercel serverless **tidak cocok** untuk Byparr (tidak persistent + cold start). Pakai Render/Koyeb/Fly kalau butuh CF bypass.

### Render / Koyeb / Fly (dengan Byparr)

1. Deploy Byparr di VPS / container terpisah (port 8191).
2. Deploy scraper:
   - Build: `npm install`
   - Start: `npx tsx src/index.ts` (atau `npm start`)
   - Env: `BYPARR_URL=http://IP-atau-hostname-byparr:8191`
3. Free tier bisa sleep → ping `/health` berkala.

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

`BaseSource.fetchHtml` sudah lewat `fetchWithCf` — source yang kena CF otomatis pakai Byparr (kalau `BYPARR_URL` set).

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
| `BYPARR_URL` | URL Byparr (contoh `http://localhost:8191`). Kosong = off |
| `CF_COOKIE_TTL_MS` | TTL cookie CF di jar (default 900000 = 15 menit) |

---

## Catatan

- CORS: `origin: true` (siap dipanggil Worker).
- Error scraping → `500` + `{ error: "..." }` (detail di server log).
- Frontend hybrid: source di `WORKER_SOURCE_IDS` **tidak** memanggil API ini.
- Novel: endpoint `/novel-chapter/*` mengembalikan teks; source harus punya `getChapterContent`.
- Byparr tidak 100% guarantee; cookie di-cache per domain biar tidak solve ulang tiap request.
- Parent README: `../README.md`
