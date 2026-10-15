# Tutorial setup Rokuyomu (clone / fork)

Panduan lengkap untuk menjalankan dan mendeploy [rokuyomu](https://github.com/moemaomao/rokuyomu) di mesin sendiri.

Repo ini **monorepo**:

| Folder | Fungsi | Runtime |
|--------|--------|---------|
| `frontend/` | UI SvelteKit + Cloudflare Worker | Node 20+, pnpm, Wrangler |
| `scraper/` | API scrape (Express + Cheerio) | Node 20+, npm |

Offline Library / History / Bookmark memakai **File System Access API** → paling stabil di **Chrome / Edge**.

---

## 0. Yang perlu disiapkan

### Wajib

- [Node.js 20+](https://nodejs.org/) (`node -v`)
- [pnpm 9+](https://pnpm.io/) — frontend  
  ```bash
  corepack enable && corepack prepare pnpm@latest --activate
  ```
- npm (bawaan Node) — scraper
- Git
- Akun [Cloudflare](https://dash.cloudflare.com/) (kalau mau deploy frontend)
- Browser Chrome atau Edge (fitur offline disk)

### Opsional

- Docker — Byparr (bypass Cloudflare di beberapa sumber)
- Akun [Vercel](https://vercel.com/) — deploy scraper
- Project Firebase — login + sync bookmark/history ke cloud

---

## 1. Clone repo

```bash
git clone https://github.com/moemaomao/rokuyomu.git
cd rokuyomu
```

Fork sendiri:

```bash
git clone https://github.com/<USER>/rokuyomu.git
cd rokuyomu
```

---

## 2. Jalankan scraper (wajib untuk data sumber)

```bash
cd scraper
npm install
npx tsx src/index.ts
```

Cek:

```bash
curl http://localhost:3000/health
```

Harus ada JSON `"ok": true`.

### Byparr (opsional, untuk sumber kena CF)

```bash
docker run -d --name byparr -p 8191:8191 --restart unless-stopped \
  ghcr.io/thephaseless/byparr:latest

# terminal scraper
cd scraper
BYPARR_URL=http://localhost:8191 npx tsx src/index.ts
```

---

## 3. Jalankan frontend (dev)

```bash
cd frontend
pnpm install
```

### Arahkan ke scraper lokal

Edit `frontend/wrangler.jsonc` → bagian `vars` (sementara untuk dev lokal), **atau** set env saat dev:

Contoh isi `vars` (sesuaikan):

```jsonc
"vars": {
  "SCRAPER_BASE_URL": "http://localhost:3000"
}
```

> Catatan: di production, `SCRAPER_BASE_URL` harus URL scraper publik (mis. Vercel), bukan `localhost`.

Lalu:

```bash
pnpm dev
```

Buka: [http://localhost:5173](http://localhost:5173)

### Script berguna

| Perintah | Fungsi |
|----------|--------|
| `pnpm dev` | Dev server |
| `pnpm check` | Typecheck / svelte-check |
| `pnpm build` | Build production |
| `pnpm sync-worker-sources` | Generate adapter hybrid Worker |
| `pnpm deploy` | sync → build → `wrangler deploy` |

---

## 4. Yang biasanya diganti orang baru (checklist)

### 4.1 Nama Worker & KV (deploy Cloudflare)

File: `frontend/wrangler.jsonc`

| Field | Apa yang diganti |
|-------|------------------|
| `name` | Nama Worker unik di akunmu (default `rokuyomu`) |
| `kv_namespaces[0].id` | **ID namespace KV milikmu** (jangan pakai ID orang lain) |
| `vars.SCRAPER_BASE_URL` | URL scraper deploy-mu |
| `vars.SCRAPER_URL` | (jika dipakai) tunnel/URL alternatif — boleh dihapus jika tidak perlu |

Buat KV baru:

```bash
cd frontend
npx wrangler login
npx wrangler kv namespace create MIKOROKU_CACHE
# salin id yang keluar → tempel ke wrangler.jsonc
```

### 4.2 Firebase (opsional)

Kalau tidak butuh login cloud, bisa biarkan; fitur lokal (IndexedDB + disk) tetap jalan.

Kalau butuh auth/sync:

1. Buat project di [Firebase Console](https://console.firebase.google.com/)
2. Aktifkan Auth (Google / email sesuai yang dipakai app)
3. Ganti config di `frontend/src/lib/firebase.ts` (apiKey, authDomain, projectId, …)

**Jangan commit** secret yang tidak boleh publik; pakai env bila kamu ubah pola config.

### 4.3 Branding / domain

- Logo & favicon: `frontend/src/lib/assets/`, `frontend/static/`
- Judul app: cek `frontend/src/app.html`, layout, README
- Custom domain: Cloudflare dashboard → Workers → Triggers / Domains

### 4.4 Tidak wajib diganti

- Isi `scraper/src/sources/impl/**` — adapter sumber (hanya jika menambah/memperbaiki site)
- Cron `*/20 * * * *` di `wrangler.jsonc` — boleh disesuaikan

---

## 5. Fitur offline di browser

1. Buka app di **Chrome / Edge**
2. **Settings** atau **Offline Library** → pilih / grant folder induk (akan dibuat `Rokuyomu/` atau nama privacy)
3. **History**:
   - **Browser cache** → IndexedDB, max 80 judul
   - **Local disk** → `Rokuyomu/History/history.json` + covers, tanpa limit 80
4. **Settings → Privacy → Hide offline folders** — centang per folder:

   | Opsi | Nama normal | Nama tersembunyi |
   |------|-------------|------------------|
   | Main | `Rokuyomu` | `AppCache` |
   | Library | `Library` | `_media` |
   | Bookmark | `Bookmark` | `_fav` |
   | History | `History` | `_recent` |

Struktur disk (default):

```
Rokuyomu/
├── Library/Manga|Novel/<Title>/…
├── Bookmark/bookmarks.json + covers/
└── History/history.json + covers/     # jika mode Local disk
```

---

## 6. Deploy

### 6.1 Scraper → Vercel (contoh)

```bash
cd scraper
npm install
# install Vercel CLI jika perlu: npm i -g vercel
vercel
```

Setelah dapat URL (mis. `https://xxx.vercel.app`):

- Set di `frontend/wrangler.jsonc`:  
  `"SCRAPER_BASE_URL": "https://xxx.vercel.app"`

Env opsional di Vercel: `BYPARR_URL` (jika Byparr ikut di-host).

### 6.2 Frontend → Cloudflare Workers

```bash
cd frontend
npx wrangler login
# pastikan kv id + SCRAPER_BASE_URL sudah benar
pnpm deploy
```

`pnpm deploy` menjalankan: `sync-worker-sources` → `build` → `wrangler deploy`.

---

## 7. Troubleshooting

| Gejala | Cek |
|--------|-----|
| Home kosong / error fetch | Scraper jalan? `curl …/health`. `SCRAPER_BASE_URL` benar? |
| CORS / blocked | Scraper harus bisa diakses dari browser Worker origin; URL publik, bukan hanya localhost di production |
| Offline disk tidak muncul | Pakai Chrome/Edge; user harus grant folder |
| History tetap max 80 | Mode masih **Browser cache** — pilih **Local disk** di halaman History, Refresh |
| Download gagal judul aneh | `sanitizePathSegment` / fallback `title_<hash>` di `localFs.ts` |
| KV error saat deploy | `id` di `wrangler.jsonc` harus namespace di akunmu |
| Type error setelah pull | `cd frontend && pnpm install && pnpm check` |

---

## 8. Alur harian developer

```bash
# Terminal 1 — scraper
cd scraper && npx tsx src/index.ts

# Terminal 2 — frontend
cd frontend && pnpm dev
```

Ubah adapter sumber: `scraper/src/sources/impl/…`  
Ubah UI/offline: `frontend/src/lib/stores|utils|routes/…`  
Setelah ubah registry Worker: `pnpm sync-worker-sources`

---

## 9. Ringkasan file penting

| File | Kenapa penting |
|------|----------------|
| `frontend/wrangler.jsonc` | Worker name, KV id, `SCRAPER_BASE_URL`, cron |
| `frontend/src/lib/firebase.ts` | Config auth (opsional) |
| `frontend/src/lib/utils/localFs.ts` | Path disk, privacy names, sanitize |
| `frontend/src/lib/stores/history.ts` | Cache 80 vs disk unlimited |
| `frontend/src/lib/stores/preferences.ts` | `historyStorageMode`, `hideOfflineFolders` |
| `scraper/src/index.ts` | Entry API |
| `scraper/src/lib/fetchWithCf.ts` | Integrasi Byparr |

---

## 10. Lisensi & kontribusi

Lihat `LICENSE.txt` di root repo.  
Untuk PR upstream, ikuti struktur folder yang ada; jangan commit `node_modules/`, `.env` berisi secret, atau KV id orang lain.

---

**Selesai.** Setelah langkah 2–3, app lokal sudah bisa dipakai; langkah 4–6 hanya untuk branding & production.
