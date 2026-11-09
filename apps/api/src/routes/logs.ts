import { zValidator } from '@hono/zod-validator';
import { logEntryCreateSchema, logEntryUpdateSchema } from '@hyphaehub/core';
import { type HyphaeBatchItem, batches, logEntries, photos } from '@hyphaehub/db';
import { and, desc, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { withDates } from '../lib/dates';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();
r.use('*', requireAuth);

/** Confirm a batch belongs to this workspace (reject cross-workspace ids). */
async function batchInWorkspace(c: Context<AppEnv>, batchId: string) {
  const rows = await c.var.db
    .select({ id: batches.id })
    .from(batches)
    .where(and(eq(batches.id, batchId), eq(batches.workspaceId, c.var.workspace.id)))
    .limit(1);
  return !!rows[0];
}

// List journal entries, newest first. `?batchId=` scopes to one batch.
r.get('/', async (c) => {
  const ws = c.var.workspace;
  const batchId = c.req.query('batchId');
  const where = batchId
    ? and(eq(logEntries.workspaceId, ws.id), eq(logEntries.batchId, batchId))
    : eq(logEntries.workspaceId, ws.id);
  const rows = await c.var.db
    .select()
    .from(logEntries)
    .where(where)
    .orderBy(desc(logEntries.occurredAt));
  return c.json(rows);
});

r.post('/', zValidator('json', logEntryCreateSchema), async (c) => {
  const ws = c.var.workspace;
  const data = c.req.valid('json');
  if (data.batchId && !(await batchInWorkspace(c, data.batchId))) {
    return c.json({ error: 'Batch not found' }, 404);
  }
  const values = withDates(data, ['occurredAt']);
  const rows = await c.var.db
    .insert(logEntries)
    .values({
      ...values,
      workspaceId: ws.id,
      occurredAt: values.occurredAt ?? new Date(),
    })
    .returning();
  return c.json(rows[0], 201);
});

r.patch('/:id', zValidator('json', logEntryUpdateSchema), async (c) => {
  const ws = c.var.workspace;
  const data = c.req.valid('json');
  if (data.batchId && !(await batchInWorkspace(c, data.batchId))) {
    return c.json({ error: 'Batch not found' }, 404);
  }
  const values = withDates(data, ['occurredAt']);
  const rows = await c.var.db
    .update(logEntries)
    .set(values)
    .where(and(eq(logEntries.id, c.req.param('id')), eq(logEntries.workspaceId, ws.id)))
    .returning();
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json(rows[0]);
});

r.delete('/:id', async (c) => {
  const ws = c.var.workspace;
  const id = c.req.param('id');
  // Grab attached photo keys first so we can purge their bytes from storage.
  const attached = await c.var.db
    .select({ key: photos.key })
    .from(photos)
    .where(and(eq(photos.logEntryId, id), eq(photos.workspaceId, ws.id)));
  // Delete the photo rows and the entry atomically. Don't rely on the FK cascade
  // — self-host libSQL leaves foreign-key enforcement off by default, which would
  // otherwise orphan the photo rows (and their quota) here.
  const writes: [HyphaeBatchItem, HyphaeBatchItem] = [
    c.var.db.delete(photos).where(and(eq(photos.logEntryId, id), eq(photos.workspaceId, ws.id))),
    c.var.db
      .delete(logEntries)
      .where(and(eq(logEntries.id, id), eq(logEntries.workspaceId, ws.id)))
      .returning({ id: logEntries.id }),
  ];
  const results = await c.var.db.batch(writes);
  if (!(results[1] as { id: string }[])[0]) return c.json({ error: 'Not found' }, 404);
  await Promise.all(attached.map((p) => c.var.storage.delete(p.key).catch(() => {})));
  return c.json({ ok: true });
});

export default r;
