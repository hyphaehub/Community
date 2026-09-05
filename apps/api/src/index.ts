import { createD1Db } from '@hyphaehub/db';
import { createMiddleware } from 'hono/factory';
import { buildApp } from './app';
import { createAuth } from './auth';
import { resolveAuthConfig } from './lib/auth-config';
import { NullStorage, R2Storage } from './storage';
import type { AppEnv } from './types';

/** Cloudflare Worker platform: D1 database, R2 photo storage, per-request auth. */
const platform = createMiddleware<AppEnv>(async (c, next) => {
  const env = c.env;
  const db = createD1Db(env.DB);
  c.set('db', db);
  const authCfg = resolveAuthConfig(env);
  c.set(
    'auth',
    createAuth(db, {
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.BETTER_AUTH_URL,
      trustedOrigins: [
        env.APP_URL,
        env.SITE_URL,
        'http://localhost:5173',
        'http://localhost:4321',
      ].filter(Boolean) as string[],
      cookieDomain: env.COOKIE_DOMAIN,
      auth0: authCfg.auth0,
      emailPassword: authCfg.emailPasswordEnabled,
    }),
  );
  c.set('storage', env.PHOTOS ? new R2Storage(env.PHOTOS) : new NullStorage());
  await next();
});

const app = buildApp(platform);

export default app;
