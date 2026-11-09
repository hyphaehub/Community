import { useQuery } from '@tanstack/react-query';
import { genericOAuthClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import { api } from './api';
import { clearConnection, getConnection, normalizeServerUrl, setConnection } from './connection';

const BASE = import.meta.env.VITE_API_URL ?? window.location.origin;

export const authClient = createAuthClient({
  baseURL: BASE,
  plugins: [genericOAuthClient()],
});

export const { useSession, signIn, signUp, signOut } = authClient;

/** sessionStorage key holding a self-host URL awaiting a "connect to cloud" handoff. */
export const PENDING_CONNECT_KEY = 'hh_pending_connect';

/** Where to land after a cloud sign-in: resume a pending connect handoff, else home. */
export function postLoginTarget(): string {
  try {
    return sessionStorage.getItem(PENDING_CONNECT_KEY) ? '/connect' : '/';
  } catch {
    return '/';
  }
}

/** Kick off the Auth0 (OIDC) login flow, resuming a pending connect handoff if any. */
export function signInWithAuth0() {
  return authClient.signIn.oauth2({ providerId: 'auth0', callbackURL: postLoginTarget() });
}

export interface AuthConfig {
  auth0Enabled: boolean;
  emailPasswordEnabled: boolean;
  /** Whether object storage is configured, so photo uploads work. */
  photosEnabled: boolean;
  /** 'community' = self-hosted (shows the Connect-to-Cloud flow); 'cloud' = the hosted app. */
  edition: 'cloud' | 'community';
  /** The HyphaeHub Cloud base URL a self-hosted instance connects to. */
  cloudUrl: string;
}

/** Ask the API which login methods this instance offers. */
export async function fetchAuthConfig(): Promise<AuthConfig> {
  try {
    const res = await fetch(`${BASE}/api/config`, { credentials: 'include' });
    if (res.ok) return (await res.json()) as AuthConfig;
  } catch {
    // fall through to default
  }
  return {
    auth0Enabled: false,
    emailPasswordEnabled: true,
    photosEnabled: false,
    edition: 'cloud',
    cloudUrl: 'https://app.hyphaehub.io',
  };
}

/**
 * The active instance's runtime config (login methods + photo support), fetched
 * through the connection-aware request layer so it reflects the connected server.
 */
export function useInstanceConfig() {
  return useQuery({
    queryKey: ['instance-config'],
    queryFn: () => api.config(),
    staleTime: 5 * 60 * 1000,
  });
}

// ── Cloud Connect: auth against a self-hosted instance (bearer, cross-origin) ──

/** Which login methods a self-hosted server at `serverUrl` offers. */
export async function fetchAuthConfigFor(serverUrl: string): Promise<AuthConfig> {
  const base = normalizeServerUrl(serverUrl);
  const res = await fetch(`${base}/api/config`);
  if (!res.ok) throw new Error(`Could not reach ${base} (HTTP ${res.status})`);
  return (await res.json()) as AuthConfig;
}

/** Read the bearer token from a sign-in/up response (header, else body). */
async function tokenFromAuthResponse(res: Response): Promise<string> {
  if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`);
  const header = res.headers.get('set-auth-token');
  if (header) return header;
  const body = (await res.json().catch(() => ({}))) as { token?: string };
  if (body.token) return body.token;
  throw new Error('The server did not return an auth token (check CORS / bearer support).');
}

/** Sign in to a self-hosted server with email/password; stores the connection + token. */
export async function connectSignIn(
  serverUrl: string,
  email: string,
  password: string,
): Promise<void> {
  const base = normalizeServerUrl(serverUrl);
  const res = await fetch(`${base}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const token = await tokenFromAuthResponse(res);
  setConnection({ mode: 'connect', serverUrl: base, token });
}

/** Create an account on a self-hosted server; stores the connection + token. */
export async function connectSignUp(
  serverUrl: string,
  name: string,
  email: string,
  password: string,
): Promise<void> {
  const base = normalizeServerUrl(serverUrl);
  const res = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
  const token = await tokenFromAuthResponse(res);
  setConnection({ mode: 'connect', serverUrl: base, token });
}

/** Sign out of the current mode: drop the connection (connect) or the cookie (cloud). */
export async function appSignOut(): Promise<void> {
  if (getConnection().mode === 'connect') {
    clearConnection();
    return;
  }
  await signOut();
}

interface AppSession {
  data: { user: { id: string; email: string; name: string } } | null | undefined;
  isPending: boolean;
}

/**
 * Unified session across modes: better-auth cookie session in cloud mode, or a
 * bearer `/api/me` check against the self-hosted server in connect mode.
 */
export function useAppSession(): AppSession {
  const mode = getConnection().mode;
  const cloud = useSession();
  const connect = useQuery({
    queryKey: ['connect-session'],
    queryFn: () => api.me(),
    enabled: mode === 'connect',
    retry: false,
  });

  if (mode === 'connect') {
    if (connect.isLoading) return { data: undefined, isPending: true };
    return { data: connect.data ? { user: connect.data.user } : null, isPending: false };
  }
  return {
    data: cloud.isPending ? undefined : cloud.data ? { user: cloud.data.user } : null,
    isPending: cloud.isPending,
  };
}
