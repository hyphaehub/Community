import { genericOAuthClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

const BASE = import.meta.env.VITE_API_URL ?? window.location.origin;

export const authClient = createAuthClient({
  baseURL: BASE,
  plugins: [genericOAuthClient()],
});

export const { useSession, signIn, signUp, signOut } = authClient;

/** Kick off the Auth0 (OIDC) login flow, returning to the app root when done. */
export function signInWithAuth0() {
  return authClient.signIn.oauth2({ providerId: 'auth0', callbackURL: '/' });
}

export interface AuthConfig {
  auth0Enabled: boolean;
  emailPasswordEnabled: boolean;
}

/** Ask the API which login methods this instance offers. */
export async function fetchAuthConfig(): Promise<AuthConfig> {
  try {
    const res = await fetch(`${BASE}/api/config`, { credentials: 'include' });
    if (res.ok) return (await res.json()) as AuthConfig;
  } catch {
    // fall through to default
  }
  return { auth0Enabled: false, emailPasswordEnabled: true };
}
