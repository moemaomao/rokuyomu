worker_default.scheduled = async (event, env, ctx) => {
	console.log('[CRON] Triggered at', new Date().toISOString(), 'cron:', event.cron);

	const kv = env.MIKOROKU_CACHE;
	if (!kv) {
		console.error('[CRON] MIKOROKU_CACHE binding not found');
		return;
	}

	try {
		const origin = 'https://rokuyomu.moemaomao.workers.dev';
		const res = await fetch(`${origin}/api/warm?secret=fuckyoufuckyoufuckyoufuckyoufuckyou`, {
			method: 'POST',
			headers: { 'User-Agent': 'Mikoroku-Cron/1.0' }
		});

		const text = await res.text();
		console.log('[CRON] Warm result:', res.status, text.slice(0, 200));
	} catch (err) {
		console.error('[CRON] Failed to call warm endpoint:', err);
	}
};