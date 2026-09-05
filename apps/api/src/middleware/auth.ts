import type { FeatureKey, MembershipRole } from '@hyphaehub/core';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../types';
import { resolveAuthConfig } from '../lib/auth-config';
import { getFeaturesForWorkspace } from '../lib/features';
import { resolveActiveWorkspace } from '../lib/workspace';

/** Whether an email is the configured super admin (case-insensitive). */
export function isSuperAdminEmail(email: string | undefined, superAdminEmail?: string): boolean {
  if (!email || !superAdminEmail) return false;
  return email.trim().toLowerCase() === superAdminEmail.trim().toLowerCase();
}

/**
 * Require a valid session (Auth0/OIDC or email-password; cookie or bearer token).
 * Populates the request context with the user, their active workspace, and
 * whether they are the super admin.
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const result = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  if (!result?.user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  c.set('user', {
    id: result.user.id,
    email: result.user.email,
    name: result.user.name,
  });
  // Super admin = email match. When Auth0 is the provider we additionally require
  // a verified email (so a stray unverified sign-up can't claim the address to
  // escalate). On email/password self-host there is no verification flow, so the
  // env-controlled email match alone is authoritative.
  const emailVerified = Boolean((result.user as { emailVerified?: boolean }).emailVerified);
  const { auth0Enabled } = resolveAuthConfig(c.env);
  const emailMatches = isSuperAdminEmail(result.user.email, c.env.SUPER_ADMIN_EMAIL);
  c.set('isSuperAdmin', emailMatches && (!auth0Enabled || emailVerified));

  // Active organization: chosen via X-Workspace-Id, membership-enforced.
  const requestedWs = c.req.header('x-workspace-id')?.trim() || undefined;
  const active = await resolveActiveWorkspace(c.var.db, result.user.id, requestedWs);
  c.set('workspace', active.workspace);
  c.set('membershipRole', active.role);
  await next();
});

/**
 * Require the platform super admin. Must run after `requireAuth`. 403 otherwise.
 */
export const requireSuperAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.isSuperAdmin) {
    throw new HTTPException(403, { message: 'Super admin access required.' });
  }
  await next();
});

/**
 * Require one of the given roles within the active organization. Must run after
 * `requireAuth`. The platform super admin always passes.
 */
export function requireOrgRole(...roles: MembershipRole[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!c.var.isSuperAdmin && !roles.includes(c.var.membershipRole)) {
      throw new HTTPException(403, {
        message: `This action requires role: ${roles.join(' or ')}.`,
      });
    }
    await next();
  });
}

/**
 * Require a feature flag to be enabled for the active organization. Must run
 * after `requireAuth`. Returns 404 (feature hidden) when disabled.
 */
export function requireFeature(key: FeatureKey) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const features = await getFeaturesForWorkspace(c.var.db, c.var.workspace);
    if (!features[key]) {
      throw new HTTPException(404, { message: 'This feature is not enabled for this organization.' });
    }
    await next();
  });
}
