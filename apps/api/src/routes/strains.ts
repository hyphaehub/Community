import { zValidator } from '@hono/zod-validator';
import {
  STRAIN_CATEGORIES,
  biologicalEfficiency,
  computeGenerations,
  strainCategoryCreateSchema,
  strainCreateSchema,
  strainUpdateSchema,
} from '@hyphaehub/core';
import { batches, cultures, harvests, lineage, strainCategories, strains } from '@hyphaehub/db';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { chunk } from '../lib/batch';
import { withDates } from '../lib/dates';
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
  const data = withDates(c.req.valid('json'), ['acquiredAt']);
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
  const where = and(eq(strains.id, c.req.param('id')), eq(strains.workspaceId, ws.id));
  const valid = c.req.valid('json');
  const set = withDates(valid, ['acquiredAt']);
  // Honor an explicit null on the nullable acquired date so clearing it persists.
  if (valid.acquiredAt === null) (set as { acquiredAt?: Date | null }).acquiredAt = null;
  // Skip the write if nothing was actually provided — Drizzle throws on an empty set.
  const hasUpdate = valid.acquiredAt === null || Object.values(set).some((v) => v !== undefined);
  if (!hasUpdate) {
    const [row] = await c.var.db.select().from(strains).where(where).limit(1);
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json(row);
  }
  const rows = await c.var.db.update(strains).set(set).where(where).returning();
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json(rows[0]);
});

/**
 * The genetics hub for one strain: provenance + rolled-up performance, every
 * culture of this strain tagged with its generation (lineage depth), the batches
 * run with it, and its stored library stock.
 */
r.get('/:id/overview', async (c) => {
  const ws = c.var.workspace;
  const id = c.req.param('id');
  const [strain] = await c.var.db
    .select()
    .from(strains)
    .where(and(eq(strains.id, id), or(eq(strains.workspaceId, ws.id), eq(strains.isPreset, true))))
    .limit(1);
  if (!strain) return c.json({ error: 'Not found' }, 404);

  const cultureRows = await c.var.db
    .select()
    .from(cultures)
    .where(and(eq(cultures.workspaceId, ws.id), eq(cultures.strainId, id)))
    .orderBy(asc(cultures.createdAt));
  const ids = cultureRows.map((x) => x.id);

  const edges: { parentCultureId: string; childCultureId: string }[] = [];
  const harvestRows: (typeof harvests.$inferSelect)[] = [];
  for (const group of chunk(ids, 90)) {
    if (!group.length) continue;
    edges.push(
      ...(await c.var.db
        .select({
          parentCultureId: lineage.parentCultureId,
          childCultureId: lineage.childCultureId,
        })
        .from(lineage)
        .where(and(eq(lineage.workspaceId, ws.id), inArray(lineage.childCultureId, group)))),
    );
    harvestRows.push(
      ...(await c.var.db
        .select()
        .from(harvests)
        .where(and(eq(harvests.workspaceId, ws.id), inArray(harvests.cultureId, group)))),
    );
  }
  const generations = computeGenerations(ids, edges);
  const batchRows = await c.var.db
    .select({
      id: batches.id,
      name: batches.name,
      status: batches.status,
      startedAt: batches.startedAt,
    })
    .from(batches)
    .where(and(eq(batches.workspaceId, ws.id), eq(batches.strainId, id)));

  const totalWetG = harvestRows.reduce((s, h) => s + (h.wetWeightG ?? 0), 0);
  const totalDryG = harvestRows.reduce((s, h) => s + (h.dryWeightG ?? 0), 0);
  const drySub = cultureRows
    .filter((x) => x.type === 'BULK')
    .reduce((s, x) => s + (x.drySubstrateG ?? 0), 0);
  const contaminated = cultureRows.filter((x) => x.status === 'CONTAMINATED').length;
  const genValues = [...generations.values()];

  return c.json({
    strain,
    performance: {
      batches: batchRows.length,
      cultures: cultureRows.length,
      contaminated,
      contamRate: cultureRows.length ? contaminated / cultureRows.length : 0,
      totalWetG,
      totalDryG,
      biologicalEfficiency: biologicalEfficiency(totalWetG, drySub || null),
      maxGeneration: genValues.length ? Math.max(...genValues) : 0,
    },
    cultures: cultureRows.map((x) => ({ ...x, generation: generations.get(x.id) ?? 0 })),
    batches: batchRows,
    library: cultureRows.filter((x) => x.status === 'STORED'),
  });
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
