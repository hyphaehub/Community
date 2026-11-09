import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createLibsqlDb } from '@hyphaehub/db/node';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { buildApp } from './app';
import { createAuth } from './auth';
import { resolveAuthConfig } from './lib/auth-config';
import { connectOrigins } from './lib/origins';
import { resolveSelfHostSecret } from './lib/self-host-secret';
import {
  DEFAULT_TELEMETRY_URL,
  resolveInstallId,
  startTelemetry,
  telemetryEnabled,
} from './lib/telemetry';
import { FsStorage } from './storage-fs';
import type { AppEnv } from './types';

/**
 * Self-hosted Node entry point (Community Edition). Uses libSQL/SQLite for the
 * database and the local filesystem for photos. Runs migrations on boot and,
 * when WEB_DIR is set, serves the built web SPA from the same origin.
 */
const dbUrl = process.env.DATABASE_URL ?? 'file:./data/hyphaehub.db';
const port = Number(process.env.PORT ?? 8080);
const webDir = process.env.WEB_DIR; // relative to cwd, e.g. "apps/web/dist"
const migrationsFolder =
  process.env.MIGRATIONS_DIR ??
  fileURLToPath(new URL('../../../packages/db/drizzle', import.meta.url));

const db = createLibsqlDb({ url: dbUrl });
await migrate(db, { migrationsFolder });

const authCfg = resolveAuthConfig(process.env);

// Zero-config but secure: use an explicit BETTER_AUTH_SECRET when provided,
// otherwise generate a strong one and persist it in the data volume so sessions
// survive restarts. (The secret only signs sessions; rotating it just logs
// everyone out.)
const { secret: authSecret, source: secretSource } = resolveSelfHostSecret(process.env, dbUrl);

const auth = createAuth(db, {
  secret: authSecret,
  // Prefer an explicit public URL, fall back to APP_URL, then localhost. `||`
  // (not `??`) so an empty-string env var from compose falls through too.
  baseURL: process.env.BETTER_AUTH_URL || process.env.APP_URL || `http://localhost:${port}`,
  trustedOrigins: [
    process.env.APP_URL,
    process.env.SITE_URL,
    // Official cloud clients (Cloud Connect) so a self-host trusts them.
    ...connectOrigins(process.env),
    `http://localhost:${port}`,
    // Native app deep-link scheme — lets the mobile Auth0 flow redirect back.
    'hyphaehub://',
  ].filter(Boolean) as string[],
  cookieDomain: process.env.COOKIE_DOMAIN,
  auth0: authCfg.auth0,
  emailPassword: authCfg.emailPasswordEnabled,
});

const storage = new FsStorage(process.env.PHOTO_DIR ?? './data/photos');

const platform = createMiddleware<AppEnv>(async (c, next) => {
  c.set('db', db);
  c.set('auth', auth);
  c.set('storage', storage);
  await next();
});

const apiApp = buildApp(platform);

// Values for `c.env` (the shared route code reads env from here on Node).
const nodeEnv = {
  APP_URL: process.env.APP_URL ?? `http://localhost:${port}`,
  SITE_URL: process.env.SITE_URL,
  BETTER_AUTH_SECRET: authSecret,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  COOKIE_DOMAIN: process.env.COOKIE_DOMAIN,
  HYPHAE_STRIPE_SECRET_KEY: process.env.HYPHAE_STRIPE_SECRET_KEY,
  HYPHAE_STRIPE_WEBHOOK_SECRET: process.env.HYPHAE_STRIPE_WEBHOOK_SECRET,
  HYPHAE_STRIPE_PRICE_PRO: process.env.HYPHAE_STRIPE_PRICE_PRO,
  HYPHAE_STRIPE_PRICE_FARM: process.env.HYPHAE_STRIPE_PRICE_FARM,
  HYPHAE_AUTH0_DOMAIN: process.env.HYPHAE_AUTH0_DOMAIN,
  HYPHAE_AUTH0_CLIENT_ID: process.env.HYPHAE_AUTH0_CLIENT_ID,
  HYPHAE_AUTH0_CLIENT_SECRET: process.env.HYPHAE_AUTH0_CLIENT_SECRET,
  EMAIL_PASSWORD_AUTH: process.env.EMAIL_PASSWORD_AUTH,
  SUPER_ADMIN_EMAIL: process.env.SUPER_ADMIN_EMAIL,
  CONNECT_ORIGINS: process.env.CONNECT_ORIGINS,
  // This is the self-hosted (Community) edition; surfaces the "Connect to Cloud"
  // flow in the web app. Operators can point at a different cloud via env.
  EDITION: 'community' as const,
  CLOUD_URL: process.env.HYPHAEHUB_CLOUD_URL ?? 'https://app.hyphaehub.io',
};

let fetchHandler: (req: Request) => Response | Promise<Response>;

if (webDir) {
  // Single-container self-host: API under /api + /health, web SPA everywhere else.
  const root = new Hono();
  root.all('/api/*', (c) => apiApp.fetch(c.req.raw, nodeEnv as never));
  root.get('/health', (c) => apiApp.fetch(c.req.raw, nodeEnv as never));
  root.use('/assets/*', serveStatic({ root: webDir }));
  root.get('/favicon.svg', serveStatic({ path: `${webDir}/favicon.svg` }));
  root.get('*', serveStatic({ path: `${webDir}/index.html` }));
  fetchHandler = (req) => root.fetch(req);
} else {
  // API-only (e.g. `pnpm dev:node`).
  fetchHandler = (req) => apiApp.fetch(req, nodeEnv as never);
}

serve({ fetch: fetchHandler, port }, (info) => {
  console.log(`🍄 HyphaeHub (self-host) listening on http://localhost:${info.port}`);
  if (webDir) console.log(`   Serving web app from ${webDir}`);
  if (secretSource === 'generated') {
    console.log(
      '   Auth secret: generated and saved to the data volume (set BETTER_AUTH_SECRET to override).',
    );
  } else if (secretSource === 'persisted') {
    console.log(
      '   Auth secret: loaded from the data volume (set BETTER_AUTH_SECRET to override).',
    );
  } else if (secretSource === 'ephemeral') {
    console.warn(
      '   Auth secret: generated but NOT persisted (data volume not writable) — sessions reset on restart.',
    );
  }

  if (telemetryEnabled(process.env)) {
    let version = '0.0.0';
    try {
      version = JSON.parse(
        readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
      ).version;
    } catch {
      // keep the fallback version
    }
    startTelemetry({
      installId: resolveInstallId(dbUrl),
      version,
      url: process.env.HYPHAEHUB_TELEMETRY_URL || DEFAULT_TELEMETRY_URL,
    });
    console.log(
      '   Telemetry: anonymous install ping on (random id + version; set HYPHAEHUB_TELEMETRY=off to disable).',
    );
  } else {
    console.log('   Telemetry: off.');
  }
});
