import { readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';

const workerPath = join('.svelte-kit', 'cloudflare', '_worker.js');
const jobPath = join('cron', 'job.js');

try {
	const job = readFileSync(jobPath, 'utf8');
	appendFileSync(workerPath, '\n' + job);
	console.log('[append-cron] scheduled handler appended');
} catch (e) {
	console.error('[append-cron] failed:', e.message);
}