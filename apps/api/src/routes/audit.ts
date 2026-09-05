import { auditLogs, user as userTable } from '@hyphaehub/db';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { requireAuth, requireOrgRole } from '../middleware/auth';
import type { AppEnv } from '../types';

const r = new Hono<AppEnv>();
r.use('*', requireAuth);
r.use('*', requireOrgRole('OWNER', 'ADMIN'));

/** Recent activity for the active organization. */
r.get('/', async (c) => {
  const ws = c.var.workspace;
  const limit = Math.min(Number(c.req.query('limit')) || 50, 200);
  const rows = await c.var.db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      status: auditLogs.status,
      summary: auditLogs.summary,
      createdAt: auditLogs.createdAt,
      actorEmail: userTable.email,
      actorName: userTable.name,
    })
    .from(auditLogs)
    .leftJoin(userTable, eq(userTable.id, auditLogs.userId))
    .where(eq(auditLogs.workspaceId, ws.id))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
  return c.json(rows);
});

export default r;
