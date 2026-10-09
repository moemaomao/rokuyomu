import {
	supportsFileSystemAccess,
	ensureLibraryRoot,
	saveNovelPdfToDisk,
	sanitizePathSegment
} from '$lib/utils/localFs';
import { upsertLibraryEntry } from '$lib/stores/library.svelte';

export type NovelDownloadProgress = {
	phase: 'fetch' | 'pdf' | 'disk' | 'done' | 'error';
	current: number;
	total: number;
	message?: string;
};


type ProgressCb = (p: NovelDownloadProgress) => void;

function sanitizeFilename(name: string): string {
	return String(name || 'chapter')
		.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 120) || 'chapter';
}

function triggerDownload(blob: Blob, filename: string) {
	const a = document.createElement('a');
	const href = URL.createObjectURL(blob);
	a.href = href;
	a.download = filename;
	a.rel = 'noopener';
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(href), 4000);
}

function buildSimplePdf(title: string, body: string): Blob {
	const escapePdf = (s: string) =>
		s
			.replace(/\\/g, '\\\\')
			.replace(/\(/g, '\\(')
			.replace(/\)/g, '\\)');

	const rawLines = body
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.split('\n')
		.flatMap((line) => {
			const words = line.split(/\s+/);
			const out: string[] = [];
			let cur = '';
			for (const w of words) {
				if ((cur + ' ' + w).trim().length > 88) {
					if (cur) out.push(cur);
					cur = w;
				} else {
					cur = cur ? cur + ' ' + w : w;
				}
			}
			if (cur) out.push(cur);
			if (!line.trim()) out.push('');
			return out;
		});

	const linesPerPage = 48;
	const pages: string[][] = [];
	for (let i = 0; i < rawLines.length; i += linesPerPage) {
		pages.push(rawLines.slice(i, i + linesPerPage));
	}
	if (!pages.length) pages.push(['']);

	const objects: string[] = [];
	const offsets: number[] = [0];

	const addObj = (content: string) => {
		objects.push(content);
		return objects.length;
	};

	addObj('<< /Type /Catalog /Pages 2 0 R >>');
	addObj('');

	const pageObjIds: number[] = [];
	const contentObjIds: number[] = [];

	for (let p = 0; p < pages.length; p++) {
		const contentId = objects.length + 2;
		const pageId = objects.length + 1;

		const streamLines: string[] = [
			'BT',
			'/F1 11 Tf',
			'50 780 Td',
			'14 TL'
		];
		if (p === 0 && title) {
			streamLines.push(`/F1 14 Tf (${escapePdf(title.slice(0, 80))}) Tj`);
			streamLines.push('0 -20 Td');
			streamLines.push('/F1 11 Tf');
		}
		for (const line of pages[p]) {
			streamLines.push(`(${escapePdf(line.slice(0, 120))}) Tj`);
			streamLines.push('T*');
		}
		streamLines.push('ET');
		const stream = streamLines.join('\n');
		const contentObj = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
		const cId = addObj(contentObj);
		contentObjIds.push(cId);

		const pageObj = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${cId} 0 R /Resources << /Font << /F1 ${3 + pages.length * 2} 0 R >> >> >>`;
		pageObjIds.push(addObj(pageObj));
	}

	const fontId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

	for (let i = 0; i < pageObjIds.length; i++) {
		const idx = pageObjIds[i] - 1;
		objects[idx] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjIds[i]} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
	}

	const kids = pageObjIds.map((id) => `${id} 0 R`).join(' ');
	objects[1] = `<< /Type /Pages /Kids [ ${kids} ] /Count ${pageObjIds.length} >>`;

	let pdf = '%PDF-1.4\n';
	offsets[0] = 0;
	for (let i = 0; i < objects.length; i++) {
		offsets[i + 1] = pdf.length;
		pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
	}
	const xrefPos = pdf.length;
	pdf += `xref\n0 ${objects.length + 1}\n`;
	pdf += `0000000000 65535 f \n`;
	for (let i = 1; i <= objects.length; i++) {
		pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
	}
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
	pdf += `startxref\n${xrefPos}\n%%EOF`;

	return new Blob([pdf], { type: 'application/pdf' });
}

function htmlToPlainText(raw: string): string {
	let s = String(raw || '');

	s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
	s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
	s = s.replace(/<ins[\s\S]*?<\/ins>/gi, '');
	s = s.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
	s = s.replace(/<!--[\s\S]*?-->/g, '');
	s = s.replace(/<br\s*\/?>/gi, '\n');
	s = s.replace(/<\/p>/gi, '\n\n');
	s = s.replace(/<\/div>/gi, '\n');
	s = s.replace(/<\/h[1-6]>/gi, '\n\n');
	s = s.replace(/<\/li>/gi, '\n');
	s = s.replace(/<[^>]+>/g, '');
	s = s
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&apos;/gi, "'")
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
	s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
	return s;
}

type NovelChapterJson = {
	title?: string;
	chapterTitle?: string;
	content?: string;
	text?: string;
};

async function fetchNovelChapter(
	source: string,
	chapterId: string
): Promise<{ title: string; content: string }> {
	const chapter = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
	const params = new URLSearchParams({ source, chapter });
	const res = await fetch(`/api/novel-chapter?${params}`);
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`novel-chapter ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`);
	}
	const j = (await res.json()) as NovelChapterJson & Record<string, unknown>;
	const title = String(j.title || j.chapterTitle || 'Chapter');
	const raw = String(
		j.content || j.text || (j as any).body || (j as any).html || ''
	);
	const content = htmlToPlainText(raw);
	if (!content.trim()) throw new Error('Empty novel content from API');
	return { title, content };
}

export async function downloadNovelChapterPdf(opts: {
	source: string;
	chapterId: string;
	chapterTitle?: string;
	novelTitle?: string;
	mangaId?: string;
	cover?: string;
	onProgress?: ProgressCb;
}): Promise<void> {
	const { source, chapterId, novelTitle, mangaId, cover, onProgress } = opts;
	const report = (p: NovelDownloadProgress) => onProgress?.(p);

	report({ phase: 'fetch', current: 0, total: 1, message: 'Fetching chapter…' });
	const data = await fetchNovelChapter(source, chapterId);
	const title = opts.chapterTitle || data.title || 'Chapter';
	const content = htmlToPlainText(data.content || '');
	if (!content) throw new Error('Empty novel content');

	report({ phase: 'pdf', current: 0, total: 1, message: 'Building PDF…' });
	const heading = [novelTitle, title].filter(Boolean).join(' — ');
	const pdfBlob = buildSimplePdf(heading, content);
	const fileName = sanitizeFilename(
		[novelTitle, title].filter(Boolean).join(' - ')
	) + '.pdf';

	if (supportsFileSystemAccess()) {
		const root = await ensureLibraryRoot();
		if (root) {
			report({ phase: 'disk', current: 1, total: 1, message: 'Saving to local folder…' });
			const path = await saveNovelPdfToDisk({
				root,
				novelTitle: sanitizePathSegment(novelTitle || 'Novel'),
				chapterTitle: title,
				pdfBlob,
				meta: {
					source,
					mangaId: mangaId || '',
					novelTitle: novelTitle || '',
					chapterId,
					chapterTitle: title,
					savedAt: Date.now(),
					isNovel: true
				}
			});

			try {
				await upsertLibraryEntry({
					mangaId: mangaId || chapterId,
					mangaTitle: novelTitle || title,
					cover: cover || '',
					sourceId: source,
					isNovel: true,
					localPath: path,
					chapters: [
						{
							chapterId,
							chapterTitle: title,
							savedAt: Date.now(),
							pageCount: 1
						}
					]
				});
			} catch (e) {
				console.warn('[library] upsert failed', e);
			}

			report({ phase: 'done', current: 1, total: 1, message: path });
			return;
		}
	}

	triggerDownload(pdfBlob, fileName);
	report({ phase: 'done', current: 1, total: 1 });
}
