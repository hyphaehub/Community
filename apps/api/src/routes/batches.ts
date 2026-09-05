import { zValidator } from '@hono/zod-validator';
import {
  type BatchSummary,
  batchCreateSchema,
  batchUpdateSchema,
  computeBatchSummary,
} from '@hyphaehub/core';
import { batches, costEntries, cultures, harvests, type HyphaeDB, strains } from '@hyphaehub/db';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { withDates } from '../lib/dates';
import { enforceLimit, getUsage } from '../lib/workspace';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();
r.use('*', requireAuth);

/** Gather all data a batch needs and compute its headline cost/yield summary. */
async function summarize(db: HyphaeDB, workspaceId: string, batchId: string): Promise<BatchSummary> {
  const [costRows, harvestRows, bulk, batchRow] = await Promise.all([
    db.select().from(costEntries).where(eq(costEntries.batchId, batchId)),
    db.select().from(harvests).where(eq(harvests.batchId, batchId)),
    db
      .select({ dry: cultures.drySubstrateG })
      .from(cultures)
      .where(and(eq(cultures.batchId, batchId), eq(cultures.type, 'BULK'))),
    db.select().from(batches).where(eq(batches.id, batchId)).limit(1),
  ]);
  const drySubstrateG = bulk.reduce((sum, x) => sum + (x.dry ?? 0), 0) || null;
  return computeBatchSummary({
    costs: costRows.map((x) => ({ amountCents: x.amountCents, category: x.category })),
    harvests: harvestRows.map((x) => ({
      wetWeightG: x.wetWeightG,
      dryWeightG: x.dryWeightG,
      flushNumber: x.flushNumber,
      harvestedAt: x.harvestedAt,
    })),
    drySubstrateG,
    startedAt: batchRow[0]?.startedAt ?? null,
  });
}

r.get('/', async (c) => {
  const ws = c.var.workspace;
  const status = c.req.query('status');
  const where = status
    ? and(eq(batches.workspaceId, ws.id), eq(batches.status, status as never))
    : eq(batches.workspaceId, ws.id);
  const rows = await c.var.db
    .select()
    .from(batches)
    .where(where)
    .orderBy(desc(batches.createdAt));
  return c.json(rows);
});

r.post('/', zValidator('json', batchCreateSchema), async (c) => {
  const ws = c.var.workspace;
  const data = c.req.valid('json');
  if ((data.status ?? 'ACTIVE') === 'ACTIVE') {
    const usage = await getUsage(c.var.db, ws.id);
    await enforceLimit(c.var.db, ws, 'maxActiveBatches', usage.activeBatches);
  }
  const values = withDates(data, ['startedAt', 'completedAt']);
  const rows = await c.var.db
    .insert(batches)
    .values({
      ...values,
      workspaceId: ws.id,
      startedAt: values.startedAt ?? new Date(),
    })
    .returning();
  return c.json(rows[0], 201);
});

r.get('/:id', async (c) => {
  const ws = c.var.workspace;
  const id = c.req.param('id');
  const batchRows = await c.var.db
    .select()
    .from(batches)
    .where(and(eq(batches.id, id), eq(batches.workspaceId, ws.id)))
    .limit(1);
  const batch = batchRows[0];
  if (!batch) return c.json({ error: 'Not found' }, 404);

  const [cultureRows, harvestRows, costRows, strainRows, summary] = await Promise.all([
    c.var.db.select().from(cultures).where(eq(cultures.batchId, id)).orderBy(cultures.createdAt),
    c.var.db.select().from(harvests).where(eq(harvests.batchId, id)).orderBy(harvests.flushNumber),
    c.var.db
      .select()
      .from(costEntries)
      .where(eq(costEntries.batchId, id))
      .orderBy(desc(costEntries.occurredAt)),
    batch.strainId
      ? c.var.db.select().from(strains).where(eq(strains.id, batch.strainId)).limit(1)
      : Promise.resolve([]),
    summarize(c.var.db, ws.id, id),
  ]);

  return c.json({
    batch,
    strain: strainRows[0] ?? null,
    cultures: cultureRows,
    harvests: harvestRows,
    costs: costRows,
    summary,
  });
});

r.get('/:id/summary', async (c) => {
  const ws = c.var.workspace;
  const id = c.req.param('id');
  const exists = await c.var.db
    .select({ id: batches.id })
    .from(batches)
    .where(and(eq(batches.id, id), eq(batches.workspaceId, ws.id)))
    .limit(1);
  if (!exists[0]) return c.json({ error: 'Not found' }, 404);
  return c.json(await summarize(c.var.db, ws.id, id));
});

r.patch('/:id', zValidator('json', batchUpdateSchema), async (c) => {
  const ws = c.var.workspace;
  const values = withDates(c.req.valid('json'), ['startedAt', 'completedAt']);
  const rows = await c.var.db
    .update(batches)
    .set(values)
    .where(and(eq(batches.id, c.req.param('id')), eq(batches.workspaceId, ws.id)))
    .returning();
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json(rows[0]);
});

r.delete('/:id', async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .delete(batches)
    .where(and(eq(batches.id, c.req.param('id')), eq(batches.workspaceId, ws.id)))
    .returning({ id: batches.id });
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

export default r;
