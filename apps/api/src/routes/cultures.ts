import { zValidator } from '@hono/zod-validator';
import {
  combineCulturesSchema,
  contaminationSchema,
  cultureCreateSchema,
  cultureUpdateSchema,
  splitCultureSchema,
} from '@hyphaehub/core';
import {
  events,
  type HyphaeBatchItem,
  type HyphaeDB,
  type Workspace,
  costEntries,
  cultures,
  harvests,
  lineage,
  newId,
} from '@hyphaehub/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { chunk, insertChunkSize } from '../lib/batch';
import { toDate, withDates } from '../lib/dates';
import { enforceLimit, getUsage } from '../lib/workspace';

type CultureRow = typeof cultures.$inferSelect;

/** Fetch cultures by an unbounded id list, chunked under D1's 100-param cap. */
async function culturesByIds(db: HyphaeDB, ids: string[]): Promise<CultureRow[]> {
  const out: CultureRow[] = [];
  for (const group of chunk(ids, 90)) {
    if (group.length)
      out.push(...(await db.select().from(cultures).where(inArray(cultures.id, group))));
  }
  return out;
}
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
    c.var.db
      .select()
      .from(harvests)
      .where(eq(harvests.cultureId, id))
      .orderBy(harvests.flushNumber),
    c.var.db.select().from(lineage).where(eq(lineage.childCultureId, id)),
    c.var.db.select().from(lineage).where(eq(lineage.parentCultureId, id)),
  ]);

  const parentIds = parentEdges.map((e) => e.parentCultureId);
  const childIds = childEdges.map((e) => e.childCultureId);
  const [parents, children] = await Promise.all([
    culturesByIds(c.var.db, parentIds),
    culturesByIds(c.var.db, childIds),
  ]);

  return c.json({ culture, events: eventRows, harvests: harvestRows, parents, children });
});

