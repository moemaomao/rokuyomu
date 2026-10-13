#!/usr/bin/env node
/**
 * Sync worker sources from scraper → frontend
 *
 * - Baca daftar ID dari scripts/worker-sources.json
 * - Scan scraper/src/sources/impl/manga/*.ts + impl/novel/*.ts
 * - Match berdasarkan `id = '...'` di dalam file
 * - Copy folder family/ (MadaraSource, ThemesiaSource, …) ke workerSources/family/
 * - Copy + rewrite import path ke frontend/src/lib/server/workerSources/impl/
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
const SCRAPER_MANGA = path.join(ROOT, 'scraper/src/sources/impl/manga');
const SCRAPER_NOVEL = path.join(ROOT, 'scraper/src/sources/impl/novel');
const SCRAPER_FAMILY = path.join(ROOT, 'scraper/src/sources/family');
const WORKER_ROOT = path.join(FRONTEND, 'src/lib/server/workerSources');
const WORKER_IMPL = path.join(WORKER_ROOT, 'impl');
const WORKER_FAMILY = path.join(WORKER_ROOT, 'family');
const WORKER_INDEX = path.join(WORKER_ROOT, 'index.ts');
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
	const idMatch = content.match(/^\s*id\s*=\s*['"]([^'"]+)['"]/m);
	if (!idMatch) return null;

	const id = idMatch[1];

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
	const map = new Map();
	const dirs = [
		{ dir: SCRAPER_MANGA, label: 'manga' },
		{ dir: SCRAPER_NOVEL, label: 'novel' }
	];

	for (const { dir, label } of dirs) {
		if (!fs.existsSync(dir)) {
			console.warn(`  ⚠  Folder tidak ada: ${dir}`);
			continue;
		}
		const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
		for (const file of files) {
			const full = path.join(dir, file);
			const content = fs.readFileSync(full, 'utf8');
			const info = extractIdAndClass(content, file);
			if (info) {
				map.set(info.id, { ...info, absPath: full, kind: label });
			}
		}
	}

	return map;
}

function rewriteImportsForWorker(content) {
	let out = content;

	out = out
		.replace(
			/from\s+['"]\.\.\/\.\.\/\.\.\/family\/([^'"]+)['"]/g,
			"from '../family/$1'"
		)
		.replace(
			/from\s+['"]\.\.\/\.\.\/family\/([^'"]+)['"]/g,
			"from '../family/$1'"
		)
		.replace(
			/from\s+['"]\.\.\/family\/([^'"]+)['"]/g,
			"from '../family/$1'"
		);

	out = out
		.replace(/from\s+['"]\.\.\/\.\.\/\.\.\/BaseSource(?:\.js)?['"]/g, "from '../BaseSource'")
		.replace(/from\s+['"]\.\.\/\.\.\/BaseSource(?:\.js)?['"]/g, "from '../BaseSource'")
		.replace(/from\s+['"]\.\.\/BaseSource(?:\.js)?['"]/g, "from '../BaseSource'");

	// types-manga
	out = out
		.replace(/from\s+['"]\.\.\/\.\.\/\.\.\/types-manga(?:\.js)?['"]/g, "from '../types-manga'")
		.replace(/from\s+['"]\.\.\/\.\.\/types-manga(?:\.js)?['"]/g, "from '../types-manga'")
		.replace(/from\s+['"]\.\.\/types-manga(?:\.js)?['"]/g, "from '../types-manga'");

	// types (alias manga types di scraper)
	out = out
		.replace(/from\s+['"]\.\.\/\.\.\/\.\.\/types(?:\.js)?['"]/g, "from '../types-manga'")
		.replace(/from\s+['"]\.\.\/\.\.\/types(?:\.js)?['"]/g, "from '../types-manga'")
		.replace(/from\s+['"]\.\.\/types(?:\.js)?['"]/g, "from '../types-manga'");

	// types-novel
	out = out
		.replace(/from\s+['"]\.\.\/\.\.\/\.\.\/types-novel(?:\.js)?['"]/g, "from '../types-novel'")
		.replace(/from\s+['"]\.\.\/\.\.\/types-novel(?:\.js)?['"]/g, "from '../types-novel'")
		.replace(/from\s+['"]\.\.\/types-novel(?:\.js)?['"]/g, "from '../types-novel'");

	// fetchWithCf
	out = out
		.replace(
			/from\s+['"]\.\.\/\.\.\/\.\.\/lib\/server\/fetchWithCf(?:\.js)?['"]/g,
			"from '../../fetchWithCf'"
		)
		.replace(
			/from\s+['"]\.\.\/\.\.\/\.\.\/server\/fetchWithCf(?:\.js)?['"]/g,
			"from '../../fetchWithCf'"
		)
		.replace(
			/from\s+['"]\.\.\/\.\.\/\.\.\/lib\/fetchWithCf(?:\.js)?['"]/g,
			"from '../../fetchWithCf'"
		)
		.replace(
			/from\s+['"]\.\.\/\.\.\/lib\/server\/fetchWithCf(?:\.js)?['"]/g,
			"from '../../fetchWithCf'"
		)
		.replace(
			/from\s+['"]\.\.\/\.\.\/lib\/fetchWithCf(?:\.js)?['"]/g,
			"from '../../fetchWithCf'"
		)
		.replace(
			/from\s+['"]\.\.\/\.\.\/server\/fetchWithCf(?:\.js)?['"]/g,
			"from '../../fetchWithCf'"
		)
		.replace(
			/from\s+['"]\.\.\/lib\/fetchWithCf(?:\.js)?['"]/g,
			"from '../../fetchWithCf'"
		)
		.replace(
			/from\s+['"]\.\.\/\.\.\/fetchWithCf(?:\.js)?['"]/g,
			"from '../../fetchWithCf'"
		);

	return out;
}

function rewriteImportsForFamily(content) {
	let out = content;

	out = out
		.replace(/from\s+['"]\.\.\/\.\.\/BaseSource(?:\.js)?['"]/g, "from '../BaseSource'")
		.replace(/from\s+['"]\.\.\/\.\.\/types-manga(?:\.js)?['"]/g, "from '../types-manga'")
		.replace(/from\s+['"]\.\.\/\.\.\/types-novel(?:\.js)?['"]/g, "from '../types-novel'")
		.replace(/from\s+['"]\.\.\/\.\.\/types(?:\.js)?['"]/g, "from '../types-manga'");

	out = out
		.replace(
			/from\s+['"]\.\.\/\.\.\/lib\/fetchWithCf(?:\.js)?['"]/g,
			"from '../../fetchWithCf'"
		)
		.replace(
			/from\s+['"]\.\.\/lib\/fetchWithCf(?:\.js)?['"]/g,
			"from '../../fetchWithCf'"
		);

	return out;
}

function copyAndRewrite(srcAbs, destAbs, rewriter) {
	const raw = fs.readFileSync(srcAbs, 'utf8');
	const rewritten = rewriter(raw);
	fs.writeFileSync(destAbs, rewritten, 'utf8');
}

function syncFamilyFolder() {
	if (!fs.existsSync(SCRAPER_FAMILY)) {
		console.log('ℹ  Tidak ada scraper/src/sources/family — skip family sync');
		return;
	}

	ensureDir(WORKER_FAMILY);

	const files = fs.readdirSync(SCRAPER_FAMILY).filter((f) => f.endsWith('.ts'));
	const needed = new Set(files);

	for (const file of fs.readdirSync(WORKER_FAMILY).filter((f) => f.endsWith('.ts'))) {
		if (!needed.has(file)) {
			fs.unlinkSync(path.join(WORKER_FAMILY, file));
			console.log(`🗑  Family dihapus: ${file}`);
		}
	}

	console.log('\n📁 Syncing family bases:');
	for (const file of files) {
		const src = path.join(SCRAPER_FAMILY, file);
		const dest = path.join(WORKER_FAMILY, file);
		copyAndRewrite(src, dest, rewriteImportsForFamily);
		console.log(`   ✓ family/${file}`);
	}
}

function generateIndex(ids, sourceMap) {
	const sortedIds = [...ids].sort();

	const loadersLines = sortedIds
		.map((id) => {
			const info = sourceMap.get(id);
			if (!info) return null;
			const moduleName = info.filename.replace(/\.ts$/, '');
			return `\t${id}: async () => new (await import('./impl/${moduleName}')).${info.className}(),`;
		})
		.filter(Boolean)
		.join('\n');

	const idsLiteral = sortedIds.map((id) => `\t'${id}'`).join(',\n');

	const header = `/**
 * Worker-local sources — HANYA source yang diblokir outbound IP Vercel.
 *
 * File ini DIGENERATE otomatis oleh scripts/sync-worker-sources.mjs
 * Jangan edit manual. Edit daftar ID di scripts/worker-sources.json lalu jalankan:
 *
 *   pnpm sync-worker-sources
 *
 * Lazy load: module adapter hanya di-import saat source tersebut benar-benar dipakai.
 *
 * Alur:
 *   UI → CF Worker → (worker source?) → dynamic import + parse lokal (Cheerio)
 *                  → (else)           → fetch JSON ke scraper Vercel/Render
 */

