import { zValidator } from '@hono/zod-validator';
import { type CultureStatus, eventCreateSchema } from '@hyphaehub/core';
import { cultures, events } from '@hyphaehub/db';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { toDate } from '../lib/dates';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();
r.use('*', requireAuth);

r.get('/', async (c) => {
  const ws = c.var.workspace;
  const cultureId = c.req.query('cultureId');
  const where = cultureId
    ? and(eq(events.workspaceId, ws.id), eq(events.cultureId, cultureId))
    : eq(events.workspaceId, ws.id);
  const rows = await c.var.db.select().from(events).where(where).orderBy(desc(events.occurredAt));
  return c.json(rows);
});

r.post('/', zValidator('json', eventCreateSchema), async (c) => {
  const ws = c.var.workspace;
  const data = c.req.valid('json');

  // Ownership check on the referenced culture.
  const owned = await c.var.db
    .select()
    .from(cultures)
    .where(and(eq(cultures.id, data.cultureId), eq(cultures.workspaceId, ws.id)))
    .limit(1);
  const culture = owned[0];
  if (!culture) return c.json({ error: 'Culture not found' }, 404);

  const occurredAt = toDate(data.occurredAt) ?? new Date();
  const rows = await c.var.db
    .insert(events)
    .values({
      workspaceId: ws.id,
      cultureId: data.cultureId,
      batchId: culture.batchId,
      type: data.type,
      occurredAt,
      note: data.note,
      data: data.data ?? undefined,
    })
    .returning();

  // Derive lifecycle side-effects from the event.
  const patch: Partial<{
    status: CultureStatus;
    colonizationPct: number;
    colonizedAt: Date;
    fruitingStartedAt: Date;
    inoculatedAt: Date;
  }> = {};
  switch (data.type) {
    case 'INOCULATION':
      if (culture.status === 'PREPPING') patch.status = 'INOCULATED';
      patch.inoculatedAt = occurredAt;
      break;
    case 'COLONIZATION_CHECK': {
      const pct = Number((data.data as { colonizationPct?: number } | undefined)?.colonizationPct);
      if (!Number.isNaN(pct)) {
        patch.colonizationPct = pct;
        patch.status = pct >= 100 ? 'COLONIZED' : 'COLONIZING';
        if (pct >= 100) patch.colonizedAt = occurredAt;
      } else if (culture.status === 'INOCULATED') {
        patch.status = 'COLONIZING';
      }
      break;
    }
    case 'CONTAMINATION':
      patch.status = 'CONTAMINATED';
      break;
    case 'FRUITING_CONDITIONS':
    case 'PINNING':
      patch.status = 'FRUITING';
      patch.fruitingStartedAt = culture.fruitingStartedAt ?? occurredAt;
      break;
    case 'HARVEST':
      patch.status = 'HARVESTING';
      break;
    case 'STORED':
      patch.status = 'STORED';
      break;
  }
  if (Object.keys(patch).length > 0) {
    await c.var.db.update(cultures).set(patch).where(eq(cultures.id, culture.id));
  }

  return c.json(rows[0], 201);
});

r.delete('/:id', async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .delete(events)
    .where(and(eq(events.id, c.req.param('id')), eq(events.workspaceId, ws.id)))
    .returning({ id: events.id });
  if (!rows[0]) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

export default r;
