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

const auth = createAuth(db, {
  secret: process.env.BETTER_AUTH_SECRET ?? 'dev-secret-change-me',
  baseURL: process.env.BETTER_AUTH_URL ?? `http://localhost:${port}`,
  trustedOrigins: [process.env.APP_URL, process.env.SITE_URL, `http://localhost:${port}`].filter(
    Boolean,
  ) as string[],
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
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
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
});
