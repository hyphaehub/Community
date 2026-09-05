import { zValidator } from '@hono/zod-validator';
import { harvestCreateSchema, harvestUpdateSchema } from '@hyphaehub/core';
import { cultures, harvests } from '@hyphaehub/db';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { withDates } from '../lib/dates';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();
r.use('*', requireAuth);

r.get('/', async (c) => {
  const ws = c.var.workspace;
  const cultureId = c.req.query('cultureId');
  const batchId = c.req.query('batchId');
  const filters = [eq(harvests.workspaceId, ws.id)];
  if (cultureId) filters.push(eq(harvests.cultureId, cultureId));
  if (batchId) filters.push(eq(harvests.batchId, batchId));
  const rows = await c.var.db
    .select()
    .from(harvests)
    .where(and(...filters))
    .orderBy(asc(harvests.flushNumber));
  return c.json(rows);
});

r.post('/', zValidator('json', harvestCreateSchema), async (c) => {
  const ws = c.var.workspace;
  const data = c.req.valid('json');

  const owned = await c.var.db
    .select()
    .from(cultures)
    .where(and(eq(cultures.id, data.cultureId), eq(cultures.workspaceId, ws.id)))
    .limit(1);
  const culture = owned[0];
  if (!culture) return c.json({ error: 'Culture not found' }, 404);

  const values = withDates(data, ['harvestedAt', 'driedAt']);
  const rows = await c.var.db
    .insert(harvests)
    .values({
      ...values,
      workspaceId: ws.id,
      batchId: data.batchId ?? culture.batchId,
      harvestedAt: values.harvestedAt ?? new Date(),
    })
    .returning();

  // Advance the tub into the harvesting stage.
  if (culture.status !== 'HARVESTING') {
    await c.var.db.update(cultures).set({ status: 'HARVESTING' }).where(eq(cultures.id, culture.id));
  }

  return c.json(rows[0], 201);
});

r.patch('/:id', zValidator('json', harvestUpdateSchema), async (c) => {
  const ws = c.var.workspace;
  const values = withDates(c.req.valid('json'), ['harvestedAt', 'driedAt']);
  const rows = await c.var.db
    .update(harvests)
    .set(values)
    .where(and(eq(harvests.id, c.req.param('id')), eq(harvests.workspaceId, ws.id)))
    .returning();
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json(rows[0]);
});

r.delete('/:id', async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .delete(harvests)
    .where(and(eq(harvests.id, c.req.param('id')), eq(harvests.workspaceId, ws.id)))
    .returning({ id: harvests.id });
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

export default r;
