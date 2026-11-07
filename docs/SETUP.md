# Setup Rokuyomu (clone / fork)

Panduan untuk menjalankan Rokuyomu secara lokal dan men-deploy salinannya sendiri.

Repo ini adalah monorepo:

| Folder | Fungsi | Runtime |
|--------|--------|---------|
| `frontend/` | UI SvelteKit, API Worker, cache KV, dan halaman aplikasi | Node.js 20+, pnpm, Cloudflare Workers |
| `scraper/` | API Express untuk sumber yang diproses di Node.js | Node.js 20+, npm |

Frontend menggunakan scraper jarak jauh untuk sebagian sumber dan memproses sumber lain langsung di Cloudflare Worker. Karena itu, jalankan scraper saat pengembangan lokal atau arahkan frontend ke deployment scraper yang aktif.

---

## Fitur aplikasi yang tersedia

Fitur berikut tersedia di aplikasi saat ini. Sumber dan filter yang muncul dapat berbeda karena bergantung pada dukungan tiap situs:

- **Jelajah dan pencarian:** lihat update terbaru dari satu atau beberapa sumber pilihan; cari judul dan filter berdasarkan sumber, bahasa, jenis konten, serta tipe judul yang didukung sumber.
- **Deep Search:** pencarian judul lintas sumber melalui halaman `/deep-search`.
- **Baca manga/komik dan novel:** halaman detail menampilkan informasi dan daftar chapter; komik dibaca di image reader dan novel di text reader.
- **Pilihan reader dan tampilan:** tema, tata letak halaman utama, mode baca komik, serta preferensi reader dapat diatur di Settings.
- **Bookmark, riwayat, dan notifikasi:** simpan judul, lacak progres baca, tandai chapter yang sudah dibaca, dan lihat notifikasi update untuk judul yang diikuti.
- **Download dan baca offline:** manga/komik dapat diunduh sebagai folder lokal atau ZIP; chapter novel dapat diunduh sebagai PDF atau EPUB. Halaman Download mengelola daftar unduhan dan chapter offline.
- **Penyimpanan lokal:** data aplikasi disimpan di browser (IndexedDB). Folder lokal melalui File System Access API tersedia di browser yang mendukungnya; Chrome dan Edge direkomendasikan.
- **Riwayat baca:** mode Browser cache menyimpan hingga 80 judul. Mode Local disk menyimpan data riwayat di IndexedDB dan file `history.json`, dengan batas internal sekitar 10.000 judul.
- **Backup:** Settings menyediakan ekspor/impor backup JSON untuk data aplikasi yang didukung. File chapter offline tidak disertakan dan perlu diunduh kembali setelah pemulihan.
- **Akun opsional:** Firebase dapat digunakan untuk autentikasi dan sinkronisasi data yang didukung aplikasi.
- **Komunitas dan pengelolaan:** tersedia forum komunitas, pelaporan masalah/permintaan sumber, halaman statistik, serta tools admin.
- **Privasi:** tersedia kontrol untuk konten dewasa dan konfirmasi usia, opsi menonaktifkan penyimpanan riwayat, serta sesi incognito.

---

## 0. Yang perlu disiapkan

### Wajib

