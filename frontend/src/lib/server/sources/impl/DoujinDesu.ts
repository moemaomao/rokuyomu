import { BaseSource } from '../BaseSource';
import type { Chapter, Manga, MangaDetails } from '../types';

/**
 * doujin.desu.xxx adapter (JSON API + encrypted payload)
 *
 * List   : GET /api/manga?limit=24&offset=N&sort=latest_chapter
 * Search : GET /api/manga?search=QUERY&limit=24&offset=N
 * Detail : GET /api/manga/{slug}
 * Chapter: GET /api/chapters/{uuid}  → content_urls[]
 *
 * ID format:
 *   manga   : "/manga/{slug}"
 *   chapter : "/reader/{uuid}"
 */
export class DoujinDesuSource extends BaseSource {
    id = 'doujindesu';
    name = 'DoujinDesu';
    baseUrl = 'https://doujin.desu.xxx';
    badge = 'ID';

    private readonly PER_PAGE = 24;
    private readonly DEFAULT_LANG = 'id';
    private readonly APP_SECRET = 'dfdf72051dbfdc7d76889ebd31324e74';
    private readonly SALT = 'doujindesu-scrapers-cannot-read-this-super-secret-salt-2026-v2';
    private readonly WINDOW_MS = 3_600_000;

    // ── Crypto (port dari JS situs) ──────────────────────────────────────────

    private i32(v: number): number {
        return v | 0;
    }

    private makeKey(slot: number): string {
        const s = `${this.SALT}_${slot}`;
        let hash = 0;
        for (let i = 0; i < s.length; i++) {
            hash = this.i32((hash << 5) - hash + s.charCodeAt(i));
        }
        let out = '';
        let d = Math.abs(hash) || 123456789;
        for (let n = 0; n < 32; n++) {
            d = (d * 1664525 + 1013904223) % 4294967296;
            out += String.fromCharCode(33 + (d % 93));
        }
        return out;
    }

    private timeKeys(): string[] {
        const slot = Math.floor(Date.now() / this.WINDOW_MS);
        return [this.makeKey(slot), this.makeKey(slot - 1), this.makeKey(slot + 1)];
    }

    private xorDecode(hex: string, key: string): string {
        const bytes: number[] = [];
        for (let i = 0; i < hex.length; i += 2) {
            const pair = hex.slice(i, i + 2);
            if (!pair) break;
            bytes.push(parseInt(pair, 16));
        }
        const chars: string[] = [];
        let n = 42;
        const klen = key.length;
        for (let x = 0; x < bytes.length; x++) {
            const f = bytes[x];
            const p = key.charCodeAt(x % klen);
            const s = f ^ p ^ (x * 13) ^ n;
            chars.push(String.fromCharCode(s & 255));
            n = (n + f) % 256;
        }
        return chars.join('');
    }

    private decryptPayload(enc: string): unknown {
        for (const key of this.timeKeys()) {
            try {
                const raw = this.xorDecode(enc, key);
                const text = decodeURIComponent(raw);
                return JSON.parse(text);
            } catch {
            }
        }
        throw new Error('Failed to decrypt API payload');
    }

    // ── HTTP ─────────────────────────────────────────────────────────────────

