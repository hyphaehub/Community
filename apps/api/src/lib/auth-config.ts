import type { Auth0Config } from '../auth';

export interface AuthEnvLike {
  HYPHAE_AUTH0_DOMAIN?: string;
  HYPHAE_AUTH0_CLIENT_ID?: string;
  HYPHAE_AUTH0_CLIENT_SECRET?: string;
  EMAIL_PASSWORD_AUTH?: string;
}

export interface ResolvedAuthConfig {
  /** Present only when all three Auth0 vars are set. */
  auth0?: Auth0Config;
  auth0Enabled: boolean;
  emailPasswordEnabled: boolean;
}

/**
 * Single source of truth for which auth methods an instance offers. Used by the
 * Worker platform, the Node self-host server, AND the public /api/config endpoint
 * so the login screen can never advertise a method the server did not enable.
 * Auth0 requires ALL THREE vars (domain, client id, client secret); email/
 * password is on when explicitly forced, otherwise on only if Auth0 is off.
 */
export function resolveAuthConfig(env: AuthEnvLike): ResolvedAuthConfig {
  const auth0 =
    env.HYPHAE_AUTH0_DOMAIN && env.HYPHAE_AUTH0_CLIENT_ID && env.HYPHAE_AUTH0_CLIENT_SECRET
      ? {
          domain: env.HYPHAE_AUTH0_DOMAIN,
          clientId: env.HYPHAE_AUTH0_CLIENT_ID,
          clientSecret: env.HYPHAE_AUTH0_CLIENT_SECRET,
        }
      : undefined;
  const auth0Enabled = Boolean(auth0);
  const emailPasswordEnabled = env.EMAIL_PASSWORD_AUTH === 'true' ? true : !auth0Enabled;
  return { auth0, auth0Enabled, emailPasswordEnabled };
}
