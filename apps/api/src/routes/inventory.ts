import { zValidator } from '@hono/zod-validator';
import { inventoryItemCreateSchema, inventoryItemUpdateSchema } from '@hyphaehub/core';
import { inventoryItems } from '@hyphaehub/db';
import { and, asc, eq } from 'drizzle-orm';
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
