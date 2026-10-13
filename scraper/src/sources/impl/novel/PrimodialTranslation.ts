/**
 * Primodial Translation adapter
 * → extends ThemesiaSource (novel / lightnovel theme)
 *
 * Domain  : https://primodialtranslation.com
 * Latest  : /series/?order=update&page=N
 * Search  : /?s={q}
 * Detail  : /series/{slug}/
 * Chapter : /{slug}-chapter-{n}/  (root path)
 * Content : .epcontent / .entry-content (TEXT)
 *
 * Bahasa default: en
 *
 * Reader next/prev: getChapterContent WAJIB return prevChapterId / nextChapterId
 */

import * as cheerio from 'cheerio';
import { ThemesiaSource } from '../../family/ThemesiaSource';
import type { Manga } from '../../types-manga';

export class PrimodialTranslationSource extends ThemesiaSource {
	id = 'primodialtranslation';
	name = 'Primodial Translation';
	baseUrl = 'https://primodialtranslation.com';

	protected seriesPath = '/series';
	protected defaultLang = 'en';
	protected perPage = 24;

	protected listPath(page: number): string {
		const p = Math.max(1, page || 1);
		if (p <= 1) return `${this.seriesPath}/?order=update`;
		return `${this.seriesPath}/?order=update&page=${p}`;
	}

	protected searchPath(query: string, page: number): string {
		const q = encodeURIComponent(query);
		return page <= 1 ? `/?s=${q}` : `/page/${page}/?s=${q}`;
	}

	protected normalizeTitle(raw: string): string {
		return super
			.normalizeTitle(raw, this.name)
			.replace(
				new RegExp(
					`\\s*[-|]\\s*${this.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*$`,
					'i'
				),
				''
			)
			.trim();
	}

	async getLatestManga(page: number): Promise<Manga[]> {
		try {
			const p = Math.max(1, Number(page) || 1);
			let list = this.parseCards(
				cheerio.load(await this.fetchHtml(this.listPath(p)))
			);

			if (list.length < 8 && p === 1) {
				try {
					const home = this.parseCards(cheerio.load(await this.fetchHtml('/')));
					const seen = new Set(list.map((m) => m.id));
					for (const m of home) {
						if (seen.has(m.id)) continue;
						seen.add(m.id);
						list.push(m);
						if (list.length >= this.perPage) break;
					}
				} catch {
					/* ignore */
				}
			}

			console.log(`[${this.id}] latest page=${p} → ${list.length}`);
			return list.slice(0, this.perPage);
		} catch (e) {
			console.error(`[${this.id}] getLatestManga`, e);
			return [];
		}
	}

	async getChapterPages(_chapterId: string): Promise<string[]> {
		return [];
	}

	async getChapterContent(chapterId: string): Promise<{
		title: string;
		content: string;
		prevChapterId?: string | null;
		nextChapterId?: string | null;
	}> {
		const base = await super.getChapterContent(chapterId);
		const path = this.cleanId(chapterId);

		let prevChapterId = base.prevChapterId ?? null;
		let nextChapterId = base.nextChapterId ?? null;

		const p = path.replace(/\/$/, '');
		const m = p.match(/^(.*-chapter-)(\d+(?:\.\d+)?)(?:-.*)?$/i);
		if (m) {
			const n = parseFloat(m[2]);
			if (Number.isFinite(n) && n > 0) {
				if (!prevChapterId && n > 1) {
					const prevN = Number.isInteger(n) ? n - 1 : Math.floor(n);
					if (prevN > 0) prevChapterId = `${m[1]}${prevN}`;
				}
				if (!nextChapterId) {
					const nextN = Number.isInteger(n) ? n + 1 : Math.ceil(n);
					nextChapterId = `${m[1]}${nextN}`;
				}
			}
		}

		let content = base.content || '';
		let title = base.title || 'Chapter';

		if (!content || content.length < 40 || /Empty content/i.test(content)) {
			const html = await this.fetchHtml(path.endsWith('/') ? path : `${path}/`);
			const $ = cheerio.load(html);

			title = this.normalizeTitle(
				$('h1.entry-title, h1').first().text() ||
					$('meta[property="og:title"]').attr('content') ||
					title
			);

			const root = $(
				[
					'.epcontent.entry-content',
					'.entry-content .epcontent',
					'.epcontent',
					'#readerarea',
					'.reading-content',
					'.text-left',
					'.entry-content',
					'.chapter-content',
					'.content-area'
				].join(', ')
			).first();

			root
				.find(
					'script, style, .ads, .code-block, .sharedaddy, .chapter-nav, .chnav, .navi, nav'
				)
				.remove();

			content = (root.html() || '').trim();
			if (!content) {
				content = root.text().replace(/\s+/g, ' ').trim();
			}

			if (!prevChapterId || !nextChapterId) {
				$('a[rel="prev"], .chnav a.prev, .navi a.prev').each((_, a) => {
					const href = $(a).attr('href') || '';
					if (href && href !== '#') prevChapterId = this.cleanId(href);
				});
				$('a[rel="next"], .chnav a.next, .navi a.next').each((_, a) => {
					const href = $(a).attr('href') || '';
					if (href && href !== '#') nextChapterId = this.cleanId(href);
				});
			}
		}

		console.log(
			`[${this.id}] chapter ${path} → ${content.length}c prev=${prevChapterId} next=${nextChapterId}`
		);

		return { title, content, prevChapterId, nextChapterId };
	}
}

export default PrimodialTranslationSource;