import type { IMangaSource } from './types-manga';

export const WORKER_SOURCE_IDS = new Set([
${idsLiteral}
]);

const instanceCache = new Map<string, IMangaSource>();

const loaders: Record<string, () => Promise<IMangaSource>> = {
${loadersLines}
};

export function isWorkerSource(sourceId: string): boolean {
	return WORKER_SOURCE_IDS.has(sourceId);
}

export async function getWorkerSource(sourceId: string): Promise<IMangaSource> {
	const cached = instanceCache.get(sourceId);
	if (cached) return cached;

	const loader = loaders[sourceId];
	if (!loader) {
`;

	const throwLine =
		'\t\tthrow new Error(`Worker source "${sourceId}" not registered`);\n';

	const footer = `
	}

	const src = await loader();
	instanceCache.set(sourceId, src);
	return src;
}
`;

	return header + throwLine + footer;
}

// ---------- main ----------

function main() {
	console.log('🔄 Syncing worker sources...\n');

	if (!fs.existsSync(IDS_FILE)) {
		console.error(`❌ File daftar ID tidak ditemukan: ${IDS_FILE}`);
		process.exit(1);
	}

	if (!fs.existsSync(SCRAPER_MANGA) && !fs.existsSync(SCRAPER_NOVEL)) {
		console.error(`❌ Folder scraper impl tidak ditemukan:`);
		console.error(`   ${SCRAPER_MANGA}`);
		console.error(`   ${SCRAPER_NOVEL}`);
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
	console.log(`🔍 Ditemukan ${sourceMap.size} source di scraper (manga + novel)\n`);

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
		console.error(
			'\nPastikan adapter ada di scraper/src/sources/impl/manga/ atau impl/novel/ dan punya `id = \'...\'`'
		);
		process.exit(1);
	}

	syncFamilyFolder();

	ensureDir(WORKER_IMPL);

	const existingFiles = fs.readdirSync(WORKER_IMPL).filter((f) => f.endsWith('.ts'));
	const neededFilenames = new Set(found.map((id) => sourceMap.get(id).filename));

	for (const file of existingFiles) {
		if (!neededFilenames.has(file)) {
			fs.unlinkSync(path.join(WORKER_IMPL, file));
			console.log(`🗑  Dihapus (tidak lagi di list): ${file}`);
		}
	}

	console.log('\n📦 Copying adapter files:');
	for (const id of found) {
		const info = sourceMap.get(id);
		const dest = path.join(WORKER_IMPL, info.filename);
		copyAndRewrite(info.absPath, dest, rewriteImportsForWorker);
		console.log(`   ✓ ${info.filename}  (${id} → ${info.className}) [${info.kind}]`);
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
