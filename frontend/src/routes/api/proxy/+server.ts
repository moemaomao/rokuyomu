import type { RequestHandler } from './$types';
import { unscrambleJmImage, parseJmImageUrl } from '$lib/server/unscramble';

const USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 12000;

/** chapterKey -> { cookie, expires } */
const ryukomikSessionCache = new Map<string, { cookie: string; expires: number }>();

function getFilename(url: string, contentType: string): string {
	let filename = 'image';

	try {
		const pathname = new URL(url).pathname;
		const lastPart = pathname.split('/').pop() || '';

		if (lastPart) {
			filename = decodeURIComponent(lastPart);
		}
	} catch {
	}

	filename = filename.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();

	if (!filename) {
		filename = 'image';
	}

	if (!/\.[a-zA-Z0-9]{2,5}$/.test(filename)) {
		const extension = contentType.split('/')[1]?.split(';')[0];

		const extensionMap: Record<string, string> = {
			jpeg: 'jpg',
			pjpeg: 'jpg',
			webp: 'webp',
			png: 'png',
			gif: 'gif',
			avif: 'avif'
		};

		filename += `.${extensionMap[extension] || 'jpg'}`;
	}

	return filename;
}

function ryukomikChapterKeyFromUrl(url: string): string | null {
	// https://storage.ryukomik.my.id/chapters/{slug}/{n}/file.webp
	const m = url.match(/\/chapters\/([^/]+)\/(\d+)\//i);
	if (!m) return null;
	return `${m[1]}/chapter-${m[2]}`;
}

async function unlockRyukomik(chapterKey: string): Promise<string | null> {
	const now = Math.floor(Date.now() / 1000);
	const hit = ryukomikSessionCache.get(chapterKey);
	if (hit && hit.expires > now + 30) return hit.cookie;

	const res = await fetch('https://ryukomik.my.id/api/image-session', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json',
			'user-agent': USER_AGENT,
			referer: `https://ryukomik.my.id/chapter/project/${chapterKey}`,
			origin: 'https://ryukomik.my.id'
		},
		body: JSON.stringify({ chapter: chapterKey })
	});

	const rawText = await res.text();
	if (!res.ok) {
		console.warn('[proxy/ryukomik] image-session', res.status, rawText.slice(0, 200));
		return null;
	}

	let data: { ok?: boolean; expires?: number } = {};
	try {
		data = JSON.parse(rawText);
	} catch {
		/* ignore */
	}

	// Collect all Set-Cookie values (Node / undici / CF Workers)
	const lines: string[] = [];
	const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
	if (typeof anyHeaders.getSetCookie === 'function') {
		lines.push(...anyHeaders.getSetCookie());
	}
	// Fallback: iterate (Workers may expose multiple)
	res.headers.forEach((value, key) => {
		if (key.toLowerCase() === 'set-cookie') lines.push(value);
	});
	const single = res.headers.get('set-cookie');
	if (single && !lines.includes(single)) lines.push(single);

	let cookieVal = '';
	for (const line of lines) {
		const m = String(line).match(/ryu_image_access=([^;\s]+)/i);
		if (m) {
			cookieVal = `ryu_image_access=${m[1]}`;
			break;
		}
	}

	// Last resort: some runtimes hide Set-Cookie from JS — session still needed per request
	if (!cookieVal) {
		console.warn(
			'[proxy/ryukomik] no ryu_image_access in headers; lines=',
			lines.length,
			'raw=',
			rawText.slice(0, 120)
		);
		return null;
	}

	const expires = typeof data.expires === 'number' ? data.expires : now + 3500;
	ryukomikSessionCache.set(chapterKey, { cookie: cookieVal, expires });
	console.log('[proxy/ryukomik] unlocked', chapterKey, 'exp', expires);
	return cookieVal;
}

