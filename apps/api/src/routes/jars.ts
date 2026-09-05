import { zValidator } from '@hono/zod-validator';
import { gramsToUnit, jarAssignSchema, jarCreateSchema, round } from '@hyphaehub/core';
import { batches, costEntries, cultures, inventoryItems } from '@hyphaehub/db';
import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { enforceLimit } from '../lib/workspace';
import { requireAuth, requireFeature } from '../middleware/auth';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();
r.use('*', requireAuth);
r.use('*', requireFeature('jars'));

/** The pool of unassigned jars: GRAIN cultures with no batch yet. */
r.get('/', async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .select()
    .from(cultures)
    .where(
      and(eq(cultures.workspaceId, ws.id), eq(cultures.type, 'GRAIN'), isNull(cultures.batchId)),
    );
  return c.json(rows);
});

/**
 * Create N sterilized grain jars (unassigned to a batch). If an inventory item
 * is given, the grain used (quantity × count) is drawn down and a cost entry is
 * recorded (from the item's unit cost, unless an explicit cost is supplied).
 */
r.post('/', zValidator('json', jarCreateSchema), async (c) => {
  const ws = c.var.workspace;
  const db = c.var.db;
  const body = c.req.valid('json');

  const [cur] = await db
    .select({ n: count() })
    .from(cultures)
    .where(eq(cultures.workspaceId, ws.id));
  await enforceLimit(db, ws, 'maxCultures', cur?.n ?? 0, body.count);

  // Grain per jar is entered in GRAMS; convert to the inventory item's own unit
  // (kg, lb, oz, g, …) for the draw-down and cost.
  const totalGrams = (body.quantity ?? 0) * body.count;
  let costCents = body.costCents ?? 0;
  const inventoryItemId = body.inventoryItemId ?? null;

  if (inventoryItemId) {
    const [item] = await db
      .select()
      .from(inventoryItems)
      .where(and(eq(inventoryItems.id, inventoryItemId), eq(inventoryItems.workspaceId, ws.id)))
      .limit(1);
    if (!item) throw new HTTPException(404, { message: 'Inventory item not found.' });
    if (totalGrams > 0) {
      // Convert grams → the item's unit. If the item isn't weight-based (e.g.
      // "bag"), we can't auto-convert, so skip the draw-down rather than guess.
      const deducted = gramsToUnit(totalGrams, item.unit);
      if (deducted != null) {
        await db
          .update(inventoryItems)
          .set({ quantityOnHand: round((item.quantityOnHand ?? 0) - deducted, 4) })
          .where(eq(inventoryItems.id, inventoryItemId));
        if (body.costCents === undefined) costCents = Math.round(deducted * item.unitCostCents);
      }
    }
  }

  const inoculatedAt = body.inoculatedAt ? new Date(body.inoculatedAt) : null;
  const prefix = body.labelPrefix ?? 'Jar';
  // Grain cost is held per-jar (not yet on a batch) and posted to the batch when
  // the jar is assigned. Distribute the total evenly, rounding the remainder onto
  // the first jars so the per-jar amounts sum back to the exact total.
  const base = costCents > 0 ? Math.floor(costCents / body.count) : 0;
  const remainder = costCents > 0 ? costCents - base * body.count : 0;
  const values = Array.from({ length: body.count }, (_, i) => ({
    workspaceId: ws.id,
    type: 'GRAIN' as const,
    label: `${prefix} ${i + 1}`,
    status: body.status,
    containerType: body.containerType,
    substrateType: body.grainType ?? null,
    quantity: body.quantity ?? null, // grams of grain per jar
    quantityUnit: 'g',
    strainId: body.strainId ?? null,
    batchId: null,
    costCents: costCents > 0 ? base + (i < remainder ? 1 : 0) : null,
    inoculatedAt,
  }));
  const jars = await db.insert(cultures).values(values).returning();

  return c.json({ jars, costCents, inventoryItemId }, 201);
});

/** Assign jars from the pool to a batch (sets their batchId). */
r.post('/assign', zValidator('json', jarAssignSchema), async (c) => {
  const ws = c.var.workspace;
  const db = c.var.db;
  const { batchId, jarIds } = c.req.valid('json');
  const [batch] = await db
    .select({ id: batches.id })
    .from(batches)
    .where(and(eq(batches.id, batchId), eq(batches.workspaceId, ws.id)))
    .limit(1);
  if (!batch) throw new HTTPException(404, { message: 'Batch not found.' });

  const scope = and(
    eq(cultures.workspaceId, ws.id),
    eq(cultures.type, 'GRAIN'),
    inArray(cultures.id, jarIds),
  );
  // Sum the pending grain cost of the jars being assigned, then attribute it to
  // the batch and clear it from the jars (so a later reassign never double-posts).
  const matching = await db.select({ costCents: cultures.costCents }).from(cultures).where(scope);
  const totalCost = matching.reduce((s, j) => s + (j.costCents ?? 0), 0);

  const updated = await db.update(cultures).set({ batchId, costCents: null }).where(scope).returning();

  let cost = null;
  if (totalCost > 0 && updated.length > 0) {
    const [entry] = await db
      .insert(costEntries)
      .values({
        workspaceId: ws.id,
        batchId,
        description: `Grain for ${updated.length} jar${updated.length === 1 ? '' : 's'}`,
        category: 'CONSUMABLE',
        amountCents: totalCost,
      })
      .returning();
    cost = entry ?? null;
  }
  return c.json({ assigned: updated.length, cost });
});

export default r;