- [Node.js 20+](https://nodejs.org/) (`node -v`)
- [pnpm 9+](https://pnpm.io/) untuk frontend
  ```bash
  corepack enable
  corepack prepare pnpm@9.15.4 --activate
  ```
- npm (sudah termasuk dengan Node.js) untuk scraper
- Git

### Opsional

- Akun [Cloudflare](https://dash.cloudflare.com/) untuk deploy frontend
- Akun [Vercel](https://vercel.com/) atau host Node.js lain untuk deploy scraper
- Docker untuk menjalankan Byparr bagi sumber tertentu yang dilindungi Cloudflare
- Project Firebase untuk autentikasi/sinkronisasi opsional
- Chrome atau Edge untuk fitur penyimpanan ke folder lokal

---

## 1. Clone repo

```bash
git clone https://github.com/moemaomao/rokuyomu.git
cd rokuyomu
```

Untuk fork, ganti URL clone dengan URL fork milikmu.

---

## 2. Jalankan scraper

Scraper dibutuhkan untuk sumber yang tidak diproses langsung oleh Worker.

```bash
cd scraper
npm install
npx tsx src/index.ts
```

Scraper berjalan di `http://localhost:3000` secara default. Di terminal lain, cek endpoint health:

```bash
curl http://localhost:3000/health
```

Respons yang berhasil berisi `"ok": true`. Jika menggunakan port lain, atur `PORT` dan sesuaikan URL scraper di konfigurasi frontend.

### Byparr (opsional)

Byparr hanya diperlukan jika sumber yang digunakan memerlukan penanganan challenge Cloudflare dan Byparr dapat dijangkau dari scraper.

```bash
docker run -d --name byparr -p 8191:8191 --restart unless-stopped \
  ghcr.io/thephaseless/byparr:latest
```

Jalankan scraper dengan URL Byparr:

```bash
# Bash / Git Bash
BYPARR_URL=http://localhost:8191 npx tsx src/index.ts
```

```powershell
# Windows PowerShell
$env:BYPARR_URL = "http://localhost:8191"
npx tsx src/index.ts
```

Tanpa `BYPARR_URL`, integrasi Byparr tidak aktif.

---

## 3. Jalankan frontend secara lokal

Buka terminal kedua dari root repo:

```bash
cd frontend
pnpm install
pnpm dev
```

Buka [http://localhost:5173](http://localhost:5173).

### Hubungkan ke scraper lokal

Frontend membaca `SCRAPER_BASE_URL`. Untuk development, arahkan variabel tersebut ke `http://localhost:3000` melalui konfigurasi environment Wrangler/dev yang digunakan proyek. Konfigurasi repo mungkin menunjuk ke scraper publik; jangan mengubah nilai production tanpa sengaja atau meng-commit URL lokal.

### Perintah frontend

Jalankan dari `frontend/`:

| Perintah | Fungsi |
|----------|--------|
| `pnpm dev` | Menjalankan server development |
| `pnpm check` | Menjalankan pemeriksaan TypeScript dan Svelte |
| `pnpm build` | Membuat build production |
| `pnpm sync-worker-sources` | Menyinkronkan adapter sumber untuk Worker |
| `pnpm deploy` | Menyinkronkan adapter, build, lalu deploy dengan Wrangler |

---

## 4. Konfigurasi untuk deploy sendiri

### 4.1 Cloudflare Worker dan KV

File konfigurasi: `frontend/wrangler.jsonc`.

- `name`: nama Worker di akun Cloudflare.
- `kv_namespaces[0].id`: ID namespace KV milikmu; buat namespace sendiri, jangan gunakan ID milik pihak lain.
- `vars.SCRAPER_BASE_URL`: URL publik scraper yang bisa dijangkau Worker.
- `triggers.crons`: jadwal cron untuk proses pemanasan cache dan sinkronisasi sumber.

Buat KV namespace:

```bash
cd frontend
npx wrangler login
npx wrangler kv namespace create MIKOROKU_CACHE
```

Salin ID yang dihasilkan ke `kv_namespaces[0].id` di `wrangler.jsonc`.

### 4.2 Firebase (opsional)

Tanpa Firebase, fitur lokal tetap dapat digunakan. Untuk autentikasi atau sinkronisasi yang didukung aplikasi:

1. Buat project di [Firebase Console](https://console.firebase.google.com/).
2. Aktifkan provider autentikasi yang digunakan aplikasi.
3. Isi konfigurasi project di `frontend/src/lib/firebase.ts`.

Jangan masukkan kredensial server atau private key ke frontend.

### 4.3 Branding dan domain

- Logo dan aset: `frontend/src/lib/assets/` serta `frontend/static/`.
- Judul dan metadata aplikasi: `frontend/src/app.html` dan layout terkait.
- Custom domain: konfigurasi domain Worker di Cloudflare.

---

## 5. Penyimpanan offline

1. Buka aplikasi menggunakan Chrome atau Edge.
2. Hubungkan folder induk melalui Settings atau alur permintaan izin folder saat download.
3. Izinkan akses folder saat diminta. Browser dapat meminta izin lagi setelah sesi tertentu.
4. Pilih mode download di Settings: folder lokal atau ZIP/file melalui unduhan browser.
5. Atur mode riwayat di halaman History: Browser cache atau Local disk.

Struktur folder default:

```text
Rokuyomu/
├── Download/
│   ├── Manga/<Judul>/...
│   └── Novel/<Judul>/...
├── Bookmark/
│   ├── bookmarks.json
│   └── covers/
└── History/                 # digunakan untuk mode Local disk
    ├── history.json
    └── covers/
```

Folder yang sudah tersimpan tidak otomatis dipindahkan jika lokasi folder atau struktur penyimpanan berubah. Mode Browser cache memiliki batas 80 judul riwayat, sedangkan mode Local disk memiliki batas internal sekitar 10.000 judul (bukan tanpa batas).

---

## 6. Deploy

### 6.1 Scraper

Contoh deploy ke Vercel:

```bash
cd scraper
npm install
npx vercel
```

Setelah deploy, catat URL HTTPS scraper. Host harus dapat dijangkau dari Cloudflare Worker. Jika memakai Byparr, pastikan URL Byparr juga dapat dijangkau dari lingkungan scraper; `localhost` hanya berlaku jika Byparr berjalan di lingkungan yang sama.

### 6.2 Frontend ke Cloudflare Workers

1. Isi ID KV dan URL publik scraper di `frontend/wrangler.jsonc`.
2. Login ke Cloudflare:
   ```bash
   cd frontend
   npx wrangler login
   ```
3. Deploy:
   ```bash
   pnpm deploy
   ```

`pnpm deploy` menjalankan sinkronisasi Worker sources, build, lalu `wrangler deploy`.

---

## 7. Troubleshooting

| Gejala | Yang perlu dicek |
|--------|------------------|
| Beranda kosong atau request sumber gagal | Cek `SCRAPER_BASE_URL`, pastikan host scraper aktif dan dapat dijangkau Worker, lalu cek `GET /health`. Beberapa sumber berjalan langsung di Worker dan tidak membutuhkan scraper. |
| Sumber tertentu gagal karena challenge | Sumber tersebut mungkin memerlukan Byparr; cek `BYPARR_URL` dan keterjangkauan layanan Byparr dari scraper. |
| Folder offline tidak tersedia | Gunakan Chrome/Edge, hubungkan folder, lalu berikan izin akses. ZIP/file browser tetap dapat digunakan sebagai mode download alternatif. |
| Riwayat hanya menampilkan paling banyak 80 judul | Halaman History masih menggunakan Browser cache. Ganti ke Local disk untuk menaikkan batas internal menjadi sekitar 10.000 judul. |
| KV gagal saat deploy | Pastikan binding bernama `MIKOROKU_CACHE` dan ID namespace di `wrangler.jsonc` milik akun Cloudflare-mu. |
| Check gagal setelah perubahan dependency | Dari `frontend/`, jalankan `pnpm install`, lalu `pnpm check`. |

---

## 8. Alur harian developer

Jalankan scraper dan frontend di terminal terpisah:

```bash
# Terminal 1
cd scraper
npx tsx src/index.ts
```

```bash
# Terminal 2
cd frontend
pnpm dev
```

Adapter scraper berada di `scraper/src/sources/impl/`. UI berada di `frontend/src/routes/` dan komponen bersama di `frontend/src/lib/`. Setelah mengubah daftar Worker sources, jalankan `pnpm sync-worker-sources` dari `frontend/`.

---

## 9. File penting

| File | Fungsi |
|------|--------|
| `frontend/wrangler.jsonc` | Nama Worker, binding KV, URL scraper, dan jadwal cron |
| `frontend/src/lib/firebase.ts` | Konfigurasi Firebase opsional |
| `frontend/src/lib/utils/localFs.ts` | Akses folder lokal dan tata nama folder offline |
| `frontend/src/lib/stores/history.ts` | Pengelolaan riwayat dan batas per mode penyimpanan |
| `frontend/src/lib/stores/preferences.ts` | Preferensi tema, reader, download, privasi, dan riwayat |
| `frontend/src/lib/utils/backup.ts` | Ekspor dan impor backup JSON |
| `scraper/src/index.ts` | Entry point API scraper |
| `scraper/src/lib/fetchWithCf.ts` | Penanganan fetch dan integrasi Byparr |

---

## 10. Lisensi dan kontribusi

Lihat `LICENSE.txt` di root repo. Untuk kontribusi, ikuti struktur proyek dan jangan commit `node_modules/`, file `.env` berisi rahasia, atau ID KV milik akun orang lain.
