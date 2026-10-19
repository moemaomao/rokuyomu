import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
  getSeriesMetadata,
  remoteMangaDetails,
} from "$lib/server/scraperClient";
import { getCached } from "$lib/server/cache";
import type { Chapter, MangaDetails } from "$lib/server/sources/types";

const DETAIL_CACHE_TTL = 600;
const MAX_LIMIT = 50;

function sortChapters(list: Chapter[], newestFirst: boolean): Chapter[] {
  return [...list].sort((a, b) =>
    newestFirst ? b.number - a.number : a.number - b.number,
  );
}

export const GET: RequestHandler = async ({ url, locals }) => {
  const source = url.searchParams.get("source")?.trim();
  const rawId = url.searchParams.get("id")?.trim();
  const lang = (url.searchParams.get("lang") || "all").toLowerCase();
  const chapterLang = (url.searchParams.get("chapterLang") || "all")
    .trim()
    .toLowerCase();
  const sort = (url.searchParams.get("sort") || "newest").toLowerCase();
  const refresh = url.searchParams.get("refresh") === "1";
  const offset = Math.max(
    0,
    parseInt(url.searchParams.get("offset") || "0", 10) || 0,
  );
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(url.searchParams.get("limit") || "30", 10) || 30),
  );

  if (!source || !rawId) {
    throw error(400, "source and id are required");
  }

  const mangaId = rawId.startsWith("/")
    ? rawId
    : `/${rawId.replace(/^\/+/, "")}`;
  const cacheKey = `manga:${source}:${mangaId}:lang=${lang}`;
  const newestFirst = sort !== "oldest";

  try {
    const full = refresh
      ? await remoteMangaDetails(source, mangaId, lang)
      : await getCached<MangaDetails>(
          cacheKey,
          () => remoteMangaDetails(source, mangaId, lang),
          DETAIL_CACHE_TTL,
          locals.kv,
        );

    const all = Array.isArray(full?.chapters) ? full.chapters : [];
    const chapterLanguages = [
      ...new Set(
        all
          .map((chapter) =>
            String(chapter.lang || "")
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean),
      ),
    ].sort();
    const filtered =
      chapterLang === "all"
        ? all
        : all.filter(
            (chapter) =>
              String(chapter.lang || "")
                .trim()
                .toLowerCase() === chapterLang,
          );
    const sorted = sortChapters(filtered, newestFirst);
    const slice = sorted.slice(offset, offset + limit);
    const total = sorted.length;
    const seriesMeta = refresh
      ? getSeriesMetadata(full.description, full.authors, full.type)
      : null;

    return json({
      chapters: slice,
      chapterLanguages,
      total,
      offset,
      limit,
      hasMore: offset + slice.length < total,
      sort: newestFirst ? "newest" : "oldest",
      series: refresh
        ? {
            id: full.id,
            title: full.title,
            cover: full.cover,
            description: full.description,
            authors: full.authors,
            type: full.type,
            author: seriesMeta?.author,
            artist: seriesMeta?.artist,
            genres: full.genres,
          }
        : undefined,
    });
  } catch (e: any) {
    console.error("[api/chapters]", source, mangaId, e);
    throw error(500, e?.message || "Failed to load chapters");
  }
};
