import { Hono, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import { auditMiddleware } from './lib/audit';
import { resolveAuthConfig } from './lib/auth-config';
import { isSuperAdminEmail } from './middleware/auth';
import admin from './routes/admin';
import audit from './routes/audit';
import batches from './routes/batches';
import billing from './routes/billing';
import costs from './routes/costs';
import cultures from './routes/cultures';
import events from './routes/events';
import forecast from './routes/forecast';
import harvests from './routes/harvests';
import inventory from './routes/inventory';
import jars from './routes/jars';
import orgs from './routes/orgs';
import photos from './routes/photos';
import strains from './routes/strains';
import workspace from './routes/workspace';
import type { AppEnv } from './types';

/**
 * Build the HyphaeHub API. `platform` is a middleware that populates the
 * request context with `db`, `auth`, and `storage` — it differs between the
 * Cloudflare Worker (D1/R2) and the self-hosted Node server (libSQL/FS).
 */
export function buildApp(platform: MiddlewareHandler<AppEnv>) {
  const app = new Hono<AppEnv>();

  app.use('*', logger());
  app.use('*', cors({
    origin: (origin, c) => {
      const allow = [
        c.env.APP_URL,
        c.env.SITE_URL,
        'http://localhost:5173',
        'http://localhost:4321',
        'http://localhost:8081',
      ].filter(Boolean) as string[];
      return allow.includes(origin) ? origin : (allow[0] ?? '*');
    },
    credentials: true,
    allowHeaders: ['content-type', 'authorization', 'x-workspace-id'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  }));
  app.use('*', platform);
  app.use('*', auditMiddleware);

  app.get('/', (c) => c.json({ name: 'HyphaeHub API', version: '0.1.0', ok: true }));
  app.get('/health', (c) => c.json({ ok: true }));

  // Public: which login methods this instance offers (drives the login screen).
  // Uses the SAME resolver as createAuth so config can't diverge from reality.
  app.get('/api/config', (c) => {
    const { auth0Enabled, emailPasswordEnabled } = resolveAuthConfig(c.env);
    return c.json({ auth0Enabled, emailPasswordEnabled });
  });

  // Public: pre-launch gate check. Returns { allowed } = the caller is signed in
  // as the platform super admin. Used by the marketing site's coming-soon gate.
  app.get('/api/gate', async (c) => {
    const result = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
    const user = result?.user;
    const emailVerified = Boolean((user as { emailVerified?: boolean } | undefined)?.emailVerified);
    const { auth0Enabled } = resolveAuthConfig(c.env);
    const allowed =
      !!user &&
      isSuperAdminEmail(user.email, c.env.SUPER_ADMIN_EMAIL) &&
      (!auth0Enabled || emailVerified);
    return c.json({ allowed });
  });

  // better-auth handles sign-up / sign-in / session / OIDC under /api/auth/*.
  app.on(['POST', 'GET'], '/api/auth/*', (c) => c.var.auth.handler(c.req.raw));

  app.route('/api/strains', strains);
  app.route('/api/batches', batches);
  app.route('/api/cultures', cultures);
  app.route('/api/events', events);
  app.route('/api/forecast', forecast);
  app.route('/api/harvests', harvests);
  app.route('/api/inventory', inventory);
  app.route('/api/jars', jars);
  app.route('/api/costs', costs);
  app.route('/api/photos', photos);
  app.route('/api/orgs', orgs);
  app.route('/api/audit', audit);
  app.route('/api/billing', billing);
  app.route('/api/admin', admin);
  app.route('/api', workspace);

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    console.error('[api] unhandled error', err);
    return c.json({ error: 'Internal server error' }, 500);
  });
  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  return app;
}
