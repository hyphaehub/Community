import { zValidator } from '@hono/zod-validator';
import { costEntryCreateSchema, costEntryUpdateSchema, rollupCosts } from '@hyphaehub/core';
import { costEntries } from '@hyphaehub/db';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { withDates } from '../lib/dates';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();
r.use('*', requireAuth);

r.get('/', async (c) => {
  const ws = c.var.workspace;
  const batchId = c.req.query('batchId');
  const where = batchId
    ? and(eq(costEntries.workspaceId, ws.id), eq(costEntries.batchId, batchId))
    : eq(costEntries.workspaceId, ws.id);
  const rows = await c.var.db
    .select()
    .from(costEntries)
    .where(where)
    .orderBy(desc(costEntries.occurredAt));
  const rollup = rollupCosts(rows.map((x) => ({ amountCents: x.amountCents, category: x.category })));
  return c.json({ entries: rows, ...rollup });
});

r.post('/', zValidator('json', costEntryCreateSchema), async (c) => {
  const values = withDates(c.req.valid('json'), ['occurredAt']);
  const rows = await c.var.db
    .insert(costEntries)
    .values({
      ...values,
      workspaceId: c.var.workspace.id,
      occurredAt: values.occurredAt ?? new Date(),
    })
    .returning();
  return c.json(rows[0], 201);
});

r.patch('/:id', zValidator('json', costEntryUpdateSchema), async (c) => {
  const ws = c.var.workspace;
  const values = withDates(c.req.valid('json'), ['occurredAt']);
  const rows = await c.var.db
    .update(costEntries)
    .set(values)
    .where(and(eq(costEntries.id, c.req.param('id')), eq(costEntries.workspaceId, ws.id)))
    .returning();
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json(rows[0]);
});

r.delete('/:id', async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .delete(costEntries)
    .where(and(eq(costEntries.id, c.req.param('id')), eq(costEntries.workspaceId, ws.id)))
    .returning({ id: costEntries.id });
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

export default r;
