/**
 * GigaViewer image descrambler (Comic Gardo, Comic Days, Jump+, dll)
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

	const divideNum = 4;
	const multiple = 8;
	const totalTiles = divideNum * multiple; // 32

	const cellWidth = Math.floor(img.width / totalTiles) * multiple;
	const cellHeight = Math.floor(img.height / totalTiles) * multiple;

	ctx.drawImage(img, 0, 0);

	for (let i = 0; i < totalTiles * totalTiles; i++) {
		const row = Math.floor(i / totalTiles);
		const col = i % totalTiles;

		const sourceX = col * cellWidth;
		const sourceY = row * cellHeight;

		// Transpose
		const destIndex = col * totalTiles + row;
		const destX = (destIndex % totalTiles) * cellWidth;
		const destY = Math.floor(destIndex / totalTiles) * cellHeight;

		if (destX < img.width && destY < img.height) {
			ctx.drawImage(
				img,
				sourceX,
				sourceY,
				cellWidth,
				cellHeight,
				destX,
				destY,
				cellWidth,
				cellHeight
			);
		}
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
	// 
]);