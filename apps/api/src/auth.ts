import {
  account,
  type HyphaeDB,
  memberships,
  session,
  user as userTable,
  verification,
  workspaces,
} from '@hyphaehub/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, genericOAuth } from 'better-auth/plugins';

export interface Auth0Config {
  domain: string;
  clientId: string;
  clientSecret: string;
}

export interface AuthConfig {
  secret: string;
  baseURL?: string;
  trustedOrigins?: string[];
  cookieDomain?: string;
  /** Enable email/password sign-in. Defaults to true when Auth0 is not set. */
  emailPassword?: boolean;
  /** When provided, Auth0 is offered as an OIDC login provider. */
  auth0?: Auth0Config;
}

/**
 * Build a better-auth instance backed by our Drizzle schema. Works on both
 * Cloudflare Workers (D1) and Node (libSQL). On sign-up (email/password OR the
 * first Auth0 login), a default workspace and owner membership are created so
 * every user lands in a usable state.
 */
export function createAuth(db: HyphaeDB, cfg: AuthConfig) {
  // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin array is heterogeneous
  const plugins: any[] = [bearer()];
  if (cfg.auth0) {
    plugins.push(
      genericOAuth({
        config: [
          {
            providerId: 'auth0',
            discoveryUrl: `https://${cfg.auth0.domain}/.well-known/openid-configuration`,
            clientId: cfg.auth0.clientId,
            clientSecret: cfg.auth0.clientSecret,
            scopes: ['openid', 'profile', 'email'],
          },
        ],
      }),
    );
  }

  const emailPasswordEnabled = cfg.emailPassword ?? !cfg.auth0;

  return betterAuth({
    secret: cfg.secret,
    baseURL: cfg.baseURL,
    trustedOrigins: cfg.trustedOrigins ?? [],
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: { user: userTable, session, account, verification },
    }),
    emailAndPassword: {
      enabled: emailPasswordEnabled,
      requireEmailVerification: false,
      autoSignIn: true,
      minPasswordLength: 8,
    },
    plugins,
    advanced: cfg.cookieDomain
      ? { crossSubDomainCookies: { enabled: true, domain: cfg.cookieDomain } }
      : undefined,
    databaseHooks: {
      user: {
        create: {
          after: async (u) => {
            const rows = await db
              .insert(workspaces)
              .values({ name: `${u.name || 'My'} Farm`, ownerUserId: u.id })
              .returning();
            const ws = rows[0];
            if (ws) {
              await db
                .insert(memberships)
                .values({ workspaceId: ws.id, userId: u.id, role: 'OWNER' });
            }
          },
        },
      },
    },
  });
}
