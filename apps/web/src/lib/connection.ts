/**
 * Client connection mode. In **cloud** mode the app talks to its own origin with
 * cookie auth (better-auth) as usual. In **connect** mode (Cloud Connect) it
 * talks to a user's self-hosted instance at `serverUrl` using bearer-token auth
 * (which works cross-origin, unlike cookies). Persisted in localStorage.
 */
export type ConnectionMode = 'cloud' | 'connect';

export interface Connection {
  mode: ConnectionMode;
  serverUrl: string;
  token: string | null;
}

const KEY = 'hh_connection';
const DEFAULT: Connection = { mode: 'cloud', serverUrl: '', token: null };

export function getConnection(): Connection {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT, ...(JSON.parse(raw) as Partial<Connection>) };
  } catch {
    // ignore malformed / unavailable storage
  }
  return DEFAULT;
}

export function setConnection(c: Connection): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // ignore
  }
}

export function clearConnection(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** Strip a trailing slash so `${base}/api/...` is always well-formed. */
export function normalizeServerUrl(u: string): string {
  return u.trim().replace(/\/+$/, '');
}

/** Request base URL: '' (same-origin) in cloud mode, the server URL in connect mode. */
export function apiBase(): string {
  const c = getConnection();
  return c.mode === 'connect' ? c.serverUrl : '';
}

/** Bearer token to send, or null in cloud mode (which uses cookies). */
export function bearerToken(): string | null {
  const c = getConnection();
  return c.mode === 'connect' ? c.token : null;
}

export function isConnectMode(): boolean {
  return getConnection().mode === 'connect';
}
