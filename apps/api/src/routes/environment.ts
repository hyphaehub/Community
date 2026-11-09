import { zValidator } from '@hono/zod-validator';
import { environmentReadingCreateSchema } from '@hyphaehub/core';
import { batches, cultures, environmentReadings } from '@hyphaehub/db';
import { and, asc, desc, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { withDates } from '../lib/dates';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();
r.use('*', requireAuth);

async function ownsRow(c: Context<AppEnv>, table: typeof batches | typeof cultures, id: string) {
  const rows = await c.var.db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.workspaceId, c.var.workspace.id)))
    .limit(1);
  return !!rows[0];
}

// List readings. `?batchId=` scopes to one batch; ordered oldest→newest for charts.
r.get('/', async (c) => {
  const ws = c.var.workspace;
  const batchId = c.req.query('batchId');
  const where = batchId
    ? and(eq(environmentReadings.workspaceId, ws.id), eq(environmentReadings.batchId, batchId))
    : eq(environmentReadings.workspaceId, ws.id);
  const rows = await c.var.db
    .select()
    .from(environmentReadings)
    .where(where)
    .orderBy(batchId ? asc(environmentReadings.recordedAt) : desc(environmentReadings.recordedAt));
  return c.json(rows);
});

r.post('/', zValidator('json', environmentReadingCreateSchema), async (c) => {
  const ws = c.var.workspace;
  const data = c.req.valid('json');
  if (data.batchId && !(await ownsRow(c, batches, data.batchId))) {
    return c.json({ error: 'Batch not found' }, 404);
  }
  if (data.cultureId && !(await ownsRow(c, cultures, data.cultureId))) {
    return c.json({ error: 'Culture not found' }, 404);
  }
  const values = withDates(data, ['recordedAt']);
  const rows = await c.var.db
    .insert(environmentReadings)
    .values({ ...values, workspaceId: ws.id, recordedAt: values.recordedAt ?? new Date() })
    .returning();
  return c.json(rows[0], 201);
});

r.delete('/:id', async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .delete(environmentReadings)
    .where(
      and(
        eq(environmentReadings.id, c.req.param('id')),
        eq(environmentReadings.workspaceId, ws.id),
      ),
    )
    .returning({ id: environmentReadings.id });
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

export default r;
