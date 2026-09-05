import { zValidator } from '@hono/zod-validator';
import {
  featureToggleSchema,
  isFeatureKey,
  type MembershipRole,
  memberAddSchema,
  memberRoleSchema,
  orgCreateSchema,
  orgUpdateSchema,
  type Plan,
  PLAN_LIMITS,
} from '@hyphaehub/core';
import { memberships, user as userTable, workspaces } from '@hyphaehub/db';
import { and, asc, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { listUserOrgs } from '../lib/workspace';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();
r.use('*', requireAuth);

/** The caller's role in a specific org, or null if they are not a member. */
async function callerRole(c: Context<AppEnv>, orgId: string): Promise<MembershipRole | null> {
  const [m] = await c.var.db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, c.var.user.id), eq(memberships.workspaceId, orgId)))
    .limit(1);
  return m?.role ?? null;
}

/** Require the caller to be OWNER/ADMIN of the org (super admin always passes). */
async function requireOrgAdmin(c: Context<AppEnv>, orgId: string): Promise<void> {
  if (c.var.isSuperAdmin) return;
  const role = await callerRole(c, orgId);
  if (role !== 'OWNER' && role !== 'ADMIN') {
    throw new HTTPException(403, { message: 'Requires organization OWNER or ADMIN.' });
  }
}

async function ownerCount(c: Context<AppEnv>, orgId: string): Promise<number> {
  const rows = await c.var.db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, orgId), eq(memberships.role, 'OWNER')));
  return rows.length;
}

// ── My organizations ─────────────────────────────────────────────────────────
r.get('/', async (c) => {
  const orgs = await listUserOrgs(c.var.db, c.var.user.id);
  return c.json(
    orgs.map((o) => ({
      id: o.workspace.id,
      name: o.workspace.name,
      plan: o.workspace.plan,
      role: o.role,
    })),
  );
});

// Any authenticated user can start a new organization; they become its OWNER.
// The number of orgs a user may OWN is gated by the best plan among their owned
// orgs (FREE 1 · PRO 3 · FARM unlimited). The platform super admin is exempt.
r.post('/', zValidator('json', orgCreateSchema), async (c) => {
  const { name } = c.req.valid('json');

  if (!c.var.isSuperAdmin) {
    const owned = await c.var.db
      .select({ plan: workspaces.plan })
      .from(workspaces)
      .where(eq(workspaces.ownerUserId, c.var.user.id));
    let limit: number | null = PLAN_LIMITS.FREE.maxOrgs; // default entitlement
    for (const o of owned) {
      const m = PLAN_LIMITS[o.plan as Plan].maxOrgs;
      if (m === null) {
        limit = null;
        break;
      }
      if (limit !== null) limit = Math.max(limit, m);
    }
    if (limit !== null && owned.length >= limit) {
      throw new HTTPException(402, {
        message: `Your plan allows ${limit} organization${limit === 1 ? '' : 's'}. Upgrade a farm to Pro or Farm to create more.`,
      });
    }
  }

  const [ws] = await c.var.db
    .insert(workspaces)
    .values({ name, ownerUserId: c.var.user.id })
    .returning();
  if (!ws) throw new HTTPException(500, { message: 'Failed to create organization' });
  await c.var.db
    .insert(memberships)
    .values({ workspaceId: ws.id, userId: c.var.user.id, role: 'OWNER' });
  return c.json({ id: ws.id, name: ws.name, plan: ws.plan, role: 'OWNER' }, 201);
});

