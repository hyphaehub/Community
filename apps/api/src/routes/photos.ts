import { photos } from '@hyphaehub/db';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { enforceLimit, getUsage } from '../lib/workspace';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();
r.use('*', requireAuth);

r.get('/', async (c) => {
  const ws = c.var.workspace;
  const cultureId = c.req.query('cultureId');
  const where = cultureId
    ? and(eq(photos.workspaceId, ws.id), eq(photos.cultureId, cultureId))
    : eq(photos.workspaceId, ws.id);
  const rows = await c.var.db.select().from(photos).where(where).orderBy(desc(photos.createdAt));
  return c.json(rows);
});

// Upload a photo (multipart/form-data with `file`).
r.post('/', async (c) => {
  const ws = c.var.workspace;
  const usage = await getUsage(c.var.db, ws.id);
  await enforceLimit(c.var.db, ws, 'maxPhotos', usage.photos);

  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: 'Expected a `file` field' }, 400);

  const key = `${ws.id}/${crypto.randomUUID()}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await c.var.storage.put(key, bytes, file.type);

  const rows = await c.var.db
    .insert(photos)
    .values({
      workspaceId: ws.id,
      cultureId: (body.cultureId as string) || null,
      eventId: (body.eventId as string) || null,
      harvestId: (body.harvestId as string) || null,
      key,
      caption: (body.caption as string) || null,
      contentType: file.type,
      sizeBytes: file.size,
    })
    .returning();
  return c.json(rows[0], 201);
});

// Stream a photo's bytes.
r.get('/:id/raw', async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .select()
    .from(photos)
    .where(and(eq(photos.id, c.req.param('id')), eq(photos.workspaceId, ws.id)))
    .limit(1);
  const photo = rows[0];
  if (!photo) return c.json({ error: 'Not found' }, 404);
  const object = await c.var.storage.get(photo.key);
  if (!object) return c.json({ error: 'File missing' }, 404);
  return new Response(object.body, {
    headers: { 'content-type': photo.contentType ?? object.contentType ?? 'application/octet-stream' },
  });
});

r.delete('/:id', async (c) => {
  const ws = c.var.workspace;
  const rows = await c.var.db
    .delete(photos)
    .where(and(eq(photos.id, c.req.param('id')), eq(photos.workspaceId, ws.id)))
    .returning();
  const photo = rows[0];
  if (!photo) return c.json({ error: 'Not found' }, 404);
  await c.var.storage.delete(photo.key).catch(() => {});
  return c.json({ ok: true });
});

export default r;