r.get('/:id/lineage', async (c) => {
  const ws = c.var.workspace;
  const id = c.req.param('id');
  const culture = await getCulture(c.var.db, ws, id);
  if (!culture) return c.json({ error: 'Not found' }, 404);
  const parentEdges = await c.var.db.select().from(lineage).where(eq(lineage.childCultureId, id));
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
 * Mark a culture contaminated with a structured taxonomy (contaminant type +
 * suspected cause), and log a CONTAMINATION event — atomically. This is the data
 * that powers the contamination-rate analytics.
 */
r.post('/:id/contaminate', zValidator('json', contaminationSchema), async (c) => {
  const ws = c.var.workspace;
  const id = c.req.param('id');
  const culture = await getCulture(c.var.db, ws, id);
  if (!culture) return c.json({ error: 'Not found' }, 404);
  const data = c.req.valid('json');
  const at = toDate(data.contaminatedAt) ?? new Date();
  const writes: [HyphaeBatchItem, HyphaeBatchItem] = [
    c.var.db
      .update(cultures)
      .set({
        status: 'CONTAMINATED',
        contaminantType: data.contaminantType,
        contaminationCause: data.contaminationCause ?? null,
        contaminatedAt: at,
      })
      .where(and(eq(cultures.id, id), eq(cultures.workspaceId, ws.id)))
      .returning(),
    c.var.db.insert(events).values({
      workspaceId: ws.id,
      cultureId: id,
      batchId: culture.batchId,
      type: 'CONTAMINATION',
      occurredAt: at,
      note: data.note ?? null,
      data: {
        contaminantType: data.contaminantType,
        contaminationCause: data.contaminationCause ?? null,
      },
    }),
  ];
  const results = await c.var.db.batch(writes);
  // Fall back to the fetched row if a concurrent delete raced the update (TOCTOU),
  // so the response is always a well-formed culture object.
  return c.json((results[0] as CultureRow[])[0] ?? { ...culture, status: 'CONTAMINATED' });
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

  const db = c.var.db;
  const data = c.req.valid('json');
  const usage = await getUsage(db, ws.id);
  await enforceLimit(db, ws, 'maxCultures', usage.cultures, data.count);

  const batchId = data.batchId ?? parent.batchId ?? null;
  const prefix = data.labelPrefix ?? parent.label;
  const inoculatedAt = toDate(data.inoculatedAt) ?? new Date();

  // Pre-generate child ids so the lineage/event/cost rows can reference them
  // without depending on insert ordering; build every row up front.
  const childRows = Array.from({ length: data.count }, (_, i) => ({
    id: newId(),
    workspaceId: ws.id,
    batchId,
    strainId: parent.strainId,
    type: data.type,
    label: `${prefix}-${i + 1}`,
    status: data.status,
    containerType: data.containerType,
    substrateType: data.substrateType,
    quantity: data.quantity,
    quantityUnit: data.quantityUnit,
    inoculatedAt,
  }));
  const lineageRows = childRows.map((ch) => ({
    workspaceId: ws.id,
    parentCultureId: parent.id,
    childCultureId: ch.id,
  }));
  const eventRows = childRows.map((ch) => ({
    workspaceId: ws.id,
    cultureId: ch.id,
    batchId,
    type: 'INOCULATION' as const,
    occurredAt: inoculatedAt,
    note: `Inoculated from ${parent.label}`,
  }));
  const cpc = data.costPerChildCents;
  const costRows = cpc
    ? childRows.map((ch) => ({
        workspaceId: ws.id,
        batchId,
        cultureId: ch.id,
        description: `${ch.label} materials`,
        category: 'MATERIALS' as const,
        amountCents: cpc,
        occurredAt: inoculatedAt,
      }))
    : [];

  // One atomic batch: children first (lineage/events/costs reference them), each
  // multi-row insert chunked under D1's 100-bound-parameter cap. All-or-nothing,
  // so a mid-way failure never orphans cultures or corrupts the usage count.
  const cultureInserts = chunk(childRows, insertChunkSize(15)).map((rows) =>
    db.insert(cultures).values(rows).returning(),
  );
  const writes: HyphaeBatchItem[] = [
    ...cultureInserts,
    ...chunk(lineageRows, insertChunkSize(5)).map((rows) => db.insert(lineage).values(rows)),
    ...chunk(eventRows, insertChunkSize(8)).map((rows) => db.insert(events).values(rows)),
    ...chunk(costRows, insertChunkSize(9)).map((rows) => db.insert(costEntries).values(rows)),
  ];
  const results = await db.batch(writes as [HyphaeBatchItem, ...HyphaeBatchItem[]]);
  const created = (results.slice(0, cultureInserts.length) as CultureRow[][]).flat();

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

  const db = c.var.db;
  const first = parents[0];
  const batchId = data.batchId ?? first?.batchId ?? null;
  const spawnedAt = toDate(data.spawnToBulkAt) ?? new Date();

  // Pre-generate the tub id so lineage/event/cost rows can reference it, then run
  // the whole spawn-to-bulk as one atomic batch: tub first, lineage edges, a
  // SINGLE bulk UPDATE marking parents SPENT (replaces the per-parent loop), the
  // event, and the optional cost. A failure can't half-consume the source jars.
  const tubId = newId();
  const tubValues = {
    id: tubId,
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
  };
  const lineageRows = parents.map((p) => ({
    workspaceId: ws.id,
    parentCultureId: p.id,
    childCultureId: tubId,
  }));

  const writes: HyphaeBatchItem[] = [
    db.insert(cultures).values(tubValues).returning(),
    ...chunk(lineageRows, insertChunkSize(5)).map((rows) => db.insert(lineage).values(rows)),
    db
      .update(cultures)
      .set({ status: 'SPENT' })
      .where(and(eq(cultures.workspaceId, ws.id), inArray(cultures.id, data.parentIds))),
    db.insert(events).values({
      workspaceId: ws.id,
      cultureId: tubId,
      batchId,
      type: 'SPAWN_TO_BULK',
      occurredAt: spawnedAt,
      note: `Spawned from ${parents.map((p) => p.label).join(', ')}`,
      data: { parentIds: data.parentIds },
    }),
  ];
  if (data.substrateCostCents) {
    writes.push(
      db.insert(costEntries).values({
        workspaceId: ws.id,
        batchId,
        cultureId: tubId,
        description: `${data.label} bulk substrate`,
        category: 'MATERIALS',
        amountCents: data.substrateCostCents,
        occurredAt: spawnedAt,
      }),
    );
  }
  const results = await db.batch(writes as [HyphaeBatchItem, ...HyphaeBatchItem[]]);
  const tub = (results[0] as CultureRow[])[0] ?? tubValues;

  return c.json({ tub, parents }, 201);
});

export default r;