// ── A single org + its members ───────────────────────────────────────────────
r.get('/:id/members', async (c) => {
  const orgId = c.req.param('id');
  if (!c.var.isSuperAdmin && !(await callerRole(c, orgId))) {
    throw new HTTPException(403, { message: 'Not a member of this organization.' });
  }
  const rows = await c.var.db
    .select({
      userId: memberships.userId,
      role: memberships.role,
      email: userTable.email,
      name: userTable.name,
      joinedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(userTable, eq(userTable.id, memberships.userId))
    .where(eq(memberships.workspaceId, orgId))
    .orderBy(asc(memberships.createdAt));
  return c.json(rows);
});

r.patch('/:id', zValidator('json', orgUpdateSchema), async (c) => {
  const orgId = c.req.param('id');
  await requireOrgAdmin(c, orgId);
  const [ws] = await c.var.db
    .update(workspaces)
    .set({ name: c.req.valid('json').name })
    .where(eq(workspaces.id, orgId))
    .returning();
  if (!ws) throw new HTTPException(404, { message: 'Organization not found.' });
  return c.json(ws);
});

// Toggle a per-org feature override. `enabled: null` clears the override so the
// org inherits the platform default.
r.patch('/:id/features', zValidator('json', featureToggleSchema), async (c) => {
  const orgId = c.req.param('id');
  await requireOrgAdmin(c, orgId);
  const { key, enabled } = c.req.valid('json');
  if (!isFeatureKey(key)) throw new HTTPException(400, { message: 'Unknown feature.' });
  const [ws] = await c.var.db
    .select({ features: workspaces.features })
    .from(workspaces)
    .where(eq(workspaces.id, orgId))
    .limit(1);
  if (!ws) throw new HTTPException(404, { message: 'Organization not found.' });
  const features: Record<string, boolean> = { ...(ws.features ?? {}) };
  if (enabled === null) delete features[key];
  else features[key] = enabled;
  await c.var.db.update(workspaces).set({ features }).where(eq(workspaces.id, orgId));
  return c.json({ ok: true, features });
});

// Add an existing user (by email) to the org.
r.post('/:id/members', zValidator('json', memberAddSchema), async (c) => {
  const orgId = c.req.param('id');
  await requireOrgAdmin(c, orgId);
  const { email, role } = c.req.valid('json');
  const [u] = await c.var.db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email.trim().toLowerCase()))
    .limit(1);
  if (!u) {
    throw new HTTPException(404, {
      message: 'No account with that email yet. Ask them to sign in once first.',
    });
  }
  const [existing] = await c.var.db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, orgId), eq(memberships.userId, u.id)))
    .limit(1);
  if (existing) throw new HTTPException(409, { message: 'Already a member.' });
  await c.var.db.insert(memberships).values({ workspaceId: orgId, userId: u.id, role });
  return c.json({ ok: true }, 201);
});

r.patch('/:id/members/:userId', zValidator('json', memberRoleSchema), async (c) => {
  const orgId = c.req.param('id');
  const targetUserId = c.req.param('userId');
  await requireOrgAdmin(c, orgId);
  const { role } = c.req.valid('json');
  // Don't allow demoting the last remaining owner.
  if (role !== 'OWNER') {
    const [target] = await c.var.db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, orgId), eq(memberships.userId, targetUserId)))
      .limit(1);
    if (target?.role === 'OWNER' && (await ownerCount(c, orgId)) <= 1) {
      throw new HTTPException(400, { message: 'An organization must keep at least one owner.' });
    }
  }
  const [updated] = await c.var.db
    .update(memberships)
    .set({ role })
    .where(and(eq(memberships.workspaceId, orgId), eq(memberships.userId, targetUserId)))
    .returning();
  if (!updated) throw new HTTPException(404, { message: 'Membership not found.' });
  return c.json({ ok: true });
});

r.delete('/:id/members/:userId', async (c) => {
  const orgId = c.req.param('id');
  const targetUserId = c.req.param('userId');
  const isSelf = targetUserId === c.var.user.id;
  // Members may remove themselves (leave); otherwise OWNER/ADMIN is required.
  if (!isSelf) await requireOrgAdmin(c, orgId);
  const [target] = await c.var.db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, orgId), eq(memberships.userId, targetUserId)))
    .limit(1);
  if (!target) throw new HTTPException(404, { message: 'Membership not found.' });
  if (target.role === 'OWNER' && (await ownerCount(c, orgId)) <= 1) {
    throw new HTTPException(400, { message: 'An organization must keep at least one owner.' });
  }
  await c.var.db
    .delete(memberships)
    .where(and(eq(memberships.workspaceId, orgId), eq(memberships.userId, targetUserId)));
  return c.json({ ok: true });
});

export default r;
