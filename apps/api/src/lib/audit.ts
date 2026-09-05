import { auditLogs } from '@hyphaehub/db';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../types';

const RESOURCE: Record<string, string> = {
  batches: 'batch',
  cultures: 'culture',
  harvests: 'harvest',
  events: 'event',
  inventory: 'inventory-item',
  costs: 'cost',
  strains: 'strain',
  orgs: 'organization',
  jars: 'jar',
  photos: 'photo',
  workspace: 'workspace',
  billing: 'billing',
  admin: 'admin',
};

const SUBACTIONS = new Set([
  'split',
  'combine',
  'assign',
  'members',
  'features',
  'categories',
  'workspaces',
  'checkout',
  'portal',
]);

export interface DerivedAction {
  action: string;
  entityType: string;
  entityId: string | null;
  label: string;
}

/** Turn an HTTP method + path into a readable audit action. Best-effort. */
export function deriveAction(method: string, path: string): DerivedAction {
  const seg = (path.split('?')[0] ?? '').split('/').filter(Boolean); // e.g. api/cultures/abc/split
  const resource = seg[1] ?? 'unknown';
  const rest = seg.slice(2);
  let entityId: string | null = null;
  const subs: string[] = [];
  for (const s of rest) {
    if (SUBACTIONS.has(s)) subs.push(s);
    else entityId = s;
  }
  const verb = method === 'POST' ? 'create' : method === 'DELETE' ? 'delete' : 'update';
  const entityType = RESOURCE[resource] ?? resource;
  let action = `${entityType}.${verb}`;
  let label = `${cap(verb)}d ${entityType.replace(/-/g, ' ')}`;

  if (subs.includes('split')) {
    action = 'culture.split';
    label = 'Split a source into jars';
  } else if (subs.includes('combine')) {
    action = 'culture.combine';
    label = 'Combined jars into a tub';
  } else if (subs.includes('assign')) {
    action = 'jar.assign';
    label = 'Assigned jars to a batch';
  } else if (subs.includes('members')) {
    action = `member.${verb === 'create' ? 'add' : verb}`;
    label = `${verb === 'create' ? 'Added' : verb === 'delete' ? 'Removed' : 'Updated'} a member`;
  } else if (subs.includes('features')) {
    action = resource === 'admin' ? 'platform.feature' : 'org.feature';
    label = 'Updated feature settings';
  } else if (subs.includes('categories')) {
    action = `strain-category.${verb}`;
    label = `${verb === 'create' ? 'Added' : 'Removed'} a strain category`;
  } else if (resource === 'admin' && subs.includes('workspaces')) {
    action = 'admin.plan';
    label = 'Changed an organization plan';
  }

  return { action, entityType, entityId, label };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Records every authenticated mutating request (POST/PATCH/PUT/DELETE) to the
 * audit log, attributed to the acting user and active org. Runs after the route
 * so it can capture the response status; never throws (audit must not break a
 * request). Read-only requests and /api/auth traffic are skipped.
 */
export const auditMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  try {
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
    const path = new URL(c.req.url).pathname;
    if (!path.startsWith('/api') || path.startsWith('/api/auth')) return;
    const user = c.get('user');
    if (!user) return; // only record authenticated actions
    const { action, entityType, entityId, label } = deriveAction(method, path);
    await c.var.db.insert(auditLogs).values({
      workspaceId: c.get('workspace')?.id ?? null,
      userId: user.id,
      action,
      entityType,
      entityId,
      status: c.res.status,
      summary: label,
      metadata: { method, path },
    });
  } catch {
    // swallow — auditing must never affect the response
  }
});
