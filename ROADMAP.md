# HyphaeHub Roadmap

Status legend: ✅ done · 🟡 scaffolded (finish next) · ⬜ planned

## Phase 1 — Core (this build)

- ✅ Monorepo (pnpm + Turborepo), Biome, shared TS config
- ✅ `packages/core` — lifecycle enums, Zod DTOs, cost/yield engine, tier limits, unit conversions
- ✅ `packages/db` — Drizzle schema (lineage graph), migrations, strain seed, D1/libSQL factory
- ✅ `apps/api` — Hono on Workers, better-auth, full lifecycle CRUD, split/combine, batch summary
- ✅ `apps/web` — dashboard, batch + lineage view, guided grow flow, harvests, costs
- ✅ `apps/site` — marketing site, pricing, self-host, brand
- ✅ `apps/mobile` — Expo app: tabs (Home/Batches/Strains/Settings) + full batch lifecycle
  actions; typechecks and bundles with Metro (`expo export`), linked to EAS project
  `@bikeidaho/hyphaehub`
- ⛔ **Android native build blocked** — see [`apps/mobile/README.md`](apps/mobile/README.md).
  The JS bundles cleanly, but packaging an APK in this pnpm monorepo hits an Expo-SDK52 +
  pnpm + Windows tooling conflict (JS entry `root` fix vs native-module Gradle variant
  resolution are mutually exclusive). EAS free build credits are also exhausted this period.
  Cleanest fix: build `apps/mobile` as a standalone (non-workspace) Expo app, or add a config
  plugin to patch `build.gradle` for the monorepo.
- 🟡 `infra` — Docker Compose self-host (Node parity hardening ongoing)
- ✅ **Deployed to Cloudflare** — api / web (service-binding proxy) / site live on `workers.dev`
  (R2 photos pending an R2-enabled token; custom domains pending)

## Phase 2 — Monetization & accounts

- 🟡 Stripe Checkout + Billing Portal + webhooks (wired but keys/prices pending)
- ⬜ Plan enforcement UI (usage meters, upgrade prompts)
- ⬜ Team/Farm tier: multi-user workspaces, roles, invitations
- ⬜ Email (magic link + notifications) via Cloudflare Email

## Phase 3 — Cloud access to self-hosted

- ⬜ Self-hosted instance registration + secure relay/tunnel to cloud
- ⬜ Read-only cloud dashboard over a self-hosted DB
- ⬜ Optional one-way sync (self-host → cloud backup)

## Phase 4 — Mobile & field workflow

- ⬜ Full Expo app: offline queue, camera capture → R2, push reminders
- ⬜ Barcode/QR labels for jars & tubs, scan-to-log
- ⬜ Environment logging (temp/humidity), optional sensor integrations

## Phase 5 — Analytics & community

- ⬜ Yield analytics, contamination rate trends, cost-per-gram over time
- ⬜ CSV/PDF batch reports
- ⬜ Optional anonymized strain performance benchmarks
