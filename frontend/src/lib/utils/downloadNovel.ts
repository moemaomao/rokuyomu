import {
	supportsFileSystemAccess,
	ensureLibraryRoot,
	requestStoredLibraryRoot,
	pickLibraryRoot,
	saveNovelPdfToDisk,
	sanitizePathSegment
} from '$lib/utils/localFs';
import { upsertLibraryEntry } from '$lib/stores/download.svelte';
import { cacheLibraryCover } from '$lib/utils/cacheCover';
import { saveOfflineNovelChapter } from '$lib/utils/offlineChapter';

export type NovelDownloadProgress = {
	phase: 'fetch' | 'pdf' | 'epub' | 'disk' | 'done' | 'error';
	current: number;
	total: number;
	message?: string;
};

type ProgressCb = (p: NovelDownloadProgress) => void;

function sanitizeFilename(name: string): string {
	return (
		String(name || 'chapter')
			.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, 120) || 'chapter'
	);
}

function shortChapterFilename(chapterTitle: string, chapterId?: string): string {
	const t = String(chapterTitle || '').trim();
	const m =
		t.match(/\b(?:chapter|ch\.?|bab|episode|ep\.?)\s*[-_.]?\s*(\d+(?:\.\d+)?)/i) ||
		t.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
	if (m) return `Chapter ${m[1]}`;

	const id = String(chapterId || '');
	const fromId =
		id.match(/(?:chapter|ch|bab|ep)[-_]?(\d+(?:\.\d+)?)/i) ||
		id.match(/[-_](\d+(?:\.\d+)?)(?:p\d+)?\/?$/i);
	if (fromId) return `Chapter ${fromId[1]}`;

	const any = t.match(/(\d+(?:\.\d+)?)/);
	if (any) return `Chapter ${any[1]}`;

	return 'Chapter';
}

function looksLikeChapterTitle(s: string): boolean {
	const t = String(s || '').trim();
	if (!t) return true;
	if (/^(chapter|ch\.?|bab|episode|ep\.?|part|arc)\s*[-_.]?\s*\d+/i.test(t)) return true;
	if (/^\d+(\.\d+)?$/.test(t)) return true;
	if (/^chapter\s+\d+/i.test(t)) return true;
	return false;
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

export function buildSimplePdf(title: string, body: string): Blob {
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

		const streamLines: string[] = ['BT', '/F1 11 Tf', '50 780 Td', '14 TL'];
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
	novelInfo?: { title?: string; id?: string; cover?: string };
};

async function fetchNovelChapter(
	source: string,
	chapterId: string
): Promise<{ title: string; content: string; rawHtml?: string; novelTitle?: string; novelId?: string }> {
	const chapter = chapterId.startsWith('/') ? chapterId : `/${chapterId}`;
	const params = new URLSearchParams({ source, chapter });
	const res = await fetch(`/api/novel-chapter?${params}`);
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`novel-chapter ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`);
	}
	const j = (await res.json()) as NovelChapterJson & Record<string, unknown>;
	const title = String(j.title || j.chapterTitle || 'Chapter');
	const raw = String(j.content || j.text || (j as any).body || (j as any).html || '');
	const content = htmlToPlainText(raw);
	if (!content.trim()) throw new Error('Empty novel content from API');

	const novelTitle = j.novelInfo?.title || (j as any).novelTitle || (j as any).mangaTitle;
	const novelId = j.novelInfo?.id || (j as any).novelId || (j as any).mangaId;

	return {
		title,
		content,
		rawHtml: raw.trim() || undefined,
		novelTitle: novelTitle ? String(novelTitle) : undefined,
		novelId: novelId ? String(novelId) : undefined
	};
}

