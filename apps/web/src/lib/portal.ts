import type { DibCreateInput } from '@hyphaehub/core';
import { ApiError, extractError } from './api';
import type {
  DibWithRefs,
  PortalMe,
  PortalSession,
  StorefrontResponse,
  VoteCandidate,
} from './types';

// Buyer (purchaser) storefront client. Separate from the farm-staff auth: buyers
// hold their own long-lived session token (from a magic link), stored locally.
const KEY = 'hh_buyer_session';
const BASE = import.meta.env.VITE_API_URL ?? '';

export function getBuyerToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function setBuyerToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    // ignore unavailable storage
  }
}

async function preq<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  if (typeof opts.body === 'string' && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const token = getBuyerToken();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const res = await fetch(BASE + path, { ...opts, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, extractError(data, res));
  return data as T;
}

export const portalApi = {
  /** Exchange a magic-link token for a session (does not use the stored token). */
  session: (token: string) =>
    preq<PortalSession>('/api/portal/session', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  me: () => preq<PortalMe>('/api/portal/me'),
  storefront: () => preq<StorefrontResponse>('/api/portal/storefront'),
  dibs: () => preq<DibWithRefs[]>('/api/portal/dibs'),
  callDibs: (b: DibCreateInput) =>
    preq<DibWithRefs>('/api/portal/dibs', { method: 'POST', body: JSON.stringify(b) }),
  cancelDib: (id: string) => preq(`/api/portal/dibs/${id}/cancel`, { method: 'POST' }),
  votes: () => preq<{ candidates: VoteCandidate[] }>('/api/portal/votes'),
  vote: (strainId: string) =>
    preq('/api/portal/votes', { method: 'POST', body: JSON.stringify({ strainId }) }),
  unvote: (strainId: string) => preq(`/api/portal/votes/${strainId}`, { method: 'DELETE' }),
};
