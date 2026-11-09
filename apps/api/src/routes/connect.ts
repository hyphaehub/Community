import { zValidator } from '@hono/zod-validator';
import { connectLinks } from '@hyphaehub/db';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import type { AppEnv } from '../types';

/**
 * Cloud Connect link registry. When the official cloud app connects to a user's
 * self-hosted instance it records the link here (against the user's CLOUD
 * session), so the platform admin can see, verify and revoke live connections.
 * Self-hosted instances expose the same routes but normally have no rows.
 */
const r = new Hono<AppEnv>();
r.use('*', requireAuth);

const normalizeUrl = (u: string) => u.trim().replace(/\/+$/, '');

const registerSchema = z.object({
  serverUrl: z.string().url().max(300),
  label: z.string().max(80).optional().nullable(),
});

/** Record (or refresh) the caller's link to a self-hosted instance. */
r.post('/', zValidator('json', registerSchema), async (c) => {
  const userId = c.var.user.id;
  const body = c.req.valid('json');
  const serverUrl = normalizeUrl(body.serverUrl);
  const label = body.label ?? null;
  const now = new Date();
  await c.var.db
    .insert(connectLinks)
    .values({ userId, serverUrl, label, lastSeenAt: now })
    .onConflictDoUpdate({
      target: [connectLinks.userId, connectLinks.serverUrl],
      set: { lastSeenAt: now, label },
    });
  const [row] = await c.var.db
    .select()
    .from(connectLinks)
    .where(and(eq(connectLinks.userId, userId), eq(connectLinks.serverUrl, serverUrl)))
    .limit(1);
  return c.json(row, 201);
});

/** The caller's own links. */
r.get('/', async (c) => {
  const rows = await c.var.db
    .select()
    .from(connectLinks)
    .where(eq(connectLinks.userId, c.var.user.id))
    .orderBy(desc(connectLinks.lastSeenAt));
  return c.json(rows);
});

/** Forget one of the caller's own links. */
r.delete('/:id', async (c) => {
  const rows = await c.var.db
    .delete(connectLinks)
    .where(and(eq(connectLinks.id, c.req.param('id')), eq(connectLinks.userId, c.var.user.id)))
    .returning({ id: connectLinks.id });
  if (!rows[0]) throw new HTTPException(404, { message: 'Link not found.' });
  return c.json({ ok: true });
});

export default r;
