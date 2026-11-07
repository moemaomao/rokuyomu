/**
 * Level / XP helpers for Rokuyomu.
 * - Level curve: need grows with lv (harder each level)
 * - Chapter XP: base 5 per advanced chapter, scaled down by level (diminishing)
 * - Progress markers: prefer counting chapter advances, not raw chapter numbers
 */

export type LevelInfo = {
	lv: number;
	need: number;
	remaining: number;
	progress: number;
	rank: string;
	rankCls: string;
	totalXp: number;
};

const CHAPTER_SOFT_CAP = 80;

export function xpNeedForLevel(lv: number): number {
	if (lv <= 1) return 100;
	return 50 + lv * 50 + Math.floor(lv * lv * 2);
}

export function computeLevelInfo(totalXp: number): LevelInfo {
	const xp = Math.max(0, Math.floor(totalXp));
	let lv = 1;
	let need = xpNeedForLevel(1);
	let remaining = xp;

	while (remaining >= need && lv < 99) {
		remaining -= need;
		lv++;
		need = xpNeedForLevel(lv);
	}

	const progress = Math.min(100, Math.round((remaining / need) * 100));

	let rank = 'Rookie Reader';
	let rankCls = 'from-zinc-400 to-zinc-300';
	if (lv >= 40) {
		rank = 'Grand Master';
		rankCls = 'from-amber-400 to-yellow-300';
	} else if (lv >= 25) {
		rank = 'Elite Reader';
		rankCls = 'from-violet-400 to-fuchsia-400';
	} else if (lv >= 15) {
		rank = 'Veteran';
		rankCls = 'from-sky-400 to-cyan-300';
	} else if (lv >= 8) {
		rank = 'Book Hunter';
		rankCls = 'from-emerald-400 to-teal-300';
	} else if (lv >= 3) {
		rank = 'Page Turner';
		rankCls = 'from-orange-400 to-amber-300';
	}

	return { lv, need, remaining, progress, rank, rankCls, totalXp: xp };
}

export function xpScaleForLevel(level: number): number {
	const lv = Math.max(1, Math.floor(level));
	return 1 / Math.sqrt(lv);
}

export function chapterProgressXp(chapterNumber: unknown): number {
	const n = Number(chapterNumber);
	if (!Number.isFinite(n) || n <= 0) return 1;
	const capped = Math.min(n, CHAPTER_SOFT_CAP);
	return Math.max(1, Math.round(Math.sqrt(capped) * 3.2));
}

export function chapterAdvanceXp(advanced: number, level: number): number {
	const adv = Math.max(0, Math.floor(advanced));
	if (adv <= 0) return 0;
	const raw = adv * 5;
	const scaled = Math.round(raw * xpScaleForLevel(level));
	return Math.max(1, scaled);
}

export function computeTotalXp(opts: {
	titleCount: number;
	bookmarkCount: number;
	sourceCount: number;
	chapterProgressXpSum?: number;
}): number {
	const titles = Math.max(0, opts.titleCount | 0);
	const bookmarks = Math.max(0, opts.bookmarkCount | 0);
	const sources = Math.max(0, opts.sourceCount | 0);
	const chapterXp = Math.max(0, opts.chapterProgressXpSum ?? 0);
	return titles * 25 + bookmarks * 20 + sources * 8 + chapterXp;
}

export function sumChapterMarkers(entries: { chapterNumber?: unknown }[]): number {
	const sum = entries.reduce((s, h) => {
		const n = Number(h.chapterNumber);
		return s + (Number.isFinite(n) && n > 0 ? n : 1);
	}, 0);
	return Math.round(sum * 10) / 10;
}

export function sumChapterProgressXp(entries: { chapterNumber?: unknown }[]): number {
	return entries.reduce((s, h) => s + chapterProgressXp(h.chapterNumber), 0);
}
