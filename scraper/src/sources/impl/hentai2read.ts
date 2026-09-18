import { BaseSource } from '../BaseSource';
import type { Manga, MangaDetails } from '../types';

export class Hentai2readSource extends BaseSource {
    id = 'hentai2read';
    name = 'Hentai2Read';
    baseUrl = 'https://hentai2read.com';

    private readonly cdn = 'https://hentaicdn.com/hentai';

    private h(extra?: Record<string, string>): Record<string, string> {
        return {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            Referer: 'https://hentai2read.com/',
            Origin: 'https://hentai2read.com',
            ...extra
        };
    }

    private async getHtml(url: string): Promise<string> {
        const res = await fetch(url, { headers: this.h() });
        if (!res.ok) throw new Error(`HTTP ${res.status} → ${url}`);
        return res.text();
    }

    private async postHtml(url: string, body: string): Promise<string> {
        const res = await fetch(url, {
            method: 'POST',
            headers: this.h({
                'Content-Type': 'application/x-www-form-urlencoded'
            }),
            body
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} → ${url}`);
        return res.text();
    }

    private decodeHtml(s: string): string {
        return s
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .replace(/&#x27;/g, "'")
            .replace(/&nbsp;/g, ' ')
            .trim();
    }

    private toMangaId(slug: string): string {
        return `/${String(slug).replace(/^\/+|\/+$/g, '')}`;
    }

    private extractSlug(mangaId: string): string {
        const parts = String(mangaId)
            .replace(/^\/+|\/+$/g, '')
            .split('/')
            .filter(Boolean);
        return parts[0] || '';
    }

    private extractChapterNum(chapterId: string): number {
        const parts = String(chapterId)
            .replace(/^\/+|\/+$/g, '')
            .split('/')
            .filter(Boolean);
        if (parts.length >= 2) {
            const n = parseInt(parts[1], 10);
            return Number.isFinite(n) && n > 0 ? n : 1;
        }
        return 1;
    }

    private parseList(html: string): Manga[] {
        const out: Manga[] = [];
        const seen = new Set<string>();

        const re =
            /href="https?:\/\/hentai2read\.com\/([a-z0-9_]+)\/"[^>]*class="[^"]*mangaPopover[^"]*"[\s\S]{0,1500}?data-mid="(\d+)"\s*data-title="([^"]+)"/gi;

        let m: RegExpExecArray | null;
        while ((m = re.exec(html)) !== null) {
            const slug = m[1];
            if (
                !slug ||
                seen.has(slug) ||
                slug === 'latest' ||
                slug === 'hentai-list' ||
                slug === 'download'
            ) {
                continue;
            }
            seen.add(slug);

            const mid = m[2];
            const title = this.decodeHtml(m[3] || slug).replace(/\s*\[\]\s*$/, '');

            const cover =
                html.match(
                    new RegExp(
                        `https://img\\d+\\.hentaicdn\\.com/hentai/cover/\\d+/_S${mid}\\.jpg`
                    )
                )?.[0] ||
                `https://img2.hentaicdn.com/hentai/cover/42/_S${mid}.jpg`;

