import type { D1Database, KVNamespace, R2Bucket } from '@cloudflare/workers-types';
import type { MembershipRole } from '@hyphaehub/core';
import type { HyphaeDB, Workspace } from '@hyphaehub/db';
import type { createAuth } from './auth';
import type { Storage } from './storage';

/** Runtime bindings (Cloudflare Worker) / env (Node self-host). */
export interface Env {
  DB: D1Database;
  PHOTOS?: R2Bucket;
  SESSIONS?: KVNamespace;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL?: string;
  APP_URL?: string;
  SITE_URL?: string;
  COOKIE_DOMAIN?: string;
  // Stripe billing (namespaced like the Auth0 vars). Billing is disabled until
  // the secret key + price IDs are set.
  HYPHAE_STRIPE_SECRET_KEY?: string;
  HYPHAE_STRIPE_WEBHOOK_SECRET?: string;
  HYPHAE_STRIPE_PRICE_PRO?: string;
  HYPHAE_STRIPE_PRICE_FARM?: string;
  // Auth0 (OIDC). When these are set, Auth0 becomes the login provider and
  // email/password is disabled unless EMAIL_PASSWORD_AUTH === 'true'.
  HYPHAE_AUTH0_DOMAIN?: string;
  HYPHAE_AUTH0_CLIENT_ID?: string;
  HYPHAE_AUTH0_CLIENT_SECRET?: string;
  EMAIL_PASSWORD_AUTH?: string;
  /** Email address granted super-admin (compared case-insensitively). */
  SUPER_ADMIN_EMAIL?: string;
}

export type Auth = ReturnType<typeof createAuth>;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

/** Per-request context populated by the platform + auth middleware. */
export interface Variables {
  db: HyphaeDB;
  auth: Auth;
  storage: Storage;
  user: AuthUser;
  /** The active organization (a.k.a. farm / workspace) for this request. */
  workspace: Workspace;
  /** The user's role within the active organization. */
  membershipRole: MembershipRole;
  /** True when the authenticated user is the platform super admin. */
  isSuperAdmin: boolean;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
