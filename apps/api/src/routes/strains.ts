import { zValidator } from '@hono/zod-validator';
import {
  STRAIN_CATEGORIES,
  strainCategoryCreateSchema,
  strainCreateSchema,
  strainUpdateSchema,
} from '@hyphaehub/core';
import { strainCategories, strains } from '@hyphaehub/db';
import { and, asc, desc, eq, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getFeaturesForWorkspace } from '../lib/features';
import { requireAuth, requireOrgRole } from '../middleware/auth';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();
r.use('*', requireAuth);

// List workspace strains, plus global presets unless the org hides them.
r.get('/', async (c) => {
  const ws = c.var.workspace;
  const features = await getFeaturesForWorkspace(c.var.db, ws);
  const where = features.hideDefaultStrains
    ? eq(strains.workspaceId, ws.id)
    : or(eq(strains.workspaceId, ws.id), eq(strains.isPreset, true));
  const rows = await c.var.db
    .select()
    .from(strains)
    .where(where)
    .orderBy(desc(strains.isPreset), asc(strains.commonName));
  return c.json(rows);
});

r.post('/', zValidator('json', strainCreateSchema), async (c) => {
  const data = c.req.valid('json');
  const rows = await c.var.db
    .insert(strains)
    .values({ ...data, workspaceId: c.var.workspace.id })
    .returning();
  return c.json(rows[0], 201);
});

// ── Strain categories (built-ins + per-org custom) ───────────────────────────
r.get('/categories', async (c) => {
  const ws = c.var.workspace;
  const custom = await c.var.db
    .select({ id: strainCategories.id, name: strainCategories.name })
    .from(strainCategories)
    .where(eq(strainCategories.workspaceId, ws.id))
    .orderBy(asc(strainCategories.name));
  return c.json({
    builtin: STRAIN_CATEGORIES,
    custom,
    all: [...STRAIN_CATEGORIES, ...custom.map((x) => x.name)],
  });
});

r.post('/categories', zValidator('json', strainCategoryCreateSchema), async (c) => {
  const ws = c.var.workspace;
  const name = c.req.valid('json').name.trim();
  if (STRAIN_CATEGORIES.some((b) => b.toLowerCase() === name.toLowerCase())) {
    throw new HTTPException(409, { message: 'That is already a built-in category.' });
  }
  const [existing] = await c.var.db
    .select({ id: strainCategories.id })
    .from(strainCategories)
    .where(and(eq(strainCategories.workspaceId, ws.id), eq(strainCategories.name, name)))
    .limit(1);
  if (existing) throw new HTTPException(409, { message: 'That category already exists.' });
  const rows = await c.var.db
    .insert(strainCategories)
    .values({ workspaceId: ws.id, name })
    .returning();
  return c.json(rows[0], 201);
});

r.delete('/categories/:id', requireOrgRole('OWNER', 'ADMIN'), async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .delete(strainCategories)
    .where(and(eq(strainCategories.id, c.req.param('id')), eq(strainCategories.workspaceId, ws.id)))
    .returning({ id: strainCategories.id });
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

r.get('/:id', async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .select()
    .from(strains)
    .where(
      and(
        eq(strains.id, c.req.param('id')),
        or(eq(strains.workspaceId, ws.id), eq(strains.isPreset, true)),
      ),
    )
    .limit(1);
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json(rows[0]);
});

r.patch('/:id', zValidator('json', strainUpdateSchema), async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .update(strains)
    .set(c.req.valid('json'))
    .where(and(eq(strains.id, c.req.param('id')), eq(strains.workspaceId, ws.id)))
    .returning();
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json(rows[0]);
});

r.delete('/:id', async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .delete(strains)
    .where(and(eq(strains.id, c.req.param('id')), eq(strains.workspaceId, ws.id)))
    .returning({ id: strains.id });
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

export default r;