            out.push({
                id: this.toMangaId(slug),
                sourceId: this.id,
                title,
                cover,
                type: 'hentai',
                status: 'Completed'
            });
        }

        return out;
    }

    private pickTagButtons(html: string, label: string): string[] {
        const re = new RegExp(
            `<b>${label}</b>[\\s\\S]{0,800}?</li>`,
            'i'
        );
        const section = html.match(re)?.[0] || '';
        const names: string[] = [];
        const tagRe = /class="tagButton"[^>]*>([^<]+)</gi;
        let tm: RegExpExecArray | null;
        while ((tm = tagRe.exec(section)) !== null) {
            const n = this.decodeHtml(tm[1]);
            if (n) names.push(n);
        }
        return names;
    }

    async getLatestManga(
        page: number,
        _opts?: { lang?: string; type?: string }
    ): Promise<Manga[]> {
        try {
            const p = Math.max(1, Number(page) || 1);
            const url = `${this.baseUrl}/latest/${p}/`;
            const html = await this.getHtml(url);
            let list = this.parseList(html);

            if (list.length < 24 && list.length > 0) {
                try {
                    const nextUrl = `${this.baseUrl}/latest/${p + 1}/`;
                    const nextHtml = await this.getHtml(nextUrl);
                    const nextList = this.parseList(nextHtml);
                    list = [...list, ...nextList];
                } catch (e) {
                    console.error('[hentai2read] failed to fetch extra pagination', e);
                }
            }

            return list.slice(0, 24);
        } catch (e) {
            console.error('[hentai2read] getLatestManga', e);
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
            const body = new URLSearchParams({
                txt_wpm_wgt_mng_sch_nme: q,
                cmd_wpm_wgt_mng_sch_sbm: 'Search'
            }).toString();

            const html = await this.postHtml(
                `${this.baseUrl}/hentai-list/search/`,
                body
            );

            let list = this.parseList(html);

            const qLower = q.toLowerCase();
            const filtered = list.filter((m) =>
                m.title.toLowerCase().includes(qLower)
            );
            if (filtered.length) list = filtered;

            if (page > 1 && list.length) {
                const start = (page - 1) * 24;
                list = list.slice(start, start + 24);
            }

            return list.slice(0, 24);
        } catch (e) {
            console.error('[hentai2read] searchManga', e);
            return [];
        }
    }

    async getMangaDetails(mangaId: string): Promise<MangaDetails> {
        const slug = this.extractSlug(mangaId);
        if (!slug) throw new Error(`Invalid hentai2read id: ${mangaId}`);

        const html = await this.getHtml(`${this.baseUrl}/${slug}/`);

        const titleM = 
            html.match(/<h1[^>]*>([^<]+)<\/h1>/i) ||
            html.match(/class="[^"]*manga-title[^"]*"[^>]*>([^<]+)</i) ||
            html.match(/<title>([^|<–-]+)/i);
            
        let title = titleM ? this.decodeHtml(titleM[1]) : slug;
        title = title.replace(/\s*[-–|].*$/, '').replace(/\s*Hentai by.*$/i, '').trim();
        if (title.toLowerCase() === 'home' || !title) {
            title = slug.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        }

        const midM = html.match(/data-mid="(\d+)"/i) || html.match(/manga_id\s*[:=]\s*['"]?(\d+)/i);
        const mid = midM?.[1] || '';
        
        let cover = '';
        const imgCoverMatch = html.match(/src="(https:\/\/img\d+\.hentaicdn\.com\/hentai\/cover\/[^"]+)"/i) ||
                              html.match(/data-src="(https:\/\/img\d+\.hentaicdn\.com\/hentai\/cover\/[^"]+)"/i);
        
        if (imgCoverMatch) {
            cover = imgCoverMatch[1];
        } else if (mid) {
            cover = `https://img2.hentaicdn.com/hentai/cover/42/_S${mid}.jpg`;
        }

        const authors = this.pickTagButtons(html, 'Author');
        const artists = this.pickTagButtons(html, 'Artist');
        const categories = this.pickTagButtons(html, 'Category');
        const tags = this.pickTagButtons(html, 'Tag');
        const parodies = this.pickTagButtons(html, 'Parody');
        const characters = this.pickTagButtons(html, 'Character');

        const genres = [
            ...categories,
            ...tags,
            ...parodies.map((p) => `parody:${p}`),
            ...characters.map((c) => `character:${c}`)
        ];

        const chaptersMap = new Map<number, { id: string; title: string; number: number; date: string }>();
        const simpleChRe = new RegExp(`href="https?://hentai2read\\.com/${slug}/(\\d+)/"`, 'gi');

        let cm: RegExpExecArray | null;
        while ((cm = simpleChRe.exec(html)) !== null) {
            const num = parseInt(cm[1], 10);
            if (num > 0 && !chaptersMap.has(num)) {
                chaptersMap.set(num, {
                    id: `/${slug}/${num}`,
                    title: `Chapter ${num}`,
                    number: num,
                    date: ''
                });
            }
        }

        let chapterNums = [...chaptersMap.keys()].sort((a, b) => a - b);
        if (!chapterNums.length) {
            chapterNums.push(1);
            chaptersMap.set(1, {
                id: `/${slug}/1`,
                title: 'Read',
                number: 1,
                date: ''
            });
        }

        const chapters = chapterNums.map((num) => chaptersMap.get(num)!);

        const type =
            categories.find((c) => /doujinshi|manga|original/i.test(c)) ||
            'hentai';

        return {
            id: this.toMangaId(slug),
            sourceId: this.id,
            title,
            cover,
            type,
            status: 'Completed',
            description: [
                authors.length && `Author: ${authors.join(', ')}`,
                artists.length && `Artist: ${artists.join(', ')}`,
                categories.length && `Category: ${categories.join(', ')}`,
                `${chapters.length} chapter(s)`
            ]
                .filter(Boolean)
                .join('\n'),
            authors: authors.length ? authors : artists,
            genres,
            chapters
        };
    }

    async getChapterPages(chapterId: string): Promise<string[]> {
        const slug = this.extractSlug(chapterId);
        const num = this.extractChapterNum(chapterId);

        if (!slug) {
            console.error('[hentai2read] getChapterPages → empty slug from:', chapterId);
            return [];
        }

        try {
            const html = await this.getHtml(`${this.baseUrl}/${slug}/${num}/`);

            const m = html.match(/'images'\s*:\s*(\[[\s\S]*?\])\s*,/);
            if (!m) {
                console.error('[hentai2read] no images array for', slug, num);
                return [];
            }

            let paths: string[] = [];
            try {
                const raw = m[1].replace(/'/g, '"');
                paths = JSON.parse(raw);
            } catch (e) {
                console.error('[hentai2read] JSON parse images failed', e);
                return [];
            }

            const urls = paths
                .map((p) => {
                    if (!p) return '';
                    if (p.startsWith('http')) return p;
                    return `${this.cdn}${p.startsWith('/') ? p : `/${p}`}`;
                })
                .filter(Boolean);

            return urls;
        } catch (e) {
            console.error('[hentai2read] getChapterPages failed', chapterId, e);
            return [];
        }
    }
}