function stripTrailingChapterIndex(title: string, chapterTitle: string, chapterId?: string): string {
	let t = title.trim();
	const chNum =
		String(chapterId || '').match(/-(\d+(?:\.\d+)?)(?:p\d+)?\/?$/i)?.[1] ||
		String(chapterTitle || '').match(
			/\b(?:chapter|ch\.?|bab|episode|ep\.?)\s*[-_.]?\s*(\d+(?:\.\d+)?)/i
		)?.[1];
	if (chNum) {
		const re = new RegExp(`\\s+${chNum.replace('.', '\\.')}\\s*$`);
		const stripped = t.replace(re, '').trim();
		if (stripped.length >= 2) t = stripped;
	}
	t = t.replace(/\s+-\s+\d+(?:\.\d+)?\s*$/, '').trim();
	return t;
}

function resolveNovelTitle(
	explicit: string | undefined,
	fromApi: string | undefined,
	chapterTitle: string,
	fallbackId?: string,
	chapterId?: string
): string {
	const candidates = [explicit, fromApi].filter(Boolean) as string[];
	for (const c of candidates) {
		if (!c || looksLikeChapterTitle(c)) continue;
		const cleaned = stripTrailingChapterIndex(c, chapterTitle, chapterId);
		if (cleaned && !looksLikeChapterTitle(cleaned)) return cleaned;
	}
	if (fallbackId) {
		const slug = String(fallbackId)
			.replace(/^\/+/, '')
			.split('/')
			.filter(Boolean)
			.pop();
		if (slug && !looksLikeChapterTitle(slug)) {
			const base = slug.replace(/-\d+(?:\.\d+)?(?:p\d+)?$/i, '') || slug;
			return base.replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
		}
	}
	return 'Unknown Novel';
}



