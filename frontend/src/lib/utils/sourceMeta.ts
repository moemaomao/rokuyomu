export type SourceMeta = {
	flag: string;
	lang: string;
	isR18: boolean;
	isError?: boolean;
	color?: string;
};

export const SOURCE_META: Record<string, SourceMeta> = {
	athreascans: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-emerald-500' },
	mangaread: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-emerald-500' },
	madarascans: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-emerald-500' },
	mangataro: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-emerald-500' },
	mangasushi: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-emerald-500' },
	mangakakalot: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-emerald-500' },
	gdscans: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-emerald-500' },
	ksgroupscans: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-emerald-500' },
	vortexscans: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-emerald-500' },
	silentquill: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-emerald-500' },
	doujins: { flag: 'gb', lang: 'EN', isR18: true, color: 'bg-emerald-500' },
	cucumbermanga: { flag: 'gb', lang: 'EN', isR18: true, color: 'bg-emerald-500' },
	weebcentral: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-emerald-500' },
	kaynscans: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-emerald-500' },
	asura: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-emerald-500' },
	manhuarmtl: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-emerald-500' },
	onemanga: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-emerald-500' },
	mangakatana: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-emerald-500' },
	mangabatscom: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-emerald-500' },
	mangabats: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-emerald-500' },
	asurascans: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-emerald-500' },
	flamecomics: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-emerald-500' },
	weloma: { flag: 'jp', lang: 'JP', isR18: false, color: 'bg-blue-500' },
	mangamura: { flag: 'jp', lang: 'JP', isR18: false, color: 'bg-blue-500' },
	renascans: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-pink-500' },
	rawuwu: { flag: 'jp', lang: 'JP', isR18: false, color: 'bg-blue-500' },
	hitomi: { flag: 'un', lang: 'Multi', isR18: true, color: 'bg-pink-600' },
	asmhentai: { flag: 'un', lang: 'Multi', isR18: true, color: 'bg-pink-600' },
	hitomila: { flag: 'un', lang: 'Multi', isR18: true, color: 'bg-pink-600' },
	nhentai: { flag: 'un', lang: 'Multi', isR18: true, color: 'bg-rose-600' },
	nhentainet: { flag: 'un', lang: 'Multi', isR18: true, color: 'bg-rose-600' },
	hentaifox: { flag: 'gb', lang: 'EN', isR18: true, color: 'bg-red-600' },
	hentailoop: { flag: 'gb', lang: 'EN', isR18: true, color: 'bg-red-600' },
	pornhwa: { flag: 'gb', lang: 'EN', isR18: true, color: 'bg-fuchsia-600' },
	kingcomix: { flag: 'gb', lang: 'EN', isR18: true, color: 'bg-orange-600' },
	ehentai: { flag: 'un', lang: 'Multi', isR18: true, color: 'bg-purple-600' },
	klmanga: { flag: 'jp', lang: 'JP', isR18: false, color: 'bg-yellow-500' },
	klz9: { flag: 'jp', lang: 'JP', isR18: false, color: 'bg-yellow-500' },
	love4u: { flag: 'jp', lang: 'JP', isR18: false, color: 'bg-yellow-500' },
	mangadex: { flag: 'un', lang: 'Multi', isR18: false, color: 'bg-yellow-500' },
	mangafire: { flag: 'un', lang: 'Multi', isR18: false, color: 'bg-yellow-500' },
	rawkuma: { flag: 'jp', lang: 'JP', isR18: false, color: 'bg-yellow-500' },
	komiku: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	voratoon: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	softkomik: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	komikindo: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	mangaindo: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	mgkomik: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	doujindesu: { flag: 'id', lang: 'ID', isR18: true, color: 'bg-green-500' },
	crotpedia: { flag: 'id', lang: 'ID', isR18: true, color: 'bg-green-500' },
	bacakomik: { flag: 'id', lang: 'ID', isR18: true, color: 'bg-green-500' },
	pixhentai: { flag: 'id', lang: 'ID', isR18: true, color: 'bg-green-500' },
	imhentai: { flag: 'un', lang: 'Multi', isR18: true, color: 'bg-pink-600' },
	hentai2read: { flag: 'gb', lang: 'EN', isR18: true, color: 'bg-orange-600' },
	pornhwa18: { flag: 'gb', lang: 'EN', isR18: true, color: 'bg-orange-600' },
	hentairead: { flag: 'gb', lang: 'EN', isR18: true, color: 'bg-orange-600' },
	hentaiera: { flag: 'un', lang: 'Multi', isR18: true, color: 'bg-pink-600' },
	simplyhentai: { flag: 'gb', lang: 'EN', isR18: true, color: 'bg-orange-600' },
	zonatmo: { flag: 'es', lang: 'ES', isR18: false, color: 'bg-red-500' },
	lectortmo: { flag: 'es', lang: 'ES', isR18: false, color: 'bg-red-500' },
	mangacopy: { flag: 'cn', lang: 'CN', isR18: false, color: 'bg-red-500' },
	jmcomic: { flag: 'cn', lang: 'CN', isR18: false, color: 'bg-red-500' },
	manhuagui: { flag: 'cn', lang: 'CN', isR18: false, color: 'bg-red-500' },
	omegascans: { flag: 'gb', lang: 'EN', isR18: true, color: 'bg-orange-600' },
	luvyaa: { flag: 'id', lang: 'ID', isR18: true, color: 'bg-green-500' },
	kiryuu: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	komikstation: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	shinigami: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
    ainzscans: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	bacami: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	comicaso: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	dojing: { flag: 'id', lang: 'ID', isR18: true, color: 'bg-green-500' },
	doujinku: { flag: 'id', lang: 'ID', isR18: true, color: 'bg-green-500' },
	holodek: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	ikiru: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	isekaikomik: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	maid: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	mangakuri: { flag: 'id', lang: 'ID', isR18: true, color: 'bg-green-500' },
	lumos: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	lunarx: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	mangasusu: { flag: 'id', lang: 'ID', isR18: true, color: 'bg-green-500' },
	manhwaindo: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	manhwadesu: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	natsu: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	ngomik: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	noromax: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	ryukomik: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	sasangeyou: { flag: 'id', lang: 'ID', isR18: true, color: 'bg-green-500' },
	sektedoujin: { flag: 'id', lang: 'ID', isR18: true, color: 'bg-green-500' },
	kumopoi: { flag: 'id', lang: 'ID', isR18: true, color: 'bg-green-500' },
	siikomik: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	westmanga: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	soulscans: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-green-500' },
	ravenscans: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-red-500' },
	demonicscans: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-purple-600' },
	areakomik: { flag: 'id', lang: 'ID', isR18: true, color: 'bg-red-600' },
	genztoons: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-purple-600' },
	setsuscans: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-indigo-600' },
	sakuranovel: { flag: 'id', lang: 'ID', isR18: false, color: 'bg-amber-500' },
	noveltoon: { flag: 'gb', lang: 'EN', isR18: false, color: 'bg-amber-500' },
};

