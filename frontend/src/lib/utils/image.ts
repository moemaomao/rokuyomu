export function proxyImage(url: string, sourceId = '', w?: number, h?: number): string {
	if (!url) return '';
	let u = String(url).trim();
	if (u.startsWith('//')) u = 'https:' + u;
	if (!/^https?:\/\//i.test(u)) return '';

	const params = new URLSearchParams({
		url: u,
		source: sourceId
	});
	if (w) params.set('w', String(w));
	if (h) params.set('h', String(h));

	return `/api/proxy?${params.toString()}`;
}

export function onCoverError(e: Event) {
	const img = e.currentTarget as HTMLImageElement;
	const original = img.dataset.original;
	if (!original || img.dataset.fallback === '1') {
		img.style.display = 'none';
		return;
	}
	img.dataset.fallback = '1';
	const source = img.dataset.source || '';
	let u = original.startsWith('//') ? 'https:' + original : original;
	img.src = `/api/proxy?url=${encodeURIComponent(u)}&source=${source}`;
}