export const GET: RequestHandler = async ({ url }) => {
	const targetUrl = url.searchParams.get('url');
	const sourceId = url.searchParams.get('source') || '';
	const w = url.searchParams.get('w');
	const h = url.searchParams.get('h');

	if (!targetUrl) {
		return new Response('Missing URL parameter', { status: 400 });
	}

	try {
		let decodedUrl = decodeURIComponent(targetUrl);

		if (decodedUrl.startsWith('//')) {
			decodedUrl = 'https:' + decodedUrl;
		}

		const isHitomi =
			/hitomi\.la|gold-usergeneratedcontent\.net/i.test(decodedUrl);

		const isBlockedWeserv =
			/ihlv1\.xyz|jfimv2\.xyz/i.test(decodedUrl);

		const isNhentai =
			/nhentai\.net/i.test(decodedUrl);

		const isHentairead =
			sourceId === 'hentairead' ||
			/hentairead\.com|hencover|henread/i.test(decodedUrl);

		const isKlz9 =
			sourceId === 'klz9' ||
			/klz9\.com|jfimv2\.xyz/i.test(decodedUrl);

		const isLove4u =
			sourceId === 'love4u' ||
			/love4u\.net/i.test(decodedUrl);

		const isRawkuma =
			sourceId === 'rawkuma' ||
			/rawkuma\.(net|com)|kuma\.kyut\.dev/i.test(decodedUrl);

		const isMangaKatana =
			sourceId === 'mangakatana' ||
			/mangakatana\.com|i\d+\.mangakatana\.com/i.test(decodedUrl);

		const isMangaBats =
			sourceId === 'mangabats' ||
			/mangabats\.xyz|amzim\.beer/i.test(decodedUrl);

		const isMangaBatsCom =
			sourceId === 'mangabatscom' ||
			/mangabats\.com|2xstorage\.com/i.test(decodedUrl);

		const isDoujinDesu =
			sourceId === 'doujindesu' ||
			/desu\.xxx|desu\.pics|amz-ch\.desu\.pics|pic\.desu\.xxx|cdn-static\.desu\.xxx/i.test(
				decodedUrl
			);

		const isCrotpedia =
			sourceId === 'crotpedia' ||
			/crotpedia\.net|eromanga\.cfd|reader\.eromanga\.cfd|cover\.eromanga\.cfd/i.test(
				decodedUrl
			);

		const isBacaKomik =
			sourceId === 'bacakomik' ||
			/bacakomik\.pics|warungkomikcdn\.icu/i.test(decodedUrl);

		const isPixHentai =
			sourceId === 'pixhentai' ||
			/pixhentai\.com|openhentai\.net/i.test(decodedUrl);

		const isMangaCopy =
			sourceId === 'mangacopy' ||
			/mangafun[a-z]*\.(fun|xyz)|mangacopy\.com|copy2000\.|copy-manga\.|202[0-9]copy\.|copy20\.com/i.test(
				decodedUrl
			);
		const isIsekaiKomik =
			sourceId === 'isekaikomik' ||
			/isekaikomik\.(site|com)|cdn\.isekaikomik\.com/i.test(decodedUrl);

		const isIkiru =
			sourceId === 'ikiru' ||
			/ikiru\.wtf|cdn\.uqni\.net/i.test(decodedUrl);
		const isMangakuri =
			sourceId === 'mangakuri' ||
			/mangakuri\.online|cdnmangakuri|lonedev\.my\.id/i.test(decodedUrl);
		const isManhwaIndo =
			sourceId === 'manhwaindo' ||
			/manhwaindo\.my|upload\.gmbr\.pro|kacu\.gmbr\.pro/i.test(decodedUrl);
		const isManhwaDesu =
			sourceId === 'manhwadesu' ||
			/manhwadesu\.wiki|cdn\.uqni\.net/i.test(decodedUrl);
		const isVoratoon =
			sourceId === 'voratoon' ||
			/voratoon\.(com|id)|cvr\.voratoon\.id/i.test(decodedUrl);
		const isMangaDex =
			sourceId === 'mangadex' ||
			/mangadex\.org|uploads\.mangadex\.org/i.test(decodedUrl);
		const isKumopoi =
			sourceId === 'kumopoi' ||
			/kumo\.gorae\.my\.id|kumopoi\.com/i.test(decodedUrl);
		const isAsmHentai =
			sourceId === 'asmhentai' ||
			/asmhentai\.com|images\.asmhentai\.com/i.test(decodedUrl);

		const isManhuagui =
			sourceId === 'manhuagui' ||
			/hamreus\.com|manhuagui\.com|mhgui\.com/i.test(decodedUrl);
		const isJmcomic =
			sourceId === 'jmcomic' ||
			/jmapiproxy|jmapinode|cdn-msp\.|18comic/i.test(decodedUrl);

		const isRyukomik =
			sourceId === 'ryukomik' ||
			/storage\.ryukomik\.my\.id|ryukomik\.my\.id/i.test(decodedUrl);

		const isSoftkomik =
			sourceId === 'softkomik' ||
			/image\.komik\.im|psy1\.komik\.im|softkomik\.(co|org)/i.test(decodedUrl);

		const skipWeserv =
			isHitomi ||
			isBlockedWeserv ||
			isNhentai ||
			isHentairead ||
			isKlz9 ||
			isLove4u ||
			isRawkuma ||
			isMangaKatana ||
			isMangaBats ||
			isMangaBatsCom ||
			isDoujinDesu ||
			isMangaCopy ||
			isIsekaiKomik ||
			isIkiru ||
			isMangaDex ||
			isKumopoi ||
			isAsmHentai ||
			isVoratoon ||
			isManhuagui ||
			isRyukomik ||
			isSoftkomik;

		// ============================================================
		// WESERV
		// ============================================================

		if (
			w &&
			!skipWeserv &&
			/^https?:\/\//i.test(decodedUrl)
		) {
			const weserv =
				'https://images.weserv.nl/?url=' +
				encodeURIComponent(decodedUrl) +
				`&w=${encodeURIComponent(w)}` +
				(h
					? `&h=${encodeURIComponent(h)}&fit=cover`
					: '') +
				'&q=70&output=webp&n=-1';

			return Response.redirect(weserv, 302);
		}

		// Softkomik CDN watermarks datacenter IPs — let the browser fetch directly
		if (isSoftkomik && /^https?:\/\//i.test(decodedUrl)) {
			return Response.redirect(decodedUrl, 302);
		}

		// ============================================================
		// REFERER + COOKIE (ryukomik image-session)
		// ============================================================

		let referer = 'https://nhentai.net/';
		let extraCookie = '';

		try {
			referer = new URL(decodedUrl).origin + '/';
		} catch {
		}

		if (sourceId === 'hitomi' || isHitomi) {
			referer = 'https://hitomi.la/';
		} else if (sourceId === 'asura') {
			referer = 'https://asuracomic.net/';
		} else if (sourceId === 'weloma') {
			referer = 'https://weloma.net/';
		} else if (sourceId === 'nhentai' || isNhentai) {
			referer = 'https://nhentai.net/';
		} else if (isHentairead) {
			referer = 'https://hentairead.com/';
		} else if (isKlz9) {
			referer = 'https://klz9.com/';
		} else if (isLove4u) {
			referer = 'https://love4u.net/';
		} else if (isRawkuma) {
			referer = 'https://rawkuma.net/';
		} else if (sourceId === 'komiku') {
			referer = 'https://komiku.id/';
		} else if (isMangaKatana) {
			referer = 'https://mangakatana.com/';
		} else if (isMangaBatsCom) {
			referer = 'https://www.mangabats.com/';
		} else if (isMangaBats) {
			referer = 'https://mangabats.xyz/';
		} else if (isDoujinDesu) {
			referer = 'https://doujin.desu.xxx/';
		} else if (isCrotpedia) {
			referer = 'https://crotpedia.net/';
		} else if (isBacaKomik) {
			referer = 'https://bacakomik.pics/';
		} else if (isPixHentai) {
			referer = 'https://pixhentai.com/';
		} else if (isMangaCopy) {
			referer = 'https://www.mangacopy.com/';
		} else if (isIsekaiKomik) {
			referer = 'https://ch1.isekaikomik.site/';
		} else if (isIkiru) {
			referer = 'https://08.ikiru.wtf/';
		} else if (isMangakuri) {
			referer = 'https://lc2.mangakuri.online/';
		} else if (isManhwaIndo) {
			referer = 'https://www.manhwaindo.my/';
		} else if (isManhwaDesu) {
			referer = 'https://manhwadesu.wiki/';
		} else if (isVoratoon) {
			referer = 'https://v2.voratoon.com/';
		} else if (isMangaDex) {
			referer = 'https://mangadex.org/';
		} else if (isKumopoi) {
			referer = 'https://beta.kumopoi.com/';
		} else if (isAsmHentai) {
			referer = 'https://asmhentai.com/';
		} else if (isManhuagui) {
			referer = 'https://www.manhuagui.com/';
		} else if (isJmcomic) {
			referer = 'https://www.cdnhjk.net/';
		} else if (isRyukomik) {
			const key = ryukomikChapterKeyFromUrl(decodedUrl);
			if (key) {
				referer = `https://ryukomik.my.id/chapter/project/${key}`;
				const cookie = await unlockRyukomik(key);
				if (cookie) extraCookie = cookie;
			} else {
				referer = 'https://ryukomik.my.id/';
			}
		}

		// ============================================================
		// FETCH IMAGE
		// ============================================================

		const controller = new AbortController();

		const timer = setTimeout(() => {
			controller.abort();
		}, FETCH_TIMEOUT_MS);

		try {
			const headers: Record<string, string> = {
				'User-Agent': USER_AGENT,
				Referer: referer,
				Accept: 'image/webp,image/apng,image/*,*/*;q=0.8',
				'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
			};
			if (extraCookie) headers['Cookie'] = extraCookie;

			const imageResponse = await fetch(decodedUrl, {
				headers,
				signal: controller.signal
			});

			if (!imageResponse.ok) {
				console.warn('[proxy] image fetch fail', imageResponse.status, decodedUrl.slice(0, 120));
				return new Response(
					`Failed to fetch image: ${imageResponse.status}`,
					{
						status: imageResponse.status
					}
				);
			}

			const guard = imageResponse.headers.get('x-ryukomik-image-guard') || '';
			if (isRyukomik && guard === 'promo') {
				console.warn('[proxy/ryukomik] still promo after unlock', decodedUrl.slice(0, 120));
				// drop cache so next try re-sessions
				const k = ryukomikChapterKeyFromUrl(decodedUrl);
				if (k) ryukomikSessionCache.delete(k);
				return new Response('Ryukomik image still locked (promo)', { status: 502 });
			}

			const contentType =
				imageResponse.headers.get('content-type') || 'image/jpeg';

			const filenameParam = url.searchParams.get('filename');
			const filename = filenameParam
				? filenameParam.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()
				: getFilename(decodedUrl, contentType);

			// ── JMComic unscramble ──
			let body: BodyInit = imageResponse.body as any;

			if (isJmcomic) {
				const parsed = parseJmImageUrl(decodedUrl);
				if (parsed) {
					const buf = Buffer.from(await imageResponse.arrayBuffer());
					const fixed = await unscrambleJmImage(buf, parsed.photoId, parsed.filename);
					body = new Uint8Array(fixed);
				}
			}

			return new Response(body, {
				headers: {
					'Content-Type': contentType,
					'Content-Disposition': `inline; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
					'Cache-Control':
						'public, max-age=31536000, immutable',
					'Access-Control-Allow-Origin': '*'
				}
			});

		} finally {
			clearTimeout(timer);
		}
	} catch (error) {
		console.error('Proxy error:', error);

		return new Response('Failed to proxy image', {
			status: 500
		});
	}
};
