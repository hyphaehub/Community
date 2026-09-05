<div align="center">

# 🍄 HyphaeHub

**Track every thread of your grow.**

Mushroom cultivation lifecycle & cost tracking — from a single source, to grain jars,
to fruiting tubs, to harvest, dry, and store. Community (self-hosted), Cloud (SaaS), and Mobile.

</div>

---

## What it does

HyphaeHub models the way cultivators actually work:

```
 source ──► grain jars ──► combine into tubs ──► fruit ──► harvest ──► dry ──► store
   (1)         (many)          (1–2 jars each)   (flushes)  (wet g)  (dry g)
```

Every physical unit is a node in a **lineage graph**, so "make 6 jars from one liquid culture"
and "combine 2 jars into a monotub" are first-class. Every batch rolls up **cost, yield, dry
ratio, biological efficiency, and cost-per-gram**.

## Editions

| Edition | Where it runs | Auth | Storage |
|---|---|---|---|
| **Community** (free) | Your Docker host | built-in (better-auth) | libSQL + local volume |
| **Cloud** (Free/Pro/Farm) | Cloudflare Workers | built-in (better-auth) | D1 + R2 + KV |
| **Mobile** | iOS/Android (Expo) | built-in | talks to either API |

## Monorepo layout

```
apps/
  api/     Hono API — Cloudflare Workers (D1/R2/KV) + Node build for self-host
  web/     React + Vite dashboard SPA  → Cloudflare Workers static assets
  site/    Astro marketing website     → Cloudflare Workers/Pages
  mobile/  Expo React Native app
packages/
  core/    Domain types, Zod schemas, cost/yield engine, tier limits, unit conversions
  db/      Drizzle schema + migrations + seed + db factory (D1 | libSQL)
infra/     Dockerfile + docker-compose for the self-hosted Community Edition
```

## Quickstart (local dev)

Requires Node ≥ 20 and pnpm ≥ 9.

```bash
pnpm install

# 1. Create + seed the local database (SQLite via wrangler D1)
pnpm --filter @hyphaehub/api migrate:local
pnpm --filter @hyphaehub/api seed:local

# 2. Run the API (Cloudflare Worker, http://localhost:8787)
pnpm --filter @hyphaehub/api dev

# 3. In separate terminals: the web dashboard and the marketing site
pnpm --filter @hyphaehub/web dev     # http://localhost:5173
pnpm --filter @hyphaehub/site dev    # http://localhost:4321

# Tests (cost/yield engine)
pnpm test
```

## Deploy to Cloudflare

See [`apps/api/README.md`](apps/api/README.md). In short:

```bash
wrangler d1 create hyphaehub
wrangler r2 bucket create hyphaehub-photos
wrangler kv namespace create SESSIONS
# paste the IDs into apps/api/wrangler.jsonc, then:
pnpm --filter @hyphaehub/api deploy
pnpm --filter @hyphaehub/web deploy
pnpm --filter @hyphaehub/site deploy
```

## Self-host the Community Edition

```bash
cd infra && docker compose up -d
# HyphaeHub is now at http://localhost:8080
```

See [`infra/README.md`](infra/README.md).

## Roadmap

See [`ROADMAP.md`](ROADMAP.md).

## License

MIT — see [`LICENSE`](LICENSE). HyphaeHub is species-agnostic; you are responsible for
complying with the laws that apply to what you cultivate in your jurisdiction.
