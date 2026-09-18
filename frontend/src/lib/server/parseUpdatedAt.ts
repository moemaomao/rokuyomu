export function parseUpdatedAt(raw: unknown): number {
	if (raw == null || raw === '') return 0;

	if (typeof raw === 'number' && Number.isFinite(raw)) {
		if (raw <= 0) return 0;
		return raw < 1e12 ? raw * 1000 : raw;
	}

	if (typeof raw === 'object') {
		const o = raw as Record<string, unknown>;
		if (typeof o.time === 'number') return parseUpdatedAt(o.time);
		if (typeof o.timestamp === 'number') return parseUpdatedAt(o.timestamp);
		if (typeof o.formatted === 'string') return parseUpdatedAt(o.formatted);
		return 0;
	}

	const s = String(raw).trim().toLowerCase();
	if (!s) return 0;

	const now = Date.now();

	if (/^(just\s*now|baru\s*saja|sekarang)$/i.test(s)) return now;

	const rel = s.match(
		/^(\d+)\s*(second|sec| detik|minute|min|menit|hour|hr|jam|day|hari|week|minggu|month|bulan|year|tahun)s?\s*(ago|yang\s*lalu|yl)?/i
	);
	if (rel) {
		const n = parseInt(rel[1], 10);
		const unit = rel[2].toLowerCase();
		const mult =
			/sec|detik/.test(unit) ? 1000 :
			/min|menit/.test(unit) ? 60_000 :
			/hour|hr|jam/.test(unit) ? 3_600_000 :
			/day|hari/.test(unit) ? 86_400_000 :
			/week|minggu/.test(unit) ? 604_800_000 :
			/month|bulan/.test(unit) ? 2_592_000_000 :
			/year|tahun/.test(unit) ? 31_536_000_000 : 0;
		if (mult) return now - n * mult;
	}

	if (/^yesterday|kemarin$/i.test(s)) return now - 86_400_000;
	if (/^today|hari\s*ini$/i.test(s)) return now - 3_600_000;

	const t = Date.parse(String(raw));
	if (Number.isFinite(t) && t > 0) return t;

	const m = String(raw).match(
		/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*,?\s*(\d{4})/i
	) || String(raw).match(
		/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s*(\d{4})/i
	);
	if (m) {
		const months: Record<string, number> = {
			jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
			jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
		};
		let day: number, mon: number, year: number;
		if (/^\d/.test(m[1])) {
			day = parseInt(m[1], 10);
			mon = months[m[2].slice(0, 3).toLowerCase()];
			year = parseInt(m[3], 10);
		} else {
			mon = months[m[1].slice(0, 3).toLowerCase()];
			day = parseInt(m[2], 10);
			year = parseInt(m[3], 10);
		}
		if (mon != null && day && year) {
			return new Date(year, mon, day).getTime();
		}
	}

	return 0;
}

export function syntheticUpdatedAt(page: number, index: number): number {
	const p = Math.max(1, page);
	const i = Math.max(0, index);
	return Date.now() - (p - 1) * 12 * 3_600_000 - i * 3 * 60_000;
}