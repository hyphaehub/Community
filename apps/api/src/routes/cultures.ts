import { zValidator } from '@hono/zod-validator';
import {
  combineCulturesSchema,
  cultureCreateSchema,
  cultureUpdateSchema,
  splitCultureSchema,
} from '@hyphaehub/core';
import {
  costEntries,
  cultures,
  events,
  harvests,
  type HyphaeDB,
  lineage,
  type Workspace,
} from '@hyphaehub/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { toDate, withDates } from '../lib/dates';
import { enforceLimit, getUsage } from '../lib/workspace';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();
r.use('*', requireAuth);

async function getCulture(db: HyphaeDB, ws: Workspace, id: string) {
  const rows = await db
    .select()
    .from(cultures)
    .where(and(eq(cultures.id, id), eq(cultures.workspaceId, ws.id)))
    .limit(1);
  return rows[0] ?? null;
}

r.get('/', async (c) => {
  const ws = c.var.workspace;
  const filters = [eq(cultures.workspaceId, ws.id)];
  const batchId = c.req.query('batchId');
  const type = c.req.query('type');
  const status = c.req.query('status');
  if (batchId) filters.push(eq(cultures.batchId, batchId));
  if (type) filters.push(eq(cultures.type, type as never));
  if (status) filters.push(eq(cultures.status, status as never));
  const rows = await c.var.db
    .select()
    .from(cultures)
    .where(and(...filters))
    .orderBy(desc(cultures.createdAt));
  return c.json(rows);
});

r.post('/', zValidator('json', cultureCreateSchema), async (c) => {
  const ws = c.var.workspace;
  const usage = await getUsage(c.var.db, ws.id);
  await enforceLimit(c.var.db, ws, 'maxCultures', usage.cultures);
  const values = withDates(c.req.valid('json'), ['inoculatedAt']);
  const rows = await c.var.db
    .insert(cultures)
    .values({ ...values, workspaceId: ws.id })
    .returning();
  return c.json(rows[0], 201);
});

r.get('/:id', async (c) => {
  const ws = c.var.workspace;
  const id = c.req.param('id');
  const culture = await getCulture(c.var.db, ws, id);
  if (!culture) return c.json({ error: 'Not found' }, 404);

  const [eventRows, harvestRows, parentEdges, childEdges] = await Promise.all([
    c.var.db.select().from(events).where(eq(events.cultureId, id)).orderBy(desc(events.occurredAt)),
    c.var.db.select().from(harvests).where(eq(harvests.cultureId, id)).orderBy(harvests.flushNumber),
    c.var.db.select().from(lineage).where(eq(lineage.childCultureId, id)),
    c.var.db.select().from(lineage).where(eq(lineage.parentCultureId, id)),
  ]);

  const parentIds = parentEdges.map((e) => e.parentCultureId);
  const childIds = childEdges.map((e) => e.childCultureId);
  const [parents, children] = await Promise.all([
    parentIds.length
      ? c.var.db.select().from(cultures).where(inArray(cultures.id, parentIds))
      : Promise.resolve([]),
    childIds.length
      ? c.var.db.select().from(cultures).where(inArray(cultures.id, childIds))
      : Promise.resolve([]),
  ]);

  return c.json({ culture, events: eventRows, harvests: harvestRows, parents, children });
});

r.get('/:id/lineage', async (c) => {
  const ws = c.var.workspace;
  const id = c.req.param('id');
  const culture = await getCulture(c.var.db, ws, id);
  if (!culture) return c.json({ error: 'Not found' }, 404);
  const parentEdges = await c.var.db
    .select()
    .from(lineage)
    .where(eq(lineage.childCultureId, id));
  const childEdges = await c.var.db.select().from(lineage).where(eq(lineage.parentCultureId, id));
  return c.json({ parents: parentEdges, children: childEdges });
});

r.patch('/:id', zValidator('json', cultureUpdateSchema), async (c) => {
  const ws = c.var.workspace;
  const values = withDates(c.req.valid('json'), ['inoculatedAt']);
  const rows = await c.var.db
    .update(cultures)
    .set(values)
    .where(and(eq(cultures.id, c.req.param('id')), eq(cultures.workspaceId, ws.id)))
    .returning();
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json(rows[0]);
});