    private async apiGet<T = unknown>(path: string): Promise<T> {
        const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
        const res = await fetch(url, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                Accept: 'application/json',
                Referer: this.baseUrl + '/',
                'X-App-Secret': this.APP_SECRET,
                'x-app-secret': this.APP_SECRET
            }
        });
        if (!res.ok) throw new Error(`API ${res.status} ${path}`);
        const json = (await res.json()) as { _enc_resp_?: string } & T;
        if (json && typeof json === 'object' && '_enc_resp_' in json && json._enc_resp_) {
            return this.decryptPayload(json._enc_resp_) as T;
        }
        return json as T;
    }

    private absUrl(url: string): string {
        if (!url) return '';
        if (url.startsWith('http')) return url;
        if (url.startsWith('//')) return `https:${url}`;
        return `${this.baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
    }

    private cleanId(link: string): string {
        let id = (link || '').trim();
        if (id.startsWith('http')) {
            try {
                id = new URL(id).pathname;
            } catch {
                /* ignore */
            }
        }
        if (!id.startsWith('/')) id = `/${id}`;
        return id.replace(/\/+$/, '') || '/';
    }

    private detectType(t?: string): 'manga' | 'manhwa' | 'manhua' {
        const s = (t || '').toLowerCase();
        if (s.includes('manhwa')) return 'manhwa';
        if (s.includes('manhua')) return 'manhua';
        if (s.includes('webtoon')) return 'manhwa';
        return 'manga';
    }

    private mapStatus(status?: string | null): string {
        const s = String(status || '').toUpperCase();
        if (s.includes('COMPLETE') || s.includes('FINISHED') || s.includes('END'))
            return 'Completed';
        if (s.includes('HIATUS')) return 'Hiatus';
        return 'Ongoing';
    }

    // ── Map API row → Manga ──────────────────────────────────────────────────

    private mapManga(row: any): Manga | null {
        const slug = row?.slug;
        if (!slug) return null;
        const title = String(row.title || '').trim();
        if (!title) return null;

        const chs = Array.isArray(row.chapters) ? row.chapters : [];
        const latestRaw = chs[0]?.chapter_number;
        const latestNum = parseFloat(String(latestRaw ?? ''));
        const latestChapter = Number.isFinite(latestNum)
            ? String(latestNum)
            : latestRaw != null
                ? String(latestRaw).replace(/\.00$/, '')
                : undefined;

        return {
            id: `/manga/${slug}`,
            sourceId: this.id,
            title,
            cover: this.absUrl(row.cover_url || ''),
            type: this.detectType(row.type),
            status: this.mapStatus(row.status),
            badge: this.badge,
            latestChapter,
            lang: this.DEFAULT_LANG
        } as Manga & { badge?: string; lang?: string };
    }

    // ── Public API ───────────────────────────────────────────────────────────

    async getLatestManga(
        page: number,
        _opts?: { lang?: string; type?: string }
    ): Promise<Manga[]> {
        try {
            const p = Math.max(1, Number(page) || 1);
            const offset = (p - 1) * this.PER_PAGE;
            const type = _opts?.type && _opts.type !== 'all' ? `&type=${encodeURIComponent(_opts.type)}` : '';
            const path = `/api/manga?limit=${this.PER_PAGE}&offset=${offset}&sort=latest_chapter${type}`;
            const rows = await this.apiGet<any[]>(path);
            const list = (Array.isArray(rows) ? rows : [])
                .map((r) => this.mapManga(r))
                .filter(Boolean) as Manga[];
            console.log(`[doujindesu] latest page=${p} → ${list.length}`);
            return list;
        } catch (e) {
            console.error('[doujindesu] getLatestManga', e);
            return [];
        }
    }

    async searchManga(
        query: string,
        opts?: { page?: number; lang?: string; type?: string }
    ): Promise<Manga[]> {
        const q = (query || '').trim();
        const page = Math.max(1, opts?.page || 1);
        if (!q) return this.getLatestManga(page, opts);

        try {
            const offset = (page - 1) * this.PER_PAGE;
            const path = `/api/manga?search=${encodeURIComponent(q)}&limit=${this.PER_PAGE}&offset=${offset}`;
            const rows = await this.apiGet<any[]>(path);
            const list = (Array.isArray(rows) ? rows : [])
                .map((r) => this.mapManga(r))
                .filter(Boolean) as Manga[];
            console.log(`[doujindesu] search "${q}" → ${list.length}`);
            return list;
        } catch (e) {
            console.error('[doujindesu] searchManga', e);
            return [];
        }
    }

    async getMangaDetails(
        mangaId: string,
        _opts?: { lang?: string }
    ): Promise<MangaDetails> {
        let path = this.cleanId(mangaId);

        if (/^\/reader\//i.test(path)) {
            const uuid = path.split('/').pop() || '';
            const ch = await this.apiGet<any>(`/api/chapters/${uuid}`);
            const slug = ch?.manga_slug;
            if (!slug) throw new Error(`Cannot resolve manga from chapter ${uuid}`);
            path = `/manga/${slug}`;
        }

        const slug = path.replace(/^\/manga\//, '').split('/')[0];
        if (!slug) throw new Error(`Invalid doujindesu id: ${mangaId}`);

        const data = await this.apiGet<any>(`/api/manga/${encodeURIComponent(slug)}`);

        const title = String(data.title || slug).trim();
        const cover = this.absUrl(data.cover_url || '');
        const status = this.mapStatus(data.status);
        const type = this.detectType(data.type);
        const alt = String(data.alt_titles || '')
            .split('|')
            .map((s: string) => s.trim())
            .filter(Boolean)
            .join(' · ');

        const authors: string[] = [];
        for (const field of [data.author, data.artist]) {
            if (!field) continue;
            String(field)
                .split(/,|\//)
                .map((s) => s.trim())
                .filter(Boolean)
                .forEach((n) => {
                    if (!authors.includes(n)) authors.push(n);
                });
        }

        // Genres
        const genres: string[] = [];
        const mg = Array.isArray(data.manga_genres) ? data.manga_genres : [];
        for (const g of mg) {
            const name = g?.genres?.name || g?.name;
            if (name && !genres.includes(name) && String(name).length < 40) genres.push(name);
        }
    
        if (!genres.length && data.term_list) {
            String(data.term_list)
                .split('|')
                .forEach((part) => {
                    const name = part.split(':')[0]?.trim();
                    if (name && !genres.includes(name) && name.length < 40) genres.push(name);
                });
        }

        const rating =
            data.rating != null && data.rating !== '' ? String(data.rating) : null;

        const chapters: Chapter[] = [];
        const seen = new Set<string>();
        const rows = Array.isArray(data.chapters) ? data.chapters : [];
        for (const row of rows) {
            const uuid = row?.id;
            if (!uuid || seen.has(uuid)) continue;
            seen.add(uuid);
            const number =
                typeof row.chapter_number === 'number'
                    ? row.chapter_number
                    : parseFloat(String(row.chapter_number || 0)) || 0;
            let date = '';
            if (row.created_at) {
                try {
                    date = new Date(row.created_at).toISOString().slice(0, 10);
                } catch {
                    date = String(row.created_at).slice(0, 10);
                }
            }
            chapters.push({
                id: `/reader/${uuid}`,
                title: row.title || `Chapter ${number}`,
                number,
                date
            });
        }
        chapters.sort((a, b) => (b.number || 0) - (a.number || 0));

        const latestChapter =
            chapters[0]?.number != null ? String(chapters[0].number) : undefined;
        const synopsis = String(data.description || '')
            .replace(/\s+/g, ' ')
            .trim();

        const metaLines = [
            alt && `Alternative: ${alt}`,
            rating && `Rating: ${rating}`,
            authors.length && `Author: ${authors.join(' · ')}`,
            `Language: Indonesian`,
            data.serialization && `Serialization: ${data.serialization}`,
            `Type: ${type}`
        ].filter(Boolean);

        const description = [...metaLines, synopsis].filter(Boolean).join('\n');

        console.log(
            `[doujindesu] details ${slug} → ch=${chapters.length}, genres=${genres.join(',')}`
        );

        return {
            id: `/manga/${slug}`,
            sourceId: this.id,
            title,
            cover,
            type,
            status,
            badge: this.badge,
            description,
            authors,
            genres,
            chapters,
            latestChapter
        } as MangaDetails & { badge?: string };
    }

    async getChapterPages(chapterId: string): Promise<string[]> {
        const path = this.cleanId(chapterId);
        const uuid =
            path.match(/\/reader\/([a-f0-9-]{36})/i)?.[1] ||
            path.match(/^\/?([a-f0-9-]{36})$/i)?.[1] ||
            '';
        if (!uuid) {
            console.error('[doujindesu] getChapterPages invalid id', chapterId);
            return [];
        }

        try {
            const data = await this.apiGet<any>(`/api/chapters/${uuid}`);
            const urls = Array.isArray(data?.content_urls) ? data.content_urls : [];
            const out = urls
                .map((u: string) => String(u || '').trim())
                .filter((u: string) => /^https?:\/\//i.test(u));
            console.log(`[doujindesu] ${out.length} pages → ${uuid}`);
            return out;
        } catch (e) {
            console.error('[doujindesu] getChapterPages failed', uuid, e);
            return [];
        }
    }
}