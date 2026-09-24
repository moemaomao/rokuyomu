#!/usr/bin/env node
/**
 * Sync worker sources from scraper → frontend
 *
 * - Baca daftar ID dari scripts/worker-sources.json
 * - Scan scraper/src/sources/impl/*.ts
 * - Match berdasarkan `id = '...'` di dalam file
 * - Copy file yang dibutuhkan ke frontend/src/lib/server/workerSources/impl/
 * - Generate ulang index.ts (WORKER_SOURCE_IDS + loaders)
 *
 * Usage:
 *   node scripts/sync-worker-sources.mjs
 *   # atau
 *   pnpm sync-worker-sources
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const ROOT = path.resolve(__dirname, '../..'); // rokuyomu/
const FRONTEND = path.resolve(__dirname, '..'); // frontend/
const SCRAPER_IMPL = path.join(ROOT, 'scraper/src/sources/impl');
const WORKER_IMPL = path.join(FRONTEND, 'src/lib/server/workerSources/impl');
const WORKER_INDEX = path.join(FRONTEND, 'src/lib/server/workerSources/index.ts');
const IDS_FILE = path.join(__dirname, 'worker-sources.json');

// ---------- helpers ----------

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function extractIdAndClass(content, filename) {
  // id = 'xxx'  atau  id = "xxx"
  const idMatch = content.match(/^\s*id\s*=\s*['"]([^'"]+)['"]/m);
  if (!idMatch) return null;

  const id = idMatch[1];

  // export class XxxSource  atau  export class Xxx
  const classMatch = content.match(/export\s+class\s+(\w+)/);
  if (!classMatch) {
    console.warn(`  ⚠  Tidak menemukan "export class" di ${filename}`);
    return null;
  }

  return {
    id,
    className: classMatch[1],
    filename
  };
}

function scanScraperSources() {
  const files = fs.readdirSync(SCRAPER_IMPL).filter((f) => f.endsWith('.ts'));
  const map = new Map(); // id → { className, filename }

  for (const file of files) {
    const full = path.join(SCRAPER_IMPL, file);
    const content = fs.readFileSync(full, 'utf8');
    const info = extractIdAndClass(content, file);
    if (info) {
      map.set(info.id, info);
    }
  }

  return map;
}

function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
}

function generateIndex(ids, sourceMap) {
  const sortedIds = [...ids].sort();

  const loadersLines = sortedIds
    .map((id) => {
      const info = sourceMap.get(id);
      if (!info) return null;
      // filename tanpa .ts
      const moduleName = info.filename.replace(/\.ts$/, '');
      return `\t${id}: async () => new (await import('./impl/${moduleName}')).${info.className}(),`;
    })
    .filter(Boolean)
    .join('\n');

  const idsLiteral = sortedIds.map((id) => `\t'${id}'`).join(',\n');

  return `/**
 * Worker-local sources — HANYA source yang diblokir outbound IP Vercel.
 *
 * File ini DIGENERATE otomatis oleh scripts/sync-worker-sources.mjs
 * Jangan edit manual. Edit daftar ID di scripts/worker-sources.json lalu jalankan:
 *
 *   pnpm sync-worker-sources
 *
 * Lazy load: module adapter hanya di-import saat source tersebut benar-benar dipakai.
 * Ini menjaga CPU free tier CF Workers (< ~10ms) karena tidak load semua Cheerio adapter di cold start.
 *
 * Alur:
 *   UI → CF Worker → (worker source?) → dynamic import + parse lokal (Cheerio)
 *                  → (else)           → fetch JSON ke scraper Vercel/Render
 */

import type { IMangaSource } from './types';

export const WORKER_SOURCE_IDS = new Set([
${idsLiteral}
]);

const instanceCache = new Map<string, IMangaSource>();

const loaders: Record<string, () => Promise<IMangaSource>> = {
${loadersLines}
};

export function isWorkerSource(sourceId: string): boolean {
\treturn WORKER_SOURCE_IDS.has(sourceId);
}

export async function getWorkerSource(sourceId: string): Promise<IMangaSource> {
\tconst cached = instanceCache.get(sourceId);
\tif (cached) return cached;

\tconst loader = loaders[sourceId];
\tif (!loader) {
\t\tthrow new Error(\`Worker source "\${sourceId}" not registered\`);
\t}

\tconst src = await loader();
\tinstanceCache.set(sourceId, src);
\treturn src;
}
`;
}

// ---------- main ----------

function main() {
  console.log('🔄 Syncing worker sources...\n');

  if (!fs.existsSync(IDS_FILE)) {
    console.error(`❌ File daftar ID tidak ditemukan: ${IDS_FILE}`);
    process.exit(1);
  }

  if (!fs.existsSync(SCRAPER_IMPL)) {
    console.error(`❌ Folder scraper impl tidak ditemukan: ${SCRAPER_IMPL}`);
    process.exit(1);
  }

  const requestedIds = readJson(IDS_FILE);
  if (!Array.isArray(requestedIds) || requestedIds.length === 0) {
    console.error('❌ worker-sources.json harus berisi array ID');
    process.exit(1);
  }

  console.log(`📋 Requested IDs (${requestedIds.length}):`);
  console.log('   ' + requestedIds.join(', ') + '\n');

  const sourceMap = scanScraperSources();
  console.log(`🔍 Ditemukan ${sourceMap.size} source di scraper/impl\n`);

  // Validasi
  const missing = [];
  const found = [];

  for (const id of requestedIds) {
    if (sourceMap.has(id)) {
      found.push(id);
    } else {
      missing.push(id);
    }
  }

  if (missing.length) {
    console.error('❌ Source berikut TIDAK ditemukan di scraper:');
    missing.forEach((id) => console.error(`   - ${id}`));
    console.error('\nPastikan adapter sudah ada di scraper/src/sources/impl/ dan punya `id = \'...\'`');
    process.exit(1);
  }

  // Pastikan folder tujuan ada
  ensureDir(WORKER_IMPL);

  // Hapus file lama di worker impl (kecuali yang masih dibutuhkan)
  const existingFiles = fs.readdirSync(WORKER_IMPL).filter((f) => f.endsWith('.ts'));
  const neededFilenames = new Set(found.map((id) => sourceMap.get(id).filename));

  for (const file of existingFiles) {
    if (!neededFilenames.has(file)) {
      const full = path.join(WORKER_IMPL, file);
      fs.unlinkSync(full);
      console.log(`🗑  Dihapus (tidak lagi di list): ${file}`);
    }
  }

  // Copy
  console.log('\n📦 Copying files:');
  for (const id of found) {
    const info = sourceMap.get(id);
    const src = path.join(SCRAPER_IMPL, info.filename);
    const dest = path.join(WORKER_IMPL, info.filename);

    copyFile(src, dest);
    console.log(`   ✓ ${info.filename}  (${id} → ${info.className})`);
  }

  // Generate index.ts
  const indexContent = generateIndex(found, sourceMap);
  fs.writeFileSync(WORKER_INDEX, indexContent, 'utf8');
  console.log(`\n📝 Generated: ${path.relative(FRONTEND, WORKER_INDEX)}`);

  console.log('\n✅ Sync selesai!');
  console.log(`   Total worker sources: ${found.length}`);
  console.log('\nLanjut deploy dengan: pnpm deploy');
}

main();