import { zValidator } from '@hono/zod-validator';
import {
  inventoryAdjustSchema,
  inventoryItemCreateSchema,
  inventoryItemUpdateSchema,
  round,
} from '@hyphaehub/core';
import { type HyphaeBatchItem, inventoryAdjustments, inventoryItems } from '@hyphaehub/db';
import { and, asc, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();
r.use('*', requireAuth);

r.get('/', async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.workspaceId, ws.id))
    .orderBy(asc(inventoryItems.name));
  return c.json(rows);
});

r.post('/', zValidator('json', inventoryItemCreateSchema), async (c) => {
  const rows = await c.var.db
    .insert(inventoryItems)
    .values({ ...c.req.valid('json'), workspaceId: c.var.workspace.id })
    .returning();
  return c.json(rows[0], 201);
});

r.patch('/:id', zValidator('json', inventoryItemUpdateSchema), async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .update(inventoryItems)
    .set(c.req.valid('json'))
    .where(and(eq(inventoryItems.id, c.req.param('id')), eq(inventoryItems.workspaceId, ws.id)))
    .returning();
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json(rows[0]);
});

// Adjust stock: restock (+delta), or record a loss / usage / correction (−delta).
// The quantity change and its ledger entry are written atomically so the audit
// trail can never disagree with the stock on hand.
r.post('/:id/adjust', zValidator('json', inventoryAdjustSchema), async (c) => {
  const ws = c.var.workspace;
  const db = c.var.db;
  const body = c.req.valid('json');
  const [item] = await db
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, c.req.param('id')), eq(inventoryItems.workspaceId, ws.id)))
    .limit(1);
  if (!item) return c.json({ error: 'Not found' }, 404);
  const next = round((item.quantityOnHand ?? 0) + body.delta, 4);
  const writes: HyphaeBatchItem[] = [
    db.update(inventoryItems).set({ quantityOnHand: next }).where(eq(inventoryItems.id, item.id)).returning(),
    db.insert(inventoryAdjustments).values({
      workspaceId: ws.id,
      inventoryItemId: item.id,
      delta: body.delta,
      balanceAfter: next,
      kind: body.kind,
      reason: body.reason ?? null,
      note: body.note ?? null,
    }),
  ];
  const results = await db.batch(writes as [HyphaeBatchItem, ...HyphaeBatchItem[]]);
  return c.json((results[0] as (typeof inventoryItems.$inferSelect)[])[0]);
});

// Adjustment history (audit ledger) for one item, newest first.
r.get('/:id/adjustments', async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .select()
    .from(inventoryAdjustments)
    .where(
      and(
        eq(inventoryAdjustments.inventoryItemId, c.req.param('id')),
        eq(inventoryAdjustments.workspaceId, ws.id),
      ),
    )
    .orderBy(desc(inventoryAdjustments.createdAt))
    .limit(50);
  return c.json(rows);
});

r.delete('/:id', async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .delete(inventoryItems)
    .where(and(eq(inventoryItems.id, c.req.param('id')), eq(inventoryItems.workspaceId, ws.id)))
    .returning({ id: inventoryItems.id });
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

export default r;