function escapeXml(s: string): string {
	return String(s || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function plainTextToXhtmlParagraphs(body: string): string {
	const paras = String(body || '')
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.split(/\n{2,}/)
		.map((p) => p.replace(/\n/g, '<br/>').trim())
		.filter(Boolean);
	if (!paras.length) return '<p></p>';
	return paras.map((p) => `<p>${escapeXml(p).replace(/&lt;br\/&gt;/g, '<br/>')}</p>`).join('\n');
}

async function tryLoadJSZip(): Promise<any | null> {
	try {
		const mod = await import('jszip');
		return (mod as any).default || mod;
	} catch {
		/* continue */
	}
	const g = globalThis as any;
	if (g.JSZip) return g.JSZip;
	await new Promise<void>((resolve, reject) => {
		const s = document.createElement('script');
		s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
		s.onload = () => resolve();
		s.onerror = () => reject(new Error('JSZip load failed'));
		document.head.appendChild(s);
	});
	return g.JSZip || null;
}

export async function buildSimpleEpub(opts: {
	novelTitle: string;
	chapterTitle: string;
	body: string;
	author?: string;
}): Promise<Blob> {
	const JSZip = await tryLoadJSZip();
	if (!JSZip) throw new Error('JSZip unavailable for EPUB');

	const novelTitle = String(opts.novelTitle || 'Novel').trim() || 'Novel';
	const chapterTitle = String(opts.chapterTitle || 'Chapter').trim() || 'Chapter';
	const author = String(opts.author || 'Unknown').trim() || 'Unknown';
	const uid = `rokuyomu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

	const zip = new JSZip();

	zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
	zip.file(
		'META-INF/container.xml',
		`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`
	);

	zip.file(
		'OEBPS/style.css',
		`body { font-family: serif; line-height: 1.6; margin: 1em; }
h1 { font-size: 1.4em; margin: 0 0 1em; }
p { margin: 0 0 0.85em; text-indent: 1.2em; }
p:first-of-type { text-indent: 0; }
`
	);

	const bodyHtml = plainTextToXhtmlParagraphs(opts.body);
	zip.file(
		'OEBPS/chapter.xhtml',
		`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(chapterTitle)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <h1>${escapeXml(chapterTitle)}</h1>
  ${bodyHtml}
</body>
</html>
`
	);

	zip.file(
		'OEBPS/nav.xhtml',
		`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Navigation</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Table of Contents</h1>
    <ol>
      <li><a href="chapter.xhtml">${escapeXml(chapterTitle)}</a></li>
    </ol>
  </nav>
</body>
</html>
`
	);

	zip.file(
		'OEBPS/content.opf',
		`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">${escapeXml(uid)}</dc:identifier>
    <dc:title>${escapeXml(novelTitle)} — ${escapeXml(chapterTitle)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${now}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>
`
	);

	return zip.generateAsync({
		type: 'blob',
		mimeType: 'application/epub+zip',
		compression: 'DEFLATE',
		compressionOptions: { level: 6 }
	});
}

function toOfflineHtml(raw: string): string {
	const s = String(raw || '').trim();
	if (!s) return '';
	if (/<(p|div|br|h[1-6]|li|section)\b/i.test(s)) return s;
	return plainTextToXhtmlParagraphs(s);
}

export async function downloadNovelChapterPdf(opts: {
	source: string;
	chapterId: string;
	chapterTitle?: string;
	novelTitle?: string;
	mangaId?: string;
	cover?: string;
	batchMode?: boolean;
	onProgress?: ProgressCb;
}): Promise<void> {
	const { source, chapterId, cover, onProgress, batchMode = false } = opts;
	const report = (p: NovelDownloadProgress) => onProgress?.(p);

	report({ phase: 'fetch', current: 0, total: 1, message: 'Fetching chapter…' });
	const data = await fetchNovelChapter(source, chapterId);
	const title = opts.chapterTitle || data.title || 'Chapter';
	const content = htmlToPlainText(data.content || '');
	if (!content) throw new Error('Empty novel content');

	const novelTitle = resolveNovelTitle(
		opts.novelTitle,
		data.novelTitle,
		title,
		opts.mangaId || data.novelId,
		chapterId
	);

	let mangaId = opts.mangaId || data.novelId || '';
	if (mangaId) {
		const mid = mangaId.startsWith('/') ? mangaId : `/${mangaId}`;
		const stripped = mid.replace(/-(\d+(?:\.\d+)?)(?:p\d+)?\/?$/i, '');
		if (stripped.length > 1 && stripped !== mid) mangaId = stripped;
	}
	const chapterFileLabel = shortChapterFilename(title, chapterId);

	const offlineHtml = (() => {
		const raw = String((data as any).rawHtml || '').trim();
		if (raw && /<[a-z][\s\S]*>/i.test(raw)) {
			// Keep original HTML (images, formatting); only strip scripts
			return raw
				.replace(/<script[\s\S]*?<\/script>/gi, '')
				.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
		}
		return toOfflineHtml((data.content && String(data.content).trim()) || content);
	})();

	if (batchMode) {
		report({ phase: 'fetch', current: 1, total: 1, message: 'Saving offline…' });
		try {
			await saveOfflineNovelChapter({
				sourceId: source,
				mangaId: mangaId || chapterId,
				chapterId: String(chapterId),
				novelTitle,
				chapterTitle: title,
				content: offlineHtml
			});
		} catch (e) {
			console.warn('[offline] save novel chapter failed', e);
		}
		let savedPath = '';
		try {
			const preferDisk =
				(await import('$lib/stores/preferences')).prefersDiskDownload() &&
				supportsFileSystemAccess();
			if (preferDisk) {
				const root =
					(await requestStoredLibraryRoot()) ||
					(await ensureLibraryRoot());
				if (root) {
					report({ phase: 'disk', current: 1, total: 1, message: 'Saving HTML…' });
					const htmlDoc = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>${escapeXml(title)}</title>
<style>body{font-family:serif;line-height:1.6;max-width:40rem;margin:1.5rem auto;padding:0 1rem}
img{max-width:100%;height:auto}p{margin:0 0 .85em}</style>
</head><body><h1>${escapeXml(title)}</h1>
${offlineHtml}
</body></html>`;
					const htmlBlob = new Blob([htmlDoc], { type: 'text/html;charset=utf-8' });
					savedPath = await saveNovelPdfToDisk({
						root,
						novelTitle: sanitizePathSegment(novelTitle),
						chapterTitle: chapterFileLabel,
						pdfBlob: htmlBlob,
						ext: 'html',
						meta: {
							source,
							mangaId: mangaId || '',
							novelTitle,
							chapterId,
							chapterTitle: title,
							savedAt: Date.now(),
							isNovel: true,
							format: 'html'
						}
					});
				}
			}
		} catch (e) {
			console.warn('[novel] batch disk save', e);
		}
		try {
			void cacheLibraryCover({
				mangaId: mangaId || chapterId,
				sourceId: source,
				coverUrl: cover || '',
				title: novelTitle,
				isNovel: true
			});
			await upsertLibraryEntry({
				mangaId: mangaId || chapterId,
				mangaTitle: novelTitle,
				cover: cover || '',
				sourceId: source,
				isNovel: true,
				localPath: savedPath || undefined,
				chapters: [
					{
						chapterId: String(chapterId),
						chapterTitle: title,
						savedAt: Date.now(),
						pageCount: 1
					}
				]
			});
		} catch (e) {
			console.warn('[library] upsert failed', e);
		}
		report({ phase: 'done', current: 1, total: 1, message: 'Offline saved' });
		return;
	}

	const format =
		(await import('$lib/stores/preferences')).getNovelDownloadFormat() === 'epub'
			? 'epub'
			: 'pdf';
	const heading = [novelTitle, title].filter(Boolean).join(' — ');

	let fileBlob: Blob;
	if (format === 'epub') {
		report({ phase: 'epub', current: 0, total: 1, message: 'Building EPUB…' });
		fileBlob = await buildSimpleEpub({
			novelTitle,
			chapterTitle: title,
			body: content
		});
	} else {
		report({ phase: 'pdf', current: 0, total: 1, message: 'Building PDF…' });
		fileBlob = buildSimplePdf(heading, content);
	}

	try {
		await saveOfflineNovelChapter({
			sourceId: source,
			mangaId: mangaId || chapterId,
			chapterId: String(chapterId),
			novelTitle,
			chapterTitle: title,
			content: offlineHtml,
			pdfBlob: format === 'pdf' ? fileBlob : undefined
		});
	} catch (e) {
		console.warn('[offline] save novel chapter failed', e);
	}
	const fileName = sanitizeFilename(chapterFileLabel) + (format === 'epub' ? '.epub' : '.pdf');

	let savedPath = '';
	const preferDisk =
		(await import('$lib/stores/preferences')).prefersDiskDownload() &&
		supportsFileSystemAccess();

	if (preferDisk) {
		try {
			const root =
				(await requestStoredLibraryRoot()) ||
				(await ensureLibraryRoot()) ||
				(await pickLibraryRoot());
			if (root) {
				report({ phase: 'disk', current: 1, total: 1, message: 'Saving to local folder…' });
				savedPath = await saveNovelPdfToDisk({
					root,
					novelTitle: sanitizePathSegment(novelTitle),
					chapterTitle: chapterFileLabel,
					pdfBlob: fileBlob,
					ext: format,
					meta: {
						source,
						mangaId: mangaId || '',
						novelTitle,
						chapterId,
						chapterTitle: title,
						savedAt: Date.now(),
						isNovel: true,
						format
					}
				});
			}
		} catch (e) {
			console.warn('[novel] save to local folder failed', e);
			savedPath = '';
		}
	}

	if (!savedPath) {
		triggerDownload(fileBlob, fileName);
	}
	try {
		void cacheLibraryCover({
			mangaId: mangaId || chapterId,
			sourceId: source,
			coverUrl: cover || '',
			title: novelTitle,
			isNovel: true
		});
		await upsertLibraryEntry({
			mangaId: mangaId || chapterId,
			mangaTitle: novelTitle,
			cover: cover || '',
			sourceId: source,
			isNovel: true,
			localPath: savedPath || undefined,
			chapters: [
				{
					chapterId: String(chapterId),
					chapterTitle: title,
					savedAt: Date.now(),
					pageCount: 1
				}
			]
		});
	} catch (e) {
		console.warn('[library] upsert failed', e);
	}

	report({ phase: 'done', current: 1, total: 1, message: savedPath || fileName });
}

export const buildSimplePdfForAuto = buildSimplePdf;
export const buildSimpleEpubForAuto = buildSimpleEpub;
