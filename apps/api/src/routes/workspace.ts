import { zValidator } from '@hono/zod-validator';
import { type Plan, PLAN_LIMITS, workspaceUpdateSchema } from '@hyphaehub/core';
import { workspaces } from '@hyphaehub/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getFeaturesForWorkspace } from '../lib/features';
import { getUsage, listUserOrgs } from '../lib/workspace';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();
r.use('*', requireAuth);

// Bootstrap payload for the app shell: who am I, my active org + role, the full
// list of orgs I belong to (for the switcher), platform super-admin flag, and
// the active org's plan + usage.
r.get('/me', async (c) => {
  const ws = c.var.workspace;
  const plan = ws.plan as Plan;
  const [usage, orgs, features] = await Promise.all([
    getUsage(c.var.db, ws.id),
    listUserOrgs(c.var.db, c.var.user.id),
    getFeaturesForWorkspace(c.var.db, ws),
  ]);
  return c.json({
    user: c.var.user,
    workspace: ws,
    activeWorkspaceId: ws.id,
    plan,
    limits: PLAN_LIMITS[plan],
    usage,
    features,
    isSuperAdmin: c.var.isSuperAdmin,
    role: c.var.membershipRole,
    organizations: orgs.map((o) => ({
      id: o.workspace.id,
      name: o.workspace.name,
      plan: o.workspace.plan,
      role: o.role,
    })),
  });
});

r.get('/usage', async (c) => {
  const ws = c.var.workspace;
  const plan = ws.plan as Plan;
  return c.json({ usage: await getUsage(c.var.db, ws.id), limits: PLAN_LIMITS[plan], plan });
});

r.patch('/workspace', zValidator('json', workspaceUpdateSchema), async (c) => {
  const ws = c.var.workspace;
  // Only the owner may rename / change plan here (plan normally set via billing).
  const rows = await c.var.db
    .update(workspaces)
    .set({ name: c.req.valid('json').name })
    .where(eq(workspaces.id, ws.id))
    .returning();
  return c.json(rows[0]);
});

export default r;
