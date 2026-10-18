export interface SeriesMetadata {
	author: string;
	artist: string;
	type: string;
}

export function getSeriesMetadata(
	description?: string,
	authors: string[] = [],
	type = ''
): SeriesMetadata {
	const metadata: Record<string, string> = {};
	for (const line of String(description || '').split(/\n+/)) {
		const match = line.match(/^\s*([^:]+):\s*(.+)\s*$/);
		if (match) metadata[match[1].trim().toLowerCase()] = match[2].trim();
	}

	return {
		author: metadata.author || authors[0] || '',
		artist: metadata.artist || metadata.artists || authors.join(', '),
		type: metadata.type || type
	};
}
