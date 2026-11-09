import { zValidator } from '@hono/zod-validator';
import {
  FEATURE_LIST,
  PLANS,
  featureToggleSchema,
  isFeatureKey,
  platformDefaultsSchema,
} from '@hyphaehub/core';
import {
  auditLogs,
  batches,
  connectLinks,
  cultures,
  harvests,
  installs,
  photos,
  platformSettings,
  user as userTable,
  waitlistSignups,
  workspaces,
} from '@hyphaehub/db';
import { count, desc, eq, gte } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { sendEmail, waitlistInviteEmail } from '../lib/email';
import { getPlatformDefaults } from '../lib/features';
import { requireAuth, requireSuperAdmin } from '../middleware/auth';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();
r.use('*', requireAuth);
r.use('*', requireSuperAdmin);

/** Safe projection of a workspace for admin write responses — never the calendarToken or Stripe ids. */
function orgView(ws: typeof workspaces.$inferSelect) {
  return {
    id: ws.id,
    name: ws.name,
    plan: ws.plan,
    features: ws.features,
    storefrontEnabled: ws.storefrontEnabled,
    createdAt: ws.createdAt,
  };
}

/** Platform-wide totals for the admin dashboard. */
r.get('/stats', async (c) => {
  const db = c.var.db;
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [[u], [w], [b], [cu], [h], [ph], [wl], [wl7], plans, [sf]] = await Promise.all([
    db.select({ n: count() }).from(userTable),
    db.select({ n: count() }).from(workspaces),
    db.select({ n: count() }).from(batches),
    db.select({ n: count() }).from(cultures),
    db.select({ n: count() }).from(harvests),
    db.select({ n: count() }).from(photos),
    db.select({ n: count() }).from(waitlistSignups),
    db.select({ n: count() }).from(waitlistSignups).where(gte(waitlistSignups.createdAt, weekAgo)),
    db.select({ plan: workspaces.plan, n: count() }).from(workspaces).groupBy(workspaces.plan),
    db.select({ n: count() }).from(workspaces).where(eq(workspaces.storefrontEnabled, true)),
  ]);
  const planDistribution: Record<string, number> = {};
  for (const p of plans) planDistribution[p.plan] = p.n;
  return c.json({
    users: u?.n ?? 0,
    organizations: w?.n ?? 0,
    batches: b?.n ?? 0,
    cultures: cu?.n ?? 0,
    harvests: h?.n ?? 0,
    photos: ph?.n ?? 0,
    waitlist: wl?.n ?? 0,
    waitlistLast7d: wl7?.n ?? 0,
    storefronts: sf?.n ?? 0,
    planDistribution,
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
      features: workspaces.features,
      storefrontEnabled: workspaces.storefrontEnabled,
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
  return c.json(orgView(ws));
});

/** Super-admin: set (or clear, with enabled=null) one feature override on an org. */
r.patch('/workspaces/:id/features', zValidator('json', featureToggleSchema), async (c) => {
  const { key, enabled } = c.req.valid('json');
  if (!isFeatureKey(key)) throw new HTTPException(400, { message: 'Unknown feature.' });
  const [ws] = await c.var.db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, c.req.param('id')))
    .limit(1);
  if (!ws) throw new HTTPException(404, { message: 'Organization not found.' });
  const features = { ...(ws.features ?? {}) } as Record<string, boolean>;
  if (enabled === null) delete features[key];
  else features[key] = enabled;
  const [updated] = await c.var.db
    .update(workspaces)
    .set({ features })
    .where(eq(workspaces.id, ws.id))
    .returning();
  if (!updated) throw new HTTPException(500, { message: 'Could not update features.' });
  return c.json(orgView(updated));
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

/** Super-admin: the early-access waitlist (newest first). */
r.get('/waitlist', async (c) => {
  const signups = await c.var.db
    .select()
    .from(waitlistSignups)
    .orderBy(desc(waitlistSignups.createdAt))
    .limit(1000);
  const [tot] = await c.var.db.select({ n: count() }).from(waitlistSignups);
  return c.json({ signups, total: tot?.n ?? 0 });
});

/** Super-admin: mark a signup invited and email them that access is open. */
r.post('/waitlist/:id/invite', async (c) => {
  const [row] = await c.var.db
    .update(waitlistSignups)
    .set({ status: 'INVITED' })
    .where(eq(waitlistSignups.id, c.req.param('id')))
    .returning();
  if (!row) throw new HTTPException(404, { message: 'Signup not found.' });
  let emailed = false;
  try {
    const res = await sendEmail(c.env, {
      to: row.email,
      ...waitlistInviteEmail(c.env.APP_URL ?? 'https://app.hyphaehub.io'),
    });
    emailed = res.sent;
  } catch {
    // emailing is best-effort; the status change still stands
  }
  return c.json({ ...row, emailed });
});

/** Super-admin: remove a waitlist signup. */
r.delete('/waitlist/:id', async (c) => {
  const rows = await c.var.db
    .delete(waitlistSignups)
    .where(eq(waitlistSignups.id, c.req.param('id')))
    .returning({ id: waitlistSignups.id });
  if (!rows[0]) throw new HTTPException(404, { message: 'Signup not found.' });
  return c.json({ ok: true });
});

// ── Cloud Connect links ──────────────────────────────────────────────────────

/** Super-admin: every cloud user ↔ self-host connection on the platform. */
r.get('/connect-links', async (c) => {
  const rows = await c.var.db
    .select({
      id: connectLinks.id,
      serverUrl: connectLinks.serverUrl,
      label: connectLinks.label,
      lastSeenAt: connectLinks.lastSeenAt,
      lastVerifiedAt: connectLinks.lastVerifiedAt,
      lastStatus: connectLinks.lastStatus,
      createdAt: connectLinks.createdAt,
      userEmail: userTable.email,
      userName: userTable.name,
    })
    .from(connectLinks)
    .leftJoin(userTable, eq(userTable.id, connectLinks.userId))
    .orderBy(desc(connectLinks.lastSeenAt));
  return c.json({ links: rows, total: rows.length });
});

/**
 * Super-admin: verify a link is live by pinging the self-host's /health, and
 * record the outcome. The target URL is operator-supplied and only a trusted
 * super admin can trigger this, so the fetch is intentionally unrestricted
 * (localhost/LAN targets are allowed); it only reports reachability, never the
 * response body.
 */
r.post('/connect-links/:id/verify', async (c) => {
  const [link] = await c.var.db
    .select()
    .from(connectLinks)
    .where(eq(connectLinks.id, c.req.param('id')))
    .limit(1);
  if (!link) throw new HTTPException(404, { message: 'Link not found.' });

  const started = Date.now();
  let reachable = false;
  let detail: string | null = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(`${link.serverUrl}/health`, { signal: ctrl.signal });
      reachable = res.ok;
      if (!res.ok) detail = `HTTP ${res.status}`;
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    detail = e instanceof Error ? e.message : 'unreachable';
  }
  const latencyMs = Date.now() - started;
  const status = reachable ? 'ok' : 'unreachable';
  await c.var.db
    .update(connectLinks)
    .set({ lastVerifiedAt: new Date(), lastStatus: status })
    .where(eq(connectLinks.id, link.id));
  return c.json({ reachable, status, latencyMs, detail });
});

/** Super-admin: revoke (forget) any connection. */
r.delete('/connect-links/:id', async (c) => {
  const rows = await c.var.db
    .delete(connectLinks)
    .where(eq(connectLinks.id, c.req.param('id')))
    .returning({ id: connectLinks.id });
  if (!rows[0]) throw new HTTPException(404, { message: 'Link not found.' });
  return c.json({ ok: true });
});

// ── Self-host installs (anonymous telemetry) ─────────────────────────────────

/** Super-admin: counts of self-hosted installs + the recent ones. */
r.get('/installs', async (c) => {
  const rows = await c.var.db.select().from(installs).orderBy(desc(installs.lastSeenAt));
  const now = Date.now();
  const since = (days: number) => now - days * 86_400_000;
  const activeWithin = (days: number) =>
    rows.filter((r) => new Date(r.lastSeenAt).getTime() >= since(days)).length;
  return c.json({
    installs: rows.slice(0, 500),
    total: rows.length,
    active7: activeWithin(7),
    active30: activeWithin(30),
  });
});

export default r;