r.delete('/:id', async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .delete(cultures)
    .where(and(eq(cultures.id, c.req.param('id')), eq(cultures.workspaceId, ws.id)))
    .returning({ id: cultures.id });
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

/**
 * Split one culture into N children — e.g. one liquid culture → several grain
 * jars. Creates the child cultures, the lineage edges, inoculation events, and
 * optional per-child cost entries.
 */
r.post('/:id/split', zValidator('json', splitCultureSchema), async (c) => {
  const ws = c.var.workspace;
  const parent = await getCulture(c.var.db, ws, c.req.param('id'));
  if (!parent) return c.json({ error: 'Parent culture not found' }, 404);

  const data = c.req.valid('json');
  const usage = await getUsage(c.var.db, ws.id);
  await enforceLimit(c.var.db, ws, 'maxCultures', usage.cultures, data.count);

  const batchId = data.batchId ?? parent.batchId ?? null;
  const prefix = data.labelPrefix ?? parent.label;
  const inoculatedAt = toDate(data.inoculatedAt) ?? new Date();
  const created = [];

  for (let i = 1; i <= data.count; i++) {
    const rows = await c.var.db
      .insert(cultures)
      .values({
        workspaceId: ws.id,
        batchId,
        strainId: parent.strainId,
        type: data.type,
        label: `${prefix}-${i}`,
        status: data.status,
        containerType: data.containerType,
        substrateType: data.substrateType,
        quantity: data.quantity,
        quantityUnit: data.quantityUnit,
        inoculatedAt,
      })
      .returning();
    const child = rows[0];
    if (!child) continue;
    created.push(child);

    await c.var.db
      .insert(lineage)
      .values({ workspaceId: ws.id, parentCultureId: parent.id, childCultureId: child.id });

    await c.var.db.insert(events).values({
      workspaceId: ws.id,
      cultureId: child.id,
      batchId,
      type: 'INOCULATION',
      occurredAt: inoculatedAt,
      note: `Inoculated from ${parent.label}`,
    });

    if (data.costPerChildCents) {
      await c.var.db.insert(costEntries).values({
        workspaceId: ws.id,
        batchId,
        cultureId: child.id,
        description: `${child.label} materials`,
        category: 'MATERIALS',
        amountCents: data.costPerChildCents,
        occurredAt: inoculatedAt,
      });
    }
  }

  return c.json({ parent, children: created }, 201);
});

/**
 * Combine one or more parent cultures (jars) into a single BULK tub. Records the
 * lineage, marks parents SPENT, logs a spawn-to-bulk event, and (optionally) a
 * bulk-substrate cost entry.
 */
r.post('/combine', zValidator('json', combineCulturesSchema), async (c) => {
  const ws = c.var.workspace;
  const data = c.req.valid('json');

  const parents = await c.var.db
    .select()
    .from(cultures)
    .where(and(eq(cultures.workspaceId, ws.id), inArray(cultures.id, data.parentIds)));
  if (parents.length !== data.parentIds.length) {
    return c.json({ error: 'One or more parent cultures were not found' }, 400);
  }

  const usage = await getUsage(c.var.db, ws.id);
  await enforceLimit(c.var.db, ws, 'maxCultures', usage.cultures);

  const first = parents[0];
  const batchId = data.batchId ?? first?.batchId ?? null;
  const spawnedAt = toDate(data.spawnToBulkAt) ?? new Date();

  const rows = await c.var.db
    .insert(cultures)
    .values({
      workspaceId: ws.id,
      batchId,
      strainId: first?.strainId,
      type: data.type,
      label: data.label,
      status: data.status,
      containerType: data.containerType,
      substrateType: data.substrateType,
      drySubstrateG: data.drySubstrateG,
      quantity: data.quantity,
      quantityUnit: data.quantityUnit,
    })
    .returning();
  const tub = rows[0];
  if (!tub) return c.json({ error: 'Failed to create tub' }, 500);

  for (const parent of parents) {
    await c.var.db
      .insert(lineage)
      .values({ workspaceId: ws.id, parentCultureId: parent.id, childCultureId: tub.id });
    await c.var.db
      .update(cultures)
      .set({ status: 'SPENT' })
      .where(eq(cultures.id, parent.id));
  }

  await c.var.db.insert(events).values({
    workspaceId: ws.id,
    cultureId: tub.id,
    batchId,
    type: 'SPAWN_TO_BULK',
    occurredAt: spawnedAt,
    note: `Spawned from ${parents.map((p) => p.label).join(', ')}`,
    data: { parentIds: data.parentIds },
  });

  if (data.substrateCostCents) {
    await c.var.db.insert(costEntries).values({
      workspaceId: ws.id,
      batchId,
      cultureId: tub.id,
      description: `${tub.label} bulk substrate`,
      category: 'MATERIALS',
      amountCents: data.substrateCostCents,
      occurredAt: spawnedAt,
    });
  }

  return c.json({ tub, parents }, 201);
});

export default r;
