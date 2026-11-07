/**
 * JMComic image unscramble (禁漫图片解密)
 */
import { createHash } from 'crypto';

const SCRAMBLE_220980 = 220980;
const SCRAMBLE_268850 = 268850;
const SCRAMBLE_421926 = 421926;

export function getScrambleNum(photoId: string | number, filename: string): number {
	const aid = parseInt(String(photoId).replace(/\D/g, ''), 10);
	if (!aid || Number.isNaN(aid)) return 0;
	if (aid < SCRAMBLE_220980) return 0;
	if (aid < SCRAMBLE_268850) return 10;

	const x = aid < SCRAMBLE_421926 ? 10 : 8;
	const name = filename.replace(/\.[^.]+$/, '');
	const s = createHash('md5').update(`${aid}${name}`, 'utf8').digest('hex');
	const num = s.charCodeAt(s.length - 1) % x;
	return num * 2 + 2;
}

export function parseJmImageUrl(url: string): { photoId: string; filename: string } | null {
	const m = url.match(/\/media\/photos\/(\d+)\/([^/?#]+)/i);
	if (!m) return null;
	return { photoId: m[1], filename: m[2] };
}

export async function unscrambleJmImage(
	buffer: Buffer,
	photoId: string,
	filename: string
): Promise<Buffer> {
	const num = getScrambleNum(photoId, filename);
	if (num <= 0) return buffer;

	let sharp: typeof import('sharp').default;
	try {
		sharp = (await import('sharp')).default;
	} catch (e) {
		console.error('[jm-unscramble] sharp not available, skip unscramble:', e);
		return buffer;
	}

	try {
		const meta = await sharp(buffer).metadata();
		const w = meta.width;
		const h = meta.height;
		if (!w || !h) return buffer;

		const over = h % num;
		const composites: { input: Buffer; top: number; left: number }[] = [];

		for (let i = 0; i < num; i++) {
			let move = Math.floor(h / num);
			let ySrc = h - move * (i + 1) - over;
			let yDst = move * i;

			if (i === 0) {
				move += over;
			} else {
				yDst += over;
			}

			if (ySrc < 0) ySrc = 0;
			if (ySrc + move > h) move = h - ySrc;
			if (move <= 0) continue;

			const strip = await sharp(buffer)
				.extract({ left: 0, top: ySrc, width: w, height: move })
				.toBuffer();

			composites.push({ input: strip, top: yDst, left: 0 });
		}

		const format =
			meta.format === 'webp' ? 'webp' : meta.format === 'png' ? 'png' : 'jpeg';

		let pipeline = sharp({
			create: {
				width: w,
				height: h,
				channels: 3,
				background: { r: 255, g: 255, b: 255 }
			}
		}).composite(composites);

		if (format === 'webp') pipeline = pipeline.webp({ quality: 90 });
		else if (format === 'png') pipeline = pipeline.png();
		else pipeline = pipeline.jpeg({ quality: 90 });

		return await pipeline.toBuffer();
	} catch (e) {
		console.error('[jm-unscramble] unscramble failed, return original:', e);
		return buffer;
	}
}
