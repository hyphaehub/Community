import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  exportWorkspace,
  fingerprintWorkspace,
  importWorkspace,
  isWorkspaceArchive,
} from '../lib/transfer';
import { requireAuth, requireOrgRole } from '../middleware/auth';
import type { AppEnv } from '../types';

/**
 * Workspace transfer — move a workspace's data between the cloud and a
 * self-hosted instance (either direction). Export here, import there.
 */
const r = new Hono<AppEnv>();
r.use('*', requireAuth);

/** Export the active workspace as a portable archive. Owner/admin only. */
r.get('/export', requireOrgRole('OWNER', 'ADMIN'), async (c) => {
  const ws = c.var.workspace;
  const includePhotos = c.req.query('photos') !== '0';
  const archive = await exportWorkspace(c.var.db, c.var.storage, ws, { includePhotos });
  const slug =
    ws.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'workspace';
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(archive), {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="hyphaehub-${slug}-${date}.json"`,
    },
  });
});

/** The active workspace's current fingerprint (for 1:1 verification). Owner/admin. */
r.get('/fingerprint', requireOrgRole('OWNER', 'ADMIN'), async (c) => {
  return c.json(await fingerprintWorkspace(c.var.db, c.var.workspace.id));
});

/** Import an archive into a NEW workspace owned by the caller. */
r.post('/import', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, {
      message: 'Expected a JSON export archive in the request body.',
    });
  }
  if (!isWorkspaceArchive(body)) {
    throw new HTTPException(400, { message: 'This file is not a HyphaeHub export archive.' });
  }
  try {
    const result = await importWorkspace(c.var.db, c.var.storage, c.var.user.id, body);
    return c.json(result, 201);
  } catch (err) {
    throw new HTTPException(422, {
      message: err instanceof Error ? err.message : 'Import failed.',
    });
  }
});

export default r;
