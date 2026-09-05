import { zValidator } from '@hono/zod-validator';
import { FEATURE_LIST, PLANS, platformDefaultsSchema } from '@hyphaehub/core';
import {
  auditLogs,
  batches,
  cultures,
  harvests,
  platformSettings,
  user as userTable,
  workspaces,
} from '@hyphaehub/db';
import { count, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { getPlatformDefaults } from '../lib/features';
import { requireAuth, requireSuperAdmin } from '../middleware/auth';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();
r.use('*', requireAuth);
r.use('*', requireSuperAdmin);

/** Platform-wide totals for the admin dashboard. */
r.get('/stats', async (c) => {
  const db = c.var.db;
  const [[u], [w], [b], [cu], [h]] = await Promise.all([
    db.select({ n: count() }).from(userTable),
    db.select({ n: count() }).from(workspaces),
    db.select({ n: count() }).from(batches),
    db.select({ n: count() }).from(cultures),
    db.select({ n: count() }).from(harvests),
  ]);
  return c.json({
    users: u?.n ?? 0,
    organizations: w?.n ?? 0,
    batches: b?.n ?? 0,
    cultures: cu?.n ?? 0,
    harvests: h?.n ?? 0,
  });
});

/** Super-admin overview: every workspace with its owner and headline counts. */
r.get('/workspaces', async (c) => {
  const db = c.var.db;
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      plan: workspaces.plan,
      createdAt: workspaces.createdAt,
      ownerUserId: workspaces.ownerUserId,
      ownerEmail: userTable.email,
      ownerName: userTable.name,
    })
    .from(workspaces)
    .leftJoin(userTable, eq(userTable.id, workspaces.ownerUserId));

  const enriched = await Promise.all(
    rows.map(async (w) => {
      const [b] = await db
        .select({ n: count() })
        .from(batches)
        .where(eq(batches.workspaceId, w.id));
      const [cu] = await db
        .select({ n: count() })
        .from(cultures)
        .where(eq(cultures.workspaceId, w.id));
      const [h] = await db
        .select({ n: count() })
        .from(harvests)
        .where(eq(harvests.workspaceId, w.id));
      return { ...w, batches: b?.n ?? 0, cultures: cu?.n ?? 0, harvests: h?.n ?? 0 };
    }),
  );

  return c.json({ workspaces: enriched, total: enriched.length });
});

/** Super-admin: change an organization's plan (platform billing override). */
r.patch('/workspaces/:id', zValidator('json', z.object({ plan: z.enum(PLANS) })), async (c) => {
  const [ws] = await c.var.db
    .update(workspaces)
    .set({ plan: c.req.valid('json').plan })
    .where(eq(workspaces.id, c.req.param('id')))
    .returning();
  if (!ws) throw new HTTPException(404, { message: 'Organization not found.' });
  return c.json(ws);
});

/** Super-admin: read platform feature defaults + the feature catalog. */
r.get('/features', async (c) => {
  const defaults = await getPlatformDefaults(c.var.db);
  return c.json({ defaults, features: FEATURE_LIST });
});

/** Super-admin: set platform feature defaults (applied to orgs without an override). */
r.patch('/features', zValidator('json', platformDefaultsSchema), async (c) => {
  const { defaults } = c.req.valid('json');
  await c.var.db
    .insert(platformSettings)
    .values({ id: 'platform', featureDefaults: defaults })
    .onConflictDoUpdate({ target: platformSettings.id, set: { featureDefaults: defaults } });
  return c.json({ ok: true, defaults });
});

/** Super-admin: platform-wide activity feed. */
r.get('/audit', async (c) => {
  const limit = Math.min(Number(c.req.query('limit')) || 100, 500);
  const rows = await c.var.db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      status: auditLogs.status,
      summary: auditLogs.summary,
      createdAt: auditLogs.createdAt,
      actorEmail: userTable.email,
      workspaceName: workspaces.name,
    })
    .from(auditLogs)
    .leftJoin(userTable, eq(userTable.id, auditLogs.userId))
    .leftJoin(workspaces, eq(workspaces.id, auditLogs.workspaceId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
  return c.json(rows);
});

/** Super-admin: list all users. */
r.get('/users', async (c) => {
  const rows = await c.var.db
    .select({
      id: userTable.id,
      email: userTable.email,
      name: userTable.name,
      createdAt: userTable.createdAt,
    })
    .from(userTable);
  return c.json({ users: rows, total: rows.length });
});

export default r;
