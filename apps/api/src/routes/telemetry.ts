import { zValidator } from '@hono/zod-validator';
import { installs } from '@hyphaehub/db';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types';

/**
 * Public, unauthenticated, anonymous telemetry sink. Self-hosted instances POST
 * a tiny ping here on boot and daily; we upsert one row per install id so the
 * platform can count real installs. Only an anonymous id + version are accepted;
 * no IP or anything identifying is stored.
 */
const r = new Hono<AppEnv>();

const pingSchema = z.object({
  installId: z.string().min(8).max(128),
  version: z.string().max(40).optional(),
  edition: z.string().max(40).optional(),
});

r.post('/', zValidator('json', pingSchema), async (c) => {
  const { installId, version } = c.req.valid('json');
  const now = new Date();
  await c.var.db
    .insert(installs)
    .values({
      installId,
      version: version ?? null,
      firstSeenAt: now,
      lastSeenAt: now,
      pingCount: 1,
    })
    .onConflictDoUpdate({
      target: installs.installId,
      set: {
        lastSeenAt: now,
        version: version ?? null,
        pingCount: sql`${installs.pingCount} + 1`,
      },
    });
  return c.json({ ok: true });
});

export default r;
