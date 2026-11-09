import {
  account,
  type HyphaeDB,
  memberships,
  session,
  user as userTable,
  verification,
  workspaces,
} from '@hyphaehub/db';
import { expo } from '@better-auth/expo';
import { betterAuth } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, genericOAuth } from 'better-auth/plugins';

/**
 * @better-auth/expo's "append the session cookie to the native redirect" hook
 * only matches the standard social-provider callback path (`/callback/*`). Auth0
 * runs through genericOAuth, whose callback is `/oauth2/callback/:providerId`, so
 * that hook never fires and the mobile app gets a redirect with no token. This
 * plugin mirrors the expo hook for the genericOAuth path: when the callback
 * redirects to a non-http (app-scheme) trusted origin, it moves the Set-Cookie
 * into a `cookie` query param the app can read. No-op for the web (https redirects).
 */
const expoGenericOAuthBridge = {
  id: 'expo-generic-oauth-bridge',
  hooks: {
    after: [
      {
        matcher: (context: { path?: string }) => !!context.path?.startsWith('/oauth2/callback'),
        handler: createAuthMiddleware(async (ctx) => {
          const headers = ctx.context.responseHeaders;
          const location = headers?.get('location');
          if (!location) return;
          let redirectURL: URL;
          try {
            redirectURL = new URL(location);
          } catch {
            return;
          }
          if (redirectURL.protocol === 'http:' || redirectURL.protocol === 'https:') return;
          if (!ctx.context.isTrustedOrigin(location)) return;
          const cookie = headers?.get('set-cookie');
          if (!cookie) return;
          redirectURL.searchParams.set('cookie', cookie);
          ctx.setHeader('location', redirectURL.toString());
        }),
      },
    ],
  },
};

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
  // `expo()` lets the native app complete OAuth: on a redirect to the app's
  // custom scheme (a trusted origin) it appends the session cookie so the app
  // can read the token. Harmless for the web (only acts on non-http redirects).
  const plugins: any[] = [bearer(), expo()];
  if (cfg.auth0) {
    plugins.push(expoGenericOAuthBridge);
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
