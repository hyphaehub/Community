import { events, cultures, harvests, logEntries, photos } from '@hyphaehub/db';
import { and, desc, eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, safeImageContentType } from '../lib/images';
import { enforceLimit, getUsage } from '../lib/workspace';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();
r.use('*', requireAuth);

/** Parent tables a photo may attach to; each is validated against the workspace. */
const PARENTS = {
  cultureId: cultures,
  eventId: events,
  harvestId: harvests,
  logEntryId: logEntries,
} as const;

/** True if a row with `id` exists in `table` within the current workspace. */
async function ownsRow(
  c: Context<AppEnv>,
  table: (typeof PARENTS)[keyof typeof PARENTS],
  id: string,
): Promise<boolean> {
  const rows = await c.var.db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.workspaceId, c.var.workspace.id)))
    .limit(1);
  return !!rows[0];
}

r.get('/', async (c) => {
  const ws = c.var.workspace;
  const cultureId = c.req.query('cultureId');
  const logEntryId = c.req.query('logEntryId');
  const filters = [eq(photos.workspaceId, ws.id)];
  if (cultureId) filters.push(eq(photos.cultureId, cultureId));
  if (logEntryId) filters.push(eq(photos.logEntryId, logEntryId));
  const rows = await c.var.db
    .select()
    .from(photos)
    .where(and(...filters))
    .orderBy(desc(photos.createdAt));
  return c.json(rows);
});

// Upload a photo (multipart/form-data with `file`).
r.post('/', async (c) => {
  const ws = c.var.workspace;
  // Fail cleanly (not a 500) when this instance has no object storage configured.
  if (!c.var.storage.enabled) {
    return c.json({ error: 'Photo storage is not configured on this instance' }, 400);
  }
  const usage = await getUsage(c.var.db, ws.id);
  await enforceLimit(c.var.db, ws, 'maxPhotos', usage.photos);

  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: 'Expected a `file` field' }, 400);
  // Only accept raster images (never HTML/SVG — these are served from the API
  // origin and would otherwise be a stored-XSS vector), and cap the size.
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return c.json({ error: 'Only JPEG, PNG, WebP, GIF, AVIF, or HEIC images are allowed' }, 415);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return c.json({ error: 'Image is too large (max 15 MB)' }, 413);
  }

  // Validate every supplied parent id belongs to this workspace (reject cross-
  // workspace / dangling references before we write anything).
  const links: {
    cultureId: string | null;
    eventId: string | null;
    harvestId: string | null;
    logEntryId: string | null;
  } = {
    cultureId: (body.cultureId as string) || null,
    eventId: (body.eventId as string) || null,
    harvestId: (body.harvestId as string) || null,
    logEntryId: (body.logEntryId as string) || null,
  };
  for (const [field, table] of Object.entries(PARENTS)) {
    const id = links[field as keyof typeof links];
    if (id && !(await ownsRow(c, table, id))) {
      return c.json({ error: `Unknown ${field}` }, 404);
    }
  }

  const key = `${ws.id}/${crypto.randomUUID()}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await c.var.storage.put(key, bytes, file.type);

  const rows = await c.var.db
    .insert(photos)
    .values({
      workspaceId: ws.id,
      ...links,
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
  // Harden the response: only serve a known raster image type, forbid MIME
  // sniffing, and sandbox — so a stored file can never execute as a document.
  return new Response(object.body, {
    headers: {
      'content-type': safeImageContentType(photo.contentType ?? object.contentType),
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, max-age=3600',
    },
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