export const DEFAULT_META: SourceMeta = {
	flag: 'un',
	lang: 'Other',
	isR18: false,
	isError: false,
	color: 'bg-zinc-600'
};

export const LANG_LABELS: Record<string, string> = {
	EN: 'English',
	JP: 'Japanese',
	ID: 'Indonesian',
	ES: 'Spanish',
	CN: 'Chinese',
	Multi: 'Multilingual'
};

export const LANG_FILTER_SOURCES = [
	'hitomi',
	'nhentai',
	'imhentai',
	'ehentai',
	'hentaiera',
	'mangadex',
	'mangafire',
	'asmhentai'
];

export function getSourceMeta(id: string): SourceMeta {
	if (!id) return DEFAULT_META;
	const clean = id.toLowerCase().replace(/[^a-z0-9]/g, '');
	if (SOURCE_META[clean]) return SOURCE_META[clean];
	const key = Object.keys(SOURCE_META).find((k) => clean.includes(k));
	return key ? SOURCE_META[key] : DEFAULT_META;
}

export function groupSourcesByLang<T extends { id: string; name?: string }>(sources: T[]): Record<string, T[]> {
	const groups: Record<string, T[]> = {};
	for (const src of sources) {
		const key = getSourceMeta(src.id).lang || 'Other';
		if (!groups[key]) groups[key] = [];
		groups[key].push(src);
	}

	for (const key of Object.keys(groups)) {
		groups[key].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
	}

	const order = ['Multi', 'JP', 'EN', 'ID', 'ES', 'CN'];
	const sorted: Record<string, T[]> = {};
	for (const k of order) if (groups[k]) sorted[k] = groups[k];
	for (const k of Object.keys(groups).sort()) if (!sorted[k]) sorted[k] = groups[k];
	return sorted;
}

export function normalizeSourceId(id: string): string {
	return String(id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function sourceHasError(
	id: string,
	brokenIds?: Set<string> | Iterable<string> | null
): boolean {
	const meta = getSourceMeta(id);
	if (meta.isError) return true;
	if (!brokenIds) return false;
	const clean = normalizeSourceId(id);
	if (brokenIds instanceof Set) return brokenIds.has(clean);
	for (const x of brokenIds) {
		if (normalizeSourceId(String(x)) === clean) return true;
	}
	return false;
}
