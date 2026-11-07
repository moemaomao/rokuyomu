/**
 * GigaViewer image descrambler (Comic Gardo, Comic Days, Jump+, dll)
 * Algoritma: 4x4 tile transpose (versi yang dipakai GigaViewer saat ini)
 */
export async function descrambleGiga(url: string): Promise<string> {
	const res = await fetch(url, { referrerPolicy: 'no-referrer' });
	if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
	const blob = await res.blob();
	const img = await createImageBitmap(blob);

	const canvas = document.createElement('canvas');
	canvas.width = img.width;
	canvas.height = img.height;
	const ctx = canvas.getContext('2d')!;

	const COLS = 4;
	const ROWS = 4;

	const tileW = Math.floor(img.width / COLS);
	const tileH = Math.floor(img.height / ROWS);

	for (let y = 0; y < ROWS; y++) {
		for (let x = 0; x < COLS; x++) {
		
			const srcX = x * tileW;
			const srcY = y * tileH;
			const dstX = y * tileW;
			const dstY = x * tileH;

			ctx.drawImage(
				img,
				srcX, srcY, tileW, tileH,
				dstX, dstY, tileW, tileH  
			);
		}
	}

	const remainW = img.width - tileW * COLS;
	const remainH = img.height - tileH * ROWS;
	if (remainW > 0) {
		ctx.drawImage(img, tileW * COLS, 0, remainW, img.height, tileW * COLS, 0, remainW, img.height);
	}
	if (remainH > 0) {
		ctx.drawImage(img, 0, tileH * ROWS, img.width - remainW, remainH, 0, tileH * ROWS, img.width - remainW, remainH);
	}

	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(b) => {
				if (!b) return reject(new Error('toBlob failed'));
				resolve(URL.createObjectURL(b));
			},
			'image/jpeg',
			0.92
		);
	});
}

export const GIGA_SOURCES = new Set([
	'comicgardo',
	// 'comicdays',
	// 'shonenjumpplus',
]);