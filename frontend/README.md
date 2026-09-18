# Mikoroku v2 (Rokuyomu)

Multi-source manga & comics reader built with **SvelteKit**, deployed on **Cloudflare Workers**.

Aggregates latest updates and search results from many sources (manga, manhwa, manhua, doujin, hentai, etc.) in one place.

## Features

- Multi-source browsing & search
- Manga detail page (cover, description, genres, chapter list)
- Chapter reader
- Bookmark & reading history
- Language / type filters
- Cloudflare Workers KV caching (reduce rate limits & speed up responses)
- Dark / light theme
- Report broken source / chapter
- Deployed as Cloudflare Worker (`rokuyomu`)

## Tech Stack

- **SvelteKit** + Svelte 5
- **TypeScript**
- **Tailwind CSS** v4
- **Cloudflare Workers** + **Workers KV** (`MIKOROKU_CACHE`)
- **Cheerio** (scraping / parsing)
- **Firebase** (auth / data if used)
- **pnpm** as package manager


### Prerequisites

- Node.js 20+
- pnpm 9+
- Cloudflare account (for deploy & KV)
- pnpm dev
- pnpm build
- pnpm preview
- pnpm check
- pnpm lint
- pnpm format
- pnpm deploy

### Project Structure
```
mikoroku-v2/
├── src/
│   ├── lib/
│   │   ├── components/          # Komponen UI
│   │   ├── server/
│   │   │   ├── sources/
│   │   │   │   ├── BaseSource.ts
│   │   │   │   ├── index.ts     # Registry semua source
│   │   │   │   ├── types.ts
│   │   │   │   └── impl/        # Adapter per source
│   │   │   ├── cache.ts         # Helper KV cache
│   │   │   └── ...
│   │   ├── stores/
│   │   ├── utils/
│   │   ├── firebase.ts
│   │   └── admin.ts
│   ├── routes/
│   │   ├── +page.*              # Homepage
│   │   ├── manga/[source]/[...id]/
│   │   ├── reader/[source]/[...id]/
│   │   ├── bookmark/
│   │   ├── history/
│   │   ├── settings/
│   │   ├── report/
│   │   ├── about/
│   │   ├── privacy/
│   │   └── api/
│   └── app.html / app.d.ts
├── static/
├── wrangler.jsonc
├── package.json
├── svelte.config.js
├── vite.config.ts
└── tsconfig.json
```