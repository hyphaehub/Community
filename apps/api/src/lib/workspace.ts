import { checkLimit, type MembershipRole, type Plan, PLAN_LIMITS } from '@hyphaehub/core';
import {
  batches,
  cultures,
  type HyphaeDB,
  memberships,
  photos,
  type Workspace,
  workspaces,
} from '@hyphaehub/db';
import { and, asc, count, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';

export interface OrgMembership {
  workspace: Workspace;
  role: MembershipRole;
}

/** Every organization (farm) the user belongs to, oldest first, with their role. */
export async function listUserOrgs(db: HyphaeDB, userId: string): Promise<OrgMembership[]> {
  const rows = await db
    .select({ ws: workspaces, role: memberships.role })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt));
  return rows.map((r) => ({ workspace: r.ws, role: r.role }));
}

/**
 * Resolve the active organization for a request. A user can belong to many orgs;
 * `requestedId` (from the X-Workspace-Id header) selects one, and membership is
 * enforced. With no request, the oldest membership is used. A user with no
 * membership at all gets a personal farm created lazily.
 */
export async function resolveActiveWorkspace(
  db: HyphaeDB,
  userId: string,
  requestedId?: string,
): Promise<OrgMembership> {
  if (requestedId) {
    const [m] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, requestedId)))
      .limit(1);
    if (!m) throw new HTTPException(403, { message: 'You are not a member of this organization.' });
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, requestedId)).limit(1);
    if (!ws) throw new HTTPException(404, { message: 'Organization not found.' });
    return { workspace: ws, role: m.role };
  }

  const orgs = await listUserOrgs(db, userId);
  if (orgs[0]) return orgs[0];

  // No memberships yet — create a personal farm.
  const created = await db
    .insert(workspaces)
    .values({ name: 'My Farm', ownerUserId: userId })
    .returning();
  const ws = created[0];
  if (!ws) throw new HTTPException(500, { message: 'Failed to create organization' });
  await db.insert(memberships).values({ workspaceId: ws.id, userId, role: 'OWNER' });
  return { workspace: ws, role: 'OWNER' };
}

export interface Usage {
  activeBatches: number;
  cultures: number;
  photos: number;
}

/** Current resource usage for a workspace. */
export async function getUsage(db: HyphaeDB, workspaceId: string): Promise<Usage> {
  const [ab] = await db
    .select({ n: count() })
    .from(batches)
    .where(and(eq(batches.workspaceId, workspaceId), eq(batches.status, 'ACTIVE')));
  const [cu] = await db
    .select({ n: count() })
    .from(cultures)
    .where(eq(cultures.workspaceId, workspaceId));
  const [ph] = await db
    .select({ n: count() })
    .from(photos)
    .where(eq(photos.workspaceId, workspaceId));
  return { activeBatches: ab?.n ?? 0, cultures: cu?.n ?? 0, photos: ph?.n ?? 0 };
}

type LimitKey = 'maxActiveBatches' | 'maxCultures' | 'maxPhotos';

/** Throw a 402 if adding `adding` more of a resource would exceed the plan limit. */
export async function enforceLimit(
  db: HyphaeDB,
  ws: Workspace,
  key: LimitKey,
  current: number,
  adding = 1,
): Promise<void> {
  const plan = ws.plan as Plan;
  const check = checkLimit(plan, key, current + adding - 1);
  if (!check.allowed) {
    throw new HTTPException(402, {
      message: check.message ?? `Plan limit reached (${PLAN_LIMITS[plan].label}).`,
    });
  }
}
